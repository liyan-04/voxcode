# Issue #78：语音 Code Agent 工作区合同

日期：2026-10-24。定位：手机浏览器中的语音开发工作区，服务器运行 VoxCode 与 Codex CLI。本文定义下一阶段合同，不宣称下列接口已经实现。产品交互配套见 `docs/product/voice-code-workspace.md`。

## 当前边界与证据

```text
手机浏览器 ── HTTPS + WSS ── VoxCode（页面、HTTP API、双工语音会话）
                                │
语音 ── 服务端灵矽会话 ── 灵矽选择 MCP 工具
                                │
                  xrobo HTTP MCP Proxy
                                │ 已注册的服务器出站 WSS
                         MCP dispatcher
                                │
页面 HTTP API ───────────── TaskService
                                │
                       Codex CLI adapter
                                │
                    预配置服务器项目工作区
```

页面操作经 HTTP 调用服务端 CLI 业务 API；语音由灵矽理解并调用 MCP。两入口必须共享同一 TaskService、任务库、权限、版本与证据，不复制调度或各自启动 CLI。Mac、Relay/Connector、原生 iOS、App Server 均非此主链路依赖。master 中仍描述原生手机及 App Server 的旧架构是历史实现，不能作为本合同的新边界。

已入库的真实证据：vm6 的出站 WSS → xrobo initialize/tools/list → codex_status → Codex CLI 0.162.1 成功。平台 HTTP MCP 与服务器 WSS 是代理两端；无需在 vm6 暴露公网 HTTP 端口才能注册 MCP。接入点 Token 与 `lx-` API 凭证不是可互换凭证。探针已退出，不能据此声称常驻在线或完整模型任务已通过。详见 `docs/verification/server-linx-mcp-proxy-2026-10-24.md`。

## 当前三个 worker 的实际接口

源代码只读检查路径：Issue #72、#73、#74 的独立 worker 工作区（仓库内目标均为 apps/server）。本记录没有重跑其测试。

- CLI：startTask 建 draft，confirmTask 单槽启动 `codex exec --json --sandbox workspace-write -`；具 revision、部分 requestId 去重、CLI version probe、进程组清理与 quarantine。continueTask 明确禁用，diff/checks 返回未采集。当前固定单项目 root，不等于多任务工作区隔离。
- MCP：已抽取 createMcpDispatcher，HTTP 与 xrobo WSS bridge 可复用 dispatch。业务写工具授权及固定单项目接口仍需与新语音定位统一。
- HTTP：login、health、list/create/get/confirm/cancel；创建传 requestId，confirm 传 revision/requestId。最新 #74 本地源码已接入注入式 project registry、显式 projectId 列表/创建与任务归属校验。语音 context、结果快照或 preview 尚未交付。

首批保持当前 draft→手机 confirm 的执行边界。普通明确开发直达是后续产品目标，只有可信意图、项目范围、语音会话关联、权限、幂等与版本约束均验证后才能独立启用；不能先去掉确认或仅改工具描述。

## 统一任务域及项目注册

ProjectRegistry 由运维预配置 `{id,name,canonicalRepoRoot,allowedBaseRefs,checkProfiles,previewProfile?,enabled,scopes}`。Scope 定义为 `{id,name,pathAllowlist,checkProfileIds,previewProfileId?,enabled}`，例如同一仓库的前端、后端或包；不是另一个任意仓库、独立 Git worktree 或 shell 工作目录。API 只接收 opaque projectId/scopeId，不能接收路径、任意命令或任意预览端口。项目根 realpath 和 Git root 在启动时校验；scope 相对路径拒绝 `..`、绝对路径及指向仓库外的符号链接，网页和 MCP 同样经过 registry 及访问权限校验。

范围授权与模型提示是两层：scope allowlist 必须在执行环境及产物采集层验证，不能仅把“只改前端目录”写进 prompt 就宣称隔离。检测到 allowlist 外改动时结果标为 blocked/out_of_scope，禁止发布为正常完成；在具备执行层写入限制前，仅开放整个已授权 repo scope，不声称细粒度文件写权限已受控。

