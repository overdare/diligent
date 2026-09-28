// @summary Agent failure report provider: selectors → assessment injection → agent_report_failure tool → gateway.
//
// Spec: docs/superpowers/specs/2026-09-08-agent-failure-report-design.md (Stage 1). No LLM call is
// made here — the loop hook injects a <system-reminder> and the agent's own next round decides
// whether to file. The tool is hidden behind the `agent-report` experiment; the hook stays inert
// whenever the tool is absent from the agent's tool list.
//
// One provider instance is shared by every thread the app-server hosts, so nothing here may assume a
// single agent: armed signals are keyed by a per-injection id the agent must hand back, and reports
// are bound to a session only through the tool_call id that carried them.

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
  /** Cap on the wait for this tool call's session binding. Tests shorten it; production keeps the default. */
  bindingWaitMs?: number;
}

interface SessionBinding {
  sessionId: string;
  seq?: number;
  userId: string;
}

/** Shared between the hooks (which arm) and the tool (which files), across every thread. */
interface ProviderState {
  /** signal id → the signal the agent was asked to assess; deleted when the tool consumes it. */
  signals: Map<string, FailureSignal>;
  /** tool_call id → session, learned from the appended assistant entry. */
  bindings: Map<string, SessionBinding>;
}

const MAX_ENTRIES = 256;

// `onEntryAppended` is dispatched fire-and-forget behind a `setImmediate` once the entry has been
// written to disk, while the agent loop reaches `tool.execute` with no macrotask in between — so the
// binding for the tool call running right now normally lands *after* the tool starts. Hence the wait:
// read the binding once and the report is a no-op in production. Do not "optimise" it away.
const BINDING_WAIT_MS = 2_000;
const BINDING_POLL_MS = 25;

/** Insert into a FIFO-bounded map. */
function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value);
  if (map.size <= MAX_ENTRIES) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

export function createAgentReportToolProvider(options: AgentReportToolProviderOptions): BundledToolProvider {
  const state: ProviderState = { signals: new Map(), bindings: new Map() };
  const explicitProjectId = options.projectId?.trim() ?? "";
  const cwd = options.cwd?.trim() ?? "";

  // Dispatched fire-and-forget after a `setImmediate`, so the binding for the tool call being
  // executed right now usually lands after it started; the tool waits for it (see BINDING_WAIT_MS).
  const onEntryAppended: PluginHookFn = async (input) => {
    const binding = bindingFromInput(input);
    for (const toolCallId of toolCallIdsInEntry(input)) {
      setBounded(state.bindings, toolCallId, binding);
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
  let injectedId: string | undefined;

  return {
    id: "agent-report",
    restore() {
      selectors.reset();
      armed = undefined;
      if (injectedId) state.signals.delete(injectedId);
      injectedId = undefined;
    },
    onPromptStart({ messages }) {
      armed ??= selectors.onPromptStart(messages);
    },
    beforeTurn() {
      if (!armed) return undefined;
      const signal = armed;
      armed = undefined;
      const signalId = crypto.randomUUID();
      injectedId = signalId;
      setBounded(state.signals, signalId, signal);
      logger.info("agent_report.assessment_injected", {
        message: `[agent-report] injected kind=${signal.kind} tool=${signal.tool ?? "-"} count=${signal.count}`,
        fields: { kind: signal.kind, tool: signal.tool, count: signal.count, signalId },
      });
      return [{ source: "agent-report", content: buildAssessmentMessage(signal, signalId) }];
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
      signal_id: z.string().describe("The signal_id from the <system-reminder> that asked for this assessment."),
      cause: z.enum(AGENT_REPORT_CAUSES).describe("Root cause category."),
      title: z.string().min(1).max(200).describe("One line: what went wrong."),
      summary: z.string().min(1).max(4000).describe("What you attempted, why it failed, what would have helped."),
    }),
    execute: async (args, ctx) => {
      const signal = state.signals.get(args.signal_id);
      if (!signal) return { output: "No failure signal is under assessment; nothing reported. Continue the task." };
      if (!options.canTransmitRecords?.()) {
        state.signals.delete(args.signal_id);
        return { output: "Reporting is disabled (AI-data consent not granted). Continue the task." };
      }
      // No fallback binding: guessing a session would file this thread's report against another's.
      const binding = await waitForBinding(state, ctx.toolCallId, options.bindingWaitMs ?? BINDING_WAIT_MS);
      state.signals.delete(args.signal_id);
      if (!binding) return { output: "No session context is available; nothing reported. Continue the task." };

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

/** Poll for the tool call's binding until it lands or the cap expires; no binding means no report. */
async function waitForBinding(
  state: ProviderState,
  toolCallId: string,
  waitMs: number,
): Promise<SessionBinding | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const binding = state.bindings.get(toolCallId);
    if (binding || Date.now() >= deadline) return binding;
    await new Promise((resolve) => setTimeout(resolve, BINDING_POLL_MS));
  }
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
