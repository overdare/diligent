// @summary Bounded catalog thumbnail downloads returned as image content for LLM inspection.
import { downscaleImageIfNeeded, validateImage } from "@diligent/core/image-contract";
import type { ImageBlock } from "@diligent/core/message-contract";
import type { ToolResult } from "@diligent/core/tool-contract";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 5_000;
type MediaType = "image/png" | "image/jpeg" | "image/webp";
type Preview = { url: string; imageIndex?: number; error?: string };

function validateUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL is not an allowed catalog thumbnail");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "asset-prod.cdn.overdare.com" ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("URL is not an allowed catalog thumbnail (HTTPS asset-prod.cdn.overdare.com required)");
  }
}

function detectMediaType(bytes: Uint8Array): MediaType {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const head = new TextDecoder().decode(bytes.subarray(0, 12));
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a"))
    throw new Error("GIF previews are unsupported; use the asset description or another thumbnail");
  if (bytes.length >= 12 && head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  throw new Error("Thumbnail is empty or has no recognized PNG/JPEG/WebP header");
}

async function download(url: string, signal: AbortSignal, budget: { bytes: number }): Promise<ImageBlock> {
  validateUrl(url);
  signal.throwIfAborted();
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`Thumbnail fetch failed (HTTP ${response.status})`);
  if (!response.body) throw new Error("Thumbnail has no image body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      budget.bytes += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error("Thumbnail exceeds the 5 MiB source limit");
      if (budget.bytes > MAX_TOTAL_BYTES) throw new Error("Thumbnails exceed the 10 MiB total download limit");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const mediaType = detectMediaType(bytes);
  try {
    await validateImage(bytes.buffer, mediaType);
  } catch {
    throw new Error("Thumbnail contains invalid or oversized image data");
  }
  const encoded = await downscaleImageIfNeeded(bytes.buffer, mediaType);
  signal.throwIfAborted();
  if (encoded.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Thumbnail exceeds the 5 MiB image transport limit");
  return {
    type: "image",
    source: { type: "base64", media_type: encoded.mediaType, data: Buffer.from(encoded.bytes).toString("base64") },
  };
}

export async function inspectAssetPreviews(urls: string[], signal: AbortSignal): Promise<ToolResult> {
  signal.throwIfAborted();
  const budget = { bytes: 0 };
  const results: Array<{ image?: ImageBlock; error?: string }> = new Array(urls.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < urls.length) {
      signal.throwIfAborted();
      const index = next++;
      try {
        if (budget.bytes >= MAX_TOTAL_BYTES) throw new Error("Thumbnails exceed the 10 MiB total download limit");
        results[index] = {
          image: await download(urls[index], AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]), budget),
        };
      } catch (err) {
        if (signal.aborted) throw signal.reason;
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        results[index] = {
          error: timedOut ? "Thumbnail fetch timed out" : err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const outputImages: ImageBlock[] = [];
  const previews: Preview[] = urls.map((url, index) => {
    const result = results[index];
    if (!result.image) return { url, error: result.error };
    const imageIndex = outputImages.length;
    outputImages.push(result.image);
    return { url, imageIndex };
  });
  const summary = `Loaded ${outputImages.length} of ${urls.length} asset previews. Image indices are zero-based.`;
  return {
    output: JSON.stringify({ previews }, null, 2),
    outputImages,
    metadata: { loadedCount: outputImages.length, failedCount: urls.length - outputImages.length },
    render: { outputSummary: summary, blocks: [{ type: "text", text: summary }] },
  };
}
