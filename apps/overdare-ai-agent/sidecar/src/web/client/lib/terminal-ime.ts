// @summary Keep Chromium's post-composition insertText from duplicating xterm's deferred IME commit.
import type { Terminal } from "@xterm/xterm";

export function installTerminalImeGuard(terminal: Terminal): () => void {
  const textarea = terminal.textarea;
  if (!textarea) return () => {};
  // xterm registers its own capture handlers on the textarea during open().
  // An ancestor capture handler must run first, regardless of registration order.
  const captureTarget = textarea.parentElement ?? textarea;
  let composing = false;
  let commitPending = false;
  let generation = 0;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  const clearCommit = () => {
    clearTimeout(commitTimer);
    commitPending = false;
    generation++;
  };
  const start = () => {
    clearCommit();
    composing = true;
  };
  const end = () => {
    composing = false;
    commitPending = true;
    const current = ++generation;
    // xterm's CompositionHelper still reads the actual textarea and sends the commit.
    // compositionend.data is unreliable when a Korean final consonant moves syllables.
    // The textarea determines the entire commit, including any trailing IME character.
    // Do not deduplicate PTY strings: repeated syllables and paste must remain untouched.
    // This bubble listener is installed after xterm's bubble listener in open(),
    // so its commit timer is already queued. Capture-listener microtasks can run
    // before xterm handles browser-dispatched events and cannot provide that order.
    queueMicrotask(() => {
      if (current === generation && commitPending) commitTimer = setTimeout(clearCommit, 0);
    });
  };
  const input = (event: Event) => {
    if (event.target !== textarea) return;
    const value = event as InputEvent;
    // Only suppress a commit actually owned by the observed composition lifecycle.
    // Embedded IMEs may tag direct insertions as composing without a preceding
    // compositionstart (for example after focus changed). xterm must handle them.
    if (value.inputType === "insertText" && (composing || commitPending)) event.stopImmediatePropagation();
  };
  const keypress = (event: KeyboardEvent) => {
    if (event.target !== textarea) return;
    if (composing || commitPending) event.stopImmediatePropagation();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.target !== textarea) return;
    const modifier =
      ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key) ||
      /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code) ||
      [16, 17, 18, 20, 91, 92, 93, 160, 161, 162, 163, 164, 165].includes(event.keyCode);
    const imeKey =
      event.isComposing ||
      event.key === "Process" ||
      event.key === "HangulMode" ||
      event.code === "Lang1" ||
      event.keyCode === 21 ||
      event.keyCode === 229;
    if (modifier || imeKey) {
      // Embedded Windows adapters can expose VK_LSHIFT/VK_RSHIFT (160/161)
      // instead of DOM Shift (16), or Process/0 instead of IME/229. xterm
      // only recognizes the numeric codes, ignoring key and isComposing, and
      // otherwise finalizes the unfinished syllable before compositionend.
      // Stop its JS handler while leaving native IME/default key processing intact.
      if (composing || commitPending) event.stopImmediatePropagation();
      return;
    }
    // A genuine next key lets xterm flush the previous composition before handling it.
    composing = false;
    clearCommit();
  };
  const blur = () => {
    composing = false;
    clearCommit();
  };
  textarea.addEventListener("compositionstart", start, true);
  textarea.addEventListener("compositionend", end);
  captureTarget.addEventListener("input", input, true);
  captureTarget.addEventListener("keypress", keypress as EventListener, true);
  captureTarget.addEventListener("keydown", keydown as EventListener, true);
  textarea.addEventListener("blur", blur, true);
  return () => {
    clearCommit();
    textarea.removeEventListener("compositionstart", start, true);
    textarea.removeEventListener("compositionend", end);
    captureTarget.removeEventListener("input", input, true);
    captureTarget.removeEventListener("keypress", keypress as EventListener, true);
    captureTarget.removeEventListener("keydown", keydown as EventListener, true);
    textarea.removeEventListener("blur", blur, true);
  };
}
