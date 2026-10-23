# Commit/PR policy: collaboration and workflow review

Date: 2026-10-23. Reviewer: independent AI agent `policy_workflow_review`; implementation author: coordinator. This report is not a human GitHub approval.

## Scope and conclusion

Reviewed governance changes against `12d74c0`: AGENTS.md, CONTRIBUTING.md, docs/agent-collaboration.md, PR template/workflow, checker/tests, package/lock, README and verification workflow installation changes. No actionable process findings in the original review or targeted rereview.

The rules consistently require bounded path ownership, resumable handoffs, two reviewers independent of each component's implementation and targeted rereview after fixes. They distinguish simulation/local evidence from native installation, real Linx/Codex execution and outdoor acceptance. Deployment remains deferred. Hook/CI limits and the human review required for policy changes are described accurately.

## Reviewed snapshot

| File | SHA-256 |
| --- | --- |
| CONTRIBUTING.md | `b2cf0eefb24452df27bd727241fb954a55130ca49c7c4837e5d2ee733e672bc4` |
| docs/agent-collaboration.md | `fa71e091c5ada6b053897b4f0900f1a3ec65b14565bd88149f2f354e7c27ae36` |
| .github/workflows/pr-policy.yml | `1295d5aed52754a2b9d94a3f2334347d6b92609088a324489ffdc8035faa15bc` |
| .github/workflows/verify.yml | `5a9295f88211023bd33baff69e6a6333e70bb89305b761d35374feec195f8b2b` |
| scripts/check-pr-policy.mjs | `4182fe86966ee31dd5a186de14b097c57ac3f76c5117b73c189be95999da5ed9` |
| scripts/test/pr-policy.test.mjs | `c30e9a89c19b6074386fdec14af2588326a7919782ed84d6a8669446db02fa05` |

## Verification and follow-up

Reviewer independently ran `npm run test:policy`: 13 passed, 0 failed. The hook is executable. No repository files or Git state were modified by the reviewer.

The reviewer noted the old component review ledger was stale. The coordinator updated it to distinguish pending v1 reviews from historical reports and include relay/integration/preview gates. No current component approval is inferred from historical reports.

Remote Actions execution and repository protection were outside the review. Evidence quality, reviewer independence and deployment authority remain human/coordinator judgments; this report does not certify application, device or live acceptance.
