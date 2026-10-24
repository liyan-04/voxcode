# 手机与服务器双工 WSS（Issue62）

状态：2026-10-24，用户明确要求；架构师与PM完成评估，本文冻结首版设计供独立复核，尚未实现或验收。现行手机HTTP音频块/事件轮询不满足本要求。灵矽服务器WSS协议已在PR59集成，是另一条连接。

## 拓扑与范围

```text
iPhone URLSessionWebSocketTask
  wss://100.100.81.209:9899/api/stream
      → Relay固定同机代理
  ws://127.0.0.1:8787/api/stream
      → Bridge stream服务
          ├─ 共用语音会话引擎 → 灵矽官方WSS/端侧MCP
          └─ 真实任务状态订阅 → 本机Codex任务服务
```

选择固定loopback代理，符合Relay/runtime同机范围，保留两常驻进程；不在现有Connector的HTTP/base64封装上新增远程流隧道。将来拆分执行节点另设计隧道。现有HTTPS配对、任务创建/追问/停止/授权/验收、快照及完整diff/evidence继续保留其已验证的requestId/version语义；本期WSS负责音频和实时事件，不把所有API重写。

## 连接与鉴权

- 公网WSS仅精确`/api/stream`，无query/fragment/URL凭据；Bearer仅在Authorization头，禁止token子协议、日志或URL。手机由已配对HTTPS origin派生同host/port WSS，复用严格公开CA/IP SAN/有效期delegate和拒绝重定向。
- Relay启动配置`VOXCODE_PHONE_STREAM_URL`显式启用，严格限定`ws://127.0.0.1:<port>/api/stream`，port1–65535，无其他成分；不允许客户端传代理地址，默认不开放该通路。原有Connector继续转发HTTP。
- Relay先检查Bearer形状且拒绝machineKey，只向固定后端转发Authorization。Bridge在handleUpgrade之前通过现有service.authorize；后端已open、前端仍活着后Relay才升级前端。不将机器凭据转发为手机凭据。
- Bridge/Relay各限制待鉴权/活跃连接、升级耗时与消息大小；鉴权失败不得创建provider、录音或任务订阅。Bridge连接期间每次输入/下行验证owner，并通过撤销通知立即关闭；到期空闲连接也关闭。不得仅在握手时鉴权一次。
- Bridge在客户端hello前不发送业务数据；5秒无hello关闭。v1不协商压缩、不重定向、不修改Codex权限。

## v1消息与顺序

JSON文本必须是对象，禁止未知type；单消息≤64KiB。所有控制命令有非空`requestId`（≤128字符），相同ID/规范化内容重放相同ACK，异内容拒绝；单连接最多256条去重记录，满则关闭并要求重连。连接ID/录音ID不充当用户身份。

