import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path, { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { z } from "zod"
import { loadOverdareConfig } from "./config.ts"

const execFileAsync = promisify(execFile)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findLuaFiles(dirPath: string): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await findLuaFiles(fullPath)))
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".lua") || entry.name.endsWith(".luau"))
    ) {
      results.push(fullPath)
    }
  }
  return results
}

async function ensureSetupFiles(dir: string): Promise<string> {
  const luaurcPath = join(dir, ".luaurc")
  if (!existsSync(luaurcPath)) {
    await writeFile(
      luaurcPath,
      JSON.stringify({ languageMode: "strict" }, null, 2),
      "utf-8",
    )
  }

  const sourcemapPath = join(dir, "sourcemap.temp.json")
  if (!existsSync(sourcemapPath)) {
    await writeFile(
      sourcemapPath,
      JSON.stringify(
        { name: "THIS_IS_TEMPORAL_SOURCEMAP", className: "DataModel" },
        null,
        2,
      ),
      "utf-8",
    )
  }

  return sourcemapPath
}

async function removeBOM(filePath: string): Promise<void> {
  const buf = await readFile(filePath)
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    await writeFile(filePath, buf.subarray(3))
  }
}

function filterOutput(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.includes("[INFO]") && !line.includes("'Instance'"))
    .join("\n")
    .trim()
}

// ── Plugin directory resolution ───────────────────────────────────────────────

/**
 * Resolve the plugin's own root directory.
 *
 * - Compiled (index.js at plugin root): dirname(import.meta.url) = plugin root
 * - Dev source (src/validatelua.ts):    dirname(import.meta.url) = src/ → go up one level
 */
function getPluginDir(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(dir) === "src" ? path.dirname(dir) : dir
}

// ── Config resolution ─────────────────────────────────────────────────────────

/**
 * Resolve luau-lsp binary path.
 *
 * Priority:
 *   1. LUAU_LSP_PATH env var
 *   2. config.luauLspPath  (~/.diligent/@overdare.jsonc)
 *   3. <pluginDir>/luaulsp[.exe]  (bundled alongside plugin)
 *   4. "luau-lsp" (PATH lookup)
 */
function resolveLuauLspPath(): string {
  if (process.env.LUAU_LSP_PATH) return process.env.LUAU_LSP_PATH

  const cfg = loadOverdareConfig()
  if (cfg.luauLspPath) return cfg.luauLspPath

  const bin = process.platform === "win32" ? "luau-lsp.exe" : "luau-lsp"
  const bundled = join(getPluginDir(), bin)
  return existsSync(bundled) ? bundled : "luau-lsp"
}

/**
 * Resolve OVERDARE type definitions path.
 *
 * Priority:
 *   1. OVERDARE_TYPES_PATH env var
 *   2. config.typesPath  (~/.diligent/@overdare.jsonc)
 *   3. <pluginDir>/overdare-types.d.lua  (bundled alongside plugin)
 *   4. undefined (run without types)
 */
function resolveTypesPath(): string | undefined {
  if (process.env.OVERDARE_TYPES_PATH) return process.env.OVERDARE_TYPES_PATH

  const cfg = loadOverdareConfig()
  if (cfg.typesPath) return cfg.typesPath

  const bundled = join(getPluginDir(), "overdare-types.d.lua")
  return existsSync(bundled) ? bundled : undefined
}

// ── Exported tool shape ───────────────────────────────────────────────────────

export const name = "validatelua"

export const description = `Validates Luau script code for type errors and lint warnings using luau-lsp analyze. Call this tool to ensure code quality.

Takes a \`filePath\` parameter containing either:
- A path to a single Luau file (.lua / .luau)
- A path to a folder — all *.lua / *.luau files inside (recursively) will be validated

If the Lua file does not exist, use the studiorpc_script_add tool to generate it under ./Lua/ first.

Returns the luau-lsp analyze output. For folders, results are grouped per file with a summary at the end.
If no issues are found, returns "No issues found. Code is valid." (single file) or "[OK] filename" per file.

Configuration (environment variables):
  - LUAU_LSP_PATH: path to luau-lsp binary (default: bundled sidecar or PATH)
  - OVERDARE_TYPES_PATH: path to overdare-types.d.lua type definitions`

export const parameters = z.object({
  filePath: z
    .string()
    .describe("Path to a Luau file or a folder containing Luau files to validate"),
})

