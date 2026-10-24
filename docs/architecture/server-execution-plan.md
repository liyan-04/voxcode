# 服务器执行实现计划

主任务Issue53。方案：[server-execution.md](server-execution.md)。用户已授权在架构师/产品经理评估和简单验证通过后继续；本地49项定向与8项串联验证满足限定源码工作起点，不代表允许忽略Linux/live/device门槛。

## 全局约束

- 原生iPhone只连接受认证TLS服务器；服务器接灵矽WSS并本地stdio运行Codex，手机不持有提供商凭据。
- 保持现有API、草稿确认、不可变录音目标、requestId对账、四名额1–8和至少20任务。
- 节点目录命名不等于部署机器，`apps/mac`首轮保留；不引入新代理、多租户、数据库或平台迁移。
- 三个Issue/worktree独占路径并行；协调者Git，两个独立reviewer；每里程碑PR到master，无直接master提交。
- 远端管理审批失败时不绕过；实机结果缺失时仍推进本地独立工作并标记缺口。

## 任务1：服务器预检、复用启动和源码交付（55）

文件：`apps/server/**`、`scripts/build-server-package.mjs`、`scripts/test/server-package.test.mjs`。接口：现有 `startRuntime(options)`，已有VOXCODE_*/LINX_*配置；Relay独立进程，Bridge仅回环。

- [ ] 先编写反例：不支持Node、缺Codex/项目HEAD、root执行、缺/部分私有配置、已存在输出、源码包漏必需文件/泄密均失败，不触碰现有服务。
- [ ] 用受控工具运行确认反例，再实现只读脱敏预检、显式复用启动及关闭。默认不安装、不改账号、不启动已有Relay、不kill未知进程。
- [ ] 构建有版本来源的源码tar包，仅打包明确源码/锁文件/入口，排除凭据、证书、node_modules和Git状态；拒绝覆盖。新目录手工锁文件安装后可运行。
- [ ] 测试解包可解析/启动受控依赖，以及失败不遗留进程；记录真实命令、覆盖率、限制和回滚步骤。
- [ ] 协调者验证→Scoped Draft PR→两名独立评审→修正→合并；不把源码包称为已完成服务器部署。

## 任务2：iPhone连接和信任服务器（56）

文件：`apps/ios/**`。接口：BridgeTransport/Settings现有API不变，固定地址`https://100.100.81.209:9899`。

- [ ] 更新实际信任/默认地址/ATS和相关测试的一致性，保留拒绝明文、错误CA/IP/过期及普通HTTPS系统信任。
- [ ] 手机界面的Mac连接/恢复/凭据文字和权限用途改为服务器任务；保持token/origin原子绑定及草稿/重试/验收逻辑。
- [ ] 更新模块README与构建输出，保留PersonalTeam首装与手动IPA区别，无fixtureCA或私钥进入包。
- [ ] 运行可用的Swift/格式/plist检查；Xcode到位后补原生SDK/XCTest/coverage。缺少证据时保持Draft，不能因仅改IP就跳过原生验证。
- [ ] 两名独立评审、PR合并；签名实际安装仍属52，不由源码验收代替。

## 任务3：现行灵矽协议与无声卡串联（57）

文件：`packages/voice/**`、`apps/integration/voice.mjs`、`voice-tools.mjs`、`test/voice*.test.mjs`及新`test/headless-server.test.mjs`。接口：createLinxSession/createVoiceHandler及现有音频/草稿API。

- [ ] 固定读取官方文档commit20ce1b2的WebSocket/端侧MCP/云端MCP/第三方接入/智能体配置，记录选择WS+端侧MCP且服务器充当软件设备。
- [ ] 先添加会话与协议兼容反例：已绑定session_id遭到冲突消息时不得触发草稿/工具，保持官方可选字段兼容；MCP响应控制消息符合现行会话格式。用现有测试和新用例证明RED后修复。
- [ ] 把临时串联验证变为自包含测试：真实回环Relay/Connector/Bridge、现有adapter+Opus、受控stdio+实际Gitworktree；无认证拒绝、无自动执行、明确确认、diff、重放一次、同线程续接、abort清理。
- [ ] 运行语音与集成回归/覆盖率；文档明确云端SSE和WSMCP差别，不为没有公网回调路由强加新服务。
- [ ] 两名独立评审和PR；真实配置/ASR/工具/可听播放仍待Linx/device验收。

## 集成与部署验证

- [ ] 协调者更新共享README/架构/范围/合同/进度，复用Issue48端点证书工作并消除公司Mac强制前提；另以PR评审，保留旧证据归属。
- [ ] master上完整Node+政策+相关原生回归；检查安装包/说明/真实启动参数一致。
- [ ] 获得可执行远端入口后在普通用户隔离项目做Linux回归、真实Codex修改/续接/停止、严格TLS和真实灵矽。每项失败保留脱敏证据，不猜测认证成功。
- [ ] Xcode完成后签名实际iPhone安装，同一构建完成蜂窝VPN、语音确认、真实任务与验收全链路。
