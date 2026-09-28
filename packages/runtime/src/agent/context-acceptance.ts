// @summary In-process receipts acknowledge trusted context only after core accepted its injection
import type { AgentContextInjection } from "@diligent/core/agent";

const receipts = new WeakMap<Record<string, unknown>, () => void>();

export function acknowledgeContextInjection(
  injection: AgentContextInjection,
  accepted: () => void,
): AgentContextInjection {
  const metadata = injection.metadata ?? {};
  receipts.set(metadata, accepted);
  return { ...injection, metadata };
}

export function acceptContextInjectionMetadata(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const accepted = receipts.get(metadata);
  receipts.delete(metadata);
  accepted?.();
}
