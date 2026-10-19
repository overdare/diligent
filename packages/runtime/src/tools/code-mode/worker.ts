// @summary Code mode guest bootstrap: runs in a Bun Worker and evaluates one exec script in a node:vm context

import type * as NodeVm from "node:vm";

/**
 * Messages the host sends to the worker. `store` values are JSON text so the guest parses them in its own realm.
 */
export type CodeModeHostMessage =
  | {
      type: "start";
      code: string;
      tools: Array<{ globalName: string; name: string; description: string }>;
      store: Record<string, string>;
    }
  | { type: "tool_result"; id: number; ok: true; value: string }
  | { type: "tool_result"; id: number; ok: false; error: string };

/** Messages the worker sends to the host. */
export type CodeModeWorkerMessage =
  | { type: "tool_call"; id: number; name: string; input: unknown }
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string }
  | { type: "store"; key: string; value: string }
  | { type: "yield" }
  | { type: "done"; error?: string };

/**
 * Worker entrypoint. Serialized with `Function#toString` into a Blob worker so single-file
 * `bun build --compile` binaries need no extra entrypoint; it must not reference module scope.
 * `node:vm` keeps Bun/Node globals out of the guest realm, but it is not a security boundary.
 */
export function codeModeWorkerMain(): void {
  const vm = process.getBuiltinModule("node:vm") as typeof NodeVm;
  const send = (message: CodeModeWorkerMessage) => postMessage(message);
  const pending = new Map<number, { resolve: (value: string) => void; reject: (error: unknown) => void }>();
  const exitSignal = Symbol("exit");
  let finished = false;
  let nextCallId = 0;

  const stringify = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      const json = JSON.stringify(value);
      if (json !== undefined) return json;
    } catch {
      // Fall through to String() for cyclic or non-serializable values.
    }
    return String(value);
  };

  const describeError = (error: unknown): string => {
    if (error && typeof error === "object") {
      const { name, message, stack } = error as { name?: unknown; message?: unknown; stack?: unknown };
      const header =
        typeof message === "string" ? `${typeof name === "string" ? name : "Error"}: ${message}` : undefined;
      const frames =
        typeof stack === "string"
          ? stack
              .split("\n")
              .filter((line) => line.includes("exec.js"))
              .map((line) => line.trim())
          : [];
      if (header) return [header, ...frames.map((frame) => `    ${frame}`)].join("\n");
    }
    return stringify(error);
  };

  const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;

  // Bun's SyntaxError carries only the line, so the location is recovered with Bun's own parser.
  const describeSyntaxError = (code: string, prefix: string, error: unknown): string => {
    const message = field(error, "message");
    const header = `SyntaxError: ${typeof message === "string" ? message : String(error)}`;
    let location: { line: number; column?: number; detail?: string } | undefined;
    try {
      new Bun.Transpiler({ loader: "js" }).transformSync(`${prefix}${code}\n})()`);
    } catch (parseError) {
      const errors = field(parseError, "errors");
      const first = Array.isArray(errors) ? errors[0] : parseError;
      const position = field(first, "position");
      const line = field(position, "line");
      const column = field(position, "column");
      const detail = field(first, "message");
      if (typeof line === "number" && typeof column === "number") {
        location = {
          line,
          column: Math.max(1, line === 1 ? column - prefix.length : column),
          ...(typeof detail === "string" ? { detail } : {}),
        };
      }
    }
    const engineLine = field(error, "line");
    if (!location && typeof engineLine === "number" && engineLine > 0) location = { line: engineLine };
    const lines = code.split("\n");
    // Errors at end of input point at the wrapper's closing line; report the last source line instead.
    if (location && location.line > lines.length) location = { line: lines.length, detail: location.detail };
    const out = [header];
    if (location) {
      const at = `exec.js:${location.line}${location.column ? `:${location.column}` : ""}`;
      out.push(`    at ${at}${location.detail ? ` (${location.detail})` : ""}`);
      const width = String(location.line).length;
      const clip = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}...` : text);
      if (location.line > 1) {
        out.push(`  ${String(location.line - 1).padStart(width)} | ${clip(lines[location.line - 2])}`);
      }
      out.push(`  ${location.line} | ${clip(lines[location.line - 1])}`);
      if (location.column && location.column <= 157) {
        out.push(`  ${" ".repeat(width)} | ${" ".repeat(location.column - 1)}^`);
      }
    }
    if (/Unterminated string|Unexpected EOF/.test(`${header} ${location?.detail ?? ""}`)) {
      out.push(
        "Hint: a \"...\" or '...' string cannot contain a raw line break. Use a template literal (`...`) for multi-line text (escape ` and ${ inside it), or write \\n.",
      );
    }
    return out.join("\n");
  };

  const finish = (error?: string) => {
    if (finished) return;
    finished = true;
    send(error === undefined ? { type: "done" } : { type: "done", error });
  };

  const run = (start: Extract<CodeModeHostMessage, { type: "start" }>) => {
    const context = vm.createContext({});
    const GuestPromise = vm.runInContext("Promise", context) as PromiseConstructor;
    const GuestError = vm.runInContext("Error", context) as ErrorConstructor;
    const guestJson = vm.runInContext("JSON", context) as JSON;
    const store = new Map(Object.entries(start.store));
    const timers = new Map<number, Timer>();
    let nextTimerId = 0;

    const tools: Record<string, (input?: unknown) => Promise<string>> = Object.create(null);
    for (const tool of start.tools) {
      tools[tool.globalName] = (input?: unknown) => {
        // Guest-realm promise and errors so `instanceof Promise/Error` behave inside the script.
        const { promise, resolve, reject } = GuestPromise.withResolvers<string>();
        if (finished) {
          reject(new GuestError("exec cell has finished"));
          return promise;
        }
        let wireInput: unknown;
        try {
          wireInput = input === undefined ? {} : JSON.parse(JSON.stringify(input));
        } catch (error) {
          reject(new GuestError(`tools.${tool.globalName}: input must be JSON-serializable (${String(error)})`));
          return promise;
        }
        const id = nextCallId++;
        pending.set(id, { resolve, reject: (message) => reject(new GuestError(String(message))) });
        send({ type: "tool_call", id, name: tool.name, input: wireInput });
        return promise;
      };
    }

    Object.assign(context, {
      tools: Object.freeze(tools),
      ALL_TOOLS: guestJson.parse(
        JSON.stringify(start.tools.map(({ globalName, description }) => ({ name: globalName, description }))),
      ),
      text: (value: unknown) => {
        if (!finished) send({ type: "text", text: stringify(value) });
      },
      image: (value: unknown) => {
        const imageUrl =
          typeof value === "string"
            ? value
            : value && typeof value === "object" && typeof (value as { image_url?: unknown }).image_url === "string"
              ? (value as { image_url: string }).image_url
              : undefined;
        if (imageUrl === undefined) throw new GuestError("image() expects a data: URL string or { image_url }");
        if (!finished) send({ type: "image", imageUrl });
      },
      exit: () => {
        finish();
        throw exitSignal;
      },
      store: (key: unknown, value: unknown) => {
        if (typeof key !== "string") throw new GuestError("store() key must be a string");
        const json = JSON.stringify(value);
        if (json === undefined) throw new GuestError("store() value must be JSON-serializable");
        store.set(key, json);
        send({ type: "store", key, value: json });
      },
      load: (key: unknown) => {
        const json = typeof key === "string" ? store.get(key) : undefined;
        return json === undefined ? undefined : guestJson.parse(json);
      },
      yield_control: () => {
        if (!finished) send({ type: "yield" });
      },
      setTimeout: (callback: unknown, delayMs?: unknown) => {
        if (typeof callback !== "function") throw new GuestError("setTimeout() callback must be a function");
        const id = ++nextTimerId;
        timers.set(
          id,
          setTimeout(
            () => {
              timers.delete(id);
              callback();
            },
            typeof delayMs === "number" ? delayMs : 0,
          ),
        );
        return id;
      },
      clearTimeout: (id?: unknown) => {
        if (typeof id !== "number") return;
        clearTimeout(timers.get(id));
        timers.delete(id);
      },
    });
    // Bun's vm exposes `console` by default; the guest contract has none (use text()).
    vm.runInContext("delete globalThis.console", context);
    let completion: unknown;
    // The leading await moves the body out of the synchronous runInContext frame: Bun 1.3 crashes the
    // process when a worker is terminated while blocked inside runInContext (e.g. `while (true) {}`).
    // The prefix shares line 1 so reported line numbers match the model's source (Bun ignores lineOffset).
    const prefix = "(async () => { await undefined; ";
    try {
      const script = new vm.Script(`${prefix}${start.code}\n})()`, { filename: "exec.js" });
      completion = script.runInContext(context);
    } catch (error) {
      // The body runs after the leading await, so a synchronous throw here is a parse error.
      finish(
        field(error, "name") === "SyntaxError" ? describeSyntaxError(start.code, prefix, error) : describeError(error),
      );
      return;
    }
    Promise.resolve(completion).then(
      (value) => {
        if (value !== undefined && !finished) send({ type: "text", text: stringify(value) });
        finish();
      },
      (error) => finish(error === exitSignal ? undefined : describeError(error)),
    );
  };

  self.onmessage = (event: MessageEvent<CodeModeHostMessage>) => {
    const message = event.data;
    if (message.type === "start") {
      run(message);
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.ok) call.resolve(message.value);
    else call.reject(message.error);
  };
}
