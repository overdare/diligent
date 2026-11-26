// @summary Prompt selection, outcome, and recovery coverage for MCP prompt grounding on the real runtime

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@diligent/core/message-contract";
import type { StreamContext } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { type McpPromptGroundingWorld, mcpPromptGroundingTask } from "../../../src/tasks/runtime/mcp-prompt-grounding";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

type Execution = RuntimeEvalExecution<McpPromptGroundingWorld>;

describe("mcp-prompt-grounding", () => {
  test("hides the prompt names, fact, and decoys from the client prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-mcp-prompt-"));
    try {
      const world = await mcpPromptGroundingTask.setup("shared-seed-123", root);
      expect(world.argumentValues.every((value) => world.clientPrompt.includes(value))).toBe(true);
      expect(world.clientPrompt).not.toContain(world.fact);
      expect(world.promptNames.every((name) => !world.clientPrompt.includes(name))).toBe(true);
      expect(world.decoyFacts.every((fact) => !world.clientPrompt.includes(fact))).toBe(true);
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("lists, fetches the intended prompt, writes, and acknowledges for both default profiles", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(mcpPromptGroundingTask.evaluate(execution), profile.provider).toEqual({ passed: true });
    }
  });

  test("passes scoped listing, progress text, and patch whitespace variations", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, {
      includeProgressText: true,
      scopePromptList: true,
      trailingPatchNewline: true,
    });
    expect(mcpPromptGroundingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("degrades but passes after unknown-name lookups, repeated listings, or recovered writes", async () => {
    const anthropic = DEFAULT_PROFILES.find((candidate) => candidate.provider === "anthropic")!;
    const lookup = await assembledExecution(anthropic, { promptLookupRecovery: true });
    const repeated = structuredClone(lookup);
    repeated.toolCalls.splice(1, 0, { ...structuredClone(lookup.toolCalls[0]!), toolCallId: "second-guess" });
    for (const execution of [
      lookup,
      repeated,
      await assembledExecution(anthropic, { recoveryKind: "relative-path" }),
      await assembledExecution(anthropic, { recoveryKind: "missing-file" }),
    ]) {
      const result = mcpPromptGroundingTask.evaluate(execution);
      expect(result.passed).toBe(true);
      expect(result.diagnostics?.length).toBeGreaterThan(0);
    }
  });

  test("fails a decoy fetch, a missing intended fetch, a wrong artifact, or a wrong reply", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "decoy fetched",
        "mcp_prompt.decoy_prompt",
        (value) =>
          value.toolCalls.push({
            ...structuredClone(value.toolCalls.find((call) => call.name === "mcp_get_prompt")!),
            toolCallId: "decoy",
            input: { server: "fixture-workflows", name: value.world.promptNames[1] },
          }),
      ],
      [
        "intended prompt not fetched",
        "mcp_prompt.prompt_selection",
        (value) => (value.toolCalls.find((call) => call.name === "mcp_get_prompt")!.outcome = "runtime_error"),
      ],
      ["wrong artifact", "mcp_prompt.result", (value) => (value.verifier!.exitCode = 1)],
      ["wrong reply", "mcp_prompt.final", (value) => setFinal(value, `Wrote ${value.world.fact}`)],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(mcpPromptGroundingTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

interface AssembledExecutionOptions {
  includeProgressText?: boolean;
  promptLookupRecovery?: boolean;
  recoveryKind?: "relative-path" | "missing-file";
  scopePromptList?: boolean;
  trailingPatchNewline?: boolean;
}

async function assembledExecution(
  profile: EvalProfile,
  assembledOptions: AssembledExecutionOptions = {},
): Promise<RuntimeEvalExecution<McpPromptGroundingWorld>> {
  const seed = "shared-seed-123";
  let call = 0;
  const result = await runRuntimeEvalExecution({
    task: mcpPromptGroundingTask,
    seed,
    profile,
    streamFunction(model, context, options) {
      call += 1;
      const intendedName = "current-orbital-handoff";
      const fact = token(seed, "ORBITAL_FACT");
      const args = {
        relay_designator: token(seed, "RELAY_DESIGNATOR"),
        handoff_window: token(seed, "HANDOFF_WINDOW"),
      };
      const recovery = assembledOptions.promptLookupRecovery;
      let response: AssistantMessage;
      if (call === 1 && recovery) {
        response = assistantMessage(
          [
            {
              type: "tool_call",
              id: "prompt-unknown-call-1",
              name: "mcp_get_prompt",
              input: { server: "fixture-workflows", name: "orbital_relay_handoff", args },
            },
          ],
          "tool_use",
        );
      } else if (call === 1 || call === (recovery ? 2 : -1)) {
        let progress: { type: "text"; text: string }[] = [];
        if (assembledOptions.includeProgressText) {
          progress = [{ type: "text" as const, text: "I will inspect prompts." }];
        }
        response = assistantMessage(
          [
            ...progress,
            {
              type: "tool_call",
              id: call === 1 ? "prompt-list-call-1" : "prompt-list-call-2",
              name: "mcp_list_prompts",
              input: assembledOptions.scopePromptList ? { server: "fixture-workflows" } : {},
            },
          ],
          "tool_use",
        );
      } else if (call === (recovery ? 3 : 2)) {
        response = assistantMessage(
          [
            {
              type: "tool_call",
              id: recovery ? "prompt-get-call-3" : "prompt-get-call-2",
              name: "mcp_get_prompt",
              input: { server: "fixture-workflows", name: intendedName, args },
            },
          ],
          "tool_use",
        );
      } else if (call === (recovery ? 4 : 3) || (assembledOptions.recoveryKind !== undefined && call === 4)) {
        let progress: { type: "text"; text: string }[] = [];
        if (assembledOptions.includeProgressText) {
          progress = [{ type: "text" as const, text: "I will write the rendered workflow." }];
        }
        let writeId: string;
        if (call !== (recovery ? 4 : 3)) {
          writeId = "prompt-write-recovery-call-4";
        } else if (recovery) {
          writeId = "prompt-write-call-4";
        } else {
          writeId = "prompt-write-call-3";
        }
        let writeInput: Record<string, unknown>;
        if (profile.provider === "anthropic") {
          let filePath: string;
          if (assembledOptions.recoveryKind === "relative-path" && call === 3) {
            filePath = "orbital-workflow.txt";
          } else {
            filePath = join(cwdFromContext(context), "orbital-workflow.txt");
          }
          let oldString = "";
          if (assembledOptions.recoveryKind === "missing-file" && call === 3) {
            oldString = "REPLACE_ME_FILE_DOES_NOT_EXIST";
          }
          writeInput = { file_path: filePath, old_string: oldString, new_string: `${fact}\n`, replace_all: false };
        } else {
          writeInput = {
            patch: `*** Begin Patch\n*** Add File: orbital-workflow.txt\n+${fact}\n*** End Patch${assembledOptions.trailingPatchNewline ? "\n" : ""}`,
          };
        }
        response = assistantMessage(
          [
            ...progress,
            {
              type: "tool_call",
              id: writeId,
              name: profile.provider === "anthropic" ? "edit" : "apply_patch",
              input: writeInput,
            },
          ],
          "tool_use",
        );
      } else {
        response = assistantMessage([{ type: "text", text: "ORBITAL_WORKFLOW_COMPLETE" }]);
      }
      return sequenceStream([response])(model, context, options);
    },
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify({ failures: result.failures, toolCalls: result.execution.toolCalls }),
  ).toEqual([]);
  return result.execution as RuntimeEvalExecution<McpPromptGroundingWorld>;
}

function token(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function cwdFromContext(context: StreamContext): string {
  const base = context.systemPrompt.find((section) => section.label === "base")?.content ?? "";
  const match = base.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error("Missing runtime cwd in provider context.");
  return match[1];
}

function setFinal(value: Execution, text: string) {
  const final = value.turns[0]!.messages.at(-1);
  if (final?.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
