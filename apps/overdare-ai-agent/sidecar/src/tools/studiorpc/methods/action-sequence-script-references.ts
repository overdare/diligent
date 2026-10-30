// @summary Checks literal ActionRunner and ActionSequence signal references through the script_grep traversal.
import { resolveApiVersion } from "../config";
import type { call } from "../rpc";
import { type OvdrjmNode, readOvdrjmRoot } from "../tools/ovdrjm-utils";
import { countScripts, grepSubtree, MAX_MATCHES, type MatchLine } from "../tools/script-grep-tool";
import { isRecord } from "./action-sequence-shared";

type RecordValue = Record<string, unknown>;
const methods = new Map([
  ["TriggerStarted", (name: string) => `Trigger_${name}_Start`],
  ["TriggerEnded", (name: string) => `Trigger_${name}_End`],
  ["Hit", (name: string) => `Collision_${name}`],
  ["GetMarkerReachedSignal", (name: string) => `Event_${name}`],
]);
const pattern = /[.:](?:Play|TriggerStarted|TriggerEnded|Hit|GetMarkerReachedSignal)\s*\(/;

function walk(node: OvdrjmNode, visit: (node: OvdrjmNode) => void): void {
  visit(node);
  if (Array.isArray(node.LuaChildren)) for (const child of node.LuaChildren) if (isRecord(child)) walk(child, visit);
}

function emittedSignals(data: RecordValue): Set<string> {
  const signals = new Set<string>();
  if (!Array.isArray(data.Tracks)) return signals;
  for (const track of data.Tracks) {
    if (!isRecord(track) || typeof track.Class !== "string") continue;
    if (track.Class.endsWith("TriggerTrack") && typeof track.TriggerName === "string") {
      signals.add(`Trigger_${track.TriggerName}_Start`);
      signals.add(`Trigger_${track.TriggerName}_End`);
    }
    const event = track.Class.endsWith("EventTrack");
    const group = event ? track.Markers : track.KeyframeTriggers;
    if (!isRecord(group) || !Array.isArray(group.channels)) continue;
    for (const channel of group.channels) {
      if (!isRecord(channel) || !Array.isArray(channel.keyframes)) continue;
      for (const key of channel.keyframes)
        if (isRecord(key) && typeof key.value === "string")
          signals.add(`${event ? "Event" : "Collision"}_${key.value}`);
    }
  }
  return signals;
}

function literals(line: string): { method: string; name: string; receiver: string }[] {
  // Strings are single tokens, so code mentioned inside a string cannot become a reference.
  const tokens = line.match(/--.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|[.:()]/g) ?? [];
  const refs: { method: string; name: string; receiver: string }[] = [];
  for (let i = 2; i + 2 < tokens.length; i++) {
    if (tokens[i].startsWith("--")) break;
    const literal = tokens[i + 2];
    if ((tokens[i - 1] !== ":" && tokens[i - 1] !== ".") || tokens[i + 1] !== "(" || !/^["']/.test(literal)) continue;
    if (tokens[i] !== "Play" && !methods.has(tokens[i])) continue;
    // Generic Sound/Animation Play calls are not ActionRunner references. Unknown receiver aliases remain unchecked.
    if (tokens[i] === "Play" && !/runner/i.test(tokens[i - 2])) continue;
    const name = literal.slice(1, -1);
    if (name.includes("\\")) continue; // Escaped/dynamic names require a Lua-aware review.
    refs.push({ method: tokens[i], name, receiver: tokens[i - 2] });
  }
  return refs;
}

function maskLongText(source: string): string {
  let masked = "";
  for (let i = 0; i < source.length; ) {
    const long = source[i] === "[" || source.startsWith("--[", i) ? /^(?:--)?\[(=*)\[/.exec(source.slice(i)) : null;
    if (long) {
      const end = source.indexOf(`]${long[1]}]`, i + long[0].length);
      const to = end < 0 ? source.length : end + long[1].length + 2;
      masked += source.slice(i, to).replace(/[^\n]/g, " ");
      i = to;
    } else if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i);
      const to = end < 0 ? source.length : end;
      masked += source.slice(i, to);
      i = to;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let to = i + 1;
      while (to < source.length) {
        if (source[to] === "\\") {
          to += 2;
          continue;
        }
        if (source[to++] === quote) break;
      }
      masked += source.slice(i, to);
      i = to;
    } else masked += source[i++];
  }
  return masked;
}
function grepTree(node: OvdrjmNode): OvdrjmNode {
  return {
    ...node,
    ...(typeof node.Source === "string" ? { Source: maskLongText(node.Source) } : {}),
    ...(Array.isArray(node.LuaChildren) ? { LuaChildren: node.LuaChildren.filter(isRecord).map(grepTree) } : {}),
  };
}

function executableSource(source: string): string {
  return maskLongText(source).replace(/--[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (token) =>
    token.startsWith("--") ? " ".repeat(token.length) : token,
  );
}

/** Recognize the existing TPA wiring, not a module name elsewhere in the level. */
function tpaAdvice(root: OvdrjmNode, targetGuid: string, proposed?: RecordValue): RecordValue[] {
  let target: OvdrjmNode | undefined;
  let storage: OvdrjmNode | undefined;
  walk(root, (node) => {
    if (node.ActorGuid === targetGuid && node.InstanceType === "ActionSequence") target = node;
    if (node.InstanceType === "ServerStorage") storage = node;
  });
  if (!target || !storage || !Array.isArray(target.LuaChildren)) return [];
  let controller: OvdrjmNode | undefined = storage;
  for (const name of ["Module", "Controller", "SequenceController"]) {
    controller = Array.isArray(controller?.LuaChildren)
      ? controller.LuaChildren.find((node) => isRecord(node) && node.Name === name)
      : undefined;
  }
  if (controller?.InstanceType !== "ModuleScript" || typeof controller.Source !== "string") return [];
  const source = executableSource(controller.Source);
  const codeOnly = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (token) => " ".repeat(token.length));
  const controllerAlias = /^[ \t]*function\s+(\w+)\.Bind\s*\(\s*runtimeScript\b/m.exec(codeOnly)?.[1];
  if (!controllerAlias) return [];
  const called = (method: string) => new RegExp(`^[ \\t]*${controllerAlias}\\.${method}\\s*\\(`, "m").test(codeOnly);
  const callsMethod = (method: string) => new RegExp(`:\\s*${method}\\s*\\(`).test(codeOnly);
  const subscriptions = source
    .split("\n")
    .flatMap((line, index) => literals(line).map((reference) => ({ ...reference, line: index + 1 })));
  const codeLines = codeOnly.split("\n");
  const subscription = (helper: string, method: string, name: string) => {
    const start = codeLines.findIndex((line) =>
      new RegExp(`^[ \\t]*function\\s+${controllerAlias}\\.${helper}\\s*\\(`).test(line),
    );
    if (start < 0) return undefined;
    const next = codeLines.findIndex((line, index) => index > start && /^[ \t]*function\s/.test(line));
    return subscriptions.find(
      (ref) => ref.method === method && ref.name === name && ref.line > start + 1 && (next < 0 || ref.line <= next),
    );
  };
  const sequenceEnd = subscription("_bindSequenceEnd", "TriggerEnded", "Sequence");
  if (!called("_bindSequenceEnd") || !sequenceEnd || !callsMethod("OnSequenceEnd")) return [];
  const expectedPath =
    'game:GetService("ServerStorage"):WaitForChild("Module"):WaitForChild("Controller"):WaitForChild("SequenceController")';
  let binding: { script: RecordValue; line: number } | undefined;
  for (const child of target.LuaChildren) {
    if (!isRecord(child) || child.InstanceType !== "Script" || typeof child.Source !== "string") continue;
    const code = executableSource(child.Source);
    for (const match of code.matchAll(/^[ \t]*local\s+(\w+)\s*=\s*require\s*\((.*)\)[ \t]*;?[ \t]*$/gm)) {
      const requiredPath = match[2].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\s+/g, (token) =>
        token.startsWith("'") ? `"${token.slice(1, -1)}"` : token.startsWith('"') ? token : "",
      );
      if (requiredPath !== expectedPath) continue;
      const call = new RegExp(`^[ \\t]*${match[1]}\\.Bind\\s*\\(\\s*script\\s*\\)[ \\t]*;?[ \\t]*$`, "m").exec(code);
      if (call) binding = { script: child, line: code.slice(0, call.index).split("\n").length };
    }
  }
  if (!binding) return [];
  let data: RecordValue;
  try {
    data = proposed ?? JSON.parse(String(target.Data));
  } catch {
    return [];
  }
  if (!isRecord(data) || !Array.isArray(data.Tracks) || typeof data.Length !== "number") return [];
  const rows: RecordValue[] = data.Tracks.flatMap((row, trackIndex) => (isRecord(row) ? [{ ...row, trackIndex }] : []));
  const targetName = target.Name;
  const triggers = (name: string) =>
    rows.filter(
      (row) =>
        typeof row.Class === "string" &&
        row.Class.endsWith("TriggerTrack") &&
        row.TriggerName === name &&
        row.IsEnable !== false,
    );
  const sequence = triggers("Sequence"),
    input = triggers("KeyInput"),
    cancel = triggers("CancelWindow");
  const issues: RecordValue[] = [];
  const add = (kind: string, message: string, row?: RecordValue, reference = sequenceEnd) =>
    issues.push({
      kind,
      severity: "info",
      trackIndex: row?.trackIndex ?? -1,
      TrackID: row?.TrackID,
      message: `${message} TPA configuration and runtime flow are not evaluated; verify the intended binding.`,
      evidence: {
        convention: "TPA",
        targetGuid,
        configuration: "notEvaluated",
        bindingScriptGuid: binding.script.ActorGuid,
        bindingScriptName: binding.script.Name,
        bindingPath: `${targetName}.${binding.script.Name}`,
        bindingLine: binding.line,
        controllerGuid: controller.ActorGuid,
        controllerPath: "ServerStorage.Module.Controller.SequenceController",
        controllerLine: reference.line,
        controllerMethod: reference.method,
        controllerSignal: reference.name,
      },
    });
  if (!sequence.length)
    add(
      "missingSequenceTrigger",
      "The detected controller subscribes to Sequence end, but this asset has no enabled Sequence interval.",
    );
  for (const row of sequence) {
    const end = row.EndTime;
    if (
      typeof end === "number" &&
      rows.some((other) => other.IsEnable !== false && typeof other.EndTime === "number" && other.EndTime > end + 1e-5)
    )
      add("sequenceEndsEarly", "Sequence end can run controller cleanup before other tracks finish.", row);
  }
  const cancelStart = subscription("_bindCancelWindow", "TriggerStarted", "CancelWindow");
  const cancelEnd = subscription("_bindCancelWindow", "TriggerEnded", "CancelWindow");
  const inputStart = subscription("_bindCombo", "TriggerStarted", "KeyInput");
  const inputEnd = subscription("_bindCombo", "TriggerEnded", "KeyInput");
  const hasCancel = called("_bindCancelWindow") && cancelStart && cancelEnd && callsMethod("ClearCancelable");
  if (hasCancel)
    for (const row of cancel) {
      if (typeof row.EndTime === "number" && Math.abs(row.EndTime - data.Length) > 1e-5)
        add(
          "cancelWindowNotAtEnd",
          "CancelWindow closes before the asset ends; this may be intentional for general cancellation.",
          row,
          cancelEnd,
        );
    }
  const hasCombo =
    called("_bindCombo") &&
    inputStart &&
    inputEnd &&
    callsMethod("ClearComboReady") &&
    callsMethod("AdvanceComboImmediate");
  if (hasCancel && hasCombo) {
    if (Boolean(input.length) !== Boolean(cancel.length))
      add(
        "cancelInputPair",
        "Only one TPA input/cancel interval is present; sequence-end combos or general cancel may use this deliberately.",
        undefined,
        inputEnd,
      );
    if (input.length)
      for (const row of cancel) {
        const start = row.StartTime;
        if (
          typeof start === "number" &&
          !input.some(
            (key) =>
              typeof key.StartTime === "number" &&
              typeof key.EndTime === "number" &&
              key.StartTime <= start &&
              key.EndTime > start,
          )
        )
          add(
            "cancelInputTiming",
            "No KeyInput interval is active when CancelWindow opens; an intended combo buffer may already be cleared.",
            row,
            cancelStart,
          );
      }
  }
  return issues;
}

export function checkScriptReferences(root: OvdrjmNode, targetGuid: string, proposed?: RecordValue) {
  const names = new Set<string>();
  const signals = new Set<string>();
  let complete = true;
  walk(root, (node) => {
    if (node.InstanceType !== "ActionSequence") return;
    if (typeof node.Name === "string") names.add(node.Name);
    try {
      const data = node.ActorGuid === targetGuid && proposed ? proposed : JSON.parse(String(node.Data));
      if (!isRecord(data)) {
        complete = false;
        return;
      }
      for (const signal of emittedSignals(data)) signals.add(signal);
    } catch {
      complete = false;
    }
  });
  const matches: MatchLine[] = [];
  const total = grepSubtree(grepTree(root), pattern, matches, MAX_MATCHES);
  const issues: RecordValue[] = [];
  let references = 0;
  for (const match of matches)
    for (const ref of literals(match.text)) {
      references++;
      const signal = methods.get(ref.method)?.(ref.name);
      const missing = signal ? complete && !signals.has(signal) : !names.has(ref.name);
      if (!missing) continue;
      issues.push({
        kind: signal ? "missingSignal" : "missingPlaySequence",
        severity: "warning",
        trackIndex: -1,
        message: signal
          ? "Literal subscription names a signal emitted by no ActionSequence in the level."
          : "Literal runner Play names no ActionSequence instance in the level.",
        evidence: {
          referencedName: ref.name,
          signal,
          receiver: ref.receiver,
          scriptGuid: match.scriptGuid,
          scriptName: match.scriptName,
          lineNum: match.lineNum,
          text: match.text,
          scope: "level",
        },
      });
    }
  return {
    issues: [...issues, ...tpaAdvice(root, targetGuid, proposed)],
    status: complete && total <= MAX_MATCHES ? "completed" : "partial",
    scriptsSearched: countScripts(root),
    literalReferences: references,
    limitations:
      "Static literal references only. Play receivers must contain 'runner'; aliases, computed names, runtime-created sequences and flow-dependent subscriptions need review. TPA advice requires a direct target Script's recognized require/Bind and resolved controller source; configuration is not evaluated. Incomplete or undetected wiring does not establish missing conventions.",
  };
}

export async function enrichScriptReferences(
  result: RecordValue,
  targetGuid: string,
  cwd: string,
  callRpc: typeof call,
  proposed?: RecordValue,
): Promise<RecordValue> {
  try {
    let root: OvdrjmNode;
    if (resolveApiVersion() === "v1") root = readOvdrjmRoot(cwd).root;
    else {
      const browsed = await callRpc("level.browse", {});
      if (!isRecord(browsed) || !Array.isArray(browsed.level)) throw new Error("level.browse returned no hierarchy");
      const children: OvdrjmNode[] = [];
      for (const entry of browsed.level) {
        if (!isRecord(entry) || typeof entry.ActorGuid !== "string") continue;
        const read = await callRpc("instance.read", { ActorGuid: entry.ActorGuid, Depth: -1 });
        if (!isRecord(read) || !isRecord(read.instance)) throw new Error("instance.read returned no subtree");
        children.push(read.instance);
      }
      root = { InstanceType: "DataModel", LuaChildren: children };
    }
    const status = checkScriptReferences(root, targetGuid, proposed);
    return {
      ...result,
      scriptReferenceCheck: status,
    };
  } catch (error) {
    return {
      ...result,
      scriptReferenceCheck: { status: "unavailable", reason: error instanceof Error ? error.message : String(error) },
    };
  }
}
