# Independent iOS protocol review

Reviewer: Mac implementation worker (did not author iOS client). Reviewed 2026-10-23. Scope: HTTP shapes, HTTPS relay configuration, credential binding, frozen voice targets, replay identity, reconnect and evidence presentation.

## Findings

### P1: Editing bridge address sends the previous bridge bearer to the new host

Locations: `apps/ios/VoxCode/Session.swift:15-19`, `apps/ios/VoxCode/VoxCodeApp.swift:35`, `apps/ios/Sources/VoxCodeCore/Core.swift:40`.

The Keychain has one global credential, while the editable address immediately changes `session.api`. The two-second root polling loop remains active in Settings (`VoxCodeApp.swift:26`), so typing or pasting a different valid HTTPS host sends `/api/tasks` with the old Mac's bearer to that host before pairing succeeds. The pair request also includes that bearer. A mistyped/untrusted relay receives authorization for the previously paired Mac/project. Store the paired origin with its token; use a separate draft address for pairing; omit authorization for pair; replace the paired endpoint and token together after successful pairing. Validate that changing the Settings draft generates no authenticated request to it.

### P2: Retrying after uncertain response reuses identity with editable payload

Locations: `apps/ios/VoxCode/VoxCodeApp.swift:70-77,91-95`.

The request ID survives a failed POST, but title/transcript remain editable. If the server committed the first request and its response was lost, editing and submitting again sends the same requestId with a different payload; the bridge correctly returns conflict. The user cannot recover the original committed result from this screen and may reopen to submit a duplicate task. Keep the submitted mutation immutable until its outcome is reconciled, offer retry with the identical payload, and refresh/recover the server task before allowing a replacement command with a new ID. Core tests cover requestId equality, not this uncertain-response workflow.

### P2: Configured relay path prefix is discarded

Locations: `apps/ios/Sources/VoxCodeCore/Core.swift:38`, API callers use paths beginning `/api/`.

Settings accepts arbitrary HTTPS URLs including a path prefix, but resolving `/api/tasks` against `https://relay.example/voxcode/mac-a/` sends `https://relay.example/api/tasks`. Root-host relays work; path-routed relay URLs fail. Either reject non-root base URLs clearly or retain the configured prefix when constructing routes. This is relevant to the arbitrary configured HTTPS relay requirement.

## Checks And Positive Evidence

- `env CLANG_MODULE_CACHE_PATH=/private/tmp/voxcode-clang swiftc -module-cache-path /private/tmp/voxcode-swift apps/ios/Sources/VoxCodeCore/Core.swift apps/ios/Scripts/CoreChecks.swift -o /private/tmp/voxcode-core-protocol-review` exited 0.
- `/private/tmp/voxcode-core-protocol-review` passed nine assertions covering target mismatch, stale version, mutation encoding, retry ID and null new-task voice binding.
- `swiftc -frontend -parse apps/ios/VoxCode/VoxCodeApp.swift apps/ios/VoxCode/Recorder.swift apps/ios/VoxCode/Session.swift` exited 0.
- Task snapshots, error envelope and mutation bodies match contract v0; task ID is explicit in mutation URL, approval version is explicit, acceptance is separate from execution.
- Recording sets frozen identity before the first await; successful STT polling cannot overwrite an edited transcript, and submission copies the instruction before network awaits.
- HTTPS is mandatory without certificate bypass. Token storage uses device-only Keychain accessibility. The problem above is endpoint binding, not plaintext persistence.
- Evidence is filtered by current task version, with no fabricated progress or tests. Errors and disconnection have visible states.

No P0 found. No iOS SDK type-check, simulator/device run, microphone conversion test, network fault injection or real relay verification was possible in this review; syntax parsing is not a device build. Findings are source-confirmed. No iOS files were changed.
