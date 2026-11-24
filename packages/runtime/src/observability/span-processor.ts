// @summary Projects authorized OTel spans into allowlisted fields before export.
import { type Context, SpanStatusCode } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace";
import { type ObservationPolicySnapshot, projectObservation } from "./content-policy";
import { boundDetailedAttributes, projectModelMessages } from "./detailed-content";

interface ConsentSpanProcessorOptions {
  resourceAttributes?: Readonly<Record<string, string>>;
  getPolicy(): ObservationPolicySnapshot;
  isAuthorizedContext(context: Context): boolean;
  getErrorReason?(span: ReadableSpan): string | undefined;
  getSessionId?(): string | undefined;
  getTurnContent?(span: ReadableSpan): Record<string, string | boolean> | undefined;
  maskText?(text: string): string;
  onSpan(span: ReadableSpan, policy: ObservationPolicySnapshot): void;
}

export class ConsentSpanProcessor implements SpanProcessor {
  private readonly snapshots = new WeakMap<Span, ObservationPolicySnapshot & { sessionId?: string }>();
  private readonly resource;

  constructor(private readonly options: ConsentSpanProcessorOptions) {
    this.resource = resourceFromAttributes({
      ...options.resourceAttributes,
      "service.name": "diligent",
      dd_llmobs_enabled: true,
    });
  }

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
      let message: string | undefined;
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
          if (started.contentMode === "full" && span.status.code === SpanStatusCode.ERROR) {
            message = this.options.getErrorReason?.(span);
          }
          if (started.contentMode === "full") content = boundDetailedAttributes(content);
        } catch {
          content = {};
          message = undefined;
        }
        Object.assign(attributes, content);
        if (
          started.contentMode === "full" &&
          (message ||
            ["input.value", "output.value", "gen_ai.input.messages", "gen_ai.output.messages"].some(
              (key) => key in content,
            ))
        ) {
          attributes["diligent.content.user_id"] = started.userId;
        }
      }
      if (started.sessionId && /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(started.sessionId)) {
        attributes["gen_ai.conversation.id"] = started.sessionId;
      }
      const kind = span.attributes["openinference.span.kind"];
      if (kind === "LLM" && span.status.code === SpanStatusCode.ERROR)
        attributes["diligent.error.category"] = "provider";
      if (kind === "LLM" || kind === "CHAIN" || kind === "TOOL") attributes["openinference.span.kind"] = kind;
      let spanName: "diligent.llm" | "diligent.tool" | "diligent.workflow";
      if (kind === "LLM") {
        spanName = "diligent.llm";
      } else {
        spanName = kind === "TOOL" ? "diligent.tool" : "diligent.workflow";
      }
      const projected: ReadableSpan = {
        ...span,
        name: spanName,
        attributes,
        resource: this.resource,
        events: [],
        links: span.links.map(({ context }) => ({
          context: { traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags },
        })),
        status: { code: span.status.code, ...(message && { message }) },
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
