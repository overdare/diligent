# 05 — OS sandbox for shell execution

Status: proposal · Depends on: 02 (spawn path) · Integrates with: 10 (denials), 06 (worktree writable roots)

## Problem

Every approved shell command runs with the user's full privileges, and the only control is a per-command approval
rule. Users either approve constantly or switch to `yolo`, which removes all control. An OS sandbox lets commands run
without prompts while bounding what they can write and whether they can reach the network.

## Current state

| Fact | Evidence |
|---|---|
| Permission engine: `read`/`write`/`execute` rules with wildcard patterns, last match wins, session "always" rules | `packages/runtime/src/approval/engine.ts:44-66`, `approval/types.ts:9-21` |
| `yolo` replaces the engine with allow-all | `engine.ts:37-42`, `config/schema.ts:228-229` |
| A policy `deny` is returned to tools as `"reject"`, indistinguishable from a user rejection | `app-server/server.ts:668-674` |
| `bash` spawns `$SHELL -c` directly; only sensitive env vars are filtered | `tools/bash.ts:88-115, 19-58` |
| Shell hooks run `bash -c` unsandboxed from config (global or project layer) | `hooks/runner.ts:34-42` |

## Reference survey

**codex** (`codex-rs/sandboxing/src/`): policy modes `read-only` (default), `workspace-write`, `danger-full-access`
(`protocol/src/config_types.rs:104-114`), with `network_access` on the policy (`protocol.rs:1282-1294`). Backends:
macOS Seatbelt (`seatbelt.rs` + `seatbelt_base_policy.sbpl`, `seatbelt_network_policy.sbpl`), Linux bubblewrap and
Landlock (`bwrap.rs`, `landlock.rs`), Windows (`windows.rs`, `windows-sandbox-rs/`). Denials are detected
heuristically (`denial.rs:13 is_likely_sandbox_denied`) and lead to an escalation request.

## Design

### Policy

```jsonc
"sandbox": {
  "mode": "off" | "workspace-write" | "read-only",   // default "off" in phase 1
  "network": "allow" | "deny",                       // default "allow"; "deny" only meaningful when mode != off
  "writableRoots": ["~/.cache/my-tool"],             // extra roots; cwd and temp are implicit in workspace-write
  "autoApprove": true                                // sandboxed execute requests skip the prompt (default true)
}
```

- `workspace-write` writable set: the thread cwd (or the subagent worktree, doc 06), the OS temp dir, and
  `writableRoots`.
- **Always read-only inside writable roots:** `.diligent/` and `.git/hooks/`. Both contain configuration that later
  runs **unsandboxed** (shell hooks from `.diligent/config.jsonc`, git hooks run by the user). Leaving them writable
  turns any sandboxed command into a sandbox escape.
- `read-only` allows reads everywhere the user can read and writes only to the temp dir.

### Scope

| Surface | Sandboxed | Reason |
|---|---|---|
| `bash` / `bash_wait` processes (doc 02) | yes | primary target |
| `write`/`edit`/`apply_patch` | policy check in-process (path must be under a writable root) | these run inside the runtime process; an OS sandbox cannot wrap them |
| Shell hooks | no | user-authored automation; constrained by trust (doc 01) |
| MCP stdio servers | no (phase 1) | long-lived, user-configured; follow-up |
| Code-mode `exec` worker | already isolated by its own worker boundary | unchanged |

### Backends

`SandboxLauncher` in `packages/runtime/src/sandbox/` transforms a spawn request `{argv, cwd, env}` into a wrapped one.
`spawnProcess` (doc 02) is the single call site.

| Platform | Backend | Availability check |
|---|---|---|
| macOS | `/usr/bin/sandbox-exec -p <generated SBPL>` | binary exists |
| Linux | `bwrap` with `--ro-bind / /`, `--bind <root> <root>` per writable root, `--ro-bind` overlays for protected subpaths, `--unshare-net` when network is denied, `--die-with-parent` | `bwrap` on PATH and a probe run succeeds (unprivileged user namespaces may be disabled) |
| Windows | none in phase 1 | — |

When `mode != off` but no backend is available, the runtime **does not silently run unsandboxed**: it falls back to
normal approval prompts for every execute request (as if `autoApprove` were false) and reports
`sandbox: { requested: mode, active: false, reason }` in `initialize` and in the approval request details, so clients
can show it.

**Platform reality check:** phase 1 provides no Windows backend, and embedding hosts that run on Windows gain nothing
until a Windows backend (restricted token + job object, or AppContainer) is designed separately. The roadmap therefore
ranks this item below items that help every platform.

### Escalation on denial

1. A sandboxed command exits non-zero and its output matches the denial heuristics (`Operation not permitted`,
   `Read-only file system`, `sandbox-exec` deny messages, `bwrap` bind errors, network resolution failures when
   network is denied).
2. The runtime requests approval: `{permission: "execute", toolName: "bash", description: "Command failed inside the
   sandbox. Run it again without the sandbox?", details: {command, sandboxDenied: true, deniedHint}}`.
3. `once` re-runs unsandboxed; `always` adds a session rule for the generated pattern (existing `generatePattern`);
   `reject` returns the original sandboxed output to the model with a note — not an abort (doc 10 source
   `sandbox_declined`).

The model may also ask up front: `bash { …, sandbox: "escalate", justification: string }`, which goes straight to an
approval prompt (never auto-approved).

### Approval interaction

With an active sandbox and `autoApprove: true`, the permission engine's `prompt` result for `execute` becomes `allow`
for sandboxed runs. Explicit `deny` rules still win. `write` requests from file tools inside writable roots follow the
same rule; outside them they always prompt.

## Risks

- **Seatbelt deprecation** (`sandbox-exec` is deprecated but still shipped and used by major tools); monitored, not
  blocking.
- **False denial detection** re-prompting for ordinary failures; bounded to one escalation prompt per command.
- **Toolchains needing writes outside the workspace** (package caches in `~`). Mitigated by `writableRoots` and by
  escalation; caches are a known source of noise and need documented defaults per ecosystem.

## Tests

- `packages/runtime/test/sandbox/seatbelt.test.ts` (darwin only): write in cwd succeeds; write to `~` fails; write to
  `.diligent/config.jsonc` fails; network deny blocks `curl`.
- `packages/runtime/test/sandbox/bwrap.test.ts` (linux, skipped without `bwrap`): same matrix.
- `packages/runtime/test/sandbox/launcher.test.ts`: unavailable backend → prompt fallback reported, never a silent
  unsandboxed auto-approve.
- E2E: denial → approval request with `sandboxDenied: true`; `once` re-runs and succeeds.
