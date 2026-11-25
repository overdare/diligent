// @summary Assembled-runtime and evaluator coverage for the model capability probe tasks

import { describe, expect, test } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import type { AssistantMessage, Message } from "@diligent/core/message-contract";
import type {
  ProviderEvent,
  ProviderManager,
  ProviderResult,
  StreamContext,
  StreamFunction,
} from "@diligent/core/provider-contract";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { AnyRuntimeEvalTask, RuntimeEvalExecution, RuntimeEvalExecutionResult } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { basicResponseCapabilityTask } from "../../../src/tasks/capabilities/basic-response";
import {
  type CompactionCapabilityWorld,
  compactionCapabilityTask,
  NOTES_TOOL,
} from "../../../src/tasks/capabilities/compaction";
import {
  dominantColor,
  type ImageGenerationCapabilityWorld,
  imageGenerationCapabilityTask,
} from "../../../src/tasks/capabilities/image-generation";
import { type ImageReadCapabilityWorld, imageReadCapabilityTask } from "../../../src/tasks/capabilities/image-read";
import { extractUrlHosts, webResultHosts, webSearchCapabilityTask } from "../../../src/tasks/capabilities/web-search";
import {
  EVAL_QUADRANTS,
  quadrantColorPng,
  seededQuadrantLayout,
  solidColorPng,
} from "../../../src/tasks/image-fixture";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

const SEED = "capability-seed";
const OPENAI: EvalProfile = { provider: "openai", model: "gpt-6.1-terra", effort: "medium" };
const CHATGPT: EvalProfile = { provider: "chatgpt", model: "gpt-6.1-terra", effort: "medium" };

describe("capability-basic-response", () => {
  test("passes an exact reply and fails a wrong one through the assembled runtime", async () => {
    const passed = await run(basicResponseCapabilityTask, (_call, context) =>
      text(lastUserText(context).split(" ")[3]!),
    );
    expect(passed.failures).toEqual([]);
    expect(passed.passed).toBe(true);

    const failed = await run(basicResponseCapabilityTask, () => text("hello"));
    expect(failed.failure).toMatchObject({ dimension: "semantic_goal" });
  });
});

describe("capability-image-read", () => {
  test("the provider receives the quadrant image and an exact layout passes", async () => {
    const layout = seededQuadrantLayout(SEED);
    let received: string[] = [];
    const result = await run(imageReadCapabilityTask, (call, context) => {
      if (call === 1) return readImageCall(lastUserText(context));
      received = collectPngBase64(context.messages);
      return text(EVAL_QUADRANTS.map((quadrant) => `${quadrant}=${layout[quadrant]}`).join("; "));
    });
    expect(result.failures).toEqual([]);
    expect(received).toEqual([quadrantColorPng(layout).toString("base64")]);
    expect(JSON.stringify(result.execution)).not.toContain("iVBOR");
  });

  test("a fixture path split across streamed text deltas still mirrors the normalized final message", async () => {
    const layout = seededQuadrantLayout(SEED);
    const result = await runRuntimeEvalExecution({
      task: imageReadCapabilityTask,
      profile: OPENAI,
      seed: SEED,
      streamFunction: (() => {
        let call = 0;
        return (model, context, options) => {
          call += 1;
          if (call === 2)
            return sequenceStream([text(EVAL_QUADRANTS.map((q) => `${q}=${layout[q]}`).join("; "))])(
              model,
              context,
              options,
            );
          const path = lastUserText(context).match(/\S+\.png/)![0];
          const narration = `I will read \`${path}\`.`;
          const split = narration.indexOf("/", narration.indexOf("/") + 1);
          return splitTextStream(
            assistantMessage(
              [
                { type: "text", text: narration },
                { type: "tool_call", id: "read", name: "read_image", input: { file_path: path } },
              ],
              "tool_use",
            ),
            [narration.slice(0, split), narration.slice(split)],
          );
        };
      })(),
    });
    expect(result.failures).toEqual([]);
  });

  test("seeded layouts use four distinct colors", () => {
    for (const seed of ["a", "b", "c", "d"]) expect(new Set(Object.values(seededQuadrantLayout(seed))).size).toBe(4);
  });

  test("a swapped quadrant is a semantic failure", async () => {
    const result = await run(imageReadCapabilityTask, (call, context) => {
      if (call === 1) return readImageCall(lastUserText(context));
      const layout = seededQuadrantLayout(SEED);
      return text(`TL=${layout.TR}; TR=${layout.TL}; BL=${layout.BL}; BR=${layout.BR}`);
    });
    const world = result.execution.world as ImageReadCapabilityWorld;
    expect(world.layout.TL).not.toBe(world.layout.TR);
    expect(result.failure).toMatchObject({ code: "task_semantic.capability_image_read.answer" });
  });
});

