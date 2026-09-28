// @summary Tests EditLogging consumption, summarization, and studio-changes context injection.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../src/tools/studiorpc";
import {
  rotateAndReadEditLogs,
  SECTION_TITLES,
  STUDIO_CHANGES_LIMITS,
  summarizeEditLog,
} from "../../src/tools/studiorpc/tools/edit-log";
import { consumeStudioChanges, createStudioChangesTool } from "../../src/tools/studiorpc/tools/studio-changes-tool";
import { COUNT_SECTIONS } from "../../src/web/client/components/StudioChangesNotice";
import { bindStudioTestSession } from "../helpers/studio-session";

const NO_EDITS = "No Studio changes recorded in the collected edit log.";

function projectDir(): string {
  const cwd = mkdtempSync(join(tmpdir(), "proj-"));
  writeFileSync(join(cwd, "world.umap"), "umap");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{}}');
  return cwd;
}

/**
 * Write the log the way Studio actually does: a single `Edit.Log` in the project
 * root, CRLF, tab-indented objects concatenated back to back — no separator, no
 * array, not JSONL. Fixtures that drift from this shape stop testing anything real.
 */
function writeEditLog(cwd: string, envelopes: unknown[], file = "Edit.Log"): void {
  const text = envelopes.map((envelope) => JSON.stringify(envelope, null, "\t")).join("\n");
  writeFileSync(join(cwd, file), text.replace(/\n/g, "\r\n"));
}

/** Envelope keys are PascalCase, and `ActorGuids` alone marks the transaction's subjects. */
function envelope(
  action: string,
  objects: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const subjects = objects.map((object) => object.ActorGuid).filter((guid): guid is string => typeof guid === "string");
  return {
    Timestamp: "2026-08-27T00:00:00.000Z",
    TransactionId: "7C20523D489A46F9D55A4384881357DD",
    Action: action,
    ActorGuids: subjects,
    Objects: objects,
    ...extra,
  };
}

