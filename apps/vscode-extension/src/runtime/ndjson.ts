// @summary Local NDJSON framing helpers for the VS Code extension stdio RPC client
import type { JSONRPCMessage } from "@diligent/protocol";
import { JSONRPCMessageSchema } from "@diligent/protocol";

export interface NdjsonParser {
  push(chunk: string): void;
  end(): void;
}

export function createNdjsonParser(onMessage: (message: JSONRPCMessage) => void): NdjsonParser {
  let buffer = "";

  const flushLine = (line: string): void => {
    if (!line) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON frame: ${error instanceof Error ? error.message : String(error)}`);
    }

    const parsed = JSONRPCMessageSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`Invalid JSON-RPC frame: ${parsed.error.message}`);
    }

    onMessage(parsed.data);
  };

  return {
    push(chunk: string): void {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        flushLine(line);
      }
    },

    end(): void {
      const line = buffer.trim();
      buffer = "";
      flushLine(line);
    },
  };
}

export function formatNdjsonMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`;
}
