#!/bin/bash
# Read-only by default. All build writes stay in a new, explicit output directory.
set -euo pipefail
ios_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v python3 >/dev/null || { echo 'FAIL: Python 3 is required; nothing installed.' >&2; exit 1; }
exec python3 - "$ios_dir" "$@" <<'PY'
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import selectors
import shutil
import signal
import ssl
import subprocess
import sys
import time
import zipfile

IOS = Path(sys.argv[1])
MODE = sys.argv[2] if len(sys.argv) == 3 else None
if MODE in ('-h', '--help'):
    print('Usage: bash Scripts/device-build.sh preflight|archive\n'
          'Default (no argument): preflight. See apps/ios/README.md for explicit inputs.\n'
          'No installation, downloads, account/profile changes or global Xcode selection.')
    sys.exit(0)
if len(sys.argv) == 2:
    MODE = 'preflight'
if MODE not in ('preflight', 'archive'):
    sys.exit('Usage: bash Scripts/device-build.sh preflight|archive')

ENV = dict(os.environ)
ENV['LC_ALL'] = 'C'
failures = []


def run(args, *, cwd=None, log=None, timeout=15, limit=1048576):
    """Bound a command and its descendants; never echo captured signing material."""
    sink = None
    proc = None
    finished = False
    try:
        if log:
            sink = open(log, 'xb')
        proc = subprocess.Popen([str(arg) for arg in args], cwd=cwd, env=ENV,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, start_new_session=True)
        output = bytearray()
        deadline = time.monotonic() + timeout
        with selectors.DefaultSelector() as poll:
            poll.register(proc.stdout, selectors.EVENT_READ)
            while poll.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError('command exceeded its time limit')
                for key, _ in poll.select(min(remaining, 0.25)):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        poll.unregister(key.fileobj)
                    elif sink:
                        sink.write(chunk)
                    else:
                        output.extend(chunk)
                        if len(output) > limit:
                            raise RuntimeError('command output exceeded its size limit')
            status = proc.wait(timeout=max(0.01, deadline - time.monotonic()))
            finished = True
        if status:
            raise RuntimeError('command exited with status ' + str(status))
        return bytes(output)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('command unavailable or timed out') from error
    finally:
        if proc is not None and not finished:
            # Also stop descendants of an exited parent holding inherited pipes open.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
        if sink:
            sink.close()


def check(label, action):
    try:
        value = action()
        print('PASS: ' + label, flush=True)
        return value
    except (RuntimeError, ValueError, KeyError, TypeError, OSError, plistlib.InvalidFileException):
        failures.append(label)
        print('FAIL: ' + label, flush=True)
        return None


def require(condition):
    if not condition:
        raise ValueError('requirement not satisfied')


def required(name, pattern):
    value = ENV.get(name, '')
    require(re.fullmatch(pattern, value) is not None)
    return value


def version(value):
    require(re.fullmatch(r'\d+(?:\.\d+){0,2}', value) is not None)
    return tuple(int(part) for part in value.split('.'))


def developer():
    value = ENV.get('DEVELOPER_DIR') or run(['xcode-select', '-p']).decode().strip()
    path = Path(value)
    if path.name == 'CommandLineTools':
        print('Selected developer directory is Command Line Tools; full Xcode is required.', flush=True)
    require(path.is_dir() and path.name == 'Developer' and
            path.parent.name == 'Contents' and path.parent.parent.suffix == '.app')
    ENV['DEVELOPER_DIR'] = str(path.resolve())
    output = run(['xcodebuild', '-version']).decode()
    match = re.search(r'^Xcode (\d+(?:\.\d+)*)$', output, re.M)
    require(match and version(match[1]) >= (16,))
    return match[1]


def sdk():
    value = run(['xcrun', '--sdk', 'iphoneos', '--show-sdk-version']).decode().strip()
    require(version(value) >= (17,))
    return value


