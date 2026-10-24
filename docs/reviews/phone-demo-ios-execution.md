# REVIEW-IOS-1: execution identity, retry and recording review

Reviewer: `/root/mac_v1`, independent of the iOS implementation. This AI review is not human GitHub approval or product acceptance.

## Snapshot and scope

- Initial reviewed iOS commit: `6745dc03d61d2034a5e58f7ec7dea4bf205b97e2`, Draft PR #5, in `voxcode/.worktrees/ios`.
- iOS implementation was clean when initial source inspection began; unrelated untracked review reports were excluded. IOS-004 edits began after the findings below were reported. Those edits are not implicitly covered by the initial review and require the follow-up section below.
- Reviewed `apps/ios/Sources/VoxCodeCore/Core.swift`, native Session/ComposeView/TaskDetail/Recorder/PCMPlayer, pairing transport/settings/root views and the corresponding core/native fixtures.
- Compared request/response, version, approval, criteria and voice shapes against shared contract v1 and the Mac service. Reviewed recording generation ownership, ordered uploads, cursor validation and playback invalidation.
- Read-only inspection of iOS source; this reviewer writes only this report in the Mac worktree. No Git mutation, iOS source change, credential, live provider, device or deployment action.

## Findings

### P2: a definite rejected submission permanently retains the uncertain-result edit lock

Initial source: `apps/ios/VoxCode/ComposeView.swift:103`, `apps/ios/VoxCode/ComposeView.swift:110`, `apps/ios/VoxCode/Session.swift:68`. Lock/recovery controls: ComposeView lines 39-40, 45, 53 and 77; root view lines 29, 41 and 47.

The composer journals a frozen submission before sending it. `Session.mutate` then converts every failure, including the server's explicit `400 invalid` or `409 stale`, to the same Boolean false as a lost response. The composer leaves the submission pending on every false result. Pending state disables editing and hides version rereview. Closing and reopening restores the same journal, and new task/follow-up entry is blocked while that journal exists.

A concrete execution order is: compose for version N, another authorized client advances the task to N+1, then submit version N. Mac checks the version and returns `409 stale` without writing a replay entry or changing the task. Every identical retry still returns stale. The user cannot rebase or repair the draft through the available controls. An oversized otherwise nonempty prompt returning `400 invalid` similarly cannot be shortened after the first attempt. Detail/criterion mutation views also retain their local pending payload on all failures, though those local states can be recreated by navigation.

Remediation: preserve typed HTTP status/code through the API and Session mutation result. For narrowly established no-effect rejections, unlock editing while retaining text/conditions and require explicit rereview/new request ID where appropriate. Preserve immutable retries for transport loss, 5xx and ambiguous `409 conflict`; an idempotency-key conflict must not be broadly treated as proof of nonexecution. Add tests covering both definite rejection and actual applied-response-loss retry.

Status: independently reported, then identified by the coordinator as the same issue already found by `architecture_review` (that reviewer classified it P1). Initial reviewer assessment is P2 because the server prevents invalid/stale execution, while the client workflow is blocked. Resolved by the IOS-004 source recheck below; native XCTest execution remains a CI validation gate.

### P2: an older refresh can overwrite a newer task mutation or refresh

Initial source: `apps/ios/VoxCode/Session.swift:46`, `apps/ios/VoxCode/Session.swift:54`, `apps/ios/VoxCode/Session.swift:68`.

`refresh` checks only the pairing/simulation revision. Within the same revision it starts task/settings reads concurrently, waits for both, then unconditionally replaces both cached snapshots. There is no refresh sequence, mutation barrier or per-task version/freshness merge.

For example, refresh A obtains a version-N task list while its settings request is delayed. A follow-up mutation then succeeds with N+1 and installs that response in `tasks`. Once A's settings request completes, A replaces the cache with N. Two overlapping refreshes can similarly complete in reverse order. The UI temporarily shows older status/version/results as current, and actions can become stale even after their newer response was displayed. The server still rejects stale mutation versions, so this is a client consistency defect rather than an authorization bypass.

Remediation: order refresh application within a connection revision and ensure refreshes started before a successful mutation cannot overwrite its newer cache. A request generation plus mutation barrier, or a carefully defined per-task freshness merge, can enforce this. Test delayed old-refresh/new-refresh ordering and a delayed refresh completing after mutation success, including settings. This finding is established by source execution order; this reviewer did not run a native delayed-Session fixture.

Status: sent to coordinator and architect. Resolved by the IOS-004 source recheck below; native XCTest execution remains a CI validation gate.

## Verified behavior and limits

