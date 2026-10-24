# 合并后清理规范

本规范适用于 VoxCode 的 Git 分支、worktree、临时构建目录和 PR 关联资源。清理的目标是减少已完成工作的噪声，同时保留完整的审查和验收证据。

## 清理资格

只有同时满足以下条件，资源才进入清理候选：

1. 对应 PR 的状态为 `MERGED`，且目标是当前项目基线分支（目前为 `codex/mvp`）。不能只根据“CI 通过”、PR 关闭或 commit 看起来已经存在来判断合并。
2. PR URL、最终合并 SHA、审查报告、验证命令和剩余风险已经记录在 PR 和 `docs/progress.md`；架构决策或依赖关系记录在 `docs/architecture/`。
3. 没有打开的 PR、stacked PR、Issue 或其他任务仍依赖该 topic 分支或 worktree。
4. 分支没有未推送的独有 commit；worktree 没有未提交或未跟踪的文件。任何可能只存在于待删 worktree 的内容都先转移到已审查的 commit 或文档。
5. 清理对象不属于 `main`、`master`、`codex/mvp` 或其他受保护分支，也不包含凭据、证书私钥、用户数据或未发布的验收证据。

Squash merge 后，topic 分支的 commit SHA 可能不是基线分支的祖先；此时以 GitHub PR 的 `MERGED` 状态、目标分支和合并 SHA 为准，并核对 PR diff 已出现在基线树中，不能只使用 `git branch --merged`。

## 允许清理的对象

- 已合并 PR 的远端 head branch。优先使用 GitHub PR 的删除分支动作。
- 已合并且无 worktree 的本地 topic branch，使用 `git branch -d`；禁止用 `-D` 绕过未合并检查。
- 由本项目创建、内容已纳入 PR 或明确属于构建缓存的干净 worktree，使用 `git worktree remove` 后执行 `git worktree prune`。
- 已验证不再需要的 ignored 构建包、测试证书 fixture 和临时目录。私钥、用户数据和未核对的文件不能作为“缓存”清理。

清理不关闭 PR、不删除 PR 评论、不删除 review 报告、不改写 Git 历史，也不删除 `docs/progress.md` 中的里程碑记录。若需要保留可恢复快照，先归档 worktree 或创建带说明的快照，再执行删除。

## 禁止清理的对象

- 当前正在使用的 worktree，或含有任何未提交/未跟踪内容的 worktree。
- 有未合并 PR、依赖 PR 或开发者明确标记为“保留”的分支。
- 受保护分支、远端默认分支、共享集成分支和用户未明确授权的外部服务器目录。
- 不能证明归属的 PID、目录、构建产物或证书材料。发现归属不明时停止清理并报告。

## 标准流程

1. **候选报告：** coordinator 列出 PR URL、目标基线、合并 SHA、分支、worktree、是否干净、依赖 PR 和拟删除对象；architect 只做依赖和风险检查。
2. **证据检查：** 读取 PR 状态和目标分支，核对 review/CI/验收记录，检查 `git status --short --branch`、`git worktree list --porcelain`、远端分支和未推送 commit。
3. **记录结果：** 在 `docs/progress.md` 追加“已合并/已清理/保留原因”，保留 PR 链接和合并 SHA；任何阻塞都写明具体路径或依赖。
4. **执行清理：** coordinator 按“远端 branch → 本地 branch → worktree → 临时产物”的顺序执行，每一步都只作用于已确认的对象。实现 agent 不执行删除、force delete、reset 或 worktree 清理。
5. **复核：** 再次检查 PR 仍可访问、合并 SHA 在基线、分支/worktree 已按预期消失，且没有误删未合并工作。输出实际命令和结果。

## 角色约定

- **Implementer：** 在 handoff 中报告 branch、worktree 是否干净、是否存在未推送 commit，并标记“可清理”或“必须保留”；不执行删除。
- **Architect：** 检查依赖、stacked PR、接口记录和证据完整性；给出清理建议，不执行 Git 删除。
- **Coordinator：** 唯一执行分支、worktree 和临时产物清理的人，负责保留 PR/审查/进度证据。
- **Human product owner：** 对有争议的未合并工作、外部目录、用户数据或不可恢复删除做最终决定。

## 协作工具

GitHub PR 是合并事实和审查证据的来源；GitHub Issues/Projects 用于任务状态和依赖协商；`docs/progress.md` 和本目录用于长期审计。当前 GitHub CLI token 没有 Project 读取权限时，使用 Issue/PR labels（`status:*`、`component:*`、`blocked`、`ready-for-review`）作为降级协作板，不在聊天记录中替代正式记录。
