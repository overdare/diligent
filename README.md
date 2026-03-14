<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.svg" width="120" height="120" />
</p>

# diligent

yet the most diligent coding agent

## Principles

**Effortless continuity** — Nobody should think about context management. Compaction, knowledge recall, and session history happen behind the scenes. One session can run forever — pick up where you left off, or start fresh. The agent never forgets what you want to build. Because continuity is effortless, the project stays honest.

**Project-centric** — Conversations, knowledge, and code live together as one project. The `.diligent/` directory is the boundary — sessions are JSONL files, knowledge is local, config is checked in. Everything the agent knew, decided, and did is right there in the repo. Sharing, debugging, and reproducing become trivial. Because everything lives in the project, continuity is inspectable.

**Transparency over complexity** — LLMs are non-deterministic, making agent behavior inherently unpredictable. Without transparency, development becomes increasingly difficult. Keep things simple so every layer can be debugged, experimented with, measured, verified, and improved — continuously.

**When everything is "important," nothing is** — The agent harness should not try to do everything. Find the few moves that truly matter.

## Getting Started

Requires [Bun](https://bun.sh) v1.2+.

```sh
git clone https://github.com/devbv/diligent.git && cd diligent
make dev
```

Resume the last session with `--continue`, or list past sessions with `--list`.

## Completion bell (terminal)

Diligent rings the terminal bell when a turn completes in CLI/TUI.

You can disable it in `.diligent/config.jsonc`:

```jsonc
{
  "terminalBell": false
}
```

## Tool settings

Diligent supports project-local tool settings for:

- enabling or disabling built-in tools
- adding trusted JavaScript plugin packages
- enabling or disabling whole plugin packages or individual plugin tools

Use the Tool settings entry in Web or `/tools` in TUI.

See [`docs/tool-settings.md`](docs/tool-settings.md) for the trust model, config format, plugin contract, the external-style sample plugin at `examples/external-tool-plugin/`, and current limitations.