TaskService 是唯一入口：`submitInstruction(context, mutation)`、`getTask(context)`、`listTasks(projectId)`、`cancelTurn(context, mutation)`、`decideApproval(context, mutation)`、`getResult(context)`、`acceptResult(context, mutation)`。CLI adapter 仅处理受控执行、事件、取消、会话恢复；不负责浏览器认证或 MCP 来源判断。

任务字段最小集：`{id,ownerId,projectId,scopeId,title,revision,status,currentTurnId,sessionId?,latestResultId?,criteria,createdAt,updatedAt}`。Turn 保存 `{id,taskId,source:http|voice,requestId,input,status,baseCommit,worktreeId,baseSnapshotId?,selectedFileIds?,startedAt?,finishedAt?}`。每 task 至多一个活动 turn；不同任务独立 worktree。首批维持单执行槽，额外并发后置，不能并发修改同一 root。即便前端/后端 scope 路径不重叠，也可能共享依赖、构建配置及 Git 基线；最简策略是同一 canonicalRepoRoot 只允许一个可写 turn，其他任务排队。只读查询不持有写锁。cancelling、approval_required 及清理未确认继续持有锁；进程清理与证据快照完成后释放，不以 UI 退出为释放依据。

状态分开表达：任务执行 `queued/running/cancelling/completed/failed/interrupted`；交互等待 `clarification_required/approval_required`；结果验收 `pending/accepted/changes_requested`。cancelled 不表示文件回滚；completed 不表示测试通过或用户已验收。任务运行中只读查询立即响应，后续开发补充进入同一任务的有界消息队列，不并发启动第二个 turn。

## 两入口的目标锁定与语音会话

统一 Context 为 `{projectId,scopeId,taskId:null|string,turnId:null|string,contextVersion}`。ownerId 来自已认证服务器会话，不能由模型或客户端声明。用户切项目、子项目范围或任务只改变当前页面 selection；已录音、已提交和正在运行的操作目标不可迁移。

语音会话保存服务器可信映射 `{voiceSessionId,ownerSessionId,context,captureId,state,expiresAt}`。网页与 VoxCode 之间使用一个经过认证的 WSS 双工通道承载音频帧和有界事件；不能用旧的 HTTP 音频块上传/事件轮询作为新合同。录音开始时创建 captureId 并冻结 context；所有音频、转写、灵矽对话和 MCP mutation 归属该 capture。录音中切换目标需先停止并对账，再为新目标建 capture。旧语音结果只能显示在旧目标，不得自动作为新目标输入。

VoxCode 与灵矽 SDK/WS 是独立的服务端语音链路；VoxCode 与 xrobo mcpproxy 的 JSON-RPC WSS 也是独立链路。前者负责语音会话、识别/播报和服务端凭据，后者负责 MCP initialize/tools/list/call；二者通过服务器 TaskService 的 capture/context 映射衔接，不能把语音帧当作 MCP JSON，也不能把 xrobo WSS 当作浏览器音频通道。

最小 WSS 消息合同（浏览器↔VoxCode）：客户端先发送 `{type:"session.start",requestId,context}`，服务端以 `{type:"session.ready",voiceSessionId,contextVersion,captureId:null}` 响应；录音发送 `{type:"capture.start",requestId,captureId,contextVersion,format:{codec:"pcm_s16le",sampleRate:16000,channels:1,frameMs:20}}`，随后发送二进制 PCM 帧；服务端返回有界 `{type:"stt.partial|stt.final|assistant.event|task.event|error",captureId,seq,...}` 事件；停止发送 `{type:"capture.stop",requestId,captureId}`，服务端先确认 `{type:"capture.stopped",captureId,lastSeq}`。实际 codec/采样率必须以灵矽 SDK 协商结果为准，协商不成功就拒绝录音，不猜测。

