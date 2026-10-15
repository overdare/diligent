// @summary Defines the Studio playtest harness authoring and maintenance tool.
import type { Tool } from "../../types";
import { HARNESS_CONTRACT, installCode, listHarnesses, readHarness, sourceHash, updateCode } from "./harness";
import { approve, harnessParams, type PlaytestToolOptions, validate, withSignal } from "./tool-shared";

const toolName = "studiorpc_game_playtest_harness";
const description =
  "Author and maintain the current UGC game's playtest controller as editable Luau code inside Studio. describe returns the contract; list discovers installed names; read returns current source/hash or found:false with the author/install next step. A missing harness is normal for a new project. install persists an adapter and common driver; update checks expectedSourceHash and refreshes the driver. Derive bindings, state/event transitions, parameterized actions, actual effect checks and meaningful model decision points from this game's scripts/GUI and the user's objective. Expose direct controls and optional bounded assists according to the test; keep user-adjustable assistance separate from test goals and game rules. For player exploration, preserve unknowns and route/recovery choices instead of supplying a hidden solution. Optional intent-tagged steps support model-selected goals spanning multiple inputs; the adapter computes each goal independently and receives no semantic choice callback. Validate, run game_playtest, inspect decisionEvidence/effects/coverage and improve between runs. Edits save the project and are refused during PIE. Game-specific logic stays in Studio.";

export function createHarnessTool(options: PlaytestToolOptions): Tool {
  return {
    name: toolName,
    description,
    parameters: harnessParams,
    async execute(args, ctx) {
      const parsed = harnessParams.parse(args);
      if (parsed.operation === "describe") return { output: HARNESS_CONTRACT, metadata: { protocolVersion: 1 } };
      const rpc = withSignal(options.callRpc, ctx);
      if (parsed.operation === "list") {
        const harnesses = await listHarnesses(rpc);
        return { output: JSON.stringify({ harnesses }, null, 2), metadata: { harnesses } };
      }
      if (parsed.operation === "read") {
        const inventory = await listHarnesses(rpc);
        const asset = await readHarness(rpc, parsed.name, inventory);
        if (!asset) {
          const missing = {
            found: false,
            name: parsed.name,
            availableHarnesses: inventory.map((a) => a.name),
            nextAction: "inspect_game_and_install",
            instruction:
              "Inspect this game's scripts and test objective, use describe for the contract, then author and install a harness. Do not copy unrelated game bindings.",
          };
          return { output: JSON.stringify(missing, null, 2), metadata: missing };
        }
        return { output: JSON.stringify({ found: true, ...asset }, null, 2), metadata: { found: true, ...asset } };
      }
      const status = (await rpc("game.pie.status", {})) as { running?: boolean };
      if (status.running) throw new Error("Stop PIE before installing or updating harness code");
      const asset = await readHarness(rpc, parsed.name);
      if (parsed.operation === "install" && asset)
        throw new Error("Harness already exists; read it and update using its source hash");
      if (parsed.operation === "update" && (!asset || asset.sourceHash !== parsed.expectedSourceHash)) {
        throw new Error(
          "Harness source hash changed or the harness is missing; read the current source before updating",
        );
      }
      if (
        !(await approve(ctx, toolName, `${parsed.operation} and save Studio harness ${parsed.name}`, {
          operation: parsed.operation,
          name: parsed.name,
        }))
      ) {
        return { output: "[Rejected by user]", metadata: { error: true } };
      }
      const release = await options.writeLock?.acquire();
      try {
        const warning = options.beforeMutation?.();
        const code =
          parsed.operation === "install"
            ? installCode(parsed.name, parsed.source)
            : updateCode(parsed.name, asset!.source, parsed.source);
        await rpc("execute.luau", { target: "Editor", code }, { timeoutMs: 15000 });
        // Do not replay a successful editor transaction if saving or validation fails.
        try {
          await rpc("level.save.file", {}, { timeoutMs: 15000 });
        } catch (error) {
          throw new Error(
            `Harness edit succeeded but saving failed. Inspect/save the existing edit; do not replay it. ${String(error)}`,
          );
        }
        const installed = await readHarness(rpc, parsed.name);
        if (!installed || installed.sourceHash !== sourceHash(parsed.source) || !installed.driverGuid) {
          throw new Error("Harness edit succeeded but source/driver readback did not match; inspect the Studio assets");
        }
        const checked = await validate(rpc, [installed.moduleGuid, installed.driverGuid]);
        return {
          output: `${warning ? `${warning}\n` : ""}${JSON.stringify({ ...installed, source: undefined, valid: checked.valid }, null, 2)}\n\n${checked.output}`,
          metadata: {
            name: installed.name,
            sourceHash: installed.sourceHash,
            moduleGuid: installed.moduleGuid,
            driverGuid: installed.driverGuid,
            frameName: installed.frameName,
            valid: checked.valid,
          },
        };
      } finally {
        release?.();
      }
    },
  };
}
