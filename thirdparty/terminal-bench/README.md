# terminal-bench

Harbor agent adapter for running diligent on [Terminal-Bench](https://tbench.ai) evaluations.

## Prerequisites

- Docker running (`docker info`)
- Python 3.12+
- Bun (for building the binary)
- `ANTHROPIC_API_KEY` (or other provider key) set in environment

## Setup

```bash
# 1. Build the linux binary (from repo root)
bun run build:linux-x64

# 2. Create venv and install adapter (first time only)
cd tools/terminal-bench
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

After code changes, rebuild the binary before running:

```bash
bun run build:linux-x64   # ~30ms, output: dist/diligent-linux-x64 (~99MB)
```

## Quick test

Run a single simple task to verify the setup works:

```bash
source tools/terminal-bench/.venv/bin/activate

harbor run \
  -d terminal-bench-sample@2.0 \
  --agent-import-path "diligent_tbench:DiligentAgent" \
  -m anthropic/claude-sonnet-4-6 \
  -t "regex-log" \
  -n 1
```

Expected: ~3 min, reward = 1.0. Results written to `jobs/<timestamp>/result.json`.

## Run

### Single task

```bash
source tools/terminal-bench/.venv/bin/activate

harbor run \
  -d terminal-bench-sample@2.0 \
  --agent-import-path "diligent_tbench:DiligentAgent" \
  -m anthropic/claude-sonnet-4-6 \
  -t "<task-name>"
```

### Full dataset

```bash
harbor run \
  -d terminal-bench@2.0 \
  --agent-import-path "diligent_tbench:DiligentAgent" \
  -m anthropic/claude-sonnet-4-6 \
  -n 4
```

### Parallel execution with Daytona

```bash
export DAYTONA_API_KEY="..."

harbor run \
  -d terminal-bench@2.0 \
  --agent-import-path "diligent_tbench:DiligentAgent" \
  -m anthropic/claude-sonnet-4-6 \
  --env daytona \
  -n 32
```

## Datasets

| Dataset | Tasks | Description |
|---------|-------|-------------|
| `terminal-bench-sample@2.0` | 10 | Quick validation subset |
| `terminal-bench@2.0` | 89 | Full benchmark |
| `terminal-bench-pro@1.0` | 200 | Extended benchmark |

List available tasks: `harbor datasets download terminal-bench-sample@2.0` (cached to `~/.cache/harbor/tasks/`)

## Useful flags

| Flag | Description |
|------|-------------|
| `-t "task-name"` | Run specific task (supports glob: `-t "regex-*"`) |
| `-x "task-name"` | Exclude task |
| `-n 4` | Concurrent trials |
| `-l 5` | Limit to first N tasks |
| `-k 3` | Retry each task N times |
| `--debug` | Enable debug logging (warning: may leave containers running) |
| `-o path/` | Custom output directory (default: `jobs/`) |

## Results

Results are written to `jobs/<timestamp>/`:

```
jobs/2026-03-02__10-50-03/
  result.json              # Overall job summary (mean score, reward distribution)
  config.json              # Job configuration
  job.log                  # Harbor log
  regex-log__XkG5wMQ/      # Per-trial directory
    result.json            # Trial result (reward, tokens, timing)
    trial.log
    agent/
      command-0/           # Config setup (auth.jsonc + config.jsonc creation)
      command-1/           # Diligent execution
      command-2/           # Session log collection
      sessions/            # Copied .diligent session JSONL files
    verifier/              # Test execution output
```

Key fields in trial `result.json`:
- `verifier_result.rewards.reward` — score (0.0 or 1.0)
- `agent_result.n_input_tokens` / `n_output_tokens` — token usage
- `agent_execution.started_at` / `finished_at` — timing

## How it works

```
Host                          Container
────                          ─────────
1. Copy binary to /logs/      → /installed-agent/diligent
2. apt-get install ripgrep    → required by diligent's grep tool
3. Write auth.jsonc from env  → ~/.diligent/auth.jsonc
   Write model config         → ~/.diligent/config.jsonc
4. diligent --prompt ...      → Session logs in .diligent/sessions/
5. Copy *.jsonl to output     → Token usage extracted post-run
```

The adapter creates `auth.jsonc` and `config.jsonc` in the container from host-side environment variables at command generation time. API keys go to `auth.jsonc`, model selection goes to `config.jsonc`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (for Anthropic models) | Written to auth.json in container |
| `OPENAI_API_KEY` | For OpenAI models | Written to auth.json in container |
| `GEMINI_API_KEY` | For Gemini models | Written to auth.json in container |
| `DILIGENT_BINARY_PATH` | No | Override binary path (default: `dist/diligent-linux-x64`) |
| `DAYTONA_API_KEY` | For `--env daytona` | Daytona cloud environment access |

## Troubleshooting

### Containers not cleaned up

`--debug` mode may leave containers running. Check and clean up:

```bash
docker ps -a --filter "label=harbor" --format "{{.ID}} {{.Names}} {{.Status}}"
docker stop <id> && docker rm <id>
```

### Binary not found

```
FileNotFoundError: Cannot find diligent-linux-x64 binary.
```

Rebuild: `bun run build:linux-x64` from repo root.

### API key errors

```
Error: No API key for anthropic.
```

Ensure `ANTHROPIC_API_KEY` is exported in the shell where you run `harbor run`. The adapter writes it to `auth.json` inside the container.

### Agent setup timeout

The first run downloads the Docker image and installs ripgrep (~13s setup). Subsequent runs reuse the cached image. If setup times out, try `--agent-setup-timeout-multiplier 3.0`.

## Directory structure

```
tools/terminal-bench/
  src/diligent_tbench/
    agent.py          Harbor adapter — binary resolution, config setup, execution
    templates/
      install.sh.j2   Container setup — copy binary, install ripgrep
  pyproject.toml      Python package definition (harbor>=0.1.0)
```
