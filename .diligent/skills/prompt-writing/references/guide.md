# Prompt Writing Guide

A guide for writing system prompts, skills, repository instruction files such as `AGENTS.md`, and agent/subagent
prompts for current frontier LLMs.

## How to read this guide

- Sections are ordered by topic. Example prompts in `text` code blocks are ready to adapt and reuse.
- Short italic lead-ins at the top of each section connect the topics. They add no new rules.
- The guidance describes behavior observed in recent frontier LLMs. The principles transfer, but behavior differs
  between LLMs, so re-validate each claim against the LLM you are actually targeting.

---

## 1. Core principle: instructions age with the LLM

*Prompts written to compensate for older LLMs' weaknesses become liabilities on newer ones. Before adding an
instruction, ask whether the current LLM still needs it.*

Coding agents have come a long way, and best practices are changing fast. With more capable models, what used to require a lot of handholding and scaffolding no longer does.

If you've been using coding agents for your projects over the last year, you've likely accumulated a lot of instructions as you worked to steer the models toward good outcomes. With each release, it's been worth revisiting those assumptions, but with the newest LLMs, it's more important than ever.

These instructions can take many forms: skills, `AGENTS.md`, and your task prompts are all shaping how the model gets work done.

A new LLM performs well out of the box on existing prompts written for its predecessor. The patterns in this guide cover the behaviors that most often require tuning.

A new model is a good opportunity to clean your house, but you don't need to review everything manually: ask the LLM to do an audit based on this guide, then go build something you wouldn't have attempted before!

---

## 2. Know what the LLM already does well

*Prompt effort should go where the LLM needs steering, not where it is already strong. Several of these capability
changes carry direct prompt-writing rules.*

Compared with previous LLMs, the improvements most relevant to prompting are:

* **Agentic coding:** The LLM is strongest on difficult coding tasks: multi-file features, larger refactors, and end-to-end feature work. It completes full tasks rather than leaving stubs or placeholders, and it performs best when given the complete task specification up front and left to run. It also performs well on easier tasks like single-turn edits, where the difference from prior models is smaller.
* **Code review and bug-finding:** The LLM reviews code with high precision and recall: it finds real bugs at a high rate per pass, and its additional findings are mostly real issues rather than false positives. Accuracy holds at lower effort settings, which supports a fast pass at review time and a more thorough pass later. If your review prompt says "only report high-severity issues" or "be conservative," the model may follow that instruction literally and report less; ask it to report everything and filter in a separate pass instead.
* **Efficiency at lower effort:** Lower reasoning effort settings produce strong quality at a fraction of the tokens and latency of higher settings. Start with the default and adjust based on your evals: use lower settings liberally as your primary control for token cost and response time wherever quality holds, and step up to the highest settings for demanding coding and agentic work. If you carried effort defaults over from a prior model, re-run an effort sweep on your own evals.
* **Vision:** The LLM is strong on chart, document, and diagram understanding, and on UI and frontend visual replication. Re-validate any prompt-side vision workarounds you tuned for prior models; they may no longer be needed. Vision performance is strongest when the model has tools to iteratively analyze, crop, and visually verify its work, and tool use is a more cost-effective lever than thinking alone.
* **Long-context work:** The LLM's instruction following, tool calling, and reasoning stay consistent throughout a large context window.
* **Office and document tasks:** The LLM generates and works with complex, multi-sheet spreadsheets with non-trivial formulas, and it produces well-structured slide decks. Prompt it with any specific styles or templates it needs to follow.
* **Multi-agent coordination:** The LLM coordinates teams of subagents well, with effective writer-verifier patterns and few cases of agents overwriting each other's work. For cost-sensitive workloads, cap delegation; see [§6 Subagent delegation](#6-subagent-delegation).

---

## 3. Where instructions live

*Instructions reach the LLM through different channels with different costs. Skills are loaded on demand, but their
names and descriptions are always in context. Repository instructions such as `AGENTS.md` apply to every task. Write
each channel for how it is loaded.*

### 3.1 Skills

These instructions can be in the form of skills, which are essentially prompts stored as Markdown files that can also be packaged with resources and bundled scripts. Generally, they are most useful for guidance around a specific workflow, or when using certain apps.

