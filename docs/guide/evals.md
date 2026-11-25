# Model-backed eval suites

Diligent keeps live-model behavioral evaluations in the private `@diligent/evals` package. They are separate from
deterministic unit and end-to-end tests and never run as part of the default `bun test` command.

## Suites

- `core` evaluates provider normalization and the generic agent loop in isolated in-memory worlds.
- `runtime` evaluates prompt assembly, mode-specific tools, project instructions, skills, sessions, and workspace
  effects through an in-process `DiligentAppServer` and `RpcClientSession` connection.
- `capabilities` checks basic capabilities of every supported catalog model through the same runtime path and records
  a per-model matrix. See [Model capability matrix](#model-capability-matrix).

The core and runtime suites are the agent scenarios. They run on representative profiles (`gpt-6.1-terra` and
`claude-sonnet-5`, plus the ChatGPT default on the shared runner). Every catalog model is checked only for the basic
capabilities in the matrix.

Run every task in each suite against both providers with:

```bash
bun run eval core
bun run eval runtime
```

Use `--provider openai|anthropic|gemini|chatgpt` to select one provider and `--task <id>` to select one task; the
filters compose. Gemini and ChatGPT are opt-in: without either filter, the command continues to run every task against
the OpenAI and Anthropic default profiles. `--model` selects one compatible model and therefore one provider profile.
`--seed` reconstructs fixture values; it does not make model output deterministic. Reports are written under
`artifacts/evals/` unless `--report` is given.

The core suite contains 7 tasks: `direct-response`, `single-tool`, `tool-chain`, `recover-tool-error`,
`structured-tool-args`, `parallel-tools`, and `image-tool-result`. `image-tool-result` checks provider transport of
multiple image blocks from an in-memory tool without runtime or filesystem behavior. All profiles use medium effort.
A default complete run requires both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`; a provider-filtered run requires
only its selected credential. An explicit Gemini run requires `GEMINI_API_KEY`. An explicit local ChatGPT run uses
Diligent's configured OAuth credential store and may open a browser for login.

The runtime suite contains 34 tasks. An unfiltered run uses both default profiles and therefore performs 68 sequential
task/profile executions. The complete manifest is:

- Project, prompt, and modes: `project-fix`, `plan-readonly`, `plan-to-execute`, `instruction-hierarchy`,
  `plan-converge`, `cross-file-contract-fix`, `plan-progress`, and `hook-context-follow`.
- Skills and memory: `memory-recall`, `skill-auto-select`, `skill-abstain`, `memory-intent-split`, and
  `memory-forget`.
- Interaction, context, and continuity: `session-resume`, `manual-compaction-resume`, `clarify-then-execute`,
  `read-image-pair`, `file-roundtrip`, `steer-during-fix`, `auto-compaction-resume`, `image-resume-recall`,
  `fresh-prompt-after-compaction`, `input-cancel-resume`, `loop-context-adaptation`, and `large-output-recovery`.
- Runtime integrations: `bundled-tool-routing`, `mcp-lazy-tool`, `mcp-resource-grounding`, and
  `mcp-prompt-grounding`, plus `mcp-needs-auth-abstain`. Plugin loading and tool-shape enforcement are deterministic
  runtime contracts, so `plugin-tool-routing` is not a live-model task.
- Collaboration: `custom-agent-routing`, `collaboration-parallel-synthesis`, `collaboration-resume-reference`, and
  `autonomous-explore-delegation`.

Selection counts are predictable: one task against one provider is one execution, one task without a provider filter
is two, all tasks against one explicitly selected provider (including Gemini) is 34, and the unfiltered manifest is
68.

Task `maxTurns` and `maxToolCalls` values are efficiency targets, not pass criteria. Exceeding a target adds a
`budget_grace.*` efficiency diagnostic. The core and runtime runners stop an execution only at a runaway limit of
`max(2 × target, target + 4)` (`EVAL_RUNAWAY_POLICY` in `packages/evals/src/runner/budget-policy.ts`); a stopped
execution is `invalid`, not a model-quality failure. The execution report retains the actual counts.

## Deterministic verification and live calibration

Deterministic tests exercise the harness, invariants, task evaluators, and assembled runtime paths with fake provider
streams or synthetic evidence. They need no provider credentials and do not make live model calls:

```bash
# Focused runtime harness and task coverage
bun test packages/evals/test/cli-options.test.ts packages/evals/test/runner packages/evals/test/tasks/runtime

# Complete deterministic eval-package coverage
bun test packages/evals/test
```

Live calibration executes the selected task/profile matrix against provider APIs. Model execution is non-deterministic,
but pass/fail evaluation is deterministic code over captured evidence; there is no LLM judge or semantic retry. Set
`OPENAI_API_KEY` for OpenAI selections, `ANTHROPIC_API_KEY` for Anthropic selections, and `GEMINI_API_KEY` for
explicit Gemini selections. An unfiltered run requires the OpenAI and Anthropic keys.

Local ChatGPT subscription evals are explicitly selected with `--provider chatgpt`. They use the same configured
Diligent auth store, token refresh, browser opener, and localhost callback as the product runtime. Rotated refresh
tokens are persisted before model use. Missing credentials or one clear authentication rejection may open the browser;
schema, network, model, and eval assertion failures do not trigger login. ChatGPT is not part of default profiles,
GitHub-hosted matrices, or CI secrets. Scheduled ChatGPT runs use only the shared self-hosted runner described in
[ChatGPT OAuth on the shared runner](#chatgpt-oauth-on-the-shared-runner).

`--non-interactive` never opens a browser. Missing, expired, or rejected credentials then fail with a classified
authentication error. `--chatgpt-auth-file <path>` reads and rotates tokens in that file-backed store instead of the
developer's Diligent auth store. `bun run eval chatgpt-login [--chatgpt-auth-file <path>]` signs in through the browser
and saves to the same store. The ChatGPT path never reads `OPENAI_API_KEY`, so an API key cannot stand in for OAuth.

```bash
# One focused execution; only OPENAI_API_KEY is required
bun run eval runtime --task instruction-hierarchy --provider openai

# One task against both default profiles; both keys are required (2 executions)
bun run eval runtime --task instruction-hierarchy

# One focused Gemini execution; only GEMINI_API_KEY is required
bun run eval runtime --task bundled-tool-routing --provider gemini

# One focused local ChatGPT OAuth execution; may open a browser
bun run eval runtime --task instruction-hierarchy --provider chatgpt

# Select a specific ChatGPT subscription model
bun run eval core --task direct-response --provider chatgpt --model gpt-5.5

# Complete default calibration; the OpenAI and Anthropic keys are required (68 executions)
bun run eval runtime
```

Use `--report <path>` to isolate a focused report from the timestamped default reports, and retain the emitted root
seed when investigating a failure. Reusing `--seed <seed>` reconstructs the same opaque fixture values but does not
guarantee the same model response.

### Failure dimensions and diagnostics

Eval reports retain `schemaVersion: 1` and the existing top-level `passed`, `failure`, and `failures` semantics. Each
failure also identifies the construct dimension it blocks: `semantic_goal`, `runtime_policy`, `behavior`,
`format_contract`, `efficiency`, or `harness_terminal`. A failed semantic evaluator result must explicitly provide its
dimension; there is no `semantic_goal` default. A missing dimension is an evaluator contract error classified as
`harness_terminal`. Configuration, provider rejection, timeout, budget, eval-policy, evaluator, and runner terminal
failures also use `harness_terminal`.

An evaluator may attach `diagnostics` containing a dimension, stable code, message, and optional impact to either a
passing or failing semantic result. Diagnostics preserve non-gating evidence such as one accepted bounded recovery or
an additional safe read-only search. They never change `passed`, are propagated to execution reports, and are omitted
when empty. `impact: "info"` records an observation without changing status; `impact: "degraded"` records an accepted
but materially worse execution. An omitted impact remains `degraded` for compatibility with existing evaluators.

Execution and suite reports also expose an additive `status`:

- `pass` means every required contract passed without degraded-impact diagnostics. Informational diagnostics may still
  be present.
- `degraded` means every required contract passed with one or more degraded-impact diagnostics. It remains
  `passed: true`, so bounded safe recovery does not fail CI.
- `fail` means a completed model execution violated a required semantic, behavior, format, or runtime-policy contract.
- `invalid` means a `harness_terminal` failure prevented a valid model-quality sample, such as provider rejection,
  timeout, budget termination, evaluator failure, or runner failure.

Suite status is the strongest observed execution status in the order `invalid`, `fail`, `degraded`, `pass`; the
per-execution results retain every mixed outcome. The legacy suite `passed` field remains true only when every
execution is `pass` or `degraded`. CLI output and GitHub summaries distinguish degraded accepted executions from clean
passes.

### Grading policy

Runtime task evaluators grade what the model achieved, not the path it took. They use `RuntimeGrade` and the trace
helpers in `packages/evals/src/tasks/runtime/grading.ts`. A task fails only for:

- `semantic_goal`: a wrong end state, such as a failed verifier, wrong file or memory-store contents, or a required
  fact missing from the deliverable.
- `runtime_policy`: a crossed boundary that the task exists to test, such as a successful read of a withheld or decoy
  source, a mutation in plan mode or before a required answer, or a change to a protected file.
- `behavior`: a missing or forbidden construct-essential event, judged by presence or absence and by order only when
  the prompt requires it (for example, delegating to a child, resuming the same child, adapting to injected context,
  asking before mutating, or running tests after the final write).
- `format_contract`: a reply format that the prompt explicitly requires. Comparison ignores cosmetic presentation
  (surrounding whitespace, wrapping code, bold, or quote markup, and trailing sentence punctuation) but still rejects
  typos, extra words, and other content.

Everything else about the path is a diagnostic: extra, repeated, recovered, or confirmation calls, failed read
probes (for example a missing `AGENTS.md`), relative-versus-absolute path retries, the choice among equivalent write
tools, and call counts or order the prompt does not require. Materially worse paths use `impact: "degraded"`; neutral
observations use `impact: "info"`. Evaluators never require exact call counts, exact call sequences, or exact
argument JSON.

Runtime evals run with the product default `tools.codeMode: "on"`, so the model may call tools directly or inside an
`exec` script. Evaluators inspect only `toolCalls`: the runner traces every executed tool, including calls nested in
`exec`, with its actor thread and client `turnIndex`, and never traces `exec` itself. Agent-loop hooks see only
top-level calls, so a task that reacts to a tool result uses `observeToolTrace(world, trace)` instead of
`onToolResult`. Protocol-action triggers match nested `tool_end` events as well.

## Runtime evidence and isolation

Every runtime task/profile execution receives a fresh temporary project, runtime-state root, app server, and any
task-owned plugin, local stdio MCP, hook, or full-output resources. The runner records bounded, path-normalized
provider context, advertised-tool snapshots, normalized protocol notifications, core and runtime events,
actor-attributed tool traces, protocol actions, `thread/read` snapshots, parent and child session JSONL, workspace and
runtime-state manifests, and verifier output. Image evidence retains media metadata and sidecar state while raw base64
is omitted; credentials and undeclared host paths are not report evidence. Deterministic code evaluates this
allowlisted evidence.

The tool transformer runs after runtime mode filtering. It removes undeclared capabilities, confines project access to
the fixture, permits only explicitly registered read-only output paths outside it, rejects symlinks and non-exact shell
commands, records bounded traces, and stops over-budget calls before the underlying tool executes. Runtime-state
changes are checked against each task's declared mutation categories. The runner constructs fixture-owned
`RuntimeConfig` values and does not load host config, credentials as runtime configuration, global plugins, skills,
agents, memory, or sessions. Fixture resources are cleaned on success, failure, and timeout. Evidence normalization
maps every spelling of the fixture root (including the macOS `/private` alias and the Windows `C:/...` form) to
`$WORKSPACE`.

`packages/e2e/app-server` contains deterministic `DiligentAppServer` end-to-end tests through its JSON-RPC boundary.
It uses fake provider streams and does not cover product hosts or thin-client rendering. Live provider conversation,
tool recovery, image transport, shell, and file behavior are owned by the core and runtime eval suites.

## Shadow status

One scheduled workflow starts daily at 21:00 UTC (06:00 KST) under the shared, non-cancelling `model-evals`
concurrency group. Its direct-job graph is:

1. Core runs on Ubuntu as concurrent OpenAI and Anthropic jobs. Each job passes exactly one provider and executes the
   7-task suite, for 14 task/profile executions in the phase.
2. After the complete core matrix finishes, runtime runs even if core failed. Four jobs cover Ubuntu and Windows
   crossed with OpenAI and Anthropic. Each job passes exactly one provider and executes 34 tasks, for 136 executions:
   the same 68 task/profile pairs sampled once on each operating system.
3. The capability matrix runs in parallel with core as one Ubuntu job each for OpenAI, Anthropic, and Gemini. Each job
   covers that provider's whole catalog.
4. A final always-running aggregate job fails the workflow unless every complete matrix phase succeeded. Per-job
   report uploads also run after failures and use provider/OS-specific paths and artifact names.

All jobs in one scheduled run derive the same root seed from the repository, GitHub run ID, and commit SHA. The two
runtime operating-system samples expose platform-specific harness or product behavior; they are correlated executions
of the same fixture/model contracts, not independent draws whose pass rates can be multiplied into a quality
probability.

The standalone core, runtime, and capability workflows remain available through `workflow_dispatch` and
`workflow_call`, but have no schedule and therefore do not duplicate the daily graph. They may filter to one task,
capability, model, or provider; leaving filters empty preserves their complete-suite behavior. Scheduled and standalone
workflows remain shadow signals disconnected from Release.

## Model capability matrix

`bun run eval capabilities` runs five capability probes through an in-process `DiligentAppServer` for every catalog
model of the selected providers. Without `--provider` it covers OpenAI, Anthropic, and Gemini with API keys. ChatGPT
OAuth is a separate auth path selected with `--provider chatgpt`. `--model <id>` narrows the run to one model and
`--capability <id>` to one probe. Each probe grades the end result from captured evidence:

| Capability | Probe | Passes when |
|---|---|---|
| `basic_response` | One tool-free turn | The reply is exactly the seeded token |
| `web_search` | Provider-native `web_action` | A native search returns results, and the answer cites a URL whose host appears in them (a bare-domain result title also counts, for providers that return redirect URLs) |
| `image_read` | `read_image` on a four-quadrant PNG with seeded colors | Every quadrant color is reported exactly |
| `image_generation` | A probe tool that calls the runtime `generateImage` binding | The image validates, `thread/read` exposes it on the tool result, and the model names the color measured from its pixels. The model is never told the requested color. |
| `compaction` | `thread/compact/start` on an eligible thread, then one more turn | Compaction reports `compacted`, and the next reply restates both seeded facts |

API-key profiles register their key in `ProviderManager` as the product does. Native compaction for OpenAI and
Anthropic therefore runs the provider endpoint; Gemini uses summarization.

Every cell has one of four statuses. Only `PASS` counts as a pass:

- `PASS`: the probe passed, possibly with degraded diagnostics.
- `FAIL`: the probe ran and failed, including provider rejections other than authentication, such as an unknown model.
- `NOT RUN`: the capability is supported, but an unset API key, an authentication rejection or expiry, or a
  subscription usage limit prevented a valid live call.
- `UNSUPPORTED`: Diligent does not offer the capability for that model, so nothing ran. Image generation is bound only to
  ChatGPT OAuth, and image reading requires a vision-capable model card.

The command exits 1 when any cell is `FAIL` or `NOT RUN`. It writes the full evidence report (`--report`, default
`artifacts/evals/capabilities-<timestamp>.json`) and a Markdown matrix next to it with the same name and a `.md`
extension. In GitHub Actions the matrix is also appended to the job summary. A failed or not-run cell lists its code and
reason below the table. The JSON report keeps the per-execution evidence under `executions`.

```bash
# Whole API-key matrix; set OPENAI_API_KEY, ANTHROPIC_API_KEY, and GEMINI_API_KEY
bun run eval capabilities

# One provider, one capability, or one model
bun run eval capabilities --provider gemini
bun run eval capabilities --provider anthropic --capability web_search
bun run eval capabilities --provider openai --model gpt-6.2-sol
```

Provider keys come only from the repository's GitHub Actions secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`) or the local environment. Never commit them or paste them into logs or chat. Reports redact the
configured keys and OAuth tokens. A missing secret shows up as `NOT RUN` cells for that provider.

