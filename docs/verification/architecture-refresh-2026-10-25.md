# 架构状态刷新（2026-10-25）

本记录对应 Issue [#154](https://github.com/liyan-04/voxcode/issues/154)，只整理源码、部署和工作区证据，不执行服务变更。

## 已合入与线上证据

- `origin/master` 当前为 `1cbe77f`。
- PR [#147](https://github.com/liyan-04/voxcode/pull/147) 的语音 MCP 源码已合入；正式网关应用 revision 为 `b8535e65489c1a84d948d1b3ae73ed8948f54f80`。
- PR [#151](https://github.com/liyan-04/voxcode/pull/151) 的生命周期控制器已合入，正式控制器 revision 为 `8f0f42e6dcd485a3b99d5b0394a096ecd03b745a`。
- 已部署检查证明严格 TLS、原密码登录、Mac 项目读取、登录不依赖 Mac Agent，以及服务器目标在未配置时返回 503；Mac 未因网关更新而重启。
- 真实合成语音 capture 完成了 STT/TTS，但记录中没有 `tool.started` 或 `tool.result`，因此没有证明 Linx 调用 Codex。

## 当前实施中的独立能力

| Issue | 工作区状态 | 当前证据 | 尚未证明 |
| --- | --- | --- | --- |
| #144 原生 Codex 同步 | 未合入，独立只读适配器 | 12 项 focused fixture 通过；保留 native projectId、thread/session、空项目和分页历史 | 页面还未接入原生 inventory/history，不能声称与桌面实时同步 |
| #153 语音连续交互与进度 | 未合入，正在修改 voice progress 事件 | 目标是 admission 后立即返回真实 taskId，再由页面查询详情 | 连续 realtime、打断、真实 Linx tools/call 和手机验收 |
| #134 Server Codex | 未合入，正在实现独立执行器 | 只读盘点确认没有服务器 task service、专用账号、socket；服务器目标保持不可用 | 非 root Codex 认证、私有 RPC、真实服务器任务和正式部署 |

## 边界

架构图中的服务器执行、原生桌面桥接和连续双工语音均为目标或独立工作区能力，不能从目标连线推导为已上线。fixture/local 证据不能替代 live/device 证据；已合入不能替代部署；部署不能替代用户验收。
