// @summary Persistent Studio-owned Luau harness assets and the generic observation driver.
import { createHash } from "node:crypto";
import type { call } from "../../rpc";

export const ADAPTER_FOLDER = "DiligentPlaytestHarnesses";
const DRIVER_PREFIX = "DiligentPlaytestDriver_";
export const sourceHash = (source: string) => createHash("sha256").update(source).digest("hex");
export const frameNameFor = (name: string) => `DiligentPlaytestFrame_${name}`;

/** Quoted Luau literals preserve leading newlines and CRLF unlike long-bracket strings. */
export function luaString(value: string): string {
  const escaped = value.replace(/[\\"\x00-\x1f\x7f]/g, (character) => {
    if (character === "\\") return "\\\\";
    if (character === '"') return '\\"';
    return `\\${character.charCodeAt(0).toString().padStart(3, "0")}`;
  });
  return `"${escaped}"`;
}

export function createDriverSource(name: string): string {
  return `--!nonstrict
-- Diligent playtest driver v4. Adapter code remains editable in ReplicatedStorage.
local RunService=game:GetService('RunService')
local HttpService=game:GetService('HttpService')
local ReplicatedStorage=game:GetService('ReplicatedStorage')
local value=Instance.new('StringValue')
value.Name=${luaString(frameNameFor(name))}
value.Value=HttpService:JSONEncode({protocolVersion=1,harnessId=${luaString(name)},ready=false,revision=0,gameTimeSeconds=os.clock(),state={},actions={}}); value.Parent=workspace
local revision=0
local adapter=nil
local adapterError=nil
local ok,result=pcall(function()
\tlocal folder=ReplicatedStorage:WaitForChild('${ADAPTER_FOLDER}')
\tlocal module=folder:WaitForChild(${luaString(name)})
\tlocal loaded=require(module)
\tif type(loaded)~='table' or type(loaded.observe)~='function' then error('Adapter must return a table with observe()') end
\tif type(loaded.start)=='function' then loaded.start() end
\treturn loaded
end)
if ok then adapter=result else adapterError=tostring(result) end
local function publish()
\trevision+=1
\tlocal frame={protocolVersion=1,harnessId=${luaString(name)},ready=true,revision=revision,gameTimeSeconds=os.clock(),state={},actions={}}
\tif adapterError then frame.error={message=adapterError}
\telse
\t\tlocal observed,data=pcall(adapter.observe)
\t\tif not observed then adapterError=tostring(data); frame.error={message=adapterError}
\t\telseif type(data)~='table' then adapterError='observe() must return a table'; frame.error={message=adapterError}
\t\telse frame.state=data.state or {}; frame.decisionState=data.decisionState; frame.actions=data.actions or {}; frame.terminal=data.terminal; frame.events=data.events; frame.error=data.error; frame.coverage=data.coverage; frame.progress=data.progress end
\tend
\tlocal encoded,json=pcall(function() return HttpService:JSONEncode(frame) end)
\tif encoded then value.Value=json
\telse
\t\tframe.state={}; frame.decisionState=nil; frame.actions={}; frame.events=nil; frame.terminal=nil; frame.coverage=nil; frame.progress=nil
\t\tframe.error={message='Adapter returned non-JSON values: '..tostring(json)}
\t\tvalue.Value=HttpService:JSONEncode(frame)
\tend
end
publish()
local elapsed=0
RunService.Heartbeat:Connect(function(dt: number)
\telapsed+=dt
\tif elapsed>=0.1 then elapsed=0; publish() end
end)
`;
}

interface BrowseNode {
  Name?: string;
  name?: string;
  ActorGuid?: string;
  guid?: string;
  LuaChildren?: BrowseNode[];
  children?: BrowseNode[];
}
export interface HarnessAsset {
  name: string;
  moduleGuid: string;
  driverGuid?: string;
  source: string;
  sourceHash: string;
  frameName: string;
}
export type HarnessSummary = Omit<HarnessAsset, "source" | "sourceHash">;