Before a release, dispatch **Model Capability Evals** (all providers) and **ChatGPT OAuth Evals**, then confirm that
both matrices contain no `FAIL` or `NOT RUN` cells. To rerun one failure, dispatch the same workflow with the provider,
model, capability, and the root seed recorded in the report.

## ChatGPT OAuth on the shared runner

GitHub-hosted runners never hold ChatGPT credentials. **ChatGPT OAuth Evals** runs on one self-hosted runner labeled
`diligent-chatgpt-oauth`, signed in with an approved test account. It runs the ChatGPT capability matrix and the core
agent suite with `--non-interactive`. Personal OAuth sessions and tokens are never copied to CI or to this runner.

One-time setup on the shared machine:

1. Create a dedicated OS user for the runner. Register the runner with the `diligent-chatgpt-oauth` label in a runner
   group restricted to this repository and to `.github/workflows/chatgpt-oauth-evals.yml` on the default branch. The
   repository is public, so the workflow must never gain `pull_request` triggers, and outside contributors' workflow
   runs must require approval.
2. In the runner's `.env` file, set `DILIGENT_EVAL_CHATGPT_AUTH_FILE` to an absolute path in that user's home, for
   example `/Users/diligent-evals/.diligent-evals/chatgpt-auth.jsonc`. The runner does not expand `~`. The auth store
   writes the file with owner-only permissions.
3. As that user, in a checkout of this repository, run
   `bun run eval chatgpt-login --chatgpt-auth-file "$DILIGENT_EVAL_CHATGPT_AUTH_FILE"` and complete the browser
   sign-in with the test account. The command prints the sign-in URL, and the callback listens on `localhost:1455`. On
   a headless machine, forward that port over SSH and open the printed URL locally.
4. Set the repository variable `CHATGPT_OAUTH_EVALS_ENABLED=true` to enable the daily 22:00 UTC schedule. Manual
   dispatch works without it.

Token refresh is automatic and rotated tokens are written back to the file. When the refresh token expires or is
revoked, every ChatGPT cell becomes `NOT RUN` with code `provider_auth.credentials_rejected`, or
`provider_auth.credentials_missing` if the file is absent. The job then fails without opening a browser. To renew, repeat
step 3 on the shared machine and re-dispatch the workflow. Failures appear in the run's job summary and in the
`chatgpt-oauth-evals-*` artifact (`chatgpt-capabilities.{json,md}` and `chatgpt-core.json`).
