---
name: session-issue-report
description: Report a Studio / diligent-agent defect — or your own wasted effort — to the internal Slack channel, with the surrounding session context, redacted. Use this the moment you conclude that (1) Studio, the OVERDARE agent, or a diligent tool is broken, missing a capability you genuinely needed, or behaving against its own documented contract, or (2) you yourself went in circles, misused a tool, or burned turns on an approach that was wasted work. Trigger it on your own judgment mid-task — you do not need to be asked. Also trigger when the user says things like "이거 버그 같은데", "왜 안 되지", "리포트해줘", "삽질했네", "this looks like a bug", "file an issue", or complains that the agent keeps failing the same way. Internal-only: needs DILIGENT_ISSUE_WEBHOOK set, and it is not part of the shipped agent bundle.
---

# Session Issue Report

Studio work fails in ways nobody finds out about. A tool returns a schema error the
agent silently works around; a capability is missing so the agent invents a detour; the
agent rereads the same three files for eight turns and then gets it right. None of that
raises an alert, none of it reaches a backlog, and the only person who saw it was the
creator who has already moved on.

This skill is the manual path for that: **you noticed something, so you say so.** One
Slack message, with enough context that whoever reads it can act without replaying your
session.

It is deliberately judgment-first. There is no detector and no threshold — you decide.
That is the whole point: a heuristic can catch a tool erroring three times, but only you
can tell that the tool's *description* was ambiguous, or that your own second attempt was
the wasted one.

## Two kinds of report

**`product`** — the defect is not yours. Studio, the OVERDARE agent, a diligent tool, or
a documented contract is at fault: a tool that errors on input its own schema says is
valid, an RPC that returns success and changes nothing, a capability that plainly should
exist and does not, a doc that describes behaviour the build does not have.

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
- You needed a capability, searched properly, and it does not exist — say what you needed
  it for, since that is the part a backlog entry cannot reconstruct.
- You realise an earlier approach was wasted work, and there is a nameable reason a
  future agent would fall into it too.
- The same failure recurs after you changed your approach — recurrence across *different*
  attempts is much stronger evidence than three identical retries.

Not worth sending:

- One transient failure that succeeded on retry. Networks flake.
- A tool erroring on input that was genuinely wrong — that is the tool doing its job.
- Your own single misstep that you corrected immediately. Ordinary work.
- A user changing their mind, or asking for something else. Not a defect at all.
- Anything you have not actually verified: if you are guessing whether the RPC applied,
  check before reporting. A confidently wrong report costs a reader more than silence.
- The same thing twice in one session. The script blocks duplicates, but do not lean on
  it — a second report with a slightly different title gets through and is noise.

When you are genuinely unsure, the tiebreaker is whether you can name a concrete change
someone could make. If you can, send it. If the report would amount to "this felt hard,"
keep working instead.

## Sending

Write the body to a heredoc and pipe it in. `--kind` and `--title` are the only required
flags; the session tail is attached for you.

```bash
printf '%s' "$(cat <<'EOF'
**What I was doing:** placing a UIStroke on the level's HUD frame.

**What happened:** `studiorpc_instance_upsert` rejected `Thickness: "2px"` with
`INVALID_PROPERTY`, four times, once per unit spelling I tried.

**Why I think this is reportable:** the schema types `Thickness` as `number`, but the
tool description carries no unit example, so "2px" is the natural first guess. I only
got it right by finding a number in an unrelated recipe.

**What would have helped:** one `Thickness: 2` example in the tool description, or an
error that says "expected a number of studs".
EOF
)" | python3 .diligent/skills/session-issue-report/scripts/send_report.py \
      --kind product \
      --title "instance_upsert rejects UIStroke.Thickness with units; description has no example"
```

Useful flags: `--dry-run` prints the exact Slack text without posting (use it if you want
to check the redaction or the tail before sending), `--tail N` changes how many session
entries ride along (default 30), `--session PATH` pins a specific transcript when the
newest one is not the one you mean.

The script picks up `DILIGENT_ISSUE_WEBHOOK` from the environment. **If it is unset it
prints a note and sends nothing** — that is not a failure, so do not retry it or try to
find the URL yourself. Say what you found in your reply to the user instead, and mention
the variable is unset so they can decide whether to set it.

## Writing a body someone can act on

Four things, in this order, because it is the order a reader needs them:

1. **What you were doing** — one sentence of task context. Without it the rest is noise.
2. **What happened** — the observable facts. Exact tool name, exact error, how many
   attempts, what you tried between them.
3. **Why you think it is reportable** — your reasoning, including which kind it is and
   why. This is the part no log can produce, and it is why a person is writing the report
   instead of a monitor.
4. **What would have helped** — the concrete change. A reader who agrees with you should
   be able to turn this line into a ticket.

Describe rather than dump. The session tail is already attached, so quoting long tool
output into the body just buries your reasoning. Never paste the user's prompts
verbatim — say what they asked for. Secrets are redacted on the way out (the same
`secrets-2` patterns the sidecar uses), but that is a safety net, not a licence: this path
has no gateway and no consent gate behind it, so anything you write leaves the machine as
you wrote it.

## After reporting

Say one short line to the user — what you reported and why — then **carry on with the
task**. Reporting is a side effect, never a reason to stop, ask permission, or change your
plan. If the report did not send (no webhook, HTTP error), that is also just a line in
your reply; the user's work still matters more than the telemetry.

## Installing (internal)

This skill lives in this repo's `.diligent/skills/` so the team can review and change it,
which also means it does **not** ship in the OVERDARE agent bundle
(`apps/overdare-ai-agent/bootstrap/skills/`) and never reaches creators. To use it during
Studio sessions, copy it into your user-global skills directory and export the webhook:

```bash
cp -r .diligent/skills/session-issue-report ~/.overdare/skills/
export DILIGENT_ISSUE_WEBHOOK='https://hooks.slack.com/services/...'   # ask the team
```

Keep the URL out of the repo, out of `config.jsonc`, and out of any committed env file. A
Slack webhook is write-only to one channel, which is exactly why holding it locally is
fine for an internal tool and would not be acceptable in a shipped binary.