People now default to packaging a lot of skills into their projects, and each skill comes with a name and description that are loaded into the model's context so it knows when to use them. But many descriptions are far too long, and when you add too many skills, the agent harness starts shortening their descriptions to fit. The model ends up seeing less of each description, making it harder to know which skill to pick.

What's worse is that descriptions can often contradict each other or over-emphasize when skills should be used, leading the model to load instructions that don't actually help the task.

If you use a skill-creation skill or template, keep its guidance up to date so it helps mitigate the failure modes below.

#### Rule 1 — Short, precise descriptions

First, skill descriptions should be as short as possible while making it clear when the model should use them:

| | Skill description |
|---|---|
| Bad | Create and validate Postgres schema migrations. Use when working with databases, queries, models, or persistence. |
| Good | Create and validate Postgres schema migrations. Use when adding or changing a migration, or reviewing its rollout. |

_Here, the bad skill description can push the model to use it anytime it touches anything related to a database, rather than only when it has to handle a migration._

#### Rule 2 — Progressive disclosure

Second, one of the key markers of a useful skill is progressive disclosure. Reading a skill takes up context, bringing you closer to compaction and introducing guidance that may not apply to the task. For skills with multiple workflows, make the root document a minimal router that points to supporting docs and scripts. Give the model enough guidance to know where to look without forcing it to read things that don't matter in the moment.

#### Rule 3 — Guidance over itineraries

Third, many skills were written as elaborate itineraries or recipes. Models have gotten much better at understanding nuance and ambiguity, so overly specific guidance can now hinder results where it previously helped.

#### Rule 4 — Consider every model that will read it

Repository skills also guide other contributors' agents, which may use different models. Guidance that helps one LLM may overconstrain another, so consider which models will use the instructions you leave behind.

### 3.2 Always-on repository instructions (`AGENTS.md`, system prompts)

