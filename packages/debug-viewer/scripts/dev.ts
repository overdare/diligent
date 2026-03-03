// @summary Dev runner: starts backend server and Vite frontend concurrently
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");
const extraArgs = process.argv.slice(2);

const server = Bun.spawn(
  ["bun", "src/server/index.ts", "--dev", ...extraArgs],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);

const vite = Bun.spawn(["bunx", "vite"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

process.on("SIGINT", () => {
  server.kill();
  vite.kill();
  process.exit(0);
});

const [serverCode, viteCode] = await Promise.all([server.exited, vite.exited]);
process.exit(serverCode || viteCode);
