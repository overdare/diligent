// @summary Capability matrix runner: support gating, not-run classification, and report rendering over real runtime runs

import { describe, expect, test } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import { listModels } from "@diligent/core/model-registry";
import {
  ProviderError,
  ProviderErrorReason,
  ProviderErrorType,
  type ProviderEvent,
  type ProviderResult,
  type StreamFunction,
} from "@diligent/core/provider-contract";
import { capabilitySupport, renderCapabilityMatrixMarkdown } from "../../src/capabilities";
import { runCapabilitySuite } from "../../src/runner/capability-suite";
import type { EvalRunMetadata } from "../../src/runner/suite";
import type { EvalProfile } from "../../src/task";
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

describe("runCapabilitySuite", () => {
  test("separates pass, fail, not-run, and unsupported cells without counting the last two as passes", async () => {
    const profiles = [
      profile("openai", "gpt-6.1-terra"),
      profile("anthropic", "claude-sonnet-5"),
      profile("gemini", "gemini-3.6-flash"),
      profile("chatgpt", "gpt-6.1-terra"),
    ];
    const streams: Record<string, StreamFunction> = {
      openai: (model, context, options) => {
        const prompt = JSON.stringify(context.messages);
        const token = prompt.match(/PONG_[A-Za-z0-9]+/)?.[0] ?? "missing";
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

    const report = await runCapabilitySuite({
      profiles,
      capabilities: ["basic_response", "image_generation"],
      rootSeed: "seed",
      metadata: METADATA,
      unavailable: (candidate) =>
        candidate.provider === "chatgpt"
          ? {
              code: "provider_auth.credentials_rejected",
              reason: "ChatGPT OAuth credentials were rejected or expired.",
            }
          : undefined,
      createStream: (candidate) => {
        executed.push(candidate.provider);
        return streams[candidate.provider]!;
      },
      configureProviderManager: () => {},
    });

    const status = (provider: string, capability: string) =>
      report.cells.find((cell) => cell.provider === provider && cell.capability === capability)?.status;
    expect(status("openai", "basic_response")).toBe("pass");
    expect(status("anthropic", "basic_response")).toBe("not_run");
    expect(status("gemini", "basic_response")).toBe("fail");
    expect(status("chatgpt", "basic_response")).toBe("not_run");
    expect(status("openai", "image_generation")).toBe("unsupported");
    expect(status("chatgpt", "image_generation")).toBe("not_run");
    expect(executed).toEqual(["openai", "anthropic", "gemini"]);
    expect(report.executions).toHaveLength(3);
    expect(report.counts).toEqual({ pass: 1, fail: 1, not_run: 3, unsupported: 3 });
    expect(report.passed).toBe(false);
    const geminiCell = report.cells.find((cell) => cell.provider === "gemini");
    expect(geminiCell?.code).toBe("provider_terminal.unknown");
    expect(geminiCell?.reason).toContain("not found");

    const markdown = renderCapabilityMatrixMarkdown(report);
    expect(markdown).toContain("| openai | API key | gpt-6.1-terra | PASS | UNSUPPORTED |");
    expect(markdown).toContain("| chatgpt | ChatGPT OAuth | gpt-6.1-terra | NOT RUN | NOT RUN |");
    expect(markdown).toContain("NOT RUN anthropic/claude-sonnet-5 basic_response `provider_auth.credentials_rejected`");
    expect(markdown).toContain("FAIL gemini/gemini-3.6-flash basic_response");
  });

  test("a run whose every selected cell passes or is unsupported succeeds", async () => {
    const report = await runCapabilitySuite({
      profiles: [profile("openai", "gpt-6.1-terra")],
      capabilities: ["image_generation"],
      rootSeed: "seed",
      metadata: METADATA,
      unavailable: () => undefined,
      createStream: () => {
        throw new Error("unsupported cells never stream");
      },
      configureProviderManager: () => {},
    });
    expect(report.cells).toEqual([expect.objectContaining({ status: "unsupported" })]);
    expect(report.passed).toBe(true);
  });
});

describe("capabilitySupport", () => {
  test("image generation is offered only on the ChatGPT OAuth path", () => {
    for (const provider of ["openai", "anthropic", "gemini"] as const)
      for (const model of listModels(provider))
        expect(capabilitySupport(model, "image_generation").supported, `${provider}/${model.modelId}`).toBe(false);
    for (const model of listModels("chatgpt"))
      expect(capabilitySupport(model, "image_generation").supported).toBe(true);
  });

  test("image reading follows the model card's vision declaration", () => {
    expect(capabilitySupport({ provider: "openai", supportsVision: false }, "image_read").supported).toBe(false);
    expect(capabilitySupport({ provider: "openai", supportsVision: true }, "image_read").supported).toBe(true);
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
