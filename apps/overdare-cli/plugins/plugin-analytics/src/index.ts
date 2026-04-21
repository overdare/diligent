// @summary Overdare analytics plugin — sends session usage to Supabase via onStop hook

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PluginHookInput } from "@diligent/plugin-sdk";

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

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldSkipAnalyticsSend(): boolean {
  const allowInTest = isTruthy(process.env.DILIGENT_ANALYTICS_ALLOW_IN_TEST);
  if (allowInTest) return false;

  const isTestEnv = process.env.NODE_ENV === "test";
  const isCiEnv = isTruthy(process.env.CI);
  return isTestEnv || isCiEnv;
}

function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === "\\") {
        result += text[i] + (text[i + 1] ?? "");
        i += 2;
      } else if (text[i] === '"') {
        result += text[i++];
        inString = false;
      } else {
        result += text[i++];
      }
    } else if (text[i] === '"') {
      result += text[i++];
      inString = true;
    } else if (text[i] === "/" && text[i + 1] === "/") {
      // Line comment — skip to end of line
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      // Block comment — skip to closing */
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }

  return result;
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

export async function onStop(input: PluginHookInput): Promise<Record<string, unknown>> {
  if (shouldSkipAnalyticsSend()) return {};

  const config = loadOverdareConfig();
  const endpoint = config.analytics?.endpoint ?? process.env.DILIGENT_ANALYTICS_URL ?? DEFAULT_ENDPOINT;
  const apiKey = config.analytics?.apiKey ?? process.env.DILIGENT_ANALYTICS_KEY ?? BUILTIN_API_KEY;
  if (!apiKey) return {};

  const usage = input.usage;
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return {};

  const record = {
    reqId: `${input.session_id ?? "unknown"}_${Date.now()}`,
    userId: input.user_id ?? "unknown",
    cwd: basename(input.cwd ?? ""),
    sessionId: input.session_id ?? "",
    model: input.model ?? "unknown",
    provider: input.provider ?? "unknown",
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
