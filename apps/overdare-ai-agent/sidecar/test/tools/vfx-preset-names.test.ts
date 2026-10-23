// @summary Verifies native preset names and catalog input values independently of upstream labels.
import { expect, test } from "bun:test";
import { annotatePresetCatalog } from "../../../scripts/vfx-preset-catalog";
import {
  parseInstanceCreateProperties,
  parseInstancePatchProperties,
} from "../../src/tools/studiorpc/methods/instance-properties";

test("resource aliases normalize to native preset names for create and patch", () => {
  expect(parseInstanceCreateProperties("VFXPreset", { PresetName: "VFX_UGC_Muzzle_01", Color: [] }).PresetName).toBe(
    "Muzzle",
  );
  expect(parseInstancePatchProperties("VFXPreset", { PresetName: "VFX_UGC_SpearThrust_01" }).PresetName).toBe(
    "Spear Thrust",
  );
  expect(parseInstancePatchProperties("VFXPreset", { PresetName: "VFX_UGC_LevelUp_02" }).PresetName).toBe("Level Up");
  expect(parseInstancePatchProperties("VFXPreset", { PresetName: "Muzzle" })).toEqual({ PresetName: "Muzzle" });
});
test("unknown resource aliases fail before Studio can silently keep the default", () => {
  expect(() => parseInstancePatchProperties("VFXPreset", { PresetName: "VFX_UGC_Unknown_999" })).toThrow("PresetName");
});
test("catalog inputs use native names rather than upstream labels and flag absent assets", () => {
  const source =
    "| Resource | DisplayName | Category | Subcategory | Genre | Keywords |\n|---|---|---|---|---|---|\n| VFX_A | Typo | Combat | Hits | General | hit |\n| VFX_B | Guess | Combat | Hits | General | hit |\n";
  const result = annotatePresetCatalog(source, { VFX_A: "Exact Name" });
  expect(result).toContain("| VFX_A | Exact Name | Typo |");
  expect(result).toContain("| VFX_B | UNAVAILABLE | Guess |");
  expect(annotatePresetCatalog(result, { VFX_A: "Exact Name" })).toBe(result);
});

test("a texture resource sharing the preset prefix is not accepted as a preset", () => {
  expect(() => parseInstancePatchProperties("VFXPreset", { PresetName: "VFX_UGC_Fire_01" })).toThrow("PresetName");
});
