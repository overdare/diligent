// @summary Preserves Studio instance readback independently of writable property catalogs.
const instanceMetadataKeys = new Set(["ActorGuid", "ObjectKey", "InstanceType", "LuaChildren", "Name", "Parent"]);

/** Read-only spatial caches such as WorldTransform remain available for inspection. */
export function pickInstanceProperties(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !instanceMetadataKeys.has(key)));
}
