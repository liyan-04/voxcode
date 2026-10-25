# Native iPhone delivery — Issue #44

Status: **reviewable script/docs; native build, signing and installation blocked**. Owner: native delivery engineer `/root/ios_device_delivery`; coordinator owns Git/PR/integration. Base: `origin/master` `d47cc0c`. Assigned paths: `apps/ios/Scripts/device-build.sh`, `apps/ios/Scripts/device-build-tests.py` (coordinator added fixture ownership), `apps/ios/README.md`, this file. PR35 monitoring source is unchanged and remains Draft. This record does not certify iPhone or public Relay/company-Mac delivery.

## Entry point and safety boundary

Run `bash apps/ios/Scripts/device-build.sh preflight` from the repository root, or follow the explicit environment inputs in [the iOS README](../../apps/ios/README.md). No argument also selects preflight. Requires preinstalled Python3, Xcode16+/iPhoneOS SDK17+, XcodeGen2.44.1, OpenSSL, an existing Keychain code-signing identity/private key and an installed development profile. `DEVELOPER_DIR` selects full Xcode for this process, without changing global selection. No downloads/installation, sudo, private-key generation/copying, Apple-account/profile changes or provisioning update/device registration flags are used.

Preflight is read-only: no project generation, build output, certificates, profiles or temporary files are created by the script. Each tool probe has a 15-second deadline and 1MiB captured-output ceiling; CA input is capped at64KiB and the profile at1MiB. Tool descendants are terminated on timeout. Signing identity names, raw certificates, device IDs and decoded provisioning contents are never printed. A nonzero tool status fails its gate. The seven user/environment prerequisites are reported individually; the iPhone SDK check is explicitly blocked when full Xcode is absent. A successful preflight cannot prove Keychain unlock/access, export support or target-device eligibility.

Explicit inputs: team ID, unique bundle ID, signing certificate SHA-1, existing development profile path, public DER CA path and independently reviewed SHA-256. Preflight validates the profile's team, explicit bundle, certificate membership, expiry, iOS platform, development entitlement and nonempty registered-device list in memory. It does not install the profile or publish its contents. The operator must confirm that the intended phone is registered. The CA must match the approved bytes, parse as one canonical DER certificate with CA:TRUE and be currently valid. Public-CA review must separately verify its relationship to the fixed-IP Relay leaf (`203.0.113.20` IP SAN); metadata checks cannot establish that relationship. A local test root is never an approved production trust input.

Only explicit `archive` mode writes, and only after all preflight gates pass. `VOXCODE_OUTPUT_DIR` must be a new absolute directory outside `apps/ios`, with an existing parent. Exclusive creation rejects existing files/directories/symlinks; no output is reused or deleted. Copies include the current Swift/plist source and local package/project configuration, plus only the explicit reviewed public DER resource named `VoxCodeCA.der`; no signing profile/private key is copied into project staging. Generation occurs in `output/project`, preserving the checkout and its generated project. XcodeGen remains pinned2.44.1.

Native commands use Release, `-sdk iphoneos`, `-destination generic/platform=iOS`, the existing iOS17 deployment floor and **manual development** signing. Team/bundle/identity/profile and required signing flags are scoped to `targets.VoxCode.settings.base` in the staged `project.yml`; no signing/bundle build setting is injected globally on the archive command. SwiftPM package/test configuration stays unchanged, avoiding manual-profile settings on the local `VoxCodeCore` package target. Package automatic resolution/updates are disabled; the only package in the current spec is local `VoxCodeCore`. Archive has a30-minute deadline and export15minutes. The script checks the actual archived application bundle's ID, iPhoneOS platform, minimum OS, embedded CA bytes, code signature and signing team before development (`debugging`) export. The exported IPA is checked for the expected iPhoneOS bundle/CA and assigned a SHA-256. A failed generation/archive/export or malformed/simulator artifact returns nonzero and preserves partial output and logs. A successful run reports only archive/export; it never claims installation or product acceptance.

Output is private local evidence: `project/`, `VoxCode.xcarchive`, `archive.xcresult`, `DerivedData/`, `ExportOptions.plist`, `export/*.ipa`, `ipa.sha256`, `build-evidence.txt` and generation/archive/export logs. Xcode may include local paths and public signing/provisioning metadata in its native logs/artifacts. Keep raw outputs local and redact before sharing. The operator chooses a new output path to retry and owns any later removal; there is no cleanup trap. For distribution beyond registered development devices, use a separately reviewed Apple distribution workflow; this script does not silently switch methods.

## Local evidence, 2026-10-24

Environment: macOS, `/bin/bash`, Python3.9.6. No full Xcode/signing setup was performed. Actual local commands on the assigned worktree:

| Command | Result | Evidence class / limit |
| --- | --- | --- |
| `/usr/bin/xcode-select -p` | `/Library/Developer/CommandLineTools`, exit0 | local inventory |
| `/usr/bin/xcodebuild -version` | requires full Xcode; active directory is CLT, nonzero | local; no SDK build |
| `/usr/bin/xcrun --sdk iphoneos --show-sdk-version` | SDK `iphoneos` cannot be located, nonzero | local; no iOS SDK |
| `command -v xcodegen` | absent, nonzero | local; pinned generator unavailable |
| `/usr/bin/security find-identity -v -p codesigning` filtered in memory to count | `0 valid code-signing identities` | local; no identity/certificate contents recorded |
| `bash -n apps/ios/Scripts/device-build.sh` | exit0 | local shell syntax |
| Python `compile()` of the embedded heredoc source (without executing it) | exit0 | local Python syntax, not native compilation |
| `bash apps/ios/Scripts/device-build.sh --help` | exit0 | local usage |
| `bash apps/ios/Scripts/device-build.sh preflight` | exit1; full Xcode, pinned generator, team, bundle, reviewed CA, identity, profile fail; iPhone SDK check blocked; source/iOS17 floor passes | local; no generation/archive/export attempted |
| `python3 /private/tmp/voxcode-device-fixtures.py` | initial expected RED: delivery entry point missing; after implementation existing-output sentinel retained | fixture, not signing |
| `python3 apps/ios/Scripts/device-build-tests.py` | 9 controlled command scenarios pass | fixture; real OpenSSL parses a current public system-root DER; other Apple commands are controlled substitutes |

