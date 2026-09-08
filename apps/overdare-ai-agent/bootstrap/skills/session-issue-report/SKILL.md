---
name: session-issue-report
description: Report a Studio / OVERDARE-agent / diligent-tool defect, or the agent's own wasted effort, to the internal Slack channel with redacted session context. Fire it on your own judgment mid-task the moment you conclude that (1) a tool, RPC, or documented contract is broken, missing a capability the work genuinely needed, or behaving against its own schema or description, or (2) the work itself went wrong — a tool was misused, something already built got rebuilt, or many turns went into an approach that proved wasted. Those two conditions are the entire trigger, and they hold from either seat — the model working inside the agent, and the model driving that agent over MCP or a subagent call. Nobody will ask you to do this — the driver is usually another model rather than a person, and no harness prompts for reports, so do not wait for a request or a conversational cue. Internal only — needs DILIGENT_ISSUE_WEBHOOK and is gated off outside the dev channel.
---

# Session Issue Report

Studio work fails in ways nobody finds out about. A tool returns a schema error the agent
silently works around; a capability is missing so the agent invents a detour; the agent
rereads the same three files for eight turns and then gets it right. None of that raises
an alert, none of it reaches a backlog, and whoever was driving the session has already
moved on.

This skill is the manual path for that: **you noticed something, so you say so.** One
Slack message, with enough context that whoever reads it can act without replaying the
session.

It is deliberately judgment-first. There is no detector and no threshold — you decide.
That is the whole point: a heuristic can catch a tool erroring three times, but only you
can tell that the tool's *description* was ambiguous, or that your own second attempt was
the wasted one.

## Who fires this, and from which seat

Two vantage points reach this skill, and they see different evidence. Name yours in the
report, because a reader weighs the two differently.

**Inside the agent** — you are doing the Studio work. You have the tool results, the exact
errors, your own turn history. This is the richest evidence and the common case.

**Driving the agent** — you are an orchestrator, eval harness, or another session steering
this agent through MCP or a subagent call. You cannot see its internal tool traffic, but
you see something it cannot: whether the task *actually* succeeded, and how much it cost.
"It reported success and the level is still wrong" and "it took forty turns for a
one-line change" are judgments only this seat can make.

From the driving seat, pass `--session` explicitly. The script otherwise picks the
most recently written transcript, which may well be your own rather than the agent's — the
two live under different storage namespaces (`.overdare/sessions` for the OVERDARE agent,
`.diligent/sessions` for a diligent CLI run).

## Two kinds of report

**`product`** — the defect is not yours. Studio, the OVERDARE agent, a diligent tool, or a
documented contract is at fault: a tool that errors on input its own schema says is valid,
an RPC that returns success and changes nothing, a capability that plainly should exist and
does not, a doc that describes behaviour the build does not have.

**`self`** — the defect is yours. You misread a tool's contract, you repeated a call that
could not have worked, you rebuilt something that already existed a directory over, you
took fifteen turns on what two would have done. Report these with the same candour you
would want from a colleague; the point is to find the *system* reason it happened (a thin
tool description, a missing example, a confusing name), not to flagellate.

Most reports worth sending are `self` with a `product` cause underneath — "I passed
`"2px"` four times because the schema says `number` but the tool description gives no unit
example." Pick the kind by who most needs to act, and say the other half in the body.

## The bar

Send when a competent teammate reading the message would say *"good, I want to know
that."* That is a higher bar than "something went wrong" and a lower one than "I can prove
it is a bug."

Worth sending:

- A tool rejects input that its own schema and description say is valid.
- A write reports success and the scene / file is unchanged.
- A capability was genuinely needed, properly searched for, and does not exist — say what
  it was needed *for*, since that is the part a backlog entry cannot reconstruct.
- An earlier approach turns out to be wasted work, and there is a nameable reason a future
  agent would fall into it too.
- The same failure recurs after the approach changed — recurrence across *different*
  attempts is much stronger evidence than three identical retries.

Not worth sending:

- One transient failure that succeeded on retry. Networks flake.
- A tool erroring on input that was genuinely wrong — that is the tool doing its job.
- A single misstep that was corrected immediately. Ordinary work.
- The caller changing their mind, or asking for something else. Not a defect at all.
- Anything unverified: if it is unclear whether the RPC applied, check before reporting. A
  confidently wrong report costs a reader more than silence.
- The same thing twice in one session. The script blocks exact duplicates, but do not lean
  on it — a second report with a slightly different title gets through and is noise.

When genuinely unsure, the tiebreaker is whether you can name a concrete change someone
could make. If you can, send it. If the report would amount to "this felt hard," keep
working instead.

## Sending

Write the body to a heredoc and pipe it in. `--kind` and `--title` are the only required
flags; the session tail is attached for you. The script sits next to this file — use the
path this SKILL.md was loaded from.

```bash
printf '%s' "$(cat <<'EOF'
**Seat:** inside the agent.

**What I was doing:** placing a UIStroke on the level's HUD frame.

**What happened:** `studiorpc_instance_upsert` rejected `Thickness: "2px"` with
`INVALID_PROPERTY`, four times, once per unit spelling I tried.

**Why I think this is reportable:** the schema types `Thickness` as `number`, but the
tool description carries no unit example, so "2px" is the natural first guess. I only got
it right by finding a number in an unrelated recipe.

**What would have helped:** one `Thickness: 2` example in the tool description, or an
error that says "expected a number of studs".
EOF
)" | python3 skills/session-issue-report/scripts/send_report.py \
      --kind product \
      --title "instance_upsert rejects UIStroke.Thickness with units; description has no example"
```

