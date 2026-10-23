// @summary Adds authoritative PresetName inputs to upstream catalog rows without guessing missing names.
export function annotatePresetCatalog(source: string, names: Readonly<Record<string, string>>): string {
  return source
    .split("\n")
    .map((line) => {
      if (line.startsWith("| Resource |"))
        return "| Resource | PresetName | DisplayName | Category | Subcategory | Genre | Keywords |";
      if (/^\|[-|]+\|$/.test(line)) return "|---|---|---|---|---|---|---|";
      if (!line.startsWith("| VFX_")) return line;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.length === 7) cells.splice(1, 1);
      const presetName = names[cells[0]] ?? "UNAVAILABLE";
      cells.splice(1, 0, presetName);
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
}
