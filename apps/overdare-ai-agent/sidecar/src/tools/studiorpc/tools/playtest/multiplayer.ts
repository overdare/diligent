// @summary Stable real PIE-client binding to actors in an authoritative shared frame.
import type { MultiplayerActor } from "./frame";

export interface ActorBinding {
  actorId: string;
  userId: string;
  clientId: string;
  source: "native_user_id" | "initial_position";
}
type RecordValue = Record<string, unknown>;
function record(v: unknown): RecordValue | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as RecordValue) : undefined;
}
export function injectableClients(status: unknown): RecordValue[] {
  const s = record(status);
  if (!Array.isArray(s?.clients)) return [];
  const clients = s.clients
    .map(record)
    .filter((c): c is RecordValue => !!c && c.injectable === true && typeof c.clientId === "string" && !!c.clientId);
  if (new Set(clients.map((c) => c.clientId)).size !== clients.length) throw new Error("Duplicate injectable clientId");
  return clients;
}

/** Reads are initial character.read results, never main-targeted game.observe character data. */
export function bindActors(actors: MultiplayerActor[], status: unknown, reads: Map<string, unknown>): ActorBinding[] {
  const clients = injectableClients(status);
  if (clients.length !== 2) throw new Error("Owned two-player PIE must expose exactly two injectable clients");
  const used = new Set<string>();
  return clients
    .map((client) => {
      const clientId = client.clientId as string;
      const root = record(reads.get(clientId));
      const data = record(root?.data) ?? root;
      const character = record(data?.character) ?? data;
      if (data?.clientId !== undefined && data.clientId !== clientId)
        throw new Error("character.read clientId mismatch");
      if (character?.clientId !== undefined && character.clientId !== clientId)
        throw new Error("character.read character clientId mismatch");
      const nativeId = client.userId ?? data?.userId ?? character?.userId;
      let matches: MultiplayerActor[];
      let source: ActorBinding["source"];
      if (typeof nativeId === "string" || typeof nativeId === "number") {
        matches = actors.filter((a) => a.userId === String(nativeId));
        source = "native_user_id";
      } else {
        const position = record(record(character?.CFrame)?.Position);
        if (
          !position ||
          ![position.X, position.Y, position.Z].every((v) => typeof v === "number" && Number.isFinite(v))
        )
          throw new Error(`Initial character.read omitted position for ${clientId}`);
        matches = actors.filter(
          (a) =>
            Math.hypot(
              a.position.x - Number(position.X),
              a.position.y - Number(position.Y),
              a.position.z - Number(position.Z),
            ) <= 150,
        );
        source = "initial_position";
      }
      if (matches.length !== 1 || used.has(matches[0].actorId))
        throw new Error(
          `Ambiguous or missing initial actor binding for ${clientId}; use unique spawns within 150 cm or native userId`,
        );
      used.add(matches[0].actorId);
      return { actorId: matches[0].actorId, userId: matches[0].userId, clientId, source };
    })
    .sort((a, b) => a.actorId.localeCompare(b.actorId));
}

export function assertActorBindings(bindings: ActorBinding[], actors: MultiplayerActor[]): void {
  if (bindings.some((b) => !actors.some((a) => a.actorId === b.actorId && a.userId === b.userId)))
    throw new Error("Authoritative actor identity changed during the owned session");
}
