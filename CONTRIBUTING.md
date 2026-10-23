# Contributions

Use `type(scope): summary` for focused commits:

| Type | Use |
| --- | --- |
| feat | New user-visible capability |
| fix | Correct incorrect behavior |
| docs | Design, decisions, instructions or review records |
| test | Verification coverage |
| refactor | Structural change without behavioral change |
| perf | Measured performance improvement |
| chore | Tooling and dependency maintenance |
| ci | Automated checks |

Scopes: client, mac, voice, protocol, security, repo.

Before a commit, run relevant tests, inspect the staged diff for secrets and unrelated changes, and update the progress record. A PR describes behavior, validation and unresolved limitations. Do not claim hardware, browser, Codex or Linx integration was tested unless it was actually exercised.

Each component receives independent correctness/security and platform/usability reviews. Findings include severity, evidence, resolution and remaining verification. Reviewers must not approve their own implementation.
