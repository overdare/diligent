// @summary Registers generic Studio RPC method modules and their render builders.
import * as actionSequencerApplyJson from "./methods/action-sequencer-service.apply-json.ts";
import * as assetDrawerImport from "./methods/asset-drawer.import.ts";
import * as assetManagerImageImport from "./methods/asset-manager.image.import.ts";
import * as gamePlay from "./methods/game.play.ts";
import * as gameStop from "./methods/game.stop.ts";
import * as instanceDelete from "./methods/instance.delete.ts";
import * as levelBrowse from "./methods/level.browse.ts";
import * as levelSaveFile from "./methods/level.save.file.ts";
import * as scriptAdd from "./methods/script.add.ts";
import * as scriptDelete from "./methods/script.delete.ts";
import {
  buildActionSequencerApplyJsonRender,
  buildAssetDrawerImportRender,
  buildAssetManagerImageImportRender,
  buildDeleteRender,
  buildGamePlayRender,
  buildGameStopRender,
  buildLevelBrowseRender,
  buildLevelSaveFileRender,
  buildScriptAddRender,
} from "./render.ts";
import type { MethodModule, RenderBuilder } from "./tool-types.ts";

export const methodModules: MethodModule[] = [
  assetDrawerImport,
  assetManagerImageImport,
  actionSequencerApplyJson,
  levelBrowse,
  levelSaveFile,
  scriptAdd,
  scriptDelete,
  instanceDelete,
  gamePlay,
  gameStop,
];

export const renderBuilders: Record<string, RenderBuilder> = {
  studiorpc_asset_drawer_import: ({ normalizedArgs, output }) => buildAssetDrawerImportRender(normalizedArgs, output),
  studiorpc_asset_manager_image_import: ({ normalizedArgs, output, result }) =>
    buildAssetManagerImageImportRender(result, normalizedArgs, output),
  studiorpc_action_sequencer_service_apply_json: ({ normalizedArgs, output }) =>
    buildActionSequencerApplyJsonRender(normalizedArgs, output),
  studiorpc_level_browse: ({ result }) => buildLevelBrowseRender(result),
  studiorpc_level_save_file: ({ output }) => buildLevelSaveFileRender(output),
  studiorpc_script_add: ({ normalizedArgs, output }) => buildScriptAddRender(normalizedArgs, output),
  studiorpc_script_delete: ({ normalizedArgs, output }) =>
    buildDeleteRender("Studio script delete", String(normalizedArgs.targetGuid ?? ""), output),
  studiorpc_instance_delete: ({ normalizedArgs, output }) =>
    buildDeleteRender("Studio instance delete", String(normalizedArgs.targetGuid ?? ""), output),
  studiorpc_game_play: ({ normalizedArgs, output }) => buildGamePlayRender(normalizedArgs, output),
  studiorpc_game_stop: ({ output }) => buildGameStopRender(output),
};
