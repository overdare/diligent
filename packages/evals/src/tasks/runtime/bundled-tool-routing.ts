// @summary Behavioral runtime eval for natural-intent routing across fixture-owned bundled tools

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

const INTENDED_TOOL = "coordinate_field_journey";
const DECOY_TOOL = "schedule_archive_collection";
const INTENDED_PROVIDER = "eval-field-journey-provider";
const DECOY_PROVIDER = "eval-archive-collection-provider";
const MANIFEST_PATH = "manifest.json";
const KEEP_PATH = ".git/.keep";

const INTENDED_DESCRIPTION =
  "Coordinate a field-research journey when the assignment, destination, travel window, participants, and onboard needs are known.";
const DECOY_DESCRIPTION =
  "Schedule secure collection of boxed archive materials when a repository, loading slot, and parcel inventory are known.";

interface JourneyRequest {
  assignment_ref: string;
  route: {
    destination: { city: string; country_code: string };
    travel_window: { outbound: string; inbound: string };
    participants: Array<{ identity: string; duty: "lead" | "observer" }>;
  };
  service: { cabin: "quiet" | "standard"; accessibility_support: boolean };
}

interface ProviderAssemblyRecord {
  providerId: string;
  cwd: string;
}

interface ExecutionRecord {
  providerId: string;
  toolName: string;
  input: unknown;
}

export interface BundledToolRoutingWorld extends RuntimeFixtureWorld {
  assignmentRef: string;
  destinationCity: string;
  destinationCountry: string;
  outboundDate: string;
  inboundDate: string;
  leadIdentity: string;
  observerIdentity: string;
  request: JourneyRequest;
  receipt: string;
  decoyReceipt: string;
  clientPrompt: string;
  manifestContent: string;
  manifestHash: string;
  providerAssembly: ProviderAssemblyRecord[];
  executions: ExecutionRecord[];
}

