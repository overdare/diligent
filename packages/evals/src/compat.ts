// @summary Fail-closed, provider-scoped release checks over the product model catalog
import { mkdir, rename, writeFile } from "node:fs/promises";
import { getDefaultModelRef, listModels } from "@diligent/core/model-registry";
import { COMPAT_IMAGE_MODEL, runToolProbe, toolApplicability } from "./compat-tools";
import {
  configureProfileProviderManager,
  createProfileStream,
  isEvalProvider,
  resolveProfileModel,
  validateCredentials,
} from "./profiles";
import { type ChatGPTEvalAuth, createLocalChatGPTEvalAuth } from "./providers/chatgpt-oauth";
import { runEvalExecution } from "./runner/execution";
import { runRuntimeEvalExecution } from "./runner/runtime-execution";
import { createRandomRootSeed, deriveTaskSeed } from "./runner/seed";
import type { EvalProfile, EvalProvider } from "./task";
import { directResponseTask } from "./tasks/core/direct-response";
import { collaborationParallelSynthesisTask, manualCompactionResumeTask, readImagePairTask } from "./tasks/runtime";

type Feature = "direct-response" | "web-search" | "image-read" | "image-generation" | "compaction" | "collaboration";
interface Row {
  profile: EvalProfile;
  feature: Feature;
  status: "pending" | "unsupported" | "pass" | "fail";
  reason?: string;
  http?: HttpFailure;
  generationModel?: string;
  sharedWith?: string;
}

export function planCompatibility(provider: EvalProvider): Row[] {
  const rows: Row[] = [];
  const representative = getDefaultModelRef(provider).modelId;
  for (const model of listModels(provider)) {
    const profile: EvalProfile = { provider, model: model.modelId, effort: "medium" };
    const add = (feature: Feature, reason?: string) =>
      rows.push({
        profile,
        feature,
        status: reason ? "unsupported" : "pending",
        reason,
        ...(feature === "image-generation" && !reason && { generationModel: COMPAT_IMAGE_MODEL }),
      });
    add("direct-response");
    add("web-search", toolApplicability(profile, "web-search"));
    if (model.supportsVision === undefined)
      throw new Error(`Unclassified vision support: ${provider}/${model.modelId}`);
    add("image-read", model.supportsVision ? undefined : "no vision input on model card");
    add("image-generation", toolApplicability(profile, "image-generation"));
    add("compaction");
    if (model.modelId === representative) add("collaboration");
  }
  if (!rows.some((row) => row.feature === "collaboration"))
    throw new Error(`Missing representative model for ${provider}`);
  return rows;
}

async function exercise(row: Row, seed: string, auth?: ChatGPTEvalAuth): Promise<string | undefined> {
  const { feature, profile } = row;
  const model = resolveProfileModel(profile);
  if (feature === "web-search" || feature === "image-generation") {
    await runToolProbe(profile, feature, auth);
    return;
  }
  const shared = { profile, seed, streamFunction: createProfileStream(profile, process.env, auth) };
  const result =
    feature === "direct-response"
      ? await runEvalExecution({ ...shared, model, task: directResponseTask })
      : await runRuntimeEvalExecution({
          ...shared,
          task:
            feature === "image-read"
              ? readImagePairTask
              : feature === "compaction"
                ? manualCompactionResumeTask
                : collaborationParallelSynthesisTask,
          configureProviderManager: (p, manager) => {
            if (p.provider === "chatgpt") configureProfileProviderManager(p, manager, auth);
            else {
              const key = process.env[`${p.provider.toUpperCase()}_API_KEY`];
              if (!key) throw new Error(`Missing ${p.provider} credential`);
              manager.setApiKey(p.provider, key);
            }
          },
        });
  return result.passed ? undefined : (result.failure?.code ?? result.execution.termination);
}

interface HttpFailure {
  status: number;
  requestId?: string;
  code?: string;
  param?: string;
}
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.[\]-]{1,128}$/.test(value) ? value : undefined;
}

