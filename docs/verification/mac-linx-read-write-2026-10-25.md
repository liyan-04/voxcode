# Mac Codex 经灵矽现网读写验证

Issue: #101。时间：2026-10-25 15:05:51（Asia/Shanghai）。
源码基线：`b65ec6e`。这是独立 Mac 接入验收，不替代主线的手机、服务器和 Mac Agent 实现。

## 实际结果

本次通过现有生产 MCP 连接调用本机真实 Codex CLI，读取随机文件、创建开发草稿，经本机私有 Unix RPC 确认后修复测试代码，并独立验证文件、Git diff 和测试退出码。

| 检查 | 真实观察 |
| --- | --- |
| 现网发现 | 8 个 MCP 工具可发现；没有 MCP confirm 工具 |
| 只读 | 模型读出文件中的随机值；提示词没有包含预期值；输入和保护文件保持原样 |
| 草稿 | 云端创建 write 项目草稿，源码未发生变化 |
| 确认 | 本机 owner 通过 mode 0600 的 Unix socket 确认精确 task/revision/requestId |
| 写入 | Codex 将 `sum.mjs` 的 `a - b` 改为 `a + b`，仅此一个文件变化 |
| 检查 | 独立进程运行原有 Node 测试：修改前退出 1，修改后退出 0；测试文件内容相同 |
| 去重 | 只读请求、写草稿和确认重放保持任务/会话身份，没有另起模型执行 |
| 沙箱正例 | macOS `:workspace` 权限下可写项目内测试文件 |
| 沙箱反例 | `:read-only` 拒绝改保护文件；`:workspace` 拒绝写项目外的兄弟路径 |
| 结束状态 | activeTasks=0，quarantined=false，现网 WSS 保持连接 |

Git 变更：

```diff
-export const sum = (a, b) => a - b;
+export const sum = (a, b) => a + b;
```

代码哈希、时间和脱敏检查结果保存在
[JSON 证据](../../scripts/acceptance/mac-codex/evidence/2026-10-25-read-write.json)。
私有完整记录保留在本机，公开材料不含连接 Token、模型凭据、真实设备标识、录音或个人路径。

## 环境与命令

环境：macOS arm64、Node `v26.0.0`、Codex CLI `0.164.0-alpha.11.1`，复用本机已配置的自定义模型服务。
模型启动由已登记项目固定选择 `read-only` 或 `workspace-write`；调用者不能传入目录、追加读写根或沙箱绕过参数。

完整步骤、私有配置示例、启动与回滚说明见
[验收工具说明](../../scripts/acceptance/mac-codex/README.md)。真实命令使用的个人路径在此替换为占位符：

```sh
node scripts/acceptance/mac-codex/prepare-fixtures.mjs <private-config>
node scripts/acceptance/mac-codex/bridge.mjs <private-config>
node scripts/acceptance/mac-codex/verify-live.mjs <private-config>
node --test scripts/acceptance/mac-codex/*.test.mjs \
  apps/server/test/codex-cli-adapter.test.mjs \
  apps/server/test/http-server.test.mjs \
  apps/server/test/mcp-proxy-bridge.test.mjs \
  apps/server/test/mcp-server.test.mjs \
  apps/server/test/project-service.test.mjs \
  apps/server/test/task-cli.test.mjs \
  apps/server/test/task-rpc.test.mjs
npm run test:policy
git diff --check
```

结果：上述针对 server 核心及本次新增用例的测试 **84/84 通过**；policy 测试 **62/62 通过**；diff whitespace 检查通过。Python 模型配置辅助脚本已通过语法解析；本次模型执行使用先前已生成的等价私有 provider 副本。

使用 c8 对本次唯一变更的运行时源码 `codex-cli-adapter.mjs` 采集覆盖率，基线 `b65ec6e` 使用既有 18 项 adapter 测试，当前源码使用既有测试及新增 4 项生命周期回归，共 22 项通过。行覆盖率从 157/159（98.74%）到 158/159（99.37%），分支覆盖率从 121/150（80.66%）到 130/156（83.33%），变更的清理行被实际执行。命令为 `c8 --include=apps/server/codex-cli-adapter.mjs --reporter=json-summary node --test apps/server/test/codex-cli-adapter.test.mjs scripts/acceptance/mac-codex/adapter-lifecycle.test.mjs`；基线在独立归档目录运行既有测试，不改其他工作区。

macOS 不允许在本次工具外层限制沙箱中嵌套启动 Seatbelt，因此最终 OS 边界探针在经授权的宿主环境运行。探针先验证项目内正例，避免把 `sandbox_apply` 失败误报为成功的拒绝写入。CLI 的 sandbox 子命令使用官方内置 `:read-only` / `:workspace` permission profile，不能把旧 `sandbox_mode` 参数错误当作边界证据。

## 复现中修复的问题

正常 CLI 退出后仍存在同进程组后代时，旧适配器通过 `entry.stop()` 清理，意外设置用户取消状态，导致已经生成正确答案的成功任务标为 cancelled。此批次将正常清理改为直接 TERM/KILL，保留显式取消、超时、隔离与清理不确定时的 quarantine 行为。

新增回归先在基线上复现 `cancelled`，修复后为 `completed`。现有取消、持久化失败、并发、未知进程清理和 quarantine 测试均通过。工具外层对负 PGID 探测的 EPERM 在既有 fixture 中保持 quarantine；真实宿主执行结束后没有遗留活动任务。

## 保留的边界

本机配置目前支持只读问答，以及测试仓库内经本机确认的代码修改；生产 MCP 不能自行确认执行。可写目录仅为独立测试仓库，没有将主线源码或任意个人目录交给模型。

本次未进行人声麦克风、ASR/TTS、手机/户外、桌面 Codex 既有聊天控制或 resume 验证。MCP 可调用不是可信 voice-capture 关联的证明。环境变量过滤不是同 UID 文件读取隔离；生产身份分离另行验证。结果 diff/checks 来自此验收脚本的独立采集，运行时不可变结果快照仍未实现。

本机 LaunchAgent 保持登录自启；现网编程助手仍使用原 MCP 绑定。初次发布时，两份独立实现审查尚未完成，PR 以 Draft 发布。

## PR #105 冲突解决

用户随后要求解决冲突，并在解决后合并。同步 `master` 的 `b23d2c2` 时，仅
`apps/server/codex-cli-adapter.mjs` 发生冲突：PR #106 已在主线合入同一个正常退出清理修复，并新增说明注释。
本次保留主线的完整适配器版本；`git diff --exit-code origin/master -- apps/server/codex-cli-adapter.mjs`
退出 0，PR 相对该主线不再修改生产运行时源码，仅保留验收工具、测试和文档。

冲突解决后的本机验证：

```sh
node --test scripts/acceptance/mac-codex/*.test.mjs apps/server/test/*.test.mjs
npm run test:policy
git diff --cached --check
git diff --name-only --diff-filter=U
```

结果：服务端及验收测试 **135/135 通过**，policy 测试 **62/62 通过**；staged whitespace 检查通过，未解决冲突列表为空。
这些是同步主线后的本机回归结果；未再次调用生产模型，也未改变已安装的本机桥接配置。
原始现网证据仍对应上文时间与源码基线。此次按用户明确要求完成冲突处理和合并，不将本机自检表述为两份独立审查。
