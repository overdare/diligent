// @summary Real-runtime resume, memory, outcome, and code-mode coverage for collaboration-resume-reference

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveModel, resolveModelForClass } from "@diligent/core/model-registry";
import type { StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import {
  type CollaborationResumeReferenceWorld,
  collaborationResumeReferenceTask,
} from "../../../src/tasks/runtime/collaboration-resume-reference";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

const CALL_IDS = {
  spawnInitial: "resume-reference-spawn-1",
  readInitial: "resume-reference-read-2",
  waitInitial: "resume-reference-wait-3",
  spawnFollowUp: "resume-reference-spawn-4",
  readFollowUp: "resume-reference-read-5",
  waitFollowUp: "resume-reference-wait-6",
  write: "resume-reference-write-7",
} as const;

type Execution = RuntimeEvalExecution<CollaborationResumeReferenceWorld>;

describe("collaboration-resume-reference", () => {
  test("restarts and resumes the same persisted child for both providers", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(collaborationResumeReferenceTask.evaluate(execution), profile.provider).toEqual({ passed: true });
      expect(execution.childSessions).toHaveLength(1);
      const childModel = resolveModelForClass(
        resolveModel({ provider: profile.provider, modelId: profile.model }),
        "lite",
      );
      expect(
        execution.providerCalls
          .filter((call) => call.sessionId === childId(execution))
          .map((call) => call.model.modelId),
      ).toEqual([childModel.modelId, childModel.modelId, profile.model, profile.model]);
    }
  });

  test("passes when the child reads inside code-mode exec scripts across the restart", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, { childExec: true });
    expect(collaborationResumeReferenceTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("passes alternative briefs, omitted optional inputs, provider progress, and verbose or deferred child reports", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile, {
        generatedIds: true,
        semanticSpawnInputs: true,
        omitSpawnOptionalDefaults: true,
        omitResumeAgentType: true,
        longWait: true,
        includeProviderProgress: true,
        explicitReadDefaults: true,
        verboseInitialChildReport: true,
        deferredCombinedChildReport: true,
      });
      expect(collaborationResumeReferenceTask.evaluate(execution), profile.provider).toEqual({ passed: true });
    }
  });

  test("degrades but passes after a recovered write", async () => {
    const anthropic = DEFAULT_PROFILES.find((candidate) => candidate.provider === "anthropic")!;
    const execution = await assembledExecution(anthropic, { anthropicWriteRecovery: true });
    expect(collaborationResumeReferenceTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [{ code: "collaboration_resume_reference.recovery" }],
    });
  });

  test("fails without resume, with a reread or leaked initial value, with direct reads, or with wrong outputs", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const resumeSpawn = (value: Execution) =>
      value.toolCalls.find((call) => call.name === "spawn_agent" && call.turnIndex === 1)!;
    const followUpRead = (value: Execution) =>
      value.toolCalls.find((call) => call.name === "read" && call.turnIndex === 1)!;
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "fresh spawn instead of resume",
        "collaboration_resume_reference.resume",
        (value) => (resumeSpawn(value).input = { message: "Read references/follow-up.fact", agent_type: "explore" }),
      ],
      [
        "initial reference reread",
        "collaboration_resume_reference.reread_initial",
        (value) =>
          value.toolCalls.push({
            ...structuredClone(followUpRead(value)),
            toolCallId: "reread",
            input: { file_path: `$WORKSPACE/${value.world.sourcePaths[0]}` },
          }),
      ],
      [
        "initial value supplied in the resume request",
        "collaboration_resume_reference.leaked_initial",
        (value) => ((resumeSpawn(value).input as { message: string }).message += ` ${value.world.tokens[0]}`),
      ],
      [
        "direct parent read",
        "collaboration_resume_reference.parent_read",
        (value) => (followUpRead(value).threadId = value.session.threadId),
      ],
      ["wrong artifact", "collaboration_resume_reference.result", (value) => (value.verifier!.exitCode = 1)],
      [
        "acknowledgement reveals the value",
        "collaboration_resume_reference.acknowledgement",
        (value) => setTurnFinal(value, 0, `${value.world.tokens[0]} REFERENCE_ACK`),
      ],
      ["wrong final reply", "collaboration_resume_reference.final", (value) => setTurnFinal(value, 1, "Done.")],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(collaborationResumeReferenceTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

async function assembledExecution(
  profile: EvalProfile,
  assembledOptions: AssembledExecutionOptions = {},
): Promise<RuntimeEvalExecution<CollaborationResumeReferenceWorld>> {
  const seed = "shared-seed-123";
  const result = await runRuntimeEvalExecution({
    task: collaborationResumeReferenceTask,
    seed,
    profile,
    streamFunction: fixtureStream(profile, seed, assembledOptions),
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify({ failures: result.failures, toolCalls: result.execution.toolCalls }),
  ).toEqual([]);
  return result.execution as RuntimeEvalExecution<CollaborationResumeReferenceWorld>;
}

interface AssembledExecutionOptions {
  generatedIds?: boolean;
  semanticSpawnInputs?: boolean;
  omitSpawnOptionalDefaults?: boolean;
  omitResumeAgentType?: boolean;
  longWait?: boolean;
  includeProviderProgress?: boolean;
  explicitReadDefaults?: boolean;
  trailingChildReport?: boolean;
  inlineInitialChildReport?: boolean;
  verboseInitialChildReport?: boolean;
  trailingPatchNewline?: boolean;
  omitEditReplaceAll?: boolean;
  anthropicWriteRecovery?: boolean;
  deferredCombinedChildReport?: boolean;
  childExec?: boolean;
}

function fixtureStream(
  profile: EvalProfile,
  seed: string,
  assembledOptions: AssembledExecutionOptions,
): StreamFunction {
  let parentCall = 0;
  let childCall = 0;
  const tokens = [seeded(seed, "FIRST_REFERENCE"), seeded(seed, "SECOND_REFERENCE")];
  const callIds = assembledOptions.generatedIds
    ? {
        spawnInitial: "runtime-spawn-initial",
        readInitial: "runtime-read-initial",
        waitInitial: "runtime-wait-initial",
        spawnFollowUp: "runtime-spawn-follow-up",
        readFollowUp: "runtime-read-follow-up",
        waitFollowUp: "runtime-wait-follow-up",
        write: "runtime-write-reference",
      }
    : CALL_IDS;
  return (model, context, options) => {
    const response = context.systemPrompt.some((section) => section.label === "agent_role")
      ? childResponse(++childCall, context, tokens, callIds, assembledOptions)
      : parentResponse(++parentCall, profile, context, tokens, callIds, assembledOptions);
    return sequenceStream([response])(model, context, options);
  };
}

function childResponse(
  call: number,
  context: StreamContext,
  tokens: string[],
  callIds: Record<keyof typeof CALL_IDS, string>,
  assembledOptions: AssembledExecutionOptions,
) {
  if (call === 1 || call === 3) {
    const index = call === 1 ? 0 : 1;
    return assistantMessage(
      [
        ...(assembledOptions.includeProviderProgress
          ? [{ type: "thinking" as const, thinking: "I will perform the one requested read." }]
          : []),
        assembledOptions.childExec
          ? {
              type: "tool_call" as const,
              id: index === 0 ? callIds.readInitial : callIds.readFollowUp,
              name: "exec",
              input: {
                code: `return await tools.read({ file_path: ${JSON.stringify(join(cwdFromContext(context, "runtime_context"), index === 0 ? "references/initial.fact" : "references/follow-up.fact"))} });`,
              },
            }
          : {
              type: "tool_call" as const,
              id: index === 0 ? callIds.readInitial : callIds.readFollowUp,
              name: "read",
              input: {
                file_path: join(
                  cwdFromContext(context, "runtime_context"),
                  index === 0 ? "references/initial.fact" : "references/follow-up.fact",
                ),
                ...(assembledOptions.explicitReadDefaults ? { offset: 1, limit: 2000 } : {}),
              },
            },
      ],
      "tool_use",
    );
  }
  const token = tokens[call === 2 ? 0 : 1]!;
  return assistantMessage([
    ...(assembledOptions.includeProviderProgress
      ? [{ type: "thinking" as const, thinking: "The requested value is ready." }]
      : []),
    {
      type: "text",
      text:
        assembledOptions.deferredCombinedChildReport && call === 2
          ? "Completed the single requested read."
          : assembledOptions.deferredCombinedChildReport && call === 4
            ? `${tokens[0]}  \n${tokens[1]}`
            : assembledOptions.verboseInitialChildReport && call === 2
              ? `Completed. Contents:\n\n\`\`\`text\n${token}\n\`\`\``
              : assembledOptions.inlineInitialChildReport && call === 2
                ? `\`${token}\``
                : assembledOptions.trailingChildReport
                  ? `${token}\n`
                  : token,
    },
  ]);
}

function parentResponse(
  call: number,
  profile: EvalProfile,
  context: StreamContext,
  tokens: string[],
  callIds: Record<keyof typeof CALL_IDS, string>,
  assembledOptions: AssembledExecutionOptions,
) {
  if (call === 1 || call === 4) {
    const resume = call === 4;
    return assistantMessage(
      [
        ...(assembledOptions.includeProviderProgress
          ? [
              {
                type: "text" as const,
                text: resume ? "I will resume the prior specialist." : "I will delegate the lookup.",
              },
            ]
          : []),
        {
          type: "tool_call",
          id: resume ? callIds.spawnFollowUp : callIds.spawnInitial,
          name: "spawn_agent",
          input: {
            message: assembledOptions.semanticSpawnInputs
              ? resume
                ? "Continue the restored session. Read references/follow-up.fact once and return that file's exact contents alone; do not read references/initial.fact again."
                : "Retrieve the exact contents of references/initial.fact with one read and return the value alone."
              : resume
                ? "Continue the prior assignment by reading only references/follow-up.fact exactly once. Return only its exact token, without commentary or a trailing newline. Do not reread the initial reference."
                : "Read only references/initial.fact exactly once. Return only its exact token, without commentary or a trailing newline. Do not inspect any other reference.",
            ...(!resume || !assembledOptions.omitResumeAgentType ? { agent_type: "explore" } : {}),
            ...(resume ? { resume_id: spawnedThreadId(context) } : {}),
            ...(!assembledOptions.omitSpawnOptionalDefaults
              ? {
                  description: "Retrieve the private reference",
                  allow_nested_agents: false,
                }
              : {}),
          },
        },
      ],
      "tool_use",
    );
  }
  if (call === 2 || call === 5)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: call === 2 ? callIds.waitInitial : callIds.waitFollowUp,
          name: "wait",
          input: { ids: [spawnedThreadId(context)], timeout_ms: assembledOptions.longWait ? 900_000 : 30_000 },
        },
      ],
      "tool_use",
    );
  if (call === 3)
    return assistantMessage([
      ...(assembledOptions.includeProviderProgress
        ? [{ type: "thinking" as const, thinking: "I should acknowledge without revealing the value." }]
        : []),
      { type: "text", text: "REFERENCE_ACK" },
    ]);
  if (call === 6 && assembledOptions.anthropicWriteRecovery)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: `${callIds.write}-recovery`,
          name: "edit",
          input: {
            file_path: join(cwdFromContext(context, "base"), "collaboration-resume-reference.txt"),
            old_string: "DOES_NOT_EXIST_PLACEHOLDER",
            new_string: `${tokens[0]}\n${tokens[1]}\n`,
          },
        },
      ],
      "tool_use",
    );
  if (call === 6 || (call === 7 && assembledOptions.anthropicWriteRecovery))
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: callIds.write,
          name: profile.provider === "anthropic" ? "edit" : "apply_patch",
          input:
            profile.provider === "anthropic"
              ? {
                  file_path: join(cwdFromContext(context, "base"), "collaboration-resume-reference.txt"),
                  old_string: "",
                  new_string: `${tokens[0]}\n${tokens[1]}\n`,
                  ...(!assembledOptions.omitEditReplaceAll ? { replace_all: false } : {}),
                }
              : {
                  patch: `*** Begin Patch\n*** Add File: collaboration-resume-reference.txt\n+${tokens[0]}\n+${tokens[1]}\n*** End Patch${assembledOptions.trailingPatchNewline ? "\n" : ""}`,
                },
        },
      ],
      "tool_use",
    );
  return assistantMessage([
    ...(assembledOptions.includeProviderProgress
      ? [{ type: "thinking" as const, thinking: "The ordered artifact is complete." }]
      : []),
    { type: "text", text: "REFERENCE_PAIR_RECORDED" },
  ]);
}

function cwdFromContext(context: StreamContext, label: "base" | "runtime_context") {
  const content = context.systemPrompt.find((section) => section.label === label)?.content ?? "";
  const match = content.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error(`Missing ${label} cwd in provider context.`);
  return match[1];
}

function spawnedThreadId(context: StreamContext) {
  const ids = [...JSON.stringify(context.messages).matchAll(/\\"thread_id\\":\\"([^\\"]+)\\"/g)].map(
    (match) => match[1]!,
  );
  const unique = [...new Set(ids)];
  if (unique.length !== 1) throw new Error(`Expected one spawned child id, received ${unique.length}.`);
  return unique[0]!;
}

function childId(execution: RuntimeEvalExecution<CollaborationResumeReferenceWorld>) {
  const trace = execution.toolCalls.find((call) => call.name === "spawn_agent" && call.turnIndex === 0)!;
  return JSON.parse((trace.output as { output: string }).output).thread_id as string;
}

function seeded(seed: string, prefix: string) {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function setTurnFinal(value: Execution, turnIndex: number, text: string) {
  const final = value.turns[turnIndex]!.messages.findLast((message) => message.role === "assistant");
  if (!final || final.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
