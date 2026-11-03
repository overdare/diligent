// @summary Luau test feature entry: the model tool and the experiment toggle's inject/remove side effect.
import type { call } from "../../rpc";
import { ensureFramework, removeFramework } from "./tool";

export { createLuauTestTool, LUAU_TEST_TOOL_NAME } from "./tool";

/**
 * Experiment toggle side effect. ON injects the framework into the connected Studio level, OFF removes it;
 * test modules are never touched. A running PIE session or a missing Studio connection only defers the work:
 * install/update/run re-ensure the framework, and setup/uninstall stay available as explicit operations.
 */
export async function applyLuauTestFrameworkToggle(callRpc: typeof call, enabled: boolean): Promise<void> {
  const status = (await callRpc("game.pie.status", {}, { timeoutMs: 5_000 })) as { running?: unknown };
  if (status?.running === true) throw new Error("PIE is running; the Luau test framework change is deferred");
  if (enabled) await ensureFramework(callRpc);
  else await removeFramework(callRpc);
}
