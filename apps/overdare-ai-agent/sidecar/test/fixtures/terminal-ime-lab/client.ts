// @summary Standalone IME comparison and bounded, explicitly exported local event traces.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { installTerminalImeGuard } from "../../../src/web/client/lib/terminal-ime";
import { TerminalRenderer } from "../../../src/web/client/lib/terminal-renderer";

const terminal = new Terminal({
  fontSize: 13,
  lineHeight: 1.2,
  fontFamily: '"Cascadia Code", "Consolas", "Noto Sans Mono", monospace',
  cursorBlink: true,
  cursorStyle: "bar",
  windowsPty: { backend: "conpty" },
  theme: { background: "#181b1f", foreground: "#ececee", cursor: "#3b82f6" },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.open(document.querySelector<HTMLElement>("#terminal")!);
const attachedOutput = new TerminalRenderer(terminal);
const textarea = terminal.textarea!;
// Match the product view: the server's authoritative headless terminal owns replies.
for (const identifier of [
  { final: "n" },
  { prefix: "?", final: "n" },
  { final: "c" },
  { prefix: ">", final: "c" },
  { prefix: "=", final: "c" },
  { final: "t" },
  { intermediates: "$", final: "p" },
  { prefix: "?", intermediates: "$", final: "p" },
  { prefix: ">", final: "q" },
])
  terminal.parser.registerCsiHandler(identifier, () => true);
for (const identifier of [
  { intermediates: "$", final: "q" },
  { intermediates: "+", final: "q" },
])
  terminal.parser.registerDcsHandler(identifier, () => true);
for (const identifier of [4, 10, 11, 12]) terminal.parser.registerOscHandler(identifier, (data) => data.includes("?"));
const trace: unknown[] = [];
let mode = "pty";
let socket: WebSocket;
let sessionId: string | null = null;
let controlToken = "";
let disposeGuard = installTerminalImeGuard(terminal);
const status = document.querySelector<HTMLOutputElement>("#status")!;
const events = document.querySelector<HTMLElement>("#events")!;
const geometry = document.querySelector<HTMLElement>("#geometry")!;
const backend = document.querySelector<HTMLSelectElement>("#backend")!;
const rect = (element: Element | null) => {
  const bounds = element?.getBoundingClientRect();
  return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
};
function position() {
  const b = terminal.buffer.active;
  return {
    cursorX: b.cursorX,
    cursorY: b.cursorY,
    baseY: b.baseY,
    viewportY: b.viewportY,
    cols: terminal.cols,
    rows: terminal.rows,
    textarea: rect(textarea),
    preedit: rect(terminal.element!.querySelector(".composition-view")),
  };
}
function record(kind: string, detail: unknown) {
  const item = { at: performance.now(), kind, detail, position: position() };
  trace.push(item);
  if (trace.length > 500) trace.shift();
  events.textContent = trace
    .slice(-14)
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}
// Capture before the guard/xterm handler. These traces intentionally include test text;
// they remain in this page until the user explicitly exports a JSON file.
for (const name of [
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "beforeinput",
  "input",
  "keydown",
  "keyup",
  "keypress",
  "blur",
  "focus",
]) {
  terminal.element!.addEventListener(
    name,
    (event) => {
      if (event.target !== textarea) return;
      const e = event as InputEvent & KeyboardEvent & CompositionEvent;
      record(name, {
        data: e.data,
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        inputType: e.inputType,
        isComposing: e.isComposing,
        value: textarea.value,
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      });
    },
    true,
  );
}
function send(data: string) {
  if (sessionId && socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "input", id: sessionId, data }));
}
terminal.onData((data) => {
  record("onData", data);
  if (mode === "local") terminal.write(data === "\r" ? "\r\n" : data === "\x7f" ? "\b \b" : data);
  else send(data);
});
terminal.onCursorMove(() => {
  geometry.textContent = JSON.stringify(position(), null, 2);
});
terminal.onRender(() => {
  geometry.textContent = JSON.stringify(position(), null, 2);
});
function resize() {
  if (mode === "attached") return;
  fit.fit();
  if (sessionId && socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "resize", id: sessionId, cols: terminal.cols, rows: terminal.rows }));
}
new ResizeObserver(resize).observe(document.querySelector("#terminal")!);
resize();
async function changeBackend() {
  backend.disabled = true;
  const previous = mode;
  mode = backend.value;
  try {
    const response = await fetch("/lab/control", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Lab-Token": controlToken },
      body: JSON.stringify({ mode: backend.value, cols: terminal.cols, rows: terminal.rows }),
    });
    if (!response.ok) throw new Error(await response.text());
    if (mode === "local") {
      terminal.reset();
      terminal.writeln("Local xterm echo — no PTY, no Claude.");
    }
    terminal.focus();
  } catch (error) {
    mode = previous;
    status.textContent = String(error);
  } finally {
    backend.disabled = false;
  }
}
backend.addEventListener("change", () => void changeBackend());
document.querySelector<HTMLInputElement>("#guard")!.addEventListener("change", (event) => {
  disposeGuard();
  disposeGuard = (event.target as HTMLInputElement).checked ? installTerminalImeGuard(terminal) : () => {};
  record("guard", (event.target as HTMLInputElement).checked);
  terminal.focus();
});
document.querySelector("#park")!.addEventListener("click", () => {
  if (mode === "pty") send("\x10");
  terminal.focus();
});
document.querySelector("#redraw")!.addEventListener("click", () => {
  send("\x0c");
  terminal.focus();
});
document.querySelector("#clear")!.addEventListener("click", () => {
  trace.length = 0;
  events.textContent = "";
  terminal.focus();
});
document.querySelector("#export")!.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify({ userAgent: navigator.userAgent, devicePixelRatio, mode, trace }, null, 2)], {
      type: "application/json",
    }),
  );
  link.download = "terminal-ime-trace.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});
const bootstrap = await (await fetch("/claude/bootstrap")).json();
const info = await (await fetch("/lab/info")).json();
controlToken = info.token;
mode = backend.value = info.mode;
if (mode === "attached") {
  backend.add(new Option("Attached to existing Claude (same process, fixed shared grid)", "attached"));
  backend.value = "attached";
  backend.disabled = true;
  for (const id of ["park", "redraw"]) document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = true;
  const region = document.querySelector<HTMLElement>("#terminal")!;
  region.style.overflow = "auto";
}
socket = new WebSocket(bootstrap.wsUrl, ["overdare-terminal", bootstrap.token]);
socket.binaryType = "arraybuffer";
socket.onopen = () => {
  if (["running", "starting"].includes(bootstrap.status?.state)) {
    resize();
    terminal.focus();
  } else if (mode !== "attached") void changeBackend();
  else status.textContent = "Source terminal is not running. Start it in Studio before comparing.";
};
socket.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    if (mode === "attached") attachedOutput.write(new Uint8Array(event.data));
    else if (mode !== "local") terminal.write(new Uint8Array(event.data));
    return;
  }
  const message = JSON.parse(event.data);
  if (message.type === "reset") {
    if (mode === "attached") attachedOutput.reset(message.cols, message.rows);
    else {
      terminal.reset();
      terminal.resize(message.cols, message.rows);
    }
  }
  if (message.type === "resize" && mode === "attached") attachedOutput.resize(message.cols, message.rows);
  if (message.type === "status") {
    sessionId = message.status.id;
    status.textContent = `${mode}: ${message.status.state}`;
  }
  if (message.type === "error") status.textContent = message.message;
};
socket.onclose = () => {
  status.textContent = "Disconnected — reload to reconnect";
};
