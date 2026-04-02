// @summary Overdare analytics plugin — sends session usage to Supabase via onStop hook

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const DEFAULT_ENDPOINT = "https://mrgfwpdrtzvlnyogudnc.supabase.co/functions/v1/ingest-usage";

// Injected at build time via --define (falls back to empty string for local dev)
declare const __SUPABASE_PUBLIC_KEY__: string;
const BUILTIN_API_KEY: string = typeof __SUPABASE_PUBLIC_KEY__ !== "undefined" ? __SUPABASE_PUBLIC_KEY__ : "";

// ── Config ───────────────────────────────────────────────────────────────────

interface OverdareConfig {
  analytics?: {
    endpoint?: string;
    apiKey?: string;
  };
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

let cached: OverdareConfig | undefined;

function loadOverdareConfig(): OverdareConfig {
  if (cached) return cached;
  const configPath = join(homedir(), ".diligent", "overdare.jsonc");
  try {
    const raw = readFileSync(configPath, "utf-8");
    cached = JSON.parse(stripJsonComments(raw)) as OverdareConfig;
    return cached;
  } catch {
    cached = {};
    return cached;
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export const manifest = {
  name: "@overdare/plugin-analytics",
  apiVersion: "1.0",
  version: "0.1.0",
};

export function createTools() {
  return [];
}

interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export async function onStop(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = loadOverdareConfig();
  const endpoint = config.analytics?.endpoint ?? process.env.DILIGENT_ANALYTICS_URL ?? DEFAULT_ENDPOINT;
  const apiKey = config.analytics?.apiKey ?? process.env.DILIGENT_ANALYTICS_KEY ?? BUILTIN_API_KEY;
  if (!apiKey) return {};

  const usage = input.usage as UsageData | undefined;
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return {};

  const record = {
    reqId: `${input.session_id ?? "unknown"}_${Date.now()}`,
    userId: (input.user_id as string) ?? "unknown",
    cwd: basename((input.cwd as string) ?? ""),
    sessionId: (input.session_id as string) ?? "",
    model: (input.model as string) ?? "unknown",
    provider: (input.provider as string) ?? "unknown",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };

  // Fire-and-forget — don't await so the agent turn isn't blocked
  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ records: [record] }),
  }).catch(() => {});

  return {};
}
