// @summary Language server catalog: built-in defaults merged with global config, PATH/PATHEXT command resolution, root lookup
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, delimiter as posixDelimiter, relative, resolve } from "node:path";
import type { LspConfig, LspServerConfig } from "../../config/schema";

export type PostEditDiagnosticsMode = NonNullable<LspConfig["postEditDiagnostics"]>;

/** A configured server whose command resolved to an executable. */
export interface LspServerSpec {
  name: string;
  /** Absolute path of the resolved executable. */
  command: string;
  args: string[];
  fileTypes: string[];
  rootMarkers: string[];
  initOptions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface UnavailableLspServer {
  name: string;
  reason: string;
}

export interface LspServerCatalog {
  servers: LspServerSpec[];
  unavailable: UnavailableLspServer[];
}

type ServerDefinition = Omit<LspServerSpec, "name">;

/** Used only when the command resolves on PATH. No server is ever installed. */
export const DEFAULT_LSP_SERVERS: Readonly<Record<string, ServerDefinition>> = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    fileTypes: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
  },
  pyright: {
    command: "pyright-langserver",
    args: ["--stdio"],
    fileTypes: [".py", ".pyi"],
    rootMarkers: ["pyrightconfig.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
  },
  "rust-analyzer": {
    command: "rust-analyzer",
    args: [],
    fileTypes: [".rs"],
    rootMarkers: ["Cargo.toml"],
  },
  gopls: {
    command: "gopls",
    args: [],
    fileTypes: [".go"],
    rootMarkers: ["go.work", "go.mod"],
  },
  clangd: {
    command: "clangd",
    args: [],
    fileTypes: [".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".m", ".mm"],
    rootMarkers: ["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt"],
  },
  luau: {
    command: "luau-lsp",
    args: ["lsp"],
    fileTypes: [".luau", ".lua"],
    rootMarkers: [".luaurc"],
  },
};

export type CommandLookupEnv = Record<string, string | undefined>;

/**
 * Resolve `command` to an executable: a path is checked as given, a bare name is searched on PATH. On Windows a name
 * without a PATHEXT extension also tries each PATHEXT extension, so npm `.cmd` shims resolve.
 */
export function resolveCommand(
  command: string,
  env: CommandLookupEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const windows = platform === "win32";
  const extensions = windows ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  const hasKnownExtension = extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
  const candidatesFor = (base: string) =>
    windows && !hasKnownExtension ? [base, ...extensions.map((ext) => base + ext)] : [base];

  if (command.includes("/") || (windows && command.includes("\\"))) {
    return candidatesFor(command).find((candidate) => isExecutable(candidate, windows));
  }
  const dirs = (env.PATH ?? "").split(windows ? ";" : posixDelimiter).filter(Boolean);
  for (const dir of dirs) {
    const found = candidatesFor(join(dir, command)).find((candidate) => isExecutable(candidate, windows));
    if (found) return found;
  }
  return undefined;
}

function isExecutable(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!windows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Built-in defaults overlaid with configured servers: an entry named like a default overrides only the fields it
 * sets. Disabled entries are dropped; entries whose command does not resolve are reported as unavailable.
 */
export function resolveLspServers(
  configured: Record<string, LspServerConfig> | undefined,
  lookup: (command: string) => string | undefined = (command) => resolveCommand(command),
): LspServerCatalog {
  const servers: LspServerSpec[] = [];
  const unavailable: UnavailableLspServer[] = [];
  const names = [...new Set([...Object.keys(DEFAULT_LSP_SERVERS), ...Object.keys(configured ?? {})])];
  for (const name of names) {
    const base = DEFAULT_LSP_SERVERS[name];
    const override = configured?.[name];
    if (override?.enabled === false) continue;
    const command = override?.command ?? base?.command;
    const fileTypes = override?.fileTypes ?? base?.fileTypes;
    if (!command || !fileTypes?.length) {
      unavailable.push({ name, reason: "needs `command` and `fileTypes`" });
      continue;
    }
    const resolved = lookup(command);
    if (!resolved) {
      unavailable.push({ name, reason: `\`${command}\` not found on PATH` });
      continue;
    }
    const initOptions = override?.initOptions ?? base?.initOptions;
    const settings = override?.settings ?? base?.settings;
    servers.push({
      name,
      command: resolved,
      args: override?.args ?? base?.args ?? [],
      fileTypes: fileTypes.map((type) => type.toLowerCase()),
      rootMarkers: override?.rootMarkers ?? base?.rootMarkers ?? [],
      ...(initOptions ? { initOptions } : {}),
      ...(settings ? { settings } : {}),
    });
  }
  return { servers, unavailable };
}

export function serverForFile(servers: readonly LspServerSpec[], filePath: string): LspServerSpec | undefined {
  const ext = extname(filePath).toLowerCase();
  return ext ? servers.find((server) => server.fileTypes.includes(ext)) : undefined;
}

/**
 * Nearest ancestor of `filePath` containing one of `rootMarkers`. The search stops at `cwd` when the file is inside
 * it, falling back to `cwd`; for a file outside `cwd` it stops at the filesystem root, falling back to the file's
 * directory.
 */
export function findServerRoot(filePath: string, rootMarkers: readonly string[], cwd: string): string {
  const boundary = resolve(cwd);
  const start = dirname(resolve(filePath));
  const rel = relative(boundary, start);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  let dir = start;
  while (true) {
    if (rootMarkers.some((marker) => existsSync(join(dir, marker)))) return dir;
    if (inside && dir === boundary) return boundary;
    const parent = dirname(dir);
    if (parent === dir) return inside ? boundary : start;
    dir = parent;
  }
}

const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".luau": "luau",
  ".lua": "lua",
};

export function languageIdFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return LANGUAGE_IDS[ext] ?? ext.slice(1);
}
