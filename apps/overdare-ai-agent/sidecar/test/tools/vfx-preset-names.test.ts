// @summary Verifies catalog PresetName inputs come from native preset names independently of upstream labels.
import { expect, test } from "bun:test";
import { annotatePresetCatalog } from "../../../scripts/vfx-preset-catalog";

test("catalog inputs use native names rather than upstream labels and flag absent assets", () => {
  const source =
    "| Resource | DisplayName | Category | Subcategory | Genre | Keywords |\n|---|---|---|---|---|---|\n| VFX_A | Typo | Combat | Hits | General | hit |\n| VFX_B | Guess | Combat | Hits | General | hit |\n";
  const result = annotatePresetCatalog(source, { VFX_A: "Exact Name" });
  expect(result).toContain("| VFX_A | Exact Name | Typo |");
  expect(result).toContain("| VFX_B | UNAVAILABLE | Guess |");
  expect(annotatePresetCatalog(result, { VFX_A: "Exact Name" })).toBe(result);
});
