// @summary Behavioral runtime eval for recovering a hidden fact from a registered truncated tool output

import type { BundledToolProvider } from "@diligent/runtime";
import { z } from "zod";
import type { RuntimeEvalTask } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const FIXTURE_TOOL = "retrieve_archived_record";
const PROVIDER_ID = "eval-large-output-recovery";
const MANIFEST_PATH = "manifest.json";
const KEEP_PATH = ".git/.keep";
const TOOL_OUTPUT_ROOT = "$TOOL_OUTPUT";
const MAX_BOUNDED_READ_LINES = 20;
const RETAINED_BYTES = 1_024;
const FACT_LINE = 501;
const SENTINEL_LINE = 450;
const LINE_COUNT = 600;

export interface LargeOutputRecoveryWorld extends RuntimeFixtureWorld {
  argument: string;
  hiddenFact: string;
  payloadSentinel: string;
  guidance: string;
  clientPrompt: string;
  manifestContent: string;
  manifestHash: string;
  generatedBytes: number;
  generatedHash: string;
  retainedBytes: number;
  factLine: number;
  readOffset: number;
  readLimit: number;
}

export const largeOutputRecoveryTask: RuntimeEvalTask<LargeOutputRecoveryWorld> = {
  id: "large-output-recovery",
  description: "Recover one exact hidden fact through core truncation and a registered bounded full-output read.",
  fixtureVersion: "large-output-recovery-v6",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 4,
    maxToolCalls: 3,
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: [FIXTURE_TOOL, "read"],
    allowedCapabilities: ["execute", "read"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed);
    await writeFixture(root, { [MANIFEST_PATH]: fixture.manifestContent, [KEEP_PATH]: "fixture boundary\n" });
    return {
      root,
      seed,
      expected: fixture.hiddenFact,
      protectedPaths: [MANIFEST_PATH, KEEP_PATH],
      allowedChanges: [],
      ...fixture,
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  createBundledToolProviders(world): readonly BundledToolProvider[] {
    return [
      {
        id: PROVIDER_ID,
        createTools: () => [
          {
            name: FIXTURE_TOOL,
            description:
              `Retrieve the archived record for a request identifier. In large records, the authorization is the ` +
              `RECOVERY_VALUE field on line ${world.factLine}; use a bounded full-output read when the inline result is truncated.`,
            parameters: z.object({ request_id: z.string() }).strict(),
            async execute({ request_id }) {
              if (request_id !== world.argument)
                return { output: "Error: archived request was not found.", metadata: { error: true } };
              return {
                output: generatePayload(world),
                maxOutputBytes: world.retainedBytes,
                truncateDirection: "head" as const,
              };
            },
          },
        ],
      },
    ];
  },
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  snapshotWorld: async (world) => ({
    argument: world.argument,
    generatedBytes: world.generatedBytes,
    generatedHash: world.generatedHash,
    protectedPaths: world.protectedPaths,
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("large_output_recovery");
    const world = input.world;
    const outputReads = input.toolCalls.filter(
      (call) =>
        call.capability === "read" &&
        isRecord(call.input) &&
        [call.input.file_path, call.input.path].some(
          (path) => typeof path === "string" && path.replaceAll("\\", "/").startsWith(`${TOOL_OUTPUT_ROOT}/`),
        ),
    );
    const recoveryReads = outputReads.filter(
      (call) => call.outcome === "success" && JSON.stringify(call.output ?? "").includes(world.hiddenFact),
    );
    const recovery = recoveryReads[0];
    if (!recovery)
      return grade.fail(
        "tools",
        "No successful read of the spilled full output recovered the hidden fact.",
        "behavior",
      );
    const answer = finalAssistantText(input);
    if (!answer.includes(world.hiddenFact))
      return grade.fail(
        "final",
        "The final response did not report the recovered authorization value.",
        "semantic_goal",
      );
    if (!isAuthorizationAnswer(answer, world.hiddenFact))
      return grade.fail(
        "final_format",
        "The final response was not the value alone or one declared label followed by the value.",
        "format_contract",
      );
    const retrievals = input.toolCalls.filter((call) => call.name === FIXTURE_TOOL);
    if (retrievals.filter((call) => call.outcome === "success").length > 1)
      grade.note("duplicate_retrieval", "The same archived record was retrieved more than once.");
    if (retrievals.some((call) => call.outcome !== "success"))
      grade.note("failed_retrieval", "An archived-record retrieval failed before recovery.");
    if (outputReads.length > recoveryReads.length)
      grade.note("read_recovery", "A full-output read missed the fact or failed.");
    if (recoveryReads.length > 1) grade.note("repeated_recovery_read", "The fact was recovered by more than one read.");
    const limit = isRecord(recovery.input) ? recovery.input.limit : undefined;
    if (typeof limit !== "number" || limit > MAX_BOUNDED_READ_LINES)
      grade.note("unbounded_read", `The recovering read was not bounded to ${MAX_BOUNDED_READ_LINES} lines.`);
    return grade.pass();
  },
};

function fixtureFor(seed: string) {
  const argument = seededToken(seed, "ARCHIVE_REQUEST");
  const hiddenFact = seededToken(seed, "RECOVERY_FACT");
  const payloadSentinel = seededToken(seed, "UNRETAINED_SENTINEL");
  const guidance =
    `RECOVERY INDEX: authorization_field=RECOVERY_VALUE; line=${FACT_LINE}; ` +
    `recommended_window=offset:${FACT_LINE},limit:1; record_size=${LINE_COUNT}_lines.`;
  const clientPrompt =
    `Resolve archival request ${argument} and return its authorization value. ` +
    "Keep the response concise: use either the value alone or one `The authorization value is:` label followed by the value.";
  const manifestContent = `${JSON.stringify({ request: argument, classification: "archived-authorization" }, null, 2)}\n`;
  const basis = {
    argument,
    hiddenFact,
    payloadSentinel,
    guidance,
    clientPrompt,
    manifestContent,
    manifestHash: sha256Text(manifestContent),
    retainedBytes: RETAINED_BYTES,
    factLine: FACT_LINE,
    readOffset: FACT_LINE,
    readLimit: 1,
  };
  const payload = generatePayload(basis);
  return { ...basis, generatedBytes: Buffer.byteLength(payload), generatedHash: sha256Text(payload) };
}

function generatePayload(world: Pick<LargeOutputRecoveryWorld, "guidance" | "hiddenFact" | "payloadSentinel">): string {
  return Array.from({ length: LINE_COUNT }, (_, index) => {
    const line = index + 1;
    if (line === 1) return world.guidance;
    if (line === SENTINEL_LINE) return world.payloadSentinel;
    if (line === FACT_LINE) return `RECOVERY_VALUE=${world.hiddenFact}`;
    return `ARCHIVE_ROW_${String(line).padStart(3, "0")}_${"x".repeat(36)}`;
  }).join("\n");
}

/** Accepts the value alone or after the declared label, optionally wrapped in backticks or a code fence. */
function isAuthorizationAnswer(answer: string, hiddenFact: string): boolean {
  const body = unwrapReply(answer);
  const label = "The authorization value is:";
  return (body.startsWith(label) ? unwrapReply(body.slice(label.length)) : body) === hiddenFact;
}
