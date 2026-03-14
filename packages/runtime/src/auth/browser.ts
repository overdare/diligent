// @summary Cross-platform browser launcher for interactive OAuth flows
import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    const escaped = url.replace(/&/g, "^&");
    spawn("cmd", ["/c", "start", "", escaped], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  const cmd = platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}
