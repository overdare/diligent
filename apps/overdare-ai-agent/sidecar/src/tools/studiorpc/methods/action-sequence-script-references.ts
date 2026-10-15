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
    issues,
    status: complete && total <= MAX_MATCHES ? "completed" : "partial",
    scriptsSearched: countScripts(root),
    literalReferences: references,
    limitations:
      "Static literal references only. Play receivers must contain 'runner'; aliases, computed names, runtime-created sequences and flow-dependent subscriptions need review.",
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
    const { issues, ...status } = checkScriptReferences(root, targetGuid, proposed);
    return {
      ...result,
      issues: [...(Array.isArray(result.issues) ? result.issues : []), ...issues],
      scriptReferenceCheck: status,
    };
  } catch (error) {
    return {
      ...result,
      scriptReferenceCheck: { status: "unavailable", reason: error instanceof Error ? error.message : String(error) },
    };
  }
}
