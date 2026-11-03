// @summary Verifies swappable provider wire contracts, visual input and credential isolation.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDecisionProvider,
  defaultDecisionProvider,
  readPlaytestDecisionSettings,
  resolveOpenAIApiKey,
} from "../../../../../src/tools/studiorpc/tools/playtest/decision-provider";

const frame = { state: { privateVerification: true }, decisionState: { room: "hall" } } as never;
const candidates = [
  { id: "inspect:a", description: "Inspect left panel" },
  { id: "leave", description: "Leave" },
];
const signal = new AbortController().signal;
const visual = {
  dataUrl: "data:image/png;base64,aW1hZ2U=",
  metadata: {
    capturedAtMs: 10,
    pieSessionId: "p",
    clientId: "c",
    stateRevision: 1,
    width: 1,
    height: 1,
    sha256: "hash",
  },
};

test("Decisions serializes named choices and inline pixels without verification state or credentials in input", async () => {
  let sent: {
    questions: unknown[];
    input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>;
  };
  let headers: Headers | undefined;
  const provider = await createDecisionProvider(
    { provider: "openai-decisions", model: "gpt-6-luna", observationMode: "structured+image", goal: "inspect" },
    {
      resolveApiKey: async () => "secret-test-key",
      fetch: async (url, init) => {
        expect(url).toBe("https://api.openai.com/v1/decisions");
        expect(init.redirect).toBe("error");
        headers = new Headers(init.headers);
        sent = JSON.parse(String(init.body));
        return Response.json({
          answers: [
            { name: "diagnostic", type: "predicate", probability: 1 },
            {
              name: "action",
              type: "choice",
              choice: "inspect:a",
              confidence: 0.8,
              probabilities: [{ value: "inspect:a", probability: 0.9 }],
            },
          ],
          usage: { input_tokens: 33 },
        });
      },
    },
  );
  const result = await provider.choose(
    frame,
    candidates,
    signal,
    { activeIntent: { id: "inspect:a", elapsedMs: 10 } },
    visual,
  );
  expect(headers?.get("authorization")).toBe("Bearer secret-test-key");
  expect(sent.questions[0]).toMatchObject({
    name: "action",
    type: "choice",
    choices: candidates.map((c) => ({ value: c.id, description: c.description })),
  });
  const evidence = JSON.parse(sent.input[0].content[0].text!);
  expect(evidence.game).toEqual({ room: "hall" });
  expect(evidence.controller.activeIntent.id).toBe("inspect:a");
  expect(sent.input[0].content[1]).toEqual({ type: "input_image", image_url: visual.dataUrl });
  expect(JSON.stringify(sent)).not.toContain("secret-test-key");
  expect(JSON.stringify(sent)).not.toContain("privateVerification");
  expect(result.actionId).toBe("inspect:a");
  expect(result.diagnostics?.probabilities).toEqual({ "inspect:a": 0.9 });
});

test("Decisions text mode needs no image and prepare does not fabricate a warm request", async () => {
  let calls = 0;
  const provider = await createDecisionProvider(
    { provider: "openai-decisions", observationMode: "structured", goal: "inspect" },
    {
      resolveApiKey: async () => "key",
      fetch: async (_url, init) => {
        calls++;
        expect(JSON.parse(String(init.body)).input[0].content).toHaveLength(1);
        return Response.json({ answers: [{ name: "action", type: "choice", choice: "leave" }] });
      },
    },
  );
  await provider.prepare(signal);
  expect(calls).toBe(0);
  expect((await provider.choose(frame, candidates, signal)).actionId).toBe("leave");
  expect(calls).toBe(1);
});

test("Laya remains an explicit text-only provider using its existing protocol", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const provider = await createDecisionProvider(
    { provider: "laya", goal: "inspect" },
    {
      readSettings: () => ({ laya: { url: "http://localhost/api/decide" } }),
      resolveApiKey: async () => {
        throw Error("Laya must not read API credentials");
      },
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return Response.json({ answers: { action: { choice: "leave" } } });
      },
    },
  );
  await provider.prepare(signal);
  expect((await provider.choose(frame, candidates, signal)).actionId).toBe("leave");
  expect(bodies[1]).toMatchObject({ questions: { action: { criteria: { leave: "Leave" } } } });
  await expect(provider.choose(frame, candidates, signal, undefined, visual)).rejects.toThrow(/image|visual/i);
  await expect(
    createDecisionProvider(
      { provider: "laya", observationMode: "structured+image", goal: "x" },
      { readSettings: () => ({}) },
    ),
  ).rejects.toThrow(/image|visual/i);
});

test("missing credentials and an unsupported model fail closed", async () => {
  await expect(
    createDecisionProvider({ provider: "openai-decisions", goal: "x" }, { resolveApiKey: async () => undefined }),
  ).rejects.toThrow(/Settings -> AI connection.*ChatGPT sign-in is not accepted/);
  await expect(
    createDecisionProvider(
      { provider: "openai-decisions", goal: "x", model: "unsupported" },
      { resolveApiKey: async () => "key" },
    ),
  ).rejects.toThrow(/model/i);
});

test("Laya requires a configured URL and defaults its model", async () => {
  await expect(
    createDecisionProvider({ provider: "laya", goal: "x" }, { readSettings: () => ({ path: "/h/overdare.jsonc" }) }),
  ).rejects.toThrow(/playtest\.laya\.url in \/h\/overdare\.jsonc/);
  const provider = await createDecisionProvider(
    { provider: "laya", goal: "x" },
    { readSettings: () => ({ laya: { url: "http://127.0.0.1:9/api/decide" } }) },
  );
  expect(provider.metadata).toMatchObject({
    provider: "laya",
    model: "laya:en",
    endpoint: "http://127.0.0.1:9/api/decide",
  });
});

