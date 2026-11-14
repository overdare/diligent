// @summary Explicitly attaches OpenInference to the SDK classes used by Diligent providers.
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { getAnthropicInstrumentationTarget } from "@diligent/core/providers/anthropic";
import { getOpenAIInstrumentationTarget } from "@diligent/core/providers/openai";
import type { TracerProvider } from "@opentelemetry/api";

let active = false;

export function attachModelInstrumentation(
  tracerProvider: TracerProvider,
  options: { captureContent?: boolean } = {},
): { disable(): void } {
  if (active) throw new Error("Model instrumentation is already active");
  const traceConfig = {
    hideInputs: !options.captureContent,
    hideOutputs: !options.captureContent,
    // Keep one raw SDK request/response for projection rather than duplicating each
    // message/tool definition into OTel attributes and exhausting the span limit.
    hideInputMessages: true,
    hideOutputMessages: true,
    hideInputImages: true,
    hideLLMTools: true,
  };
  const instrumentationOptions = { tracerProvider, instrumentationConfig: { enabled: false }, traceConfig };
  const openai = new OpenAIInstrumentation(instrumentationOptions);
  const anthropic = new AnthropicInstrumentation(instrumentationOptions);
  try {
    openai.manuallyInstrument(getOpenAIInstrumentationTarget() as Parameters<typeof openai.manuallyInstrument>[0]);
    anthropic.manuallyInstrument(getAnthropicInstrumentationTarget());
    active = true;
  } catch (error) {
    openai.disable();
    anthropic.disable();
    throw error;
  }
  return {
    disable() {
      if (!active) return;
      openai.disable();
      anthropic.disable();
      active = false;
    },
  };
}
