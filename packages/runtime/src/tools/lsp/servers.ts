// @summary Language server catalog: built-in defaults merged with config, project-local bin and PATH command resolution, TypeScript server selection, root lookup
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  delimiter as posixDelimiter,
  relative,
  resolve,
} from "node:path";
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

const TYPESCRIPT_FILE_TYPES = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const TYPESCRIPT_ROOT_MARKERS = ["tsconfig.json", "jsconfig.json", "package.json"];

/** Used only when the command resolves in a project bin directory or on PATH. No server is ever installed. */
export const DEFAULT_LSP_SERVERS: Readonly<Record<string, ServerDefinition>> = {
  // TypeScript up to 6: needs the project's `lib/tsserver.js`.
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    fileTypes: TYPESCRIPT_FILE_TYPES,
    rootMarkers: TYPESCRIPT_ROOT_MARKERS,
  },
  // TypeScript 7+: the native `tsc` is itself a language server and ships no `lib/tsserver.js`.
  "typescript-native": {
    command: "tsc",
    args: ["--lsp", "--stdio"],
    fileTypes: TYPESCRIPT_FILE_TYPES,
    rootMarkers: TYPESCRIPT_ROOT_MARKERS,
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

/** Project-local executable directories searched before PATH: npm bins and Python virtual environments. */
const PROJECT_BIN_DIRS = ["node_modules/.bin", ".venv/bin", ".venv/Scripts", "venv/bin", "venv/Scripts"];

/** Command lookup for a project: its existing bin directories under `cwd` first, then PATH. */
export function projectCommandLookup(
  cwd: string,
  env: CommandLookupEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): (command: string) => string | undefined {
  const local = PROJECT_BIN_DIRS.map((dir) => join(cwd, dir)).filter((dir) => existsSync(dir));
  const path = [...local, env.PATH ?? ""].filter(Boolean).join(platform === "win32" ? ";" : posixDelimiter);
  return (command) => resolveCommand(command, { ...env, PATH: path }, platform);
}

/**
 * Whether `tscPath` belongs to a TypeScript 7+ install: an npm `typescript` package without `lib/tsserver.js`.
 * Unknown layouts count as older, so `typescript-language-server` stays the choice.
 */
export function isNativeTsc(tscPath: string): boolean {
  const candidates = [join(dirname(tscPath), "..", "typescript")]; // node_modules/.bin/tsc and Windows shims
  try {
    const real = realpathSync(tscPath);
    if (basename(dirname(real)) === "bin") candidates.unshift(dirname(dirname(real))); // <pkg>/bin/tsc
  } catch {
    return false;
  }
  const pkg = candidates.find((dir) => existsSync(join(dir, "package.json")));
  return pkg !== undefined && !existsSync(join(pkg, "lib", "tsserver.js"));
}

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
 * sets. Disabled entries are dropped; entries whose command does not resolve are reported as unavailable. Of the two
 * TypeScript servers only one is kept: `typescript-native` when its `tsc` is TypeScript 7+, else `typescript`.
 */
export function resolveLspServers(
  configured: Record<string, LspServerConfig> | undefined,
  lookup: (command: string) => string | undefined = (command) => resolveCommand(command),
  nativeTsc: (tscPath: string) => boolean = isNativeTsc,
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
      unavailable.push({ name, reason: `\`${command}\` not found in project bin directories or on PATH` });
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
  return selectTypescriptServer({ servers, unavailable }, nativeTsc);
}

function selectTypescriptServer(catalog: LspServerCatalog, nativeTsc: (tscPath: string) => boolean): LspServerCatalog {
  const native = catalog.servers.find((server) => server.name === "typescript-native");
  if (!native) return catalog;
  const useNative = nativeTsc(native.command);
  const dropped = useNative ? "typescript" : "typescript-native";
  const reason = useNative
    ? "TypeScript 7+ project: typescript-native is used instead"
    : "`tsc` is not TypeScript 7+; typescript-language-server is needed";
  const keep = catalog.servers.filter((server) => server.name !== dropped);
  const unavailable = catalog.unavailable.filter((server) => server.name !== dropped);
  return { servers: keep, unavailable: [...unavailable, { name: dropped, reason }] };
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
