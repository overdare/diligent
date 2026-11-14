// @summary Restart recall, sidecar redaction, and outcome coverage for image-resume-recall

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@diligent/core/message-contract";
import type { StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { solidColorPng } from "../../../src/tasks/image-fixture";
import { type ImageResumeRecallWorld, imageResumeRecallTask } from "../../../src/tasks/runtime/image-resume-recall";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

type Execution = RuntimeEvalExecution<ImageResumeRecallWorld>;

describe("image-resume-recall", () => {
  test("defines one deterministic image and a prompt that never reveals its color", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-image-resume-"));
    try {
      const world = await imageResumeRecallTask.setup("shared-seed-123", root);
      expect((await readFile(join(root, world.fixturePath))).equals(solidColorPng(world.color))).toBe(true);
      const steps = imageResumeRecallTask.createSteps(world);
      expect(steps.map((step) => step.kind)).toEqual(["turn", "restart_and_resume", "turn"]);
      expect(JSON.stringify(steps)).not.toContain(world.color);
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("recalls the color after restart while captured evidence stays redacted for both providers", async () => {
    for (const profile of [
      { provider: "openai" as const, model: "gpt-6.1-terra", effort: "medium" as const },
      { provider: "anthropic" as const, model: "claude-sonnet-5", effort: "medium" as const },
    ]) {
      const execution = await assembledExecution(profile);
      const serialized = JSON.stringify(execution);
      expect(imageResumeRecallTask.evaluate(execution)).toEqual({ passed: true });
      expect(serialized).not.toContain("iVBOR");
      expect(JSON.stringify(execution.session.lines)).toMatch(/blob:[0-9a-f]{64}/);
    }
  });

  test("accepts natural color casing and code-formatted replies", async () => {
    const execution = await assembledExecution();
    replaceLastAssistantText(execution.turns[0]!.messages, "`ACK`");
    replaceLastAssistantText(execution.turns[1]!.messages, `COLOR=${execution.world.color.toLowerCase()}`);
    expect(imageResumeRecallTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("fails a wrong color, a re-inspection after restart, a skipped inspection, or extra reply text", async () => {
    const baseline = await assembledExecution();
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "wrong color",
        "image_resume.answer",
        (value) =>
          replaceLastAssistantText(value.turns[1]!.messages, `COLOR=${value.world.color === "RED" ? "BLUE" : "RED"}`),
      ],
      [
        "re-inspected after restart",
        "image_resume.reinspected",
        (value) => value.toolCalls.push({ ...structuredClone(value.toolCalls[0]!), turnIndex: 1, sequence: 2 }),
      ],
      ["never inspected", "image_resume.read", (value) => (value.toolCalls = [])],
      [
        "extra reply text",
        "image_resume.answer_format",
        (value) => replaceLastAssistantText(value.turns[1]!.messages, `I remember COLOR=${value.world.color}.`),
      ],
      [
        "revealing acknowledgement",
        "image_resume.ack",
        (value) => replaceLastAssistantText(value.turns[0]!.messages, `ACK ${value.world.color}`),
      ],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(imageResumeRecallTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

async function assembledExecution(
  profile: EvalProfile = { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
): Promise<RuntimeEvalExecution<ImageResumeRecallWorld>> {
  const result = await runRuntimeEvalExecution({
    task: imageResumeRecallTask,
    seed: "shared-seed-123",
    profile,
    streamFunction: imageResumeStream(),
  });
  expect(result.failures).toEqual([]);
  return result.execution as RuntimeEvalExecution<ImageResumeRecallWorld>;
}

function imageResumeStream(): StreamFunction {
  let call = 0;
  let color: ImageResumeRecallWorld["color"] | undefined;
  let firstPrompt = "";
  return (model, context, options) => {
    call += 1;
    const toolResults = context.messages.filter((message) => message.role === "tool_result");
    const pngs = collectPngBase64(context.messages);
    let response: Message;
    if (call === 1) {
      expect(toolResults).toHaveLength(0);
      expect(pngs).toHaveLength(0);
      firstPrompt = lastUserText(context);
      const path = firstPrompt.match(/\S+\.png/)?.[0];
      if (!path) throw new Error("Image fixture path was absent from the first prompt.");
      response = assistantMessage(
        [{ type: "tool_call", id: "resume-image", name: "read_image", input: { file_path: path } }],
        "tool_use",
      );
    } else if (call === 2) {
      expect(toolResults).toHaveLength(1);
      color = deriveColor(pngs);
      expect(lastUserText(context)).toBe(firstPrompt);
      response = assistantMessage([{ type: "text", text: "ACK" }]);
    } else {
      expect(call).toBe(3);
      expect(toolResults).toHaveLength(1);
      if (!color) throw new Error("The pre-restart image color was not derived.");
      expect(deriveColor(pngs)).toBe(color);
      expect(JSON.stringify(context.messages)).toContain("ACK");
      expect(lastUserText(context)).toContain("COLOR=");
      response = assistantMessage([{ type: "text", text: `COLOR=${color}` }]);
    }
    return sequenceStream([response])(model, context, options);
  };
}

function deriveColor(images: string[]): ImageResumeRecallWorld["color"] {
  expect(images).toHaveLength(1);
  if (images[0] === solidColorPng("RED").toString("base64")) return "RED";
  if (images[0] === solidColorPng("BLUE").toString("base64")) return "BLUE";
  throw new Error("Provider did not receive a loadable seeded PNG.");
}

function collectPngBase64(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectPngBase64);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const own =
    item.type === "base64" && item.media_type === "image/png" && typeof item.data === "string" ? [item.data] : [];
  return [...own, ...Object.values(item).flatMap(collectPngBase64)];
}

function lastUserText(context: StreamContext): string {
  const message = [...context.messages].reverse().find((item) => item.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function replaceLastAssistantText(messages: Message[], text: string): void {
  const message = [...messages].reverse().find((item) => item.role === "assistant");
  if (!message || message.role !== "assistant") throw new Error("Missing assistant message.");
  message.content = [{ type: "text", text }];
}
