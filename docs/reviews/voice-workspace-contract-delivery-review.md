# Voice workspace: independent delivery review

Reviewer: `/root/delivery_reviewer`. Date: 2026-10-25 (Asia/Shanghai). Documentation-only independent review; no implementation, Git, credentials, provider or deployment actions. This is AI review evidence, not human approval.

## Snapshots

- `docs/architecture/current.md`: SHA-256 `be77c25e30650cc2455f0d967eb53eeedb8ed118f6a92921bde1daa8147b11a5`.
- `docs/architecture/voice-code-workspace-contract.md`: SHA-256 `9073b1709fcb34c3c8ddf24ee5e11cfd2f1a18f9fcdac61cdcac6e7816574b40`.
- `docs/architecture/voice-code-delivery-ledger.md`: SHA-256 `9283e37804fbd722a6099a4404205f7fa813839aee06537ed8e8ef70f22a7820`.
- `docs/product/voice-code-workspace.md`: SHA-256 `66380e50920802babcc31f7b6b1b0097ce13245263c32531d9452cb7ec729658`.

## Findings

### P1 — Linked contract still permits untrusted voice correlation

The current entry correctly requires reliable platform-session-to-Context binding. However, its linked contract at line 61 still allows a single exclusive voice session as a fallback when correlation is not verified. A single active capture does not prove who issued a cloud MCP call. The current raw JSON-RPC proxy has not established trusted voice session metadata. This contradiction must be removed before publishing the documents as the implementation authority. Block voice-originated mutations, including draft creation, until verified trusted correlation or reviewed per-session routing exists.

This independently confirms the MCP review finding. Coordinator repair is pending at this exact snapshot.

### P2 — Entry-point discoverability still sends contributors to the retired topology

`AGENTS.md` Scope and the repository README still identify native iPhone/Relay as the main demo and point at `server-execution.md`. Adding `current.md` with a precedence sentence does not make that page discoverable to a new contributor following repository instructions. Update at least the architecture link in README/AGENTS, or add an unmistakable superseded banner to the old entry. Preserve historical implementation rather than deleting evidence. This is a documentation consistency fix, not permission to revive old components.

### P2 — Current and future API/status descriptions remain mixed

The linked contract's line 70/71 route family disagrees with the actual first-batch query/body `projectId` API, and its current-state section calls the registry wholly absent. Product and ledger retain the same stale status. Soft delete/parent task/independent metadata CAS have only been added to `current.md`, leaving the detailed implementation contract incomplete. Reconcile these before treating the full linked document set as authoritative. Explicitly label source/fixture evidence and unmerged or live-pending work.

## Confirmed

- Current entry separates browser WSS audio, provider voice SDK/WS and xrobo MCP JSON-RPC WSS.
- Codex CLI is the executor; Mac, Relay, native app and App Server are absent from the main topology.
- First-batch draft/confirm remains distinct from later direct execution and acceptance.
- Task account cancellation is owned by the task UID; no arbitrary cross-UID kill is proposed.
- Soft delete preserves code/history and is distinct from stop and archive; active/uncertain execution must be reconciled first.
- Atomic JSON is correctly described as current limited persistence, not complete conversation history or a durable event store. SQLite is an implementation choice, not a necessary extra network service. Codex internal state should not be exposed directly to the browser.
- Explicit live gates prevent local fixtures from being misrepresented as server or phone acceptance.

## Validation and disposition

Read all four documents and the first independent report; checked exact SHA-256 values and `git diff --check` (passed). No implementation or live tests were relevant to this documentation-only scope.

Disposition: the concise current architecture is suitable for a small documentation milestone after the linked contract P1 is resolved and entry links/status discrepancies are reconciled. Implementation readiness, real voice association, Linux cancellation and deployment remain separate gates.

## Coordinator repair follow-up

Re-read the changed documents after the coordinator's repair on 2026-10-25:

- Contract SHA-256 `5cb818084427b80ea668b8872b866bd3d82a4f101a1e0a0c698f7ae2c3bcfb19`.
- Ledger SHA-256 `ec1882800c27c240e2f0b04285d2a35648b4c41ffd1eb840e64abdfbb9b8d9ef`.
- Product SHA-256 `f80f69f7de6df1cf7a028cfdddfe0b6b6662e99662c078583e33a3d2079322d9`.
- Current entry remains `be77c25e30650cc2455f0d967eb53eeedb8ed118f6a92921bde1daa8147b11a5`.

The P1 is addressed: contract line 61 now explicitly blocks every voice-induced mutation until verified binding, including draft creation, and rejects the single-session fallback. The first-batch route family/confirm revision, metadataRevision and soft-delete semantics, source-versus-live status are reconciled. README now links `current.md`; AGENTS has a precedence paragraph explicitly removing native/Relay/App Server from current scope.

No remaining P1 in this documentation scope. This document set can proceed as a documentation milestone; it does not approve implementation or live delivery. Future API rows are still target contracts under the document's explicit opening disclaimer.
