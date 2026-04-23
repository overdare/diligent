// @summary Regression tests for runtime provider-auth bindings

import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVertexAccessTokenBinding } from "../../src/auth/provider-auth";

describe("createVertexAccessTokenBinding", () => {
  it("refreshes ADC token before first stream request", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ya29.fresh-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;
    const originalPlatform = process.platform;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    try {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "linux",
      });

      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "adc",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      const events = [] as string[];
      for await (const event of stream) {
        events.push(event.type);
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[0]).toEqual([
        "bash",
        "-lc",
        "gcloud auth application-default print-access-token",
      ]);
      expect(binding.getToken()).toBe("ya29.fresh-token");
      expect(events).toContain("start");
      expect(events).toContain("done");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("uses cmd.exe with gcloud.cmd for ADC token refresh on windows", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ya29.windows-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;
    const originalPlatform = process.platform;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "adc",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[0]?.[0]).toEqual(["where.exe", "gcloud.cmd"]);
      const commandArgs = spawnMock.mock.calls[1]?.[0];
      expect(commandArgs).toEqual([
        "cmd.exe",
        "/d",
        "/s",
        "/c",
        "gcloud.cmd auth application-default print-access-token",
      ]);
      expect(binding.getToken()).toBe("ya29.windows-token");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves the installed gcloud.cmd path on windows when PATH is missing", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ya29.windows-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;
    const originalPlatform = process.platform;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const originalPath = process.env.PATH;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    const fakeLocalAppData = await mkdtemp(join(tmpdir(), "diligent-gcloud-"));
    const fakeBinDir = join(fakeLocalAppData, "Google", "Cloud SDK", "google-cloud-sdk", "bin");
    await mkdir(fakeBinDir, { recursive: true });
    await Bun.write(join(fakeBinDir, "gcloud.cmd"), "@echo off\r\n");
    process.env.LOCALAPPDATA = fakeLocalAppData;
    process.env.PATH = "";

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "adc",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[0]?.[0]).toEqual(["where.exe", "gcloud.cmd"]);
      expect(spawnMock.mock.calls[1]?.[0]).toEqual([
        join(fakeBinDir, "gcloud.cmd"),
        "auth",
        "application-default",
        "print-access-token",
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      if (originalLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = originalLocalAppData;
      }
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves gcloud.cmd from PATH entries on windows", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ya29.path-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;
    const originalPlatform = process.platform;
    const originalPath = process.env.PATH;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    const fakePathRoot = await mkdtemp(join(tmpdir(), "diligent-gcloud-path-"));
    await Bun.write(join(fakePathRoot, "gcloud.cmd"), "@echo off\r\n");
    process.env.PATH = fakePathRoot;

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "adc",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[0]).toEqual([
        join(fakePathRoot, "gcloud.cmd"),
        "auth",
        "application-default",
        "print-access-token",
      ]);
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("still uses powershell for custom token commands on windows", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("custom-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;
    const originalPlatform = process.platform;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "access_token_command",
        accessTokenCommand: "Write-Output custom-token",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock.mock.calls[0]?.[0]).toEqual([
        "powershell",
        "-NoProfile",
        "-Command",
        "Write-Output custom-token",
      ]);
      expect(binding.getToken()).toBe("custom-token");
    } finally {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: originalPlatform,
      });
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the global Vertex host when location is global", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "global",
        endpoint: "openapi",
        authMode: "access_token",
        accessToken: "ya29.test-token",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toContain(
        "https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/endpoints/openapi/chat/completions",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
