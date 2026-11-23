import { expect, test } from "bun:test";
import { evaluateCompatibility } from "../src/compat";

test("a recovered HTTP 400 still blocks publication and does not retain the provider error body", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/fallback"
        ? new Response("ok")
        : Response.json(
            { error: { code: "unsupported_parameter", param: "tools[0].type", message: "private context" } },
            {
              status: 400,
              headers: { "x-request-id": "req-123" },
            },
          ),
  });
  try {
    const result = await evaluateCompatibility(async () => {
      await (await fetch(server.url)).text();
      return (await (await fetch(new URL("/fallback", server.url))).text()) === "ok" ? undefined : "fallback_failed";
    });
    expect(result.status).toBe("fail");
    expect(result.http).toEqual({
      status: 400,
      requestId: "req-123",
      code: "unsupported_parameter",
      param: "tools[0].type",
    });
    expect(JSON.stringify(result)).not.toContain("private context");
  } finally {
    server.stop(true);
  }
});
