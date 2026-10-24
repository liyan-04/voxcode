# 灵矽语音 → 服务器 Codex：验收与扩展入口

Issue: [#75](https://github.com/liyan-04/voxcode/issues/75)。本目录保存 2026-10-24 实际通过的独立验收探针、配置样例、复现步骤和脱敏证据。它不接管正式 VoxCode 任务服务，也不替代 Issue #71–74 的实现。验收结论和故障过程见[实测记录](../../docs/verification/voice-server-acceptance-2026-10-24.md)。

## 已通过的工作流

```text
用户在灵矽“编程助手”页面按住麦克风说话
  → 灵矽语音识别 / 智能体选择 MCP 工具
  → HTTPS POST https://xrobo.qiniu.com/v1/mcpproxy/mcp
       Header: X-MCP-Token = 接入点 Token
  → 灵矽 MCP Proxy
  ↔ vm6 主动建立 WSS /v1/mcpproxy/connect?token=同一个接入点Token
  → linx-voice-probe.mjs 处理 JSON-RPC
  → 非 root Codex exec / workspace-write
  → runs/<四位验证码>/voice-acceptance.txt
  → 独立检查退出码、普通文件、大小和精确内容
  → 结果查询工具 → 灵矽回复
```

Mac 在本次仅作为浏览器和 SSH 管理终端，Codex 实际在 vm6 执行。手机 → VoxCode HTTPS / 服务器语音 SDK 链路不在本次验收范围；本次用户直接使用灵矽网页语音入口。

## 文件与工具

| 文件 | 用途 |
| --- | --- |
| `linx-voice-probe.mjs` | 实际部署的 WSS / JSON-RPC / 固定任务 / 本机模型网关探针 |
| `test/linx-voice-probe.test.mjs` | 参数、重复请求、并发和真实产物判断的回归 |
| `private.example.json` | 接入点与执行 UID/GID 样例，没有真实凭据 |
| `apparmor-profile` | Ubuntu user namespace 兼容规则，仅匹配本次验收二进制路径 |
| `evidence/` | 真实 MCP 调用时间线、独立文件核验结果；没有录音或私有配置 |

| 工具 | 参数 | 行为 / 验收 |
| --- | --- | --- |
| `codex_status` | `{}` | 实时运行 `codex --version` 并返回最近一次验收状态 |
| `codex_voice_acceptance` | `{"verification_code":"4826"}` | 只接受四位数字，异步启动固定的文件创建任务，先返回 `running` |
| `codex_voice_acceptance_result` | `{}` | 查询最近一次任务；`passed` 必须满足 exit 0 且文件精确匹配 |

同一进程中，同码重放不再执行；同时只运行一项，最多四个不同验证码。进程重启后内存记录丢失，但已有同码目录不会被覆盖。重测请使用新的四位数字。`4826` 是公开的测试关联号，不是认证凭据。

## 复现前提与安装

这些命令在 **vm6 的已授权 root SSH 会话**中执行。只创建独立验收目录和账号；不更新全机 Codex，不改其他服务，不开放公网端口。需要 Node.js 22+、完整的 Codex 0.162.1 Linux 安装、可用的模型凭据；不安装依赖包。

从本目录把 `linx-voice-probe.mjs`、`private.example.json` 和 `apparmor-profile` 复制到服务器的受控暂存目录，然后执行以下步骤。本次实际目录已经保留，复现前先核实所有权；不要直接覆盖运行中的程序。以下“新装”块遇到目录或账号已存在会停止。

```sh
set -eu
accept_base=/opt/voxcode-voice-acceptance-75
test ! -e "$accept_base"
! getent passwd voxvoice75 >/dev/null
useradd --system --home-dir "$accept_base/home" --shell /usr/sbin/nologin voxvoice75
mkdir -p "$accept_base/bin" "$accept_base/home/.codex" "$accept_base/runs"
chmod 755 "$accept_base" "$accept_base/bin" "$accept_base/home"
chown -R voxvoice75:voxvoice75 "$accept_base/home"
chmod 700 "$accept_base/home/.codex"
# root 持有 runs 父目录；子进程必须可以穿过它。
chmod 711 "$accept_base/runs"
# 两个文件必须来自同一个已安装版本。只复制 codex 会缺执行组件。
accept_codex_dir=$(dirname "$(readlink -f /usr/local/bin/codex)")
test -f "$accept_codex_dir/codex-code-mode-host"
install -m 755 "$accept_codex_dir/codex" "$accept_base/bin/codex"
install -m 755 "$accept_codex_dir/codex-code-mode-host" "$accept_base/bin/codex-code-mode-host"
id voxvoice75
```

将暂存的探针安装为 `$accept_base/probe.mjs`（root 拥有，0644），配置安装为 `$accept_base/private.json`（root 拥有，0600），规则安装为 `$accept_base/apparmor-profile`（root 拥有，0600）。使用服务器编辑器填写配置，不要在命令历史、聊天或 Git 写真实 Token。

## 如何修改配置

| 配置位置 | 当前值 / 修改方法 | 生效方式 |
| --- | --- | --- |
| 服务器 `private.json.endpoint` | 官方 WSS 完整接入点；替换 `REPLACE_WITH_ENDPOINT_TOKEN` | 重启本验收进程，后台同步相同 Token |
| `private.json.uid` / `gid` | 填 `id -u voxvoice75` / `id -g voxvoice75` 的实际数值；999/988 仅是本次值 | 重启；进程拒绝 UID/GID 为 0 |
| 灵矽已开通 MCP → 更新配置 | Streamable HTTP；URL `https://xrobo.qiniu.com/v1/mcpproxy/mcp`；`X-MCP-Token` 填相同接入点 Token | 保存 → 工具 → 刷新工具列表 |
| 智能体 → 配置角色 → 技能与扩展 → MCP编辑 | 选择该 MCP 服务，保存 | 重新接通网页通话；硬件按后台提示重启 |
| 探针源码 `main()` | 当前模型 `gpt-6.1-sol`；上游 `https://llmapi.qiniu.io/v1/responses`；key 文件 `/root/.secrets/mykey.json` 的 `key` 字段 | 源码中的部署专用固定值，修改需审查、测试后重新部署 |
| 自动生成的 `home/.codex/config.toml` | 由 `main()` 每次启动生成：随机回环端口、scoped bearer、workspace-write、network=false | **不要手改**；重启会覆盖，改生成逻辑并保留沙箱约束 |
| 工具名称 / 描述 / schema | 探针顶部 `tools` 列表 | 部署后刷新工具列表并重新接通语音 |

`lx-…` 账号/API 凭据不能代替 MCP 接入点 Token。用户最初给的 `ws://` 地址在服务器改为 `wss://`。不要打印完整 URL。

本次后台服务仍叫历史名称“VoxCode Mac 语音测试”，但它已经连接服务器探针；这是 UI 定位名称，不代表 Mac 执行。后续正式集成应统一命名，再核对智能体绑定。

根进程只为 `POST /v1/responses` 启动带随机 bearer 的回环网关，保留上游 key；Codex 子进程接收临时 scoped bearer，使用独立 HOME/UID。任务 shell 的直接网络访问禁用。该部署专用网关不是通用模型服务，不应公开端口或用于多租户。

## Ubuntu 沙箱兼容、启动与停止

先检查：

```sh
accept_base=/opt/voxcode-voice-acceptance-75
/usr/local/bin/node --check "$accept_base/probe.mjs"
runuser -u voxvoice75 -- "$accept_base/bin/codex" --version
```

本次 `codex sandbox -- /bin/pwd` 报 `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`，内核日志显示 `unprivileged_userns` 拒绝 `setpcap/net_admin`。本机采用本目录的限定路径规则，不修改全局 `kernel.apparmor_restrict_unprivileged_userns`，不关闭 Codex 沙箱。确认错误相同、二进制为 root 所有后才加载：

```sh
apparmor_parser -r /opt/voxcode-voice-acceptance-75/apparmor-profile
```

启动前确认 **该服务没有运行**，不要并行连接同一个 MCP 接入点。为自动停止配置清理规则，再创建限时服务：

```sh
set -eu
accept_base=/opt/voxcode-voice-acceptance-75
if systemctl is-active --quiet voxcode-voice-acceptance-75; then
  echo 'Acceptance service already running'; exit 1
fi
mkdir -p /run/systemd/system/voxcode-voice-acceptance-75.service.d
cat > /run/systemd/system/voxcode-voice-acceptance-75.service.d/cleanup.conf <<'UNIT'
[Service]
ExecStopPost=/usr/sbin/apparmor_parser -R /opt/voxcode-voice-acceptance-75/apparmor-profile
UNIT
systemctl daemon-reload
systemd-run --unit=voxcode-voice-acceptance-75 \
  --property=RuntimeMaxSec=2700 --property=KillMode=control-group \
  /usr/local/bin/node "$accept_base/probe.mjs" "$accept_base/private.json" "$accept_base"
systemctl is-active voxcode-voice-acceptance-75
journalctl -u voxcode-voice-acceptance-75 --no-pager -n 15
```

探针自身也有 45 分钟退出上限。systemd 的 control-group 回收是外层保障；任务120秒超时发送 TERM，1秒后发送 KILL。关停：

```sh
systemctl stop voxcode-voice-acceptance-75
systemctl is-active voxcode-voice-acceptance-75 || true
# 无输出才表示该临时 profile 已不再加载。
grep 'voxcode-voice-acceptance-75' /sys/kernel/security/apparmor/profiles || true
```

若 start 失败且清理钩子未执行，先确认本次服务已停止，再手动 `apparmor_parser -R /opt/voxcode-voice-acceptance-75/apparmor-profile`。不删除验收产物、日志、账号或私有配置，方便复查。保留目录不代表在线。

## 如何验收和看日志

1. 服务日志应有 `proxy_connected → initialize → notifications/initialized → tools/list`。只有 `proxy_connected` 不能证明工具可调用。
2. 灵矽“已开通MCP → 工具 → 刷新工具列表”看到上述三个工具。打开 `codex_status` 点击“运行”，应返回 `source=live-server` 和真实 Codex 版本。
3. 打开“编程助手 → 配置角色”右侧，点“拨打”。连接后**按住右侧中间麦克风**说：“请调用服务器 Codex 语音验收，验证码四八二六。”松开后静音。重新测试请换未用的四位码。
4. 等待十几秒，再按住问：“查询 Codex 语音验收结果。”如果仍为 `running`，继续等后查询；不得把启动响应当完成。
5. 用 SSH 独立核对。同码重复询问不能启动第二次执行。下面是本次 `4826` 的实际检查命令：

```sh
journalctl -u voxcode-voice-acceptance-75 --since '2026-10-24 15:18:00 UTC' --no-pager
ls -ln /opt/voxcode-voice-acceptance-75/runs/4826/voice-acceptance.txt
cat /opt/voxcode-voice-acceptance-75/runs/4826/voice-acceptance.txt
sha256sum /opt/voxcode-voice-acceptance-75/runs/4826/voice-acceptance.txt
# 仅管理员在服务器查看；提交到仓库前只选合成测试的必要片段。
cat /opt/voxcode-voice-acceptance-75/diagnostics/4826.log
```

成功需要同一验证码对应：语音交互、MCP `tools/call`、`acceptance_started`、真实 Codex `command_execution`、exit 0、精确文件内容、`acceptance_finished=passed`。模型“已完成”的回复、版本查询、工具列表、exit 0 任一单项均不足。

桥接 journal 只记方法、工具名、测试码和状态；诊断保存最多32768字符的 stdout/stderr，root0700目录、文件0600，替换当前三类凭据。该替换不能证明任意日志都无敏感数据，正式任务日志必须另做脱敏审查。本目录仅保存固定合成验收，不提交录音、完整私有配置、上游 key 或浏览器会话。

## 架构师 / 产品新增配置和 MCP 工具

产品先为每个工具写清楚：用户会怎么说、查询还是修改、必须参数、固定的项目/任务目标、是否需用户确认、成功证据和失败文案。架构师再决定它属于 VoxCode API 还是灵矽 MCP；两条入口应复用同一任务服务，避免两个执行器分别启动 Codex。

本探针便于理解接入协议，但只有固定验收任务；**不要直接把它改成任意 shell、任意 prompt、任意路径执行工具**。正式 `create_task` / `continue_task` 等应接 Issue #71–74 的受鉴权任务服务，并加项目授权、requestId去重、任务版本、取消/恢复和审计。手机 → VoxCode HTTPS 与服务器语音 SDK 要另验收。

| 扩展点 | 实际改哪里 | 必需验证 |
| --- | --- | --- |
| 只改工具文案/schema | 顶部 `tools`；schema和处理器的校验必须同步 | 非法参数被拒绝；刷新后 UI 文案/参数正确；中文语音能选对工具 |
| 增加只读工具，如 `list_projects` | `tools` 加声明；`createAcceptanceProbe().handle()` 加白名单分支，返回受限公开字段 | 未授权项目、额外参数、路径/私密字段、未知工具反例；MCP/语音正向证据 |
| 增加修改工具 | 先定义正式任务服务授权/确认/版本/去重合同，再接处理器 | 不确认不执行、重试一次、旧版本拒绝、取消回收、真实diff/检查；不能复用仅四位码认证 |
| 新增部署配置项 | 样例、`main()`读取/校验、README表格一起改 | 缺值、非法值、secret日志、不允许目标的反例；重启实际生效 |
| 更换模型 / 提供商 | `main()`中模型、网关上游和凭据读取逻辑 | 模型有工具能力、真实任务文件、超时/失败可见；不能只测HTTP200 |

现有`tools`列表只是发现描述，**不会自动建立处理器**。新增名称还需要在`handle()`中明确路由；本探针对非验收工具默认只允许空参数，扩展时必须同步分支校验。UI中的“自定义工具描述”仅覆盖文案，不会注册服务器函数。

推荐顺序：从最新master开独立Issue/分支 → 产品工具合同 → 先写授权/参数/重放/失败回归 → 实现和配置样例 → 本地验证 → Draft PR两名独立审查 → 有限部署 → 后台刷新/重新通话 → 真实语音+日志+产物验收 → 记录版本、证据与停止方式。增加字段应给旧调用保留兼容或显式版本化。

当前限制：内存中的单任务状态、最多四码、没有业务项目授权、多用户会话、持久恢复和审计服务，不是生产任务系统。新权限不能靠修改工具描述获得。

## 本地检查

```sh
node --test scripts/acceptance/test/linx-voice-probe.test.mjs
node --check scripts/acceptance/linx-voice-probe.mjs
git diff --check
```

fixture回归和语法检查不代表真实语音成功；真实证据单列在 `evidence/` 和实测记录中。正式服务接入时重跑，不继承本次临时部署结论。
