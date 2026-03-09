// @summary Tool plugin that fetches a URL and returns its readable text content
import { z } from "zod";
import type { ToolRenderPayload } from "@diligent/protocol";

export const manifest = {
  name: "url-fetch-plugin",
  apiVersion: "1.0",
  version: "0.1.0",
};

const UrlFetchParams = z.object({
  url: z.string().url().describe("The URL to fetch."),
  max_length: z
    .number()
    .int()
    .min(100)
    .max(100_000)
    .default(20_000)
    .describe("Maximum number of characters to return from the extracted text."),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(30_000)
    .default(10_000)
    .describe("Request timeout in milliseconds."),
  raw_html: z
    .boolean()
    .default(false)
    .describe("Return raw HTML instead of extracted text. Useful for inspecting page structure."),
});

// ---------------------------------------------------------------------------
// HTML → plain text extraction
// ---------------------------------------------------------------------------

function extractText(html: string): string {
  // Remove <script> and <style> blocks entirely
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Block-level tags → newline
  text = text.replace(
    /<\/?(p|div|section|article|header|footer|nav|main|aside|h[1-6]|ul|ol|li|tr|td|th|br|hr|blockquote)[^>]*>/gi,
    "\n",
  );

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));

  // Collapse excessive whitespace / blank lines
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n")
    .trim();
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : undefined;
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export async function createTools(_ctx: { cwd: string }) {
  return [
    {
      name: "url_fetch",
      description:
        "Fetch a URL and return its text content. Strips HTML tags and returns readable plain text by default. Useful for reading documentation, articles, or any web page.",
      parameters: UrlFetchParams,
      supportParallel: true,
      async execute(args: z.infer<typeof UrlFetchParams>) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), args.timeout_ms);

        let response: Response;
        try {
          response = await fetch(args.url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; diligent-url-fetch/0.1)",
              Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            },
          });
        } catch (err) {
          const msg =
            err instanceof Error
              ? err.name === "AbortError"
                ? `Request timed out after ${args.timeout_ms}ms`
                : err.message
              : String(err);
          return { output: `Error fetching ${args.url}: ${msg}`, metadata: { error: true } };
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          return {
            output: `HTTP ${response.status} ${response.statusText} — ${args.url}`,
            metadata: { error: true, status: response.status },
          };
        }

        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();

        let content: string;
        let title: string | undefined;

        if (args.raw_html || !contentType.includes("html")) {
          content = body;
        } else {
          title = extractTitle(body);
          content = extractText(body);
        }

        const truncated = content.length > args.max_length;
        const output = truncated ? content.slice(0, args.max_length) + "\n\n[... truncated]" : content;

        const render: ToolRenderPayload = {
          version: 1,
          blocks: [
            {
              type: "key_value",
              title: title ?? new URL(args.url).hostname,
              items: [
                { key: "url", value: args.url },
                { key: "status", value: String(response.status) },
                { key: "content-type", value: contentType.split(";")[0] },
                { key: "length", value: `${content.length.toLocaleString()} chars${truncated ? " (truncated)" : ""}` },
              ],
            },
            {
              type: "list",
              title: "Content preview",
              items: output.split("\n").slice(0, 8).filter(Boolean),
            },
          ],
        };

        return { output, render };
      },
    },
  ];
}
