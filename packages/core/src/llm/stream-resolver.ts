// @summary Global stream resolver — runtime must configure provider StreamFunction resolution
import type { StreamFunction } from "./types";

type StreamResolver = (provider: string) => StreamFunction;

let _resolver: StreamResolver | null = null;

/** Configure the global stream resolver (called once at app startup) */
export function configureStreamResolver(resolver: StreamResolver): void {
  _resolver = resolver;
}

/** Resolve a StreamFunction for the given provider */
export function resolveStream(provider: string): StreamFunction {
  if (_resolver) return _resolver(provider);
  throw new Error(`No stream resolver configured for provider "${provider}"`);
}

/** Reset resolver to default (for test cleanup) */
export function resetStreamResolver(): void {
  _resolver = null;
}