/** Real logs carry no per-object `action` or `role`; the envelope decides both. */
function subject(
  type: string,
  guid: string,
  name: string,
  changes: unknown[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { InstanceType: type, ActorGuid: guid, Name: name, Changes: changes, ...extra };
}

/** Log-related entries in the project root; the root also holds .umap/.ovdrjm. */
function logFiles(cwd: string): string[] {
  return readdirSync(cwd).filter((name) => name.toLowerCase().startsWith("edit.log"));
}

/** An object present in the envelope but not among its ActorGuids — collateral, not intent. */
function collateral(type: string, guid: string, name: string, changes: unknown[] = []): Record<string, unknown> {
  return { InstanceType: type, ActorGuid: guid, Name: name, Changes: changes };
}

function toolCtx() {
  return {
    toolCallId: "t",
    signal: new AbortController().signal,
    abort: () => {},
    approve: async () => "once" as const,
  };
}

function promptInput(cwd: string) {
  return {
    session_id: "sess",
    transcript_path: "/tmp/s.jsonl",
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt: "hello",
  };
}

describe("summary section titles", () => {
  test("the web notice looks for exactly the headings the summarizer writes", () => {
    // StudioChangesNotice has no import path into server code, so it carries its own
    // copy of these strings and regex-parses the rendered summary for a change
    // count. Renaming a heading on one side alone makes that count silently wrong.
    expect([...COUNT_SECTIONS]).toEqual(Object.values(SECTION_TITLES));
  });
});

describe("summarizeEditLog", () => {
  test.each(["Model", "Folder"])("describes %s gizmo edits without exposing synthetic properties or values", (type) => {
    const envelopes = [2, 3].map((scale) =>
      envelope("SetProperty", [
        subject(type, "group-guid", "Group", [
          { Property: "GroupCFrame", Before: "synthetic-before", After: "synthetic-after" },
          { Property: "GroupSize", Before: 1, After: scale },
          { Property: "Name", Before: "Old", After: "Group" },
        ]),
      ]),
    );
    const { output, editCount } = summarizeEditLog(envelopes.map(parse));
    expect(editCount).toBe(1);
    expect(output).toContain(`Modified (1):\n~ ${type} "Group" (group-guid)`);
    expect(output).toContain("Position/orientation changed via gizmo (2 edits)");
    expect(output).toContain("Size changed via gizmo (2 edits)");
    expect(output).toContain("Name: Old -> Group (2 edits)");
    expect(output).not.toMatch(/GroupCFrame|GroupSize|synthetic-before|synthetic-after|1 ->/);
  });

  test("reports created, removed, moved, and modified instances by section", () => {
    const envelopes = [
      envelope("Create", [subject("Part", "p2", "Ramp")]),
      envelope("Delete", [subject("PointLight", "l1", "Lamp")]),
      // NOTE: `Reparent` and a `Parent` property are assumed, not observed — no
      // real capture has shown how Studio logs a drag-to-new-parent yet (OVDR-14148 Q3).
      envelope(
        "Reparent",
        [
          subject("Model", "m1", "Tree", [{ Property: "Parent", Before: "Workspace", After: "Props" }]),
          collateral("Folder", "f1", "Props"),
        ],
        { ActorGuids: ["m1"] },
      ),
      envelope("SetProperty", [
        subject("Part", "p1", "Floor", [{ Property: "Size", Before: "(4,1,4)", After: "(12,1,4)" }]),
      ]),
    ];

    const { output, editCount } = summarizeEditLog(envelopes.map(parse));
    expect(editCount).toBe(4);
    expect(output).toContain('Added (1):\n+ Part "Ramp" (p2)');
    expect(output).toContain('Removed (1):\n- PointLight "Lamp" (l1)');
    expect(output).toContain('> Model "Tree" (m1): parent Workspace -> Props');
    expect(output).toContain('~ Part "Floor" (p1)');
    expect(output).toContain("  Size: (4,1,4) -> (12,1,4)");
    expect(output).not.toContain('"Props" (f1)'); // auxiliary records carry no direct transaction intent
  });

  test("collapses repeated edits of the same property to first-before -> last-after", () => {
    const envelopes = [
      envelope("SetProperty", [subject("Part", "p1", "Door", [{ Property: "CFrame", Before: "A", After: "B" }])]),
      envelope("SetProperty", [subject("Part", "p1", "Door", [{ Property: "CFrame", Before: "B", After: "C" }])]),
    ];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain("  CFrame: A -> C (2 edits)");
    expect(output).not.toContain("A -> B");
  });

  test("folds an instance that was added and then removed into its own section", () => {
    const envelopes = [
      envelope("Create", [subject("Tool", "w1", "Weapon")]),
      envelope("Delete", [subject("Tool", "w1", "Weapon")]),
    ];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain("Added then removed (1):");
    expect(output).toContain("Tool: 1");
    expect(output).not.toContain("(w1)");
    expect(output).not.toContain("Added (1)");
    expect(output).not.toContain("Removed (1)");
  });

  test("renders list deltas (added/removed) and modified struct elements", () => {
    const envelopes = [
      envelope("SetProperty", [
        subject("Workspace", "ws-0", "Workspace", [
          { Property: "Tag", Added: ["Enemy", "Interactable"] },
          {
            Property: "LuaChildren",
            Added: [{ Name: "LuaSpawnLocation", InstanceType: "SpawnLocation", ObjectGuid: "sp1" }],
          },
          {
            Property: "Attribute",
            Modified: [
              {
                Before: { Key: "TestColor", DataType: "Color3", Value: { R: 254, G: 254, B: 254 } },
                After: { Key: "TestColor", DataType: "Color3", Value: { R: 254, G: 0, B: 0 } },
              },
            ],
          },
        ]),
      ]),
    ];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain("  Tag: added Enemy, Interactable");
    expect(output).toContain('  LuaChildren: added SpawnLocation "LuaSpawnLocation"');
    expect(output).toContain('  Attribute: modified "TestColor":');
  });

  test("reports script Source changes as events without content", () => {
    const envelopes = [envelope("SetProperty", [subject("Script", "s1", "GameLoop", [{ Property: "Source" }])])];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain('* Script "GameLoop" (s1): source edited 1 time(s)');
    expect(output).toContain("content is not logged");
  });

  test("reports only the envelope's ActorGuids, dropping collateral objects", () => {
    // Studio lists the edit's fallout alongside its subject: creating a script
    // also logs the parent's LuaChildren change. Only ActorGuids marks direct transaction subjects.
    const envelopes = [
      envelope(
        "Create",
        [
          subject("LocalScript", "c1", "Controller"),
          collateral("Part", "ws-0", "Workspace", [
            { Property: "LuaChildren", Added: [{ InstanceType: "LocalScript", Name: "Controller", ActorGuid: "c1" }] },
          ]),
        ],
        { ActorGuids: ["c1"] },
      ),
    ];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain('+ LocalScript "Controller" (c1)');
    expect(output).not.toContain("Workspace");
  });

  test("reports a source edit on a freshly created script, not just the creation", () => {
    // The creator adds a script and immediately types into it. Reporting only
    // "added" reads as an empty new script, and the agent overwrites their code.
    const envelopes = [
      envelope("Create", [subject("LocalScript", "s1", "abab")]),
      envelope("SetProperty", [subject("LocalScript", "s1", "abab", [{ Property: "Source", Changed: true }])]),
    ];

    const { output, editCount } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain('+ LocalScript "abab" (s1)');
    expect(output).toContain('* LocalScript "abab" (s1): source edited 1 time(s)');
    expect(editCount).toBe(2);
  });

  test("omits the source note when the script was created and then deleted", () => {
    // Nothing left to read, so pointing the agent at the script would be noise.
    const envelopes = [
      envelope("Create", [subject("LocalScript", "s1", "abab")]),
      envelope("SetProperty", [subject("LocalScript", "s1", "abab", [{ Property: "Source", Changed: true }])]),
      envelope("Delete", [subject("LocalScript", "s1", "abab")]),
    ];

    const { output } = summarizeEditLog(envelopes.map(parse));
    expect(output).toContain("Added then removed (1):");
    expect(output).not.toContain("source edited");
  });

  test("returns the no-edits message for an empty batch", () => {
    expect(summarizeEditLog([]).output).toBe(NO_EDITS);
  });
});

/** Round-trip a raw envelope through the real file parser so tests exercise it too. */
function parse(raw: Record<string, unknown>) {
  const cwd = projectDir();
  writeEditLog(cwd, [raw]);
  const batch = rotateAndReadEditLogs(cwd);
  if (batch.envelopes.length !== 1) throw new Error("test envelope failed to parse");
  return batch.envelopes[0];
}

describe("real Studio Edit.Log format", () => {
  // Verbatim shape observed from Studio 2026-08: single `Edit.Log` in the
  // project root, CRLF, PascalCase fields, pretty-printed objects concatenated
  // back to back (not JSONL, not an array), subjects via envelope ActorGuids.
  const REAL_LOG = [
    JSON.stringify(
      {
        Timestamp: "2026-08-26T12:14:59.968Z",
        TransactionId: "7C20523D489A46F9D55A4384881357DD",
        Action: "Create",
        ActorGuids: ["00A01E0A47D96274567636A74BCA5513"],
        ParentGuid: "AC1F33D84F36064BB118299C2D2AA77E",
        Objects: [
          { InstanceType: "PointLight", ActorGuid: "BD2B5821", Name: "PointLight" },
          { InstanceType: "Model", ActorGuid: "00A01E0A47D96274567636A74BCA5513", Name: "Campfire" },
          {
            InstanceType: "Workspace",
            ActorGuid: "AC1F33D84F36064BB118299C2D2AA77E",
            Name: "Workspace",
            Changes: [
              {
                Property: "LuaChildren",
                Added: [{ InstanceType: "Model", Name: "Campfire", ActorGuid: "00A01E0A47D96274567636A74BCA5513" }],
              },
            ],
          },
        ],
      },
      null,
      "\t",
    ),
    JSON.stringify(
      {
        Timestamp: "2026-08-26T12:17:15.940Z",
        TransactionId: "BC860CAF41C11CC996D06CB3A3660E99",
        Action: "SetProperty",
        ActorGuids: ["3DB92227FA6C6CAE98C3BEB1766F8599"],
        Objects: [
          {
            InstanceType: "LocalScript",
            ActorGuid: "3DB92227FA6C6CAE98C3BEB1766F8599",
            Name: "WASDController",
            Changes: [{ Property: "Source", Changed: true }],
          },
        ],
      },
      null,
      "\t",
    ),
  ]
    .join("\n")
    .replace(/\n/g, "\r\n");

  test("consumes a root Edit.Log with PascalCase concatenated envelopes", () => {
    const cwd = projectDir();
    writeFileSync(join(cwd, "Edit.Log"), REAL_LOG);

    const capture = consumeStudioChanges(cwd);
    expect(capture.result.metadata?.studioChangesDetected).toBe(true);
    expect(capture.result.metadata?.transactions).toBe(2);
    // Only the envelope subject (ActorGuids) counts; auxiliary creations and
    // the Workspace LuaChildren fallout are not the transaction's direct subjects.
    expect(capture.result.output).toContain('+ Model "Campfire" (00A01E0A47D96274567636A74BCA5513)');
    expect(capture.result.output).not.toContain("PointLight");
    expect(capture.result.output).not.toContain("Workspace");
    expect(capture.result.output).toContain('* LocalScript "WASDController"');

    // Rotation happens at the root, and finalize clears it.
    const rootNames = readdirSync(cwd);
    expect(rootNames).not.toContain("Edit.Log");
    expect(rootNames.some((name) => name.endsWith(".consuming"))).toBe(true);
    capture.finalize();
    expect(readdirSync(cwd).some((name) => name.endsWith(".consuming"))).toBe(false);
  });

  test("ignores unrelated root files and a truncated trailing envelope", () => {
    const cwd = projectDir();
    writeFileSync(join(cwd, "Play.log"), "not an edit log");
    writeFileSync(join(cwd, "Edit.Log"), `${REAL_LOG}\r\n{\r\n\t"Timestamp": "2026-08-26T12:`);

    const { result } = consumeStudioChanges(cwd);
    expect(result.metadata?.studioChangesDetected).toBe(true);
    expect(result.metadata?.transactions).toBe(2); // truncated tail dropped, not fatal
    expect(readdirSync(cwd)).toContain("Play.log"); // untouched
  });
});

describe("consumeStudioChanges", () => {
  test("returns no-edits when the EditLogging directory does not exist", () => {
    const { result } = consumeStudioChanges(projectDir());
    expect(result.output).toBe(NO_EDITS);
    expect(result.metadata?.studioChangesDetected).toBe(false);
  });

  test("rotates log files immediately and deletes them only on finalize", () => {
    const cwd = projectDir();
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p2", "Ramp")])]);

    const capture = consumeStudioChanges(cwd);
    expect(capture.result.metadata?.studioChangesDetected).toBe(true);
    const afterConsume = logFiles(cwd);
    expect(afterConsume.some((name) => name.endsWith(".consuming"))).toBe(true);
    expect(afterConsume).not.toContain("Edit.Log");

    capture.finalize();
    expect(logFiles(cwd)).toEqual([]);
  });

  test("re-reads leftover .consuming files from a crashed turn", () => {
    const cwd = projectDir();
    writeFileSync(
      join(cwd, "Edit.Log.old.consuming"),
      JSON.stringify(envelope("Create", [subject("Part", "p1", "Old")])),
    );
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p2", "New")])]);

    const { result } = consumeStudioChanges(cwd);
    expect(result.output).toContain('+ Part "Old" (p1)');
    expect(result.output).toContain('+ Part "New" (p2)');
  });

  test("counts malformed envelopes but keeps the parsable ones", () => {
    const cwd = projectDir();
    // A brace-balanced but invalid chunk is a parse failure; a truncated tail
    // (mid-append) is silently dropped instead.
    writeFileSync(
      join(cwd, "Edit.Log"),
      `${JSON.stringify(envelope("Create", [subject("Part", "p2", "Ramp")]))}\n{"bad": }\n{"truncated`,
    );

    const { result } = consumeStudioChanges(cwd);
    expect(result.output).toContain('+ Part "Ramp" (p2)');
    expect(result.output).toContain("1 log entries could not be parsed");
  });

  test("accepts a whole-file JSON array as well as JSONL", () => {
    const cwd = projectDir();
    writeFileSync(join(cwd, "Edit.Log"), JSON.stringify([envelope("Create", [subject("Part", "p2", "Ramp")])]));

    const { result } = consumeStudioChanges(cwd);
    expect(result.output).toContain('+ Part "Ramp" (p2)');
  });
});

describe("createStudioChangesTool", () => {
  test("archives omitted details before removing the log and retrieves them after recreation", async () => {
    const cwd = projectDir();
    const objects = Array.from({ length: 80 }, (_, i) =>
      subject("Part", `part-${i}`, `Part${i}`, [{ Property: "Name", Before: `Old${i}`, After: `Part${i}` }]),
    );
    writeEditLog(cwd, [envelope("SetProperty", objects)]);
    const capture = consumeStudioChanges(cwd);
    expect(capture.result.output).not.toContain("(part-79)");
    const archivePath = capture.result.metadata?.archivePath as string;
    const archived = JSON.parse(readFileSync(archivePath, "utf8"));
    expect(archived.envelopes[0].objects).toHaveLength(80);
    capture.finalize();
    expect(logFiles(cwd)).toEqual([]);
    const tool = createStudioChangesTool(cwd);
    const details = await tool.execute({ view: "details", batchId: capture.id, guid: "part-79" } as never, toolCtx());
    expect(details.output).toContain("Name: Old79 -> Part79");
    expect(details.metadata?.total).toBe(1);
  });

  test("does not delete a rotated log when archival fails", () => {
    const cwd = projectDir();
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p1", "Keep")])]);
    const capture = consumeStudioChanges(cwd);
    // An archive is durable before finalize. A failed capture must leave its
    // rotated input recoverable, including when its storage root is blocked.
    const blocked = projectDir();
    writeFileSync(resolvePaths(blocked).root, "not a directory");
    writeEditLog(blocked, [envelope("Create", [subject("Part", "p1", "Keep")])]);
    const failed = consumeStudioChanges(blocked);
    expect(failed.result.metadata?.error).toBe(true);
    failed.finalize();
    expect(logFiles(blocked).some((name) => name.endsWith(".consuming"))).toBe(true);
    capture.finalize();
  });

  test("default queries report each live transaction once, including identical edits appended later", async () => {
    const cwd = projectDir();
    const edit = envelope("SetProperty", [subject("Part", "p1", "Door", [{ Property: "Size", Before: 1, After: 2 }])]);
    writeEditLog(cwd, [edit]);
    const tool = createStudioChangesTool(cwd);
    expect((await tool.execute({} as never, toolCtx())).output).toContain("Size: 1 -> 2");
    expect((await tool.execute({} as never, toolCtx())).output).toBe(NO_EDITS);
    writeEditLog(cwd, [edit, edit]);
    const appended = await tool.execute({} as never, toolCtx());
    expect(appended.output).toContain("Size: 1 -> 2");
    expect(appended.output).not.toContain("(2 edits)");
    expect(logFiles(cwd)).toContain("Edit.Log");
  });

  test("pages archived detail rows and filters by change kind without losing later properties", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [
      envelope("Create", [subject("Part", "added", "Added")]),
      envelope("SetProperty", [
        subject(
          "Part",
          "p1",
          "Door",
          Array.from({ length: 12 }, (_, i) => ({ Property: `Prop${i}`, Before: 0, After: i + 1 })),
        ),
        subject("Script", "s1", "Controller", [{ Property: "Source" }]),
      ]),
    ]);
    const capture = consumeStudioChanges(cwd);
    capture.finalize();
    const tool = createStudioChangesTool(cwd);
    const page = await tool.execute(
      { view: "details", batchId: capture.id, guid: "p1", changeType: "modified", limit: 3 } as never,
      toolCtx(),
    );
    expect(page.metadata?.total).toBe(12);
    expect(page.metadata?.nextOffset).toBe(3);
    expect(page.output).toContain("Prop2: 0 -> 3");
    expect(page.output).not.toContain("Prop3:");
    const next = await tool.execute(
      { view: "details", batchId: capture.id, guid: "p1", offset: 9, limit: 3 } as never,
      toolCtx(),
    );
    expect(next.output).toContain("Prop11: 0 -> 12");
    expect(next.metadata?.nextOffset).toBeUndefined();
    const source = await tool.execute(
      { view: "details", batchId: capture.id, changeType: "sourceChanged" } as never,
      toolCtx(),
    );
    expect(source.output).toContain("source edited");
    expect(source.output).not.toContain("Prop0");
    const invalid = await tool.execute({ view: "details", batchId: "../../Edit.Log" } as never, toolCtx());
    expect(invalid.metadata?.error).toBe(true);
  });

  test("new queries reset their cursor when Studio recreates its log", async () => {
    const cwd = projectDir();
    const edit = envelope("Create", [subject("Part", "p1", "Door")]);
    writeEditLog(cwd, [edit]);
    const tool = createStudioChangesTool(cwd);
    expect((await tool.execute({} as never, toolCtx())).output).toContain("(p1)");
    rmSync(join(cwd, "Edit.Log"));
    writeEditLog(cwd, [edit]);
    expect((await tool.execute({} as never, toolCtx())).output).toContain("(p1)");
  });

  test("bounds detail pages across large lists and continues at the first undisplayed row", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [
      envelope("SetProperty", [
        subject("Part", "p1", "Name".repeat(100), [
          { Property: "Tag", Added: Array.from({ length: 100 }, (_, i) => `${i}:${"긴값".repeat(100)}`) },
        ]),
      ]),
    ]);
    const capture = consumeStudioChanges(cwd);
    const tool = createStudioChangesTool(cwd);
    let offset = 0;
    const outputs: string[] = [];
    do {
      const page = await tool.execute({ view: "details", batchId: capture.id, offset, limit: 20 } as never, toolCtx());
      expect(Buffer.byteLength(page.output, "utf8")).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxBytes);
      expect(page.metadata?.total).toBe(100);
      outputs.push(page.output);
      const next = page.metadata?.nextOffset as number | undefined;
      if (next === undefined) break;
      expect(next).toBeGreaterThan(offset);
      offset = next;
    } while (offset < 100);
    const all = outputs.join("\n");
    for (let i = 0; i < 100; i++) expect(all.split(`Tag: added ${i}:`)).toHaveLength(2);
  });

  test("detail filters can snapshot the live log without consuming or acknowledging it", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [
      envelope("SetProperty", [subject("Part", "p1", "Door", [{ Property: "Name", Before: "Old", After: "Door" }])]),
    ]);
    const tool = createStudioChangesTool(cwd);
    const page = await tool.execute({ guid: "p1" } as never, toolCtx());
    expect(page.output).toContain("Name: Old -> Door");
    expect(page.output).toContain("Full values:");
    expect((await tool.execute({} as never, toolCtx())).output).toContain("Name: Old -> Door");
    expect(logFiles(cwd)).toContain("Edit.Log");
  });

  test("reports new edits without repeating the delivered turn-start summary", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p2", "Ramp")])]);
    const capture = consumeStudioChanges(cwd);
    capture.finalize();

    // Studio records more edits while the agent works.
    writeEditLog(cwd, [envelope("Delete", [subject("Part", "p9", "Crate")])]);

    const tool = createStudioChangesTool(cwd, () => capture);
    const result = await tool.execute({} as never, toolCtx());
    expect(result.output).not.toContain('+ Part "Ramp" (p2)');
    expect(result.output).toContain("recorded during this turn");
    expect(result.output).toContain('- Part "Crate" (p9)');
    // Peek must not consume: the mid-turn log stays for the next turn.
    expect(logFiles(cwd)).toContain("Edit.Log");
  });

  test("returns the no-edits message when nothing is pending or cached", async () => {
    const result = await createStudioChangesTool(projectDir()).execute({} as never, toolCtx());
    expect(result.output).toBe(NO_EDITS);
    expect(result.metadata?.error).toBeUndefined();
  });

  test("is registered as a tool on the provider", async () => {
    const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
    const tools = await provider.createTools({
      cwd: "/tmp/project",
      host: { approve: async () => "once" },
    });
    expect(tools.map((tool) => tool.name)).toContain("studiorpc_studio_changes");
  });
});

