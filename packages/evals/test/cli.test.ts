// @summary Tests eval CLI main seed, ChatGPT auth, and suite dispatch with stubbed suite runners

import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderManager } from "@diligent/core/provider-contract";
import * as realChatgpt from "../src/providers/chatgpt-oauth";
import * as realRuntimeSuite from "../src/runner/runtime-suite";
import { createGithubRootSeed } from "../src/runner/seed";
import * as realSuite from "../src/runner/suite";
import type { EvalProfile } from "../src/task";

interface SuiteCall {
  suite: "core" | "runtime";
  rootSeed: string;
  profiles: EvalProfile[];
  configureProviderManager?: (profile: EvalProfile, manager: ProviderManager) => void;
}

const calls: SuiteCall[] = [];
const authCalls: string[] = [];
const boundManagers: unknown[] = [];
let stubbed = false;
let reportPassed = true;

const originalRunEvalSuite = realSuite.runEvalSuite;
const originalRunRuntimeEvalSuite = realRuntimeSuite.runRuntimeEvalSuite;
const originalCreateAuth = realChatgpt.createLocalChatGPTEvalAuth;

mock.module("../src/runner/suite", () => ({
  ...realSuite,
  runEvalSuite: (input: Parameters<typeof originalRunEvalSuite>[0]) => {
    if (!stubbed) return originalRunEvalSuite(input);
    calls.push({ suite: "core", rootSeed: input.rootSeed, profiles: input.profiles });
    return Promise.resolve({ suite: "core", passed: reportPassed });
  },
}));
mock.module("../src/runner/runtime-suite", () => ({
  ...realRuntimeSuite,
  runRuntimeEvalSuite: (input: Parameters<typeof originalRunRuntimeEvalSuite>[0]) => {
    if (!stubbed) return originalRunRuntimeEvalSuite(input);
    calls.push({
      suite: "runtime",
      rootSeed: input.rootSeed,
      profiles: input.profiles,
      configureProviderManager: input.configureProviderManager,
    });
    return Promise.resolve({ suite: "runtime", passed: reportPassed, note: "token chatgpt-access-secret leaked" });
  },
}));
mock.module("../src/providers/chatgpt-oauth", () => ({
  ...realChatgpt,
  createLocalChatGPTEvalAuth: (...args: Parameters<typeof originalCreateAuth>) => {
    if (!stubbed) return originalCreateAuth(...args);
    authCalls.push(args[0]);
    args[1]?.onCredentials?.({ access_token: "chatgpt-access-secret" } as never);
    return Promise.resolve({
      bindProviderManager: (manager: unknown) => {
        boundManagers.push(manager);
      },
    });
  },
}));

// Loaded after mock.module so the CLI binds to the stubbed suite runners and OAuth factory.
const { main } = await import("../src/cli");

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_RUN_ID",
  "GITHUB_REPOSITORY",
  "GITHUB_SHA",
  "GITHUB_STEP_SUMMARY",
] as const;
const savedEnv = new Map<string, string | undefined>();
let reportDir = "";

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  reportDir = await mkdtemp(join(tmpdir(), "diligent-eval-cli-"));
});

afterAll(async () => {
  stubbed = false;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(reportDir, { recursive: true, force: true });
});

afterEach(() => {
  stubbed = false;
  calls.length = 0;
  authCalls.length = 0;
  boundManagers.length = 0;
  reportPassed = true;
});

function prepare(env: { runId?: string } = {}): void {
  stubbed = true;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  delete process.env.GEMINI_API_KEY;
  delete process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_REPOSITORY = "acme/diligent";
  process.env.GITHUB_SHA = "abc123";
  if (env.runId === undefined) delete process.env.GITHUB_RUN_ID;
  else process.env.GITHUB_RUN_ID = env.runId;
}

async function runMain(args: string[]): Promise<number> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    return await main(args);
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("main", () => {
  test("uses an explicit seed over GitHub run metadata", async () => {
    prepare({ runId: "42" });
    const reportPath = join(reportDir, "explicit.json");
    const code = await runMain(["core", "--provider", "anthropic", "--seed", "recorded-seed", "--report", reportPath]);
    expect(code).toBe(0);
    expect(calls.map((call) => [call.suite, call.rootSeed])).toEqual([["core", "recorded-seed"]]);
    expect(authCalls).toEqual([]);
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ suite: "core", passed: true });
  });

  test("derives the root seed from GitHub run metadata when no seed is given", async () => {
    prepare({ runId: "42" });
    const code = await runMain(["core", "--provider", "anthropic", "--report", join(reportDir, "github.json")]);
    expect(code).toBe(0);
    expect(calls[0]?.rootSeed).toBe(createGithubRootSeed("acme/diligent", "42", "abc123"));
  });

  test("creates a fresh random root seed for local runs without a seed", async () => {
    prepare();
    await runMain(["core", "--provider", "anthropic", "--report", join(reportDir, "local-1.json")]);
    await runMain(["core", "--provider", "anthropic", "--report", join(reportDir, "local-2.json")]);
    const seeds = calls.map((call) => call.rootSeed);
    expect(seeds).toHaveLength(2);
    expect(seeds[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seeds[0]).not.toBe(seeds[1]);
    expect(seeds).not.toContain(createGithubRootSeed("acme/diligent", "local", "abc123"));
  });

  test("returns 1 when the selected suite report fails", async () => {
    prepare();
    reportPassed = false;
    const code = await runMain([
      "core",
      "--provider",
      "anthropic",
      "--seed",
      "s",
      "--report",
      join(reportDir, "f.json"),
    ]);
    expect(code).toBe(1);
  });

  test("dispatches the runtime suite and binds ChatGPT auth only for chatgpt profiles", async () => {
    prepare();
    const reportPath = join(reportDir, "chatgpt.json");
    const code = await runMain(["runtime", "--provider", "chatgpt", "--seed", "s", "--report", reportPath]);
    expect(code).toBe(0);
    expect(authCalls).toEqual([process.cwd()]);
    expect(calls.map((call) => call.suite)).toEqual(["runtime"]);
    const manager = {} as ProviderManager;
    calls[0]!.configureProviderManager!(calls[0]!.profiles[0]!, manager);
    expect(boundManagers).toEqual([manager]);
    const reportText = await readFile(reportPath, "utf8");
    expect(JSON.parse(reportText)).toMatchObject({ suite: "runtime", passed: true });
    expect(reportText).not.toContain("chatgpt-access-secret");
  });

  test("leaves ChatGPT auth uninitialized for non-chatgpt runtime profiles", async () => {
    prepare();
    const code = await runMain([
      "runtime",
      "--provider",
      "anthropic",
      "--seed",
      "s",
      "--report",
      join(reportDir, "r.json"),
    ]);
    expect(code).toBe(0);
    expect(authCalls).toEqual([]);
    expect(() =>
      calls[0]!.configureProviderManager!(
        { provider: "chatgpt", model: "gpt-5", effort: "medium" },
        {} as ProviderManager,
      ),
    ).toThrow("ChatGPT eval profiles require initialized local OAuth.");
  });
});