function flatten(nodes: BrowseNode[], prefix = ""): Array<{ path: string; guid: string }> {
  const result: Array<{ path: string; guid: string }> = [];
  for (const node of nodes) {
    const name = node.Name ?? node.name;
    if (!name) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const guid = node.ActorGuid ?? node.guid;
    if (guid) result.push({ path, guid });
    result.push(...flatten(node.LuaChildren ?? node.children ?? [], path));
  }
  return result;
}

export async function listHarnesses(callRpc: typeof call): Promise<HarnessSummary[]> {
  const tree = (await callRpc("level.browse", {})) as { level?: BrowseNode[] } | BrowseNode[];
  const entries = flatten(Array.isArray(tree) ? tree : (tree.level ?? []));
  const prefix = `ReplicatedStorage.${ADAPTER_FOLDER}.`;
  const result: HarnessSummary[] = [];
  for (const entry of entries) {
    const index = entry.path.indexOf(prefix);
    if (index < 0 || (index > 0 && entry.path[index - 1] !== ".")) continue;
    const name = entry.path.slice(index + prefix.length);
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(name)) continue;
    const suffix = `StarterPlayer.StarterPlayerScripts.${DRIVER_PREFIX}${name}`;
    const drivers = entries.filter((e) => e.path === suffix || e.path.endsWith(`.${suffix}`));
    if (result.some((a) => a.name === name) || drivers.length > 1)
      throw new Error(`Harness ${name} is ambiguous in the Studio tree`);
    result.push({ name, moduleGuid: entry.guid, driverGuid: drivers[0]?.guid, frameName: frameNameFor(name) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readHarness(
  callRpc: typeof call,
  name: string,
  inventory?: HarnessSummary[],
): Promise<HarnessAsset | undefined> {
  const asset = (inventory ?? (await listHarnesses(callRpc))).find((a) => a.name === name);
  if (!asset) return undefined;
  const reply = (await callRpc("instance.read", { ActorGuid: asset.moduleGuid, Depth: 0 })) as {
    instance?: { Source?: unknown; Name?: unknown };
  };
  const source = reply.instance?.Source;
  if (typeof source !== "string" || reply.instance?.Name !== name)
    throw new Error("Harness source readback did not match its module");
  return { ...asset, source, sourceHash: sourceHash(source) };
}

export function installCode(name: string, source: string): string {
  return `local rs=game:FindFirstChild('ReplicatedStorage')
local starter=game:FindFirstChild('StarterPlayer')
local scripts=starter and starter:FindFirstChild('StarterPlayerScripts')
if not rs or not scripts then error('Required Studio services are missing') end
local folder=rs:FindFirstChild('${ADAPTER_FOLDER}')
if folder and not folder:IsA('Folder') then error('Harness folder name is occupied') end
if not folder then folder=Instance.new('Folder'); folder.Name='${ADAPTER_FOLDER}'; folder.Parent=rs end
if folder:FindFirstChild(${luaString(name)}) or scripts:FindFirstChild(${luaString(DRIVER_PREFIX + name)}) then error('Harness already exists; read it and update with its current source hash') end
local module=Instance.new('ModuleScript'); module.Name=${luaString(name)}; module.Source=${luaString(source)}; module.Parent=folder
local driver=Instance.new('LocalScript'); driver.Name=${luaString(DRIVER_PREFIX + name)}; driver.Source=${luaString(createDriverSource(name))}; driver.Parent=scripts
return {installed=true,name=${luaString(name)}}`;
}

export function updateCode(name: string, before: string, source: string): string {
  return `local rs=game:FindFirstChild('ReplicatedStorage')
local folder=rs and rs:FindFirstChild('${ADAPTER_FOLDER}')
local module=folder and folder:FindFirstChild(${luaString(name)})
if not module then error('Harness is missing') end
if module.Source~=${luaString(before)} then error('Harness source changed since it was read') end
local starter=game:FindFirstChild('StarterPlayer')
local scripts=starter and starter:FindFirstChild('StarterPlayerScripts')
local driver=scripts and scripts:FindFirstChild(${luaString(DRIVER_PREFIX + name)})
if not driver or not driver:IsA('LocalScript') then error('Managed playtest driver is missing') end
module.Source=${luaString(source)}
driver.Source=${luaString(createDriverSource(name))}
return {updated=true,name=${luaString(name)}}`;
}

export const HARNESS_CONTRACT = `Author a game-specific Luau ModuleScript returning a table with observe() and optional start().
start() may bind accepted server snapshot/feedback signals. observe() returns {state={}, decisionState?, actions={}, terminal?, events?, coverage?, progress?}.
state: compact JSON facts; do not treat client defaults as authoritative. No Instances/Vector3/userdata in JSON: convert to plain tables.
decisionState?: optional compact JSON record sent to the chooser instead of state. Keep only policy-relevant facts here when state includes verification tables/counters. Step/intent expectations still evaluate full state. Without decisionState the legacy full-state request remains unchanged. Keep goal text and candidate descriptions concise too.
actions: up to 16 currently useful candidates {id, description, events, validityKey?, expiresAtGameTime?, expectations?}.
Ordinary actions can combine bounded movement/look/interaction and optional short assists. Choose the control scope from the test: direct exploration leaves route and recovery choices to the model; goal-level play may use assisted execution. Optional intent is not required for direct controls or a short assist. User-adjustable assistance and test conditions belong in a small implemented adapter configuration and existing run arguments, not changes to game rules.
For player-like exploration, use code to bind controls and verification, not reveal a hidden solution. Keep privileged verification facts out of decisionState and candidate descriptions when the selected observation scope is player-observable. Without decisionState, the chooser receives full state.
For model-selected goals spanning several input steps, add action.intent={id,description,validityKey,completeWhen={...expectations}}. Publish one current executable step per available goal; all actions in a nonempty frame must either have intent or be legacy actions. Intent IDs are unique within a frame. Keep ID, validityKey and completion meaning stable for the same goal; step IDs/events may change with actual state.
The runner chooses among intent IDs/descriptions, retains the chosen goal and its selection-time state, and dispatches only that goal's current step. All completeWhen checks must pass against that baseline to finish the goal; this is separate from each step's expectations and the game's terminal. Already-satisfied absolute goals are not offered for selection.
With alternatives present, the runner reconsiders at input boundaries after intentDecisionIntervalMs (default 2000). Same-goal choices retain the original baseline and age. Missing goals or changed validity/completion criteria invalidate commitment earlier. Use validityKey for material danger/context changes, never a ticking clock. Goal selection does not reset the stuck watchdog.
Generate next steps independently for each goal from observed facts; do not mutate a global chosen target while generating alternatives. Goal-specific route caches are fine. The model receives the runner's active goal/age separately from game facts. No new Studio RPC or Lua callback is required for this mode.
For both ordinary and intent actions, the chooser receives up to three recent completed inputs as controller.recentActions: {actionId,intentId?,result}. Results are effect_confirmed when fresh healthy post-input expectations pass, effect_unconfirmed when they do not, and not_checked without checks or a healthy result frame. Unconfirmed is not proof of no effect; checks use the first newer post-input frame. This bounded episode-local history contains no raw verification values and does not update Lua-private state. Use concise semantic action IDs; raw feedback remains in the trace.
Preserve working game-specific executors and add state/memory, parameterized actions and explicit decision points where useful. A small table and ordinary functions can suffice; a formal state-machine framework or new protocol is not required. Guards remove illegal options; distance/risk/return preferences should distinguish useful alternatives for the decision model rather than preselect every strategy in code.
Only genuinely forced continuations should collapse to one action. Multiple meaningful candidates call the configured decision provider; duplicate renamed inputs do not establish model-mediated play. Keep policy/timing/retry configuration separate from game rules and bindings.
events use existing balanced game.input events (key, pointer, look, bounded wait). Never directly perform a gameplay action from observe().
validityKey binds an action to a round/phase/objective; expiresAtGameTime uses os.clock() seconds.
expectations are {key: state dot-path, op: change|increase|decrease|equals, value?}; report only observed effects.
terminal: {outcome: success|failure, reason?} only when actual game state establishes the outcome.
events: bounded real game logs {id:string, level?:info|warning|error, message, data?}; unique id allows deduplication.
Reduce actual correlated feedback into controller state once per event/revision. Candidate publication is not selection, and selection/input completion is not a successful game effect.
Current boundary: the driver invokes start()/observe() only. The selected ID is NOT sent to an adapter onDecision callback; game.input.inject carries physical inputs only. Use action.intent for runner-owned goal commitment and compute each goal's next step from facts. If private Lua state must consume selection itself, that separate callback is still unsupported; do not invent it or use Editor-only execute.luau during PIE.
For test-goal coverage, declare coverage={targets={{id,kind='action'|'state'|'event',description,source?}},observed={...}}.
Targets are a stable inventory derived from this game's code and the requested test objective, not every unrelated game feature.
Use action.coverageKey=<declared action target id>. Availability, selection, input completion and confirmed effects are counted separately.
An action is covered only when a nonempty expectations list passes on observed state. Missing expectations do not prove behavior.
coverage.observed contains only witnessed state/event target ids, never action ids. It is declared test coverage, not automatic whole-code branch coverage.
progress={sequence=<nonnegative safe integer>,waiting?={reason=<string>,timeoutMs=<1..180000>}} drives the no-progress watchdog (default 15000 ms; tool stuckTimeoutMs=0 disables).
Increment sequence monotonically only on meaningful observed progress toward the test: a verified pickup/deposit, new route milestone, useful action effect, or relevant phase transition. Do not reset on respawn or increment for clocks, frame revisions, action attempts, oscillating positions or repeated wait inputs.
For legitimate hiding/countdown/reload waits, declare a game-derived waiting reason and bounded timeout. Only the first waiting declaration per sequence pauses the watchdog; repeats/changed reasons cannot renew it. Removing waiting resumes the remaining budget; expiry does so even if waiting remains declared.
Legacy frames without progress use completed non-wait actions with changed, fully confirmed expectations as a fallback. Once progress telemetry is seen it remains authoritative; missing metadata cannot reenable fallback. Update the adapter/driver to describe normal waits and mission-level progress accurately.
stuck is a runtime result, not an adapter success/failure terminal. It records last state/action and cancels pending work before same-session cleanup.
Keep game-specific observation, candidate generation and outcome rules in this module so Diligent can maintain them between runs.
The generic driver owns protocolVersion=1, harnessId, revision and gameTimeSeconds; runtime owns provider selection, input, cancellation and session cleanup.
The same adapter can run with decisionProvider=laya (default) or openai-decisions. observationMode=structured is default; structured+image requires an image-capable provider, accessible PNG captures and one targeted owned PIE client. Image bytes are captured by the sidecar at model-decision boundaries, not returned by Lua or put in StringValue. maxVisualAgeMs bounds image age before a new choice dispatch; retained/singleton steps still use fresh structured state. Missing/stale images never silently become a text-only run. OpenAI credentials come from server-side OPENAI_API_KEY; do not put credentials in Source or tool arguments. See the tool schema for options and host screenshot mapping configuration.
Results include decisionEvidence: model requests/choices/dispatches/confirmed effects and automatic dispatches. not_exercised is possible even with a successful game outcome; it does not satisfy a request to verify model-mediated decisions. Correlate the trace by decisionId and verify the intended controller transition, not just call counts.
Workflow: list/read actual installed names -> inspect game Lua/GUI and test objective -> describe contract -> author/install -> validate -> game_playtest -> inspect trace/coverage -> read/update using sourceHash -> rerun.
read found:false is a normal new-project branch; author/install. RPC failure is not evidence that a harness is absent.
update refreshes the generated common driver too; keep game-specific behavior in the adapter rather than customizing the managed driver.
Do not patch an adapter during PIE. For UGC, derive bindings from the current project, not an unrelated example.`;