Useful flags: `--dry-run` prints the exact Slack text without posting (use it to check the
redaction or the tail first), `--tail N` changes how many session entries ride along
(default 30), `--session PATH` pins a specific transcript — required from the driving seat.

The script reads `DILIGENT_ISSUE_WEBHOOK` from the environment. **If it is unset it prints
a note and sends nothing** — that is not a failure, so do not retry it and do not go
looking for the URL. Report the finding in your reply instead, and mention the variable is
unset so the caller can decide whether to set it.

## Writing a body someone can act on

Four things, in this order, because it is the order a reader needs them:

1. **What you were doing** — one sentence of task context, plus which seat you occupied.
   Without it the rest is noise.
2. **What happened** — the observable facts. Exact tool name, exact error, how many
   attempts, what changed between them.
3. **Why you think it is reportable** — your reasoning, including which kind it is and why.
   This is the part no log can produce, and it is why a model is writing the report instead
   of a monitor.
4. **What would have helped** — the concrete change. A reader who agrees should be able to
   turn this line into a ticket.

Describe rather than dump. The session tail is already attached, so quoting long tool
output into the body just buries the reasoning. Never paste the caller's prompts
verbatim — say what was asked for. Secrets are redacted on the way out (the same
`secrets-2` patterns the sidecar uses), but that is a safety net, not a licence: this path
has no gateway and no consent gate behind it, so whatever is written leaves the machine as
written.

## After reporting

State one short line — what was reported and why — then **carry on with the task**.
Reporting is a side effect, never a reason to stop, ask permission, or change the plan. If
it did not send (no webhook, HTTP error), that is also just a line in the reply; the work
still matters more than the telemetry.

## Availability and gating (internal)

This skill ships inside the agent bundle (`apps/overdare-ai-agent/bootstrap/skills/`) so the
in-agent model can reach it at all. Three things have to line up before a report can
leave, and in a normal creator install none of them do.

**1. The experiment must be on.** `issue-report` in `sidecar/src/experiments.ts` lists this
skill under `skillNames`, and a disabled experiment drops it from the model's skill list
outright (`runtime.ts` filters on `disabledSkillNames`), so a creator never learns it
exists. Its `defaultEnabled` follows the release channel — on only when the sidecar's
`DILIGENT_ENV` is exactly `dev`, matching `plugin-sdk`'s `currentEnv()`.

**2. Something has to put the sidecar on the dev channel**, which is less automatic than
"it is a dev build". The launcher resolves its own channel from `--agent-env`, then a
`DILIGENT_ENV` variable, then a compile-time value, and falls back to **prod**
(`apps/overdare-ai-agent/src/env.rs`) — and release CI bakes nothing in. Whatever it
resolves is forwarded verbatim to the sidecar (`webserver.rs`:
`cmd.env("DILIGENT_ENV", env.as_str())`, which is exactly `"dev"` or `"prod"`). So the
switch is one of:

- Studio launches the agent with `--agent-env dev`
- `DILIGENT_ENV=dev` is exported in the environment
- `experiments.overrides["issue-report"] = true` in `config.jsonc`, which skips the channel
  question entirely

A local `make dev` run goes through no launcher, so `DILIGENT_ENV` is unset, which reads as
prod and leaves the skill off. Use the override or export the variable.

**3. A webhook URL must be configured.** None is shipped, so even an enabled experiment on
a prod build has nowhere to post. The script looks in two places, in this order:

| Source | Good for |
|---|---|
| `DILIGENT_ISSUE_WEBHOOK` in the environment | local `bun run` / `make dev` — `.env.local` is auto-loaded and gitignored |
| an `issue-report-webhook` file beside your session data, e.g. `~/.overdare/issue-report-webhook` | **an installed, built agent** |

The file exists because the environment does not reach a real install. A built binary
inherits whatever launched it, and Studio is a GUI app with no shell environment to
inherit, so `export` and `.env.local` only cover local development. Baking the URL into the
build is not an alternative: this repo is public and dev releases are prereleases on it, so
a baked secret would ship to anyone who downloads one. A file the developer drops in their
own namespace directory is the only spot that is per-machine, survives reinstalls, and is
never distributed.

```bash
# local development
echo 'DILIGENT_ISSUE_WEBHOOK=https://hooks.slack.com/services/...' >> .env.local

# an installed agent (namespace is `overdare` under the launcher, `diligent` for the CLI)
printf '%s\n' 'https://hooks.slack.com/services/...' > ~/.overdare/issue-report-webhook
chmod 600 ~/.overdare/issue-report-webhook
```

Blank lines and `#` comments in that file are ignored, so it can carry a note about which
channel it points at.

Wherever it goes, keep it on the machine: never in a committed file, never in this skill,
and never in a `config.jsonc` that lives inside a repo. A Slack webhook is write-only to a
single channel, which is what makes a developer's own machine an acceptable home for it and
a shipped artifact an unacceptable one.

`.diligent/skills/session-issue-report` is a symlink to this directory, so a diligent CLI
run in this repo picks up the same single copy — there is no second version to keep in sync.
