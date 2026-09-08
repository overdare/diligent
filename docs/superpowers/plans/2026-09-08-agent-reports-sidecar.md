# Agent Failure Reports — Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the OVERDARE sidecar, detect candidate agent failures with cheap deterministic selectors, ask the agent itself (via a context injection) whether it was a genuine failure, and — only when it says yes — file a Markdown report to the gateway's `POST /v1/agent-reports` through a new `agent_report_failure` tool.

**Architecture:** One new `BundledToolProvider` (`@overdare/agent-report`) beside the existing gateway transmitter. Pure selector logic lives in its own module; the provider wires an `AgentLoopHook` (selectors + injection), the tool (compose + POST), and an `onEntryAppended` hook that binds tool-call ids to session ids. The whole feature sits behind an experiment flag that hides the tool; the hook stays inert whenever the tool is absent.

**Tech Stack:** TypeScript (Bun), `@diligent/core` loop hooks, `@diligent/runtime` bundled providers, zod, `bun:test`, biome.

**Spec:** `docs/superpowers/specs/2026-09-08-agent-failure-report-design.md` — Stage 1 "Local: selectors arm, the model judges".

**Working directory:** `~/Desktop/workhard/diligent` (this repo), branch off `main`. The gateway side (`POST /v1/agent-reports`) is a separate plan: `docs/superpowers/plans/2026-09-08-agent-reports-gateway.md`. The sidecar can be built and tested first — every test stubs `fetch`.

## Global Constraints

- All repo content (docs, comments, code) in English (`AGENTS.md`).
- biome: `lineWidth: 120`, spaces. Run `bun run lint` at the repo root before every commit; `bun run lint:fix` for mechanical fixes.
- Sidecar tests: `cd apps/overdare-ai-agent/sidecar && bun test <path>`. Typecheck sidecar: `NO_COLOR=1 ./apps/overdare-ai-agent/sidecar/node_modules/.bin/tsc --pretty false --noEmit -p apps/overdare-ai-agent/sidecar/tsconfig.json` (from repo root). Core typecheck after Task 1: `./packages/core/node_modules/.bin/tsc --pretty false --noEmit -p packages/core/tsconfig.json`.
- The tool name is exactly `agent_report_failure`; the provider id is `@overdare/agent-report`; the hook id is `agent-report`.
- Nothing on this path may throw into the turn: the tool returns a plain `output` string on every failure; the POST runs inside the tool's own try/catch.
- No LLM call is added. Judgment is the agent's next provider round, prompted by a context injection.
- Consent: the tool checks `canTransmitRecords()` before resolving a token and sends nothing when false (same as the records transmitter).
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/agent/index.ts` (modify) | export `DoomLoopDetector` so the sidecar reuses core's repeated-call detection |
| `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-selectors.ts` (create) | pure selector state: rollback / human_edits / aborted / repeated_call / repeated_error, per-session dedup |
| `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-client.ts` (create) | wire type, Markdown composer, assessment prompt text, `postAgentReport` |
| `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report.ts` (create) | `createAgentReportToolProvider`: loop hook + tool + entry binding |
| `apps/overdare-ai-agent/sidecar/src/tools/index.ts` (modify) | register the provider |
| `apps/overdare-ai-agent/sidecar/src/experiments.ts` (modify) | `agent-report` experiment (default off) hiding the tool |
| `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report-selectors.test.ts` (create) | selector tests |
| `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts` (create) | provider/hook/tool tests with a `fetch` stub |

Key facts the implementer must know (verified in this repo):

- `AgentLoopHook` (`packages/core/src/agent/loop-hooks.ts:41`) has `restore`, `onPromptStart({messages})`, `beforeTurn({messages, turnId, compactedThisTurn}) → AgentContextInjection[] | undefined`, `onToolResult({turnId, toolCall, result})`, `afterTurn({turnId, message, toolResults})`.
- At `onPromptStart`, `messages` **already includes the new user prompt** as its last element (`packages/core/src/agent/loop.ts:100-103`).
- On a user abort mid-stream the Anthropic path **throws** and `afterTurn` never runs (`assistant.ts` "Aborted"; `loop.ts` catch swallows it). So abort is detected at the *next* `onPromptStart` by shape: the message before the new prompt is not an assistant message that ended cleanly. `stopReason === "aborted"` is only emitted by the OpenAI Responses provider — checked in `afterTurn` as a bonus.
- `ToolCallBlock` = `{ type: "tool_call", id, name, input: Record<string, unknown> }` (`packages/protocol/src/content-blocks.ts:66`). In sidecar code import `Message`, `ToolCallBlock`, `ToolResultMessage` from `@diligent/core/message-contract` (it re-exports them; `packages/core/src/contracts/message.ts`) — do not add a direct `@diligent/protocol` import.
- `ModelRef` is `{ provider, modelId }` (`data-model.ts:23`) — test fixtures for assistant messages must use `modelId`, not `id`.
- `ToolResultMessage.metadata` exists; `studiorpc_human_edits` returns `metadata.humanEditsDetected: boolean` (`human-edits-tool.ts` `computeHumanEdits`).
- `ToolContext` (`packages/core/src/tool/types.ts:27`) has `toolCallId` but **no session id**. `HookInput` for `onEntryAppended` has `session_id`, `seq`, `user_id`, `entry` (`packages/runtime/src/hooks/runner.ts:10`, usage in `gateway/index.ts`). The assistant entry carrying a tool call is flushed **synchronously on `message_end` before tools execute** (`turn-orchestrator.ts:303` + `shouldFlushTurnProgress`), so `onEntryAppended` sees the tool-call id before the tool runs.
- `AgentLoopHookFactoryContext.tools` is the **post-experiment-filter** tool list (`app-server/factory.ts:219`), so "is `agent_report_failure` present" is the rollout gate.
- Core's `DoomLoopDetector` (`packages/core/src/agent/util/doom-loop.ts`) already detects identical-call repetition (3 repeats of a pattern up to window/3). Reuse it for `repeated_call` — do not reimplement.
- `resolveEndpoint()` / `resolveToken()` / `maskValue()` live in `sidecar/src/tools/gateway/shared.ts` and `masking.ts`.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch and commit the design docs**

```bash
cd ~/Desktop/workhard/diligent
git checkout -b feat/agent-failure-report
git add docs/superpowers/specs/2026-09-08-agent-failure-report-design.md docs/superpowers/plans/2026-09-08-agent-reports-gateway.md docs/superpowers/plans/2026-09-08-agent-reports-sidecar.md
git commit -m "docs: agent failure report design + implementation plans

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 1: Export `DoomLoopDetector` from core