def generator():
    value = ENV.get('VOXCODE_XCODEGEN') or shutil.which('xcodegen')
    require(value and Path(value).is_file() and os.access(value, os.X_OK))
    require(run([value, '--version']).decode().strip() == 'Version: 2.44.1')
    return str(Path(value).resolve())


def ca_resource():
    path = Path(ENV.get('VOXCODE_CA_DER', ''))
    require(path.is_file() and path.suffix.lower() == '.der')
    require(path.stat().st_size <= 65536)
    data = path.read_bytes()
    require(0 < len(data) <= 65536)
    reviewed = required('VOXCODE_CA_SHA256', r'[0-9a-fA-F]{64}').lower()
    require(hashlib.sha256(data).hexdigest() == reviewed)
    # Canonical roundtrip rejects PEM, a key, trailing objects or extra certificates.
    require(run(['openssl', 'x509', '-inform', 'DER', '-in', path,
                 '-outform', 'DER']) == data)
    text = run(['openssl', 'x509', '-inform', 'DER', '-in', path,
                '-noout', '-text']).decode()
    require(re.search(r'X509v3 Basic Constraints:[^\n]*\n\s*CA:TRUE(?:\s|,|$)', text))
    dates = run(['openssl', 'x509', '-inform', 'DER', '-in', path,
                 '-noout', '-startdate', '-enddate']).decode().splitlines()
    values = dict(line.split('=', 1) for line in dates)
    require(ssl.cert_time_to_seconds(values['notBefore']) <= time.time() <
            ssl.cert_time_to_seconds(values['notAfter']))
    return data


def signing():
    identity = required('VOXCODE_SIGNING_IDENTITY', r'[0-9a-fA-F]{40}').upper()
    found = run(['security', 'find-identity', '-v', '-p', 'codesigning']).decode()
    require(re.search(r'\b' + identity + r'\b', found, re.I))
    return identity


def profile():
    path = Path(ENV.get('VOXCODE_PROVISIONING_PROFILE', ''))
    require(path.is_file() and path.suffix == '.mobileprovision' and path.stat().st_size <= 1048576)
    data = plistlib.loads(run(['security', 'cms', '-D', '-i', path]))
    require(team in data['TeamIdentifier'] and 'iOS' in data['Platform'])
    require(data['ExpirationDate'].replace(tzinfo=datetime.timezone.utc) >
            datetime.datetime.now(datetime.timezone.utc))
    entitlements = data['Entitlements']
    require(entitlements['com.apple.developer.team-identifier'] == team)
    prefix, app_id = entitlements['application-identifier'].split('.', 1)
    require(prefix in data['ApplicationIdentifierPrefix'] and app_id == bundle)
    require(entitlements.get('get-task-allow') is True and data.get('ProvisionedDevices'))
    require(any(hashlib.sha1(cert).hexdigest().upper() == identity
                for cert in data['DeveloperCertificates']))
    require(re.fullmatch(r'[0-9A-Fa-f-]{36}', data['UUID']))
    return data['UUID']


def source():
    text = (IOS / 'project.yml').read_text()
    require(re.search(r'deploymentTarget:\s*\n\s+iOS: "17\.0"', text))
    for name in ('VoxCode', 'Sources', 'NativeTests', 'Tests', 'Package.swift', 'project.yml'):
        path = IOS / name
        require(path.exists() and not path.is_symlink())
        if path.is_dir():
            require(not any(child.is_symlink() for child in path.rglob('*')))


print('VoxCode native iPhone ' + MODE + ' (checks do not install or configure tools)', flush=True)
xcode = check('full Xcode >=16 selected for this process (CLT alone is insufficient)', developer)
ios_sdk = check('iphoneos SDK >=17', sdk) if xcode else None
if not xcode:
    print('BLOCKED: iphoneos SDK >=17 check requires full Xcode.', flush=True)
xcodegen = check('preinstalled XcodeGen exactly 2.44.1', generator)
team = check('VOXCODE_TEAM_ID is an explicit 10-character Apple team',
             lambda: required('VOXCODE_TEAM_ID', r'[A-Z0-9]{10}'))