type Params = z.infer<typeof parameters>

interface ToolContext {
  toolCallId: string
  signal: AbortSignal
  approve: (req: {
    permission: "read" | "write" | "execute"
    toolName: string
    description: string
    details?: Record<string, unknown>
  }) => Promise<"once" | "always" | "reject">
}

interface ToolResult {
  output: string
  metadata?: Record<string, unknown>
}

export async function execute(args: Params, ctx: ToolContext): Promise<ToolResult> {
  const approval = await ctx.approve({
    permission: "execute",
    toolName: name,
    description: `Validate Luau: ${args.filePath}`,
    details: { filePath: args.filePath },
  })
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } }
  }

  const luauLspPath = resolveLuauLspPath()
  const typesPath = resolveTypesPath()

  // Verify luau-lsp is available
  try {
    await execFileAsync(luauLspPath, ["--version"])
  } catch {
    throw new Error(
      `luau-lsp not found at: ${luauLspPath}\n` +
        `Set the LUAU_LSP_PATH environment variable or install luau-lsp.\n` +
        `Download: https://github.com/JohnnyMorganz/luau-lsp/releases`,
    )
  }

  // Verify type definitions if provided
  if (typesPath) {
    try {
      await access(typesPath)
    } catch {
      throw new Error(
        `Type definitions file not found: ${typesPath}\n` +
          `Set the OVERDARE_TYPES_PATH environment variable to the correct path.`,
      )
    }
  }

  // Verify target path exists
  try {
    await access(args.filePath)
  } catch {
    throw new Error(`Path not found: ${args.filePath}`)
  }

  const targetStat = await stat(args.filePath)
  const isDirectory = targetStat.isDirectory()

  let luaFiles: string[]
  let rootDir: string

  if (isDirectory) {
    luaFiles = await findLuaFiles(args.filePath)
    rootDir = args.filePath
    if (luaFiles.length === 0) {
      return {
        output: "No .lua / .luau files found in the specified directory.",
        metadata: { fileCount: 0, issueCount: 0 },
      }
    }
  } else {
    luaFiles = [args.filePath]
    rootDir = path.dirname(args.filePath)
  }

  // Strip BOM from all files before analysis
  for (const file of luaFiles) {
    await removeBOM(file)
  }

  // Ensure .luaurc and sourcemap.temp.json exist in root dir
  const sourcemapPath = await ensureSetupFiles(rootDir)

  // Build luau-lsp analyze arguments
  const analyzeArgs = ["analyze", "--sourcemap", sourcemapPath]
  if (typesPath) {
    analyzeArgs.push("--definitions", typesPath)
  }
  analyzeArgs.push(...luaFiles)

  // Run analysis (non-zero exit = issues found, we catch and use the output)
  const { stdout, stderr } = await execFileAsync(luauLspPath, analyzeArgs).catch(
    (error: { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    }),
  )

  const rawOutput = filterOutput([stdout, stderr].filter(Boolean).join("\n"))

  // ── Single file ──────────────────────────────────────────────────────────────
  if (!isDirectory || luaFiles.length === 1) {
    return {
      output: rawOutput || "No issues found. Code is valid.",
      metadata: { fileCount: 1, issueCount: rawOutput ? 1 : 0 },
    }
  }

  // ── Multi-file: group output lines per file ──────────────────────────────────
  const fileIssues = new Map<string, string[]>()
  for (const file of luaFiles) {
    fileIssues.set(file, [])
  }

  for (const line of rawOutput.split("\n")) {
    if (!line.trim()) continue
    for (const file of luaFiles) {
      if (line.startsWith(file + "(") || line.startsWith(file + ":")) {
        fileIssues.get(file)!.push(line)
        break
      }
    }
  }

  let totalIssues = 0
  const sections: string[] = []

  for (const file of luaFiles) {
    const issues = fileIssues.get(file)!
    const relPath = path.relative(rootDir, file)
    if (issues.length === 0) {
      sections.push(`[OK] ${relPath}`)
    } else {
      totalIssues += issues.length
      sections.push(`[${issues.length} issue(s)] ${relPath}\n${issues.join("\n")}`)
    }
  }

  sections.push(
    `\n--- ${luaFiles.length} file(s) checked, ${totalIssues} issue(s) found ---`,
  )

  return {
    output: sections.join("\n\n"),
    metadata: { fileCount: luaFiles.length, issueCount: totalIssues },
  }
}