**Files:**
- Modify: `packages/core/src/agent/index.ts`

**Interfaces:**
- Produces: `import { DoomLoopDetector } from "@diligent/core/agent"` — class with `record(toolName: string, input: Record<string, unknown>): void` and `check(): { detected: boolean; patternLength?: number; toolName?: string }`.

- [ ] **Step 1: Add the export**

In `packages/core/src/agent/index.ts`, after the `export { formatSerializableErrorForLog, toSerializableError } from "./util/errors";` line add:

```ts
export { DoomLoopDetector } from "./util/doom-loop";
```

- [ ] **Step 2: Typecheck core**

Run: `NO_COLOR=1 ./packages/core/node_modules/.bin/tsc --pretty false --noEmit -p packages/core/tsconfig.json`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent/index.ts
git commit -m "feat(core): export DoomLoopDetector from @diligent/core/agent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 2: Pure selectors

**Files:**
- Create: `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-selectors.ts`
- Test: `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report-selectors.test.ts`

**Interfaces:**
- Consumes: `DoomLoopDetector`, `COMPACTION_SUMMARY_PREFIX` from `@diligent/core/agent`; `Message`, `ToolCallBlock`, `ToolResultMessage` from `@diligent/core/message-contract`.
- Produces:

```ts
export type FailureKind = "rollback" | "human_edits" | "aborted" | "repeated_call" | "repeated_error";
export interface FailureSignal { kind: FailureKind; tool?: string; count: number; fingerprint: string }
export interface FailureSelectors {
  onToolResult(toolCall: ToolCallBlock, result: ToolResultMessage): FailureSignal | undefined;
  onPromptStart(messages: readonly Message[]): FailureSignal | undefined;
  onAfterTurn(stopReason: string): FailureSignal | undefined;
  reset(): void;
}
export function createFailureSelectors(options?: { errorStreak?: number }): FailureSelectors;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report-selectors.test.ts`:

```ts
// @summary Tests the deterministic failure selectors behind the agent failure report hook.

import { describe, expect, test } from "bun:test";
import { COMPACTION_SUMMARY_PREFIX } from "@diligent/core/agent";
import type { Message, ToolCallBlock } from "@diligent/core/message-contract";
import { createFailureSelectors } from "../../src/tools/gateway/agent-report-selectors";

function call(name: string, input: Record<string, unknown> = {}, id = "tc-1"): ToolCallBlock {
  return { type: "tool_call", id, name, input };
}

function result(toolName: string, opts: { isError?: boolean; metadata?: Record<string, unknown> } = {}) {
  return {
    role: "tool_result" as const,
    toolCallId: "tc-1",
    toolName,
    output: "",
    isError: opts.isError ?? false,
    timestamp: 0,
    metadata: opts.metadata,
  };
}

const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const assistant = (stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | "aborted"): Message => ({
  role: "assistant",
  content: [],
  model: { provider: "anthropic", modelId: "m" },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stopReason,
  timestamp: 0,
});
const toolResult = (): Message => result("x");

describe("selector A — discarded work", () => {
  test("rollback trips once per session", () => {
    const s = createFailureSelectors();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toEqual({
      kind: "rollback",
      tool: "studiorpc_rollback",
      count: 1,
      fingerprint: "rollback:studiorpc_rollback",
    });
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeUndefined();
  });

  test("human_edits trips only when edits were detected", () => {
    const s = createFailureSelectors();
    const edits = call("studiorpc_human_edits");
    expect(s.onToolResult(edits, result("studiorpc_human_edits", { metadata: { humanEditsDetected: false } }))).toBeUndefined();
    expect(s.onToolResult(edits, result("studiorpc_human_edits", { metadata: { humanEditsDetected: true } }))?.kind).toBe(
      "human_edits",
    );
  });

  test("afterTurn stopReason aborted trips", () => {
    const s = createFailureSelectors();
    expect(s.onAfterTurn("end_turn")).toBeUndefined();
    expect(s.onAfterTurn("aborted")?.kind).toBe("aborted");
  });
});

describe("selector A — abort detected by message shape at the next prompt", () => {
  test("clean end_turn before the new prompt → nothing", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a"), assistant("tool_use"), toolResult(), assistant("end_turn"), user("b")])).toBeUndefined();
  });

  test("assistant tool_use as the last message before the new prompt → aborted mid-tools", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a"), assistant("tool_use"), toolResult(), user("b")])?.kind).toBe("aborted");
  });

  test("user prompt directly followed by a new user prompt → aborted mid-stream", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a"), user("b")])?.kind).toBe("aborted");
  });

  test("compaction summary before the new prompt is not an abort", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user(`${COMPACTION_SUMMARY_PREFIX} summary`), user("b")])).toBeUndefined();
  });

  test("first prompt of a session → nothing", () => {
    const s = createFailureSelectors();
    expect(s.onPromptStart([user("a")])).toBeUndefined();
  });
});

describe("selector B — repeated identical call (core doom loop)", () => {
  test("three identical calls trip repeated_call", () => {
    const s = createFailureSelectors();
    const c = call("instance_upsert", { id: "x", props: { a: 1 } });
    expect(s.onToolResult(c, result("instance_upsert"))).toBeUndefined();
    expect(s.onToolResult(c, result("instance_upsert"))).toBeUndefined();
    const sig = s.onToolResult(c, result("instance_upsert"));
    expect(sig?.kind).toBe("repeated_call");
    expect(sig?.tool).toBe("instance_upsert");
    expect(sig?.fingerprint).toBe("repeated_call:instance_upsert");
  });

  test("different args do not trip", () => {
    const s = createFailureSelectors();
    for (let i = 0; i < 3; i++) {
      expect(s.onToolResult(call("instance_upsert", { i }), result("instance_upsert"))).toBeUndefined();
    }
  });
});

describe("selector C — consecutive same-tool errors", () => {
  test("trips at N, not N-1, and resets on success", () => {
    const s = createFailureSelectors({ errorStreak: 3 });
    const c = (i: number) => call("instance_upsert", { i });
    expect(s.onToolResult(c(1), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(2), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(3), result("instance_upsert"))).toBeUndefined(); // success resets
    expect(s.onToolResult(c(4), result("instance_upsert", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(c(5), result("instance_upsert", { isError: true }))).toBeUndefined();
    const sig = s.onToolResult(c(6), result("instance_upsert", { isError: true }));
    expect(sig).toEqual({ kind: "repeated_error", tool: "instance_upsert", count: 3, fingerprint: "repeated_error:instance_upsert" });
  });

  test("streak is per tool", () => {
    const s = createFailureSelectors({ errorStreak: 2 });
    expect(s.onToolResult(call("a", { i: 1 }), result("a", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("b", { i: 2 }), result("b", { isError: true }))).toBeUndefined();
    expect(s.onToolResult(call("a", { i: 3 }), result("a", { isError: true }))?.kind).toBe("repeated_error");
  });
});

describe("dedup + reset", () => {
  test("reset clears fired fingerprints", () => {
    const s = createFailureSelectors();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeDefined();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeUndefined();
    s.reset();
    expect(s.onToolResult(call("studiorpc_rollback"), result("studiorpc_rollback"))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report-selectors.test.ts`
