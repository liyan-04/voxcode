# VoxCode

iPhone voice control for Codex running on your Mac, with Linx AI (灵矽 AI) handling voice interaction.

Approved product direction: [手机演示版方案](docs/phone-demo-scope.zh-CN.md). The first demo runs inside the native VoxCode app; generated-site interactive preview and a full Mac workbench are deferred. Configurable concurrency, Linx voice, outdoor access, result inspection and reproducible benchmarks remain in scope. Deployment remains deferred until the user resumes it explicitly.

Status: initial native client, Mac bridge, remote relay and voice adapter implemented with local tests. The delivery target is the combined signed-iPhone plus public-relay-to-company-Mac Codex loop; device and outdoor verification remain pending, so this is not yet a delivered app. See the requirements audit for the exact gates.

## Local checks

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
npm test
```

Start the loopback Mac bridge with `VOXCODE_PROJECT=/absolute/git/project npm start`.
See apps/ios/README.md for native building/signing, apps/relay/README.md for the remote relay, and packages/voice/README.md for Linx credentials and protocol boundaries. Public plaintext transport is not supported by the native app.

GitHub Actions tests Node components and builds an unsigned iOS simulator app with full Xcode. A successful simulator build is development evidence only: it is not an installable signed iPhone package and it does not prove that the installed phone can reach the Mac through the public relay.

## Project records

- [Commit and PR rules](CONTRIBUTING.md)
- [Multi-agent ownership and handoffs](docs/agent-collaboration.md)
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
