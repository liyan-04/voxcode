#!/usr/bin/env python3
"""Command fixtures only: Apple tools are substitutes, never native delivery evidence.

Run: python3 apps/ios/Scripts/device-build-tests.py (macOS, Python3.9+, OpenSSL).
Uses only a public system root; creates no keys, profiles or real SDK artifacts.
"""
import datetime, hashlib, json, os, pathlib, plistlib, re, shlex, ssl, subprocess, tempfile, sys, time
SCRIPT = pathlib.Path(__file__).resolve().with_name('device-build.sh')
with tempfile.TemporaryDirectory(prefix='voxcode native fixture ') as temp:
    root = pathlib.Path(temp)
    tools = root / 'controlled tools'; tools.mkdir()
    selected = root / 'Full Xcode.app/Contents/Developer'; selected.mkdir(parents=True)
    ca = root / 'reviewed public root.der'
    # Public system trust material only. No key generation/copying or real signing.
    for pem in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', pathlib.Path('/etc/ssl/cert.pem').read_text(), re.S):
        ca.write_bytes(ssl.PEM_cert_to_DER_cert(pem))
        result = subprocess.run(['/usr/bin/openssl', 'x509', '-inform', 'DER', '-in', str(ca), '-checkend', '0', '-noout'], capture_output=True)
        if result.returncode == 0: break
    else: raise AssertionError('no current public CA fixture')
    synthetic_cert = b'controlled signing identity (no private key)'
    identity = hashlib.sha1(synthetic_cert).hexdigest().upper()
    profile = root / 'existing profile.mobileprovision'; profile.write_text('opaque fixture profile, not Apple signing material')
    payload = {'TeamIdentifier':['ABCDE12345'], 'Platform':['iOS'], 'ExpirationDate':datetime.datetime(2099,1,1),
        'ApplicationIdentifierPrefix':['ABCDE12345'], 'Entitlements':{'application-identifier':'ABCDE12345.test.voxcode.fixture','com.apple.developer.team-identifier':'ABCDE12345','get-task-allow':True},
        'ProvisionedDevices':['synthetic-device'], 'DeveloperCertificates':[synthetic_cert], 'UUID':'12345678-1234-1234-1234-123456789ABC'}
    (root/'profile.plist').write_bytes(plistlib.dumps(payload))
    command_log = root/'commands.jsonl'
    (tools/'python3').symlink_to(sys.executable)
    shim = '''import json, os, pathlib, plistlib, sys, time, zipfile
name = sys.argv[1]
args = sys.argv[2:]
root = pathlib.Path(os.environ['FIXTURE_ROOT'])
with open(root/'commands.jsonl','a') as log: log.write(json.dumps([name]+args)+'\\n')
def val(key): return args[args.index(key)+1]
if name == 'xcode-select': print(os.environ['FIXTURE_DEVELOPER'])
elif name == 'xcrun': print('18.0')
elif name == 'xcodegen':
    if args == ['--version']:
        if os.environ.get('FIXTURE_SLOW'): time.sleep(30)
        print('Version: '+os.environ.get('FIXTURE_XCODEGEN','2.44.1'))
    else: pathlib.Path('VoxCode.xcodeproj').mkdir()
elif name == 'security':
    if args[0] == 'find-identity': print(' 1) '+os.environ['FIXTURE_IDENTITY']+' "DO_NOT_ECHO_PRIVATE_IDENTITY_NAME"\\n 1 valid identities found')
    else: sys.stdout.buffer.write((root/'profile.plist').read_bytes())
elif name == 'codesign':
    if args[0] == '-d': print('TeamIdentifier=ABCDE12345')
elif name == 'xcodebuild':
    if args == ['-version']: print('Xcode 16.2\\nBuild version fixture')
    elif 'archive' in args:
        if os.environ.get('FIXTURE_ARCHIVE_FAILURE'):
            print('controlled native archive error'); sys.exit(65)
        archive = pathlib.Path(val('-archivePath'))
        app = archive/'Products/Applications/VoxCode.app'; app.mkdir(parents=True)
        info = {'CFBundleIdentifier':'test.voxcode.fixture','CFBundleSupportedPlatforms':['iPhoneOS'],'MinimumOSVersion':'17.0'}
        if os.environ.get('FIXTURE_SIMULATOR'): info['CFBundleSupportedPlatforms']=['iPhoneSimulator']
        (app/'Info.plist').write_bytes(plistlib.dumps(info))
        (app/'VoxCodeCA.der').write_bytes(pathlib.Path('VoxCode/VoxCodeCA.der').read_bytes())
        (archive/'Info.plist').write_bytes(plistlib.dumps({'ApplicationProperties':{'ApplicationPath':'Applications/VoxCode.app'}}))
    else:
        export=pathlib.Path(val('-exportPath')); export.mkdir()
        archive=pathlib.Path(val('-archivePath'))
        app=archive/'Products/Applications/VoxCode.app'
        with zipfile.ZipFile(export/'VoxCode.ipa','w') as z:
            for item in app.iterdir(): z.write(item,'Payload/VoxCode.app/'+item.name)
'''
    runner = root/'apple-command-fixture.py'; runner.write_text(shim)
    for name in ['xcode-select','xcrun','xcodegen','security','codesign','xcodebuild']:
        path=tools/name
        path.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' '+shlex.quote(str(runner))+' '+name+' \"$@\"\n')
        path.chmod(0o700)
    env = {**os.environ,'PATH':str(tools)+':'+os.environ['PATH'],'DEVELOPER_DIR':str(selected),
        'VOXCODE_XCODEGEN':str(tools/'xcodegen'),'VOXCODE_TEAM_ID':'ABCDE12345','VOXCODE_BUNDLE_ID':'test.voxcode.fixture',
        'VOXCODE_CA_DER':str(ca),'VOXCODE_CA_SHA256':hashlib.sha256(ca.read_bytes()).hexdigest(),
        'VOXCODE_SIGNING_IDENTITY':identity,'VOXCODE_PROVISIONING_PROFILE':str(profile),
        'FIXTURE_ROOT':str(root),'FIXTURE_DEVELOPER':str(selected),'FIXTURE_IDENTITY':identity}
    def execute(mode='preflight', **changes):
        command_log.unlink(missing_ok=True)
        result=subprocess.run(['bash',str(SCRIPT),mode],env={**env,**changes},capture_output=True,text=True,timeout=25)
        commands=[json.loads(line) for line in command_log.read_text().splitlines()] if command_log.exists() else []
        assert 'DO_NOT_ECHO_PRIVATE_IDENTITY_NAME' not in result.stdout+result.stderr
        assert 'synthetic-device' not in result.stdout+result.stderr
        return result,commands
    result, commands = execute()
    assert result.returncode == 0, result.stdout+result.stderr
    assert not any(cmd[0]=='xcodegen' and cmd[1]!='--version' for cmd in commands)
    assert not any(cmd[0]=='xcodebuild' and cmd[1]!='-version' for cmd in commands)
    print('PASS fixture: complete read-only preflight, public DER real OpenSSL, spaces, no material echo')
    started=time.monotonic()
    result,commands=execute('preflight',FIXTURE_SLOW='1')
    assert result.returncode != 0 and time.monotonic()-started < 20
    print('PASS fixture: 30-second tool is killed at 15-second preflight bound')
    for change,label in [({'FIXTURE_XCODEGEN':'2.44.2'},'wrong XcodeGen'),({'VOXCODE_CA_SHA256':'0'*64},'unreviewed CA digest'),({'VOXCODE_BUNDLE_ID':'test.voxcode.mismatch'},'profile bundle mismatch')]:
        result,commands=execute('archive',VOXCODE_OUTPUT_DIR=str(root/'must not exist'),**change)
        assert result.returncode != 0 and not (root/'must not exist').exists()
        assert not any('archive' in cmd for cmd in commands)
        print('PASS fixture: '+label+' blocks before archive/output')
    existing=root/'preserve output'; existing.mkdir(); (existing/'sentinel').write_text('keep')
    result,commands=execute('archive',VOXCODE_OUTPUT_DIR=str(existing))
    assert result.returncode != 0 and (existing/'sentinel').read_text()=='keep'
    assert not any('archive' in cmd for cmd in commands)
    print('PASS fixture: existing output never overwritten')
    failed=root/'failed output'; result,commands=execute('archive',VOXCODE_OUTPUT_DIR=str(failed),FIXTURE_ARCHIVE_FAILURE='1')
    assert result.returncode != 0 and (failed/'archive.log').read_text().strip()=='controlled native archive error'
    assert not any('-exportArchive' in cmd for cmd in commands)
    print('PASS fixture: native nonzero preserved and export not attempted')
    simulator=root/'simulator output'; result,commands=execute('archive',VOXCODE_OUTPUT_DIR=str(simulator),FIXTURE_SIMULATOR='1')
    assert result.returncode != 0 and not any('-exportArchive' in cmd for cmd in commands)
    print('PASS fixture: simulator archive rejected')
    output=root/'archive and export output'; result,commands=execute('archive',VOXCODE_OUTPUT_DIR=str(output))
    assert result.returncode == 0, result.stdout+result.stderr
    archive_command=next(cmd for cmd in commands if 'archive' in cmd)
    # Command-line build settings would affect the local SwiftPM library too.
    app_only = ('DEVELOPMENT_TEAM', 'PRODUCT_BUNDLE_IDENTIFIER', 'CODE_SIGN_STYLE',
                'CODE_SIGN_IDENTITY', 'PROVISIONING_PROFILE_SPECIFIER')
    assert not any(arg.startswith(key+'=') for arg in archive_command for key in app_only), 'app signing leaked to package targets'
    staged_spec=(output/'project/project.yml').read_text()
    original_spec=(SCRIPT.parent.parent/'project.yml').read_text()
    app_settings=staged_spec.split('\ntargets:\n  VoxCode:\n',1)[1].split('\n  VoxCodeTests:\n',1)[0]
    for key,value in [('DEVELOPMENT_TEAM','ABCDE12345'),('PRODUCT_BUNDLE_IDENTIFIER','test.voxcode.fixture'),
                      ('CODE_SIGN_STYLE','Manual'),('CODE_SIGN_IDENTITY',identity),
                      ('PROVISIONING_PROFILE_SPECIFIER',payload['UUID'])]:
        assert '\n        '+key+': '+json.dumps(value)+'\n' in app_settings, key
    assert staged_spec.split('\n  VoxCodeTests:\n',1)[1] == original_spec.split('\n  VoxCodeTests:\n',1)[1]
    assert staged_spec.split('\ntargets:\n',1)[0] == original_spec.split('\ntargets:\n',1)[0]
    assert archive_command[archive_command.index('-destination')+1]=='generic/platform=iOS'
    assert archive_command[archive_command.index('-sdk')+1]=='iphoneos'
    assert not any('allowProvisioning' in arg or 'download' in arg for cmd in commands for arg in cmd)
    assert (output/'export/VoxCode.ipa').is_file() and (output/'ipa.sha256').is_file()
    assert not (output/'project/existing profile.mobileprovision').exists()
    print('PASS fixture: iPhone pipeline, app-only signing, unchanged package/test config, retained output')
print('9 controlled command fixtures passed; no real Xcode build, signature, IPA or device evidence')
