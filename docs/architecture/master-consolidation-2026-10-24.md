# Master consolidation — 2026-10-24

User authorization: merge all remaining remote topic content into `master`, then remove the merged remote branches. `master` is the sole default/integration branch. Keep local uncommitted work and unrelated concurrent development.

## Integration evidence

- [PR #22](https://github.com/liyan-04/voxcode/pull/22) is MERGED into `master` at `33d0daf4cfa74f9a0b8657cf472a6db6cc3fe305`.
- Its tested promotion head is `cbcf71f9529a59558b122d57cf26a53ad0a00a56`; `git diff origin/master origin/codex/phone-demo-to-master` returned no differences.
- Reconciled four documentation conflicts, retained the newer phone contract/Actions-disabled policy, and retained master UI tests and coverage fixes. `npm test`: 161 passed, 0 failed. `npm run test:policy`: 29 passed, 0 failed. Evidence class: local/fixture, Node 26.
- `master` remains default and protected: PR required, deletion/force push disabled, administrators included, no Actions status requirement.
- Implementations in all audited remote topic branches have been integrated or superseded in master. Master additionally retains the simulator UI tests and coverage fixes. Other differences from older tips are superseded documents, metadata or removed workflows; re-merging old file versions would regress current policy.

## Remote branch audit

These exact remote heads were audited before deletion. Delete only if the remote still points at the recorded head, has no new dependency, and is not protected. PR history and Git objects remain available; deletion of a remote ref does not authorize deleting a dirty local checkout.

| Branch | Audited head | Integration / disposition |
| --- | --- | --- |
| `codex/agent-governance` | `3273c4cf063eb6345851a208c33a0785a0d11559` | #11 closed; #12 superseding governance; #22 promotion |
| `codex/collaboration-policy` | `48f81cc45328333c2c2147d80b43b7af7d928377` | #1, #2, #22 |
| `codex/delivery-closure-docs` | `4630615bfa7b58ae9b8674c68e7882656ea98265` | #14 closed as superseded; #19, then #22 |
| `codex/delivery-closure-v2` | `756e935108994277c296a0b03479fb740e10df8a` | #19, #22 |
| `codex/disable-actions` | `8560a8bc9cc3262ce9d29cfd48f7ec8e9e01c63f` | #17, #22 |
| `codex/integration-phone-demo` | `54d1c3eac5cab0ee59d4da3f0ad8d275234b6bf9` | #6, #18, #22 |
| `codex/ios-phone-demo` | `11d009d644fc3692a14cf5015f2bd2b0dec40793` | #5, #18, #22 |
| `codex/mac-phone-demo` | `7cbd3aa2ac73fde8553bdb202b7ba9cc70a77fec` | #3, #18, #22 |
| `codex/mainline-integration` | `f359160214fb925fb71aebb8f3508378e37ca1fe` | #18, #22 |
| `codex/milestone-sequence` | `d2cc973ab500cc0dcb197ee518f95dedfd1ee2c3` | #20, #22 |
| `codex/mvp` | `e2f2a29c86f93e03a8949036cf31d5992d1ae076` | #1, #8, #10, #12, #13; equivalent content promoted by #22 |
| `codex/phone-demo` | `b7743237b6a136da316cf40410a89e420a689d31` | #22 via identical promotion snapshot |
| `codex/phone-demo-contracts` | `c6f1aabc00cd23ddbd56017d4de3cf36a3cf70fe` | #2–#6, #18, #22 |
| `codex/phone-demo-to-master` | `cbcf71f9529a59558b122d57cf26a53ad0a00a56` | #22 |
| `codex/relay-phone-demo` | `4ed1531e63033645dd360c5e1ad380d3efe2bb6f` | #4, #18, #22 |

## Local resources retained

- Original checkout on local `codex/phone-demo`: dirty, with local commit `3710cef` and concurrent uncommitted files. It is a recovery snapshot, not the integration branch. Do not reset, switch, clean or stage it wholesale.
- Architecture, iOS, Mac and Relay worktrees retain untracked review reports. Preserve them.
- Issue #21 merged through PR #23 at `3b851f10938ed1332f72051ff4d419f06ced4582`; preserve the local `issue-collaboration-policy` worktree and its retained files. Its remote head is eligible for retirement only after exact SHA/merge verification.
- The clean mainline-integration worktree contains an ignored Relay installation package; retain that package and its checkout.
- `/private/tmp/voxcode-pr13` contains an untracked dependency symlink; `/private/tmp/voxpr` has detached commits needing separate audit. Preserve both.
- TLS private keys and unarchived benchmark/review outputs are outside branch-ref cleanup. Do not remove them as caches.
- Local master checkout remains; the executing coordinator worktree remains active. Only unoccupied, verified local topic branches may use ordinary `git branch -d`; never force deletion.

## Cleanup execution

Completed: 15 audited remote `codex/*` refs deleted after reading each current head and protection status; none changed or required preservation. Remote default `master` was not altered by deletion. PR #14 was closed as superseded by #19/#22, not marked merged.

Two unoccupied local topics (`codex/collaboration-policy`, `codex/phone-demo-contracts`) were removed with ordinary `git branch -d`. Git refused to delete local `codex/relay-package` because squash integration does not establish ancestry; it remains preserved, with no force deletion.

The final cleanup documentation uses a separate PR to `master`; its temporary remote branch is deleted only after its own merge. Local dirty worktrees, the retained Issue #21 worktree, installation package and private keys remain untouched.

Independent local reviews: `/root/master_ancestry_audit` found no actionable defect; `/root/remote_branch_inventory` requested distinguishing master-only UI tests/coverage additions from superseded metadata, which is corrected above. `/root/worktree_cleanup_audit` confirmed runtime source integration and listed retained worktrees. Reviews are AI evidence, not human GitHub approvals.

## Product acceptance remains separate

Branch consolidation does not prove a signed iPhone install, live Linx speech, deployed Relay, or cellular access to the company Mac. G3–G5 remain subject to their recorded acceptance gates.

## Concurrent policy integration (Issue #26)

PR #23 merged Issue #21 governance while this documentation PR was pending. Retained its Issue-first allocation, branch naming and PR linkage alongside the master-only rule. PR #24 initially failed to merge; its remote head was inadvertently removed by a dependent cleanup command, auto-closing the PR. The exact local head was immediately restored without losing commits. Reopen #24 only after reconciling master, revalidation and review. Future deletion is a separate action after an explicit MERGED readback.