describe("bounded Studio change summaries", () => {
  test("limits objects across sections and caps each object's properties and list items", () => {
    const logs = [
      envelope(
        "Create",
        Array.from({ length: 40 }, (_, i) => subject("Part", `p-${i}`, `Part${i}`)),
      ),
      envelope("SetProperty", [
        subject("Part", "changed", "Changed", [
          { Property: "Tag", Added: ["first", "second", "third", "fourth", "fifth"] },
          ...Array.from({ length: 7 }, (_, i) => ({ Property: `Prop${i}`, Before: 0, After: 1 })),
        ]),
      ]),
    ].map(parse);
    const result = summarizeEditLog(logs);
    expect(result.shownTargets).toBe(STUDIO_CHANGES_LIMITS.maxTargets);
    expect(result.omittedTargets).toBe(41 - STUDIO_CHANGES_LIMITS.maxTargets);
    expect(result.output).toContain("Modified (1):");
    expect(result.output).toContain("Tag: added first, second, third");
    expect(result.output).toContain("2 list items omitted");
    expect(result.output).toContain("4 properties omitted");
    expect(result.output).not.toContain("fourth");
    expect(result.output).not.toContain("Prop3:");
  });

  test("bounds the entire multilingual summary, keeps counts and prioritizes late critical changes", () => {
    const parts = Array.from({ length: 100 }, (_, i) =>
      subject("Part", `p-${i}`, "긴이름".repeat(100), [
        ...Array.from({ length: 30 }, (_, j) => ({
          Property: `P${j}`,
          Before: "a".repeat(500),
          After: "나".repeat(500),
        })),
        { Property: "Tag", Added: Array.from({ length: 200 }, (_, j) => `tag-${j}`) },
      ]),
    );
    const logs = [
      envelope("Create", parts),
      envelope("Delete", [subject("Part", "deleted", "Deleted")]),
      envelope("Reparent", [subject("Part", "moved", "Moved", [{ Property: "Parent", Before: "A", After: "B" }])]),
      envelope("SetProperty", [subject("Script", "script", "Controller", [{ Property: "Source" }])]),
    ].map(parse);
    const result = summarizeEditLog(logs);
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxBytes);
    expect(result.output).toContain("Added (100):");
    expect(result.output).toContain("Removed (1):");
    expect(result.output).toContain("(deleted)");
    expect(result.output).toContain("(moved)");
    expect(result.output).toContain("(script)");
    expect(result.output).toContain("omitted");
    expect(result.output).toContain("studiorpc_studio_changes");
    expect(result.output).not.toContain("P4:");
    expect(result.output).not.toContain("tag-3,");
    expect(result.editCount).toBe(103);
    expect(result.shownTargets).toBeLessThanOrEqual(STUDIO_CHANGES_LIMITS.maxTargets);
  });

  test("does not mistake different long values for a reverted edit", () => {
    const prefix = "x".repeat(200);
    const result = summarizeEditLog([
      parse(
        envelope("SetProperty", [
          subject("Part", "p1", "Part", [{ Property: "Value", Before: `${prefix}a`, After: `${prefix}b` }]),
        ]),
      ),
    ]);
    expect(result.editCount).toBe(1);
    expect(result.output).toContain("Value:");
  });

  test("omits reverted scalar and parent changes without hiding script edits", () => {
    const logs = [
      envelope("SetProperty", [
        subject("Part", "p1", "Part", [
          { Property: "Size", Before: 1, After: 2 },
          { Property: "Parent", Before: "A", After: "B" },
        ]),
      ]),
      envelope("SetProperty", [
        subject("Part", "p1", "Part", [
          { Property: "Size", Before: 2, After: 1 },
          { Property: "Parent", Before: "B", After: "A" },
        ]),
      ]),
      envelope("SetProperty", [subject("Script", "s1", "Controller", [{ Property: "Source" }])]),
    ].map(parse);
    const result = summarizeEditLog(logs);
    expect(result.editCount).toBe(1);
    expect(result.output).not.toContain("(p1)");
    expect(result.output).toContain("source edited");
  });
});

