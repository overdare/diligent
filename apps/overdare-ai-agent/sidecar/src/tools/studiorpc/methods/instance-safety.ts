// @summary Protects known Studio singleton roots independently of editable class schemas.
import { z } from "zod";

export const serviceClassEnum = z.enum([
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