| 方向 | type | 字段/行为 |
| --- | --- | --- |
| 手机→服务器 | `hello` | `{protocol:1,requestId}`；返回`ack`并声明协议/限额；之后才接收业务帧 |
| 手机→服务器 | `tasks.subscribe` | `{requestId,cursors:{taskId:seq},reset:false|true}`，最多32任务；首次/重连默认reset:false并核验已保存cursor。reset:true清空旧cursor并为当前全部授权任务建立新snapshot/cursor基线，不重放被舍弃的历史。新requestId替换此前订阅：先注销旧listener，清空尚未发送的旧订阅帧；snapshot及后续帧携`subscriptionId:requestId`，客户端拒绝已入网但迟到的旧订阅帧。cursor未知任务/未来/缺口发送`resync_required`，不能静默跳过 |
| 服务器→手机 | `tasks.snapshot` | `{revision,tasks,cursors}`，来自同一个同步订阅屏障；tasks仅含id/title/status/version/updatedAt，title≤120字符，最多32项；完整task/evidence通过HTTPS查询。随后对有效cursor以`task.events`发送有序保留events（每批≤16条且≤32KiB），再推实时变更；不能以snapshot代替应重放的事件 |
| 服务器→手机 | `task.changed` | `{subscriptionId,revision,task,cursor}`，task为上述轻量摘要；事件另以`task.events`小批次传递。客户端据通知合并刷新实际HTTPS快照/详情，不能启动固定间隔轮询；revision只用于本连接排序，task/version仍校验 |
| 服务器→手机 | `task.events` | `{subscriptionId,taskId,events,cursor}`；events连续有序，本批≤16条且≤32KiB，cursor仅为本批最后事件seq，不能提前设成订阅屏障的最高cursor而跳过剩余批次 |
| 手机→服务器 | `voice.start` | `{requestId,taskId:null|string,version:null|integer}`；冻结录音owner/task/version；返回`ack`携`recording`现有创建结构与`inputCreditBytes:32000`，成功后才允许二进制输入。会话创建期间的ready/STT等先进入有界待发送队列（≤256KiB），ACK必须先发送，再依序发送这些事件；超限则关闭该录音，不丢失ready或悄悄创建第二会话 |
| 手机→服务器 | `voice.stop` | `{requestId,recordingId,lastSeq}`；只有已接收lastSeq一致才停止输入，保留语音输出；`stop`不关闭整条WSS，不取消任务 |
| 手机→服务器 | `voice.abort` | `{requestId,recordingId}`；本地先停播，服务器终止该录音语音输出并丢弃迟到音频；不得取消Codex；现有abort会结束该录音输入，手机同步停麦 |
| 手机→服务器 | `voice.close` | `{requestId,recordingId}`；释放本连接拥有的录音/provider/订阅；不能关闭其他owner或连接的录音 |
| 服务器→手机 | `voice.event` | `{recordingId,event}`；事件含seq与ready/STT/TTS/draft/focus/error；此seq是本录音JSON事件独立从1连续递增，不沿用包含audio的旧HTTP事件seq，二进制音频另有每方向seq；MCP保持服务器内部，不暴露provider RPC或凭据；只发该连接实际拥有的录音 |
| 服务器→手机 | `audio.ack` | `{recordingId,seq,acceptedBytes,creditBytes:32000}`；acceptedBytes是本录音累计已接受PCM payload字节（不含头），seq是最高连续接受序号，creditBytes是固定未确认窗口上限、不是本次追加额度；不表示ASR已识别或provider收到 |
| 服务器→手机 | `ack` / `error` | 关联requestId；通用错误code/message不包含token、路径、provider原始错误；失败关闭录音或连接的规则要明确 |

任务推送要求真实服务通知，不能在服务器包装轮询。服务订阅接口在同一个同步调用内安装监听并给出当前快照/cursor，避免read→subscribe间漏事件。snapshot先发，保留事件以有界迭代器逐批pump进入发送队列，不把32任务×64条历史一次复制进256KiB队列；为每任务固定屏障cursor和迭代位置。期间实时通知也受总内存上限约束，先完成该任务的保留事件再发屏障之后更新；实际慢端溢出才关闭，不能因合法初始replay总量大就必然断开。snapshot.cursors说明屏障当前位置，不代表客户端已消费完历史；客户端已消费事件cursor只随task.events批次推进。任务变化revision是当前服务进程内单调序号；重连先清理旧连接epoch，再以新快照为基线，不跨服务器重启比较revision。task.version仍仅表示业务版本。保留events最多64条，cursor过期/未来值发resync_required；客户端重新获取完整HTTPS快照后，用新requestId、`reset:true,cursors:{}`重新订阅，以新WSS snapshot/cursor建立同步基线，不能继续重发旧cursor。恢复期间显示同步中，旧HTTPS响应不能覆盖更新的WSS epoch/revision。不能在大evidence出现时循环发送相同超限snapshot；摘要不携带evidence。不可把事件seq当作覆盖所有状态变更的revision。

控制命令去重仅在当前连接生效。语音引擎仍保持现有owner＋requestId记录：断开时关闭该连接的录音并留下closed记录，新连接不能续接、补传或接管旧recordingId。新录音须经用户动作产生新requestId；相同旧ID返回明确已关闭/冲突，不创建第二会话。任务持久操作的跨连接去重仍由HTTPS现有服务负责，不能以WSS连接内缓存替代。

### 二进制音频

每个二进制帧为24字节头＋PCM：字节0–3 ASCII`VC01`，4–19为recordingId UUID的16字节，20–23为uint32大端seq（每方向各自从1连续递增）。方向由WebSocket端点确定，禁止跨录音ID、重复/跳序、奇数字节或无活动录音音频。音频payload≤32000字节；JSON和二进制使用不同硬上限判断，总maxPayload65536。