Expected: FAIL — cannot resolve `../../src/tools/gateway/agent-report-selectors`.

- [ ] **Step 3: Implement `agent-report-selectors.ts`**

```ts
// @summary Deterministic failure selectors for the agent failure report hook (spec Stage 1).
//
// These are candidates, not verdicts: they are cheap, admit false positives on purpose, and
// the agent itself judges the armed stretch on its next provider round. Each fingerprint
// arms at most once per session.

import { COMPACTION_SUMMARY_PREFIX, DoomLoopDetector } from "@diligent/core/agent";
import type { Message, ToolCallBlock, ToolResultMessage } from "@diligent/core/message-contract";

export type FailureKind = "rollback" | "human_edits" | "aborted" | "repeated_call" | "repeated_error";

export interface FailureSignal {
  kind: FailureKind;
  tool?: string;
  count: number;
  /** Local dedup key (kind[:tool]); the gateway computes its own grouping key. */
  fingerprint: string;
}

export interface FailureSelectors {
  onToolResult(toolCall: ToolCallBlock, result: ToolResultMessage): FailureSignal | undefined;
  onPromptStart(messages: readonly Message[]): FailureSignal | undefined;
  onAfterTurn(stopReason: string): FailureSignal | undefined;
  reset(): void;
}

const ROLLBACK_TOOL = "studiorpc_rollback";
const HUMAN_EDITS_TOOL = "studiorpc_human_edits";
const DEFAULT_ERROR_STREAK = 3;
/** Provider stop reasons that mean the prompt ended on the agent's own terms. */
const CLEAN_STOP_REASONS = new Set(["end_turn", "max_tokens", "error"]);

export function createFailureSelectors(options: { errorStreak?: number } = {}): FailureSelectors {
  const errorStreak = options.errorStreak ?? DEFAULT_ERROR_STREAK;
  let fired = new Set<string>();
  let streaks = new Map<string, number>();
  let doom = new DoomLoopDetector();

  const arm = (signal: FailureSignal): FailureSignal | undefined => {
    if (fired.has(signal.fingerprint)) return undefined;
    fired.add(signal.fingerprint);
    return signal;
  };

  return {
    onToolResult(toolCall, result) {
      if (toolCall.name === ROLLBACK_TOOL) {
        return arm({ kind: "rollback", tool: ROLLBACK_TOOL, count: 1, fingerprint: `rollback:${ROLLBACK_TOOL}` });
      }
      if (toolCall.name === HUMAN_EDITS_TOOL && result.metadata?.humanEditsDetected === true) {
        return arm({ kind: "human_edits", tool: HUMAN_EDITS_TOOL, count: 1, fingerprint: `human_edits:${HUMAN_EDITS_TOOL}` });
      }

      doom.record(toolCall.name, toolCall.input);
      const loop = doom.check();
      if (loop.detected && loop.toolName) {
        const signal = arm({
          kind: "repeated_call",
          tool: loop.toolName,
          count: 3,
          fingerprint: `repeated_call:${loop.toolName}`,
        });
        if (signal) return signal;
      }

      const streak = result.isError ? (streaks.get(toolCall.name) ?? 0) + 1 : 0;
      streaks.set(toolCall.name, streak);
      if (streak >= errorStreak) {
        return arm({
          kind: "repeated_error",
          tool: toolCall.name,
          count: streak,
          fingerprint: `repeated_error:${toolCall.name}`,
        });
      }
      return undefined;
    },

    onPromptStart(messages) {
      // `messages` already ends with the new user prompt. Walk back past tool results to the
      // message that closed the previous prompt. Anything but a cleanly-stopped assistant
      // message means the previous prompt was aborted (or crashed) before it finished — the
      // Anthropic path throws on abort, so `stopReason: "aborted"` never reaches afterTurn.
      for (let index = messages.length - 2; index >= 0; index--) {
        const message = messages[index];
        if (message.role === "tool_result") continue;
        if (message.role === "assistant") {
          if (CLEAN_STOP_REASONS.has(message.stopReason)) return undefined;
          return arm({ kind: "aborted", count: 1, fingerprint: "aborted" });
        }
        // A compaction summary stands in for history that did end cleanly.
        if (typeof message.content === "string" && message.content.startsWith(COMPACTION_SUMMARY_PREFIX)) {
          return undefined;
        }
        return arm({ kind: "aborted", count: 1, fingerprint: "aborted" });
      }
      return undefined;
    },

    onAfterTurn(stopReason) {
      if (stopReason !== "aborted") return undefined;
      return arm({ kind: "aborted", count: 1, fingerprint: "aborted" });
    },

    reset() {
      fired = new Set();
      streaks = new Map();
      doom = new DoomLoopDetector();
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report-selectors.test.ts`
Expected: all pass. If the `human_edits` test line exceeds 120 columns biome will reflow it on `lint:fix`.