bundle = check('VOXCODE_BUNDLE_ID is explicit and differs from io.voxcode.client',
               lambda: required('VOXCODE_BUNDLE_ID', r'(?!io\.voxcode\.client$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}'))
ca = check('explicit, reviewed SHA-256-matched public DER CA is current and CA:TRUE', ca_resource)
identity = check('explicit signing identity SHA-1 exists in the current keychain', signing)
profile_uuid = check('existing development profile matches team/bundle/identity and is unexpired', profile)
check('source inputs and iOS 17 deployment floor', source)

if failures:
    print('BLOCKED: ' + str(len(failures)) + ' native prerequisites missing or invalid; no archive/export attempted.')
    sys.exit(1)
print('Native prerequisites passed: Xcode ' + xcode + ', iphoneos SDK ' + ios_sdk + '.')
if MODE == 'preflight':
    print('Read-only preflight complete. Signing/export and iPhone installation remain unverified.')
    sys.exit(0)

try:
    raw_output = ENV.get('VOXCODE_OUTPUT_DIR', '')
    require(raw_output and Path(raw_output).is_absolute())
    output = Path(raw_output)
    require(not output.exists() and not output.is_symlink() and output.parent.is_dir())
    output = output.parent.resolve() / output.name
    require(output != IOS and IOS not in output.parents)
    # Exclusive mkdir: never reuse/delete a caller's existing output, including failed runs.
    os.mkdir(output, 0o700)
except (ValueError, OSError):
    sys.exit('FAIL: VOXCODE_OUTPUT_DIR must be a new absolute directory outside apps/ios, with an existing parent.')