音频帧必须带有序号或由单连接严格排序；服务端限制帧大小、单 capture 时长、总缓冲和事件队列，达到上限返回 backpressure 并停止接收该 capture。客户端在收到 backpressure 时停止发送并显示原因，不重排或无限缓存。语音关闭/停止录音只结束 capture、识别和播报；取消 Codex turn 使用独立 HTTP/MCP mutation。网络断线后不自动重放 PCM、转写或工具调用；客户端重新建立 session 后只从事件游标对账任务状态。

MCP 使用平台已验证的会话标识或每会话受控路由从服务器映射取得 context。模型提供的 taskId/projectId 必须与冻结 context 匹配；模型不能自行改项目。缺少可靠的平台调用关联标识时，拒绝所有语音触发的 mutation（包括创建草稿），等待可信平台关联或经过审阅的每会话独立路由验证。单条独占语音会话不能证明调用来源与 capture 归属；不能用全局当前项目或模型声明替代关联。

WSS Upgrade 必须校验已登录 HttpOnly/Secure/SameSite Cookie、精确 Origin、会话有效期和同 owner 的 voiceSession 绑定；不使用 URL 长效 Token，不接受跨站 Upgrade。最多每用户一个活动 capture，限制单连接消息大小、总连接和速率，控制消息容量优先于音频；超限关闭 capture 而非拖垮取消/状态 API。首批 PCM 默认协商候选为 16 kHz、mono、signed int16 little-endian、20 ms（640 bytes），帧上限与输入协议版本固定；TTS 输出格式单独协商，未验证解码能力就标记 unavailable。长效灵矽/接入点/Codex 凭据不进浏览器。灵矽 SDK 会话由服务端建立，手机只访问 VoxCode；若当前官方 SDK 要求浏览器直连，应显式报告契约冲突，验证服务端中转能力后再选型，不能悄悄引入直连。不要沿用旧手机原生设备 WSS 作为浏览器方案的证明。关闭语音会话只停止录音、识别和播报，不取消已经启动的 Codex turn；取消开发任务必须走独立定向取消接口。MVP 不承诺锁屏持续录音。

## HTTP、MCP 与并发合同

| HTTP 接口 | 业务含义 / MCP 对应 |
|---|---|
| GET /api/projects | 当前用户可选项目及预配置 scopes；codex_list_projects |
| GET /api/tasks?projectId=:id | 首批项目任务列表；codex_list_tasks |
| POST /api/tasks，body 含 projectId | 首批创建 draft；codex_start_task；由独立 confirm 执行 |
| POST /api/tasks/:taskId/confirm | 首批确认草稿，body 含 revision/requestId；无 MCP confirm 工具 |
| POST /api/tasks/:taskId/instructions（后续目标） | 同一任务追问或微调；resume 未验证前不公布 continue 工具 |
| GET /api/tasks/:taskId | 任务及当前 turn；codex_task_status |
| POST /api/tasks/:taskId/cancel | 首批定向取消；codex_cancel_task；将来引入 turn 后再版本化扩展 |
| POST /api/tasks/:taskId/approvals/:approvalId | 针对已存在授权决策；语音是否允许此类决定单列策略，不凭模型文本推定人工授权 |
| GET /api/tasks/:taskId/events?after=cursor | 有界单调事件游标，断线补取；codex_task_logs 提供有界摘要 |
| GET /api/tasks/:taskId/results/:resultId | 不可变证据快照；codex_task_result |
| POST /api/tasks/:taskId/results/:resultId/acceptance | accepted/changes_requested 及理由，精确绑定结果 |
| POST /api/voice/sessions | 绑定 Context 建语音会话 |
| PATCH /api/voice/sessions/:id/context | 仅 idle 且旧 capture 已对账可切目标，contextVersion CAS |
| WSS /ws/voice | 双工音频帧与有界语音/任务事件；HTTP 只用于建会话、上下文和历史对账 |
| POST /api/voice/sessions/:id/captures | 固定录音 Context，返回 captureId 和协商格式 |
| GET /api/voice/sessions/:id/events?after=cursor | 断线后的有界任务/语音历史对账，不承载实时音频 |