- [ ] **Step 5: Lint + commit**

```bash
cd ~/Desktop/workhard/diligent && bun run lint:fix && bun run lint
git add apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-selectors.ts apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report-selectors.test.ts
git commit -m "feat(overdare): deterministic failure selectors for agent reports

rollback / human_edits / aborted (message-shape + stopReason) / repeated_call
(core DoomLoopDetector) / repeated_error (per-tool streak). Once per fingerprint.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 3: Wire client — Markdown composer, assessment prompt, POST

**Files:**
- Create: `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-client.ts`
- Test: `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts` (created here, extended in Task 4)

**Interfaces:**
- Consumes: `resolveEndpoint`, `resolveToken` (`./shared`), `maskValue` (`./masking`), `FailureSignal` (Task 2)
- Produces:

```ts
export const AGENT_REPORT_TOOL_NAME = "agent_report_failure";
export const AGENT_REPORT_CAUSES = ["model_error", "missing_tool", "missing_context", "ambiguous_prompt", "tool_bug", "user_error"] as const;
export type AgentReportCause = (typeof AGENT_REPORT_CAUSES)[number];
export interface AgentReportWire { client_report_id: string; session_id: string; project_id: string; seq?: number; event_ts: string; kind: FailureKind; tool?: string; cause: AgentReportCause; title: string; summary_md: string; evidence: Record<string, number | string>; release?: string }
export function composeReportMarkdown(input: { title: string; signal: FailureSignal; cause: AgentReportCause; sessionId: string; seq?: number; release?: string; summary: string }): string;
export function buildAssessmentMessage(signal: FailureSignal): string;
export async function postAgentReport(wire: AgentReportWire): Promise<void>;  // throws on no token / non-2xx
```

- [ ] **Step 1: Write the failing tests**

Create `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts`:

```ts
// @summary Tests the agent failure report client, provider hook and tool.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AGENT_REPORT_TOOL_NAME,
  buildAssessmentMessage,
  composeReportMarkdown,
  postAgentReport,
} from "../../src/tools/gateway/agent-report-client";

const realFetch = globalThis.fetch;
const realUrl = process.env.DILIGENT_GATEWAY_URL;
const realToken = process.env.DILIGENT_GATEWAY_TOKEN;

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
  authorization?: string;
}

function installFetchSpy(status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      authorization: headers.get("authorization") ?? undefined,
    });
    return new Response(JSON.stringify({ report_id: 1, reported_at: "2026-09-08T00:00:00Z", stored: true, notified: true }), {
      status,
    });
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.DILIGENT_GATEWAY_URL = "http://127.0.0.1:8000";
  process.env.DILIGENT_GATEWAY_TOKEN = "test-token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realUrl === undefined) delete process.env.DILIGENT_GATEWAY_URL;
  else process.env.DILIGENT_GATEWAY_URL = realUrl;
  if (realToken === undefined) delete process.env.DILIGENT_GATEWAY_TOKEN;
  else process.env.DILIGENT_GATEWAY_TOKEN = realToken;
});

const SIGNAL = { kind: "repeated_error" as const, tool: "instance_upsert", count: 4, fingerprint: "repeated_error:instance_upsert" };

describe("composeReportMarkdown", () => {
  test("renders the header from hook-owned facts and the body from the model", () => {
    const md = composeReportMarkdown({
      title: "Thickness passed as a string",
      signal: SIGNAL,
      cause: "ambiguous_prompt",
      sessionId: "sess-1",
      seq: 168,
      release: "1.4.2",
      summary: "Tried \"2px\" four times.",
    });
    expect(md).toBe(
      [
        "## Thickness passed as a string",
        "kind: repeated_error · tool: instance_upsert · count: 4 · cause: ambiguous_prompt",
        "session: sess-1 · seq: 168 · release: 1.4.2",
        "",
        "Tried \"2px\" four times.",
      ].join("\n"),
    );
  });

  test("omits absent tool/seq/release", () => {
    const md = composeReportMarkdown({
      title: "t",
      signal: { kind: "aborted", count: 1, fingerprint: "aborted" },
      cause: "model_error",
      sessionId: "sess-1",
      summary: "s",
    });
    expect(md).toContain("kind: aborted · tool: - · count: 1 · cause: model_error");
    expect(md).toContain("session: sess-1 · seq: - · release: -");
  });
});

describe("buildAssessmentMessage", () => {
  test("is a system-reminder naming the signal and the tool", () => {
    const text = buildAssessmentMessage(SIGNAL);
    expect(text.startsWith("<system-reminder>")).toBe(true);
    expect(text.endsWith("</system-reminder>")).toBe(true);
    expect(text).toContain("kind=repeated_error");
    expect(text).toContain("tool=instance_upsert");
    expect(text).toContain("count=4");
    expect(text).toContain(AGENT_REPORT_TOOL_NAME);
    expect(text).toContain("do not quote the user");
  });

  test("aborted uses the interrupted-turn wording", () => {
    expect(buildAssessmentMessage({ kind: "aborted", count: 1, fingerprint: "aborted" })).toContain("did not complete");
  });
});

describe("postAgentReport", () => {
  const wire = {
    client_report_id: "11111111-1111-1111-1111-111111111111",
    session_id: "sess-1",
    project_id: "proj-1",
    seq: 168,
    event_ts: "2026-09-08T00:00:00.000Z",
    kind: "repeated_error" as const,
    tool: "instance_upsert",
    cause: "ambiguous_prompt" as const,
    title: "t",
    summary_md: "s",
    evidence: { count: 4 },
    release: "1.4.2",
  };

  test("POSTs the wire body with the bearer token", async () => {
    const calls = installFetchSpy();
    await postAgentReport(wire);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/agent-reports");
    expect(calls[0].authorization).toBe("Bearer test-token");
    expect(calls[0].body).toEqual(wire);
  });

  test("throws on a non-2xx response", async () => {
    installFetchSpy(503);
    await expect(postAgentReport(wire)).rejects.toThrow("503");
  });

  test("throws when no token is available", async () => {
    delete process.env.DILIGENT_GATEWAY_TOKEN;
    const calls = installFetchSpy();
    await expect(postAgentReport(wire)).rejects.toThrow("token");
    expect(calls).toHaveLength(0);
  });
});
```

Note on the last test: `resolveToken()` falls back to `readHubToken(loadOverdareConfig())` when the env override is unset, which tries Studio RPC and throws → caught → `undefined`. In the test environment there is no Studio, so this resolves to `undefined` (the existing `gateway.test.ts` relies on the same behaviour). If it hangs instead, set `STUDIO_PORT` to an unused port in `beforeEach`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report.test.ts`
Expected: FAIL — cannot resolve `agent-report-client`.