The reproducible command fixture is [device-build-tests.py](../../apps/ios/Scripts/device-build-tests.py); it stages all controlled tools/artifacts in a disposable temporary directory and never replaces production tools. It invokes the actual script in paths containing spaces and checks: read-only preflight emits no identity/profile content or build commands; a30-second tool dies at15seconds; wrong XcodeGen, mismatched reviewed CA digest and wrong profile bundle block before output/archive; an existing output sentinel survives; archive status65 leaves its error log and never exports; iPhoneSimulator archive metadata is rejected; and a controlled archive/export retains artifacts while requesting iPhoneOS, generic iOS/manual signing with no provisioning-update flags. These scenarios verify script control flow only. Their synthetic archive/signature/IPA must never be installed or presented as Apple output. No keys were generated and no real signing, native compilation, iPhone installation or remote service was exercised. The fixtures require the existing macOS public root store and OpenSSL; they do not download a certificate or install any dependency.

Review follow-up: the initial command had global team/bundle/manual/profile overrides, which would also reach the SwiftPM target graph. The added assertion first failed with `app signing leaked to package targets`; after scoping settings to the staged app target, all9scenarios passed. The final pipeline scenario checks exact app-only settings, unchanged package/test configuration and absence of global signing arguments. This verifies configuration scope; an actual full-Xcode target build remains unavailable and required.

## Full-Xcode and PR35 gates still required

Keep PR35 Draft until fresh native XCTest and coverage evidence exists for its **exact current head and exact PR base**. This task neither changes Swift/monitor code nor alters [coverage policy](../coverage.md): Swift core changed executable lines >=80%, branch arms >=70% where emitted, no overall decrease; missing reports/baselines fail. Node and Swift coverage are separate gates. Previous cloud simulator runs and assertion runners/shims do not cover newer PR35 source.

On a prepared full-Xcode Mac, coordinator-owned separate checkouts and output paths preserve comparison inputs:

```sh
export DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer'
# Each ROOT is an existing checkout of the exact recorded SHA; HEAD_ROOT contains PR35.
# Each OUTPUT path is a separate private absolute directory chosen by the operator.
node "$HEAD_ROOT/scripts/coverage.mjs" collect-swift --root "$BASE_ROOT" --output "$BASE_OUTPUT"
node "$HEAD_ROOT/scripts/coverage.mjs" collect-swift --root "$HEAD_ROOT" --output "$HEAD_OUTPUT"
node "$HEAD_ROOT/scripts/coverage.mjs" check --language swift \
  --report "$HEAD_OUTPUT/lcov.info" --baseline "$BASE_OUTPUT/lcov.info" \
  --root "$HEAD_ROOT" --base-root "$BASE_ROOT" --base "$BASE_SHA" --head "$HEAD_SHA" \
  --output "$GATE_OUTPUT"
```

These invoke actual `swift test --enable-code-coverage` and Xcode `llvm-cov`, including core XCTest; no shim runner substitutes. Record all commands, SHAs, toolchain versions and raw covered/total counts; correct any manifest/cache/tool failure rather than recording a pass. Run applicable Node and policy checks separately under normal repository policy; this script is outside runtime coverage scope, with command fixtures as tooling evidence.

Generate the exact head's project in an operator-chosen staging copy (or use the private `project/` retained by an archive run of that same source). With XcodeGen2.44.1 and an existing installed simulator, run native build/XCTest; select a simulator locally and retain its identifier only in private local output:

```sh
xcodegen generate --spec project.yml
xcodebuild -project VoxCode.xcodeproj -scheme VoxCode -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$SIM_DERIVED_DATA" CODE_SIGNING_ALLOWED=NO build
xcodebuild -project VoxCode.xcodeproj -scheme VoxCode \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath "$SIM_DERIVED_DATA" -resultBundlePath "$SIM_RESULT_BUNDLE" \
  -enableCodeCoverage YES CODE_SIGNING_ALLOWED=NO test
```

Run these from the staging iOS directory, with fresh output paths. Native tests include Recorder and Session/transport/platform behavior from that exact revision. Simulator evidence remains separate from device evidence. Two independent reviewers inspect final script/docs/source changes before merge; AI reviews do not replace human GitHub approvals or acceptance.

## Device, public Relay and real task acceptance

After successful native archive/export, the operator installs the retained development IPA with an authorized Xcode device workflow on an included iPhone running17+, trusts the Mac and enables Developer Mode. Record revision/build number, bundle, IPA checksum, phone model/iOS version and actual install/open result without device identifiers. Test microphone permission, interruption/background/input changes and16kHz conversion; audible16/24kHz playback/abort; fixed-IP URLSession success and wrong-CA/wrong-IP/expiry rejection with the reviewed public CA.

Use that same installed build over cellular with Wi-Fi off through the deployed public Relay, company-Mac Connector online, simulation off and actual authorized Codex work. Record a real task and same-thread follow-up, current-version diff/checks and manual acceptance, with replay/approval/cancel and20-task/four-slot behavior as required by the phone scope. Real Linx STT/draft/TTS remains a separate live/device gate pending onboarding. Missing public mapping/TLS, Relay deployment, signing, native tests/coverage, device installation or real Codex/Linx results stay explicit; none can be inferred from this script or its command fixtures.
