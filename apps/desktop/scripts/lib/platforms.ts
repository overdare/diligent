// @summary Platform target definitions for packaging pipeline

export interface PlatformTarget {
  id: string; // e.g. "darwin-arm64"
  bunTarget: string; // e.g. "bun-darwin-arm64"
  tauriTriple: string; // e.g. "aarch64-apple-darwin"
  ext: string; // ".exe" for windows, "" otherwise
  os: "darwin" | "linux" | "windows";
  arch: "arm64" | "x64";
  desktopBundleTypes: ("app" | "dmg" | "AppImage" | "deb" | "msi")[]; // [] for macOS (bin only), ["AppImage", "deb"] for linux, ["msi"] for windows
}

export const ALL_PLATFORMS: PlatformTarget[] = [
  {
    id: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    tauriTriple: "aarch64-apple-darwin",
    ext: "",
    os: "darwin",
    arch: "arm64",
    desktopBundleTypes: [],
  },
  {
    id: "darwin-x64",
    bunTarget: "bun-darwin-x64",
    tauriTriple: "x86_64-apple-darwin",
    ext: "",
    os: "darwin",
    arch: "x64",
    desktopBundleTypes: [],
  },
  {
    id: "linux-x64",
    bunTarget: "bun-linux-x64",
    tauriTriple: "x86_64-unknown-linux-gnu",
    ext: "",
    os: "linux",
    arch: "x64",
    desktopBundleTypes: ["AppImage", "deb"],
  },
  {
    id: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    tauriTriple: "aarch64-unknown-linux-gnu",
    ext: "",
    os: "linux",
    arch: "arm64",
    desktopBundleTypes: ["AppImage", "deb"],
  },
  {
    id: "windows-x64",
    bunTarget: "bun-windows-x64",
    tauriTriple: "x86_64-pc-windows-msvc",
    ext: ".exe",
    os: "windows",
    arch: "x64",
    desktopBundleTypes: ["msi"],
  },
];

export function filterPlatforms(ids: string[]): PlatformTarget[] {
  const unknown = ids.filter((id) => !ALL_PLATFORMS.find((p) => p.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown platform(s): ${unknown.join(", ")}`);
    console.error(`Valid platforms: ${ALL_PLATFORMS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }
  return ALL_PLATFORMS.filter((p) => ids.includes(p.id));
}
