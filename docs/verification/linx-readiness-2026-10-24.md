# 灵矽 AI 接入与验证记录（Issue #27）

## 当前结论

**尚未完成真实灵矽云服务联调。** 用户确认尚未准备测试智能体/绑定设备/凭据，需要接入指引。当前 shell 中 `LINX_TOKEN`、`LINX_DEVICE_ID`、`LINX_CLIENT_ID` 仅检查是否存在，均为 false；未读取或输出密钥。不能据此判断其他私有位置是否有配置。

2026-10-24，协调者在 master 已合并实现的隔离工作区运行：

```sh
node --test packages/voice/test/*.test.js apps/integration/test/*.test.mjs
```

26 passed、0 failed、0 skipped；Node v26.0.0，macOS arm64，源码基线 `3b851f1`（随后文档合并没有修改语音源码）。证据类别为 fixture/local，测试使用受控传输/服务，不连接灵矽云。覆盖：握手头/hello、PCM 输入生命周期、真实 Opus 包的本地编解码、MCP 工具和重复请求、冻结目标/版本、草稿显式确认、撤销权限/关闭后失效、播报中止和有界事件保留。真实 codec 是本地音频算法证据，不能代表云端音频正确或手机可听见。

未验证：真实设备激活及鉴权、真实 STT、云端 MCP 协商和工具选择、语音生成草稿、真实 TTS、iPhone 麦克风/扬声器、公网蜂窝链路。当前 `xcode-select -p` 指向 CommandLineTools，不能声称已编译或安装真机 App。

## 不需要新增硬件的接入路径

Mac 进程作为灵矽的软件设备，负责云端 WSS 和协议适配；手机负责录音、确认草稿和播放。官方 OTA 文档允许 MAC 或硬件 ID 生成的伪 MAC，并提供 `xiaoling-web-test` 示例。VoxCode 语音适配器已支持该设备协议，但**自动 OTA 注册/激活尚未实现**，需要先按平台流程完成软件测试设备绑定。软件设备是否对当前账号开放、可用 board 类型和资源额度，以平台实际返回和账号权限为准，不能把文档示例当成已开通。

