// @summary Registers generic Studio RPC method modules and their render builders.
import type { ToolRenderPayload } from "@diligent/plugin-sdk";
import type { z } from "zod";
import * as actionSequencerApplyJson from "./methods/action-sequencer-service.apply-json.ts";
// biome-ignore lint/correctness/noUnusedImports: temporarily disabled — kept for easy re-enable
import * as _assetDrawerImport from "./methods/asset-drawer.import.ts";
import * as assetManagerImageImport from "./methods/asset-manager.image.import.ts";
import * as gamePlay from "./methods/game.play.ts";
import * as gameStop from "./methods/game.stop.ts";
import * as levelBrowse from "./methods/level.browse.ts";
import * as levelSaveFile from "./methods/level.save.file.ts";
// biome-ignore lint/correctness/noUnusedImports: script.add moved to tools/script-add-tool.ts
import * as _scriptAdd from "./methods/script.add.ts";
// biome-ignore lint/correctness/noUnusedImports: script.delete moved to tools/script-delete-tool.ts
import * as _scriptDelete from "./methods/script.delete.ts";
import {
  // biome-ignore lint/correctness/noUnusedImports: temporarily disabled — kept for easy re-enable
  buildAssetDrawerImportRender as _buildAssetDrawerImportRender,
  buildActionSequencerApplyJsonRender,
  buildAssetManagerImageImportRender,
  buildGamePlayRender,
  buildGameStopRender,
  buildInstanceDeleteRender,
  buildInstanceMoveRender,
  buildInstanceReadRender,
  buildInstanceUpsertRender,
  buildLevelBrowseRender,
  buildLevelSaveFileRender,
} from "./render.ts";

type MethodModule = {
  method: string;
  description: string;
  params: z.ZodType;
  resolveMethod?: (args: Record<string, unknown>) => string;
  normalizeArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  postProcess?: (result: unknown, args: Record<string, unknown>) => unknown;
};

type RenderBuilder = (ctx: {
  args: Record<string, unknown>;
  normalizedArgs: Record<string, unknown>;
  output: string;
  result: unknown;
}) => ToolRenderPayload | undefined;

export const methodModules: MethodModule[] = [
  // _assetDrawerImport, // temporarily disabled
  assetManagerImageImport,
  actionSequencerApplyJson,
  levelBrowse,
  levelSaveFile,
  // scriptAdd — moved to tools/script-add-tool.ts
  // scriptDelete — moved to tools/script-delete-tool.ts
  gamePlay,
  gameStop,
];

/** Methods that mutate the level and should trigger an automatic save after execution. */
export const mutatingMethods = new Set([
  // _assetDrawerImport.method, // temporarily disabled
  assetManagerImageImport.method,
  actionSequencerApplyJson.method,
  // scriptAdd.method — moved to tools/script-add-tool.ts
  // scriptDelete.method — moved to tools/script-delete-tool.ts
]);

export const renderBuilders: Record<string, RenderBuilder> = {
  // studiorpc_asset_drawer_import: ({ normalizedArgs, output }) => _buildAssetDrawerImportRender(normalizedArgs, output), // temporarily disabled
  studiorpc_asset_manager_image_import: ({ normalizedArgs, output, result }) =>
    buildAssetManagerImageImportRender(result, normalizedArgs, output),
  studiorpc_action_sequencer_service_apply_json: ({ normalizedArgs, output }) =>
    buildActionSequencerApplyJsonRender(normalizedArgs, output),
  studiorpc_level_browse: ({ args, result }) => buildLevelBrowseRender(result, args),
  studiorpc_level_save_file: ({ output }) => buildLevelSaveFileRender(output),
  // studiorpc_script_add — moved to tools/script-add-tool.ts
  // studiorpc_script_delete — moved to tools/script-delete-tool.ts
  studiorpc_instance_read: ({ normalizedArgs, output }) => buildInstanceReadRender(normalizedArgs, output),
  studiorpc_instance_upsert: ({ normalizedArgs, output }) => buildInstanceUpsertRender(normalizedArgs, output),
  studiorpc_instance_delete: ({ normalizedArgs, output }) => buildInstanceDeleteRender(normalizedArgs, output),
  studiorpc_instance_move: ({ normalizedArgs, output }) => buildInstanceMoveRender(normalizedArgs, output),
  studiorpc_game_play: ({ normalizedArgs, output }) => buildGamePlayRender(normalizedArgs, output),
  studiorpc_game_stop: ({ output }) => buildGameStopRender(output),
};
