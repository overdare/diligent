// @summary CLI entrypoint for core, runtime, and capability-matrix eval runs and unattended ChatGPT login

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { listModels } from "@diligent/core/model-registry";
import { ProviderError, ProviderErrorType } from "@diligent/core/provider-contract";
import {
  type CapabilityCell,
  createCapabilityCostPolicy,
  MODEL_CAPABILITIES,
  type ModelCapability,
  renderCapabilityMatrixMarkdown,
} from "./capabilities";
import { type EvalCliOptions, parseCliOptions } from "./cli-options";
import {
  configureProfileProviderManager,
  createProfileStream,
  missingApiKey,
  resolveCapabilityProfiles,
  resolveProfileModel,
  resolveSelectedProfiles,
  validateCredentials,
} from "./profiles";
import {
  type ChatGPTEvalAuth,
  type ChatGPTEvalAuthOptions,
  createLocalChatGPTEvalAuth,
  getChatGPTRedactionSecrets,
  loginChatGPTEvalAuth,
} from "./providers/chatgpt-oauth";
import { redactEvalText, writeEvalReport } from "./reporters/json";
import { type CapabilityUnavailable, runCapabilitySuite } from "./runner/capability-suite";
import { runRuntimeEvalSuite } from "./runner/runtime-suite";
import { createGithubRootSeed, createRandomRootSeed } from "./runner/seed";
import { type EvalRunMetadata, runEvalSuite } from "./runner/suite";
import type { RuntimeEvalExecutionResult } from "./runtime-task";
import type { AnyEvalTask, EvalExecutionResult, EvalProfile } from "./task";
import { CORE_EVAL_TASKS } from "./tasks/core";
import { RUNTIME_EVAL_TASKS } from "./tasks/runtime";

const SUITE_VERSION = "core-v0";

export async function main(args = process.argv.slice(2)): Promise<number> {
  const secrets = [
    process.env.OPENAI_API_KEY ?? "",
    process.env.ANTHROPIC_API_KEY ?? "",
    process.env.GEMINI_API_KEY ?? "",
  ].filter(Boolean);
  try {
    const options = parseCliOptions(args);
    if (options.help) {
      printHelp();
      return 0;
    }
    if (options.command === "chatgpt-login") {
      await loginChatGPTEvalAuth(process.cwd(), {
        authFile: options.chatgptAuthFile,
        onUrl: (url) => console.log(`[eval] chatgpt oauth sign-in URL (callback on localhost:1455): ${url}`),
      });
      console.log("[eval] chatgpt oauth credentials_saved");
      return 0;
    }

    const metadata = resolveRunMetadata();
    const rootSeed =
      options.seed ??
      (metadata.runId !== "local"
        ? createGithubRootSeed(metadata.repository, metadata.runId, metadata.commitSha)
        : createRandomRootSeed());
    const chatgptAuthOptions: ChatGPTEvalAuthOptions = {
      interactive: !options.nonInteractive,
      authFile: options.chatgptAuthFile,
      onStatus: (status) => console.log(`[eval] chatgpt oauth ${status}`),
      onCredentials: (tokens) => {
        secrets.push(...getChatGPTRedactionSecrets(tokens));
      },
    };
    if (options.command === "capabilities") {
      return await runCapabilities(options, metadata, rootSeed, chatgptAuthOptions, secrets);
    }

    const suite = options.command;
    const profiles = resolveSelectedProfiles(options);
    const tasks = suite === "core" ? selectCoreTasks(options.task) : selectRuntimeTasks(options.task);
    validateCredentials(profiles);
    const chatgptAuth = profiles.some((profile) => profile.provider === "chatgpt")
      ? await createLocalChatGPTEvalAuth(process.cwd(), chatgptAuthOptions)
      : undefined;

    console.log(`[eval] ${suite} suite: ${tasks.length} task(s) x ${profiles.length} profile(s)`);
    const shared = {
      profiles,
      rootSeed,
      metadata,
      createStream: (profile: EvalProfile) => createProfileStream(profile, process.env, chatgptAuth),
      onExecutionStart: (task: { id: string }, profile: EvalProfile) => {
        console.log(`[eval] start ${task.id} / ${profile.provider} / ${profile.model}`);
      },
    };
    const report =
      suite === "core"
        ? await runEvalSuite({
            ...shared,
            tasks: tasks as AnyEvalTask[],
            resolveModel: resolveProfileModel,
            onExecutionEnd: (result) => printExecutionResult(result, secrets),
          })
        : await runRuntimeEvalSuite({
            ...shared,
            tasks: tasks as typeof RUNTIME_EVAL_TASKS,
            configureProviderManager: (profile, manager) =>
              configureProfileProviderManager(profile, manager, chatgptAuth),
            onExecutionEnd: (result) => printRuntimeExecutionResult(result, secrets),
          });

    const reportPath = options.reportPath ?? defaultReportPath(suite);
    await writeEvalReport(reportPath, report, { secrets });
    console.log(`[eval] report ${reportPath}`);
    await writeGithubSummary(report, reportPath);
    return report.passed ? 0 : 1;
  } catch (error) {
    const message = redactEvalText(error instanceof Error ? error.message : String(error), secrets);
    console.error(`[eval] configuration or runner error: ${message}`);
    return 2;
  }
}

