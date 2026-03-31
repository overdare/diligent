// @summary Desktop sidecar entry point: wraps createWebServer with parent-watchdog, log-file redirect, and signal cleanup
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createWebServer, parseArgs } from "./index";

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startParentWatchdog(parentPid?: number): (() => void) | null {
  if (!parentPid || !Number.isFinite(parentPid) || parentPid <= 0) {
    return null;
  }

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) {
      return;
    }

    console.error(`[Server] Parent process ${parentPid} is gone. Exiting sidecar.`);
    process.exit(0);
  }, 2000);

  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}

function enableProcessLogFile(logFile: string, baseDir: string): () => void {
  const resolvedPath = resolve(baseDir, logFile);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const stream = createWriteStream(resolvedPath, { flags: "a" });
  const originalStdoutWrite = process.stdout.write.bind(process.stdout) as typeof process.stdout.write;
  const originalStderrWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;

  let mirrorEnabled = true;
  let reportedStreamError = false;

  const reportStreamError = (error: unknown): void => {
    if (reportedStreamError) return;
    reportedStreamError = true;
    mirrorEnabled = false;
    const message = error instanceof Error ? error.message : String(error);
    originalStderrWrite(`[webserver-log] Failed to write log file ${resolvedPath}: ${message}\n`);
  };

  stream.on("error", reportStreamError);

  const mirrorWrite = (chunk: unknown, encoding?: unknown): void => {
    if (!mirrorEnabled) return;
    try {
      if (typeof chunk === "string") {
        if (typeof encoding === "string") {
          stream.write(chunk, encoding as BufferEncoding);
        } else {
          stream.write(chunk);
        }
        return;
      }
      if (chunk instanceof Uint8Array) {
        stream.write(chunk);
        return;
      }
      stream.write(String(chunk));
    } catch (error) {
      reportStreamError(error);
    }
  };

  process.stdout.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    mirrorWrite(chunk, typeof encoding === "function" ? undefined : encoding);
    return originalStdoutWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    mirrorWrite(chunk, typeof encoding === "function" ? undefined : encoding);
    return originalStderrWrite(chunk as never, encoding as never, cb as never);
  }) as typeof process.stderr.write;

  originalStdoutWrite(`[webserver-log] Mirroring stdout/stderr to ${resolvedPath}\n`);

  return () => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    stream.end();
  };
}

if (import.meta.main) {
  // Global safety net: plugins or internal code may throw uncaught errors or
  // unhandled promise rejections (e.g. Bun happy-eyeballs socket errors that
  // bypass user-level handlers).  Log and swallow — never crash the server.
  process.on("uncaughtException", (err) => {
    console.error("[Server] Uncaught exception (swallowed to keep server alive):", err?.message ?? err);
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error("[Server] Unhandled promise rejection (swallowed to keep server alive):", message);
  });

  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const cwd = process.cwd();
    const serverCwd = args.cwd ?? cwd;
    const logFile = args.logFile ?? process.env.DILIGENT_WEB_LOG_FILE;
    const cleanupLogFile = logFile ? enableProcessLogFile(logFile, serverCwd) : null;
    const cleanupParentWatchdog = startParentWatchdog(args.parentPid);

    createWebServer({
      port: args.port,
      dev: args.dev,
      cwd: serverCwd,
      distDir: args.distDir,
    })
      .then(({ server }) => {
        const cleanup = () => {
          cleanupParentWatchdog?.();
          cleanupLogFile?.();
        };

        process.once("exit", cleanup);
        process.once("SIGTERM", () => {
          cleanup();
          process.exit(0);
        });
        process.once("SIGINT", () => {
          cleanup();
          process.exit(0);
        });

        console.log(`DILIGENT_PORT=${server.port}`);
        console.log(`Diligent Web CLI server running at http://localhost:${server.port}`);
        console.log(`RPC endpoint: ws://localhost:${server.port}/rpc`);
      })
      .catch((error) => {
        cleanupParentWatchdog?.();
        cleanupLogFile?.();
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start web server: ${message}`);
        process.exit(1);
      });
  })();
}