所有 mutation 具有 `requestId`、`expectedRevision`（新任务可为0）及 Context。服务端持久化 `(owner,requestId)→payloadFingerprint,response`：同 ID 同内容重放原结果，异内容409；失效 revision/context409附最新版本，客户端不得自动换目标重试。MCP JSON-RPC id 仅连接传输标识，不替代业务 requestId；server 根据 capture+tool action 标识建立持久业务键，重连不重新执行。API 返回 taskId/turnId/revision/requestId，不能把排队响应包装为已完成。

首批 submit 产生 draft，由手机 confirm 触发执行；未来具备上述安全条件后，普通 instruction 才一步进入队列。权限、目标或需求未定返回结构化 clarification，而不是猜测执行。高风险操作授权是独立 approval 对象，含目标、操作摘要、expiresAt、revision，决策只能消费一次。服务器登录权限与项目允许范围是执行前置条件。

CLI resume 只有在已安装版本真实验证 sandbox、cwd、会话归属后启用；不接受客户端任意 sessionId。恢复失败保留 interrupted，不静默另建失去历史的会话。进程退出但清理未确认则 quarantine 并保留执行槽；重启不凭持久 PID 发信号。

## 任务树、归档与可恢复删除

任务字段补充 parentTaskId、initialPrompt、archived、deletedAt、metadataRevision。父子任务必须属于同一项目；子任务是独立执行单位，不能假称自动继承 Codex 会话。关闭标签只改变视图，保留分任务输入草稿与历史。

首批 listTasks({projectId,includeArchived,includeDeleted}) 默认过滤隐藏任务。HTTP POST /api/tasks/:id/archive 使用 {requestId,metadataRevision,archived}，/delete 与 /restore 使用 {requestId,metadataRevision}；三个动作分别调用受控任务元数据方法。归档和删除需停止 running/cancelling/quarantined 任务并对账；删除仅写 tombstone，恢复不执行代码。父任务删除不连带删除子任务。metadataRevision 只保护元数据，CLI revision 仍保护执行确认，不能混用。初始原文持久保存；完整逐轮历史与真实结果另行实现，不把有界输出称为完整会话。

## 项目、子项目与细粒度微调

页面保持当前整体风格，补充紧凑的“项目 → 子项目范围 → 任务/结果版本”目标导航，不以架构重整为由更换视觉体系。用户可从现有任务、已生成文件或结果版本发起“只改按钮间距”等增量开发。选择文件是任务内目标提示，不是把浏览器路径直接传给 CLI 的入口。

微调 mutation 为 `{requestId,expectedRevision,contextVersion,projectId,scopeId,taskId,baseSnapshotId,deltaPrompt,selectedFileIds?}`。普通后续开发可不填 baseSnapshotId；从结果操作发起的微调必须填。`deltaPrompt` 是新要求，不能覆盖原始任务 prompt；默认继承 task.criteria、项目/scope 和原结果其他已验收约束。变更验收标准必须显式给 criteriaDelta，并把新增、修改、删除展示清楚；模型不得因“只改间距”丢弃原始功能要求。

服务器验证 owner、task→project/scope、baseSnapshot→task、selectedFileIds→该 snapshot 的 artifact manifest，并检查 expectedRevision。selectedFileIds 是服务器返回的稳定文件标识，最多受限数量，不接受任意路径或 glob；实际解析后的文件必须处于 scope allowlist。baseSnapshotId 指修改起点；验收请求的 resultId 指被认可结果，两者不能互换。

最简基线策略：只允许从该任务当前 latestResultId 微调，且没有已提交但未完成的新 turn；旧 snapshot 仍可查看，发起微调返回409及最新结果，提示用户刷新并重新选择。暂不实现自动 cherry-pick、合并或旧版本分叉；避免用户正在看旧页面却悄悄修改最新代码。新 turn 保留 baseSnapshotId、deltaPrompt 和继承条件，输出新的不可变 snapshot，不改旧快照。