export const bundledToolRoutingTask: RuntimeEvalTask<BundledToolRoutingWorld> = {
  id: "bundled-tool-routing",
  description: "Route a natural request to one of two normally assembled bundled tools with exact nested input.",
  fixtureVersion: "bundled-tool-routing-v3",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 2,
    maxToolCalls: 1,
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: [INTENDED_TOOL, DECOY_TOOL],
    allowedCapabilities: ["execute"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed);
    await writeFixture(root, { [MANIFEST_PATH]: fixture.manifestContent, [KEEP_PATH]: "fixture boundary\n" });
    return {
      root,
      seed,
      expected: fixture.receipt,
      protectedPaths: [MANIFEST_PATH, KEEP_PATH],
      allowedChanges: [],
      ...fixture,
      providerAssembly: [],
      executions: [],
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  createBundledToolProviders(world): readonly BundledToolProvider[] {
    return [intendedProvider(world), decoyProvider(world)];
  },
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  snapshotWorld: async (world) => ({
    assignmentRef: world.assignmentRef,
    request: world.request,
    receipt: world.receipt,
    protectedPaths: world.protectedPaths,
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("bundled_tool_routing");
    const world = input.world;
    if (
      input.toolCalls.some((call) => call.name === DECOY_TOOL && call.outcome === "success") ||
      world.executions.some((execution) => execution.toolName === DECOY_TOOL)
    )
      return grade.fail("decoy", "The unrelated archive-collection tool was executed.", "runtime_policy");
    const intended = input.toolCalls.filter((call) => call.name === INTENDED_TOOL);
    const accepted = intended.filter(
      (call) => call.outcome === "success" && JSON.stringify(call.output ?? "").includes(world.receipt),
    );
    if (accepted.length === 0)
      return grade.fail(
        "trace",
        "The intended bundled tool never accepted the requested journey and produced its receipt.",
        "behavior",
      );
    const answer = finalAssistantText(input);
    if (!answer.includes(world.receipt))
      return grade.fail("final", "The final response did not report the intended tool receipt.", "semantic_goal");
    const unwrapped = unwrapReply(answer);
    if (unwrapped !== world.receipt && unwrapped !== `Confirmed: ${world.receipt}`)
      return grade.fail(
        "final_format",
        "The final response was not the tool output verbatim as the prompt required.",
        "format_contract",
      );
    if (input.toolCalls.some((call) => call.name === DECOY_TOOL))
      grade.note("decoy_attempt", "The decoy tool was attempted but did not execute.");
    if (intended.length > accepted.length)
      grade.note("rejected_input_recovered", "The intended tool was called with wrong or failing input first.");
    if (accepted.length > 1) grade.note("repeated_routing", "The intended tool was executed more than once.");
    return grade.pass();
  },
};

function intendedProvider(world: BundledToolRoutingWorld): BundledToolProvider {
  return {
    id: INTENDED_PROVIDER,
    createTools({ cwd }) {
      world.providerAssembly.push({ providerId: INTENDED_PROVIDER, cwd });
      return [
        {
          name: INTENDED_TOOL,
          description: INTENDED_DESCRIPTION,
          parameters: journeySchema(),
          async execute(input) {
            world.executions.push({ providerId: INTENDED_PROVIDER, toolName: INTENDED_TOOL, input });
            return { output: canonicalJson(input) === canonicalJson(world.request) ? world.receipt : "REJECTED_INPUT" };
          },
        },
      ];
    },
  };
}

function decoyProvider(world: BundledToolRoutingWorld): BundledToolProvider {
  return {
    id: DECOY_PROVIDER,
    createTools({ cwd }) {
      world.providerAssembly.push({ providerId: DECOY_PROVIDER, cwd });
      return [
        {
          name: DECOY_TOOL,
          description: DECOY_DESCRIPTION,
          parameters: z
            .object({
              repository_code: z.string(),
              loading_slot: z.object({ date: z.string(), hour_utc: z.number().int() }).strict(),
              parcels: z.array(z.object({ label: z.string(), crate_count: z.number().int().positive() }).strict()),
            })
            .strict(),
          async execute(input) {
            world.executions.push({ providerId: DECOY_PROVIDER, toolName: DECOY_TOOL, input });
            return { output: world.decoyReceipt };
          },
        },
      ];
    },
  };
}

function journeySchema() {
  return z
    .object({
      assignment_ref: z.string(),
      route: z
        .object({
          destination: z.object({ city: z.string(), country_code: z.string().length(2) }).strict(),
          travel_window: z.object({ outbound: z.string(), inbound: z.string() }).strict(),
          participants: z
            .array(z.object({ identity: z.string(), duty: z.enum(["lead", "observer"]) }).strict())
            .length(2),
        })
        .strict(),
      service: z.object({ cabin: z.enum(["quiet", "standard"]), accessibility_support: z.boolean() }).strict(),
    })
    .strict();
}

function fixtureFor(seed: string) {
  const assignmentRef = seededToken(seed, "ASSIGNMENT");
  const destinationCity = seededToken(seed, "CITY");
  const destinationCountry = "KR";
  const outboundDate = "2026-09-17";
  const inboundDate = "2026-09-21";
  const leadIdentity = seededToken(seed, "LEAD");
  const observerIdentity = seededToken(seed, "OBSERVER");
  const request: JourneyRequest = {
    assignment_ref: assignmentRef,
    route: {
      destination: { city: destinationCity, country_code: destinationCountry },
      travel_window: { outbound: outboundDate, inbound: inboundDate },
      participants: [
        { identity: leadIdentity, duty: "lead" },
        { identity: observerIdentity, duty: "observer" },
      ],
    },
    service: { cabin: "quiet", accessibility_support: false },
  };
  const receipt = seededToken(seed, "JOURNEY_RECEIPT");
  const decoyReceipt = seededToken(seed, "COLLECTION_RECEIPT");
  const clientPrompt =
    `Please arrange the field trip tied to ${assignmentRef}. ${leadIdentity} will lead and ${observerIdentity} will ` +
    `observe in ${destinationCity}, ${destinationCountry}, traveling ${outboundDate} through ${inboundDate}. ` +
    "They prefer a quiet cabin and do not need accessibility support. After the tool succeeds, reply with its output verbatim and no other text.";
  const manifestContent = `${JSON.stringify({ fixture: "field-journey", assignment: assignmentRef }, null, 2)}\n`;
  return {
    assignmentRef,
    destinationCity,
    destinationCountry,
    outboundDate,
    inboundDate,
    leadIdentity,
    observerIdentity,
    request,
    receipt,
    decoyReceipt,
    clientPrompt,
    manifestContent,
    manifestHash: sha256Text(manifestContent),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}
