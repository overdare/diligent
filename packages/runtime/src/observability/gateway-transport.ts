// @summary Consent-aware transport for already sanitized OTLP trace payloads.
import type { ObservationPolicySnapshot } from "./content-policy";

type DeliveryResult =
  | { status: "accepted" }
  | { status: "partial"; rejectedSpans: number }
  | { status: "dropped" }
  | { status: "failed"; retryable: boolean; retryAfterMs?: number };

interface GatewayTransportOptions {
  baseUrl: string;
  /** This must be the result of the span projection policy, never raw SDK data. */
  payload: string;
  generation: number;
  userId: string;
  getPolicy(): ObservationPolicySnapshot;
  resolveToken(): Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export async function sendToGateway(options: GatewayTransportOptions): Promise<DeliveryResult> {
  const authorized = () => {
    const policy = options.getPolicy();
    return policy.granted && policy.userId === options.userId && policy.generation === options.generation;
  };
  try {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      return { status: "dropped" };
    if (!authorized() || Buffer.byteLength(options.payload, "utf8") > 1_048_576) return { status: "dropped" };
    const timeoutMs = options.timeoutMs ?? 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const token = await Promise.race([
      options.resolveToken(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Token resolution timed out")), timeoutMs);
        timer.unref();
      }),
    ]).finally(() => clearTimeout(timer));
    if (!token || !authorized()) return { status: "dropped" };
    const response = await (options.fetch ?? globalThis.fetch)(`${url.toString().replace(/\/$/, "")}/v1/otel/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Diligent-Telemetry-Version": "1",
      },
      body: options.payload,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
      const date = retryAfter && seconds === undefined ? Date.parse(retryAfter) : Number.NaN;
      const retryAfterMs =
        seconds !== undefined ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
      return {
        status: "failed",
        retryable: response.status === 429 || response.status >= 500,
        ...(retryAfterMs !== undefined && Number.isSafeInteger(retryAfterMs) ? { retryAfterMs } : {}),
      };
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return { status: "failed", retryable: false };
    const partial = (body as { partialSuccess?: { rejectedSpans?: unknown } }).partialSuccess;
    if (partial?.rejectedSpans !== undefined) {
      const count = Number(partial.rejectedSpans);
      if (!Number.isSafeInteger(count) || count < 0) return { status: "failed", retryable: false };
      if (count) return { status: "partial", rejectedSpans: count };
    }
    return { status: "accepted" };
  } catch {
    return { status: "failed", retryable: true };
  }
}