- API mutation paths include the frozen task ID/version and a stable request ID. Pending payload is a value copy and survives Codable round trips; composer retry sends that original copy.
- Approval UI sends the specific approval ID and approval version, and disables known version mismatch. Approval, manual criterion pass and acceptance are separate controls. Mac remains the authority for expiry, single use, required criteria and trusted failed checks.
- Current evidence and acceptance snapshots are version-labelled, with older evidence rendered separately. No model prose automatically marks criteria passed. Client `canAccept` is a convenience gate, not a replacement for server acceptance checks.
- Recorder freezes the target before its first permission/network await. Startup failure, created-session response, polls and queued uploads check the recording generation. Discard invalidates the generation before clearing state, preventing an old permission/network callback from discarding a newer recording.
- Upload tasks are ordered and bounded; stop waits for queued uploads, while discard/interruption cancels them. Polls validate contiguous voice sequence/cursor values and stop on gaps. Drafts require matching target/version and nonexpired valid conditions before consumption; focus is a suggestion only.
- PCM is signed 16-bit little-endian mono at negotiated 16/24 kHz, with frame/queue bounds. Playback callbacks check a separate epoch, recording drops feedback audio, and stop/abort/interruption suppress queued output. No source finding is made about real audio route/converter behavior without native/device evidence.
- Pairing replaces the origin/token binding together after Keychain save; failed pairing preserves the prior binding. Live credential origin is revalidated and redirects are rejected. Fixed-IP trust uses a specific bundled CA and SSL identity policy. The missing production CA/device installation remains a disclosed acceptance gate.

## Independent local verification

Environment: macOS, Swift `6.3` targeting `arm64-apple-macosx26.0`, Command Line Tools only. Commands below ran from `apps/ios`, using `/private/tmp/voxcode-ios-review-clang` for the module cache and executables under `/private/tmp`.

Each runner was compiled with `swiftc -module-cache-path /private/tmp/voxcode-ios-review-clang Sources/VoxCodeCore/Core.swift Scripts/<runner>.swift -o /private/tmp/voxcode-ios-review-<name>` and then executed:

| Runner | Result |
| --- | --- |
| `CoreChecks.swift` | exit 0; 34 assertions, routing/origin/immutable retry/recording epochs/health/revoke/PCM |
| `V1Checks.swift` | exit 0; criteria/version, 24-task filters, frozen criteria retry, settings, scope/drafts |
| `RecordingRaceChecks.swift` | exit 0; failed recording A cannot discard/finish newer B |
| `AudioChecks.swift` | exit 0; PCM formats/frame bounds, ordered cursor, playback epoch/suppression |

`swiftc -frontend -parse VoxCode/*.swift NativeTests/*.swift Tests/VoxCodeCoreTests/*.swift`: exit 0.

Core executable checks are controlled local checks, not native XCTest or rendered UI tests. The coordinator reported that PR #5 core coverage and unsigned SDK build passed; those CI results were not rerun or independently inspected here. This CLT environment cannot establish native AVAudioEngine/URLSession device behavior, signed installation, audible speech, real Linx/Codex, cellular/company-Mac connectivity or outdoor acceptance. No such success is inferred.

## Initial critical source SHA-256

Fingerprints are from committed `6745dc0` blobs, excluding concurrent IOS-004 edits:

```text
567b69c14678a8fa284de12b6d34d9707ae97ce3b0bf458199cdc780e2a9395c  apps/ios/VoxCode/ComposeView.swift
6e4301e787a172f8e74c230942f0cfad4e5fa1b0eef5981811fbfaf35a37d2f4  apps/ios/VoxCode/Session.swift
acbca81f954891ecaaf06ab15459dfe9b5adb5e22e87c0d1e20bb74f07be7df2  apps/ios/VoxCode/Recorder.swift
cc142b2ff41e76982ee16e2d0a68ff27013776d435bddc3bd1cdf94263956678  apps/ios/VoxCode/PCMPlayer.swift
e4a496038f10704770f18687399fb979ce55d9679a88921141047dc1dc11fc3e  apps/ios/Sources/VoxCodeCore/Core.swift
```

## Follow-up

### IOS-004 targeted source recheck

Date: 2026-10-24. Final reviewed iOS commit: `452411f5e037984a4a3ca197d4551860157ffd7c`. The critical source and Recorder fixture hashes below also match integration commit `3fca98f89ff044b03d5ca4b96854ba6fb0281591`. There is no uncommitted `apps/ios` diff against the reviewed iOS commit. Read-only inspection covered the changed API/Session/composer/detail code and the new native Submission/SessionOrdering/Recorder fixtures. Native CI was dispatched by the coordinator; this reviewer has not independently inspected its result.

