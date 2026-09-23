// @summary Tests studio-disabled gating of the bundled tool provider assembly.

import { describe, expect, test } from "bun:test";
import { OVERDARE_EXPERIMENTS } from "../../src/experiments";
import { createStudioBundledToolProviders } from "../../src/tools";

const STUDIO_RPC_ID = "@overdare/studiorpc-tools";

describe("createStudioBundledToolProviders", () => {
  test("includes the studiorpc provider by default", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    expect(providers.some((p) => p.id === STUDIO_RPC_ID)).toBe(true);
  });

  test("omits the studiorpc provider when studioDisabled is set", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project", studioDisabled: true });
    expect(providers.some((p) => p.id === STUDIO_RPC_ID)).toBe(false);
    // the rest of the bundled providers are still present
    expect(providers.length).toBeGreaterThan(0);
  });

  test("includes the agent-report provider", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    expect(providers.some((p) => p.id === "@overdare/agent-report")).toBe(true);
  });
});

test("agent-report experiment hides the tool by default", () => {
  const exp = OVERDARE_EXPERIMENTS.find((e) => e.id === "agent-report");
  expect(exp?.defaultEnabled).toBe(false);
  expect(exp?.toolNames).toEqual(["agent_report_failure"]);
});
