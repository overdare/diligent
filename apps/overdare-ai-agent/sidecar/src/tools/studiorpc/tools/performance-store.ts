// @summary Stores opaque capture jobs and post-capture raw artifacts in the project's resolved namespace.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePaths } from "@diligent/runtime";
import type { FrameRecord, LuaScopeRecord, Manifest, PerformanceReport, ProcessSample } from "./performance-types";

export class PerformanceStore {
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly cwd: string) {}

  paths(jobId: string) {
    if (!/^perf-[0-9a-f-]{36}$/.test(jobId)) throw new Error("JOB_NOT_FOUND: Invalid performance job ID");
    const directory = join(resolvePaths(this.cwd).root, "performance", jobId);
    return {
      manifest: join(directory, "manifest.json"),
      frames: join(directory, "frames.csv"),
      process: join(directory, "process.csv"),
      summary: join(directory, "summary.json"),
      luaScopes: join(directory, "lua-scopes.csv"),
    };
  }

  private async save(path: string, value: unknown) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const pending = (this.writes.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, content, "utf8");
        await rename(temporary, path);
      });
    this.writes.set(path, pending);
    try {
      await pending;
    } finally {
      if (this.writes.get(path) === pending) this.writes.delete(path);
    }
  }

  async writeManifest(manifest: Manifest) {
    const paths = this.paths(manifest.jobId);
    await mkdir(join(paths.manifest, ".."), { recursive: true });
    // Artifacts are machine-local even in projects without a namespace ignore rule.
    await writeFile(join(resolvePaths(this.cwd).root, "performance", ".gitignore"), "*\n", { flag: "wx" }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    await this.save(paths.manifest, manifest);
  }

  async readManifest(jobId: string): Promise<Manifest> {
    return JSON.parse(await readFile(this.paths(jobId).manifest, "utf8"));
  }

  async readReport(jobId: string): Promise<PerformanceReport | undefined> {
    try {
      return JSON.parse(await readFile(this.paths(jobId).summary, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async finish(
    manifest: Manifest,
    frames: FrameRecord[],
    samples: ProcessSample[],
    report: PerformanceReport,
    luaScopes: LuaScopeRecord[] = [],
  ) {
    const paths = this.paths(manifest.jobId);
    const csv = (rows: Record<string, unknown>[], columns: string[]) =>
      `${columns.join(",")}\n${rows
        .map((row) =>
          columns
            .map((key) => {
              const value = row[key];
              const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
              return `"${text.replaceAll('"', '""')}"`;
            })
            .join(","),
        )
        .join("\n")}\n`;
    await writeFile(
      paths.luaScopes,
      csv(
        luaScopes.map((sample) => ({ ...sample, label: manifest.manualScopes?.labels[sample.labelId] ?? "" })),
        ["labelId", "label", "frameId", "beginMonotonicNs", "endMonotonicNs", "elapsed_ms"],
      ),
    );
    await writeFile(
      paths.frames,
      csv(frames as unknown as Record<string, unknown>[], [
        "frameId",
        "beginMonotonicNs",
        "endMonotonicNs",
        "frame_ms",
        "lua_machine_ms",
        "slate_gt_ms",
        "validity",
      ]),
    );
    await writeFile(
      paths.process,
      csv(samples as unknown as Record<string, unknown>[], [
        "pid",
        "startTimeUtc",
        "role",
        "observedAtUtc",
        "monotonicMs",
        "intervalSeconds",
        "cpuSeconds",
        "usedCores",
        "cpuPct",
        "effectiveCpuCapacity",
        "residentBytes",
        "privateBytes",
        "status",
      ]),
    );
    await this.writeManifest(manifest);
    await this.save(paths.summary, report);
  }
}
