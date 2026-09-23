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
        return arm({
          kind: "human_edits",
          tool: HUMAN_EDITS_TOOL,
          count: 1,
          fingerprint: `human_edits:${HUMAN_EDITS_TOOL}`,
        });
      }

      // Record the streak before the doom-loop check: that check can return early, and a success
      // must still reset the streak on the very call that arms `repeated_call`.
      const streak = result.isError ? (streaks.get(toolCall.name) ?? 0) + 1 : 0;
      streaks.set(toolCall.name, streak);

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
