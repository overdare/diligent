// @summary Verifies swappable provider wire contracts, visual input and credential isolation.
import { expect, test } from "bun:test";
import { createDecisionProvider } from "../../../../../src/tools/studiorpc/tools/playtest/decision-provider";

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
    { provider: "laya", url: "http://localhost/api/decide", goal: "inspect" },
    {
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
    createDecisionProvider({ provider: "laya", observationMode: "structured+image", goal: "x" }),
  ).rejects.toThrow(/image|visual/i);
});

test("missing credentials, unsupported model and a foreign authenticated endpoint fail closed", async () => {
  await expect(
    createDecisionProvider({ provider: "openai-decisions", goal: "x" }, { resolveApiKey: async () => undefined }),
  ).rejects.toThrow(/OPENAI_API_KEY/);
  await expect(
    createDecisionProvider(
      { provider: "openai-decisions", goal: "x", model: "unsupported" },
      { resolveApiKey: async () => "key" },
    ),
  ).rejects.toThrow(/model/i);
  await expect(
    createDecisionProvider(
      { provider: "openai-decisions", goal: "x", url: "https://example.com/decisions" },
      { resolveApiKey: async () => "key" },
    ),
  ).rejects.toThrow(/endpoint/i);
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