上行为PCM16LE/mono16kHz，下行为服务器实际协商并解码的PCM16LE/mono16或24kHz；`voice.start`的ACK.recording.outputFormat/outputSupported决定播放器（沿用现有创建响应），现有ready事件本身不携这些字段，不从上行格式猜下行。输入20–100ms一帧为常态；累计最多60秒/1,920,000字节、会话TTL120秒，沿用现有限制。一套灵矽软件设备凭据当前仅允许一条活动录音，不因手机WSS数增加假定provider可并发；任务并行名额不受此限制。

单录音最多32000未ACK上行字节（约1秒）；手机send完成只代表传输层处理，不释放应用credit。服务器读取/校验/交给引擎后累计ACK。单边待发送队列≤256KiB，Relay双向bufferedAmount也≤256KiB；超限结束当前连接/录音并要求用户重录，不无限缓存/静默丢帧。手机播放器沿用≤4秒有界队列。大任务证据用HTTPS读取，不能挤占语音队列。

## 生命周期与用户可见行为

- 停止录音只结束上行，仍可收播报；打断播报先本地清空播放并通知voice.abort；停止开发任务走独立HTTPS cancel并等待“停止中→确认终止”。三者不混用。
- 录音开始时冻结task/version/requestId，切页或focus建议不能改归属。客户端连接epoch＋recordingId＋音频seq共同拒绝迟到事件；收到STT/工具草稿不自动创建/追问/授权/验收。
- 真正双工：上行仍在发送时可收到STT/草稿/TTS和PCM。iOS要用适合同时录放的AVAudioSession模式与回声处理，不能保留当前`.record`＋`guard !recording`导致下行被丢弃；具体硬件听感必须真机验证。
- 断网/后台/音频中断立即停止麦克风与播放，作废当前epoch、清空未ACK音频、关闭当前录音。重连只恢复鉴权和任务快照/订阅，不补传旧录音或播放旧音频，明确提示重新录音。
- WSS断开不取消服务端已有Codex执行；不确定HTTPS提交保留原requestId/内容对账，不能为了恢复换ID重派。撤权/过期关闭流并按现有手机配对逻辑处理。
- ping/pong与退避重连用于检测连接状态，不代表模型仍在工作。UI保留真实状态/最后同步/未知，不显示虚假百分比。

## 最小验证与实施分工

架构评审`/root/ios_server`、PM`/root/product_manager`一致推荐同机固定代理并区分停止录音/打断/停止任务。协调者临时loopback探针（不保留为产品实现）验证了Authorization转发、后端open后前端升级、未发送stop前收到文本及二进制回传；首运行因探针所在树未安装ws失败，改用已锁定安装的依赖后通过。这不证明生产代理、TLS、provider、iOS或反压。

1. 协调者冻结本文与HTTP/WSS合同、相关README，双独立复核后发布PR。
2. Relay开发：固定loopback proxy、升级鉴权门槛/关闭/超时/反压、CLI配置、包closure与独立测试；不改Connector HTTP协议。
3. Runtime开发：抽离共享voice会话引擎及HTTP适配，WSS状态机/音频ACK/事件，任务服务原子订阅与缺口检测；回归原HTTP安全/幂等/TTL语义。
4. iOS开发：基于PR60的严格TLS入口增加URLSessionWebSocketTask、独立可测试协议/队列/epoch状态机，替换录音上传与实时轮询；保留HTTPS持久操作。缺iOS SDK/XCTest/签名时PR继续Draft。

每组件独立Issue/worktree/范围、两份非作者review、精确测试/coverage/里程碑tag/PR到master；不会直接提交master。遇429降并发退避继续。

验收必须包括：未授权无provider/订阅；真实TLS正反例；同时收发且不调用HTTPaudio/events轮询；任务变更由服务通知；慢端与信用上限；同连接/跨连接ID重放；撤权到期；停止/abort/新录音旧音频抑制；断网不续传；无孤儿provider；单录音限制；64条事件缺口重同步；同一签名iPhone构建在蜂窝+VPN上完成真实灵矽→确认→Codex→结果/验收。模拟器和探针只作为开发证据。