- [ ] **Step 3: Implement `agent-report-client.ts`**

```ts
// @summary Wire contract, Markdown composer and POST client for gateway agent failure reports.

import { maskValue } from "./masking";
import { resolveEndpoint, resolveToken } from "./shared";
import type { FailureKind, FailureSignal } from "./agent-report-selectors";

export const AGENT_REPORT_TOOL_NAME = "agent_report_failure";

export const AGENT_REPORT_CAUSES = [
  "model_error",
  "missing_tool",
  "missing_context",
  "ambiguous_prompt",
  "tool_bug",
  "user_error",
] as const;
export type AgentReportCause = (typeof AGENT_REPORT_CAUSES)[number];

/** POST /v1/agent-reports body — see diligent-gateway contract/CLIENT_INTEGRATION.md §12. */
export interface AgentReportWire {
  client_report_id: string;
  session_id: string;
  project_id: string;
  seq?: number;
  event_ts: string;
  kind: FailureKind;
  tool?: string;
  cause: AgentReportCause;
  title: string;
  summary_md: string;
  evidence: Record<string, number | string>;
  release?: string;
}

export function composeReportMarkdown(input: {
  title: string;
  signal: FailureSignal;
  cause: AgentReportCause;
  sessionId: string;
  seq?: number;
  release?: string;
  summary: string;
}): string {
  const { signal } = input;
  return [
    `## ${input.title}`,
    `kind: ${signal.kind} · tool: ${signal.tool ?? "-"} · count: ${signal.count} · cause: ${input.cause}`,
    `session: ${input.sessionId} · seq: ${input.seq ?? "-"} · release: ${input.release ?? "-"}`,
    "",
    input.summary,
  ].join("\n");
}

/** The context injection that asks the agent to judge the armed stretch on its next round. */
export function buildAssessmentMessage(signal: FailureSignal): string {
  const lead =
    signal.kind === "aborted"
      ? "Your previous turn did not complete (the user stopped it or it was interrupted)."
      : `A failure signal fired: kind=${signal.kind}, tool=${signal.tool ?? "-"}, count=${signal.count}.`;
  return [
    "<system-reminder>",
    lead,
    "Before continuing, assess whether the preceding work was a genuine agent failure — you were going in circles, misusing a tool, or the user discarded your work because it was wrong.",
    `If and only if it was, call ${AGENT_REPORT_TOOL_NAME} exactly once with an honest cause, a one-line title, and a summary of what you attempted, why it failed, and what would have helped. Describe your own behaviour; do not quote the user's messages.`,
    "If it was not a failure (the user changed their mind, the retries were reasonable), do not call the tool. Either way, then continue the task.",
    "</system-reminder>",
  ].join("\n");
}

export async function postAgentReport(wire: AgentReportWire): Promise<void> {
  const token = await resolveToken();
  if (!token) throw new Error("Agent report failed: gateway token is unavailable");
  const body: AgentReportWire = { ...wire, title: maskValue(wire.title), summary_md: maskValue(wire.summary_md) };
  const response = await fetch(`${resolveEndpoint()}/v1/agent-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Agent report failed: gateway returned ${response.status}`);
}
```

- [ ] **Step 4: Run tests, lint, commit**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report.test.ts`
Expected: all pass.

```bash
cd ~/Desktop/workhard/diligent && bun run lint:fix && bun run lint
git add apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report-client.ts apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts
git commit -m "feat(overdare): agent report wire client, markdown composer, assessment prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 4: Provider — loop hook, tool, session binding

**Files:**
- Create: `apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report.ts`
- Test: `apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts` (extend)

**Interfaces:**
- Consumes: `createFailureSelectors`, `FailureSignal` (Task 2); `AGENT_REPORT_TOOL_NAME`, `AGENT_REPORT_CAUSES`, `composeReportMarkdown`, `buildAssessmentMessage`, `postAgentReport` (Task 3); `StudioToolProviderOptions` (`./hello-world`); `BundledToolProvider`, `PluginHookFn`, `HookInput`, `AgentLoopHookFactoryContext` (`@diligent/runtime`); `AgentLoopHook` (`@diligent/core/agent`); `Tool` (`@diligent/core/tool-contract`).
- Produces:

```ts
export interface AgentReportToolProviderOptions extends StudioToolProviderOptions { canTransmitRecords?: () => boolean }
export function createAgentReportToolProvider(options: AgentReportToolProviderOptions): BundledToolProvider;
```

- [ ] **Step 1: Write the failing provider tests**

Extend `gateway-agent-report.test.ts`. The `import` lines below go into the **top import block** of the file (biome sorts them); everything else appends at the bottom.

```ts
import type { AgentLoopHookFactoryContext, HookInput } from "@diligent/runtime";
import type { ToolCallBlock } from "@diligent/core/message-contract";
import type { Model } from "@diligent/core/provider-contract";
import type { Tool } from "@diligent/core/tool-contract";
import { createLogger } from "@diligent/logging";
import { createAgentReportToolProvider } from "../../src/tools/gateway/agent-report";

function hookContext(overrides: Partial<AgentLoopHookFactoryContext> = {}): AgentLoopHookFactoryContext {
  return {
    cwd: "/tmp/project",
    agentKind: "main",
    model: {} as Model,
    tools: [{ name: AGENT_REPORT_TOOL_NAME } as Tool],
    logger: createLogger({ scope: "test" }),
    ...overrides,
  };
}

