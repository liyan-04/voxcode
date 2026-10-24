# VoxCode

**手机浏览器中的语音 Code Agent 工作区。** 手机只访问服务器上的 VoxCode，通过灵矽 AI 语音或网页操作，控制同一台服务器上的 Codex CLI。目标是选择项目 → 提出开发要求 → 查看活动与真实结果 → 继续微调或验收。

Mac 和原生 iPhone App 不是当前方案的必需组件。页面保持现有风格，项目、子项目范围和结果版本导航逐步补齐。

```text
手机浏览器 ── HTTPS + 双工 WSS ── VoxCode 页面 / HTTP 管理 API / 语音
                            │
语音 → 服务端灵矽会话 → 灵矽 MCP
                            │ xrobo Proxy + 服务器出站 WSS
                            └── 共享任务域 ── Codex CLI ── 服务器项目
网页操作 ────────────────────────┘
```

语音由灵矽理解并调用 MCP；页面操作调用 VoxCode HTTP API。两者应共享任务、目标上下文与结果，不各自启动一套执行器。凭据只留服务器，不进入手机页面或 Git。Codex 使用 CLI，旧 App Server 架构不作为新主链路。

## 当前状态（2026-10-24）

**架构已转向浏览器和服务器 CLI，完整产品尚未部署验收。** 以下区分 master 已入库内容、待合入代码和真实链路证据，不能互相代替。

| 状态 | 内容与边界 |
| --- | --- |
| master 已合并 | 旧任务/语音/Relay/原生源码及测试、服务器预检/旧运行入口、工程规范与验证记录；这些保留作历史实现和复用参考，不代表新的浏览器 CLI 产品已完成 |
| [#75 真实链路证据](https://github.com/liyan-04/voxcode/issues/75)已入库 | vm6 主动连接 xrobo WSS，完成 MCP initialize、tools/list、tools/call，真实返回 `codex-cli 0.162.1`；只证明版本查询，不证明模型开发、语音或持久运行 |
| [#71](https://github.com/liyan-04/voxcode/issues/71)–[#74](https://github.com/liyan-04/voxcode/issues/74) 待集成 | 服务器 CLI adapter、HTTP/MCP 与 xrobo bridge、浏览器管理页面在独立 worktree 开发/评审；不能按 master 中已存在或已部署使用 |
| [#78 产品与架构设计](https://github.com/liyan-04/voxcode/issues/78) | 项目/预配置 scope、语音与文字共用任务、目标锁定、结果版本与增量微调仍属设计；不接受任意服务器路径 |
| [#79 部署工作](https://github.com/liyan-04/voxcode/issues/79) | 新服务器入口、配置和部署脚本推进中；尚无本 README 可承诺的新产品启动/安装命令 |

首批保持草稿与明确确认；普通开发直达是后续产品目标，须待目标关联、权限、幂等和版本约束验证后独立启用。执行完成、检查通过、用户验收和部署发布是不同状态。

最新方案入口：[当前架构](docs/architecture/current.md) · [产品工作区](docs/product/voice-code-workspace.md) · [详细接口目标](docs/architecture/voice-code-workspace-contract.md)。左侧项目/子任务树、归档与可恢复删除按批次开发；未部署或未通过真实验收的能力不视为可用。

## 如何查看与验证

- **本地设计预览：** [http://localhost:5180](http://localhost:5180)。这是本机已启动时的 simulation 预览地址，手机的 localhost 不指向服务器；其中演示数据不是真实 Codex 任务，也不表示语音或结果预览已接通。
- **真实 MCP 探针：** 阅读[服务器到灵矽 MCP Proxy 实测](docs/verification/server-linx-mcp-proxy-2026-10-24.md)。调用方走 Streamable HTTP，服务器走出站 WSS；两端通过同一接入点 Token 关联。仅启动自己的 `/mcp` HTTP 地址不会自动注册 xrobo，也不需要为该 WSS 探针开放公网监听端口。`lx-` API 凭证不能替代接入点 Token。
- **服务器访问环境：** 授权主机为个人 vm6。旧链路入口曾使用 `https://100.100.81.209:9899` 和用户手机 VPN；这不是新浏览器服务已经上线的声明。新部署必须检查现有端口/进程归属，保留 TLS 与认证，不能直接覆盖旧服务。

当前证据不包含：常驻 MCP 注册与重连、智能体真实选择任务工具、Codex 模型实际修改/续接、手机真实录音与可听播报、新网页 HTTPS 全闭环。项目 scope 隔离、真实 diff/check/preview 及微调版本冲突也需独立实现验证。

## 仓库与研发入口

需要 Node.js 22+、Git。执行真实 Codex 任务另需服务器 CLI 与可用账号；`--version` 可用不等于模型可调用。

```sh
# 安装当前 master 中的锁定依赖，运行已有回归
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix packages/voice
npm ci --ignore-scripts --prefix apps/relay
npm test
```

这些测试覆盖当前源码和 fixture，不自动启动新网页或部署服务器。当前 `npm start` 仍是旧 integration 入口，`package:relay` 仅构建旧 Relay 包；不要把它们当新浏览器 CLI 产品的启动或完整安装命令。新命令待 #79 实现、集成和实际验证后更新。

- `apps/server/`：master 中现有服务器预检/旧入口；新 CLI、HTTP、MCP 模块在 #71–74 待集成。
- `apps/mac/`、`apps/relay/`、`apps/ios/`、`apps/integration/`：保留的旧实现与测试，目录存在不意味着 Mac/原生 App 仍是必需条件。
- `packages/voice/`：已有灵矽语音模块；旧设备/原生验证不能代替新浏览器语音 SDK 链路。
- `docs/verification/`、`docs/reviews/`：真实探针、环境边界和独立评审。旧计划供历史参考，遇到冲突以最新产品/架构合同为准。

## 协作与交付

每个里程碑从 Issue 开始，独立分支/worktree 开发；协调者维护共享契约、集成和 Git，架构师与产品经理维护方案及 README 一致性。`master` 是唯一集成分支，禁止直接提交；组件完成两份独立评审后通过 PR 合入，记录实际本地验证，不能把模拟结果写成 live 成功。

交付顺序：真实链路探针 → 常驻 MCP 与 CLI 单任务 → 浏览器任务管理 → 灵矽真语音 → 结果/微调与故障验收。先证明小闭环再扩展；验收引用准确结果版本，不隐含 merge、部署或发布。

[贡献与 PR 规范](CONTRIBUTING.md) · [Issue 协作](docs/issue-collaboration.md) · [产品/架构维护](docs/product/pm-architect-workflow.md) · [进度](docs/progress.md) · [独立评审](docs/reviews/README.md)
