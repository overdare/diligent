// @summary Bounded in-memory delivery of sanitized spans in standard OTLP JSON.
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import type { ObservationPolicySnapshot } from "./content-policy";
import { sendToGateway } from "./gateway-transport";

interface SpanDeliveryOptions {
  baseUrl: string;
  getPolicy(): ObservationPolicySnapshot;
  resolveToken(): Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  wait?(delayMs: number): Promise<void>;
}

interface QueuedPayload {
  payload: string;
  bytes: number;
  generation: number;
  userId: string;
}

export class SpanDelivery {
  private queue: QueuedPayload[] = [];
  private bytes = 0;
  private inFlight?: Promise<void>;
  private dropped = 0;

  constructor(private readonly options: SpanDeliveryOptions) {}

  get pendingCount(): number {
    return this.queue.length;
  }
  get droppedCount(): number {
    return this.dropped;
  }

  enqueue(span: ReadableSpan, policy: ObservationPolicySnapshot): void {
    try {
      if (!policy.granted || !policy.userId) {
        this.dropped++;
        return;
      }
      const encoded = JsonTraceSerializer.serializeRequest([span]);
      if (
        !encoded ||
        encoded.length > 1_048_576 ||
        this.queue.length >= 2048 ||
        this.bytes + encoded.length > 8_388_608
      ) {
        this.dropped++;
        return;
      }
      this.queue.push({
        payload: new TextDecoder().decode(encoded),
        bytes: encoded.length,
        generation: policy.generation,
        userId: policy.userId,
      });
      this.bytes += encoded.length;
    } catch {
      this.dropped++;
    }
  }

  invalidatePolicy(): void {
    this.dropped += this.queue.length;
    this.queue = [];
    this.bytes = 0;
  }

  flush(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.drain().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const item = this.queue.shift()!;
      this.bytes -= item.bytes;
      const started = Date.now();
      let accepted = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const result = await sendToGateway({ ...this.options, ...item });
        if (result.status === "accepted") {
          accepted = true;
          break;
        }
        if (result.status !== "failed" || !result.retryable || attempt === 3 || Date.now() - started >= 30_000) break;
        const delay = Math.max(result.retryAfterMs ?? 0, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
        if (Date.now() - started + delay >= 30_000) break;
        if (this.options.wait) await this.options.wait(delay);
        else await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      if (!accepted) this.dropped++;
    }
  }
}
