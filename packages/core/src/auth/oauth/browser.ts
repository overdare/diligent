// @summary Cross-platform browser launcher for OAuth flows
import { spawn } from "node:child_process";

/** Open a URL in the default browser (macOS, Linux, Windows) */
export function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
