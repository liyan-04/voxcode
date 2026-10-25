# Browser Voice Backend Reviews

Refs #108. Source base: `1728a4ee9872719b551f4de1667cdd6e115fa840`.
Implementer: linx_audit. Independent reviewers: coordinator and mac_agent_probe.
These are AI source reviews, not human approval or phone acceptance.

## Coordinator review

Reviewed authenticated admission, exact upgrade routing, fixed Mac/project/task
context, private configuration, bounded audio and asynchronous cleanup. Initial
findings about fixed-owner admission, stop-tail abort and quota notices were
resolved with regression coverage. The final source has no actionable findings.
The full backend and SDK suite passed 215/215 on macOS arm64, Node 26.

## Independent Mac/platform review

mac_agent_probe independently inspected the frozen source and ran 97/97 focused
tests: voice transport/provider/runtime/config/HTTP, SDK session/audio, and Agent
authorization/capacity. No actionable findings. The reviewer confirmed that
transcription cannot create, confirm or cancel a Mac task, and that the Agent
and voice paths retain separate authentication and resource bounds.

Reviewed production SHA256 values:

```text
485bf492b13df7edc8f75ef91f5baf6e2a1173060e35a79a80af7e8c9af7e5eb  apps/server/voice-transport.mjs
14fcbe73b97060bd0ad09f6b967dba01d9b87db6e9cb3af99a76efb8ab21b71f  apps/server/voice-provider.mjs
38798291b17b947ff7a747c79f0929c145048fc0ebb869e0391dcece691fc9cd  apps/server/control-runtime.mjs
c6417ba63f1ced42591cd00fc4e67cf379f4fdafef321ef2d6d6f881bdaeb11d  apps/server/device-websocket.mjs
a801d5668a83afd905a17a5c63d473b5ba5b9f631e8691eebd7e694ae31754c8  apps/server/control-config.mjs
741c667126f38f00901191b2c2174e0658b19db440dcd661531ad355f98db755  apps/server/http-server.mjs
```

## Deployment gates

The release archive must contain `packages/voice` source and locked dependencies,
with a separate pinned install. The older server archive allowlist is insufficient.
Use a dedicated assistant/device without cloud MCP tools. Synthetic live ASR after
recharge succeeded separately; that does not prove this backend's deployed WSS,
browser microphone, phone/Safari, or voice-to-confirmed-Mac execution. Those checks
remain deployment and device gates under #108.
