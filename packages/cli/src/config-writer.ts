// @summary Writes configuration changes to disk with JSONC support
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getGlobalConfigPath, saveGlobalModel } from "@diligent/runtime";
import { applyEdits, type Edit, format, modify } from "jsonc-parser";

const GLOBAL_CONFIG_PATH = join(homedir(), ".diligent", "config.jsonc");

/**
 * Save an API key to the global config file (~/.diligent/config.jsonc).
 * Uses jsonc-parser to preserve existing comments and formatting.
 */
export async function saveApiKey(
  provider: "anthropic" | "openai" | "gemini",
  apiKey: string,
  configPath: string = GLOBAL_CONFIG_PATH,
): Promise<void> {
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

  const path = ["provider", provider, "apiKey"];
  const edits: Edit[] = modify(content, path, apiKey, {
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

export { getGlobalConfigPath };

/**
 * Save the selected model to the global config file.
 * Delegates to the runtime implementation.
 */
export const saveModel = saveGlobalModel;
