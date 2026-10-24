# 灵矽 AI 服务器接入指引

适用：VoxCode 原生 iPhone → VoxCode 服务器 → 灵矽 AI / 服务器本地 Codex。无需硬件开发板、服务器声卡或 C++ SDK。用户尚未准备测试智能体；**真实账号绑定与云端语音尚未验收**。

## 现在先做什么

你现在只需准备以下三项，完成后反馈“智能体已建、设备入口可用”即可。不要把密码、token、激活码或完整控制台截图发到聊天或仓库。

1. 登录官方文档给出的[灵矽 AI 控制台](https://xrobo.qiniu.com/)，在智能体管理中创建比赛专用测试智能体，建议命名 `VoxCode 开发助手`。选择账号实际可用、支持工具调用的模型和中文音色。名称是本项目建议，不是平台预置产品。
2. 按[智能体配置指引](https://linx.qiniu.com/docs/xrobot/guide/agent-config)设置角色和技能。需要工具调用时优先评估“统一意图识别”；“无意图识别”不用于我们的 MCP 验收。实际名称、模型和权限以账号页面为准。
3. 确认能在该智能体中添加设备、输入设备验证码；见[官方快速入门](https://linx.qiniu.com/docs/xrobot/guide/quick-start)。此时还没有验证码，下一节的软件设备工具会产生。若没有设备入口，向平台管理员申请软件测试设备权限，并确认官方 `xiaoling-web-test` 示例是否对当前账号开放。

网页体验可以先检查中文识别、角色回答和音色，但它不是 VoxCode 的软件设备，不能证明我们的工具、服务器或 iPhone 链路已通。官方说明“拨打”前会自动保存配置；使用独立比赛智能体，避免修改业务智能体。

## 接入方式与职责

```text
iPhone App
  ├─ WSS：双工音频、识别/草稿、实时任务事件（Issue62，待实现验收）
  └─ HTTPS：配对、任务快照、结果与持久操作
        ↓
VoxCode 服务器
  ├─ 官方 WSS：灵矽软件设备，ASR / 对话 / TTS / 端侧 MCP
  └─ 内部 stdio：Codex，实际修改 / 检查 / 同会话追问
```

手机与 VoxCode 的 WSS 是新增明确要求；当前已合并版本仍使用 HTTP 音频块和事件轮询，**尚不能声称手机双工 WSS 已交付**。该改造不改变下面的灵矽服务器配置。

服务器运行软件设备，所以协议名称仍是“端侧 MCP”：通过已认证的灵矽 WSS 收发 MCP initialize、tools/list、tools/call，不需要给灵矽云开放我们的 HTTP 回调。另一个“云端 MCP”是 SSE `GET /mcp` / `POST /mcp/message`，本项目当前不实现它；不要在控制台为本项目填一个尚未部署的 MCP URL。`X-Linx-Device-Id`、`X-Linx-Agent-Id`、`X-Linx-Session-Id` 只用于关联，不是用户鉴权。

| 负责人 | 操作 | 交接内容 |
| --- | --- | --- |
| 你 | 创建测试智能体、确认设备绑定入口、配置角色/模型/音色、在本人控制台输入验证码 | 只反馈就绪状态；不公开标识或密钥 |
| 工程协调者 / 服务器操作人 | 在授权服务器的专用普通账户初始化设备、交互激活、保存私有配置、启动与验证 | 脱敏阶段结果、版本和错误类别 |
| VoxCode 服务 | 校验手机会话、固定录音任务/版本、提供只读与草稿工具、执行用户确认的任务 | 实际状态、版本化证据和待确认草稿 |

## 服务器软件设备初始化与绑定

以下命令在**服务器源码仓库根目录、专用普通执行账户、私人交互终端**运行。服务器当前 SSH 管理登录是 root，不等于可以用 root 执行 Codex。账户/目录由操作人准备；命令不是账号创建或部署脚本。

示例 `/srv/voxcode-private` 必须事先存在、属于执行账户且权限0700，位于项目和源码仓库之外；替换为实际真实绝对路径。路径各级不使用符号链接。不要使用同步目录或临时容器文件系统保存长期设备身份。

```sh
# 离线：创建最后一级0700目录，持久保存随机软件MAC和UUID
node packages/voice/tools/onboard.mjs init --dir /srv/voxcode-private/linx
node packages/voice/tools/onboard.mjs status --dir /srv/voxcode-private/linx

# 用户已准备好智能体/设备入口后，再在私人交互终端发起实际网络请求
node packages/voice/tools/onboard.mjs activate --dir /srv/voxcode-private/linx --show-code
```

`init` 复用已有合法身份，不会每次换 Device-Id。正常输出仅包含 `initialized` / `unconfigured` / `pending` / `configured` 和布尔状态，不打印 token 或设备标识。

未绑定时 `activate --show-code` 可在交互 stderr 显示六位激活码；输入与错误输出都必须是 TTY，重定向或非交互运行会在请求前拒绝。不要通过录屏、日志、Issue 或本聊天转交激活码。在自己的控制台，将该验证码对应设备绑定到刚创建的智能体。然后在同一设备目录运行：

```sh
node packages/voice/tools/onboard.mjs activate --dir /srv/voxcode-private/linx
node packages/voice/tools/onboard.mjs status --dir /srv/voxcode-private/linx
```

成功后工具保存 `.env.linx`（0600）和固定 `identity.json`（0600），目录0700；已有运行配置会拒绝覆盖。`configured` 只证明配置存在且匹配本地身份，仍未证明 WSS 鉴权、语音或模型成功。不要删除身份来反复重试；token 轮换、解绑和换智能体需要平台确认的单独流程。

工具只访问官方固定 HTTPS OTA/activate，拒绝跳转、限制响应64KiB、每个请求10秒、无自动重试，不下载固件。HTTP200中的业务错误仍按失败处理。OTA若返回官方明文 WS 示例地址，保存时采用文档明确的 WSS 等价入口；其他主机不自行信任。工具不创建智能体、不操作控制台，也不保证当前账号有软件设备权限。

## 智能体角色与保存

将下面文本作为角色介绍的起点。必须保留两个占位符，服务器会通过 hello 的 `agent_params.custom_replace_prompt` 注入本次已授权、固定的任务上下文。提示词不能替代服务器鉴权与参数校验。

```text
你是 VoxCode 开发助手，通过简短中文帮助用户管理编程任务。
当前录音目标：{{voxcode_target}}
本次操作约束：{{voxcode_policy}}

先澄清会影响实现的一项关键歧义，再概括目标和验收条件。
查询进度或检查结果时使用实际工具；没有证据就说未验证，不编造百分比。
新任务使用 propose_task，当前任务追问使用 propose_followup，只生成待确认草稿。
需要用户查看某任务时可以 propose_focus；建议不会改变本次录音绑定目标。
执行、取消编程任务、操作授权和结果验收均须用户在手机界面明确操作。
不要索取密码或密钥，不调用任意shell/文件写入/越权工具。
一次先说一到三句；检查失败时说清失败项、证据版本和下一步建议。
```

现有六个工具：`list_tasks`、`get_task_status`、`get_task_evidence`、`propose_task`、`propose_followup`、`propose_focus`。前三者读取授权状态，后三者生成草稿或导航建议；没有代码执行、审批或结果验收工具。当前录音绑定任务后，切换手机页面不能重定向它；需要切换指令对象时结束旧录音，再在目标任务开始新录音。

按官方说明保存：模型/音色抽屉“确定”后还要保存整页；MCP配置窗口有自己的保存动作。**网页的云端 MCP 关联不等于服务器软件设备的端侧工具已发现。** 配置更改后关闭旧语音连接，再创建新连接，检查工具发现与实际调用。首次保留简单配置，不同时增加知识库、长期记忆和额外工具。

## 启动与私有配置

完整源码中的现行工具位于 `packages/voice/tools/`；现有 Relay 安装包只含 Relay/Connector，不包含这些工具或完整语音执行服务。服务器源码包在 Issue55单独评审，不能将它当成已部署环境。源码依赖按锁文件安装：

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
```

由操作人私下准备 `/srv/voxcode-private/runtime.env`（0600），父目录0700，内容采用以下**占位字段**，不复制示例为真实配置：

```dotenv
VOXCODE_PROJECT=/srv/authorized-test-project
VOXCODE_DATA=/srv/voxcode-private/state
VOXCODE_PORT=8787
VOXCODE_RELAY_URL=wss://100.100.81.209:9899/connector
VOXCODE_MACHINE_ID=existing-authorized-machine-id
VOXCODE_MACHINE_KEY=private-existing-machine-key
VOXCODE_TLS_CA=/srv/executor-config/reviewed-public-ca.pem
```

项目必须是已有 HEAD 的授权 Git checkout；状态独立于源码和项目。机器密钥与设备 token 不同，不得混用。Relay私钥由另一服务身份持有；同UID0600文件仍可被同UID任务读取，当前实现不声称完整文件隔离。

当前已合并的兼容入口，可加载两份私有文件：

```sh
node --env-file=/srv/voxcode-private/runtime.env \
  --env-file=/srv/voxcode-private/linx/.env.linx apps/integration/cli.mjs
```

这是旧开发入口，**会打印短期手机配对码，只能在私人终端使用，不接入服务日志**；后台部署应使用正在评审的显式安全服务器入口。两份文件不得有冲突字段。完整代码不在命令行携带 token，Node只读取指定私有文件。当前普通入口不代替 Issue55的非root/私有路径预检。

先核对9899现有进程归属，若无关或不明则停止并通知；不得为了联调占用、杀死或替换其他服务。已有授权 Relay 使用相同机器身份和严格TLS；Bridge仅监听127.0.0.1，不额外开放公网端口。配置存在和“服务启动成功”均不等于真实语音通过。

## 分阶段验收

| 阶段 | 最小验证 | 可接受证据 / 不能推断 |
| --- | --- | --- |
| 资源 | 智能体已建，设备入口可用，软件设备已绑定 | 本人私下核对；不要公开标识；不代表语音成功 |
| L1握手 | 真实配置创建会话，验证鉴权、hello与协商格式 | revision、环境、脱敏通过/失败；`voiceConfigured`只表示配置存在 |
| L2识别与草稿 | 输入合成测试语音“给示例页增加无数据提示”；返回STT/可编辑草稿，确认前任务数不变 | 人工核对含义；本地HTTP观察不能证明提供商身份 |
| L3工具 | A任务开始录音后切到B，查询/追问仍绑定A及原版本；对照实际状态和检查证据 | MCP发现/调用与实际结果；不能用网页聊天代替 |
| L4手机双工 | 同一签名iPhone构建通过WSS上行录音、同时接收事件/音频，打断立即停止播报 | 真实设备、WSS与可听记录；Issue62尚待实现，不能由HTTP轮询测试关闭 |
| L5开发与户外 | 用户确认后真实Codex修改/检查/续接；相同构建关闭Wi-Fi，经蜂窝+用户VPN连接服务器 | live/device/outdoor分别留证；断线重连无重复任务，旧录音不偷偷续传 |

服务器合成音频 smoke 见[具体指引](linx-smoke.md)。它只对已运行 Bridge 的回环HTTP做阶段观察，不测试手机WSS，不触发任务执行，不播放音频。退出0要求观察到握手、STT、草稿、音频和清理，因此“官方允许无输出元数据”的输入-only连接可能可用却不能通过完整语音smoke；不要为让脚本变绿虚构音频格式。

语音“停止播报/abort”与停止Codex任务不同；执行完成、操作授权、用户验收也不同。测试失败保留类别，不通过降低TLS校验、换requestId重复提交、自动重新激活或伪造进度解决。

## 常见问题

| 现象 | 下一步 |
| --- | --- |
| 无设备绑定入口 | 向平台管理员确认账号权限、软件测试设备和资源包；不要购买未确认型号开发板 |
| `pending`且没有验证码 | 仅在私人交互终端显式加`--show-code`；不要重定向输出 |
| 已有配置拒绝覆盖 | 用`status`，确认原身份；不要删除token/identity或重复注册 |
| `filesystem`/私有配置不安全 | 检查绝对真实路径、执行账户、0700目录/0600文件、符号链接和硬链接；不打印文件内容 |
| `configured`但WSS鉴权失败 | 确认绑定智能体/同一身份、资源权限和官方WSS；不把Codex API key当设备token |
| 能对话但不调用工具 | 检查工具调用模型、意图模式、保存与新连接、实际initialize/tools/list；控制台云端MCP不是本连接工具 |
| 有识别无播报 | 查看协商输出是否支持、Opus16/24k解码、手机音频路由；缺输出元数据时不猜格式 |
| 手机连不上 | 分别检查VPN路由、9899所有权、TLS/IP SAN/公开CA、配对状态；WSS新增路径也必须独立验证 |
| 429或网络超时 | 停止密集重试，按平台限制降频、单会话验证；不得因重试换录音归属或重复派发任务 |

## 官方依据与已有工程证据

本指引以官方源码 `qiniu/Xrobot-docs` 的 `20ce1b29a1bdff575a4c3317689bae30a7e08535`（2026-10-22）为准，2026-10-24重新核对当前main仍为该revision：

- [WebSocket](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/platform/websocket.md)、[OTA](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/platform/OTA.md)。
- [端侧MCP](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/mcp/hardware-mcp.md)、[云端MCP](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/mcp/software-mcp.md)、[第三方业务SSE](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/guide/third-app.md)。
- [智能体配置](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/guide/agent-config.md)、[快速入门/绑定](https://github.com/qiniu/Xrobot-docs/blob/20ce1b29a1bdff575a4c3317689bae30a7e08535/docs/xrobot/guide/quick-start.md)。

[PR59协议评审](../reviews/linx-current-protocol-2026-10-24.md)记录完整Node211/211、语音/集成50/50及两份独立审阅。这是macOS/Node26的受控fixture，不能替代Linux/Node22、真实提供商或手机验收。旧Issue27的26项证据保留在Git历史，不表示当前最新测试总数。

[Issue42工具评审](../reviews/linx-onboarding-2026-10-24.md)披露过一次早期测试因传输注入遗漏发出无效合成OTA请求，未建立真实身份绑定；后续加入默认禁止外网的测试保护。本次指引编写只读公开文档与本地源码，未操作账号、激活、上传语音或连接真实模型。iPhone签名安装与手机WSS仍是开放关口。
