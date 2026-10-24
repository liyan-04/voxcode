# VoxCode

iPhone voice control for Codex running on your Mac, with Linx AI (灵矽 AI) handling voice interaction.

Approved product direction: [手机演示版方案](docs/phone-demo-scope.zh-CN.md). The first demo runs inside the native VoxCode app; generated-site interactive preview and a full Mac workbench are deferred. Configurable concurrency, Linx voice, outdoor access, result inspection and reproducible benchmarks remain in scope. Relay deployment is authorized on the user’s designated personal server; it remains unverified. Check the target host and port before any deployment and preserve existing services.

Status: initial native client, Mac bridge, remote relay and voice adapter implemented with local tests. The delivery target is the combined signed-iPhone plus public-relay-to-company-Mac Codex loop; device and outdoor verification remain pending, so this is not yet a delivered app. See the requirements audit for the exact gates.

## Local checks

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
npm test
```

Start the loopback Mac bridge with `VOXCODE_PROJECT=/absolute/git/project npm start`.
See [iPhone build/signing](apps/ios/README.md), [Mac bridge](apps/mac/README.md), [Relay/Connector](apps/relay/README.md), [unified runtime](apps/integration/README.md) and [Linx protocol](packages/voice/README.md). Public plaintext transport is not supported by the native app.

GitHub Actions workflows are intentionally disabled because this repository's Actions billing quota is unavailable. Run the documented local Node/Swift checks in each worktree and record their exact results in the PR. A simulator build is development evidence only: it is not an installable signed iPhone package or a device test, and it does not prove that the installed phone can reach the Mac through the public relay.

## Project records

- [Commit and PR rules](CONTRIBUTING.md)
- [Multi-agent ownership and handoffs](docs/agent-collaboration.md)
- [Independent worktrees](docs/worktrees.md)
- [Milestones and separate PRs](docs/milestones.md)
- [Active implementation plan](docs/implementation-v1.md)
- [Design and boundaries](docs/design.md)
- [Shared interface contract](docs/contract.md)
- [Two-day delivery plan](docs/plan.md)
- [Decisions and optimization](docs/decisions.md)
- [Deep Linx AI integration](docs/linx-product-design.md)
- [Requirements audit and delivery gaps](docs/requirements-audit.md)
- [Competitor research](docs/research/competitors-mobile.md)
- [Progress and verification](docs/progress.md)
- [Review records](docs/reviews/README.md)

The deliverable is an authenticated controller and Mac execution service, not a replacement IDE. Existing active Codex Desktop conversations are outside the initial scope.

## Documentation and delivery ownership

The architect maintains this entry point, affected module READMEs and consistency with build/package/install/deploy scripts. Every milestone checks behavior, configuration names, commands and rollback together; developers update their allocated module docs, and the coordinator reviews the combined evidence before merging through a PR to master. Missing Xcode/signing, live Linx or outdoor evidence remains explicit.

Relay/Connector installation bundles both transport roles, not the Mac Codex bridge. Choose one Connector mode: configure all Relay fields on the unified runtime to start its built-in outbound Connector, or start the bridge without Relay fields and run the standalone installed Connector against it. Never start both for the same machine identity; Relay accepts one Connector. See [manual install instructions](apps/relay/packaging/README.md). Installation scripts refuse an existing prefix; select a new versioned prefix for an update, preserve the previous private configuration, stop only the owned process and switch after validation. A package existing on disk is not deployment evidence.
