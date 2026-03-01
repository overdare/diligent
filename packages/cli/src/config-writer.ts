// @summary Writes configuration changes to disk with JSONC support
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applyEdits, type Edit, format, modify } from "jsonc-parser";

const GLOBAL_CONFIG_PATH = join(homedir(), ".config", "diligent", "diligent.jsonc");

/**
 * Save an API key to the global config file (~/.config/diligent/diligent.jsonc).
 * Uses jsonc-parser to preserve existing comments and formatting.
 */
export async function saveApiKey(
  provider: "anthropic" | "openai" | "gemini",
  apiKey: string,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<void> {
  // Ensure directory exists
  await mkdir(dirname(configPath), { recursive: true });

  // Read existing content or start with empty object
  let content = "{}";
  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      content = await file.text();
    }
  } catch {
    // File doesn't exist, use default
  }

  // Apply modification using jsonc-parser
  const path = ["provider", provider, "apiKey"];
  const edits: Edit[] = modify(content, path, apiKey, {
    formattingOptions: {
      tabSize: 2,
      insertSpaces: true,
      eol: "\n",
    },
  });

  const updated = applyEdits(content, edits);

  // Format if it was a fresh file
  if (content === "{}") {
    const formatEdits = format(updated, undefined, {
      tabSize: 2,
      insertSpaces: true,
      eol: "\n",
    });
    const formatted = applyEdits(updated, formatEdits);
    await Bun.write(configPath, formatted);
  } else {
    await Bun.write(configPath, updated);
  }
}

/**
 * Save the selected model to the global config file.
 * Uses jsonc-parser to preserve existing comments and formatting.
 */
export async function saveModel(modelId: string, configPath: string = GLOBAL_CONFIG_PATH): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });

  let content = "{}";
  try {
    const file = Bun.file(configPath);
    if (await file.exists()) {
      content = await file.text();
    }
  } catch {
    // File doesn't exist, use default
  }

  const edits: Edit[] = modify(content, ["model"], modelId, {
    formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" },
  });
  const updated = applyEdits(content, edits);

  if (content === "{}") {
    const formatEdits = format(updated, undefined, { tabSize: 2, insertSpaces: true, eol: "\n" });
    await Bun.write(configPath, applyEdits(updated, formatEdits));
  } else {
    await Bun.write(configPath, updated);
  }
}

/** Get the global config file path */
export function getGlobalConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}
