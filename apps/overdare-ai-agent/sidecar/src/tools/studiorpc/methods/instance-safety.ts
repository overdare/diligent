// @summary Protects known Studio singleton roots independently of editable class schemas.

const protectedInstanceClasses = new Set<string>([
  "Workspace",
  "Lighting",
  "Atmosphere",
  "Players",
  "StarterPlayer",
  "MaterialService",
  "HttpService",
  "CollectionService",
  "DataModel",
  "DataStoreService",
  "PhysicsService",
  "RunService",
  "ServerScriptService",
  "ServerStorage",
  "StarterCharacterScripts",
  "StarterGui",
  "StarterPlayerScripts",
  "ReplicatedStorage",
]);

export function isProtectedInstanceClass(className: string): boolean {
  return protectedInstanceClasses.has(className);
}
