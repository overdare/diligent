// @summary Real source-file consumption, retry deduplication, input bounds and refresh lifecycle
import { afterEach, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStudioChangeSourceIo,
  StudioChangeCollector,
} from "../../../src/tools/studiorpc/tools/studio-change-collector";

const dirs: string[] = [];
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-collector-"));
  dirs.push(dir);
  return dir;
};
const a = { sessionId: "A", rootSessionId: "A", resumed: false };
const b = { sessionId: "B", rootSessionId: "B", resumed: false };

for (const encoding of ["utf8", "utf16le"] as const) {
  test(`an open ${encoding} writer can supply its first transaction after a poll`, async () => {
    const cwd = project();
    const fd = openSync(join(cwd, "Edit.Log"), "w");
    const collector = new StudioChangeCollector(cwd);
    try {
      if (encoding === "utf16le") writeSync(fd, Buffer.from([0xff, 0xfe]));
      await collector.refresh();
      expect(readdirSync(cwd).some((name) => name.startsWith("Edit.Log"))).toBe(true);
      writeSync(fd, Buffer.from(text("first"), encoding));
      await collector.refresh();
      expect(collector.store.read(a).envelopes.map((entry) => entry.objects[0].guid)).toEqual(["first"]);
      await collector.refresh();
      expect(collector.store.read(b).envelopes).toHaveLength(1);
    } finally {
      closeSync(fd);
      await collector.stop();
    }
  });
}

for (const operation of ["read", "remove"] as const) {
  test(`persistent ${operation} failures cannot starve newer sources or duplicate collected prefixes`, async () => {
    const cwd = project();
    const older = join(cwd, "Edit.Log.aaa-0.consuming");
    writeFileSync(older, text("older"));
    const io = createStudioChangeSourceIo(cwd, 1024);
    const collector = new StudioChangeCollector(cwd, {
      limits: { maxFilesPerPoll: 1 },
      io: {
        ...io,
        async read(path) {
          if (operation === "read" && path === older) throw new Error("persistent failure");
          return io.read(path);
        },
        async remove(path) {
          if (operation === "remove" && path === older) throw new Error("persistent failure");
          return io.remove(path);
        },
      },
    });
    try {
      await collector.refresh();
      writeFileSync(join(cwd, "Edit.Log"), text("newer"));
      for (let index = 0; index < 4; index++) await collector.refresh();
      const guids = collector.store.read(a).envelopes.map((entry) => entry.objects[0].guid);
      expect(guids).toEqual(operation === "remove" ? ["older", "newer"] : ["newer"]);
      expect(existsSync(older)).toBe(true);
    } finally {
      await collector.stop();
    }
  });
}
const text = (guid: string) =>
  JSON.stringify({
    Timestamp: "now",
    ActorGuids: [guid],
    Objects: [
      {
        ActorGuid: guid,
        Name: guid,
        InstanceType: "Part",
        Changes: [{ Property: "Name", Before: "old", After: guid }],
      },
    ],
  });
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("one ingestion removes only recognized sources and A/B retain independent reads", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), text("external"));
  writeFileSync(join(cwd, "notes.consuming"), "keep");
  writeFileSync(join(cwd, "Play.log"), "keep");
  const collector = new StudioChangeCollector(cwd);
  await collector.refresh();
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(false);
  collector.store.read(a).acknowledge();
  expect(collector.store.read(b).envelopes[0].objects[0].guid).toBe("external");
  expect(readdirSync(cwd).sort()).toEqual(["Play.log", "notes.consuming"]);
  symlinkSync(join(cwd, "Play.log"), join(cwd, "Edit.Log"));
  await collector.refresh();
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
  expect(existsSync(join(cwd, "Play.log"))).toBe(true);
  await collector.stop();
});

