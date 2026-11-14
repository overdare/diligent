// @summary Optional OTel runtime scoped to authorized Diligent executions.
import { AsyncLocalStorage } from "node:async_hooks";
import { createContextKey, context as otelContext, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { maskTurnText, type ObservationPolicySnapshot } from "./content-policy";
import { sanitizeDetailedValue } from "./detailed-content";
import { attachModelInstrumentation } from "./model-instrumentation";
import { SpanDelivery } from "./span-delivery";
import { ConsentSpanProcessor } from "./span-processor";

interface ObservationRuntimeOptions {
  baseUrl: string;
  getPolicy(): ObservationPolicySnapshot;
  resolveToken(): Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  batchIntervalMs?: number;
  maskText?(text: string): string;
  captureModelContent?: boolean;
}

export function createObservationRuntime(options: ObservationRuntimeOptions) {
  const marker = createContextKey("diligent.context.check");
  const supportsContext = () =>
    otelContext.with(ROOT_CONTEXT.setValue(marker, true), () => otelContext.active().getValue(marker) === true);
  if (!supportsContext()) {
    const manager = new AsyncLocalStorageContextManager().enable();
    if (!otelContext.setGlobalContextManager(manager)) manager.disable();
    if (!supportsContext()) throw new Error("OpenTelemetry context manager unavailable");
  }
  const contexts = new AsyncLocalStorage<ObservationPolicySnapshot & { sessionId?: string }>();
  const delivery = new SpanDelivery(options);
  const turnContent = new WeakMap<object, Record<string, string | boolean>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const processor = new ConsentSpanProcessor({
    getPolicy: options.getPolicy,
    getTurnContent: (span) => turnContent.get(span),
    maskText: options.maskText,
    getSessionId: () => contexts.getStore()?.sessionId,
    isAuthorizedContext: () => {
      const active = contexts.getStore();
      const current = options.getPolicy();
      return (
        !!active?.granted &&
        !!active.userId &&
        active.userId === current.userId &&
        active.generation === current.generation &&
        current.granted
      );
    },
    onSpan: (span, policy) => {
      delivery.enqueue(span, policy);
      if (!timer && delivery.pendingCount > 0) {
        timer = setTimeout(() => {
          timer = undefined;
          void delivery.flush();
        }, options.batchIntervalMs ?? 2000);
        timer.unref();
      }
    },
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  const instrumentation = attachModelInstrumentation(provider, {
    captureContent: options.captureModelContent === true,
  });
  let closed = false;
  return {
    observeModelAttempt(attempt: number, callId: string) {
      if (closed || !contexts.getStore()) return undefined;
      const started = performance.now();
      const span = provider.getTracer("diligent.attempt").startSpan("diligent.attempt", {
        attributes: {
          "openinference.span.kind": "CHAIN",
          "diligent.retry.attempt": attempt,
          "diligent.model_call.id": callId,
        },
      });
      return {
        run: <T>(fn: () => Promise<T>) => otelContext.with(trace.setSpan(otelContext.active(), span), fn),
        firstResponse: () => span.setAttribute("diligent.first_text_ms", performance.now() - started),
        end: (failed: boolean, failure?: { errorType: string; statusCode?: number }) => {
          if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
          if (failure) {
            span.setAttribute("error.type", failure.errorType);
            if (failure.statusCode !== undefined) span.setAttribute("http.response.status_code", failure.statusCode);
          }
          span.end();
        },
      };
    },
    run<T>(
      fn: () => T,
      context?: {
        sessionId: string;
        rootSessionId?: string;
        readTurnContent?: () => { input: string; output: string } | undefined;
      },
    ): T {
      if (closed) return fn();
      let policy: ObservationPolicySnapshot;
      try {
        policy = options.getPolicy();
      } catch {
        return fn();
      }
      if (!policy.granted || !policy.userId) return fn();
      const inherited = contexts.getStore();
      if (inherited && (inherited.generation !== policy.generation || inherited.userId !== policy.userId)) {
        return fn();
      }
      const parentSpan = trace.getSpan(otelContext.active());
      return contexts.run({ ...policy, sessionId: context?.rootSessionId ?? context?.sessionId }, () => {
        let span: ReturnType<ReturnType<typeof provider.getTracer>["startSpan"]>;
        try {
          span = provider.getTracer("diligent.execution").startSpan(
            "diligent.execution",
            {
              attributes: { "openinference.span.kind": "CHAIN" },
              ...(parentSpan ? { links: [{ context: parentSpan.spanContext() }] } : {}),
            },
            ROOT_CONTEXT,
          );
        } catch {
          return fn();
        }
        try {
          const result = otelContext.with(trace.setSpan(ROOT_CONTEXT, span), fn);
          if (result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
            return Promise.resolve(result).then(
              (value) => {
                if (value && typeof value === "object" && "status" in value && value.status === "failed") {
                  span.setStatus({ code: SpanStatusCode.ERROR });
                }
                if (
                  value &&
                  typeof value === "object" &&
                  "status" in value &&
                  value.status === "completed" &&
                  !inherited &&
                  policy.contentMode !== "none" &&
                  options.maskText &&
                  context?.readTurnContent
                ) {
                  try {
                    const current = options.getPolicy();
                    if (
                      current.granted &&
                      current.contentMode === policy.contentMode &&
                      current.generation === policy.generation &&
                      current.userId === policy.userId
                    ) {
                      const content = context.readTurnContent();
                      if (content && policy.userId) {
                        const input = maskTurnText(content.input, options.maskText);
                        const output = maskTurnText(content.output, options.maskText);
                        if (input && output)
                          turnContent.set(span, {
                            "input.value": input,
                            "output.value": output,
                            "diligent.content.user_id": policy.userId,
                          });
                      }
                    }
                  } catch {
                    // A content or masking failure leaves the metadata span intact.
                  }
                }
                span.end();
                return value;
              },
              (error) => {
                span.setStatus({ code: SpanStatusCode.ERROR });
                span.end();
                throw error;
              },
            ) as T;
          }
          span.end();
          return result;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.end();
          throw error;
        }
      });
    },
    async runTool<T>(name: string, fn: () => Promise<T>, input?: unknown): Promise<T> {
      if (closed || !contexts.getStore()) return fn();
      let span: ReturnType<ReturnType<typeof provider.getTracer>["startSpan"]>;
      try {
        span = provider.getTracer("diligent.tool").startSpan("diligent.tool", {
          attributes: { "openinference.span.kind": "TOOL", "tool.name": name },
        });
      } catch {
        return fn();
      }
      const captureToolValue = (key: string, value: unknown) => {
        try {
          const active = contexts.getStore();
          const current = options.getPolicy();
          if (
            active?.contentMode !== "full" ||
            current.contentMode !== "full" ||
            !current.granted ||
            active.userId !== current.userId ||
            active.generation !== current.generation ||
            !options.maskText
          )
            return;
          const sanitized = sanitizeDetailedValue(value, options.maskText);
          if (!sanitized.value) return;
          const content = turnContent.get(span) ?? {};
          content[key] = sanitized.value;
          if (sanitized.truncated) content["diligent.content.truncated"] = true;
          turnContent.set(span, content);
        } catch {
          /* Invalid tool data must not change tool execution. */
        }
      };
      if (input !== undefined) captureToolValue("input.value", input);
      try {
        const result = await otelContext.with(trace.setSpan(otelContext.active(), span), fn);
        captureToolValue("output.value", result);
        if (result && typeof result === "object" && "metadata" in result) {
          const metadata = result.metadata;
          if (metadata && typeof metadata === "object" && "error" in metadata && metadata.error === true) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
        }
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
    flush: () => delivery.flush(),
    invalidatePolicy: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      delivery.invalidatePolicy();
    },
    async shutdown(): Promise<void> {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      instrumentation.disable();
      await provider.shutdown();
      await Promise.race([delivery.flush(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    },
  };
}
