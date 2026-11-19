// @summary Optional OTel runtime scoped to authorized Diligent executions.

import { AsyncLocalStorage } from "node:async_hooks";
import type { StreamOptions } from "@diligent/core/provider-contract";
import { createContextKey, context as otelContext, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { maskTurnText, type ObservationPolicySnapshot } from "./content-policy";
import { projectModelMessages, sanitizeDetailedValue } from "./detailed-content";
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
  const errorReasons = new WeakMap<object, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const processor = new ConsentSpanProcessor({
    getPolicy: options.getPolicy,
    getErrorReason: (span) => errorReasons.get(span),
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
  function contentMask() {
    const active = contexts.getStore();
    const current = options.getPolicy();
    return active?.granted &&
      current.granted &&
      active.contentMode === "full" &&
      current.contentMode === "full" &&
      active.userId === current.userId &&
      active.generation === current.generation
      ? options.maskText
      : undefined;
  }
  function captureReason(span: object, reason: unknown) {
    try {
      const mask = contentMask();
      if (!mask || typeof reason !== "string" || reason.length > 8192) return;
      // Mask before splitting so multiline credentials stay redacted.
      const line = mask(reason)
        .split(/[\r\n]/, 1)[0]
        ?.trim();
      if (line && Buffer.byteLength(line) <= 512 && !/[{}]/.test(line)) errorReasons.set(span, line);
    } catch {
      /* Omit unprocessable free text. */
    }
  }
  const observeExchange: NonNullable<StreamOptions["observeExchange"]> = (model, input) => {
    if (model.provider !== "chatgpt") return undefined;
    const exchange = provider.getTracer("diligent.exchange").startSpan("diligent.exchange", {
      attributes: {
        "openinference.span.kind": "LLM",
        "llm.provider": "openai",
        "llm.system": "openai",
        "llm.model_name": model.modelId,
        "diligent.auth_mode": "chatgpt_login",
      },
    });
    const started = performance.now();
    function capture(direction: "input" | "output", value: unknown) {
      try {
        const mask = contentMask();
        if (!mask || !options.captureModelContent) return;
        const fields = projectModelMessages({ [`${direction}.value`]: value }, mask);
        turnContent.set(exchange, { ...turnContent.get(exchange), ...fields });
      } catch {
        /* A malformed model message must not suppress usage. */
      }
    }
    return {
      firstText: () => exchange.setAttribute("diligent.first_text_ms", performance.now() - started),
      usage: ({ prompt, completion, total, cacheRead, cacheWrite }) => {
        const counts = {
          prompt,
          completion,
          total,
          "prompt_details.cache_read": cacheRead,
          "prompt_details.cache_write": cacheWrite,
        };
        for (const [key, value] of Object.entries(counts))
          if (value !== undefined) exchange.setAttribute(`llm.token_count.${key}`, value);
      },
      end: (output, failure) => {
        // Use transport timing and project content after the response has arrived.
        const endTime = performance.timeOrigin + performance.now();
        capture("input", input);
        if (output) capture("output", output);
        if (failure) {
          exchange.setStatus({ code: SpanStatusCode.ERROR });
          exchange.setAttribute("diligent.error.category", "provider");
          if (failure.errorType) exchange.setAttribute("error.type", failure.errorType);
          if (failure.statusCode !== undefined) exchange.setAttribute("http.response.status_code", failure.statusCode);
        }
        exchange.end(endTime);
      },
    };
  };
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
        observeExchange,
        run: <T>(fn: () => Promise<T>) => otelContext.with(trace.setSpan(otelContext.active(), span), fn),
        firstResponse: () => span.setAttribute("diligent.first_text_ms", performance.now() - started),
        end: (failed: boolean, failure?: { errorType: string; statusCode?: number }) => {
          if (failed) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttribute("diligent.error.category", "provider");
          }
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
        readTurnContent?: () => { input?: string; output?: string } | undefined;
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
        const finish = (failed: boolean) => {
          if (failed) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.setAttribute("diligent.error.category", "workflow");
          }
          try {
            const current = options.getPolicy();
            if (
              !inherited &&
              policy.contentMode !== "none" &&
              current.granted &&
              current.contentMode === policy.contentMode &&
              current.userId === policy.userId &&
              current.generation === policy.generation &&
              options.maskText &&
              context?.readTurnContent
            ) {
              const content = context.readTurnContent();
              const fields: Record<string, string> = {};
              for (const side of ["input", "output"] as const) {
                const value = content?.[side];
                if (!value) continue;
                try {
                  const masked = maskTurnText(value, options.maskText);
                  if (masked) fields[`${side}.value`] = masked;
                } catch {
                  /* Keep the other side. */
                }
              }
              if (Object.keys(fields).length && policy.userId)
                turnContent.set(span, { ...fields, "diligent.content.user_id": policy.userId });
            }
          } catch {
            /* Metadata is still usable. */
          }
          span.end();
        };
        const success = (value: unknown) => {
          finish(!!value && typeof value === "object" && "status" in value && value.status === "failed");
          return value;
        };
        try {
          const result = otelContext.with(trace.setSpan(ROOT_CONTEXT, span), fn);
          if (result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
            return Promise.resolve(result).then(success, (error) => {
              finish(true);
              throw error;
            }) as T;
          }
          return success(result) as T;
        } catch (error) {
          finish(true);
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
          const mask = contentMask();
          if (!mask) return;
          const sanitized = sanitizeDetailedValue(value, mask);
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
            span.setAttribute("diligent.error.category", "tool");
            if ("phase" in metadata && (metadata.phase === "execute" || metadata.phase === "save"))
              span.setAttribute("diligent.error.phase", metadata.phase);
            if ("code" in metadata && typeof metadata.code === "number" && Number.isSafeInteger(metadata.code))
              span.setAttribute("diligent.error.code", metadata.code);
            if ("errorReason" in metadata) captureReason(span, metadata.errorReason);
          }
        }
        return result;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute("diligent.error.category", "tool");
        // Only a separately supplied reason is eligible; a generic Error can embed request dumps.
        if (error && typeof error === "object" && "reason" in error) captureReason(span, error.reason);
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
