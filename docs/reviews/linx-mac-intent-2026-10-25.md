# Linx Mac intent adapter source review

Issue: #97, part of #93. Implementer: linx_audit. Independent reviewers: coordinator and mac_agent_probe. Scope: provider-neutral intent adapter, its tests and verification record. Reviewed adapter SHA-256: `a999bd4cc69f6cdf11cfb0f0e47486bb6e719ca91f328ab13452f5e108450f5b`.

Initial review rejected broad model mutation/approval/acceptance tools. The adapter now exposes six fixed query, selection and draft actions. Owner/device/project/task/context are frozen outside model arguments. Creating or following up a task returns a draft; phone confirmation needs an injected authenticated authorization function and never itself starts Codex, grants an approval or accepts a result.

Both reviews pass this source/fixture slice; no remaining actionable P0-P3 findings. Replay is owner scoped, concurrent requests deduplicate, expired drafts cannot confirm, pending entries cannot be evicted, cache/response limits are bounded and dependency errors are sanitized. The selection wrapper must authorize project/task membership; production context, request identity and deadlines remain integration responsibilities.

Coordinator verification: macOS arm64 / Node.js 26, `node --test apps/server/test/linx-intent-adapter.test.mjs apps/server/test/mcp-server.test.mjs` passed 22/22. Focused c8 measured 97.41% lines and 89.18% branches. `git diff --check` passed.

This does not establish live Linx ASR/TTS, MCP session correlation, Mac execution or phone acceptance. AI review is not human GitHub approval or user acceptance.
