// @summary Verifies image requests use live provider auth and cannot outlive cancellation during shared refresh.
import { expect, mock, test } from "bun:test";
import type { ImageGenerationFn } from "../../src/llm/provider/image-generation";
import { type ExternalProviderAuth, ProviderManager } from "../../src/llm/provider-manager";

const input = { prompt: "Coin", model: "requested" };
function auth(generate: ImageGenerationFn, ensureFresh = async () => {}): ExternalProviderAuth {
  return {
    isConfigured: () => true,
    getStream: () => {
      throw new Error("Not streaming");
    },
    getImageGeneration: () => generate,
    ensureFresh,
  };
}
function generator(label: string) {
  return mock(async () => ({
    bytes: Buffer.from(label),
    mediaType: "image/png" as const,
    requestedModel: input.model,
  }));
}

test("uses the current login for every image call and rejects after logout", async () => {
  const manager = new ProviderManager({});
  const first = generator("first");
  const second = generator("second");
  manager.setExternalAuth("chatgpt", auth(first));
  expect((await manager.generateImage("chatgpt", input)).bytes).toEqual(Buffer.from("first"));
  manager.setExternalAuth("chatgpt", auth(second));
  expect((await manager.generateImage("chatgpt", input)).bytes).toEqual(Buffer.from("second"));
  manager.removeExternalAuth("chatgpt");
  await expect(manager.generateImage("chatgpt", input)).rejects.toThrow("OAuth");
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

test("does not fall back to an API key or another provider", async () => {
  const manager = new ProviderManager({});
  const generate = generator("image");
  manager.setExternalAuth("chatgpt", auth(generate));
  await expect(manager.generateImage("openai", input)).rejects.toThrow("OAuth");
  expect(generate).not.toHaveBeenCalled();
});

test("rejects a binding replaced while its readiness check is pending", async () => {
  const manager = new ProviderManager({});
  const ready = Promise.withResolvers<void>();
  const first = generator("first");
  const second = generator("second");
  manager.setExternalAuth(
    "chatgpt",
    auth(first, () => ready.promise),
  );
  const result = manager.generateImage("chatgpt", input);
  manager.setExternalAuth("chatgpt", auth(second));
  ready.resolve();
  await expect(result).rejects.toThrow("authentication changed");
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
});

test("cancels waiting for shared refresh without cancelling another image request", async () => {
  const manager = new ProviderManager({});
  const ready = Promise.withResolvers<void>();
  const generate = generator("image");
  manager.setExternalAuth(
    "chatgpt",
    auth(generate, () => ready.promise),
  );
  const controller = new AbortController();
  const cancelled = manager.generateImage("chatgpt", input, { signal: controller.signal }).catch((error) => error);
  const surviving = manager.generateImage("chatgpt", input);
  controller.abort(new Error("image cancelled"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      cancelled,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("blocked"), 100);
      }),
    ]);
    expect(outcome).toBeInstanceOf(Error);
    expect(generate).not.toHaveBeenCalled();
  } finally {
    clearTimeout(timer);
    ready.resolve();
    await surviving;
    await cancelled;
  }
  expect(generate).toHaveBeenCalledTimes(1);
});