- Definite rejection finding: resolved in this content snapshot. `APIError` preserves status and code; only typed `400 invalid`, `409 stale` and `409 blocked` produce `.rejected`. Transport loss, 5xx, `409 conflict`, unknown/malformed codes and authorization errors retain `.uncertain`. Session clears only a matching path/request-ID journal for successful or rejected results. Composer preserves text and conditions, releases its edit lock, and generates a new request ID; a stale version still requires explicit rereview. Detail and criterion views also release their local lock for definite rejection. New native fixtures cover rejection/relaunch, uncertain exact journal retention and an unrelated rejection not erasing the original pending instruction.
- Snapshot ordering finding: resolved in this content snapshot. Refresh/mutation/settings ownership uses an operation generation in addition to connection revision. Mutation completion invalidates in-flight snapshots; task responses additionally require a nondecreasing version and `updatedAt`. New native Session fixtures control delayed responses for old/new refresh, refresh-before-mutation and an older exact replay arriving after a newer snapshot. The actual native fixtures were inspected but cannot run in this CLT environment.
- Additional lifecycle recheck requested by coordinator: established-session DELETE is ordered before new create through the cleanup barrier and the configured request timeout. Composer uses `base.nextAttempt(afterClosing: recorder.closedRequestId)`: it creates a new request ID only when the current ID was closed. Correction to the earlier partial review: starts/retries do not unconditionally generate a fresh ID. An explicit discard records the frozen request ID as closed even before a session ID is known; internal startup-failure cleanup calls `discard(closeAttempt: false)`, preserving the original ID when create execution is unknown. If A is explicitly discarded while its create response is pending, the next attempt from the same base obtains a new ID. A's late success deletes only A's returned session and does not change B's generation/state. This closes the additional P2 closed-request-ID retry loop identified during follow-up.
- Inspected native lifecycle fixtures cover the same-base late-success ordering (B starts, then A succeeds, and only A is deleted), unknown create failure retaining the original retry ID, and established-session DELETE-before-create ordering. These native fixtures were parsed but not executed in this CLT environment. UI discard/close during startup is reachable; the single-provider active-session limit may still temporarily reject B with 429 until A finishes and is deleted. A later explicit recording attempt can recover after that cleanup. Startup serialization was not added or claimed, and the fixture does not eliminate this remote timing window.

Independent final-source core commands (from `apps/ios`, same cache/toolchain as above):

```sh
swiftc -module-cache-path /private/tmp/voxcode-ios-review-clang Sources/VoxCodeCore/Core.swift Scripts/SubmissionChecks.swift -o /private/tmp/voxcode-ios-review-submission
/private/tmp/voxcode-ios-review-submission
# exit 0: typed rejection classification and immutable uncertain retry checks
swiftc -module-cache-path /private/tmp/voxcode-ios-review-clang Sources/VoxCodeCore/Core.swift Scripts/OrderingChecks.swift -o /private/tmp/voxcode-ios-review-ordering
/private/tmp/voxcode-ios-review-ordering
# exit 0: generation/freshness and DELETE-before-create barrier checks
swiftc -frontend -parse VoxCode/*.swift NativeTests/*.swift Tests/VoxCodeCoreTests/*.swift
# exit 0
```

Both original source findings and the additional closed-ID P2 are closed for the inspected final commit. The final Recorder and fixture hashes were independently checked, and the full source/native-test frontend parse was rerun with exit 0 after the last recording fix. Core/Submission/Ordering source hashes are unchanged from the independently executed checks above. Native XCTest/CI execution remains to be recorded by the coordinator. Existing live/device/outdoor limitations continue to apply; these core runners do not establish that SwiftUI controls rendered or native audio played.

```text
dc9fcd663b6f8739b533dcc566e490a3befaac01e26c684784b7755ec58dcfa4  apps/ios/Sources/VoxCodeCore/Core.swift
b0fa193c590ce9b28f664d4f8cffbea957183df081ece4d24cd186b22bc895c6  apps/ios/VoxCode/Session.swift
d0290ef011b9875c93882d24c7276b16a2a0b42c1c3c4c7ed1e216495eb2ebf1  apps/ios/VoxCode/ComposeView.swift
330d9a14e5bbec3d76c25e5f49e250531b09e271c1695c6d3e0ff6ec6235c09c  apps/ios/VoxCode/TaskDetail.swift
4134bce384827ff105c115607d2b173077ba576fb4cce00ba16fb664bdf46c00  apps/ios/VoxCode/Recorder.swift
ec603ae7d7e977c72ae69a0b2a71d3f3bc3f4dd5781e04d68f8242827a169858  apps/ios/Scripts/SubmissionChecks.swift
d8b99d94f4ac50ecef6be5ecbf238d9b943ddf00e52a9f02894e19fda180349d  apps/ios/Scripts/OrderingChecks.swift
7010cc048ce9d9e036b4ed3a28a375d9548d10da76d89a3aa0954c53e22811fa  apps/ios/NativeTests/SessionOrderingTests.swift
455cb3cf2a74a724124247ae94d04349b8c26525d239857a9e3836b006920821  apps/ios/NativeTests/SubmissionTests.swift
9eb4c4e353fbf53141b644c3e7b55bef54fffbfed942a09d16dc390c3a4ff750  apps/ios/NativeTests/RecorderTests.swift
```