function entryInput(toolCallId: string, overrides: Partial<HookInput> = {}): HookInput {
  return {
    session_id: "sess-1",
    transcript_path: "/tmp/sess-1.jsonl",
    cwd: "/tmp/project",
    hook_event_name: "EntryAppended",
    user_id: "alice",
    seq: 168,
    entry: {
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-09-08T00:00:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_call", id: toolCallId, name: AGENT_REPORT_TOOL_NAME, input: {} }],
        stopReason: "tool_use",
      },
    },
    ...overrides,
  };
}

const rollbackCall: ToolCallBlock = { type: "tool_call", id: "tc-rb", name: "studiorpc_rollback", input: {} };
const rollbackResult = {
  role: "tool_result" as const,
  toolCallId: "tc-rb",
  toolName: "studiorpc_rollback",
  output: "",
  isError: false,
  timestamp: 0,
};

async function toolOf(provider: ReturnType<typeof createAgentReportToolProvider>): Promise<Tool> {
  const tools = await provider.createTools({ cwd: "/tmp/project" });
  const tool = tools.find((t) => t.name === AGENT_REPORT_TOOL_NAME);
  if (!tool) throw new Error("tool missing");
  return tool;
}

const toolCtx = (toolCallId: string) => ({ toolCallId, signal: new AbortController().signal, abort: () => {} });

describe("createAgentReportToolProvider — hook gating", () => {
  test("no hook when the tool is experiment-disabled (absent from context.tools)", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext({ tools: [] }))).toEqual([]);
  });

  test("no hook for child agents", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext({ agentKind: "child" }))).toEqual([]);
  });

  test("hook id is agent-report", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    expect(provider.createAgentLoopHooks?.(hookContext())?.[0]?.id).toBe("agent-report");
  });
});

describe("createAgentReportToolProvider — injection", () => {
  test("beforeTurn injects once per armed signal", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    expect(hook.beforeTurn?.({ messages: [], turnId: "t1", compactedThisTurn: false })).toBeUndefined();

    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    const injections = hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    expect(injections).toHaveLength(1);
    expect(injections?.[0].source).toBe("agent-report");
    expect(String(injections?.[0].content)).toContain("kind=rollback");

    expect(hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false })).toBeUndefined();
  });

  test("restore clears armed state and per-session dedup", () => {
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.restore?.({ messages: [] });
    // armed signal dropped …
    expect(hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false })).toBeUndefined();
    // … and the fingerprint can fire again in the restored session
    hook.onToolResult?.({ turnId: "t2", toolCall: rollbackCall, result: rollbackResult });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false })).toHaveLength(1);
  });
});

describe("createAgentReportToolProvider — tool", () => {
  test("does nothing when no signal is under assessment", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-1"));
    expect(out.output).toContain("nothing reported");
    expect(calls).toHaveLength(0);
  });

  test("sends nothing without consent", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => false });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-1"));
    expect(out.output).toContain("disabled");
    expect(calls).toHaveLength(0);
  });

  test("files the report bound to the session that appended its tool call", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({
      cwd: "/tmp/project",
      projectId: "proj-1",
      canTransmitRecords: () => true,
    });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("tc-report"));

    const tool = await toolOf(provider);
    const out = await tool.execute(
      { cause: "user_error", title: "Rolled back a correct change", summary: "key sk-ant-0123456789012345678901" },
      toolCtx("tc-report"),
    );
    expect(out.output).toContain("filed");
    expect(calls).toHaveLength(1);
    const body = calls[0].body;
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/agent-reports");
    expect(body.session_id).toBe("sess-1");
    expect(body.seq).toBe(168);
    expect(body.project_id).toBe("proj-1");
    expect(body.kind).toBe("rollback");
    expect(body.tool).toBe("studiorpc_rollback");
    expect(body.cause).toBe("user_error");
    expect(body.evidence).toEqual({ count: 1 });
    expect(String(body.summary_md)).toContain("## Rolled back a correct change");
    expect(String(body.summary_md)).toContain("[REDACTED:anthropic-key]");
    expect(typeof body.client_report_id).toBe("string");

    // the signal is consumed: a second call reports nothing
    const again = await tool.execute({ cause: "user_error", title: "t", summary: "s" }, toolCtx("tc-report"));
    expect(again.output).toContain("nothing reported");
    expect(calls).toHaveLength(1);
  });

  test("falls back to the latest appended session when the tool call id is unknown", async () => {
    const calls = installFetchSpy();
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("other", { session_id: "sess-9", seq: 3 }));
    const tool = await toolOf(provider);
    await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("unknown"));
    expect(calls[0].body.session_id).toBe("sess-9");
    // no explicit project id → synthetic `<user>_<cwd>` id, separators replaced
    expect(calls[0].body.project_id).toBe("alice__tmp_project");
  });

  test("gateway failure is reported in the output, never thrown", async () => {
    installFetchSpy(503);
    const provider = createAgentReportToolProvider({ cwd: "/tmp/project", canTransmitRecords: () => true });
    const [hook] = provider.createAgentLoopHooks?.(hookContext()) ?? [];
    hook.onToolResult?.({ turnId: "t1", toolCall: rollbackCall, result: rollbackResult });
    hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false });
    await provider.onEntryAppended?.(entryInput("tc-report"));
    const tool = await toolOf(provider);
    const out = await tool.execute({ cause: "model_error", title: "t", summary: "s" }, toolCtx("tc-report"));
    expect(out.output).toContain("could not be delivered");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report.test.ts`
Expected: FAIL — cannot resolve `agent-report`.

- [ ] **Step 3: Implement `agent-report.ts`**

```ts
// @summary Agent failure report provider: selectors → assessment injection → agent_report_failure tool → gateway.
//
// Spec: docs/superpowers/specs/2026-09-08-agent-failure-report-design.md (Stage 1). No LLM call is
// made here — the loop hook injects a <system-reminder> and the agent's own next round decides
// whether to file. The tool is hidden behind the `agent-report` experiment; the hook stays inert
// whenever the tool is absent from the agent's tool list.

import type { AgentLoopHook } from "@diligent/core/agent";
import type { Tool } from "@diligent/core/tool-contract";
import { createLogger } from "@diligent/logging";
import type { AgentLoopHookFactoryContext, BundledToolProvider, HookInput, PluginHookFn } from "@diligent/runtime";
import { z } from "zod";
import type { StudioToolProviderOptions } from "../hello-world";
import {
  AGENT_REPORT_CAUSES,
  AGENT_REPORT_TOOL_NAME,
  buildAssessmentMessage,
  composeReportMarkdown,
  postAgentReport,
} from "./agent-report-client";
import { createFailureSelectors, type FailureSignal } from "./agent-report-selectors";