Because [`AGENTS.md`](https://agents.md) applies whenever the model works in your repository, you should frequently revisit each instruction and ask yourself whether it's still needed.

Requiring a stack of docs or a full repo map before every edit is excessive for a typo fix. The LLM can work out what it needs to read without being pushed to review the whole project before every change.

| | `AGENTS.md` context |
|---|---|
| Bad | Before every edit, read architecture.md, database.md, and deployment.md. |
| Good | Use architecture.md for service boundaries, database.md for schema changes, and deployment.md when preparing a deployment. |

_Prompting the model to read files before every edit is a great way to burn context and slow work down. Pointing to some docs can still be helpful, however, so long as it is contextual. Be sure to keep your docs updated too!_

---

## 4. Remove redundant verification and re-check instructions

*Current LLMs test, verify, and self-correct without being asked. Legacy "verify", "double-check", and "run the
tests" instructions now compound with built-in behavior and waste tokens.*

Previous models needed encouragement to run tests and check their work. The LLM does that on its own, so the same instructions can lead to unnecessary testing.

The LLM verifies its own work without being told to. If your prompt contains explicit verification instructions ("include a final verification step for any non-trivial task," "use a subagent to verify"), remove them: instructions like these cause over-verification, and removing them reduces wasted tokens with no loss in quality. The same applies to legacy harness scaffolding that adds separate verification steps.

The LLM catches and fixes its own mistakes well without prompting. Avoid instructing re-checks it already performs ("double-check your answer," "re-verify before responding"); like verification instructions, these compound with the model's own behavior and add cost without improving results.

---

## 5. Scope, boundaries, and persistence

*LLMs can drift in either direction here, so the same principle can call for opposite tuning: **state the intended
scope and the definition of done explicitly.** An LLM that expands scope needs a constraint; an LLM that stops early
needs permission and a completion definition. Old boundary language written for a different LLM can push either one
the wrong way.*

### 5.1 Constrain scope when the LLM expands it

The LLM can also expand the scope of a task, adding steps that weren't requested or applying its own judgment about what the task should be. For narrow tasks, constrain scope explicitly:

```text
Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in only when different readings of the request would lead to materially different work. If the request seems mistaken or a better approach exists, say so in a sentence and continue with the task as asked rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop short of actions that are clearly beyond what was asked.
```

### 5.2 Grant explicit permission for known-safe workflows

The LLM is thorough, but it can be more tentative about how far to take a task. Sometimes it needs a little push to keep going. You can use `AGENTS.md` to give it permission for a specific workflow you know is safe, such as a local test suite:

```text
The local tests use disposable fixtures and have no production access. Run them, fix failures caused by the requested change, and rerun affected tests without asking for approval at each step.
```

### 5.3 Re-calibrate decision boundaries

Pay careful attention to how you describe boundaries. If a previous model did things on your behalf without permission, you may have added strong language to make it ask first. That can be useful, but a well-aligned LLM has much better judgment and will not perform tasks unless it knows it is safe – so you should treat it as such.

If you stated boundaries previously because you wanted to prevent other models from going too far and you're now switching to a new LLM, consider updating that language: the LLM could take it too seriously and may stop work where you'd actually be happy for it to continue.

### 5.4 Define completion before starting

If you're used to a previous LLM taking a request and continuing for long stretches, a new LLM can feel more tentative about when to stop. It may reach a first implementation and come back for your review while there's still work to do.

This is where it helps to define completion before starting. You might need to push the LLM to continue until it's fully done. If the task includes getting the implementation running, inspecting the result, and fixing what fails, make that part of the request. A requirement to stop for review after the first implementation will pull the model toward an earlier stopping point, so check whether that's a decision you actually need to make.

If you want it to keep exploring beyond a first pass, say what you want explored and where it should stop.

---

## 6. Subagent delegation

*Agent and orchestrator prompts should say when delegation is worth its cost, and harnesses should back that with
deterministic caps.*

The LLM delegates to subagents more readily than prior models. Delegation pays off on genuinely independent, sizeable tracks of work, but it multiplies cost and time when applied to small tasks. If your harness supports subagents, give explicit guidance on which scenarios warrant delegation, or set deterministic caps on how many agents can be launched. For example:

```text
Delegate to a subagent only for large tasks that are genuinely independent and parallelizable, such as a wide multi-file investigation. Do not delegate work you can finish yourself in a handful of tool calls, and do not use subagents to verify or double-check your own work. If one subagent can complete the task, use one rather than several, and keep spawn counts low.
```

If your harness supports them, deterministic caps on subagent spawn depth, concurrency, and spend are the most reliable control. Check whether your harness's built-in system prompt already includes a delegation instruction; with a custom or omitted system prompt, add a delegation instruction such as the example in this section yourself.

---

## 7. Communication and output length

*Length is controlled by prompting, not by effort settings. Tune each output surface separately: chat responses,
in-task progress updates, files written to disk, and corrections to earlier statements.*

### 7.1 Response length

The LLM's default user-facing responses run longer than prior models'. The reasoning effort setting controls how much the model thinks rather than how much it says: lowering effort can reduce thinking volume without reliably shortening the visible response. To control response length, prompt for it explicitly.

A short conciseness instruction is effective. For example, for a user-facing multi-turn product:

```text
Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.
```

In a long system prompt, pair the instruction with a short reminder near the end of the prompt:

```text
<tone_preference>
Keep outputs reasonably concise.
</tone_preference>
```

### 7.2 Progress updates during agentic work

The LLM narrates readily during agentic work: it tends to announce what it is about to do, and its per-message output in agentic sessions is often longer than prior models'. It benefits from explicit guidance on how to communicate with the user during a task. To tune narration down, describe the cadence and shape you want:

```text
Before your first tool call, say in one sentence what you're about to do. While working, give a brief update only when you find something important or change direction. When you finish, lead with the outcome: your first sentence should answer "what happened" or "what did you find," with supporting detail after it for readers who want it.
```

To tune narration up, or change its style, the same lever applies in the other direction: explicitly describe what updates should look like and provide examples. Positive examples of the communication style you want tend to be more effective than instructions about what not to do.

### 7.3 Written deliverables

Separate from conversational verbosity, files that the LLM writes to disk (reports, Markdown documents, summaries) are often longer than on prior models. If your product includes LLM-authored documents, add explicit length calibration:

```text
Match the length of written documents to what the task needs: cover the substance, but do not pad with filler sections, redundant summaries, or boilerplate.
```

### 7.4 Correction narration

The model also narrates corrections to its earlier statements more than prior models do, which can be undesirable in user-facing products. To limit correction narration to corrections that matter:

```text
Only correct an earlier statement when the error would change the user's code, conclusions, or decisions. State corrections plainly and briefly, then continue the task. For slips that change nothing for the user, make the fix and move on without noting it.
```

---

## 8. Running with reasoning disabled

*Applies to system prompts for integrations that turn reasoning off. The preferred fix is configuration (keep
reasoning on, lower effort); the prompt-side fix is a single general instruction.*

Some LLMs run with reasoning on by default and allow it to be disabled only at some effort levels. With reasoning disabled, two artifacts can occasionally appear in the model's visible output. The primary mitigation for both is to keep reasoning enabled and control token cost with lower effort levels instead of disabling reasoning: for most tasks, reasoning enabled at low effort performs better than reasoning disabled at similar cost.

**Tool calls as text.** With reasoning disabled, the model occasionally writes a tool call into its user-facing text instead of emitting a structured tool call. The turn completes normally and the call never runs, and in agentic loops the leaked text stays in the conversation history, so later turns are affected as well. This is most common on tool-heavy workloads such as search.

**Internal XML tags in output.** With reasoning disabled, the model can emit internal XML tags into its visible response. If your system prompt contains a rule instructing the model not to think or not to reason, remove it; that kind of instruction increases tag leakage.

For integrations that must keep reasoning disabled, a single combined instruction mitigates both artifacts: it gives the model explicit permission to speak before a tool call, an alternative to forcing a call when no tool fits, and a general rule against internal tags:

```text
When you use a tool, you may say a brief sentence first. If no tool can express what the user asked for, say so instead of guessing. Do not include internal or system XML tags in your response.
```

Instructions that call out specific tags by name are less effective than the general form, so avoid naming them specifically.

---

## 9. Authoring checklist

Summary of the sections above, organized by artifact type. Each item points back to its section.

### Every prompt

- [ ] Each instruction is still needed for the target LLM; legacy scaffolding is removed (§1, §4).
- [ ] No explicit "verify", "double-check", "re-verify", or "run tests to check your work" instructions that the
      LLM already performs (§4).
- [ ] Scope and definition of done are stated explicitly (§5.1, §5.4).
- [ ] Boundary language is calibrated for the current LLM, not inherited from an LLM that overstepped (§5.3).
- [ ] Desired behavior is shown with positive examples rather than only "do not" rules (§7.2).
- [ ] Length is controlled by explicit instruction, not by effort (§7.1).

### System prompts

- [ ] Conciseness instruction, plus a short reminder near the end if the prompt is long (§7.1).
- [ ] Progress-update cadence and shape for agentic sessions (§7.2).
- [ ] Length calibration for written documents, if the product writes files (§7.3).
- [ ] Correction narration limited to corrections that matter (§7.4).
- [ ] Delegation guidance when using a custom or omitted system prompt with subagents (§6).
- [ ] If reasoning is disabled: no "do not think/reason" rules; use the single general instruction (§8).

### Skills

- [ ] Description is as short as possible and states precisely when to use the skill (§3.1 Rule 1).
- [ ] Descriptions do not contradict or over-emphasize relative to other skills (§3.1).
- [ ] Multi-workflow skills use a minimal root router pointing to supporting docs and scripts (§3.1 Rule 2).
- [ ] Guidance, not an elaborate itinerary or recipe (§3.1 Rule 3).
- [ ] Written with every model that may read it in mind (§3.1 Rule 4).

### `AGENTS.md` / repository instructions

- [ ] Doc pointers are contextual ("use X for Y"), never "read X before every edit" (§3.2).
- [ ] Known-safe workflows are explicitly permitted to run without step-by-step approval (§5.2).
- [ ] Referenced docs are kept up to date (§3.2).

### Agent and subagent prompts

- [ ] Complete task specification is given up front (§2).
- [ ] Review prompts ask for everything and filter in a separate pass, not "only high-severity" (§2).
- [ ] Completion includes running, inspecting, and fixing when that is expected (§5.4).
- [ ] Exploration beyond a first pass states what to explore and where to stop (§5.4).
- [ ] Delegation is limited to large, independent, parallelizable work, with deterministic caps where supported (§6).
- [ ] Styles or templates for documents, spreadsheets, and slides are supplied when required (§2).
