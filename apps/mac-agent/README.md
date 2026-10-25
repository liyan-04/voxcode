# Mac agent

日常安装、启动、停止、重启和发布统一使用仓库根目录的
`install.sh`、`start.sh`、`stop.sh`、`restart.sh`、`deploy.sh`。
首次准备和现有服务接管见[生命周期部署说明](../../docs/deployment/control-lifecycle.md)。
下文保留模块级前台调试命令。


The agent connects outbound over verified WSS to the VoxCode server. The server
forwards registered-device commands; Codex runs on the Mac through the existing
private task service socket. The agent exposes no listening TCP port and does
not automate the Codex desktop UI.

Requires Node.js >=22, the local `apps/server/task-cli.mjs` task service already
running under its private task identity, and a Keychain generic-password item
whose service/account match the private agent config. Install the pinned agent
dependency:

```sh
npm ci --ignore-scripts --prefix apps/mac-agent
node apps/mac-agent/cli.mjs --config /absolute/private/agent.json --task-socket /absolute/private/task/service.sock
node --test apps/mac-agent/test/*.test.mjs
```

Copy the structure of `deploy/agent.json.example` into an operator-owned mode-0600
configuration file outside the checkout; replace the synthetic endpoint/device
and paths. Both configuration and ledger parents must be canonical, owned by the
agent user and private mode-0700. Ancestors must belong to root or that user and
must not allow group/other writes, except root-owned sticky directories such as
the system temporary directory. Private JSON is opened with O_NOFOLLOW, checked
using fstat and read through that same descriptor.
The token is retrieved by `/usr/bin/security find-generic-password` with fixed
service/account arguments. It is never accepted on the command line or logged.
The launcher refuses plaintext endpoints and disabled TLS verification.

`deploy/io.voxcode.mac-agent.plist.example` is a template for a per-user LaunchAgent.
Replace every placeholder with the existing absolute Node/repository/config/socket
paths before installing it. The template contains no token. Do not load it until
the task service, Keychain item, trusted server certificate and registered device
have been verified. No launchd installation is performed by this module.

## Protocol And Recovery

`register` carries `protocolVersion:1`, `deviceId`, `token` and `capabilities`.
Commands are accepted only after a matching `connected` handshake. Heartbeat
frames carry the protocol and device identity. Acknowledgments must match the
current device and connection ID; an elapsed acknowledgment deadline detects an
unresponsive peer. Reconnect uses bounded exponential backoff. Every socket
callback is bound to its connection generation.

The launcher advertises only `task_rpc`. The shared control protocol validates
the method and argument array; the adapter calls only the fixed methods on
`createTaskRpcClient`. Validated parameter arrays are forwarded unchanged. Inner
TaskService business request IDs are independent of outer transport request IDs;
the agent never replaces one with the other.
The RPC result is returned directly in `commandResult.snapshot`. Actual task
revision rules remain enforced by the task service. No Codex process is started
by the agent.

RPC deadline, lost/invalid response, unavailable transport and outcome-unknown
errors return nonterminal unknown receipts. Result encoding or size failures
after dispatch are likewise unknown. These ledger reservations cannot execute
again on retry; write reservations remain until explicit reconciliation, even
when TaskService eventually commits after the agent's wait ended.

Commands execute serially. Device identity, operation/request identity, envelope
TTL and payload are validated before execution; TTL is checked again immediately
before dispatch. Request fingerprints and results are persisted to a mode-0600
ledger using fsync and atomic rename. A restart changes unresolved `inflight`
entries to `unknown`, and these operations cannot execute again automatically.
Completed same-payload retries return the recorded result; changed requests or
reused operations are rejected. The ledger retains mutation replay identities.
Expired read-only `task_rpc` receipts are pruned before accepting new commands,
including read-only records recovered as unknown. Running records and records
without explicit read-only metadata remain reserved. Read operations may run
again after expiry; mutations are never evicted. At 1024 unexpired/reserved
entries or the byte budget, new work is rejected.

`reconcile` reads only the durable local ledger and checks both request and
operation identity. Completed results are replayed; inflight, missing or mismatched
records return `unknown` / `operation_unknown` without invoking a capability.

The ledger acquires an exclusive mode-0600 `.lock` file before reading or writing
state. A second process is rejected. Clean close waits for pending persistence
and releases only its own lock. An existing stale lock is never removed
automatically: stop launchd retries, verify process ownership and pending task
outcomes, preserve the state, and explicitly reconcile before an operator removes
the stale lock. A PID alone does not prove ownership.

Stopping the connection does not cancel a task RPC already dispatched; its
outcome may remain unknown. A state write error halts reconnect and requires
operator reconciliation. Do not delete the ledger to bypass uncertain results:
inspect the local task service and preserve its replay history.

`local-capabilities.mjs` is a separately injectable adapter for registered
project/application mappings. It uses fixed `/usr/bin/open` or fixed osascript
source with argv, and rejects arbitrary paths/scripts. It is not enabled by the
launcher. `switch_task` is explicitly unavailable. Native control needs separate
OS permission and product verification.

The fixture suite includes a real local WSS connection with an explicitly trusted
temporary CA and a real protected Unix socket using a synthetic task adapter.
Neither fixture runs a model or proves a production gateway, Keychain access,
launchd installation, real task execution, Accessibility or Linx readiness.
The gateway integration test uses the real `device-gateway` and `device-store`
modules. It runs automatically after gateway integration; while they are in a
separate checkout, set `VOXCODE_GATEWAY_FIXTURE_ROOT` to that checkout's absolute
path. If those modules are absent, this one integration test is explicitly skipped.
