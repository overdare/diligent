// @summary Projects authorized OTel spans into allowlisted fields before export.
import type { Context } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { type ObservationPolicySnapshot, projectObservation } from "./content-policy";
import { boundDetailedAttributes, projectModelMessages } from "./detailed-content";

interface ConsentSpanProcessorOptions {
  getPolicy(): ObservationPolicySnapshot;
  isAuthorizedContext(context: Context): boolean;
  getSessionId?(): string | undefined;
  getTurnContent?(span: ReadableSpan): Record<string, string | boolean> | undefined;
  maskText?(text: string): string;
  onSpan(span: ReadableSpan, policy: ObservationPolicySnapshot): void;
}

export class ConsentSpanProcessor implements SpanProcessor {
  private readonly snapshots = new WeakMap<Span, ObservationPolicySnapshot & { sessionId?: string }>();
  private readonly resource = resourceFromAttributes({ "service.name": "diligent", dd_llmobs_enabled: true });

  constructor(private readonly options: ConsentSpanProcessorOptions) {}

  onStart(span: Span, parentContext: Context): void {
    try {
      const policy = this.options.getPolicy();
      if (policy.granted && policy.userId && this.options.isAuthorizedContext(parentContext)) {
        this.snapshots.set(span, { ...policy, sessionId: this.options.getSessionId?.() });
      }
    } catch {
      // Observation must never prevent model execution.
    }
  }

  onEnd(span: ReadableSpan): void {
    try {
      const started = this.snapshots.get(span as Span);
      if (!started?.userId) return;
      const current = this.options.getPolicy();
      const attributes = projectObservation(
        { generation: started.generation, userId: started.userId, attributes: span.attributes },
        current,
      );
      if (!attributes) return;
      if (started.contentMode !== "none" && current.contentMode === started.contentMode) {
        // A malformed SDK response or masker failure only removes content, never metadata.
        let content: Record<string, string | boolean> = {};
        try {
          if (
            started.contentMode === "full" &&
            this.options.maskText &&
            span.attributes["openinference.span.kind"] === "LLM"
          ) {
            content = projectModelMessages(span.attributes, this.options.maskText);
          }
          Object.assign(content, this.options.getTurnContent?.(span));
          if (started.contentMode === "full") content = boundDetailedAttributes(content);
        } catch {
          content = {};
        }
        Object.assign(attributes, content);
        if (
          started.contentMode === "full" &&
          ["input.value", "output.value", "gen_ai.input.messages", "gen_ai.output.messages"].some(
            (key) => key in content,
          )
        ) {
          attributes["diligent.content.user_id"] = started.userId;
        }
      }
      if (started.sessionId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(started.sessionId)) {
        attributes["gen_ai.conversation.id"] = started.sessionId;
      }
      const kind = span.attributes["openinference.span.kind"];
      if (kind === "LLM" || kind === "CHAIN" || kind === "TOOL") attributes["openinference.span.kind"] = kind;
      const projected: ReadableSpan = {
        ...span,
        name: kind === "LLM" ? "diligent.llm" : kind === "TOOL" ? "diligent.tool" : "diligent.workflow",
        attributes,
        resource: this.resource,
        events: [],
        links: span.links.map(({ context }) => ({
          context: { traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags },
        })),
        status: { code: span.status.code },
        spanContext: () => span.spanContext(),
      };
      this.options.onSpan(projected, started);
    } catch {
      // Drop an invalid observation without disrupting the application.
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
