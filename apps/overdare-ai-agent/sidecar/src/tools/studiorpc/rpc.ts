import net from "node:net";
import readline from "node:readline";
import { createLogger } from "@diligent/logging";
import { resolveStudioHost, resolveStudioPort } from "./config";
import { studioRpcCallOptions } from "./rpc-context";

const DEFAULT_TIMEOUT_MS = 10_000;
const logger = createLogger({ scope: "sidecar/studiorpc", context: { component: "rpc" } });

export interface StudioRpcCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  sessionId?: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
export class StudioRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "StudioRpcError";
  }
}

export interface StudioRpcTransportDiagnostics {
  reason: "timeout" | "socketError" | "connectionClosed" | "invalidResponse";
  phase: "connecting" | "awaitingResponse";
  method: string;
  requestId: number;
  host: string;
  port: number;
  elapsedMs: number;
  executionOutcome: "notSent" | "unknown";
  socketCode?: string;
}

/** Client transport failures cannot establish whether Studio executed a sent request. */
export class StudioRpcTransportError extends Error {
  constructor(readonly data: StudioRpcTransportDiagnostics) {
    const summary =
      data.reason === "timeout"
        ? `Studio RPC timed out (${data.method}).`
        : data.reason === "invalidResponse"
          ? `Invalid Studio RPC response (${data.method}).`
          : data.reason === "connectionClosed"
            ? `Studio RPC connection closed before a response (${data.method}).`
            : `Could not connect to Studio RPC server (${data.method}).`;
    super(
      `${summary}\n${JSON.stringify(data)}\n` +
        (data.executionOutcome === "notSent"
          ? "The request was not sent. Check the Studio listener, host, port, and network connection."
          : "The request was sent; execution outcome is unknown. Do not replay writes or input until the current Studio state is inspected. Check Studio responsiveness and the RPC connection."),
    );
    this.name = "StudioRpcTransportError";
  }
}

/** Studio's code for a GUID that names no instance. */
export const RPC_INSTANCE_NOT_FOUND = -32004;

let nextId = 1;
function renderMeasurements(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const sections: string[] = [];
  for (const key of ["waits", "looks", "pointerTargets"] as const) {
    const value = record[key];
    if (Array.isArray(value) && value.length > 0) {
      sections.push(`${key} that completed before the failure:\n${JSON.stringify(value, null, 2)}`);
    }
  }
  return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}
function renderReason(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const reason = (data as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.length > 0 ? `\n\nReason: ${reason}` : "";
}
export async function applyLevelChanges(): Promise<unknown> {
  return call("level.apply", {});
}

export async function call(
  method: string,
  params?: Record<string, unknown>,
  options: StudioRpcCallOptions = {},
): Promise<unknown> {
  options = studioRpcCallOptions(options);
  const host = resolveStudioHost();
  const port = resolveStudioPort();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  options.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const id = nextId++;
    const startedAt = Date.now();
    let sent = false;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      meta: { sessionId: options.sessionId },
      ...(params !== undefined && Object.keys(params).length > 0 && { params }),
    };
    let settled = false;
    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      fn();
    }
    const connectHost = host === "localhost" ? "127.0.0.1" : host;
    const rawRequest = JSON.stringify(request);
    logger.debug("request.sent", {
      message: `[RPC →] ${method} (${rawRequest.length} bytes)`,
      fields: { id, method, bytes: rawRequest.length },
    });
    const socket = net.createConnection({ host: connectHost, port }, () => {
      sent = true;
      socket.write(`${rawRequest}\n`);
    });

    const rl = readline.createInterface({ input: socket });

    const transportFailure = (reason: StudioRpcTransportDiagnostics["reason"], socketCode?: string) => {
      settle(() => {
        cleanup();
        reject(
          new StudioRpcTransportError({
            reason,
            phase: sent ? "awaitingResponse" : "connecting",
            method,
            requestId: id,
            host,
            port,
            elapsedMs: Date.now() - startedAt,
            executionOutcome: sent ? "unknown" : "notSent",
            ...(socketCode ? { socketCode } : {}),
          }),
        );
      });
    };
    const timer = setTimeout(() => transportFailure("timeout"), timeoutMs);

    const onAbort = () => {
      settle(() => {
        cleanup();
        reject(options.signal?.reason ?? new DOMException("Studio RPC call aborted", "AbortError"));
      });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    function cleanup() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      rl.close();
      socket.destroy();
    }

    rl.once("line", (line) => {
      let response: JsonRpcResponse;
      try {
        response = JSON.parse(line) as JsonRpcResponse;
        if (
          !response ||
          response.jsonrpc !== "2.0" ||
          response.id !== id ||
          "result" in response === "error" in response ||
          ("error" in response &&
            (!response.error || !Number.isInteger(response.error.code) || typeof response.error.message !== "string"))
        ) {
          transportFailure("invalidResponse");
          return;
        }
      } catch {
        transportFailure("invalidResponse");
        return;
      }
      settle(() => {
        cleanup();
        logger.debug("response.received", {
          message: `[RPC ←] ${method} (${line.length} bytes)`,
          fields: { id, method, bytes: line.length },
        });
        if (response.error) {
          let errorMsg = `Studio RPC error [${response.error.code}]: ${response.error.message}`;
          errorMsg += renderReason(response.error.data);
          errorMsg += renderMeasurements(response.error.data);
          errorMsg += `\n\nRequest method: ${method} (id ${id})`;
          if (response.error.message?.toLowerCase().includes("guid")) {
            errorMsg += `\n\nTip: Use studiorpc_level_browse first to get valid GUIDs.`;
          }
          reject(new StudioRpcError(errorMsg, response.error.code, response.error.data));
        } else {
          resolve(response.result);
        }
      });
    });

    // readline forwards input errors; handle both surfaces without an unhandled interface error.
    rl.on("error", (error: NodeJS.ErrnoException) => transportFailure("socketError", error.code));
    socket.on("error", (error: NodeJS.ErrnoException) => transportFailure("socketError", error.code));
    socket.on("end", () => transportFailure("connectionClosed"));
    socket.on("close", () => transportFailure("connectionClosed"));
  });
}