async function runCapabilities(
  options: EvalCliOptions,
  metadata: EvalRunMetadata,
  rootSeed: string,
  chatgptAuthOptions: ChatGPTEvalAuthOptions,
  secrets: string[],
): Promise<number> {
  const profiles = resolveCapabilityProfiles(options);
  const capabilities: ModelCapability[] = options.capability ? [options.capability] : [...MODEL_CAPABILITIES];
  let chatgptAuth: ChatGPTEvalAuth | undefined;
  let chatgptUnavailable: CapabilityUnavailable | undefined;
  if (profiles.some((profile) => profile.provider === "chatgpt")) {
    try {
      chatgptAuth = await createLocalChatGPTEvalAuth(process.cwd(), chatgptAuthOptions);
    } catch (error) {
      // Record every ChatGPT cell as not run, with the reason, instead of aborting the API-key matrix.
      chatgptUnavailable = {
        code:
          error instanceof ProviderError && error.errorType === ProviderErrorType.Auth
            ? `provider_auth.${error.reason ?? "rejected"}`
            : "chatgpt_auth.setup_failed",
        reason: redactEvalText(error instanceof Error ? error.message : String(error), secrets),
      };
      console.error(`[eval] chatgpt oauth unavailable: ${chatgptUnavailable.reason}`);
    }
  }

  console.log(`[eval] capabilities: ${profiles.length} model(s) x ${capabilities.length} capability(ies)`);
  const report = await runCapabilitySuite({
    profiles,
    capabilities,
    rootSeed,
    metadata,
    unavailable: (profile) => {
      if (profile.provider === "chatgpt") return chatgptUnavailable;
      const missing = missingApiKey(profile.provider);
      return missing ? { code: "credentials_missing", reason: `${missing} is not set.` } : undefined;
    },
    // An explicit --model selection is an intentional spend, so it runs every supported cell.
    ...(!options.model && { costPolicy: createCapabilityCostPolicy(listModels()) }),
    createStream: (profile) => createProfileStream(profile, process.env, chatgptAuth),
    configureProviderManager: (profile, manager) =>
      configureProfileProviderManager(profile, manager, chatgptAuth, { apiKeyEnv: process.env }),
    onCellStart: (profile, capability) => {
      console.log(`[eval] start ${capability} / ${profile.provider} / ${profile.model}`);
    },
    onCellEnd: (cell) => printCapabilityCell(cell, secrets),
  });

  const reportPath = options.reportPath ?? defaultReportPath("capabilities");
  await writeEvalReport(reportPath, report, { secrets });
  const markdown = redactEvalText(renderCapabilityMatrixMarkdown(report), secrets);
  const markdownPath = `${reportPath.replace(/\.json$/, "")}.md`;
  await Bun.write(markdownPath, markdown);
  console.log(`[eval] report ${reportPath}`);
  console.log(`[eval] matrix ${markdownPath}`);
  const { pass, fail, not_run: notRun, unsupported, skipped } = report.counts;
  console.log(`[eval] cells pass=${pass} fail=${fail} not_run=${notRun} unsupported=${unsupported} skipped=${skipped}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, "utf8");
  return report.passed ? 0 : 1;
}

export function selectCoreTasks(taskId?: string): AnyEvalTask[] {
  if (!taskId) return [...CORE_EVAL_TASKS];
  const task = CORE_EVAL_TASKS.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown core eval task "${taskId}".`);
  return [task];
}

