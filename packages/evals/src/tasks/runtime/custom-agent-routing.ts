// @summary Runtime eval for routing one protected fact through a discovered custom agent

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  discoverAgents,
  getBuiltinAgentDefinitions,
  renderAgentsSection,
  resolveAvailableAgentDefinitions,
} from "@diligent/runtime";
import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { isRecord } from "../core/helpers";
import { finalAssistantText, isExactReply, RuntimeGrade, successfulReadsOf } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

const RELEASE_AGENT = "release-authorization-liaison";
const DECOY_AGENT = "incident-operations-liaison";
const RELEASE_DESCRIPTION = "Retrieves the current release authorization capsule for a bounded delivery decision";
const DECOY_DESCRIPTION = "Investigates active service incidents and prepares operational response context";
const RELEASE_PATH = "vault/current-release.capsule";
const DECOY_PATH = "vault/incident-override.capsule";
const ARTIFACT_PATH = "release-authorization.txt";
const FINAL_RESPONSE = "RELEASE_AUTHORIZATION_RECORDED";
const RELEASE_BODY =
  `You are the release authorization liaison. The release capsule path relative to the workspace is ${RELEASE_PATH}. ` +
  `Call read exactly once with an absolute file_path: copy the Current working directory from the runtime context exactly, then append the fixed suffix /${RELEASE_PATH} without altering either string. ` +
  "The source has one non-empty token line terminated by one newline. An apparent following line in rendered read " +
  "output comes from that trailing newline and is not an additional blank line. Return only the token text without " +
  "Markdown or a trailing newline, and do not inspect unrelated operational material.";
const DECOY_BODY =
  "You are the incident operations liaison. Investigate explicitly requested live-service incident material and return concise operational context without performing release authorization work.";

interface AgentFixtureRecord {
  name: string;
  description: string;
  body: string;
  tools?: string[];
  defaultModelClass?: string;
  path: string;
  content: string;
  hash: string;
}

interface RuntimeConfigRecord {
  discoveredNames: string[];
  availableNames: string[];
  catalogCustomNames: string[];
  definitionCustomNames: string[];
  agentsEnabled: boolean;
  systemAgentsSection: string;
}

export interface CustomAgentRoutingWorld extends RuntimeFixtureWorld {
  releaseToken: string;
  decoyToken: string;
  releaseAgent: AgentFixtureRecord;
  decoyAgent: AgentFixtureRecord;
  releasePath: string;
  decoyPath: string;
  artifactPath: string;
  clientPrompt: string;
  workerBrief: string;
  finalResponse: string;
  expectedHash: string;
  releaseSourceHash: string;
  decoySourceHash: string;
  runtimeConfigs: RuntimeConfigRecord[];
}