for (const encoding of ["utf8", "utf16le"] as const) {
  test(`an open rotated ${encoding} writer finishes a tail without losing or duplicating the prefix`, async () => {
    const cwd = project();
    const first = text("first");
    const second = text("second");
    const cut = Math.floor(second.length / 2);
    const fd = openSync(join(cwd, "Edit.Log"), "w");
    const collector = new StudioChangeCollector(cwd);
    try {
      const prefix = Buffer.from(first + second.slice(0, cut), encoding);
      writeSync(fd, encoding === "utf16le" ? Buffer.concat([Buffer.from([0xff, 0xfe]), prefix]) : prefix);
      await collector.refresh();
      expect(collector.store.read(a).envelopes).toHaveLength(1);
      expect(readdirSync(cwd).some((name) => name.endsWith(".consuming"))).toBe(true);
      writeSync(fd, Buffer.from(second.slice(cut), encoding));
      await collector.refresh();
      expect(collector.store.read(b).envelopes.map((e) => e.objects[0].guid)).toEqual(["first", "second"]);
      expect(readdirSync(cwd)).toEqual([]);
    } finally {
      closeSync(fd);
      await collector.stop();
    }
  });
}

test("delete failure retries removal without ingesting the same source twice", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), text("one"));
  const real = createStudioChangeSourceIo(cwd, 8 * 1024 * 1024);
  let failures = 1;
  const collector = new StudioChangeCollector(cwd, {
    io: {
      ...real,
      async remove(path) {
        if (failures-- > 0) throw new Error("locked");
        await real.remove(path);
      },
    },
  });
  await collector.refresh();
  await collector.refresh();
  expect(collector.store.read(b).envelopes).toHaveLength(1);
  expect(readdirSync(cwd)).toEqual([]);
  await collector.stop();
});

test("read failures preserve input and input/backlog bounds discard only with a visible gap", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), text("one"));
  const real = createStudioChangeSourceIo(cwd, 1024);
  let fail = true;
  const collector = new StudioChangeCollector(cwd, {
    io: {
      ...real,
      async read(path) {
        if (fail) {
          fail = false;
          throw new Error("unreadable");
        }
        return real.read(path);
      },
    },
  });
  await collector.refresh();
  expect(readdirSync(cwd).some((name) => name.endsWith(".consuming"))).toBe(true);
  expect(collector.store.read(a).gaps.join(" ")).toContain("unreadable");
  await collector.refresh();
  expect(collector.store.read(b).envelopes).toHaveLength(1);
  await collector.stop();
  writeFileSync(join(cwd, "Edit.Log"), "x".repeat(64));
  const bounded = new StudioChangeCollector(cwd, { limits: { maxFileBytes: 8, maxBacklogBytes: 16 } });
  await bounded.refresh();
  expect(bounded.store.read(a).gaps.join(" ")).toMatch(/limit|oversized|backlog/i);
  expect(readdirSync(cwd)).toEqual([]);
  await bounded.stop();
});

test("malformed balanced input records a gap and is removed after ingestion", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), `${text("good")}{"broken":}`);
  const collector = new StudioChangeCollector(cwd);
  await collector.refresh();
  expect(collector.store.read(a).envelopes).toHaveLength(1);
  expect(collector.store.read(a).gaps.join(" ")).toMatch(/malformed/i);
  expect(readdirSync(cwd)).toEqual([]);
  await collector.stop();
});

test("concurrent explicit refreshes coalesce and shutdown awaits ingestion", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), text("one"));
  const real = createStudioChangeSourceIo(cwd, 1024);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  const collector = new StudioChangeCollector(cwd, {
    io: {
      ...real,
      async read(path) {
        active++;
        peak = Math.max(peak, active);
        entered();
        await held;
        const result = await real.read(path);
        active--;
        return result;
      },
    },
  });
  const first = collector.refresh();
  await started;
  expect(collector.refresh()).toBe(first);
  expect(collector.refresh()).toBe(first);
  const stopped = collector.stop();
  release();
  await stopped;
  expect(peak).toBe(1);
  writeFileSync(join(cwd, "Edit.Log"), text("after-stop"));
  await collector.refresh();
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(true);
});

test("unchanged incomplete files do not starve later finalized records", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log.aaa-0.consuming"), '{"Timestamp":');
  const collector = new StudioChangeCollector(cwd, { limits: { maxFilesPerPoll: 1 } });
  await collector.refresh();
  writeFileSync(join(cwd, "Edit.Log"), text("later"));
  await collector.refresh();
  expect(collector.store.read(a).envelopes.map((e) => e.objects[0].guid)).toEqual(["later"]);
  expect(existsSync(join(cwd, "Edit.Log.aaa-0.consuming"))).toBe(true);
  await collector.stop();
});
