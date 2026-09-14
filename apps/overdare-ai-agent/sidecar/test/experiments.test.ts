// @summary Tests the release-channel gate on OVERDARE experiment defaults.

import { afterEach, describe, expect, test } from "bun:test";
import { resolveExperimentGates, resolveExperimentStates } from "@diligent/runtime";

const realEnv = process.env.DILIGENT_ENV;

/**
 * `OVERDARE_EXPERIMENTS` reads `DILIGENT_ENV` at module evaluation, so each case needs a
 * fresh module instance. A cache-busting query keeps Bun from handing back the first one.
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

  test("exposes session-issue-report on the dev channel", async () => {
    expect(await disabledSkills("dev")).not.toContain("session-issue-report");
  });

  test("is case-insensitive about the channel value", async () => {
    expect(await disabledSkills("DEV")).not.toContain("session-issue-report");
  });

  test("an explicit override wins over a prod channel", async () => {
    expect(await disabledSkills("prod", { "issue-report": true })).not.toContain("session-issue-report");
  });
});