// Observe the product's fetch without rebuilding requests. In particular a recovered HTTP 400 is still a regression.
export async function evaluateCompatibility(
  run: () => Promise<string | undefined>,
): Promise<Pick<Row, "status" | "reason" | "http">> {
  let http: HttpFailure | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = new Proxy(original, {
    async apply(target, receiver, args: Parameters<typeof fetch>) {
      const response: Response = await Reflect.apply(target, receiver, args);
      if (response.status >= 400) {
        const detail: HttpFailure = {
          status: response.status,
          requestId: identifier(response.headers.get("x-request-id") ?? response.headers.get("request-id")),
        };
        const size = Number(response.headers.get("content-length"));
        if (size > 0 && size <= 65536 && response.headers.get("content-type")?.includes("json")) {
          const payload = (await response
            .clone()
            .json()
            .catch(() => null)) as {
            error?: { code?: unknown; type?: unknown; status?: unknown; param?: unknown };
          } | null;
          detail.code = identifier(payload?.error?.code ?? payload?.error?.type ?? payload?.error?.status);
          detail.param = identifier(payload?.error?.param);
        }
        if (http?.status !== 400) http = detail;
      }
      return response;
    },
  });
  try {
    const reason = await run();
    return { status: reason || http?.status === 400 ? "fail" : "pass", reason, http };
  } catch (error) {
    // SDK exception messages may include request data.
    return { status: "fail", reason: error instanceof Error ? identifier(error.name) : "error", http };
  } finally {
    globalThis.fetch = original;
  }
}

async function main(args: string[]) {
  const [provider, mode] = args;
  if (!provider || !isEvalProvider(provider) || args.length > 2 || (mode && mode !== "--plan"))
    throw new Error("Usage: compat.ts anthropic|openai|gemini|chatgpt [--plan]");
  const rows = planCompatibility(provider);
  if (mode === "--plan") {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const git = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
  const sha = git.stdout.toString().trim();
  if (git.exitCode !== 0 || (process.env.GITHUB_SHA && sha !== process.env.GITHUB_SHA))
    throw new Error("Cannot establish checkout SHA");
  const rootSeed = createRandomRootSeed();
  const report = { sha, provider, rootSeed, passed: false, rows };
  await mkdir("artifacts/compat", { recursive: true });
  const path = `artifacts/compat/${provider}.json`;
  const save = async () => {
    await writeFile(`${path}.tmp`, JSON.stringify(report, null, 2));
    await rename(`${path}.tmp`, path);
  };
  await save();
  validateCredentials(rows.map((row) => row.profile));
  let auth: ChatGPTEvalAuth | undefined;
  if (provider === "chatgpt") {
    try {
      auth = await createLocalChatGPTEvalAuth(process.cwd(), { nonInteractive: true });
    } catch {
      throw new Error("ChatGPT OAuth initialization failed: check the runner credential store and refresh access.");
    }
  }
  let generation: Row | undefined;
  for (const row of rows) {
    if (row.status === "unsupported") continue;
    if (row.generationModel && generation) {
      // The image endpoint receives the routed image model, never the conversation model.
      Object.assign(row, {
        status: generation.status,
        reason: generation.reason,
        http: generation.http,
        sharedWith: generation.profile.model,
      });
      continue;
    }
    Object.assign(row, await evaluateCompatibility(() => exercise(row, deriveTaskSeed(rootSeed, row.feature), auth)));
    if (row.generationModel) generation = row;
    console.log(
      `${provider}/${row.profile.model} ${row.feature}: ${row.status}${row.http ? ` HTTP ${row.http.status}` : ""}${row.reason ? ` (${row.reason})` : ""}`,
    );
    await save();
  }
  report.passed = rows.every((row) => row.status === "pass" || row.status === "unsupported");
  await save();
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.main) await main(process.argv.slice(2));
