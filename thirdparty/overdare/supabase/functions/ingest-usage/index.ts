import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USAGE_API_KEY = Deno.env.get("USAGE_API_KEY")!;

// API key comparison (timing-safe via constant-time XOR)
function authenticate(req: Request): boolean {
  const provided = req.headers.get("x-api-key");
  if (!provided || !USAGE_API_KEY) return false;
  if (provided.length !== USAGE_API_KEY.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ USAGE_API_KEY.charCodeAt(i);
  }
  return mismatch === 0;
}

// Simple in-memory rate limit (per Edge Function instance)
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // max requests per minute
const RATE_WINDOW = 60_000; // 1 minute

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // API key authentication
  if (!authenticate(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // --- Validation ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Structure validation
  const { records } = body as { records?: unknown[] };
  if (!Array.isArray(records) || records.length === 0 || records.length > 50) {
    return new Response("records: array of 1-50 items required", {
      status: 400,
    });
  }

  // Per-record validation
  const validated = [];
  for (const r of records) {
    const rec = r as Record<string, unknown>;
    if (
      typeof rec.reqId !== "string" ||
      !rec.reqId ||
      typeof rec.userId !== "string" ||
      !rec.userId ||
      typeof rec.cwd !== "string" ||
      !rec.cwd ||
      typeof rec.sessionId !== "string" ||
      typeof rec.model !== "string" ||
      typeof rec.provider !== "string" ||
      typeof rec.inputTokens !== "number" ||
      rec.inputTokens < 0 ||
      typeof rec.outputTokens !== "number" ||
      rec.outputTokens < 0 ||
      typeof rec.cacheReadTokens !== "number" ||
      rec.cacheReadTokens < 0 ||
      typeof rec.cacheWriteTokens !== "number" ||
      rec.cacheWriteTokens < 0 ||
      rec.reqId.length > 256 ||
      rec.userId.length > 128 ||
      rec.cwd.length > 1024 ||
      rec.sessionId.length > 256 ||
      rec.model.length > 128 ||
      rec.provider.length > 64
    ) {
      return new Response("Invalid record shape", { status: 400 });
    }
    validated.push(rec);
  }

  // Rate limit (per userId)
  const userId = validated[0].userId as string;
  if (!checkRateLimit(userId)) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  // --- INSERT ---
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error } = await supabase.from("token_usage").upsert(
    validated.map((r) => ({
      req_id: r.reqId,
      user_id: r.userId,
      cwd: r.cwd,
      session_id: r.sessionId,
      model: r.model,
      provider: r.provider,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cache_read_tokens: r.cacheReadTokens,
      cache_write_tokens: r.cacheWriteTokens,
    })),
    { onConflict: "req_id", ignoreDuplicates: true },
  );

  if (error) {
    console.error("Insert error:", error);
    return new Response(JSON.stringify({ ok: false, error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, count: validated.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