运行中的补充要求进入任务有界队列，冻结 project/scope 和提交时 revision；若队列执行前出现基线或 criteria 冲突，转 clarification_required 而不是静默重定目标。跨 scope 微调必须由用户先显式切换/扩展授权范围并建立新 Context，不能由“顺便改后端”偷偷越过 allowlist。同 repo 写锁适用于所有 scope，以此保证首版可解释且可维护。

## 真实结果、检查及预览

ResultSnapshot 最小集：`{id,taskId,turnId,revision,baseCommit,headCommit?,completedAt,summary,diff,checks,preview}`。每个证据有 `state:collected|unavailable|failed`、reason 及 artifactId，不能用空内容代替“未采集”。只引用可信服务器采集内容，模型声称“测试通过”不是检查证据。

- diff：执行前基准与结束时受控快照生成真实 Git diff，含路径、增删统计、受限 patch artifact。支持未跟踪文件，拒绝项目外读取；敏感配置不公开。结果快照固定后不随工作目录继续改变。
- checks：ProjectRegistry 指定的 check profile 执行；记录 command、cwd 的逻辑标识、exitCode、startedAt、duration、stdout/stderr artifact、truncated。检查失败与未运行分别显示。模型提供命令可以作为建议，不能当已执行。
- preview：仅受控构建产物的独立预览会话，返回同源受鉴权 URL、artifactId、expiresAt、state。拒绝任意路径/目录/端口，隔离预览脚本与管理 API 凭据，使用独立 origin 或严格 sandbox。服务端真实构建和手机可交互未通过前保持 unavailable；不将活动 worktree 任意 HTTP 目录直接暴露。
- acceptance：提交 `{requestId,expectedRevision,decision,resultId}`；只能接受展示过的准确结果快照。产生新 turn 后旧快照仍可读，不能误标新版本已验收。验收仅记录用户认可，不隐含 Git merge、部署或发布。

## 分步实施与验收

1. 协调者冻结 TaskService/Context/ProjectRegistry 及错误合同；实现单项目 registry 兼容层，旧单 root API 不再扩展。首批保持确认；将来启用普通指令直达须同时更新 MCP、HTTP 和产品文案并通过安全门槛。
2. CLI 负责人完成真实单 turn、隔离 worktree、持久化 mutation 去重、事件与快照；独立验证继续会话后再开放 continue 工具。任务运行不依赖 xrobo。
3. HTTP/前端负责人提供项目切换、任务列表/活动/结果/验收，用 fixture 校验目标版本与断线；不得以 fixture 冒充真实 Codex。
4. MCP/灵矽负责人维持 WSS 注册，复用 TaskService，验证 session→Context 关联和重复调用。真实 codex_status 已通过，只补常驻及任务工具闭环，不重新归因为 Token 故障。
5. 语音负责人核对官方 SDK、服务端中转与编码，完成真实手机录音→灵矽→MCP submit→同一任务结果。项目切换/停止/重连/迟到事件须有回归验证。
6. 证据/预览作为独立受控能力逐项落地；最后双入口交错操作同一任务，验证 requestId 不重复执行、冲突不串项目、取消/重启不谎报成功、验收精确版本。

协调者拥有共享入口、部署配置、集成与 Git；CLI、MCP、Web/语音 worker 只改分配模块，合同变化先回协调者串行整合。每批先提交可重现探针与验证结果，再扩大功能；两份独立审查通过后集成。保留 fixture/server-live/phone-live 标识及尚未通过的验收项。

当前限制：项目 registry/多项目路由已有本地源码，尚未合入/部署；独立任务 worktree、普通指令直执行、可信语音会话关联、持久幂等完整覆盖、真实结果与预览均是待实施合同，不能由旧 worker 测试推定已完成。服务器 MCP 常驻、智能体实际选工具、真实模型开发和手机语音闭环分别验收。
