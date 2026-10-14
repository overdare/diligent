// @summary Tests opt-in issue reporting across OVERDARE release channels.

import { afterEach, describe, expect, test } from "bun:test";
import { resolveExperimentGates, resolveExperimentStates } from "@diligent/runtime";

const realEnv = process.env.DILIGENT_ENV;

/**
 * Load fresh definitions after setting the channel to cover regressions to channel-specific
 * defaults. A cache-busting query keeps Bun from handing back the first module instance.
 */
async function disabledSkills(env: string | undefined, overrides?: Record<string, boolean>) {
  if (env === undefined) delete process.env.DILIGENT_ENV;
  else process.env.DILIGENT_ENV = env;
  const module = await import(`../src/experiments?channel=${env ?? "unset"}`);
  const states = resolveExperimentStates(module.OVERDARE_EXPERIMENTS, overrides);
  return resolveExperimentGates(states).disabledSkillNames;
}

afterEach(() => {
  if (realEnv === undefined) delete process.env.DILIGENT_ENV;
  else process.env.DILIGENT_ENV = realEnv;
});

describe("issue-report experiment", () => {
  // The skill ships inside the agent bundle, so this gate is what keeps it away from
  // creators. If it ever inverts, a prod build starts offering internal diagnostics.
  const prodChannels: Array<[string, string | undefined]> = [
    ["unset (legacy launcher)", undefined],
    ["prod", "prod"],
  ];
  test.each(prodChannels)("hides session-issue-report on a %s channel", async (_label, env) => {
    expect(await disabledSkills(env)).toContain("session-issue-report");
  });

  test("keeps session-issue-report off by default on the dev channel", async () => {
    expect(await disabledSkills("dev")).toContain("session-issue-report");
  });

  test("keeps session-issue-report off with an uppercase dev channel", async () => {
    expect(await disabledSkills("DEV")).toContain("session-issue-report");
  });

  test("an explicit override wins over a prod channel", async () => {
    expect(await disabledSkills("prod", { "issue-report": true })).not.toContain("session-issue-report");
  });
});

async function disabledTools(env: string | undefined, overrides?: Record<string, boolean>) {
  await disabledSkills(env, overrides);
  const module = await import(`../src/experiments?channel=${env ?? "unset"}`);
  return resolveExperimentGates(resolveExperimentStates(module.OVERDARE_EXPERIMENTS, overrides)).disabledToolNames;
}

test.each([undefined, "prod"])("issue-report hides its transmission tool in %s", async (env) => {
  expect(await disabledTools(env)).toContain("agent_report");
});
test("issue-report tool stays off in dev and an explicit override enables it", async () => {
  expect(await disabledTools("dev")).toContain("agent_report");
  expect(await disabledTools("prod", { "issue-report": true })).not.toContain("agent_report");
});
