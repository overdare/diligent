<p align="center">
  <img src="assets/icon.svg" width="120" height="120" />
</p>

# diligent

A framework for project-centric agents.

Diligent provides the agent engine, runtime, and shared protocol for building agents into editors, development environments, and creative tools. Its central design direction is to make the project the home of working context across conversations, tools, and participants.

A game project makes that need concrete. One session explores a mechanic, another edits a scene, and another investigates a playtest failure. People and agents may work on different computers. Each session needs access to relevant decisions, discoveries, and unfinished work from the same project.

Diligent's goal is to let that context accumulate around the project and become useful in subsequent work, including work in remote sessions. Today, its foundation is a shared runtime with local project persistence, memory storage, extensible tools, and inspectable execution. Cross-machine context sharing and coordination are the next design focus.

## Principles

### Context belongs to the project

A conversation captures one part of the work. The project connects those parts: what is being built, why a decision was made, what changed, and what remains unresolved.

Diligent currently stores sessions and memory under the project's `.diligent/` directory. Sessions preserve execution history; a separate memory store supports reuse across sessions through search and prompt injection. Instructions, skills, and project configuration shape how the agent works in that environment.

### Continuity should be inspectable

Long-running work needs persisted history, resumable sessions, and context compaction. Diligent keeps the full transcript separate from the context reconstructed for the next model call, so developers can investigate both what happened and what the model can see.

Continuity is something to inspect and improve. Saving a transcript does not guarantee that every detail will be recalled, and compaction can lose information.

### The host connects the agent to the work

The host application owns its project model, domain operations, and user interface. Diligent supplies common agent behavior through a shared runtime and protocol.

In a game editor, the host might expose scene inspection, asset operations, script editing, and playtest results as tools. Diligent manages the conversation and tool execution around those capabilities. Domain integrations determine which project state the agent can observe and change.

## Building with Diligent

The framework separates reusable execution from runtime assembly and presentation:

| Layer | Responsibility |
| --- | --- |
| Core engine | Agent loop, model/provider interfaces, streaming, and tool contracts |
| Runtime | Sessions, context assembly, memory, skills, tools, approvals, and sub-agent orchestration |
| Shared protocol | Typed JSON-RPC requests, notifications, and client-facing models |
| Host application | Domain tools, project integration, transport wiring, and user experience |

`DiligentAppServer` exposes thread and turn lifecycle, interruption, steering, approvals, user input, and execution events through one protocol. The CLI/TUI uses stdio; application hosts can use WebSocket transport. Clients share backend behavior while presenting it in ways appropriate to their environment.

To integrate a host:

1. Assemble the runtime for a project using the public runtime package surfaces.
2. Connect domain capabilities through bundled tool providers, trusted JavaScript tool plugins, or external MCP servers.
3. Use the shared protocol to start and resume work, display progress, and collect approvals and answers.
4. Inspect persisted sessions and structured diagnostics, and evaluate behavior against representative project tasks.

Tool plugins execute with the runtime's trust level. Hosts own the domain checks and external systems behind their tools. See [Architecture](ARCHITECTURE.md) for package boundaries and integration rules, [Tool settings](docs/guide/tool-settings.md) for extension contracts, and [MCP servers](docs/guide/mcp-servers.md) for external tool connections.

## Toward shared project context

The next design focus is context shared across sessions of the same project, including sessions on different computers. A decision made during a design discussion should be discoverable during implementation; a playtest finding should be available to the session investigating the affected mechanic.

This raises several design questions:

- How do local and remote sessions identify the same project and contribute context to it?
- How does a session retrieve relevant context while preserving its source and relationship to current project state?
- How are conflicting decisions, superseded memory, and overlapping work represented?
- How does context sharing recover after disconnection or interrupted work?

The aim is to make relevant project context available to each session with enough provenance to assess and update it. Raw histories can remain separate while decisions, findings, and work references become discoverable across them.

The current implementation persists sessions and memory locally. Its sub-agent collaboration operates within the runtime. Remote context synchronization and coordination between independent runtimes remain future work; the shared client/server protocol provides an integration boundary, but does not itself synchronize project context across machines.

## Try the local agent

The included CLI/TUI lets you use the runtime on a local project.

Use [Bun](https://bun.sh) matching the repository's `packageManager` version and install [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) for the file search tools. After cloning the repository, run:

```sh
bun install
bun run packages/cli/src/index.ts
```

See [Provider auth](docs/guide/provider-auth.md) to configure model access. Project settings live in `.diligent/config.jsonc`; credentials are managed separately through the configured authentication store.

With Make and a compatible shell available:

| Command | Purpose |
| --- | --- |
| `make dev` | Run the CLI/TUI |
| `make debug-dev` | Run the viewer for local project data |
| `make release-local` | Build and install the CLI into a user bin directory |

Set `BIN_DIR=/your/bin` when running `make release-local` to choose an installation directory.

## Repository map

This repository uses Bun and strict TypeScript.

| Path | Contents |
| --- | --- |
| `packages/core` | Reusable agent engine primitives |
| `packages/runtime` | App server, sessions, context, tools, memory, and collaboration |
| `packages/protocol` | Shared frontend/backend protocol schemas and models |
| `packages/plugin-sdk` | Public contracts for external tool plugins |
| `packages/logging` | Structured diagnostic record and sink contracts |
| `packages/cli` | CLI entrypoint and TUI client |
| `packages/debug-viewer` | Viewer for inspecting local project data |
| `packages/e2e` | End-to-end suites organized by product boundary |
| `packages/evals` | Live-model behavioral evaluations |
| `apps/vscode-extension` | Editor extension host using the shared protocol |

## Documentation

- [Architecture](ARCHITECTURE.md) — ownership boundaries, runtime flow, and protocol philosophy
- [Session lifecycle](docs/guide/session-lifecycle.md) and [Compaction](docs/guide/compaction.md) — persistence, resume, transcripts, and model context
- [Tool settings](docs/guide/tool-settings.md), [MCP servers](docs/guide/mcp-servers.md), and [Tool rendering](docs/guide/tool-rendering.md) — capabilities and host presentation
- [Collaboration](docs/guide/collaboration.md) — current sub-agent orchestration
- [Structured logging](docs/guide/logging.md) and [Behavioral evaluations](docs/guide/evals.md) — diagnostics and validation

## Development

```sh
bun test
bun run lint
bun run typecheck
```

Commit and pull request titles use `<type>(<scope>): <summary>`. Allowed types are `feat`, `fix`, `refactor`, `test`, `docs`, and `chore`. Scopes use lowercase letters, numbers, and hyphens; summaries are limited to 72 characters.

For example: `feat(runtime): add session append batching`.
