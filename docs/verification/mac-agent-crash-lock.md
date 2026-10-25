# Mac Agent crash-safe ledger ownership

Issue: [#121](https://github.com/liyan-04/voxcode/issues/121).
Base: `c390bfa3f3b345900f306c9f6821afd8083a1d52`.
Local environment: macOS arm64, Node v26.0.0, 2026-10-25.

## Ownership and compatibility

The Agent now holds a kernel advisory lock through its own open descriptor for
the private `agent-ledger.json.lock.guard` file. The guard inode is persistent
and must never be unlinked or replaced while an owner may be running.
macOS `/usr/bin/lockf -s -t 0 3` acquires the inherited descriptor's lock and
exits immediately. Node retains the shared open-file description and therefore
the lock. Linux uses `/usr/bin/flock --exclusive --nonblock 3` equivalently.
Unsupported platforms and acquisition errors fail closed. No long-lived
helper, helper protocol, PID polling timer or mtime/TTL eviction is involved.
The helper has a 3-second deadline, bounded diagnostics, an empty environment
and only descriptor number 3 in its arguments. No secret crosses it.

Explicit close releases the Node descriptor. SIGKILL/process exit closes it in
the kernel, so the next Agent can acquire immediately even when metadata
remains. A suspended owner retains its lock. Helper exit after successful
acquisition is expected and does not lose the parent's ownership; failed or
killed acquisition helpers never produce a usable lease.

The existing `.lock` path remains private observation metadata and an O_EXCL
compatibility barrier for older Agents. Modern version 2 metadata is not an
ownership source: after taking the kernel guard, a replacement preserves stale
metadata as `.lock.previous-<uuid>` and records its own owner identity. Reused
or live PIDs in stale modern observations cannot block recovery or cause any
process to be killed. Graceful release removes only its own metadata inode;
it never deletes the guard. Original ledger content and replay semantics do
not change.

Legacy version 1 metadata needs one-time conservative migration because old
Agents do not hold the guard. Only a valid same-device record whose PID probe
returns ESRCH is migrated automatically and preserved. Live PIDs, reused live
PIDs, EPERM, malformed JSON, unknown versions and unsafe files still require
operator reconciliation. No live owner is evicted. An old Agent racing the
metadata transition must win or lose the same O_EXCL create; a new Agent that
loses refuses ownership. Do not run scripts that remove a live owner's guard.

Before each ledger commit, the Agent verifies the private guard and owned
metadata inode identities. Replacing/removing the guard makes the command
path halt and disconnect before command dispatch or receipt mutation. The
parent descriptor otherwise keeps the kernel lock throughout queued writes;
release waits for pending ledger writes before closing ownership.

## Evidence

The FD-only primitive was tested before implementation with actual Node/lockf
processes: after the acquisition helper exited 0, a competitor exited 75 while
Node retained its descriptor, then exited 0 after close. A separate owner was
killed by SIGKILL; the immediate competitor exited 0 without deleting the guard.
This establishes the chosen descriptor lifetime independently of Agent timers.

Focused tests use actual child processes and actual kernel locks. They cover
simultaneous starts with one winner, refusal while the winner is SIGSTOP'd,
graceful release, SIGKILL and restart with stale metadata preserved, a reused
live PID in modern metadata, live/dead legacy migration, killed acquisition
helper recovery, replaced guards, and private-file/symlink refusal. A separate
Agent regression verifies guard replacement dispatches no command and writes
no new ledger receipt. No unrelated process receives a terminating signal.

```sh
cd apps/mac-agent
node --test test/ledger-lock.test.mjs test/agent.test.mjs test/reconnect-process.test.mjs
npm test
```

Initial new-module regressions failed because the capability did not exist;
the Agent integration regression failed because the old path created no
kernel guard. After implementation the first focused run passed 22/22; the
final full suite, including the added guard-permissions test, passed 35/35.
Existing replay/unknown outcomes,
directory fsync, WSS reconnect and reconnect-process lifetime checks remain
part of the full suite. `git diff --check` passed. Existing pinned ws 8.22.0 was
installed locally with npm ci --ignore-scripts; metadata was unchanged.

These are local macOS process and network fixtures. Linux flock execution,
physical power loss, installed-service migration and user device acceptance
were not performed here. Kernel release on process exit is the ownership
mechanism; physical power loss is not claimed as a performed test. Coordinator
owns two independent reviews, integration, deployment and installed recovery.