### IOS-005 equal-timestamp replay recheck

Date: 2026-10-24. Exact reviewed iOS commit: `5c2b9a75a06cd7c4652a66452f28e8acb0666e75`; corresponding integration commit: `fe54321d10b81513ed5853eded475459acdeca3a`. This is a separate, limited follow-up to the `452411f` review above. The platform reviewer subsequently identified the residual P2 where a queued mutation replay and an already observed running/completed state can share the same version and millisecond timestamp.

Read-only review covered all six changed paths in this commit: Core, Session, OrderingChecks, SnapshotOrderingTests, native SessionOrderingTests and the iOS handoff report. Their current iOS content has no diff against the reviewed commit, and all six SHA-256 values match integration. `SnapshotOwnership.prefer` now defaults to allowing equal timestamps for authoritative refreshes; mutation explicitly passes `allowEqualTimestamp: false`, so an equal-version/equal-time response cannot replace the current task. Strictly newer timestamps at the same version and newer versions still apply. Existing connection revision and operation-generation checks are unchanged.

The focused core assertions cover this strict/inclusive policy split. The new native Session fixture first loads version 2/running, receives a version 2/queued mutation replay at the identical timestamp, and requires running to remain; a subsequent same-time authoritative refresh can advance to completed. No new issue was found in this six-path diff. The residual equal-time P2 is resolved for the inspected source; native fixture execution remains a CI gate.

Independent verification from `apps/ios`:

```sh
swiftc -module-cache-path /private/tmp/voxcode-ios-review-clang Sources/VoxCodeCore/Core.swift Scripts/OrderingChecks.swift -o /private/tmp/voxcode-ios-review-equal-time-ordering
/private/tmp/voxcode-ios-review-equal-time-ordering
# compile exit 0; runner exit 0:
# PASS: refresh/mutation ownership, older replay rejection and DELETE-before-create cleanup barrier
```

Only this focused runner was rebuilt and executed for IOS-005. The earlier broad checks were not repeated or attributed to this commit. Native/core XCTest fixtures were inspected, not executed locally; the coordinator has triggered new CI, whose exact result has not yet been independently inspected. Existing native/device/live/outdoor limitations continue to apply.

```text
f7a3980fb0a8d4f1ec495b85d7d61bdcd0178a8b5b0dc48b6105d4b77bca2483  apps/ios/Sources/VoxCodeCore/Core.swift
e453a1ba5bd3f1861a6624d89bc887199e1b393bd329dab5f13b87a6f62544fe  apps/ios/VoxCode/Session.swift
97b018e8119f8ba46af73b9b04a7116041b1bb876c1d3be9e1cafe2e5ac388f6  apps/ios/Scripts/OrderingChecks.swift
cc0fc2e6b5b409926d9cdfaa28f28494ebe55cb1c007e4739e691322e599eab3  apps/ios/Tests/VoxCodeCoreTests/SnapshotOrderingTests.swift
dc1ce1578414d1587d5678efe8d4001d37f95e90c1c0ceb6545592c47c49e2e2  apps/ios/NativeTests/SessionOrderingTests.swift
c44fd4307e94add34995dcae17b6254f3dbaa383fb7d81f64fdcff018f64753c  docs/reviews/ios-v1-handoff.md
```

## Coordinator CI Evidence

Recorded by `/root`, 2026-10-24; this evidence was supplied after the independent source review, not executed locally by the reviewer. [Run39988267625](https://github.com/liyan-04/voxcode/actions/runs/39988267625) passed at integration `fe54321d10b81513ed5853eded475459acdeca3a`, with iOS source identical to `5c2b9a75a06cd7c4652a66452f28e8acb0666e75`. `gh run watch 39988267625 --exit-status` exited0. Node/Swift changed-code and baseline coverage gates, unsigned iOS SDK build and native iPhone-simulator XCTest all passed; native job120533033021 ran4m20s. Unsigned app/xcresult artifacts were retained. This closes the exact-source cloud simulator check, not signing, real microphone/playback, production-CA URLSession matrix, live Linx or outdoor acceptance.
