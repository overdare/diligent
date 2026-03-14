// @summary NDJSON framing helpers for transport-neutral JSON-RPC stream parsing and serialization

import { type JSONRPCMessage, JSONRPCMessageSchema } from "../protocol/index";

export interface NdjsonParser {
  push(chunk: string): void;
  end(): void;
}

export function createNdjsonParser(onMessage: (message: JSONRPCMessage) => void): NdjsonParser {
  let buffer = "";

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

        if (!line) {
          continue;
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
      }
    },

    end(): void {
      const line = buffer.trim();
      buffer = "";

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
    },
  };
}

export function formatNdjsonMessage(message: JSONRPCMessage): string {
  return `${JSON.stringify(message)}\n`;
}