1. 在[灵矽 AI](https://linx.qiniu.com/)登录后创建一个比赛专用测试智能体，选择可用的模型、中文音色，使用平台支持的设备接入/MCP 配置。控制台页面名称可能变化；若无设备入口，需要平台管理员开通测试设备权限。
2. 为这个 Mac 软件设备保存固定 Device-Id（符合 MAC 格式）和 Client-Id（UUID）。已有设备使用已绑定标识；不要每次启动生成新身份，不要用任意 API Key 替代设备 token。
3. 按[官方 OTA 协议](https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/OTA.md)对 `https://xrobo.qiniuapi.com/v1/ota/` 上报。权威源码见下方来源：头包含 Activation-Version、Device-Id、Client-Id、User-Agent；正文包含 application/version/elf_sha256、mac_address、board。Device-Id 必须与 mac_address 一致。软件设备使用官方 web-test 示例结构，必要时向平台确认 board.type。不要下载或执行 OTA 返回的固件。
4. 未绑定时会返回 activation.code；在本人控制台完成激活码与测试智能体绑定。激活码、标识和完整响应不贴入 Issue/聊天/录屏。
5. 官方 `POST /v1/ota/activate` 可检查激活：200 文本 success 代表已绑定；202 为空代表未绑定。检查成功后重新调用 OTA，取得 websocket.url 和 websocket.token。**HTTP200 JSON error 仍可能是业务失败**，不能只看 HTTP 状态。
6. 使用官方推荐 WSS。若 OTA 示例返回 WS，不直接把设备 token 发到明文地址；当前官方明确提供 `wss://xrobo-io.qiniuapi.com/v1/ws/`。其他主机/地址变化需平台确认支持的 WSS 端点。

控制台创建/绑定尚未实际执行，上述步骤依据公开协议编写，不能算账号联调通过。

## 谁来完成接入（可执行交接）

**你现在只需完成：**在本人灵矽 AI 账号创建比赛测试智能体，确认账号能进入设备绑定/激活入口，然后告诉工程协调者“智能体已建、设备入口可用”。不要发送登录密码、token 或完整控制台截图。若没有入口，向平台管理员申请软件测试设备接入权限，反馈是否开通即可。这是用户资源准备完成的检查点，不要求你自行拼写 OTA 请求。

**工程协调者负责下一段：**在 Mac 私有目录生成并持久化软件 Device-Id/UUID，按上述官方 web-test 请求完成首次 OTA、只在本机显示激活码，等你在本人控制台绑定，再重新取得 token 并保存 `.env.linx`。该步骤尚未实现/执行，需单独可评审的激活辅助工具切片；当前指引不冒充一键接入。设备身份、token 与私有配置均不写入 Issue。

**配置完成后的支持动作：**保持工程协调者会话，由协调者使用真实协议 smoke 客户端做 L1–L3；目前该客户端尚待实现。用户无需寻找不存在的 CLI 或把 configured 当成成功。下方启动命令只启动服务，不自动开始录音。真机 App 就绪后，由用户在 App 关闭模拟演练、配对测试 Mac、打开新任务录音，才是现有录音入口；签名安装尚未具备时不会用该入口证明通过。

## Mac 私有配置与启动

在本机私有编辑器创建仓库根目录的 `.env.linx`，设置权限 `chmod 600 .env.linx`。此文件被 `.env.*` 忽略规则覆盖；提交前仍检查 `git status`，不要使用批量暂存。值在本机填写，以下只有占位说明：

```dotenv
LINX_WS_URL=wss://xrobo-io.qiniuapi.com/v1/ws/
LINX_TOKEN=<已绑定设备的 websocket.token>
LINX_DEVICE_ID=<同一已绑定 Device-Id>
LINX_CLIENT_ID=<同一持久 UUID>
```

在该智能体的系统提示词中加入 `{{voxcode_target}}` 和 `{{voxcode_policy}}`，使已有 hello.agent_params.custom_replace_prompt 能替换上下文。建议角色说明：只使用工具读实际任务；需求生成 propose_task/propose_followup 草稿；切任务仅 propose_focus 建议；执行、操作授权和验收必须由手机用户确认；没有测试证据就说明未验证。不要注册 shell/文件写入/任意执行类工具。

安装锁定依赖后，使用 Node 的环境文件加载，不把 token 放入命令行参数或 shell history：

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
VOXCODE_PROJECT=/absolute/path/to/authorized-test-project node --env-file=.env.linx apps/integration/cli.mjs
```

配置三个凭据必须全有或全无；启动显示 configured 仅代表配置存在。VOXCODE_PROJECT 使用授权的临时测试 Git 项目。默认桥接仅监听 Mac loopback；公网还需要已验证的 Relay/Connector 与配对 TLS。手机端模拟模式不连接语音，不能用于此项真实验收。手机不保存灵矽 token。

## 真实验收顺序

| 关口 | 操作与应见结果 | 通过证据 |
| --- | --- | --- |
| L1 真实握手 | 用真实绑定配置启动并建立语音会话，验证服务端 hello 与输出格式；鉴权失败明确报错 | 记录 revision、时间、脱敏成功/失败类别；不记录 token/标识 |
| L2 STT 与草稿 | 说“创建任务：给示例页面增加空状态，验收条件是无数据时显示提示”；应返回识别文本和可编辑草稿，确认前任务数不变 | 本地人工核对识别文本、冻结目标/版本、草稿；公开证据仅使用合成测试内容 |
| L3 工具与真实状态 | 任务 A 录音后切到 B，查询/追问仍绑定 A；陈述已有检查结果而非编造完成 | 实际状态对照、MCP 工具协商及草稿事件；只记脱敏事件类别 |
| L4 播报与中止 | 收到真实云端 Opus，桥接转换 PCM，手机可听；中止后停止播报且 Codex 不被取消 | 同一构建的 device 记录；本地 codec 通过不能代替 |
| L5 失效和公网 | 撤销/过期后无工具/音频泄露；同一签名 App 在蜂窝网络经 Relay 控制 Mac | live/device/outdoor 各自留证，关联构建与脱敏请求身份 |

L1–L3 可先在本机真实协议客户端验证；本仓库目前没有独立的真实语音 smoke CLI，不能声称上述启动命令本身会自动完成 L1–L3。L4/L5 需要可安装的签名原生 App。公开证据仅保留通过条件、数量和错误类别；原始录音、STT、音频及任务内容保存在授权本机，不提交。

## 下一步与监控口径

用户先完成测试智能体和设备绑定；工程侧继续手机监控与真实语音 smoke 工具的独立切片。监控只显示 voiceConfigured，不显示“灵矽正常”或伪造识别成功率。未来实际埋点后再增加连接成功/失败、握手耗时、首个 STT/草稿/音频延迟、中止耗时；需区分配置、真实会话和设备听感。

## 公开来源（2026-10-24 重新读取）

- [设备 WebSocket 协议源码](https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/websocket.md)：WSS、设备绑定要求、请求头、PCM、MCP、提示词占位和 Opus 输出。
- [OTA 协议源码](https://github.com/qiniu/Xrobot-docs/blob/main/docs/xrobot/platform/OTA.md)：伪 MAC、软件 web-test 示例、激活码、绑定后 token、快速激活检查。
- [本地适配器说明](../../packages/voice/README.md)、[集成入口](../../apps/integration/README.md)。

此次未调用真实 OTA 注册接口、创建云资源或发送录音；GitHub tree API 返回403，但上述两份 raw 文档读取成功。
