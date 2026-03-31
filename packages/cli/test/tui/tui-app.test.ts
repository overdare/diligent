// @summary Tests for TUI app behavior through app-server JSON-RPC integration
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssistantMessage,
  DiligentPaths,
  Model,
  ProviderEvent,
  StreamContext,
  StreamFunction,
} from "@diligent/runtime";
import { EventStream, ensureDiligentDir } from "@diligent/runtime";
import type { AppConfig } from "../../src/config";
import { ProviderManager } from "../../src/provider-manager";
import { App } from "../../src/tui/app";
import { createFakeTerminalHarness } from "../helpers/fake-terminal";
import { createInProcessRpcClientFactory } from "../helpers/in-process-server";

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "anthropic",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
};

interface ScriptStep {
  events?: ProviderEvent[];
  message?: AssistantMessage;
  error?: Error;
  awaitAbort?: boolean;
  abortMessage?: string;
}

function createAssistantMessage(args: {
  text?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
}): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (args.text) {
    content.push({ type: "text", text: args.text });
  }
  if (args.toolCall) {
    content.push({
      type: "tool_call",
      id: args.toolCall.id,
      name: args.toolCall.name,
      input: args.toolCall.input,
    });
  }

  return {
    role: "assistant",
    content,
    model: TEST_MODEL.id,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: args.toolCall ? "tool_use" : "end_turn",
    timestamp: Date.now(),
  };
}

function createScriptedStreamFunction(steps: ScriptStep[], calls: StreamContext[] = []): StreamFunction {
  let callIndex = 0;

  return (_model, context, options) => {
    calls.push(context);

    const step = steps[Math.min(callIndex, steps.length - 1)] ?? {
      message: createAssistantMessage({ text: "" }),
    };
    callIndex++;

    const stream = new EventStream<ProviderEvent, { message: AssistantMessage }>(
      (event) => event.type === "done",
      (event) => ({ message: event.message }),
    );

    if (step.awaitAbort) {
      const onAbort = () => {
        const message = step.abortMessage ?? "aborted";
        stream.push({ type: "error", error: new Error(message) });
        const doneMessage = createAssistantMessage({ text: message });
        stream.push({ type: "done", stopReason: doneMessage.stopReason, message: doneMessage });
        stream.end({ message: doneMessage });
      };

      if (options.signal?.aborted) {
        onAbort();
      } else {
        options.signal?.addEventListener("abort", onAbort, { once: true });
      }

      return stream;
    }

    queueMicrotask(() => {
      for (const event of step.events ?? []) {
        stream.push(event);
      }

      if (step.error) {
        stream.push({ type: "error", error: step.error });
        stream.error(step.error);
        return;
      }

      const message = step.message ?? createAssistantMessage({ text: "" });
      stream.push({
        type: "done",
        stopReason: message.stopReason,
        message,
      });
      stream.end({ message });
    });

    return stream;
  };
}

function makeConfig(streamFunction: StreamFunction, opts?: { diligent?: AppConfig["diligent"] }): AppConfig {
  const pm = new ProviderManager({});
  pm.setApiKey("anthropic", "test-key");
  return {
    apiKey: "test-key",
    model: TEST_MODEL,
    systemPrompt: [{ label: "test", content: "test prompt" }],
    diligent: opts?.diligent ?? {},
    sources: [],
    skills: [],
    mode: "default",
    providerManager: pm,
    streamFunction,
  };
}

