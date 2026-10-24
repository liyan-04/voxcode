# 服务器到灵矽 MCP Proxy 实测

验证日期：2026-10-24。环境：个人服务器 vm6、Node.js 22、Codex CLI 0.162.1。

## 已通过的链路

```text
MCP 客户端 / 灵矽
  → HTTPS POST https://xrobo.qiniu.com/v1/mcpproxy/mcp
  → 灵矽 MCP Proxy
  → 服务器主动建立的 WSS 连接
  → 服务器 MCP 请求处理器
  → /usr/local/bin/codex --version
```

服务器主动连接 `wss://xrobo.qiniu.com/v1/mcpproxy/connect?token=<接入点Token>`。本次以 WSS 成功连接，不需要在 vm6 开放公网监听端口。

这里有两个传输方向：调用方使用 Streamable HTTP；服务器接入进程使用 WSS。二者通过同一个接入点 Token 关联。仅启动服务器自己的 `/mcp` HTTP 服务，不会自动注册到此代理。

## 接入凭证

使用灵矽 MCP 概览中“生成接入点Token”取得的 Token。本次用户提供的接入点 Token 有效；不能将另一个 `lx-` 凭证直接代替它。此前从错误入口的 `expired` 或 `no server available` 推断账号风控、签发故障或认证已通过，证据均不足。

凭证不写入 Git。常驻实现应从私有配置读取，禁止记录完整连接 URL。灵矽后台的 `X-MCP-Token` 必须与 WSS 接入点使用同一个 Token。

## 实际握手

1. 服务器 Node.js 使用内置 WebSocket 建立 WSS 连接。
2. 代理主动发送 `initialize`；服务器以相同请求 ID 返回 `protocolVersion: 2024-11-05`、`capabilities: {tools:{}}` 和 `serverInfo`。
3. 代理发送 `notifications/initialized`，服务器不回复通知。
4. 代理发送 `tools/list`，服务器返回一个工具 `codex_status`，参数 schema 为无参数 object。
5. 独立客户端向代理 HTTP 入口执行 `initialize`、`tools/list` 和 `tools/call`；认证头为 `X-MCP-Token`，Accept 为 `application/json, text/event-stream`。若返回 `Mcp-Session-Id`，后续请求继续携带。

`tools/list` HTTP 200 实际包含：

```json
{"tools":[{"name":"codex_status","description":"Query real Codex CLI version on vm6 server","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]}
```

`tools/call` 请求：

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"codex_status","arguments":{}}}
```

HTTP 200 的工具响应中 `content[0].text` 为以下 JSON 字符串：

```json
{"host":"vm6","version":"codex-cli 0.162.1","source":"live-server"}
```

工具通过 `execFileSync('/usr/local/bin/codex', ['--version'])` 在 vm6 获取真实版本，未执行模型任务，没有使用模拟适配器。

## 如何在后台使用

1. 先运行服务器 MCP 接入进程，保持 WSS 在线。
2. 灵矽“已开通MCP → 更新配置”保留 Streamable HTTP，URL 使用代理的 `https://xrobo.qiniu.com/v1/mcpproxy/mcp`。
3. 将 `X-MCP-Token` 设置为该 WSS 连接的接入点 Token，保存。
4. 打开“工具”，刷新工具列表，应发现服务器公布的工具。
5. 调试 `codex_status`，参数 `{}`，检查返回的真实服务器版本。
6. 若要智能体使用，还需在“智能体管理 → 配置角色 → MCP编辑”选择对应服务/工具，并另做智能体实际调用验证。

以上后台步骤是后续操作说明，不是本次已完成的后台验收。此次仅通过直接 HTTP 客户端验证代理工具发现与调用。

## 生命周期与剩余工作

本次为内存中的临时 Node.js 探针，设定三分钟退出上限；验证后主动终止并退出 SSH。未留下常驻进程、监听端口或探针源文件，也未修改灵矽后台配置。

因此当前不应宣称工具持续在线。正式集成需要提交可运行的 WSS 接入模块，加入断线重连、心跳、超时、输入校验、凭证脱敏和服务管理；与主线程 VoxCode 实现统一后再部署。

已证明：vm6 出站 WSS、代理初始化、工具发现、代理转发、真实 Codex 版本查询。

未证明：后台工具页展示/调试、智能体选择工具、Codex 模型执行任务、手机网页链路、重连恢复与持久运行。不得把版本查询等同于完整开发任务闭环。
