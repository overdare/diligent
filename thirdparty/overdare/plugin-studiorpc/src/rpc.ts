import net from "node:net"
import readline from "node:readline"
import { loadOverdareConfig } from "./config.ts"

const DEFAULT_HOST = "localhost"
const DEFAULT_PORT = 13377
const TIMEOUT_MS = 10_000

interface JsonRpcResponse {
  jsonrpc: string
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

let nextId = 1

/**
 * Resolve Studio RPC host.
 * Priority: STUDIO_HOST env var > config file > DEFAULT_HOST.
 */
function resolveHost(): string {
  if (process.env.STUDIO_HOST) return process.env.STUDIO_HOST
  const cfg = loadOverdareConfig()
  return cfg.host ?? DEFAULT_HOST
}

/**
 * Resolve Studio RPC port.
 * Priority: STUDIO_PORT env var > config file > DEFAULT_PORT.
 */
function resolvePort(): number {
  const envPort = process.env.STUDIO_PORT
  if (envPort) {
    const parsed = Number(envPort)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  const cfg = loadOverdareConfig()
  return cfg.port ?? DEFAULT_PORT
}

/**
 * Send a JSON-RPC 2.0 request over a TCP socket to OVERDARE Studio.
 *
 * Configuration (in priority order):
 *   1. STUDIO_HOST / STUDIO_PORT environment variables
 *   2. ~/.diligent/@overdare.jsonc config file
 *   3. Hard-coded defaults: localhost:13377
 */
export async function call(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const host = resolveHost()
  const port = resolvePort()

  return new Promise((resolve, reject) => {
    const id = nextId++
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined && Object.keys(params).length > 0 && { params }),
    }

    const socket = net.createConnection({ host, port }, () => {
      socket.write(JSON.stringify(request) + "\n")
    })

    const rl = readline.createInterface({ input: socket })

    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Studio RPC request timed out after ${TIMEOUT_MS / 1000}s.\n` +
            `Method: ${method}\n` +
            `Server: ${host}:${port}\n` +
            `Make sure OVERDARE Studio is running with the RPC server enabled.`,
        ),
      )
    }, TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timer)
      rl.close()
      socket.destroy()
    }

    rl.once("line", (line) => {
      cleanup()
      try {
        const response = JSON.parse(line) as JsonRpcResponse
        if (response.error) {
          let errorMsg = `Studio RPC error [${response.error.code}]: ${response.error.message}`
          if (
            response.error.message?.toLowerCase().includes("guid")
          ) {
            errorMsg += `\n\nTip: Use studiorpc_level_browse first to get valid GUIDs.`
          }
          reject(new Error(errorMsg))
        } else {
          resolve(response.result)
        }
      } catch {
        reject(
          new Error(
            `Failed to parse Studio RPC response.\n` +
              `Received: ${line.substring(0, 200)}\n` +
              `This may indicate a protocol mismatch or server error.`,
          ),
        )
      }
    })

    socket.on("error", (err: Error & { code?: string }) => {
      cleanup()
      let errorMsg = `Could not connect to Studio RPC server at ${host}:${port}.`
      if (err.code === "ECONNREFUSED") {
        errorMsg +=
          `\n\nMake sure OVERDARE Studio is running with the RPC server enabled.` +
          `\n\nTo use a custom host/port, set environment variables:` +
          `\n  STUDIO_HOST=${host}` +
          `\n  STUDIO_PORT=${port}`
      } else if (err.code === "ETIMEDOUT") {
        errorMsg += `\n\nConnection timed out. Check your network or firewall settings.`
      } else {
        errorMsg += `\n\nError: ${err.message}`
      }
      reject(new Error(errorMsg))
    })
  })
}