const logger = createLogger({ scope: "sidecar/gateway", context: { component: "agent-report" } });

export interface AgentReportToolProviderOptions extends StudioToolProviderOptions {
  canTransmitRecords?: () => boolean;
}

interface SessionBinding {
  sessionId: string;
  seq?: number;
  userId: string;
}

/** Shared between the hook (which arms) and the tool (which files). */
interface ProviderState {
  /** The signal the agent was asked to assess; consumed by the tool. */
  current?: FailureSignal;
  /** tool_call id → session, learned from the appended assistant entry (flushed before tools run). */
  bindings: Map<string, SessionBinding>;
  latest?: SessionBinding;
}

const MAX_BINDINGS = 256;

export function createAgentReportToolProvider(options: AgentReportToolProviderOptions): BundledToolProvider {
  const state: ProviderState = { bindings: new Map() };
  const explicitProjectId = options.projectId?.trim() ?? "";
  const cwd = options.cwd?.trim() ?? "";

  // Sync (default mode): pure in-memory bookkeeping, so ordering against tool execution is deterministic.
  const onEntryAppended: PluginHookFn = async (input) => {
    const binding = bindingFromInput(input);
    state.latest = binding;
    for (const toolCallId of toolCallIdsInEntry(input)) {
      state.bindings.set(toolCallId, binding);
      if (state.bindings.size > MAX_BINDINGS) {
        const oldest = state.bindings.keys().next().value;
        if (oldest !== undefined) state.bindings.delete(oldest);
      }
    }
    return { blocked: false };
  };

  return {
    id: "@overdare/agent-report",
    displayName: "OVERDARE Agent Failure Reports",
    createTools: () => [createAgentReportTool(state, options, explicitProjectId, cwd)],
    onEntryAppended,
    createAgentLoopHooks: (context) => (shouldArm(context) ? [createAgentReportHook(state)] : []),
  };
}

/** Only the main agent, and only when the experiment exposes the tool to it. */
function shouldArm(context: AgentLoopHookFactoryContext): boolean {
  return context.agentKind === "main" && context.tools.some((tool) => tool.name === AGENT_REPORT_TOOL_NAME);
}

function createAgentReportHook(state: ProviderState): AgentLoopHook {
  const selectors = createFailureSelectors();
  let armed: FailureSignal | undefined;

  return {
    id: "agent-report",
    restore() {
      selectors.reset();
      armed = undefined;
      state.current = undefined;
    },
    onPromptStart({ messages }) {
      armed ??= selectors.onPromptStart(messages);
    },
    beforeTurn() {
      if (!armed) return undefined;
      const signal = armed;
      armed = undefined;
      // ponytail: one main agent per sidecar process, so a single "current" slot is enough.
      state.current = signal;
      logger.info("agent_report.assessment_injected", {
        message: `[agent-report] injected kind=${signal.kind} tool=${signal.tool ?? "-"} count=${signal.count}`,
        fields: { kind: signal.kind, tool: signal.tool, count: signal.count },
      });
      return [{ source: "agent-report", content: buildAssessmentMessage(signal) }];
    },
    onToolResult({ toolCall, result }) {
      armed ??= selectors.onToolResult(toolCall, result);
    },
    afterTurn({ message }) {
      armed ??= selectors.onAfterTurn(message.stopReason);
    },
  };
}

function createAgentReportTool(
  state: ProviderState,
  options: AgentReportToolProviderOptions,
  explicitProjectId: string,
  cwd: string,
): Tool {
  return {
    name: AGENT_REPORT_TOOL_NAME,
    description:
      "File a failure report about your own work. Call this ONLY when a <system-reminder> asked you to assess a " +
      "failure signal AND you judged it a genuine agent failure. Describe your own behaviour; never quote the user.",
    parameters: z.object({
      cause: z.enum(AGENT_REPORT_CAUSES).describe("Root cause category."),
      title: z.string().min(1).max(200).describe("One line: what went wrong."),
      summary: z.string().min(1).max(4000).describe("What you attempted, why it failed, what would have helped."),
    }),
    execute: async (args, ctx) => {
      const signal = state.current;
      if (!signal) return { output: "No failure signal is under assessment; nothing reported. Continue the task." };
      if (!options.canTransmitRecords?.()) {
        state.current = undefined;
        return { output: "Reporting is disabled (AI-data consent not granted). Continue the task." };
      }
      const binding = state.bindings.get(ctx.toolCallId) ?? state.latest;
      if (!binding) return { output: "No session context is available; nothing reported. Continue the task." };
      state.current = undefined;

      const projectId = explicitProjectId || `${binding.userId}:${cwd}`.replace(/[:/\\]/g, "_");
      const release = process.env.DILIGENT_SERVER_VERSION?.trim() || undefined;
      const summaryMd = composeReportMarkdown({
        title: args.title,
        signal,
        cause: args.cause,
        sessionId: binding.sessionId,
        seq: binding.seq,
        release,
        summary: args.summary,
      });
      try {
        await postAgentReport({
          client_report_id: crypto.randomUUID(),
          session_id: binding.sessionId,
          project_id: projectId,
          ...(binding.seq !== undefined ? { seq: binding.seq } : {}),
          event_ts: new Date().toISOString(),
          kind: signal.kind,
          ...(signal.tool ? { tool: signal.tool } : {}),
          cause: args.cause,
          title: args.title,
          summary_md: summaryMd,
          evidence: { count: signal.count },
          ...(release ? { release } : {}),
        });
        const label = signal.tool ? `${signal.kind}/${signal.tool}` : signal.kind;
        return { output: `Failure report filed (${label}). Continue the task.` };
      } catch (error) {
        logger.warn("agent_report.post_failed", {
          message: "[agent-report] report could not be delivered",
          sessionId: binding.sessionId,
          error,
        });
        return { output: "Failure report could not be delivered; continue the task." };
      }
    },
  };
}