describe("studio-changes unified loop-hook context injection", () => {
  function promptProvider() {
    const provider = bindStudioTestSession(createStudioRpcToolProvider({ callRpc: async () => ({}) }));
    return provider as typeof provider & {
      onUserPromptSubmit: NonNullable<typeof provider.onUserPromptSubmit>;
    };
  }

  test("consumes the log in the outer hook and injects the summary through an Agent loop hook", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p2", "Ramp")])]);
    const p = promptProvider();

    const result = await p.onUserPromptSubmit(promptInput(cwd));
    expect(result.additionalContext).toBeUndefined();

    const hook = p.createAgentLoopHooks?.({ agentKind: "main" } as never)[0];
    expect(hook).toBeDefined();
    hook?.onPromptStart?.({ messages: [] });
    const injections = hook?.beforeTurn?.({ messages: [], turnId: "turn-1", compactedThisTurn: false });
    expect(injections).toHaveLength(1);
    expect(injections?.[0]).toMatchObject({
      source: "studiorpc-studio-changes",
      metadata: {
        presentation: { kind: "studio-changes", title: "Studio changes detected" },
      },
    });
    expect(injections?.[0]?.content).toContain('+ Part "Ramp" (p2)');
    // Injection delivered -> consumed log files are gone.
    expect(logFiles(cwd)).toEqual([]);
  });

  test("delivers semantic gizmo changes through context injection, the cached tool, and mid-turn peeks", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [
      envelope("SetProperty", [subject("Model", "m1", "Tree", [{ Property: "GroupCFrame", Before: "A", After: "B" }])]),
    ]);
    const p = promptProvider();
    await p.onUserPromptSubmit(promptInput(cwd));
    const hook = p.createAgentLoopHooks?.({ agentKind: "main" } as never)[0];
    hook?.onPromptStart?.({ messages: [] });
    const injections = hook?.beforeTurn?.({ messages: [], turnId: "turn-1", compactedThisTurn: false });
    expect(injections?.[0]?.content).toContain('~ Model "Tree" (m1)\n  Position/orientation changed via gizmo');
    expect(injections?.[0]?.content).not.toContain("GroupCFrame");

    writeEditLog(cwd, [
      envelope("SetProperty", [subject("Folder", "f1", "Props", [{ Property: "GroupSize", Before: 1, After: 2 }])]),
    ]);
    const tools = await p.createTools({ cwd, host: { approve: async () => "once" } });
    const tool = tools.find((tool) => tool.name === "studiorpc_studio_changes");
    expect(tool).toBeDefined();
    const result = await tool!.execute({} as never, toolCtx());
    expect(result.output).not.toContain('~ Model "Tree" (m1)');
    expect(result.output).toContain('~ Folder "Props" (f1)\n  Size changed via gizmo');
    expect(result.output).not.toMatch(/GroupCFrame|GroupSize|1 -> 2/);
    expect(logFiles(cwd)).toContain("Edit.Log");
  });

  test("injects nothing when the log is empty", async () => {
    const cwd = projectDir();
    const p = promptProvider();
    await p.onUserPromptSubmit(promptInput(cwd));
    const hook = p.createAgentLoopHooks?.({ agentKind: "main" } as never)[0];
    hook?.onPromptStart?.({ messages: [] });
    expect(hook?.beforeTurn?.({ messages: [], turnId: "turn-1", compactedThisTurn: false })).toBeUndefined();
  });

  test("does not call any RPC at turn start", async () => {
    const calls: string[] = [];
    const provider = createStudioRpcToolProvider({
      callRpc: async (method) => {
        calls.push(method);
        return {};
      },
    });
    const p = provider as typeof provider & { onUserPromptSubmit: NonNullable<typeof provider.onUserPromptSubmit> };
    await p.onUserPromptSubmit(promptInput(projectDir()));
    expect(calls).toEqual([]);
    expect(provider.onStop).toBeDefined();
  });

  test("injects at most once per user request even when edits arrive between model iterations", async () => {
    const cwd = projectDir();
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p1", "Door")])]);
    const p = promptProvider();
    await p.onUserPromptSubmit(promptInput(cwd));
    const hook = p.createAgentLoopHooks?.({ agentKind: "main" } as never)[0];
    hook?.onPromptStart?.({ messages: [] });
    const context = { messages: [], turnId: "turn-1", compactedThisTurn: false };
    expect(hook?.beforeTurn?.(context)).toHaveLength(1);
    writeEditLog(cwd, [envelope("Create", [subject("Part", "p2", "Window")])]);
    expect(hook?.beforeTurn?.({ ...context, turnId: "turn-2" })).toBeUndefined();
    expect(logFiles(cwd)).toContain("Edit.Log");
  });

  test("does not register the Studio changes loop hook for child agents", () => {
    const p = promptProvider();
    expect(p.createAgentLoopHooks?.({ agentKind: "child" } as never)).toEqual([]);
  });
});

test("Studio change summaries explain attribution and verification without claiming an agent-relative diff", async () => {
  const cwd = projectDir();
  writeEditLog(cwd, [
    envelope("Modify", [
      { ActorGuid: "p1", Name: "Part", Changes: [{ Property: "Name", Before: "Old", After: "New" }] },
    ]),
  ]);
  const capture = consumeStudioChanges(cwd);
  expect(capture.result.output).toContain("Studio changes collected at turn start:");
  expect(capture.result.output).toContain("may include this session's own work");
  expect(capture.result.output).toContain("Compare these changes with your own work");
  expect(capture.result.output).toContain("inspect the affected instances");
  expect(capture.result.output).not.toContain("Human edits");
  expect(capture.result.output).not.toContain("creator's own edits");
  const tool = createStudioChangesTool(cwd);
  expect(tool.description).toContain("does not identify who made them");
  writeEditLog(cwd, [envelope("Delete", [subject("Part", "p9", "Crate")])]);
  const live = await tool.execute({} as never, toolCtx());
  expect(live.output).toContain("Studio changes recorded during this turn:");
});
