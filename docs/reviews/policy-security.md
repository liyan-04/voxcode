# Commit/PR policy: security and correctness review

Date: 2026-10-23. Reviewer: independent AI agent `policy_security_review`; implementation author: coordinator. This is an AI review report, not a human GitHub approval.

## Scope

Changes relative to `12d74c0`: policy checker/tests, commit hook, PR template/workflow, root dependency/lock and verification installation steps; related policy documentation. In-progress application files were excluded.

Reviewed final checker SHA-256: `4182fe86966ee31dd5a186de14b097c57ac3f76c5117b73c189be95999da5ed9`.
Reviewed final PR workflow SHA-256: `1295d5aed52754a2b9d94a3f2334347d6b92609088a324489ffdc8035faa15bc`.

## Findings and resolutions

| Priority | Finding | Resolution and evidence |
| --- | --- | --- |
| P2 | HTML-comment regex consumed later sections when inline/fenced code contained a literal `<!--` | Reproduced with failing tests; replaced regex parsing with pinned `marked@18.1.1` tokenization. Independent reproduction now accepts valid literal examples. |
| P2 | Sections containing only Markdown thematic breaks passed the content check | Added failing regressions for `---`, `***` and `_ _ _`; ignore structural Markdown tokens. Independent check rejects all four empty rendered sections. |
| P2 | Manual dispatch produced a successful policy job without checking PR metadata | Removed `workflow_dispatch` and conditional metadata skips from the PR-only workflow. |

No P0/P1 findings. Targeted rereview found no new issues; all three findings were resolved in the final snapshot.

## Verification

- Reviewer: `npm run test:policy`: 13 passed, 0 failed.
- Reviewer: independent assertions reproduced the original Markdown cases and confirmed their resolution.
- Reviewer: `npm ls marked --depth=0`: `marked@18.1.1`; `git diff --check`: clean.
- Coordinator: regression cycle before the parser change produced 11 passed / 2 failed, followed by 13 passed / 0 failed.
- Local hook is executable and `core.hooksPath` is `.githooks`.

## Residual limits

PR content is passed as JSON data with read-only token permissions; it is not interpolated into shell source. Parsing does not render HTML. The PR can change its own policy code/workflow, so policy changes still require human review. Status checks do not prove review independence or truthful validation claims. Remote Actions/branch protection were outside this review; this report certifies no application, live-service, device or outdoor acceptance.
