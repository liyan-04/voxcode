# Voice workspace contract: independent MCP review

Reviewer: `/root/mcp_hardening`, independent of these three design documents. Date: 2026-10-24. Read-only review of implementation references; no service, Git, credential or deployment operations. The MCP implementation is this reviewer's component and is not independently approved by this report.

## Reviewed snapshots

- `docs/architecture/voice-code-workspace-contract.md`: SHA-256 `9073b1709fcb34c3c8ddf24ee5e11cfd2f1a18f9fcdac61cdcac6e7816574b40`.
- `docs/architecture/voice-code-delivery-ledger.md`: SHA-256 `9283e37804fbd722a6099a4404205f7fa813839aee06537ed8e8ef70f22a7820`.
- `docs/product/voice-code-workspace.md`: SHA-256 `66380e50920802babcc31f7b6b1b0097ce13245263c32531d9452cb7ec729658`.

Referenced the current #74 HTTP source and #80 project service source as implementation evidence, not merged/live delivery. No implementation tests were rerun for this documentation-only review.

## Findings

### P1 — A single voice session does not prove MCP caller correlation

`docs/architecture/voice-code-workspace-contract.md:61` permits either an exclusive voice session or blocking mutating tools when trusted platform correlation is missing. Exclusivity only reduces ambiguity; it does not establish that an incoming MCP request came from that voice session or capture. The current proxy bridge receives bare JSON-RPC and has no verified trusted device/session metadata. A cloud tool request can therefore be incorrectly assigned to the one active capture.

Resolution required: until a trusted platform identifier or reviewed per-session endpoint binding is verified, disable every voice-originated mutation, including draft creation, and report `writeReady:false`. Keep speech/transcription and explicitly authenticated non-voice MCP probes separately labelled. Do not treat a model-supplied projectId or the existence of only one active capture as authorization. The diagram may remain the target topology, with the unverified association marked as a gate.

### P2 — Published HTTP routes disagree with the implemented first batch

`docs/architecture/voice-code-workspace-contract.md:70` and `:71` use `/api/projects/:projectId/tasks`, while #74 implements `GET /api/tasks?projectId=...` and `POST /api/tasks` with body `projectId`. The table also describes create-task-and-turn while first-batch start produces a draft. Confirm/cancel are currently `/api/tasks/:id/confirm` and `/api/tasks/:id/cancel`; continuation, immutable results and acceptance are future contracts.

Resolution required: keep one first-batch route table matching the current code, explicitly list `revision` for confirm, and label future contracts separately. Do not force a second route family or pretend future routes are available just to match the design.

### P2 — Current status hides implemented project support and risks misleading delivery claims

`docs/architecture/voice-code-workspace-contract.md:33` and `:123`, ledger Web row and unverified-project bullet, and `docs/product/voice-code-workspace.md:99` still classify registry/project selection as wholly absent. #74 now has an authenticated safe project list, explicit projectId create/list, task-project checks, real readiness probing, and UI integration. #80 has multi-project routing source. These remain local source/fixture evidence, not merged, deployed or phone-accepted capability.

Resolution required: update current-state rows to distinguish source implemented/local-verified/pending integration from master/deployed/live. Preserve remaining gates for scope isolation, real model work, voice, snapshots and acceptance. Public documentation should link repository source/Issue/PR evidence instead of `/private/tmp` worktree paths.

### P2 — Metadata lifecycle is not defined in the shared contract

The new metadata behavior is absent from all three reviewed documents. #74/#80 now introduce `parentTaskId`, `metadataRevision`, `archived`, `deletedAt`, archive/delete/restore operations and list filters. Without a shared contract, consumers can confuse metadata CAS with rapidly changing execution revision, treat soft delete as cancellation, or recursively hide/delete children unexpectedly.

Resolution required: specify independent `metadataRevision` CAS and durable requestId, same-project nondeleted parent validation at creation, archive/delete guards for running/cancelling/quarantined tasks, nonrecursive soft deletion, restore without execution or file rollback, default list filtering and explicit archived/deleted views. State that an archived/deleted task must be restored/unarchived before confirm; cancellation and execution history are preserved. Expose no hard-delete or filesystem-delete behavior by implication. Mark APIs as source/fixture only until reviewed and integrated.

## Confirmed alignment

- Browser audio WSS, server-to-provider voice WS/SDK and xrobo MCP JSON-RPC WSS are distinct links.
- The first batch preserves draft → explicit webpage confirm; product direct execution is a gated future behavior, not permission to remove confirmation now.
- Model text does not authorize risky Codex operations; execution completion, operation approval and result acceptance remain separate.
- Scope allowlists are not claimed as enforced before execution isolation exists; Codex resume remains gated on real installed-version verification.

Disposition: fix P1 and reconcile P2 contract/status discrepancies before treating the documents as the implementation authority. This report does not approve source code, runtime deployment, provider correlation or human speech acceptance.