describe("capability-web-search", () => {
  test("advertises the provider-native web tool and passes an answer grounded in the results", async () => {
    const result = await run(webSearchCapabilityTask, () =>
      webAnswer("See https://bun.sh/docs/api/http.", [{ url: "https://bun.sh/docs/api/http", title: "HTTP server" }]),
    );
    expect(result.failures).toEqual([]);
    const tools = result.execution.providerCalls[0]!.tools.items;
    expect(tools).toContainEqual(expect.objectContaining({ kind: "provider_builtin", capability: "web" }));
  });

  test("fails without a native search and when the cited host is absent from the results", async () => {
    const unsearched = await run(webSearchCapabilityTask, () => text("https://bun.sh/docs/api/http"));
    expect(unsearched.failure).toMatchObject({ code: "task_semantic.capability_web_search.not_searched" });

    const ungrounded = await run(webSearchCapabilityTask, () =>
      webAnswer("https://example.com/bun", [{ url: "https://bun.sh/docs/api/http" }]),
    );
    expect(ungrounded.failure).toMatchObject({ code: "task_semantic.capability_web_search.ungrounded" });
  });

  test("accepts a bare-domain title for providers that return redirect URLs", () => {
    const hosts = webResultHosts([{ url: "https://vertexaisearch.cloud.google.com/grounding/abc", title: "bun.sh" }]);
    expect(extractUrlHosts("Source: https://www.bun.sh/docs/api/http.").some((host) => hosts.has(host))).toBe(true);
  });
});

describe("capability-image-generation", () => {
  test("generates through ProviderManager, exposes the image on thread/read, and grades the model's color", async () => {
    let requestedPrompt = "";
    const configure = (_profile: EvalProfile, manager: ProviderManager) =>
      manager.setExternalAuth("chatgpt", {
        isConfigured: () => true,
        getStream: () => {
          throw new Error("The runner installs the profile stream.");
        },
        getImageGeneration: () => async (input) => {
          requestedPrompt = input.prompt;
          return { bytes: solidColorPng("RED"), mediaType: "image/png", requestedModel: input.model };
        },
      });
    let modelSawImage = false;
    const respond = (answer: string) => (call: number, context: StreamContext) => {
      if (call === 1)
        return assistantMessage(
          [{ type: "tool_call", id: "gen", name: "generate_image", input: { prompt: "a flat background swatch" } }],
          "tool_use",
        );
      modelSawImage = collectPngBase64(context.messages).includes(solidColorPng("RED").toString("base64"));
      return text(answer);
    };

    const passed = await run(imageGenerationCapabilityTask, respond("RED"), CHATGPT, configure);
    const world = passed.execution.world as ImageGenerationCapabilityWorld;
    expect(passed.failures).toEqual([]);
    expect(modelSawImage).toBe(true);
    expect(requestedPrompt).toContain(world.color.toLowerCase());
    expect(world.generated).toEqual([expect.objectContaining({ mediaType: "image/png", dominantColor: "RED" })]);

    const unseen = await run(imageGenerationCapabilityTask, respond("BLUE"), CHATGPT, configure);
    expect(unseen.failure).toMatchObject({ code: "task_semantic.capability_image_generation.not_seen" });
  });

  test("a provider without image generation fails the probe with the runtime error", async () => {
    const result = await run(imageGenerationCapabilityTask, (call) =>
      call === 1
        ? assistantMessage(
            [{ type: "tool_call", id: "gen", name: "generate_image", input: { prompt: "swatch" } }],
            "tool_use",
          )
        : text("RED"),
    );
    expect(result.failure).toMatchObject({ code: "task_semantic.capability_image_generation.generation_failed" });
    expect(result.failure?.message).toContain("OAuth");
  });

  test("classifies only clearly single-channel colors", () => {
    expect(dominantColor([220, 30, 30])).toBe("RED");
    expect(dominantColor([30, 170, 60])).toBe("GREEN");
    expect(dominantColor([240, 210, 30])).toBeUndefined();
  });
});

