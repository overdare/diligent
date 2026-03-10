// @summary Cross-platform browser launcher for OAuth flows
import { spawn } from "node:child_process";

/** Open a URL in the default browser (macOS, Linux, Windows) */
export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    // cmd.exe treats & as a command separator — escape with ^ so start receives the full URL
    const escaped = url.replace(/&/g, "^&");
    spawn("cmd", ["/c", "start", "", escaped], { detached: true, stdio: "ignore" }).unref();
  } else {
    const cmd = platform === "darwin" ? "open" : "xdg-open";
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  }
}
