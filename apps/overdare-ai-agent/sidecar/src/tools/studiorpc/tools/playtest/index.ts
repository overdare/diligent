// @summary Registers Studio playtest harness authoring and episode-run tools.
import type { Tool } from "../../types";
import { createHarnessTool } from "./harness-tool";
import { createRunTool } from "./run-tool";
import type { PlaytestToolOptions } from "./tool-shared";

export function createPlaytestTools(options: PlaytestToolOptions): Tool[] {
  return [createHarnessTool(options), createRunTool(options)];
}
