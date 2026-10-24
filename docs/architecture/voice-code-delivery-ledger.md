# Issue #78 交付台账

日期：2026-10-24。只记录当前可复核状态；fixture、server-live、phone-live 分开。

## 已验证

| 链路/组件 | 证据 | 结论 |
| --- | --- | --- |
| vm6 → xrobo MCP Proxy | `docs/verification/server-linx-mcp-proxy-2026-10-24.md` | 服务器出站 WSS 的 initialize/tools/list/tools/call `codex_status` 已真实返回 vm6 `codex-cli 0.162.1`。Token 是接入点 Token；不是 `lx-` API 凭证。临时探针已退出。 |
| CLI worker #72 | Issue #72 本地 worker 源码 | 具 version probe、草稿/confirm、revision、部分 requestId 去重、进程组清理/quarantine；resume、真实 diff/check、独立 project/scope 仍缺。 |
| MCP worker #73 | Issue #73 本地 worker 源码 | dispatcher 与 xrobo WSS bridge 可复用；重连/限额/去重有 fixture；真实常驻任务闭环、可信 voice context 仍缺。 |
| Web worker #74 | Issue #74 本地 worker 源码 | login、health、列表/创建/详情/confirm/cancel、Cookie/Origin 有 fixture；页面原型仍是文字与旧轮询，本地源码已接 project registry/显式 projectId，生产语音 WSS、scope/results 未接入；新任务树/归档/软删正在实现。 |

## 未通过或未核验

- 手机浏览器 HTTPS/WSS 到服务器的真实设备链路。
- 服务端灵矽语音 SDK/WS 的认证、编码、STT/TTS、断线行为。
- xrobo WSS 常驻服务、心跳、重连、工具实际在灵矽智能体中被选用。
- Codex CLI 真实模型执行、续接、取消、项目隔离、结果 diff/check/preview。
- 项目 registry 已有本地注入接口；多项目真实执行、scope allowlist、context/capture 关联和跨入口持久幂等尚未真实验收。

## 分派与依赖

1. **CLI**：只改 adapter/store/tests。先保留现有 draft/confirm，补真实单任务、requestId/revision/Codex 事件和快照；resume 通过安装版本实测后再开放。
2. **MCP**：只改 dispatcher/xrobo bridge/tests。复用 TaskService；接入点 WSS 与浏览器语音 WSS 不混用；实现常驻心跳、重连、有界 inflight、协议错误和 context 关联。
3. **Web/voice**：只改 public UI、HTTP/WSS voice server/tests。HTTP 管理 API 和浏览器双工 WSS 分离；simulation 明确标识，production 未接入时禁用假入口。
4. **协调者**：拥有共享合同、TaskService/ProjectRegistry、CLI 入口、TLS/systemd、集成和 Git。任何公共字段变化先串行更新合同。

依赖顺序：合同与错误码 → CLI真实单任务 → MCP复用与常驻 → Web HTTP任务管理 → 浏览器↔VoxCode WSS与真实灵矽SDK → 结果快照/验收/微调 → 服务器部署与手机实测。各步先提交可重现探针，再扩大功能；每组件两份独立评审。

## 验收门槛

- WSS 浏览器：认证/Origin、session.start、capture.start、PCM 协商、backpressure、capture.stop、断线不重放。
- MCP：xrobo initialize/tools/list、只读 status、写请求明确授权；重连不重复执行。
- 任务：同一 task/context 的页面和语音操作串行；requestId 重放返回同一结果，异 payload/revision 409；cancel 与停止语音分离。
- 结果：真实 diff/check/日志固定为不可变 snapshot；accept 只记用户验收，不 merge/deploy。
- 真实标记：fixture 通过不能替代 server-live；server-live 不能替代 phone-live。未达门槛保持“待验证”。
