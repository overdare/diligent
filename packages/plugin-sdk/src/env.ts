// @summary Release environment helper for plugins.
export type Env = "prod" | "dev";

/** Reads DILIGENT_ENV, defaulting to prod unless the value is dev (case-insensitive). */
export function currentEnv(): Env {
  const raw = process.env.DILIGENT_ENV?.trim().toLowerCase();
  return raw === "dev" ? "dev" : "prod";
}
