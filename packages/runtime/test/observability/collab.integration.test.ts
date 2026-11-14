// @summary Real child sessions retain trace causality after their parent finishes and on resume.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@diligent/core/agent";
import { AgentRegistry } from "../../src/collab/registry";
import { ensureDiligentDir } from "../../src/infrastructure";
import { createObservationRuntime } from "../../src/observability/runtime";
import { SessionManager } from "../../src/session/manager";
import { makeAssistant, makeCollabDeps, makeStreamFn, TEST_MODEL } from "../helpers/collab";

type Span = {
  traceId: string;
  spanId: string;
  links?: Array<{ traceId: string; spanId: string }>;
  attributes: Array<{ key: string; value: { stringValue?: string } }>;
};
type Payload = { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };

test("real children outlive their parent scope, retain distinct traces, and resume with root session grouping", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diligent-child-observation-"));
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "fixture-user", contentMode: "none" }),
    resolveToken: async () => "fixture-token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  let registry: AgentRegistry | undefined;
  try {
    const paths = await ensureDiligentDir(directory);
    const parent = new SessionManager({
      cwd: directory,
      paths,
      agent: new Agent(TEST_MODEL, [], [], { llmMsgStreamFn: makeStreamFn([makeAssistant()]) }),
    });
    await parent.create();
    await parent.waitForWrites();
    registry = new AgentRegistry(
      makeCollabDeps({
        cwd: directory,
        paths,
        userId: "fixture-user",
        getParentSessionId: () => parent.sessionId,
        runObserved: (context, run) => runtime.run(run, context),
        observeModelAttempt: runtime.observeModelAttempt,
      }),
    );
    const children = await runtime.run(
      () =>
        runtime.runTool("spawn_agent", async () => [
          registry!.spawn({ prompt: "first private task", description: "first" }),
          registry!.spawn({ prompt: "second private task", description: "second" }),
        ]),
      { sessionId: parent.sessionId },
    );
    await registry.wait(
      children.map((child) => child.threadId),
      5000,
    );
    await runtime.flush();
    const readSpans = () =>
      bodies.flatMap((body) =>
        (JSON.parse(body) as Payload).resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
      );
    const attr = (span: Span, key: string) =>
      span.attributes.find((attribute) => attribute.key === key)?.value.stringValue;
    const spans = readSpans();
    const spawn = spans.find((span) => attr(span, "tool.name") === "spawn_agent")!;
    const roots = spans.filter((span) => span.links?.some((link) => link.spanId === spawn.spanId));
    expect(roots).toHaveLength(2);
    expect(new Set(roots.map((span) => span.traceId)).size).toBe(2);
    expect(roots.every((span) => attr(span, "gen_ai.conversation.id") === parent.sessionId)).toBe(true);
    expect(roots.every((span) => span.traceId !== spawn.traceId)).toBe(true);
    const before = spans.length;
    const resumed = registry.spawn({
      prompt: "resume private task",
      description: "resume",
      resumeId: children[0]!.threadId,
    });
    await registry.wait([resumed.threadId], 5000);
    await runtime.flush();
    const later = readSpans().slice(before);
    const resumedRoot = later.find(
      (span) =>
        attr(span, "openinference.span.kind") === "CHAIN" &&
        !span.attributes.some((attribute) => attribute.key === "diligent.retry.attempt"),
    );
    expect(resumedRoot).toBeDefined();
    expect(attr(resumedRoot!, "gen_ai.conversation.id")).toBe(parent.sessionId);
    expect(roots.every((span) => span.traceId !== resumedRoot!.traceId)).toBe(true);
    expect(bodies.join("")).not.toContain("private task");
  } finally {
    await registry?.shutdownAll();
    await runtime.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