test("the default provider is OpenAI Decisions unless overdare.jsonc selects one", () => {
  expect(defaultDecisionProvider({})).toBe("openai-decisions");
  expect(defaultDecisionProvider({ decisionProvider: "laya" })).toBe("laya");
});

describe("overdare.jsonc playtest settings", () => {
  let home: string;
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    NS: process.env.DILIGENT_STORAGE_NAMESPACE,
  };
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "playtest-settings-"));
    process.env.HOME = home;
    delete process.env.USERPROFILE;
    process.env.DILIGENT_STORAGE_NAMESPACE = "overdare";
    await mkdir(join(home, ".overdare"));
  });
  afterEach(async () => {
    for (const [key, value] of [
      ["HOME", saved.HOME],
      ["USERPROFILE", saved.USERPROFILE],
      ["DILIGENT_STORAGE_NAMESPACE", saved.NS],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  });
  const writeConfig = (text: string) => writeFile(join(home, ".overdare", "overdare.jsonc"), text);

  test("reads the section freshly on every call, keeping URLs inside JSONC strings", async () => {
    expect(readPlaytestDecisionSettings().decisionProvider).toBeUndefined();
    await writeConfig(
      '{\n  // local Laya\n  "playtest": { "decisionProvider": "laya", "laya": { "url": "http://127.0.0.1:11435/api/decide" } }\n}',
    );
    expect(readPlaytestDecisionSettings()).toMatchObject({
      decisionProvider: "laya",
      laya: { url: "http://127.0.0.1:11435/api/decide" },
    });
    await writeConfig('{ "playtest": { "decisionProvider": "openai-decisions" } }');
    expect(defaultDecisionProvider()).toBe("openai-decisions");
  });

  test("invalid values name the file and key", async () => {
    await writeConfig('{ "playtest": { "decisionProvider": "gpt" } }');
    expect(() => readPlaytestDecisionSettings()).toThrow(/playtest\.decisionProvider in .*overdare\.jsonc/);
    await writeConfig('{ "playtest": { "laya": { "url": "ftp://host/x" } } }');
    expect(() => readPlaytestDecisionSettings()).toThrow(/playtest\.laya\.url in .*overdare\.jsonc/);
  });
});

test("the OpenAI key comes from the auth store before the config key", async () => {
  const config = { provider: { auth: { credentialsStore: "file" }, openai: { apiKey: "config-key" } } };
  const modes: unknown[] = [];
  const sources = (stored?: string) => ({
    loadConfig: (async () => ({ config })) as never,
    loadAuth: (async (options: unknown) => {
      modes.push(options);
      return stored ? { openai: stored } : {};
    }) as never,
  });
  expect(await resolveOpenAIApiKey("/project", sources("stored-key"))).toBe("stored-key");
  expect(await resolveOpenAIApiKey("/project", sources())).toBe("config-key");
  expect(modes).toEqual([{ mode: "file" }, { mode: "file" }]);
});

test("refusals, duplicate answers, unavailable choices, HTTP failures and missing required pixels never return a choice", async () => {
  for (const answers of [
    [{ name: "action", type: "refusal" }],
    [{ name: "action", type: "predicate", probability: 1 }],
    [{ name: "action", type: "choice", choice: "missing" }],
    [
      { name: "action", type: "choice", choice: "leave" },
      { name: "action", type: "choice", choice: "leave" },
    ],
  ]) {
    const p = await createDecisionProvider(
      { provider: "openai-decisions", goal: "x" },
      { resolveApiKey: async () => "secret-key", fetch: async () => Response.json({ answers }) },
    );
    await expect(p.choose(frame, candidates, signal)).rejects.toThrow();
  }
  let calls = 0;
  const p = await createDecisionProvider(
    { provider: "openai-decisions", goal: "x", observationMode: "structured+image" },
    {
      resolveApiKey: async () => "secret-key",
      fetch: async () => {
        calls++;
        return Response.json({ error: { message: "secret-key" } }, { status: 401 });
      },
    },
  );
  await expect(p.choose(frame, candidates, signal)).rejects.toThrow(/image|visual/i);
  expect(calls).toBe(0);
  try {
    await p.choose(frame, candidates, signal, undefined, visual);
    throw Error("expected HTTP rejection");
  } catch (e) {
    expect(String(e)).toContain("401");
    expect(String(e)).not.toContain("secret-key");
  }
});

test("cancellation is passed to the provider request", async () => {
  const controller = new AbortController();
  const p = await createDecisionProvider(
    { provider: "openai-decisions", goal: "x" },
    {
      resolveApiKey: async () => "key",
      fetch: async (_url, init) => {
        expect(init.signal).toBe(controller.signal);
        controller.abort();
        init.signal!.throwIfAborted();
        return Response.json({});
      },
    },
  );
  await expect(p.choose(frame, candidates, controller.signal)).rejects.toThrow();
});

test("transport exceptions do not echo credentials or request bodies", async () => {
  const p = await createDecisionProvider(
    { provider: "openai-decisions", goal: "x" },
    {
      resolveApiKey: async () => "test-secret",
      fetch: async () => {
        throw Error("test-secret and private request");
      },
    },
  );
  try {
    await p.choose(frame, candidates, signal);
    throw Error("expected failure");
  } catch (e) {
    expect(String(e)).toContain("request failed");
    expect(String(e)).not.toContain("test-secret");
    expect(String(e)).not.toContain("private request");
  }
});