async function setupWorkspace(prefix: string): Promise<{ root: string; paths: DiligentPaths; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const paths = await ensureDiligentDir(dir);

  return {
    root: dir,
    paths,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createAppHarness(cfg: AppConfig, workspace: { paths: DiligentPaths }) {
  const terminal = createFakeTerminalHarness();
  const app = new App(cfg, workspace.paths, {
    rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths, workspace.root),
    terminalOptions: { stdin: terminal.stdin, stdout: terminal.stdout },
  });
  return { app, terminal };
}

function stripAnsi(input: string): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    if (input.charCodeAt(i) === 27 && input[i + 1] === "[") {
      i += 2;
      while (i < input.length) {
        const ch = input[i];
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += input[i];
    i++;
  }

  return out;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, options?: { timeoutMs?: number; intervalMs?: number }): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 2000;
  const intervalMs = options?.intervalMs ?? 20;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (check()) {
      return;
    }
    await wait(intervalMs);
  }

  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe("App", () => {
  test("input -> request reaches model context through app-server", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const calls: StreamContext[] = [];
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }], calls);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("hello");
      terminal.emitEnter();
      await wait(150);

      expect(calls.length).toBeGreaterThan(0);
      const containsPrompt = calls.some((call) =>
        call.messages.some((message) => message.role === "user" && message.content === "hello"),
      );
      expect(containsPrompt).toBe(true);
    } finally {
      app.stop();
      workspace.cleanup();
    }
  });

  test("message deltas are rendered to terminal output", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([
      {
        events: [{ type: "start" }, { type: "text_delta", delta: "Hello " }, { type: "text_delta", delta: "world!" }],
        message: createAssistantMessage({ text: "Hello world!" }),
      },
    ]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("test");
      terminal.emitEnter();

      const renderOutput = () =>
        ((app as unknown as { root: { render: (width: number) => string[] } }).root.render(120) ?? []).join("\n");

      await waitFor(
        () => {
          const output = renderOutput();
          return output.includes("Hello") && output.includes("world!");
        },
        { timeoutMs: 4000, intervalMs: 20 },
      );

      const output = renderOutput();
      expect(output).toContain("Hello");
      expect(output).toContain("world!");
    } finally {
      app.stop();
      workspace.cleanup();
    }
  });

  test("tool execution is surfaced in UI", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([
      {
        message: createAssistantMessage({
          toolCall: { id: "tc_1", name: "bash", input: { command: "echo hi" } },
        }),
      },
      {
        events: [{ type: "text_delta", delta: "done" }],
        message: createAssistantMessage({ text: "done" }),
      },
    ]);

    const cfg = makeConfig(streamFn, { diligent: { yolo: true } });
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("run it");
      terminal.emitEnter();
      await wait(220);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    expect(output).toContain("bash");
  });

  test("provider error is displayed", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ error: new Error("something went wrong") }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("fail");
      terminal.emitEnter();
      await wait(180);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    expect(terminal.stdout.writes.join("")).toContain("something went wrong");
  });

  test("/clear resets thread while keeping input UI visible", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("/clear");
      terminal.emitEnter();
      await wait(160);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    expect(output).toContain("❯ ");
    expect(output).not.toContain("/clear");
  });

  test("Ctrl+O does not retroactively expand committed tool result snapshots", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([
      {
        message: createAssistantMessage({
          toolCall: { id: "tc_1", name: "bash", input: { command: "printf 'line1\\nline2'" } },
        }),
      },
      {
        events: [{ type: "text_delta", delta: "done" }],
        message: createAssistantMessage({ text: "done" }),
      },
    ]);

    const cfg = makeConfig(streamFn, { diligent: { yolo: true } });
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("run");
      terminal.emitEnter();
      await wait(240);

      terminal.emitCtrlO();
      await wait(60);
      const output = stripAnsi(terminal.stdout.writes.join(""));
      expect(output).toContain("(ctrl+o to expand)");
      expect(output).not.toContain("(ctrl+o to collapse)");
    } finally {
      app.stop();
      workspace.cleanup();
    }
  });

  test("steering injected during active turn is rendered as user message", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([
      {
        message: createAssistantMessage({
          toolCall: { id: "tc_1", name: "bash", input: { command: "sleep 0.2 && echo done" } },
        }),
      },
      {
        message: createAssistantMessage({ text: "final" }),
      },
    ]);

    const cfg = makeConfig(streamFn, { diligent: { yolo: true } });
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("start");
      terminal.emitEnter();
      await wait(60);

      terminal.emitText("change approach");
      terminal.emitEnter();
      await wait(360);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    expect(output).toContain("change approach");
    expect(output).not.toContain("[steering] change approach");
  });

  test("steering UI is always cleared after steering_injected even when queued text mismatches", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ awaitAbort: true }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);

    try {
      await app.start();
      await wait(30);

      terminal.emitText("slow");
      terminal.emitEnter();
      await wait(80);

      terminal.emitText("change approach quickly");
      terminal.emitEnter();
      await wait(40);

      terminal.emitCtrlC();
      await wait(40);

      terminal.emitText("next turn");
      terminal.emitEnter();
      await wait(220);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    const lastSteeringIndex = output.lastIndexOf("⚑ ");
    const nextTurnIndex = output.lastIndexOf("next turn");

    expect(nextTurnIndex).toBeGreaterThan(-1);
    expect(lastSteeringIndex).toBeLessThan(nextTurnIndex);
  });

  test("Ctrl+C during active turn cancels processing", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ awaitAbort: true }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("slow");
      terminal.emitEnter();
      await wait(80);

      terminal.emitCtrlC();
      await wait(120);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    expect(terminal.stdout.writes.join("")).toContain("Cancelled");
  });

  test("Ctrl+C cancel restarts turn with first pending steering message", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const calls: StreamContext[] = [];
    const streamFn = createScriptedStreamFunction(
      [{ awaitAbort: true, abortMessage: "interrupted" }, { message: createAssistantMessage({ text: "resumed" }) }],
      calls,
    );

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("slow");
      terminal.emitEnter();
      await wait(80);

      terminal.emitText("change approach now");
      terminal.emitEnter();
      await wait(40);

      terminal.emitCtrlC();
      await wait(240);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    expect(output).toContain("Cancelled");

    const resumedCall = calls.find((call) =>
      call.messages.some((message) => {
        if (message.role !== "user") return false;
        if (typeof message.content === "string") return message.content === "change approach now";
        const text = message.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        return text === "change approach now";
      }),
    );
    expect(resumedCall).toBeDefined();
  });

  test("manual /compact clears input busy state after compaction completes", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "seed" }) }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);

    try {
      await app.start();
      await wait(30);

      terminal.emitText("hello");
      terminal.emitEnter();
      await wait(180);

      terminal.emitText("/compact");
      terminal.emitEnter();

      await waitFor(
        () => {
          const output = stripAnsi(terminal.stdout.writes.join(""));
          return output.includes("Compacted: 3 entries, 0k → 0k tokens");
        },
        { timeoutMs: 4000, intervalMs: 20 },
      );

      await waitFor(
        () => !((app as unknown as { inputEditor: { busy: boolean } }).inputEditor.busy),
        { timeoutMs: 4000, intervalMs: 20 },
      );
    } finally {
      app.stop();
      workspace.cleanup();
    }

    const output = stripAnsi(terminal.stdout.writes.join(""));
    expect(output).toContain("Compacted: 3 entries, 0k → 0k tokens");
    const compactingCount = (output.match(/Compacting…/g) ?? []).length;
    expect(compactingCount).toBeLessThanOrEqual(1);
    expect((app as unknown as { inputEditor: { busy: boolean } }).inputEditor.busy).toBe(false);
  });

  test("rings terminal bell when turn completes", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }]);

    const cfg = makeConfig(streamFn);
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("ring");
      terminal.emitEnter();
      await wait(180);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    expect(terminal.stdout.writes.join("")).toContain("\x07");
  });

  test("terminal bell can be disabled via config", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }]);

    const cfg = makeConfig(streamFn, { diligent: { terminalBell: false } });
    const { app, terminal } = createAppHarness(cfg, workspace);
    try {
      await app.start();
      await wait(30);

      terminal.emitText("ring");
      terminal.emitEnter();
      await wait(180);
    } finally {
      app.stop();
      workspace.cleanup();
    }

    expect(terminal.stdout.writes.join("")).not.toContain("\x07");
  });
});
