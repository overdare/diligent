// @summary Origin-checked, project-scoped last-view persistence independent of sidecar ports.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isStudioView, type StudioView } from "../web/shared/studio-view";
import { productStorageRoot } from "./launch";

export function createStudioViewState(options: {
  cwd: string;
  storageRoot?: string;
  webOrigin: string;
  developmentOrigin?: string;
}) {
  const cwd = resolve(options.cwd);
  const key = createHash("sha256")
    .update(process.platform === "win32" ? cwd.toLowerCase() : cwd)
    .digest("hex");
  const file = join(options.storageRoot ?? productStorageRoot(), "ui", "projects", key, "view.json");
  const origins = new Set([options.webOrigin, ...(options.developmentOrigin ? [options.developmentOrigin] : [])]);
  for (const origin of [...origins]) {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
      origins.add(url.origin);
    }
  }
  let writes = Promise.resolve();
  const read = async (): Promise<StudioView> => {
    await writes;
    try {
      const state = JSON.parse(await readFile(file, "utf8"));
      return isStudioView(state.view) ? state.view : "agent";
    } catch {
      return "agent";
    }
  };
  return {
    async handle(req: Request): Promise<Response> {
      const origin = req.headers.get("origin");
      if (
        !origins.has(new URL(req.url).origin) ||
        req.headers.get("sec-fetch-site") === "cross-site" ||
        (origin && !origins.has(origin))
      )
        return new Response("Forbidden", { status: 403 });
      const response = (view: StudioView) => Response.json({ view }, { headers: { "Cache-Control": "no-store" } });
      if (req.method === "GET") return response(await read());
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (!req.headers.get("content-type")?.startsWith("application/json"))
        return new Response("Forbidden", { status: 403 });
      let state: unknown;
      try {
        state = await req.json();
      } catch {
        return new Response("Invalid view", { status: 400 });
      }
      const view = (state as { view?: unknown } | null)?.view;
      if (!isStudioView(view)) return new Response("Invalid view", { status: 400 });
      const next = writes.then(async () => {
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify({ view }), { mode: 0o600 });
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
      });
      writes = next.catch(() => {});
      await next;
      return response(view);
    },
  };
}
