// @summary Tests for TUI app behavior through app-server JSON-RPC integration
import { afterEach, describe, expect, test } from "bun:test";
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
import type { AppConfig } from "../src/config";
import { ProviderManager } from "../src/provider-manager";
import { App } from "../src/tui/app";
import { createInProcessRpcClientFactory } from "./helpers/in-process-server";

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
        const error = new Error("aborted");
        stream.push({ type: "error", error });
        stream.error(error);
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

async function setupWorkspace(prefix: string): Promise<{ paths: DiligentPaths; cleanup: () => void }> {
  const prevCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(dir);
  const paths = await ensureDiligentDir(dir);

  return {
    paths,
    cleanup: () => {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function emitChar(ch: string) {
  process.stdin.emit("data", Buffer.from(ch, "utf-8"));
}

function emitText(text: string) {
  for (const ch of text) {
    emitChar(ch);
  }
}

function emitEnter() {
  process.stdin.emit("data", Buffer.from("\r"));
}

function emitCtrlC() {
  process.stdin.emit("data", Buffer.from("\x03"));
}

function emitCtrlO() {
  process.stdin.emit("data", Buffer.from("\x0f"));
}

function captureStdout(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;

  return {
    writes,
    restore: () => {
      process.stdout.write = origWrite;
    },
  };
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

afterEach(() => {
  process.stdin.removeAllListeners("data");
  process.stdout.removeAllListeners("resize");
});

describe("App", () => {
  test("input -> request reaches model context through app-server", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const calls: StreamContext[] = [];
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }], calls);

    const cfg = makeConfig(streamFn);
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("hello");
      emitEnter();
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
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("test");
      emitEnter();
      await wait(180);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    const output = writes.join("");
    expect(output).toContain("Hello ");
    expect(output).toContain("world!");
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
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("run it");
      emitEnter();
      await wait(220);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("bash");
  });

  test("provider error is displayed", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ error: new Error("something went wrong") }]);

    const cfg = makeConfig(streamFn);
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("fail");
      emitEnter();
      await wait(180);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    expect(writes.join("")).toContain("something went wrong");
  });

  test("Ctrl+O toggles tool result details on and off", async () => {
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
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("run");
      emitEnter();
      await wait(240);

      emitCtrlO();
      await wait(60);
      const expandedOutput = stripAnsi(writes.join(""));
      expect(expandedOutput).toContain("line1");

      emitCtrlO();
      await wait(60);
      const collapsedOutput = stripAnsi(writes.join(""));
      expect(collapsedOutput).toContain("(ctrl+o to expand)");
    } finally {
      app.stop();
      restore();
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
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("start");
      emitEnter();
      await wait(60);

      emitText("change approach");
      emitEnter();
      await wait(360);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    const output = stripAnsi(writes.join(""));
    expect(output).toContain("change approach");
    expect(output).not.toContain("[steering] change approach");
  });

  test("Ctrl+C during active turn cancels processing", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ awaitAbort: true }]);

    const cfg = makeConfig(streamFn);
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("slow");
      emitEnter();
      await wait(80);

      emitCtrlC();
      await wait(120);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    expect(writes.join("")).toContain("Cancelled");
  });

  test("rings terminal bell when turn completes", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }]);

    const cfg = makeConfig(streamFn);
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("ring");
      emitEnter();
      await wait(180);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    expect(writes.join("")).toContain("\x07");
  });

  test("terminal bell can be disabled via config", async () => {
    const workspace = await setupWorkspace("diligent-app-test-");
    const streamFn = createScriptedStreamFunction([{ message: createAssistantMessage({ text: "ok" }) }]);

    const cfg = makeConfig(streamFn, { diligent: { terminalBell: false } });
    const { writes, restore } = captureStdout();
    const app = new App(cfg, workspace.paths, {
      rpcClientFactory: createInProcessRpcClientFactory(cfg, workspace.paths),
    });
    try {
      await app.start();
      await wait(30);

      emitText("ring");
      emitEnter();
      await wait(180);
    } finally {
      app.stop();
      restore();
      workspace.cleanup();
    }

    expect(writes.join("")).not.toContain("\x07");
  });
});
