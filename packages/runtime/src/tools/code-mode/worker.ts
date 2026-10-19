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
    try {
      // The leading await moves the body out of the synchronous runInContext frame: Bun 1.3 crashes the
      // process when a worker is terminated while blocked inside runInContext (e.g. `while (true) {}`).
      // The prefix shares line 1 so reported line numbers match the model's source (Bun ignores lineOffset).
      const source = `(async () => { await undefined; ${start.code}\n})()`;
      const script = new vm.Script(source, { filename: "exec.js" });
      completion = script.runInContext(context);
    } catch (error) {
      finish(describeError(error));
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