try:
    os.umask(0o077)
    stage = output / 'project'
    stage.mkdir()
    for name in ('VoxCode', 'Sources', 'NativeTests', 'Tests', 'Package.swift', 'project.yml'):
        origin = IOS / name
        if origin.is_dir():
            # This project currently needs Swift/plist only; never sweep keys/profiles
            # or an unreviewed trust asset from a source directory into build output.
            shutil.copytree(origin, stage / name, ignore=lambda folder, names: [
                item for item in names if (Path(folder) / item).is_file()
                and Path(item).suffix not in ('.swift', '.plist')])
        else:
            shutil.copyfile(origin, stage / name)
    (stage / 'VoxCode' / 'VoxCodeCA.der').write_bytes(ca)
    # Xcode CLI overrides affect package/dependency targets too. Change only the
    # app settings in this staging copy; the package and test config stay intact.
    spec_path = stage / 'project.yml'
    spec = spec_path.read_text()
    before, app_and_tests = spec.split('\ntargets:\n  VoxCode:\n', 1)
    app_spec, tests = app_and_tests.split('\n  VoxCodeTests:\n', 1)
    app_settings = {'PRODUCT_BUNDLE_IDENTIFIER': bundle, 'DEVELOPMENT_TEAM': team,
                    'CODE_SIGN_STYLE': 'Manual', 'CODE_SIGN_IDENTITY': identity,
                    'PROVISIONING_PROFILE_SPECIFIER': profile_uuid,
                    'CODE_SIGNING_ALLOWED': 'YES', 'CODE_SIGNING_REQUIRED': 'YES'}
    marker = '        PRODUCT_BUNDLE_IDENTIFIER: io.voxcode.client\n'
    require(app_spec.count(marker) == 1)
    app_spec = app_spec.replace(marker, ''.join(
        '        ' + key + ': ' + json.dumps(value) + '\n'
        for key, value in app_settings.items()))
    spec_path.write_text(before + '\ntargets:\n  VoxCode:\n' + app_spec + '\n  VoxCodeTests:\n' + tests)
    (output / 'build-evidence.txt').write_text(
        'Xcode=' + xcode + '\niphoneos SDK=' + ios_sdk + '\nXcodeGen=2.44.1\n'
        'bundle=' + bundle + '\nCA SHA256=' + hashlib.sha256(ca).hexdigest() + '\n'
        'Signing: existing manual development profile; no provisioning updates.\n')
    print('Generating project in new output directory.', flush=True)
    run([xcodegen, 'generate', '--spec', 'project.yml'], cwd=stage,
        log=output / 'generate.log', timeout=60)
    project = stage / 'VoxCode.xcodeproj'
    common = ['xcodebuild', '-project', project, '-scheme', 'VoxCode',
              '-configuration', 'Release', '-sdk', 'iphoneos',
              '-destination', 'generic/platform=iOS', '-derivedDataPath', output / 'DerivedData',
              '-disableAutomaticPackageResolution', '-skipPackageUpdates']
    archive = output / 'VoxCode.xcarchive'
    print('Archiving for generic/platform=iOS; native output retained in archive.log.', flush=True)
    run(common + ['-archivePath', archive, '-resultBundlePath', output / 'archive.xcresult',
                  'archive'], cwd=stage, log=output / 'archive.log', timeout=1800)
    archive_info = plistlib.loads((archive / 'Info.plist').read_bytes())
    app = (archive / 'Products' / archive_info['ApplicationProperties']['ApplicationPath']).resolve()
    require((archive / 'Products').resolve() in app.parents and app.suffix == '.app')
    app_info = plistlib.loads((app / 'Info.plist').read_bytes())
    require(app_info['CFBundleIdentifier'] == bundle and
            app_info['CFBundleSupportedPlatforms'] == ['iPhoneOS'] and
            version(app_info['MinimumOSVersion']) >= (17,))
    require((app / 'VoxCodeCA.der').read_bytes() == ca)
    run(['codesign', '--verify', '--deep', '--strict', app])
    signature = run(['codesign', '-d', '--verbose=4', app]).decode()
    require('\nTeamIdentifier=' + team + '\n' in '\n' + signature)
    options = output / 'ExportOptions.plist'
    options.write_bytes(plistlib.dumps({
        'method': 'debugging', 'destination': 'export', 'teamID': team,
        'signingStyle': 'manual', 'signingCertificate': identity,
        'provisioningProfiles': {bundle: profile_uuid},
        'manageAppVersionAndBuildNumber': False, 'stripSwiftSymbols': True,
    }))
    print('Exporting development IPA; native output retained in export.log.', flush=True)
    run(['xcodebuild', '-exportArchive', '-archivePath', archive,
         '-exportOptionsPlist', options, '-exportPath', output / 'export'],
        cwd=stage, log=output / 'export.log', timeout=900)
    packages = list((output / 'export').glob('*.ipa'))
    require(len(packages) == 1)
    with zipfile.ZipFile(packages[0]) as package:
        infos = [name for name in package.namelist()
                 if re.fullmatch(r'Payload/[^/]+\.app/Info.plist', name)]
        require(len(infos) == 1 and package.getinfo(infos[0]).file_size < 131072)
        info = plistlib.loads(package.read(infos[0]))
        require(info['CFBundleIdentifier'] == bundle and
                info['CFBundleSupportedPlatforms'] == ['iPhoneOS'] and
                version(info['MinimumOSVersion']) >= (17,))
        ca_name = infos[0][:-len('Info.plist')] + 'VoxCodeCA.der'
        require(package.getinfo(ca_name).file_size == len(ca) and package.read(ca_name) == ca)
    checksum = hashlib.sha256()
    with open(packages[0], 'rb') as package_file:
        for chunk in iter(lambda: package_file.read(1048576), b''):
            checksum.update(chunk)
    digest = checksum.hexdigest()
    (output / 'ipa.sha256').write_text(digest + '  ' + packages[0].name + '\n')
    print('Native archive/export succeeded. IPA: ' + str(packages[0]))
    print('IPA SHA256: ' + digest)
    print('Installation, device behavior, cellular/VPN server connectivity, server Codex and Linx gates remain pending.')
except (RuntimeError, ValueError, KeyError, TypeError, OSError,
        plistlib.InvalidFileException, zipfile.BadZipFile):
    sys.exit('FAIL: native delivery did not complete; preserve and inspect local output: ' + str(output))
PY
