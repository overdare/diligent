// @summary Runtime suite catalog mode: matrix cells, not-run and skip classification, and Markdown over real runs

import { describe, expect, test } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import {
  ProviderError,
  ProviderErrorReason,
  ProviderErrorType,
  type ProviderEvent,
  type ProviderResult,
  type StreamFunction,
} from "@diligent/core/provider-contract";
import { renderCapabilityMatrixMarkdown } from "../../src/capabilities";
import { runRuntimeEvalSuite } from "../../src/runner/runtime-suite";
import type { EvalRunMetadata } from "../../src/runner/suite";
import type { EvalProfile } from "../../src/task";
import {
  basicResponseTask,
  imageGenerationOutputTask,
  instructionHierarchyTask,
  manualCompactionResumeTask,
} from "../../src/tasks/runtime";
import { assistantMessage, sequenceStream } from "../helpers/fake-stream";

const METADATA: EvalRunMetadata = {
  suiteVersion: "test",
  repository: "local/diligent",
  commitSha: "abc123",
  ref: "local",
  runId: "local",
  runAttempt: "1",
  bunVersion: Bun.version,
};

const profile = (provider: EvalProfile["provider"], model: string): EvalProfile => ({
  provider,
  model,
  effort: "medium",
});

const neverStream = () => {
  throw new Error("cells without a live call never stream");
};

describe("runRuntimeEvalSuite catalog matrix", () => {
  test("separates pass, fail, not-run, and unsupported cells without counting the last two as passes", async () => {
    const streams: Record<string, StreamFunction> = {
      openai: (model, context, options) => {
        const token = JSON.stringify(context.messages).match(/PONG_[A-Za-z0-9]+/)?.[0] ?? "missing";
        return sequenceStream([assistantMessage([{ type: "text", text: token }])])(model, context, options);
      },
      anthropic: () =>
        errorStream(
          new ProviderError("invalid x-api-key", {
            errorType: ProviderErrorType.Auth,
            isRetryable: false,
            statusCode: 401,
            reason: ProviderErrorReason.CredentialsRejected,
          }),
        ),
      gemini: () =>
        errorStream(
          new ProviderError("models/gemini-3.6-flash is not found", {
            errorType: ProviderErrorType.Unknown,
            isRetryable: false,
            statusCode: 404,
          }),
        ),
    };
    const executed: string[] = [];

    const report = await runRuntimeEvalSuite({
      tasks: [basicResponseTask, imageGenerationOutputTask],
      profiles: [
        profile("openai", "gpt-6.1-terra"),
        profile("anthropic", "claude-sonnet-5"),
        profile("gemini", "gemini-3.6-flash"),
        profile("chatgpt", "gpt-6.1-terra"),
      ],
      rootSeed: "seed",
      metadata: METADATA,
      createStream: (candidate) => {
        executed.push(candidate.provider);
        return streams[candidate.provider]!;
      },
      matrix: {
        unavailable: (candidate) =>
          candidate.provider === "chatgpt"
            ? { code: "provider_auth.credentials_rejected", reason: "ChatGPT OAuth credentials were rejected." }
            : undefined,
      },
    });

    const matrix = report.matrix!;
    const status = (provider: string, capability: string) =>
      matrix.cells.find((cell) => cell.provider === provider && cell.capability === capability)?.status;
    expect(status("openai", "basic_response")).toBe("pass");
    expect(status("anthropic", "basic_response")).toBe("not_run");
    expect(status("gemini", "basic_response")).toBe("fail");
    expect(status("chatgpt", "basic_response")).toBe("not_run");
    expect(status("openai", "image_generation")).toBe("unsupported");
    expect(status("chatgpt", "image_generation")).toBe("not_run");
    expect(executed).toEqual(["openai", "anthropic", "gemini"]);
    expect(report.executions.map((execution) => execution.taskId)).toEqual([
      "basic-response",
      "basic-response",
      "basic-response",
    ]);
    expect(matrix.counts).toEqual({ pass: 1, fail: 1, not_run: 3, unsupported: 3, skipped: 0 });
    expect(report.passed).toBe(false);
    const geminiCell = matrix.cells.find((cell) => cell.provider === "gemini");
    expect(geminiCell?.code).toBe("provider_terminal.unknown");
    expect(geminiCell?.reason).toContain("not found");

    const markdown = renderCapabilityMatrixMarkdown(report, matrix);
    expect(markdown).toContain("| openai | API key | gpt-6.1-terra | PASS | UNSUPPORTED |");
    expect(markdown).toContain("| chatgpt | ChatGPT OAuth | gpt-6.1-terra | NOT RUN | NOT RUN |");
    expect(markdown).toContain("NOT RUN anthropic/claude-sonnet-5 basic_response `provider_auth.credentials_rejected`");
    expect(markdown).toContain("FAIL gemini/gemini-3.6-flash basic_response");
  });

  test("cost-skipped and unsupported cells never execute and do not fail the run", async () => {
    const report = await runRuntimeEvalSuite({
      tasks: [imageGenerationOutputTask, manualCompactionResumeTask],
      profiles: [profile("openai", "gpt-6.1-terra")],
      rootSeed: "seed",
      metadata: METADATA,
      createStream: neverStream,
      matrix: {
        unavailable: () => ({ code: "credentials_missing", reason: "unset" }),
        costPolicy: (_model, capability) => (capability === "compaction" ? "Cost policy: test skip." : undefined),
      },
    });
    expect(report.matrix?.cells.map((cell) => cell.status)).toEqual(["unsupported", "skipped"]);
    expect(report.executions).toEqual([]);
    expect(report.passed).toBe(true);
    expect(renderCapabilityMatrixMarkdown(report, report.matrix!)).toContain(
      "- Cost policy: test skip. (openai/gpt-6.1-terra)",
    );
  });

  test("rejects a task without a capability tag in catalog mode", async () => {
    await expect(
      runRuntimeEvalSuite({
        tasks: [instructionHierarchyTask],
        profiles: [profile("openai", "gpt-6.1-terra")],
        rootSeed: "seed",
        metadata: METADATA,
        createStream: neverStream,
        matrix: { unavailable: () => undefined },
      }),
    ).rejects.toThrow("capability-tagged");
  });
});

function errorStream(error: Error): ReturnType<StreamFunction> {
  const stream = new EventStream<ProviderEvent, ProviderResult>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") return { message: event.message };
      throw (event as { type: "error"; error: Error }).error;
    },
  );
  queueMicrotask(() => stream.push({ type: "error", error }));
  return stream;
}
