// @summary Resource selection, outcome, and code-mode coverage for MCP resource grounding on the real runtime

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { StreamContext } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import {
  type McpResourceGroundingWorld,
  mcpResourceGroundingTask,
} from "../../../src/tasks/runtime/mcp-resource-grounding";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

type Execution = RuntimeEvalExecution<McpResourceGroundingWorld>;

describe("mcp-resource-grounding", () => {
  test("lists, reads the intended reference, writes, and acknowledges for both default profiles", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(mcpResourceGroundingTask.evaluate(execution), profile.provider).toEqual({ passed: true });
    }
  });

  test("passes when the reference is read inside a code-mode exec script", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, { execRead: true });
    expect(execution.toolCalls.map((call) => call.name)).toContain("mcp_read_resource");
    expect(mcpResourceGroundingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("passes scoped listing, progress text, and patch whitespace variations", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, {
      includeProgressText: true,
      scopeResourceList: true,
      trailingPatchNewline: true,
    });
    expect(mcpResourceGroundingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("notes repeated discovery without failing", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!);
    execution.toolCalls.unshift({ ...structuredClone(execution.toolCalls[0]!), toolCallId: "extra-list" });
    expect(mcpResourceGroundingTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [{ code: "mcp_resource.repeated_discovery", impact: "info" }],
    });
  });

  test("fails a decoy read, a missing intended read, a wrong artifact, or a wrong reply", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const read = (value: Execution) => value.toolCalls.find((call) => call.name === "mcp_read_resource")!;
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "decoy read",
        "mcp_resource.decoy_resource",
        (value) =>
          value.toolCalls.push({
            ...structuredClone(read(value)),
            toolCallId: "decoy",
            input: { server: "fixture-reference", uri: value.world.resourceUris[1] },
          }),
      ],
      [
        "intended reference unread",
        "mcp_resource.resource_selection",
        (value) => (read(value).outcome = "runtime_error"),
      ],
      ["wrong artifact", "mcp_resource.result", (value) => (value.verifier!.exitCode = 1)],
      ["wrong reply", "mcp_resource.final", (value) => setFinal(value, value.world.fact)],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(mcpResourceGroundingTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

interface AssembledExecutionOptions {
  includeProgressText?: boolean;
  scopeResourceList?: boolean;
  trailingPatchNewline?: boolean;
  execRead?: boolean;
}

async function assembledExecution(
  profile: EvalProfile,
  assembledOptions: AssembledExecutionOptions = {},
): Promise<RuntimeEvalExecution<McpResourceGroundingWorld>> {
  const seed = "shared-seed-123";
  let call = 0;
  const result = await runRuntimeEvalExecution({
    task: mcpResourceGroundingTask,
    seed,
    profile,
    streamFunction(model, context, options) {
      call += 1;
      const intendedUri = uriFor(seed, "PRIMARY_REFERENCE");
      const fact = token(seed, "GROUNDED_FACT");
      const response =
        call === 1
          ? assistantMessage(
              [
                ...(assembledOptions.includeProgressText
                  ? [{ type: "text" as const, text: "I will inspect resources." }]
                  : []),
                {
                  type: "tool_call",
                  id: "resource-list-call-1",
                  name: "mcp_list_resources",
                  input: assembledOptions.scopeResourceList ? { server: "fixture-reference" } : {},
                },
              ],
              "tool_use",
            )
          : call === 2
            ? assistantMessage(
                [
                  assembledOptions.execRead
                    ? {
                        type: "tool_call" as const,
                        id: "resource-read-call-2",
                        name: "exec",
                        input: {
                          code: `return await tools.mcp_read_resource(${JSON.stringify({ server: "fixture-reference", uri: intendedUri })});`,
                        },
                      }
                    : {
                        type: "tool_call" as const,
                        id: "resource-read-call-2",
                        name: "mcp_read_resource",
                        input: { server: "fixture-reference", uri: intendedUri },
                      },
                ],
                "tool_use",
              )
            : call === 3
              ? assistantMessage(
                  [
                    ...(assembledOptions.includeProgressText
                      ? [{ type: "text" as const, text: "I will write the grounded fact." }]
                      : []),
                    {
                      type: "tool_call",
                      id: "resource-write-call-3",
                      name: profile.provider === "anthropic" ? "edit" : "apply_patch",
                      input:
                        profile.provider === "anthropic"
                          ? {
                              file_path: join(cwdFromContext(context), "grounded-answer.txt"),
                              old_string: "",
                              new_string: `${fact}\n`,
                              replace_all: false,
                            }
                          : {
                              patch: `*** Begin Patch\n*** Add File: grounded-answer.txt\n+${fact}\n*** End Patch${assembledOptions.trailingPatchNewline ? "\n" : ""}`,
                            },
                    },
                  ],
                  "tool_use",
                )
              : assistantMessage([{ type: "text", text: "GROUNDING_COMPLETE" }]);
      return sequenceStream([response])(model, context, options);
    },
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify({ failures: result.failures, toolCalls: result.execution.toolCalls }),
  ).toEqual([]);
  return result.execution as RuntimeEvalExecution<McpResourceGroundingWorld>;
}

function token(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function uriFor(seed: string, prefix: string): string {
  return `fixture://reference/${token(seed, prefix).toLowerCase()}`;
}

function cwdFromContext(context: StreamContext): string {
  const base = context.systemPrompt.find((section) => section.label === "base")?.content ?? "";
  const match = base.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error("Missing runtime cwd in provider context.");
  return match[1];
}

function setFinal(value: Execution, text: string) {
  const final = value.turns[0]!.messages.findLast((message) => message.role === "assistant");
  if (!final || final.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