describe("capability-compaction", () => {
  const notesCall = () =>
    assistantMessage([{ type: "tool_call", id: "notes", name: NOTES_TOOL, input: {} }], "tool_use");

  test("compacts the tool-inflated thread and grades recall from the compacted context", async () => {
    let facts = "";
    let postCompactionContext = "";
    const result = await run(compactionCapabilityTask, (call, context) => {
      if (call === 1) return notesCall();
      if (call === 2) {
        facts = [...JSON.stringify(context.messages).matchAll(/(ALPHA|BETA)=([A-Za-z0-9_]+)/g)]
          .slice(0, 2)
          .map((match) => match[0])
          .join("; ");
        return text("ACK");
      }
      if (call === 3) return text(`## Critical Context\n${facts}`);
      postCompactionContext = JSON.stringify(context.messages);
      return text(facts);
    });
    const world = result.execution.world as CompactionCapabilityWorld;
    expect(result.failures).toEqual([]);
    expect(facts).toBe(`ALPHA=${world.alpha}; BETA=${world.beta}`);
    expect(result.execution.compactions[0]?.response.compacted).toBe(true);
    expect(postCompactionContext).not.toContain("eligible-compaction-padding");
  });

  test("refuses a second notes load so recall cannot bypass compaction", async () => {
    const result = await run(compactionCapabilityTask, (call) => {
      if (call === 1 || call === 4) return notesCall();
      if (call === 2) return text("ACK");
      if (call === 3) return text("## Critical Context\nNothing retained.");
      return text("ALPHA=unknown; BETA=unknown");
    });
    const loads = result.execution.toolCalls.filter((trace) => trace.name === NOTES_TOOL);
    expect(loads.map((trace) => [trace.turnIndex, trace.outcome])).toEqual([
      [0, "success"],
      [1, "runtime_error"],
    ]);
    expect(result.failure).toMatchObject({ code: "task_semantic.capability_compaction.lost_facts" });
  });
});

type Responder = (call: number, context: StreamContext) => AssistantMessage;

async function run(
  task: AnyRuntimeEvalTask,
  respond: Responder,
  profile: EvalProfile = OPENAI,
  configureProviderManager?: (profile: EvalProfile, manager: ProviderManager) => void,
): Promise<RuntimeEvalExecutionResult & { execution: RuntimeEvalExecution<unknown> }> {
  return runRuntimeEvalExecution({
    task,
    profile,
    seed: SEED,
    streamFunction: scripted(respond),
    configureProviderManager,
  });
}

function scripted(respond: Responder): StreamFunction {
  let call = 0;
  return (model, context, options) => sequenceStream([respond(++call, context)])(model, context, options);
}

function text(value: string): AssistantMessage {
  return assistantMessage([{ type: "text", text: value }]);
}

function readImageCall(prompt: string): AssistantMessage {
  const path = prompt.match(/\S+\.png/)?.[0];
  if (!path) throw new Error("The image path was absent from the prompt.");
  return assistantMessage(
    [{ type: "tool_call", id: "read", name: "read_image", input: { file_path: path } }],
    "tool_use",
  );
}

function webAnswer(answer: string, results: { url: string; title?: string }[]): AssistantMessage {
  return assistantMessage([
    { type: "provider_tool_use", id: "search", provider: "openai", name: "web_search", input: { query: "Bun.serve" } },
    { type: "web_search_result", toolUseId: "search", provider: "openai", results },
    { type: "text", text: answer },
  ]);
}

function collectPngBase64(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectPngBase64);
  if (!value || typeof value !== "object") return [];
  const entries = Object.entries(value);
  const own = entries.some(([key, item]) => key === "type" && item === "base64")
    ? entries.flatMap(([key, item]) => (key === "data" && typeof item === "string" ? [item] : []))
    : [];
  return [...own, ...entries.flatMap(([, item]) => collectPngBase64(item))];
}

function lastUserText(context: StreamContext): string {
  const message = [...context.messages]
    .reverse()
    .find((item): item is Extract<Message, { role: "user" }> => item.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Streams one assistant message whose text arrives in the given chunks. */
function splitTextStream(message: AssistantMessage, chunks: string[]): ReturnType<StreamFunction> {
  const stream = new EventStream<ProviderEvent, ProviderResult>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") return { message: event.message };
      throw (event as { type: "error"; error: Error }).error;
    },
  );
  queueMicrotask(() => {
    stream.push({ type: "start" });
    for (const chunk of chunks) stream.push({ type: "text_delta", delta: chunk });
    for (const block of message.content) {
      if (block.type !== "tool_call") continue;
      stream.push({ type: "tool_call_start", id: block.id, name: block.name });
      stream.push({ type: "tool_call_end", id: block.id, name: block.name, input: block.input });
    }
    stream.push({ type: "done", stopReason: message.stopReason, message });
  });
  return stream;
}