export function selectRuntimeTasks(taskId?: string) {
  if (!taskId) return [...RUNTIME_EVAL_TASKS];
  const task = RUNTIME_EVAL_TASKS.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown runtime eval task "${taskId}".`);
  return [task];
}

function resolveRunMetadata() {
  const commitSha = process.env.GITHUB_SHA?.trim() || localCommitSha();
  return {
    suiteVersion: SUITE_VERSION,
    repository: process.env.GITHUB_REPOSITORY?.trim() || "local/diligent",
    commitSha,
    ref: process.env.GITHUB_REF?.trim() || "local",
    runId: process.env.GITHUB_RUN_ID?.trim() || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT?.trim() || "1",
    bunVersion: Bun.version,
  };
}

function localCommitSha(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  if (result.exitCode !== 0) return "unknown";
  return new TextDecoder().decode(result.stdout).trim() || "unknown";
}

export function defaultReportPath(suite: "core" | "runtime" | "capabilities", now = new Date()): string {
  const timestamp = now.toISOString().replaceAll(":", "-");
  return join("artifacts", "evals", `${suite}-${timestamp}.json`);
}

function printCapabilityCell(cell: CapabilityCell, secrets: readonly string[]): void {
  const identity = `${cell.capability} / ${cell.provider} / ${cell.model}`;
  if (cell.status === "pass") {
    console.log(`[eval] ${cell.degraded ? "degraded" : "pass"} ${identity} (${cell.elapsedMs}ms)`);
    return;
  }
  const detail = redactEvalText(`${cell.code ? `${cell.code}: ` : ""}${cell.reason ?? ""}`, secrets);
  const line = `[eval] ${cell.status.replace("_", " ")} ${identity}: ${detail}`;
  if (cell.status === "unsupported" || cell.status === "skipped") console.log(line);
  else console.error(line);
}

function printExecutionResult(result: EvalExecutionResult<unknown>, secrets: readonly string[]): void {
  const identity = `${result.execution.taskId} / ${result.execution.profile.provider}`;
  if (result.passed) {
    const label = result.status === "degraded" ? "degraded" : "pass";
    console.log(
      `[eval] ${label} ${identity} (${result.execution.elapsedMs}ms, turns=${result.execution.turnCount}, tools=${result.execution.toolCallCount})`,
    );
    return;
  }
  const failure = result.failure;
  const detail = failure ? `${failure.code}: ${failure.message}` : result.execution.termination;
  console.error(`[eval] fail ${identity}: ${redactEvalText(detail, secrets)}`);
}

function printRuntimeExecutionResult(result: RuntimeEvalExecutionResult, secrets: readonly string[]): void {
  const identity = `${result.execution.taskId} / ${result.execution.profile.provider}`;
  if (result.passed) {
    const label = result.status === "degraded" ? "degraded" : "pass";
    console.log(
      `[eval] ${label} ${identity} (${result.execution.elapsedMs}ms, turns=${result.execution.turns.length}, tools=${result.execution.toolCalls.length})`,
    );
    return;
  }
  const detail = result.failure ? `${result.failure.code}: ${result.failure.message}` : result.execution.termination;
  console.error(`[eval] fail ${identity}: ${redactEvalText(detail, secrets)}`);
}

async function writeGithubSummary(
  report: Awaited<ReturnType<typeof runEvalSuite>> | Awaited<ReturnType<typeof runRuntimeEvalSuite>>,
  reportPath: string,
): Promise<void> {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = [
    `## ${"suite" in report && report.suite === "runtime" ? "Runtime" : "Core"} eval suite`,
    "",
    `- Status: ${report.status.toUpperCase()}`,
    `- Commit: \`${report.commitSha}\``,
    `- Accepted: ${report.executions.filter((execution) => execution.passed).length}/${report.executions.length}`,
    `- Degraded: ${report.executions.filter((execution) => execution.status === "degraded").length}`,
    `- Report: \`${reportPath}\``,
    "",
  ];
  await appendFile(path, lines.join("\n"), "utf8");
}

function printHelp(): void {
  console.log(`Usage:
  bun run eval core [--provider openai|anthropic|gemini|chatgpt] [--task <id>]
                      [--model <model-id>]
                      [--seed <seed>] [--report <path>]

  bun run eval runtime [--provider openai|anthropic|gemini|chatgpt] [--task <id>]
                         [--model <model-id>] [--seed <seed>] [--report <path>]

  bun run eval capabilities [--provider openai|anthropic|gemini|chatgpt] [--model <model-id>]
                              [--capability ${MODEL_CAPABILITIES.join("|")}]
                              [--seed <seed>] [--report <path>]

  bun run eval chatgpt-login [--chatgpt-auth-file <path>]

ChatGPT options for every suite:
  --non-interactive           Never open a browser; missing or rejected OAuth fails the run.
  --chatgpt-auth-file <path>  Use a dedicated file-backed OAuth store instead of the Diligent auth store.

Omitting --task runs every task in the selected suite. Omitting --provider runs the OpenAI and Anthropic
defaults for core and runtime, and every OpenAI, Anthropic, and Gemini catalog model for capabilities.`);
}

if (import.meta.main) {
  process.exitCode = await main();
}
