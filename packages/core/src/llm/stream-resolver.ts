// @summary Static stream resolver — returns built-in default stream functions when provider supports no-auth fallback
import type { ProviderName, StreamFunction } from "./types";

const STATIC_STREAM_FACTORIES: Partial<Record<ProviderName, () => StreamFunction>> = {
  // Intentionally empty for now: built-in providers typically require auth-bound stream functions.
  // Pass an auth-bound llmMsgStreamFn via AgentOptions for authenticated providers.
};

/** Resolve a StreamFunction for the given provider from static definitions. */
export function resolveStream(provider: ProviderName): StreamFunction {
  const factory = STATIC_STREAM_FACTORIES[provider];
  if (!factory) {
    throw new Error(
      `No static stream function for provider "${provider}". Provide llmMsgStreamFn via AgentOptions for authenticated providers.`,
    );
  }
  return factory();
}
