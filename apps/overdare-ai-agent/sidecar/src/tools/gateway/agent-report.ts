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
