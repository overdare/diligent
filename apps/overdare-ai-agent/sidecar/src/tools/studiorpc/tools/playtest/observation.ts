// @summary Interprets Studio status and observation envelopes without performing RPC or input.
import type { PlaytestFrame } from "./frame";
import type { SessionTarget } from "./runtime-types";

export class AdapterError extends Error {}
type FrameValueResult = { ready: true; value: string } | { ready: false; reason: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function unwrapData(value: unknown): Record<string, unknown> | undefined {
  const wrapper = asRecord(value);
  return asRecord(wrapper?.data) ?? wrapper;
}

export function observedClientId(observation: unknown): string | undefined {
  const root = asRecord(observation);
  const character = asRecord(root?.character);
  const data = asRecord(character?.data) ?? character;
  const direct = data?.clientId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  // game.observe post-processors may flatten the character payload.
  const flattened = character?.clientId;
  return typeof flattened === "string" && flattened.length > 0 ? flattened : undefined;
}

export function unavailableSectionReason(observation: unknown, name: "character" | "instances"): string | undefined {
  const root = asRecord(observation);
  const rawSection = asRecord(root?.[name]);
  const message = typeof rawSection?.error === "string" ? rawSection.error : "";
  const knownUnavailable =
    /no play[-\s]*test/i.test(message) ||
    /play[-\s]*test.*client\s*state.*(?:not available|unavailable)/i.test(message);
  const failedSections = Array.isArray(root?.failedSections) ? root.failedSections : [];
  const explicitlyPartial = root?.outcome === "partial" && failedSections.includes(name);
  if (rawSection?.status === "error" && knownUnavailable) return message;
  if (!rawSection && explicitlyPartial) return `game.observe ${name} section is unavailable`;
  return undefined;
}

export function frameStringValue(observation: unknown, frameName: string): FrameValueResult {
  const root = asRecord(observation);
  if (!root) throw new AdapterError("game.observe returned a malformed observation");
  const unavailable = unavailableSectionReason(observation, "instances");
  if (unavailable) return { ready: false, reason: unavailable };
  const section = unwrapData(root.instances);
  const entries = section?.instances;
  if (!Array.isArray(entries)) throw new AdapterError("game.observe omitted the frame instance list");
  const instance = entries.find((candidate) => {
    const record = asRecord(candidate);
    if (!record) return false;
    const name = record.name;
    const path = record.path;
    return name === frameName || path === frameName || (typeof path === "string" && path.endsWith(`.${frameName}`));
  });
  if (!instance) throw new AdapterError(`game.observe did not return StringValue ${frameName}`);
  const value = asRecord(asRecord(instance)?.Value);
  if (value?.Type !== "String" || typeof value.String !== "string") {
    throw new AdapterError(`${frameName}.Value is not a tagged String value`);
  }
  return { ready: true, value: value.String };
}

export function resolveTarget(status: unknown): SessionTarget | undefined {
  const record = asRecord(status);
  if (record?.running !== true || typeof record.pieSessionId !== "string" || !record.pieSessionId) return undefined;
  const clients = Array.isArray(record.clients)
    ? record.clients.map(asRecord).filter((x): x is Record<string, unknown> => !!x)
    : [];
  const injectable = clients.filter((client) => client.injectable === true && typeof client.clientId === "string");
  const selected = injectable.find((client) => client.targeted === true) ?? injectable[0];
  if (!selected || typeof selected.clientId !== "string") return undefined;
  return { pieSessionId: record.pieSessionId, clientId: selected.clientId };
}

export function adapterFrameReady(frame: PlaytestFrame): boolean {
  return (frame as PlaytestFrame & { ready?: boolean }).ready !== false;
}
