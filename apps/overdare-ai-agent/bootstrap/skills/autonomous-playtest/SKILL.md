---
name: autonomous-playtest
description: Generate and maintain a game-specific Luau playtest controller from the current OVERDARE project's code, with observed state transitions and meaningful runtime model decisions. Use to play a game autonomously, exercise gameplay scenarios, or improve an editable harness. Not for GUI-only styling or offline unit tests.
---

# Autonomous Playtest

Diligent generates and repairs the game's observation, control and verification adapter; the configured decision provider makes the intended play decisions at runtime (Laya by default). Keep game bindings and outcome checks in Studio code and use the shared runner for physical input. Respect the user's scope and budget. A playtest request does not authorize changing gameplay rules to make it pass.

## Establish the objective

Read the relevant game/controller code, GUI, state transport and objects. Identify the user's goal, entry conditions, important controls and authoritative success/failure signals. Clarify only a material objective or mode that cannot be inferred.

Identify the actual open Studio game and request host before using project files or logs. In dev-cross, the mounted working directory can belong to a different game. An old log or successful adapter from that directory is not evidence for the open level.

For play/survive/clear requests, prioritize productive gameplay. Control demonstrations and negative cases are temporary diagnostics when needed, not mandatory gameplay stages. Check whether completion fits the runner's session lifetime and whether restarting resets progress. Distinguish mission completion from any subsequent escape.

For exploratory player simulation, preserve discovery, uncertainty and recovery choices. Use game code to understand controls and verify results without supplying a hidden solution route to the policy. Distinguish player-observable decision facts from privileged verification facts; code access alone does not justify giving the model every hidden item or hazard. Successful scripted traversal does not establish autonomous exploration or representative human behavior.

Derive a small test inventory: source/symbol, setup, relevant behavior and evidence. Cover what matters to this objective. Input completion, displacement, intended landing and goal completion are different claims.

## Design the controller

For a complex harness or unclear model responsibility, read [references/controller-design.md](references/controller-design.md). Preserve working executors and expose useful movement, look and interaction choices alongside any requested short assists. Plain functions and a small table may suffice. Separate legality from adjustable preferences so nearest-target or early-deposit heuristics do not silently reduce every strategic branch to one action. Action size alone does not determine autonomy: identify which decisions belong to the model and which the executor makes.

Let users adjust control assistance and test goals/constraints independently through Diligent. Keep supported settings explicit in a small editable adapter configuration; use existing run arguments for goal, duration and watchdog settings. A natural-language request should change the relevant configuration and its implemented behavior, not require rewriting a route. Preserve unrelated settings, surface only material ambiguities, and report the applied settings and enforcement limits. These are harness/test controls, not permission to change game difficulty rules.

For implementation and coverage details, read [references/authoring.md](references/authoring.md). Derive bindings from the current game; do not assume another game's state library, input route or GUI. Bounded direct controls and short assists can share ordinary action candidates. Use optional action.intent only when deliberate multi-step commitment fits the requested control scope; it must not silently replace model-led exploration with a fixed plan. Lua still has no semantic model-choice callback; do not infer a choice from candidate publication.

With structured observations, meaningful spatial and local-state transitions may fit better than raw key choices. Choose the decision boundary to match the test: selecting a target can retain approach, focus and interaction under one intent; testing those mechanics separately can expose them as distinct choices. Preserve alternative targets and strategies without asking the model to rediscover every prerequisite after each successful camera adjustment.

For GUI/prompt interactions, adjacent controls, shared inputs or repeated focus switching, read [references/interaction-state.md](references/interaction-state.md). Map the selected target, native GUI/focus, actual input recipient and authoritative result separately. This reference also covers target-level commitment and compact outcome memory.

## Install or maintain

Use `studiorpc_game_playtest_harness` list/read to discover actual names and current source/hash. `found:false` is normal recoverable absence; a failed RPC is not evidence of absence. Read describe when first authoring or compatibility is uncertain and reuse its contract within the task.

Keep Source writes in the harness tool. Install creates the adapter and managed driver; update checks expectedSourceHash and refreshes the driver. Inspect validation and readback. Initialize composed dependencies explicitly and preserve their versions. Do not edit during PIE or depend on another harness driver to initialize shared state.

## Run and assess

Use `studiorpc_game_playtest` for an owned start/play/stop episode. It refuses existing PIE; do not take over another session. For Laya, verify native Ollaya on the request host: dev-cross localhost refers to the sidecar host, which may differ from Studio. For OpenAI Decisions, configure server-side API credentials and select the provider explicitly; existing ChatGPT sign-in is not automatically reused. Preserve unrelated services/settings.

Choose the observation mode explicitly for visual comparisons. `structured+image` captures actual PNGs at model-decision boundaries and requires an image-capable provider, one targeted client and sidecar-readable captures. Check screenshot roots when hosts differ. A missing or stale image is not a successful visual run, and retained/singleton input steps still use structured checks. Keep pixel evidence separate from game-authoritative outcomes; switching providers does not repair unavailable harness capabilities.

Record and reuse explicit run arguments when comparing revisions or resuming a task, including the decision interval, model/endpoint and watchdog. Record adapter assistance separately: run arguments do not automatically change Studio configuration. Preparation/reporting time and the owned gameplay deadline are different budgets.

The default watchdog stops after 15 seconds without meaningful progress. Supply game-specific progress and bounded normal-wait signals; follow any explicit user timeout. Diagnose stuck results before further bounded runs.

Inspect summaryPath, tracePath and coveragePath. Separate game outcomes, execution errors, missing coverage and decisionEvidence. For model-mediated play, verify a genuine candidate -> model choice -> dispatch -> observed effect chain at an intended decision point. A successful episode with not_exercised still leaves model participation unverified. Diagnose collapsed branches; duplicate candidates or unnecessary forced-step calls do not fix this.

Coverage is over declared targets only. Availability, selection, input completion and confirmed effects are distinct. A win does not prove every target, and tested mechanics do not prove a win.

## Improve from evidence

Locate the responsible boundary, repair it between runs, revalidate and rerun when warranted within the authorized budget. Preserve actual outcomes and source versions. Track saved/validated, offered, selected, dispatched and confirmed separately: a run that never reaches the changed behavior does not verify it. Earlier successes do not certify the final source. Report the concrete blocker instead of repeatedly retrying unchanged failures or relaxing assertions.

For better play or a reported weakness, read [references/improvement.md](references/improvement.md). For discovery, service, startup, timing, stuck or effect-analysis failures, read [references/diagnosis.md](references/diagnosis.md). Report measured timing scopes and actual model participation, not a universal FPS or latency claim.
