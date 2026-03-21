// @summary Builds tool render payloads for Studio RPC methods.
type TreeNode = { label: string; children?: TreeNode[] };

type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
};

function firstLine(text: string, fallback: string): string {
  return text.split("\n")[0]?.trim() || fallback;
}

function summarizeText(text: string | undefined, fallback?: string): string | undefined {
  const line = text
    ?.split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  if (line) return line;
  return fallback;
}

function summarizeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function clip(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toTreeNode(value: Record<string, unknown>): TreeNode | undefined {
  const name = readString(value.name) ?? "Instance";
  const className = readString(value.class);
  const filename = readString(value.filename);
  const childrenValue = Array.isArray(value.children) ? value.children : [];
  const children = childrenValue.flatMap((child) => {
    if (!isRecord(child)) return [];
    const node = toTreeNode(child);
    return node ? [node] : [];
  });
  const label = [name, className ? `(${className})` : "", filename ? `— ${filename}` : ""].filter(Boolean).join(" ");
  return { label, ...(children.length > 0 ? { children } : {}) };
}

export function buildLevelBrowseRender(result: unknown): ToolRenderPayload | undefined {
  if (!Array.isArray(result)) return undefined;
  const nodes = result.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const node = toTreeNode(entry);
    return node ? [node] : [];
  });
  if (nodes.length === 0) return undefined;
  return {
    version: 2,
    inputSummary: "level tree",
    outputSummary: summarizeCount(nodes.length, "root node"),
    blocks: [{ type: "tree", title: "Level tree", nodes }],
  };
}

export function buildScriptAddRender(args: Record<string, unknown>, output: string): ToolRenderPayload {
  const className = readString(args.class) ?? "Script";
  const scriptName = readString(args.name) ?? "unnamed";
  return {
    version: 2,
    inputSummary: clip(`${className} ${scriptName}`),
    outputSummary: summarizeText(output, "Script added."),
    blocks: [
      {
        type: "key_value",
        title: "Studio script add",
        items: [
          { key: "class", value: className },
          { key: "name", value: scriptName },
          { key: "parent", value: readString(args.parentGuid) ?? "" },
        ].filter((item) => item.value.length > 0),
      },
      { type: "summary", text: firstLine(output, "Script added."), tone: "success" },
    ],
  };
}

export function buildDeleteRender(title: string, targetGuid: string, output: string): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: clip(targetGuid || title),
    outputSummary: summarizeText(output, "Deleted."),
    blocks: [
      { type: "key_value", title, items: [{ key: "targetGuid", value: targetGuid }] },
      { type: "summary", text: firstLine(output, "Deleted."), tone: "warning" },
    ],
  };
}

export function buildInstanceAddRender(args: Record<string, unknown>, output: string): ToolRenderPayload {
  const className = readString(args.class) ?? "Instance";
  const instanceName = readString(args.name) ?? "unnamed";
  return {
    version: 2,
    inputSummary: clip(`${className} ${instanceName}`),
    outputSummary: summarizeText(output, "Instance added."),
    blocks: [
      {
        type: "key_value",
        title: "Studio instance add",
        items: [
          { key: "class", value: className },
          { key: "name", value: instanceName },
          { key: "parent", value: readString(args.parentGuid) ?? "" },
        ].filter((item) => item.value.length > 0),
      },
      { type: "summary", text: firstLine(output, "Instance added."), tone: "success" },
    ],
  };
}

export function buildGamePlayRender(args: Record<string, unknown>, output: string): ToolRenderPayload {
  const count = typeof args.numberOfPlayer === "number" ? String(args.numberOfPlayer) : "1";
  return {
    version: 2,
    inputSummary: `players: ${count}`,
    outputSummary: summarizeText(output, "Game started."),
    blocks: [
      { type: "key_value", title: "Studio play", items: [{ key: "players", value: count }] },
      { type: "summary", text: firstLine(output, "Game started."), tone: "success" },
    ],
  };
}

export function buildGameStopRender(output: string): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: "stop game",
    outputSummary: summarizeText(output, "Game stopped."),
    blocks: [{ type: "summary", text: firstLine(output, "Game stopped."), tone: "warning" }],
  };
}

export function buildAssetDrawerImportRender(args: Record<string, unknown>, output: string): ToolRenderPayload {
  const assetId = readString(args.assetid) ?? "";
  const assetName = readString(args.assetName) ?? "unnamed";
  const assetType = readString(args.assetType) ?? "MODEL";
  return {
    version: 2,
    inputSummary: clip(`${assetType} ${assetName}`),
    outputSummary: summarizeText(output, "Asset imported."),
    blocks: [
      {
        type: "key_value",
        title: "Asset Drawer import",
        items: [
          { key: "assetName", value: assetName },
          { key: "assetType", value: assetType },
          { key: "assetid", value: assetId },
        ].filter((item) => item.value.length > 0),
      },
      { type: "summary", text: firstLine(output, "Asset imported."), tone: "success" },
    ],
  };
}

export function buildAssetManagerImageImportRender(
  result: unknown,
  args: Record<string, unknown>,
  output: string,
): ToolRenderPayload {
  const file = readString(args.file) ?? "";
  const asset = isRecord(result) && isRecord(result.asset) ? result.asset : undefined;
  const returnedAssetId = asset ? readString(asset.assetid) : undefined;
  const returnedFile = asset ? readString(asset.file) : undefined;
  return {
    version: 2,
    inputSummary: clip(file || "image file"),
    outputSummary: summarizeText(output, returnedAssetId ? `Imported as ${returnedAssetId}` : "Image imported."),
    blocks: [
      {
        type: "key_value",
        title: "Asset manager image import",
        items: [
          { key: "file", value: returnedFile ?? file },
          { key: "assetid", value: returnedAssetId ?? "" },
        ].filter((item) => item.value.length > 0),
      },
      {
        type: "summary",
        text: firstLine(output, returnedAssetId ? `Imported as ${returnedAssetId}` : "Image imported."),
        tone: "success",
      },
    ],
  };
}

export function buildLevelSaveFileRender(output: string): ToolRenderPayload {
  return {
    version: 2,
    inputSummary: "save current world",
    outputSummary: summarizeText(output, "World file saved."),
    blocks: [{ type: "summary", text: firstLine(output, "World file saved."), tone: "success" }],
  };
}

export function buildActionSequencerApplyJsonRender(args: Record<string, unknown>, output: string): ToolRenderPayload {
  const instanceGuid = readString(args.instanceGuid) ?? "";
  const jsonFilePath = readString(args.jsonFilePath) ?? "";
  return {
    version: 2,
    inputSummary: clip(jsonFilePath || instanceGuid || "apply sequencer json"),
    outputSummary: summarizeText(output, "Sequencer JSON applied."),
    blocks: [
      {
        type: "key_value",
        title: "Action sequencer apply JSON",
        items: [
          { key: "instanceGuid", value: instanceGuid },
          { key: "jsonFilePath", value: jsonFilePath },
        ].filter((item) => item.value.length > 0),
      },
      { type: "summary", text: firstLine(output, "Sequencer JSON applied."), tone: "success" },
    ],
  };
}