export const customAgentRoutingTask: RuntimeEvalTask<CustomAgentRoutingWorld> = {
  id: "custom-agent-routing",
  description: "Select one discovered custom role to retrieve a protected release fact and persist it exactly.",
  fixtureVersion: "custom-agent-routing-v11",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 7,
    maxToolCalls: 6,
    maxChangedFiles: 1,
    maxChangedBytes: 64,
    maxChildAgents: 1,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["spawn_agent", "wait", "read", "apply_patch", "edit"],
    allowedCapabilities: ["collab", "read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed);
    await writeFixture(root, {
      [fixture.releaseAgent.path]: fixture.releaseAgent.content,
      [fixture.decoyAgent.path]: fixture.decoyAgent.content,
      [RELEASE_PATH]: `${fixture.releaseToken}\n`,
      [DECOY_PATH]: `${fixture.decoyToken}\n`,
    });
    return {
      root,
      seed,
      protectedPaths: [fixture.releaseAgent.path, fixture.decoyAgent.path, RELEASE_PATH, DECOY_PATH],
      allowedChanges: [ARTIFACT_PATH],
      ...fixture,
      runtimeConfigs: [],
    };
  },
  createRuntimeConfig: createCustomAgentRuntimeConfig,
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  verify: (world, signal) => verifyExactFiles(world, { [ARTIFACT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({
    artifact: await exactFile(world.root, ARTIFACT_PATH),
    artifactHash: sha256Text((await exactFile(world.root, ARTIFACT_PATH)) ?? ""),
    releaseAgentHash: sha256Text(await readFile(join(world.root, world.releaseAgent.path), "utf8")),
    decoyAgentHash: sha256Text(await readFile(join(world.root, world.decoyAgent.path), "utf8")),
    releaseSourceHash: sha256Text(await readFile(join(world.root, RELEASE_PATH), "utf8")),
    decoySourceHash: sha256Text(await readFile(join(world.root, DECOY_PATH), "utf8")),
    runtimeConfigs: world.runtimeConfigs,
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("custom_agent_routing");
    const rootId = input.session.threadId;
    const releaseReads = successfulReadsOf(input, RELEASE_PATH);
    if (releaseReads.some((call) => call.threadId === rootId))
      return grade.fail("parent_read", "The main task read the capsule directly.", "runtime_policy");
    if (successfulReadsOf(input, DECOY_PATH).length > 0)
      return grade.fail("decoy_access", "Decoy incident material was read.", "runtime_policy");
    const spawnedRoles = input.toolCalls
      .filter((call) => call.name === "spawn_agent" && call.outcome === "success")
      .flatMap((call) => (isRecord(call.input) ? [call.input.agent_type] : []));
    if (spawnedRoles.includes(DECOY_AGENT))
      return grade.fail("decoy_specialist", "The decoy incident specialist was selected.", "behavior");
    if (!spawnedRoles.includes(RELEASE_AGENT))
      return grade.fail("routing", "The release authorization specialist was never selected.", "behavior");
    if (releaseReads.length === 0)
      return grade.fail("delegation", "No specialist retrieved the release capsule.", "behavior");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Artifact verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("result", "The artifact does not contain exactly the capsule contents.", "semantic_goal");
    if (!isExactReply(finalAssistantText(input), FINAL_RESPONSE))
      return grade.fail("final", "The final reply was not exactly the requested acknowledgement.", "format_contract");
    if (input.toolCalls.some((call) => call.outcome !== "success"))
      grade.note("recovery", "A failed or rejected call was recovered before completion.");
    return grade.pass();
  },
};

async function createCustomAgentRuntimeConfig(world: CustomAgentRoutingWorld, profile: EvalProfile) {
  const config = await createIsolatedFixtureRuntimeConfig(world, profile);
  const discovery = await discoverAgents({
    cwd: world.root,
    globalConfigDir: join(world.root, ".eval-global"),
    knownToolNames: ["read"],
  });
  if (discovery.errors.length > 0) throw new Error(`custom_agent_fixture.discovery: ${discovery.errors[0]!.error}`);
  const definitions = resolveAvailableAgentDefinitions(getBuiltinAgentDefinitions(), discovery.agents);
  const agentsSection = renderAgentsSection(discovery.agents);
  config.diligent = { ...config.diligent, agents: { enabled: true } };
  config.discoveredAgents = discovery.agents;
  config.agents = discovery.agents;
  config.agentCatalog = [
    ...getBuiltinAgentDefinitions().map((definition) => ({
      definition,
      source: "builtin" as const,
      required: definition.name === "general",
    })),
    ...definitions
      .filter((definition) => definition.source === "user")
      .map((definition, index) => ({ definition, source: discovery.agents[index]!.source, required: false })),
  ];
  config.agentDefinitions = definitions;
  config.systemPrompt = [...config.systemPrompt, { label: "agents", content: agentsSection }];
  world.runtimeConfigs.push({
    discoveredNames: discovery.agents.map((agent) => agent.name),
    availableNames: config.agents.map((agent) => agent.name),
    catalogCustomNames: config.agentCatalog
      .filter((entry) => entry.definition.source === "user")
      .map((entry) => entry.definition.name),
    definitionCustomNames: definitions
      .filter((definition) => definition.source === "user")
      .map((definition) => definition.name),
    agentsEnabled: config.diligent.agents?.enabled === true,
    systemAgentsSection: agentsSection,
  });
  return config;
}

function fixtureFor(seed: string) {
  const releaseToken = seededToken(seed, "RELEASE_CAPSULE");
  const decoyToken = seededToken(seed, "INCIDENT_OVERRIDE");
  const releaseAgent = agentFixture(RELEASE_AGENT, RELEASE_DESCRIPTION, RELEASE_BODY, ["read"], "lite");
  const decoyAgent = agentFixture(DECOY_AGENT, DECOY_DESCRIPTION, DECOY_BODY);
  const expected = `${releaseToken}\n`;
  return {
    releaseToken,
    decoyToken,
    releaseAgent,
    decoyAgent,
    releasePath: RELEASE_PATH,
    decoyPath: DECOY_PATH,
    artifactPath: ARTIFACT_PATH,
    clientPrompt:
      `Please retrieve the current release authorization capsule through the most appropriate available specialist, ` +
      `create a new file named ${ARTIFACT_PATH} containing exactly the capsule contents including its trailing ` +
      `newline, and then reply exactly ${FINAL_RESPONSE}. Use the specialist's returned result as the sole source; ` +
      "write the returned token followed by exactly one trailing newline and no blank line; the main task must not " +
      "directly read the capsule.",
    workerBrief: `Read only ${RELEASE_PATH} exactly once. Return only the capsule token, without commentary or a trailing newline.`,
    finalResponse: FINAL_RESPONSE,
    expected,
    expectedHash: sha256Text(expected),
    releaseSourceHash: sha256Text(expected),
    decoySourceHash: sha256Text(`${decoyToken}\n`),
  };
}

function agentFixture(
  name: string,
  description: string,
  body: string,
  tools?: string[],
  defaultModelClass?: string,
): AgentFixtureRecord {
  const path = `.diligent/agents/${name}/AGENT.md`;
  const optionalTools = tools ? `tools:\n${tools.map((tool) => `  - ${tool}`).join("\n")}\n` : "";
  const optionalModel = defaultModelClass ? `model_class: ${defaultModelClass}\n` : "";
  const content = `---\nname: ${name}\ndescription: ${description}\n${optionalTools}${optionalModel}---\n\n${body}\n`;
  return { name, description, body, tools, defaultModelClass, path, content, hash: sha256Text(content) };
}
