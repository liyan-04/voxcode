# 服务器执行架构与验收

日期：2026-10-24。主任务：[Issue53](https://github.com/liyan-04/voxcode/issues/53)。用户明确选择：原生 iPhone 只连接服务器，服务器连接灵矽 AI 并运行服务器上的 Codex；本轮不限制 AirPlay 协议。本文取代此前把公司 Mac 在线作为必需条件的部署解释，保留任务、语音、身份和结果验收约束。

## 产品定位与场景

用户在户外通过已安装的 iPhone App 推进服务器上已授权的开发项目，查看真实改动和检查，再验收当前版本。首版是一台服务器、一个预先准备的 Git 项目，不增加任意仓库选择、多租户、自动发布或生成网站预览。

三个演示场景：语音要求修复 API/CLI 的空白输入校验，确认草稿后查看 diff/回归并追问；四个独立任务执行、第五个排队，同时浏览至少20个任务；弱网恢复后对账原请求、处理操作授权、停止或验收当前版本。操作授权、执行完成、人工条件确认和结果验收分别展示，不能以模型文字替代测试结果或人工验收。

## 最小部署

```text
iPhone 原生 App（采集/播放音频、确认、任务与结果界面）
  │ HTTPS100.100.81.209:9899（户外需用户 VPN，严格证书校验）
  ▼
Relay（唯一外部入口，配对转发、限制路由、聚合监控）
  ▲ 同机 Connector：严格校验的 WSS，使用服务器私有机器凭据
  │
Bridge/任务与语音运行入口：127.0.0.1:8787
  ├─ 灵矽 AI 官方 WSS：ASR、对话、MCP 草稿/查询、TTS
  └─ 本机 Codex App Server stdio：隔离 Git worktree、检查、会话和结果
```

同机复用既有 Relay + integration runtime，不新增反向代理、公开 Codex WebSocket 或 API。需要两个常驻 Node 进程：Relay 和包含 Bridge/Connector/voice 的运行入口；每个活跃 Codex turn 另有受管理的子进程组。目录名 `apps/mac` 为现有执行模块名称，首轮不为命名迁移扩大改动。iOS API、配对、任务和音频合同不变，首版无需增加 Mac/Server 模式选择。

9899 已有进程必须先核对所有权；无关服务占用则停止并通知，不替换。现有连接器不可与新 runtime 以同一机器身份并行运行。Connector 的同机 WSS 仍必须满足路由和 IP SAN/CA 校验；不能因公网回流失败改用不安全 TLS 或向 HTTPS listener 发送明文。入口与证书背景见 [Issue48](https://github.com/liyan-04/voxcode/issues/48)，其中公司 Mac 强制执行路径由本决策替代，VPN 与严格 TLS 要求保留。

## 灵矽现行协议

依据 [官方文档中心](https://linx.qiniu.com/docs/)及源码 `qiniu/Xrobot-docs` 的固定版本 `20ce1b29a1bdff575a4c3317689bae30a7e08535`，提交时间2026-10-22T09:53:35Z。旧 C++ 客户端作为参考，不作为协议版本依据，也不引入服务器声卡依赖。

本轮选择[WebSocket 协议](https://linx.qiniu.com/docs/xrobot/platform/websocket) + [端侧 MCP](https://linx.qiniu.com/docs/xrobot/mcp/hardware-mcp)：服务器充当软件设备，通过同一条出站 WSS 接收 MCP 查询/草稿调用。这里的“端侧”指协议角色，软件实际运行在服务器，不是手机。手机上不保存灵矽或 Codex 凭据，不连接灵矽，也不需要 Swift/iOS 灵矽 SDK。

手机录音转为16kHz单声道 PCM16，经受认证 API 上传；服务器发给灵矽，返回识别文字和待确认草稿。服务器把协商的16/24kHz Opus TTS解码为有界 PCM，手机播放。无服务器麦克风、扬声器或 ALSA 要求。语音会话固定手机 owner、taskId/version/requestId；MCP 查询和草稿受该上下文限制，不能自动创建执行、授权操作或验收。

[云端 MCP](https://linx.qiniu.com/docs/xrobot/mcp/software-mcp)使用 `GET /mcp` SSE 和 `POST /mcp/message`，是独立接入方式，当前 WS 工具不能称为已接入云端 SSE MCP。新文档中的 `X-Linx-Device-Id`、`X-Linx-Agent-Id`、`X-Linx-Session-Id` 是云端 HTTP 关联标识，不是用户授权。若以后实现云端入口，需要独立服务认证、已配对 owner 的精确会话映射、到期/撤销/重放隔离；不能直接信任请求头或模型传参。

[第三方业务接入](https://linx.qiniu.com/docs/xrobot/guide/third-app)让灵矽 ASR/TTS 调用业务 SSE，适合由业务服务接管文字回复；本轮不与 WS+MCP 叠加，以免增加回调入口和重复业务路由。VPN 私网地址能被手机访问，不代表灵矽云能回调。按[智能体配置](https://linx.qiniu.com/docs/xrobot/guide/agent-config)准备测试智能体、音色和软件设备绑定后再做真实验证。

## 运行与凭据边界

授权项目、依赖、检查命令和产物都在服务器；未迁移的 Mac 文件、私有依赖或内网资源不可用，Linux 也不能承担 Xcode/macOS 构建。iPhone App 的编译签名仍在 Mac/Xcode 完成。VoxCode 控制自己创建的 Codex 会话，不接管已有 Desktop 聊天。

部署执行任务的 runtime 使用专用非 root 账户，只处理已授权测试项目。Relay TLS 私钥和机器配置由独立账户保护。现有环境过滤只减少子进程环境泄露，`workspace-write` 不是完整读取隔离，同 UID 可读的私有文件仍有风险；不能宣称多租户安全沙箱。若要求阻止任务读取同账户的灵矽凭据，需要进一步分离语音服务/执行身份或容器边界，不能靠权限0600代替不同身份隔离。用户当前 SSH root 仅证明管理入口，不是部署 Codex 任务的运行账户选择。

项目隔离、持久线程、原请求重放、停止确认、未知执行隔离、版本证据和手动验收不变。默认4名额、可配置1–8、至少20任务、每任务最多一个活跃 turn；等待授权和停止中保留名额。四路真实性能、CPU/内存/磁盘容量由实际测量决定。

## 评估与简单验证

架构师 `/root/server_architect` 和产品经理 `/root/product_manager` 独立评估后均建议该方向。架构师明确同机复用优先于新增 Bridge TLS/代理；产品经理确认场景、结果和多任务要求保持，删除公司 Mac 必须在线的产品前提。

源码 `3828d32`，macOS arm64、Node26：定向49/49测试通过，包括实际 Git worktree、受控 stdio子进程与后代停止、请求去重、线程续接、TLS正负检查和无音频设备 Opus 解码。协调者复跑临时串联验证8/8通过：真实本地 HTTP/WS Relay→Connector→Bridge，现有Node灵矽适配器使用受控提供商协议，实际受控Codex stdio子进程在Git worktree生成diff；草稿不执行、明确提交才执行、重放一次、原线程追问、abort/delete。它是 `local/fixture` 证据，合成串联自身未启用TLS，TLS是独立测试；没有真实模型或云端调用。

用户运行只读预检报告 vm6：Linux x86_64、Node22.23.4、npm10.9.9、Git2.43.0、Codex0.162.1，约32GB内存及241GB可用磁盘，9899有Node进程、8787无监听；有Codex config.toml，所查auth.json/灵矽配置不存在。该结果为用户提供的实机证据，没有认证可用或模型调用成功结论。协调者 SSH 预检被审批服务401拒绝，未执行，不能称为登录失败或已验证服务器。

结论：有足够本地正向证据开始限定源码/文档改造；Linux实机、真实提供商、签名设备和户外关口继续开放。

## 验收顺序

1. 源码：服务器预检/启动/源码包、iOS服务器入口与文案、最新灵矽协议/会话约束分别通过本地回归、覆盖率和两名独立评审，经PR合入master。普通账号运行与同账户凭据风险有明确说明。
2. Linux：核对已部署9899所有权/证书、普通执行账户和授权项目。严格WSS接通同机Connector，运行Linux回归及真实Codex两轮文件修改/检查/同线程追问；验证取消、后代回收和恢复隔离。未通过前不宣布服务器就绪。
3. 灵矽：私有配置完成智能体/软件设备绑定，真实WSS握手、ASR、受限MCP查询/草稿、Opus/PCM和abort。配置存在不算真实语音成功。
4. iPhone：完整Xcode、普通AppleID Personal Team签名，实际安装打开，验证麦克风/播放与严格TLS。模拟器、XcodeGen和本地测试不是安装包。见[首次安装](../verification/ios-personal-team.md)。
5. 同一签名构建：关闭Wi-Fi、蜂窝+用户VPN，完成真实语音→确认→服务器Codex修改→diff/命令退出码→同线程追问→当前版本人工验收；并验证20任务、四路第五排队、十次混合目标、弱网原请求对账、授权和停止。验收不等于Git合并或部署。

## 实施分工

| Issue | 主责与独占修改 | 交付 |
|---|---|---|
| [53](https://github.com/liyan-04/voxcode/issues/53) | 协调者，共享架构/产品/根README与进展 | 决策、验证记录、跨模块一致性 |
| [55](https://github.com/liyan-04/voxcode/issues/55) | 服务器开发，`apps/server/**`及新源码打包脚本/测试 | 非root预检、复用启动、源码包与运行/回滚说明 |
| [56](https://github.com/liyan-04/voxcode/issues/56) | iOS开发，`apps/ios/**` | vm6固定IP信任/默认地址/服务器语义及原生回归 |
| [57](https://github.com/liyan-04/voxcode/issues/57) | 语音开发，`packages/voice/**`及语音integration文件/测试 | 固定最新协议、会话隔离、可重复无声卡串联验证 |
| [52](https://github.com/liyan-04/voxcode/issues/52) | 协调者与用户账号/设备操作 | 签名安装和设备证据 |

开发者独立worktree、不执行Git变更；协调者串行提交/PR/双评审/合并。遇到429降低频率并恢复原agent，不丢弃工作。