function bindingFromInput(input: HookInput): SessionBinding {
  const userId = typeof input.user_id === "string" && input.user_id.trim() ? input.user_id.trim() : "unknown";
  return {
    sessionId: input.session_id,
    seq: typeof input.seq === "number" ? input.seq : undefined,
    userId,
  };
}

/** tool_call ids inside an appended assistant-message entry (empty for any other entry). */
function toolCallIdsInEntry(input: HookInput): string[] {
  const entry = input.entry as { message?: { content?: unknown } } | undefined;
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is { type: "tool_call"; id: string } => {
      return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "tool_call";
    })
    .map((block) => block.id)
    .filter((id): id is string => typeof id === "string");
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/gateway-agent-report.test.ts`
Expected: all pass. If `crypto.randomUUID` is flagged by the sidecar tsconfig lib, use `import { randomUUID } from "node:crypto"` instead.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd ~/Desktop/workhard/diligent
NO_COLOR=1 ./apps/overdare-ai-agent/sidecar/node_modules/.bin/tsc --pretty false --noEmit -p apps/overdare-ai-agent/sidecar/tsconfig.json
bun run lint:fix && bun run lint
git add apps/overdare-ai-agent/sidecar/src/tools/gateway/agent-report.ts apps/overdare-ai-agent/sidecar/test/tools/gateway-agent-report.test.ts
git commit -m "feat(overdare): agent failure report provider (hook + tool + session binding)

Selectors arm; beforeTurn injects one assessment reminder; the agent files via
agent_report_failure only when it judges a genuine failure. Tool-call ids are
bound to sessions from the appended assistant entry.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 5: Register the provider + experiment flag

**Files:**
- Modify: `apps/overdare-ai-agent/sidecar/src/tools/index.ts`
- Modify: `apps/overdare-ai-agent/sidecar/src/experiments.ts`
- Test: `apps/overdare-ai-agent/sidecar/test/tools/bundled-providers.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `bundled-providers.test.ts` inside the `describe`:

```ts
  test("includes the agent-report provider", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    expect(providers.some((p) => p.id === "@overdare/agent-report")).toBe(true);
  });
```

And a new file-level test for the experiment (same file, after the describe):

```ts
import { OVERDARE_EXPERIMENTS } from "../../src/experiments";

test("agent-report experiment hides the tool by default", () => {
  const exp = OVERDARE_EXPERIMENTS.find((e) => e.id === "agent-report");
  expect(exp?.defaultEnabled).toBe(false);
  expect(exp?.toolNames).toEqual(["agent_report_failure"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/overdare-ai-agent/sidecar && bun test test/tools/bundled-providers.test.ts`
Expected: FAIL on both new tests.

- [ ] **Step 3: Register the provider**

In `sidecar/src/tools/index.ts` add the import and the provider (after the gateway transmitter):

```ts
import { createAgentReportToolProvider } from "./gateway/agent-report";
```

```ts
    createGatewayToolProvider(options),
    createAgentReportToolProvider(options),
```

- [ ] **Step 4: Add the experiment**

In `sidecar/src/experiments.ts` append to `OVERDARE_EXPERIMENTS`:

```ts
  {
    id: "agent-report",
    title: "Agent failure reports",
    description: "Let the agent file a failure report to the OVERDARE gateway when a repeat-failure signal fires.",
    defaultEnabled: false,
    toolNames: ["agent_report_failure"],
  },
```

- [ ] **Step 5: Run the sidecar test suite, typecheck, lint**

```bash
cd ~/Desktop/workhard/diligent/apps/overdare-ai-agent/sidecar && bun test test/tools/
cd ~/Desktop/workhard/diligent
NO_COLOR=1 ./apps/overdare-ai-agent/sidecar/node_modules/.bin/tsc --pretty false --noEmit -p apps/overdare-ai-agent/sidecar/tsconfig.json
bun run lint
```

Expected: all green. (`test/tools/advertised-schema.test.ts` may snapshot the advertised tool list; if it fails, the new tool must be added to its expectation — read that test before editing it.)

- [ ] **Step 6: Commit**

```bash
git add apps/overdare-ai-agent/sidecar/src/tools/index.ts apps/overdare-ai-agent/sidecar/src/experiments.ts apps/overdare-ai-agent/sidecar/test/tools/bundled-providers.test.ts
git commit -m "feat(overdare): register agent-report provider behind the agent-report experiment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu"
```

---

### Task 6: Verify end to end + PR

- [ ] **Step 1: Full verification**

```bash
cd ~/Desktop/workhard/diligent && bun run typecheck && bun run test && bun run lint
```

Expected: green. `bun run typecheck` is slow (all packages); run it once here rather than per task.

- [ ] **Step 2: Manual smoke (optional, needs a Studio + dev gateway)**

Enable the experiment in `.diligent/config.jsonc` (`"experiments": { "overrides": { "agent-report": true } }`), run the sidecar against `DILIGENT_GATEWAY_URL=https://diligent-gateway-dev.ovdr.io` with consent granted, trigger a rollback in Studio, and confirm (a) the `<system-reminder>` appears as a context notice, (b) a row lands in the dev gateway's `agent_reports`, (c) one message reaches `#alert-studio-agent`.

- [ ] **Step 3: Open the PR**

```bash
gh pr create --assignee marklee-kk --title "feat(overdare): agent failure reports (selectors + self-assessment + gateway tool)" --body "$(cat <<'EOF'
## Summary
- Deterministic failure selectors (rollback / human_edits / aborted / repeated_call via core DoomLoopDetector / repeated_error) arm once per fingerprint per session
- A context injection asks the agent to judge the armed stretch; only a genuine failure is filed via the new `agent_report_failure` tool to `POST /v1/agent-reports`
- Behind the `agent-report` experiment (default off); consent-gated; never throws into the turn

Spec: `docs/superpowers/specs/2026-09-08-agent-failure-report-design.md`
Gateway side: diligent-gateway `feat/agent-reports`

## Test plan
- [ ] `bun test apps/overdare-ai-agent/sidecar/test/tools/`
- [ ] `bun run typecheck && bun run lint`
- [ ] Manual: experiment on, rollback in Studio → row in dev gateway + Slack line

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01CckSPJgejbwLGL2L14Y3Vu
EOF
)"
```
