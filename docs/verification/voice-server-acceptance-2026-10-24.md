# 灵矽语音控制服务器 Codex 实测

日期：2026-10-24。Issue：[75](https://github.com/liyan-04/voxcode/issues/75)。证据类型：`live`。起点为最新 `origin/master` 的 `5a7edf6e3fbb96dd1be1c6961acfcbc84c674831`，独立分支 `codex/75-voice-server-acceptance`，未修改其他任务的实现目录。

## 验收结论

用户在灵矽“编程助手”网页通话中操作后，服务器实际收到验证码 `4826`，启动真实 Codex 0.162.1，以专用非 root 账号生成文件，独立文件检查通过；随后又收到结果查询调用。没有以合成音频代替用户说话，没有保存录音。

```text
灵矽网页语音 → 灵矽智能体/MCP Proxy
    → vm6 出站 WSS 连接 → 固定验收工具
    → vm6 Codex exec → 实际文件 → 结果查询
```

本次验证的是上述语音控制链路。手机访问 VoxCode HTTPS、VoxCode 接入灵矽 SDK、多项目/持久任务管理、继续同会话及正式部署不在本次结论内。Mac 仅用作浏览器/SSH管理终端，Codex在服务器执行。该探针不是正式业务执行器。

复现、改配置、新增工具、看日志和停止方式统一在[验收运行手册](../../scripts/acceptance/README.md)。精确部署代码：[linx-voice-probe.mjs](../../scripts/acceptance/linx-voice-probe.mjs)。

## 现场配置

| 项 | 本次实际值 |
| --- | --- |
| 执行环境 | vm6 / Linux x86_64 / Node.js 22.23.4 / Codex 0.162.1 |
| 执行身份 | `voxvoice75`，UID999 / GID988，无登录shell |
| 工作目录 | `/opt/voxcode-voice-acceptance-75/runs/<code>`，单码0700 |
| 安装 | 同版本 `codex` + `codex-code-mode-host`，root持有的独立目录 |
| 模型 | `gpt-6.1-sol`，服务器回环 scoped bearer 网关转发Responses |
| 任务限制 | 固定prompt / stdin；workspace-write；任务命令禁止直接网络；120秒超时 |
| 桥接限制 | 单活跃任务，内存去重，最多四个不同码，45分钟上限 |
| 外部访问 | 只出站官方WSS，没有新增公网监听 |
| 灵矽后台 | 已开通MCP，历史显示名“VoxCode Mac 语音测试”；实际连接vm6 |
| 智能体绑定 | “编程助手”的技能与扩展/MCP编辑中已选该服务 |

服务器 `private.json` 为root0600，接入点Token不进入Git；上游key保留root私有文件，子进程只拿临时scoped bearer。独立UID防止直接读取root私有文件；本实验未认证为完整多租户隔离。

## 已解决的问题

| 表现 | 实际原因与证据 | 处理 |
| --- | --- | --- |
| 后台没有工具，也无法调试 | `X-MCP-Token`错误填写`lx-…`凭据；直接MCP客户端用接入点Token可调用 | 后台改成与WSS相同的接入点Token，保存后刷新工具列表 |
| `1001`没有文件 | `runs`父目录0700，non-root无法穿过；`namei -l`确认 | root父目录0711；每项工作区保持0700并chown给执行账号 |
| `1002/1003` exit0但无文件 | 首次未保留stdout/stderr；补脱敏诊断后确认`codex-code-mode-host`缺失 | 从已安装的同版本目录复制两个二进制；不是关闭工具或跳过沙箱 |
| `1004`仍无文件 | `codex sandbox -- /bin/pwd`重现`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`；内核AppArmor拒绝user namespace里的`setpcap/net_admin` | 为本实验的两个固定二进制加载临时AppArmor兼容规则；全局sysctl不变，Codex沙箱保留 |
| 用户不知道在哪说话 | 网页通话是按住说话、松开静音 | 指明角色页面右侧麦克风；实际页面显示麦克风通话 |

AppArmor规则允许本实验二进制创建user namespace，扩大范围仅限该root持有路径，不作为其他程序的默认例外。加载后单独核验：当前工作区可执行；写相邻任务目录报`Read-only file system`，文件未生成；任务shell创建外网socket报`Operation not permitted`。未关闭AppArmor或设置全局`apparmor_restrict_unprivileged_userns=0`。

`1005`程序预检在23:08:57启动，23:09:08完成，生成`VOXCODE_VOICE_1005\n`。这是人工语音前的程序预检，单列记录。

## 后台与人工语音证据

后台刷新后实际出现三个工具：`codex_status`、`codex_voice_acceptance`、`codex_voice_acceptance_result`。打开`codex_status`点击“运行”，UI显示“运行成功”、`source=live-server`、`codex-cli 0.162.1`及`1005`的真实成功状态。

用户在网页试用后请求核查；此前助手没有用HTTP触发`4826`。以下事件由服务器journal独立读取，时间同时标UTC与北京时间：

| 北京时间（UTC+8） | UTC | 实际事件 |
| --- | --- | --- |
| 23:18:52.469 | 15:18:52.469Z | `tools/call` → `codex_voice_acceptance` |
| 23:18:52.470 | 15:18:52.470Z | `acceptance_started`, code=`4826` |
| 23:19:12.942 | 15:19:12.942Z | `codex_exit`, exitCode=`0` |
| 23:19:12.945 | 15:19:12.945Z | `acceptance_finished`, status=`passed` |
| 23:19:44.225 | 15:19:44.225Z | `tools/call` → `codex_voice_acceptance_result` |
| 23:23:06.338 | 15:23:06.338Z | 又一次结果查询，未重新执行 |

Codex JSON事件包含真实`command_execution`：在工作区写入`voice-acceptance.txt`，随后Python以字节精确核对；命令退出0，输出`b'VOXCODE_VOICE_4826\n'`。工具的成功判断还独立检查了普通文件、拒绝symlink、大小和精确内容，未采信模型文字即可通过。

SSH再次读取实际产物：

```text
/opt/voxcode-voice-acceptance-75/runs/4826/voice-acceptance.txt
owner UID/GID: 999/988
size: 19 bytes
content: VOXCODE_VOICE_4826 + LF
sha256: d2c91998a941cd9ae820ae1d92f0e622bb66f1a11167e2bbe7e85e0bced657ca
```

仓库保留[调用事件](../../scripts/acceptance/evidence/2026-10-24-4826.jsonl)和[独立文件核验](../../scripts/acceptance/evidence/2026-10-24-4826-result.json)。日志为固定合成测试的必要节选，没有凭据、账号Token、录音或浏览器会话。用户操作与观察到的语音UI、服务器事件、文件相互对应；未保存ASR完整转录和音频，不声明逐字识别准确率或TTS听感已验收。

## 本地与现场检查

```sh
node --test scripts/acceptance/test/linx-voice-probe.test.mjs
node --check scripts/acceptance/linx-voice-probe.mjs
git diff --check
```

四项fixture回归：工具合同/通知不回复、参数拒绝、同码只执行一次及不同码并发拒绝、exit0但无匹配文件判失败。4/4通过；与真实语音证据分开。

提交前本地检查：Node.js26，专项4/4、语法检查、JSON解析、文档本地链接、证据内容/哈希和凭据模式扫描均通过。`npm run test:policy`初次因独立worktree未安装`marked`失败；执行锁定的`npm ci --ignore-scripts`后重跑50/50通过，锁文件无变化。未重跑无关的完整原生/业务运行时测试；本次只新增独立脚本、样例和文档，没有修改业务运行时。

仓库探针与现场部署文件SHA256相同：`3a995bd409132601051d23c079fef527e52caf3e911a4e48d31eb70de6ff29cd`。这是实际运行版本的复现记录，后续源码修改需重新验证。

现场检查包括：WSS initialize/list；直接代理HTTP调用；后台工具展示和运行；真实非root模型任务；人工网页语音；独立文件/哈希；沙箱越界写入与直接网络拒绝；服务停止和临时profile卸载。

## 停止、保留资源与后续

2026-10-24 **23:23:46** 主动停止`voxcode-voice-acceptance-75`，`systemctl is-active`返回`inactive`；`/sys/kernel/security/apparmor/profiles`中已无本次profile。45分钟自动上限未到就已停止。当前不能宣称工具持续在线，正式服务需按主线集成后另部署。

服务器保留专用账号、独立目录、二进制、测试产物、root私有配置、诊断文件和`/run/systemd/system/voxcode-voice-acceptance-75.service.d/cleanup.conf`。该drop-in仅为本次服务退出卸载profile，不启动进程，不加载profile。未删除证据，未触碰正式9899/其他服务。重新运行须先加载限定规则，采用新验证码，再完成后台刷新和语音验收。

源码以独立Draft PR交付；两名独立源码审查仍待完成，不能以一次live成功代替源码审查或正式部署验收。架构师/产品扩展配置和MCP工具按运行手册的合同、参数校验、授权、去重、日志与真实产物标准推进。
