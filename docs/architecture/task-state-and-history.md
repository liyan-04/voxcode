# 实时任务、历史与服务器本地存储

日期：2026-10-25（Asia/Shanghai）。Issue：#87。当前架构见 [current.md](current.md)。本文定义数据边界，数据库迁移与完整历史采集尚未实现。

## Codex CLI 已有能力

本次只读 SSH 在 vm6 核对 `codex --version` 和 help：安装版本为 **0.162.1**。未查询用户会话、读取私有数据库、运行模型或删除记录。

| CLI 能力 | VoxCode 用法与限制 |
| --- | --- |
| codex exec --json | stdout 实时 JSONL 事件；由服务器收集并归一化为任务活动。官方文档明确支持事件流。 |
| codex exec resume / codex resume | 有恢复入口；必须绑定服务器保存的 sessionId，并先验证当前版本 sandbox/cwd/归属，不能仅凭 help 就开放继续执行。 |
| codex archive / unarchive | 已保存会话的归档与恢复命令；不自动提供 VoxCode 项目/子任务关系和版本验收。 |
| codex delete | help 明确为永久删除，不映射到本产品的可恢复删除。 |
| codex agents | help 明确浏览 shared local app-server daemon 的会话；不能将它当作独立 CLI 模式的 HTTP 任务查询接口。 |

官方资料：[非交互 CLI 与 JSONL](https://developers.openai.com/codex/noninteractive/)；[CLI 命令参考](https://developers.openai.com/codex/cli/reference/)。实际能力以服务器安装版本实测为准。当前未证实独立 CLI 提供可直接给手机调用、满足全部任务管理要求的 HTTP API。

## 两份数据各负其责

Codex 保存其执行会话，VoxCode 保存产品任务与操作记录，并通过 `taskId → sessionId` 关联。前端只调用 VoxCode API；HTTP 与 MCP 复用同一任务服务。不能让浏览器直接读 Codex 数据目录或依赖未承诺稳定的内部数据库表。

VoxCode 至少保存项目、父子任务、原始需求与各轮输入、状态/修订、Codex sessionId、操作 requestId、归档/删除标记、事件及结果引用。初始原文与有界输出只是首批能力，不等于完整上下文；Codex 的内部推理也不应作为产品历史公开。

实时状态由服务器当前进程、CLI 事件及明确持久状态共同决定。页面刷新可补取快照/事件；服务重启时未知执行进入 interrupted/quarantine，不能凭历史最后一条 running 就声称仍在运行，也不能自动重跑。

## 当前存储与演进

[#84 CLI](https://github.com/liyan-04/voxcode/pull/84) 与 #80 首批使用原子 JSON 文件，保存任务、元数据和幂等账本；仍在 Draft/评审，未部署。归档/软删除使用独立 `metadataRevision`，执行确认使用 `revision`。

多文件 JSON 无法原子提交“元数据变更 + 幂等回执”，需要严格故障恢复；并发查询、完整事件和更长历史也会放大整文件重写成本。下一持久化增量推荐 **SQLite** 保存关系和操作回执，事件/产物保存在独立任务目录。它是服务器单机库，不额外部署数据库服务。迁移须有事务、失败重试/重启、备份与版本兼容验证，再替换当前 JSON；不阻塞已可审阅的 CLI/MCP/网页小 PR 发布。

目标布局（尚未实现）：

```text
private-state/
  voxcode.sqlite             # 项目、任务、turn、message、mutation、结果引用
  tasks/<taskId>/
    events/<turnId>.jsonl     # 有界追加/轮转；稳定 seq 与索引
    results/<resultId>/       # 不可变 diff/check 摘要与受控产物
```

数据库事务保存 task/turn/message/mutation 的一致状态；事件包含 taskId、turnId、seq 和时间，写入失败显式降级/隔离，不能丢失后仍宣称完整。日志限额、产物访问权限、敏感内容过滤及备份清理需独立验收。运行状态保留内存索引只是加速，不作为唯一历史来源。

## 页面 API 边界

首批已有 `/api/projects`、`/api/tasks?projectId=...`、任务详情、confirm/cancel、archive/delete/restore；[网页 PR #86](https://github.com/liyan-04/voxcode/pull/86) 尚待独立审阅与部署。后续逐轮历史/事件游标、结果快照与验收接口按 [合同](voice-code-workspace-contract.md) 实现，不把目标接口标为已可用。

用户选择的删除是 tombstone，可恢复且不删代码；恢复不执行任务。关闭标签只关视图，归档只改变可见性。已保存的代码结果、操作回执与历史不因前端标签关闭而丢失。停止进程与文件回滚始终分开。
