// @summary Tests for the lifecycle hook runner: exit codes, JSON parsing, blocking, context injection

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "../../src/hooks/runner";
import { getLastAssistantMessage, getTurnUsage, runHooks } from "../../src/hooks/runner";

const FIXTURE_CWD = tmpdir();

const BASE_INPUT: HookInput = {
  session_id: "test-session",
  transcript_path: "/tmp/test.jsonl",
  cwd: FIXTURE_CWD,
  hook_event_name: "UserPromptSubmit",
  prompt: "hello world",
};

function handler(command: string, timeout?: number) {
  return { type: "command" as const, command, timeout };
}

describe("runHooks", () => {
  describe("exit code behavior", () => {
    test("exit 0 with no output → allowed, no context", async () => {
      const result = await runHooks([handler("exit 0")], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
      expect(result.additionalContext).toBeUndefined();
    });

    test("exit 2 → blocked, stderr as reason", async () => {
      const result = await runHooks([handler('echo "prompt rejected" >&2; exit 2')], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("prompt rejected");
    });

    test("exit 2 with no stderr → generic reason", async () => {
      const result = await runHooks([handler("exit 2")], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("Hook blocked the operation");
    });

    test("exit 1 (non-zero, non-2) → non-blocking error, allowed", async () => {
      const result = await runHooks([handler('echo "some output"; exit 1')], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
    });
  });

  describe("JSON output parsing", () => {
    test("decision block with reason → blocked", async () => {
      const result = await runHooks(
        [handler('echo \'{"decision":"block","reason":"Not allowed"}\'')],
        BASE_INPUT,
        FIXTURE_CWD,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("Not allowed");
    });

    test("no decision field → allowed", async () => {
      const result = await runHooks([handler('echo \'{"something":"else"}\'')], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
    });

    test("additionalContext in JSON → returned", async () => {
      const result = await runHooks(
        [handler('echo \'{"additionalContext":"Extra info here"}\'')],
        BASE_INPUT,
        FIXTURE_CWD,
      );
      expect(result.blocked).toBe(false);
      expect(result.additionalContext).toBe("Extra info here");
    });

    test("additionalContext in hookSpecificOutput → returned", async () => {
      const result = await runHooks(
        [
          handler(
            'echo \'{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Nested context"}}\'',
          ),
        ],
        BASE_INPUT,
        FIXTURE_CWD,
      );
      expect(result.blocked).toBe(false);
      expect(result.additionalContext).toBe("Nested context");
    });
  });

  describe("plain text output", () => {
    test("non-JSON stdout → treated as additionalContext", async () => {
      const result = await runHooks([handler('echo "plain context text"')], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
      expect(result.additionalContext).toBe("plain context text");
    });
  });

  describe("multiple handlers", () => {
    test("stops on first blocked handler", async () => {
      const result = await runHooks(
        [handler('echo \'{"decision":"block","reason":"First blocked"}\''), handler('echo "should not run"')],
        BASE_INPUT,
        FIXTURE_CWD,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe("First blocked");
    });

    test("combines additionalContext from multiple allowed handlers", async () => {
      const result = await runHooks(
        [handler('echo "context A"'), handler('echo "context B"')],
        BASE_INPUT,
        FIXTURE_CWD,
      );
      expect(result.blocked).toBe(false);
      expect(result.additionalContext).toContain("context A");
      expect(result.additionalContext).toContain("context B");
    });

    test("empty handlers → allowed", async () => {
      const result = await runHooks([], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
    });
  });

  describe("hook input", () => {
    test("hook receives JSON on stdin with correct fields", async () => {
      const scriptPath = join(FIXTURE_CWD, "check-input.sh");
      await Bun.write(
        scriptPath,
        `#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')
PROMPT=$(echo "$INPUT" | jq -r '.prompt')
if [ "$SESSION_ID" = "test-session" ] && [ "$HOOK_EVENT" = "UserPromptSubmit" ] && [ "$PROMPT" = "hello world" ]; then
  exit 0
fi
echo "unexpected input: $INPUT" >&2
exit 2
`,
      );
      await Bun.spawn(["chmod", "+x", scriptPath]).exited;

      const result = await runHooks([handler(`bash "${scriptPath}"`)], BASE_INPUT, FIXTURE_CWD);
      expect(result.blocked).toBe(false);
    });
  });
});

describe("getLastAssistantMessage", () => {
  test("returns empty string for empty array", () => {
    expect(getLastAssistantMessage([])).toBe("");
  });

  test("returns empty string when no assistant messages", () => {
    const messages = [{ role: "user" as const, content: "hello", timestamp: 1 }];
    expect(getLastAssistantMessage(messages)).toBe("");
  });

  test("returns text content of last assistant message (string)", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 1 },
      { role: "assistant" as const, content: "Hi there!", timestamp: 2 },
    ];
    expect(getLastAssistantMessage(messages)).toBe("Hi there!");
  });

  test("returns concatenated text blocks for array content", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Part 1. " },
          { type: "text" as const, text: "Part 2." },
        ],
        timestamp: 1,
      },
    ];
    expect(getLastAssistantMessage(messages)).toBe("Part 1. Part 2.");
  });

  test("returns last assistant message, not first", () => {
    const messages = [
      { role: "assistant" as const, content: "First response", timestamp: 1 },
      { role: "user" as const, content: "follow-up", timestamp: 2 },
      { role: "assistant" as const, content: "Second response", timestamp: 3 },
    ];
    expect(getLastAssistantMessage(messages)).toBe("Second response");
  });
});

describe("getTurnUsage", () => {
  test("returns zero when no assistant message exists in current turn", () => {
    const usage = getTurnUsage([
      { role: "user", content: "hello", timestamp: 1 },
      { role: "tool_result", toolCallId: "tc1", toolName: "read", output: "ok", isError: false, timestamp: 2 },
    ]);
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  test("counts only assistant usage after the latest user message", () => {
    const usage = getTurnUsage([
      {
        role: "assistant",
        content: [{ type: "text", text: "prev turn" }],
        model: "fake-model",
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 },
        stopReason: "end_turn",
        timestamp: 1,
      },
      { role: "user", content: "current turn", timestamp: 2 },
      {
        role: "assistant",
        content: [{ type: "text", text: "tool_use" }],
        model: "fake-model",
        usage: { inputTokens: 30, outputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 3,
      },
      {
        role: "tool_result",
        toolCallId: "tc2",
        toolName: "grep",
        output: "result",
        isError: false,
        timestamp: 4,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "final" }],
        model: "fake-model",
        usage: { inputTokens: 40, outputTokens: 15, cacheReadTokens: 3, cacheWriteTokens: 1 },
        stopReason: "end_turn",
        timestamp: 5,
      },
    ]);

    expect(usage).toEqual({
      inputTokens: 70,
      outputTokens: 25,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
    });
  });
});
