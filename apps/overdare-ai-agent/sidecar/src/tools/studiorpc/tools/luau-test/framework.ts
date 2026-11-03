// @summary Managed Studio layout, runner Luau and Editor code builders for frktest-based Luau tests.
import { createHash } from "node:crypto";
import { FRKTEST_MODULES } from "./frktest-vendor";

export type TestContext = "server" | "client";
export const TEST_CONTEXTS: readonly TestContext[] = ["server", "client"];

/** Everything the toggle injects lives in this ReplicatedStorage folder plus the two disabled runners. */
export const FRAMEWORK_FOLDER = "DiligentTestFramework";
export const REQUEST_VALUE = "Request";
export const RUNNER_MODULE = "Runner";
export const TESTS_FOLDER = "DiligentTests";
export const RUNNER_SCRIPT = "DiligentTestRunner";
export const resultNameFor = (context: TestContext) => `DiligentTestResult_${context}`;

/** Server tests stay out of client replication; client tests must be replicated to run in a LocalScript. */
export const TESTS_SERVICE: Record<TestContext, "ServerStorage" | "ReplicatedStorage"> = {
  server: "ServerStorage",
  client: "ReplicatedStorage",
};
const RUNNER_LOCATION: Record<TestContext, { path: string; className: "Script" | "LocalScript" }> = {
  server: { path: "game:GetService('ServerScriptService')", className: "Script" },
  client: {
    path: "game:GetService('StarterPlayer'):FindFirstChild('StarterPlayerScripts')",
    className: "LocalScript",
  },
};

/** First lines of every Diligent-owned runner source; ownership checks compare this exact prefix. */
const MANAGED_HEADER = "--!nonstrict\n-- Diligent Luau test framework v1. Managed: do not edit.";
const VENDOR_HEADER_PREFIX = "-- frktest (";
export const sourceHash = (source: string) => createHash("sha256").update(source).digest("hex");

/** Quoted Luau literal; long brackets would drop a leading newline. */
export function luaString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\0/g, "\\0")}"`;
}

const RUNNER_SOURCE = `${MANAGED_HEADER}
-- Runs selected test ModuleScripts with frktest and returns a bounded JSON-ready report.
local frk = require(script.Parent.frktest)
local inspect = require(script.Parent.inspect)
local Runner = {}
local MAX_TEXT = 1024
local MAX_DETAIL = 2048
local MAX_RESULTS = 200
local MAX_FAILURES_PER_TEST = 8

local function clip(value, limit)
	local text = tostring(value)
	if #text > limit then return string.sub(text, 1, limit) .. "..." end
	return text
end

local function contains(list, value)
	for _, entry in ipairs(list) do if entry == value then return true end end
	return false
end

function Runner.run(folder, names, context)
	local test = frk.test
	local assert = frk.assert
	local report = { context = context, modules = {}, loadErrors = {}, results = {}, omittedResults = 0 }
	local current = nil
	local suiteName = nil
	local function push(entry)
		if #report.results >= MAX_RESULTS then report.omittedResults += 1 return end
		table.insert(report.results, entry)
	end
	local function addFailure(entry)
		if current == nil or #current.failures >= MAX_FAILURES_PER_TEST then return end
		table.insert(current.failures, entry)
	end
	local function assertionFailure(kind, failure)
		local entry = { kind = kind, message = clip(failure.message, MAX_TEXT) }
		if failure.user_msg ~= nil then entry.userMessage = clip(failure.user_msg, MAX_TEXT) end
		if failure.location ~= nil and failure.location.line ~= nil then entry.line = tonumber(failure.location.line) end
		if failure.complex_info ~= nil then
			entry.detail = clip(inspect(failure.complex_info.data, { depth = 8 }), MAX_DETAIL)
		end
		addFailure(entry)
	end
	test.on_suite_enter(function(suite) suiteName = suite.name end)
	test.on_suite_leave(function() suiteName = nil end)
	test.on_test_enter(function(case) current = { suite = suiteName, name = case.name, failures = {} } end)
	test.on_test_leave(function(case)
		if current ~= nil then
			current.status = if case.failed then "fail" else "pass"
			push(current)
		end
		current = nil
	end)
	test.on_test_skipped(function(case) push({ suite = suiteName, name = case.name, status = "skip", failures = {} }) end)
	test.on_test_error(function(err)
		addFailure({ kind = "error", message = clip(err.error, MAX_TEXT), traceback = clip(err.strace, MAX_DETAIL) })
	end)
	test.on_exec_end(function(counts)
		report.counts = { ran = counts.ran, passed = counts.passed, failed = counts.failed, skipped = counts.skipped }
	end)
	assert.on_check_failed(function(failure) assertionFailure("check", failure) end)
	assert.on_require_failed(function(failure) assertionFailure("require", failure) end)

	local selected = {}
	if folder ~= nil then
		for _, child in ipairs(folder:GetChildren()) do
			if child:IsA("ModuleScript") and (names == nil or contains(names, child.Name)) then table.insert(selected, child) end
		end
	end
	table.sort(selected, function(a, b) return a.Name < b.Name end)

	for _, module in ipairs(selected) do
		table.insert(report.modules, module.Name)
		local loose = {}
		local inSuite = false
		local function suiteWrapper(register)
			return function(name, fn)
				register(module.Name .. " > " .. tostring(name), function()
					inSuite = true
					local ok, err = pcall(fn)
					inSuite = false
					if not ok then
						table.insert(report.loadErrors, { module = module.Name, suite = tostring(name), message = clip(err, MAX_TEXT) })
					end
				end)
			end
		end
		local function caseWrapper(register)
			return function(name, fn)
				if inSuite then register(name, fn) else table.insert(loose, { register = register, name = name, fn = fn }) end
			end
		end
		local api = {
			test = {
				suite = suiteWrapper(test.suite),
				case = caseWrapper(test.case),
				focus = { suite = suiteWrapper(test.focus.suite), case = caseWrapper(test.focus.case) },
				skip = { suite = suiteWrapper(test.skip.suite), case = caseWrapper(test.skip.case) },
			},
			check = assert.check,
			req = assert.require,
			msg = assert.msg,
			context = context,
		}
		local loaded, entry = pcall(require, module)
		if not loaded then
			table.insert(report.loadErrors, { module = module.Name, message = clip(entry, MAX_TEXT) })
		elseif type(entry) ~= "function" then
			table.insert(report.loadErrors, { module = module.Name, message = "test module must return function(t)" })
		else
			local ran, err = pcall(entry, api)
			if not ran then
				table.insert(report.loadErrors, { module = module.Name, message = clip(err, MAX_TEXT) })
			elseif #loose > 0 then
				test.suite(module.Name, function()
					for _, case in ipairs(loose) do case.register(case.name, case.fn) end
				end)
			end
		end
	end

	local ok, err = pcall(frk.run)
	if not ok then report.runError = clip(err, MAX_TEXT) end
	return report
end

return Runner
`;

function driverSource(context: TestContext): string {
  const testsRoot = `game:GetService('${TESTS_SERVICE[context]}')`;
  return `${MANAGED_HEADER}
-- ${context} runner: enabled only for an approved test run, then restored to disabled.
local ReplicatedStorage = game:GetService('ReplicatedStorage')
local HttpService = game:GetService('HttpService')
local result = Instance.new('StringValue')
result.Name = '${resultNameFor(context)}'
result.Value = HttpService:JSONEncode({ context = '${context}', done = false })
result.Parent = workspace
local runId = nil
local ok, report = pcall(function()
	local framework = ReplicatedStorage:WaitForChild('${FRAMEWORK_FOLDER}', 15)
	if framework == nil then error('${FRAMEWORK_FOLDER} is missing') end
	local requestValue = framework:FindFirstChild('${REQUEST_VALUE}')
	local raw = if requestValue ~= nil and requestValue.Value ~= '' then requestValue.Value else '{}'
	local request = HttpService:JSONDecode(raw)
	runId = request.runId
	local Runner = require(framework:WaitForChild('${RUNNER_MODULE}'))
	return Runner.run(${testsRoot}:FindFirstChild('${TESTS_FOLDER}'), request['${context}'], '${context}')
end)
if not ok then report = { context = '${context}', runError = tostring(report) } end
report.runId = runId
report.done = true
local encoded, json = pcall(function() return HttpService:JSONEncode(report) end)
if encoded then
	result.Value = json
else
	result.Value = HttpService:JSONEncode({ context = '${context}', runId = runId, done = true, runError = 'test report is not JSON encodable: ' .. tostring(json) })
end
`;
}

/** Luau that resolves the managed framework folder or fails when the name belongs to unrelated content. */
const FRAMEWORK_PRELUDE = `local rs=game:GetService('ReplicatedStorage')
local function managed(instance, prefix)
	return instance:IsA('LuaSourceContainer') and string.sub(instance.Source,1,#prefix)==prefix
end
local function runnerAt(parent, className)
	local existing=parent and parent:FindFirstChild('${RUNNER_SCRIPT}')
	if existing and (existing.ClassName~=className or not managed(existing, ${luaString(MANAGED_HEADER)})) then
		error('${RUNNER_SCRIPT} name is occupied by unrelated code in '..parent.Name)
	end
	return existing
end`;

function managedModules(): Array<{ name: string; source: string; prefix: string }> {
  return [
    ...Object.entries(FRKTEST_MODULES).map(([name, source]) => ({ name, source, prefix: VENDOR_HEADER_PREFIX })),
    { name: RUNNER_MODULE, source: RUNNER_SOURCE, prefix: MANAGED_HEADER },
  ];
}

/** Idempotent injection: creates or refreshes managed code only, never touching tests. Returns {changed}. */
export function ensureFrameworkCode(): string {
  const modules = managedModules()
    .map(
      ({ name, source, prefix }) => `do
	local m=folder:FindFirstChild(${luaString(name)})
	if m and (not m:IsA('ModuleScript') or not managed(m, ${luaString(prefix)})) then error('${FRAMEWORK_FOLDER}.${name} is occupied by unrelated code') end
	if not m then m=Instance.new('ModuleScript'); m.Name=${luaString(name)}; m.Parent=folder; changed=true end
	local source=${luaString(source)}
	if m.Source~=source then m.Source=source; changed=true end
end`,
    )
    .join("\n");
  const runners = TEST_CONTEXTS.map((context) => {
    const { path, className } = RUNNER_LOCATION[context];
    return `do
	local parent=${path}
	if not parent then error('${className} parent for the ${context} runner is missing') end
	local runner=runnerAt(parent, '${className}')
	if not runner then runner=Instance.new('${className}'); runner.Name='${RUNNER_SCRIPT}'; runner.Enabled=false; runner.Parent=parent; changed=true end
	local source=${luaString(driverSource(context))}
	if runner.Source~=source then runner.Source=source; changed=true end
end`;
  }).join("\n");
  return `${FRAMEWORK_PRELUDE}
local changed=false
local folder=rs:FindFirstChild('${FRAMEWORK_FOLDER}')
if folder and not folder:IsA('Folder') then error('${FRAMEWORK_FOLDER} name is occupied') end
if not folder then folder=Instance.new('Folder'); folder.Name='${FRAMEWORK_FOLDER}'; folder.Parent=rs; changed=true end
for _,child in ipairs(folder:GetChildren()) do
	if child:IsA('LuaSourceContainer') and not managed(child, ${luaString(VENDOR_HEADER_PREFIX)}) and not managed(child, ${luaString(MANAGED_HEADER)}) then
		error('${FRAMEWORK_FOLDER} contains unrelated code: '..child.Name)
	end
end
${modules}
local request=folder:FindFirstChild('${REQUEST_VALUE}')
if request and not request:IsA('StringValue') then error('${FRAMEWORK_FOLDER}.${REQUEST_VALUE} is occupied') end
if not request then request=Instance.new('StringValue'); request.Name='${REQUEST_VALUE}'; request.Value=''; request.Parent=folder; changed=true end
${runners}
return {changed=changed}`;
}

/** Removes only the managed framework folder and runners; test folders are user content and stay. */
export function removeFrameworkCode(): string {
  const runners = TEST_CONTEXTS.map((context) => {
    const { path, className } = RUNNER_LOCATION[context];
    return `do
	local runner=runnerAt(${path}, '${className}')
	if runner then runner:Destroy(); removed+=1 end
end`;
  }).join("\n");
  return `${FRAMEWORK_PRELUDE}
local removed=0
local folder=rs:FindFirstChild('${FRAMEWORK_FOLDER}')
if folder then
	if not folder:IsA('Folder') then error('${FRAMEWORK_FOLDER} name is occupied by unrelated content') end
	for _,child in ipairs(folder:GetChildren()) do
		if child:IsA('LuaSourceContainer') and not managed(child, ${luaString(VENDOR_HEADER_PREFIX)}) and not managed(child, ${luaString(MANAGED_HEADER)}) then
			error('${FRAMEWORK_FOLDER} contains unrelated code: '..child.Name..'; move it before removing the framework')
		end
	end
	folder:Destroy(); removed+=1
end
${runners}
return {removed=removed}`;
}

const testsFolderCode = (
  context: TestContext,
  create: boolean,
) => `local service=game:GetService('${TESTS_SERVICE[context]}')
local tests=service:FindFirstChild('${TESTS_FOLDER}')
if tests and not tests:IsA('Folder') then error('${TESTS_SERVICE[context]}.${TESTS_FOLDER} name is occupied') end
${create ? `if not tests then tests=Instance.new('Folder'); tests.Name='${TESTS_FOLDER}'; tests.Parent=service end` : ""}`;

export function installTestCode(name: string, context: TestContext, source: string): string {
  const other: TestContext = context === "server" ? "client" : "server";
  return `local otherTests=game:GetService('${TESTS_SERVICE[other]}'):FindFirstChild('${TESTS_FOLDER}')
if otherTests and otherTests:FindFirstChild(${luaString(name)}) then error('A ${other} test with this name already exists; test names are unique across contexts') end
${testsFolderCode(context, true)}
if tests:FindFirstChild(${luaString(name)}) then error('Test already exists; read it and update with its current source hash') end
local m=Instance.new('ModuleScript'); m.Name=${luaString(name)}; m.Source=${luaString(source)}; m.Parent=tests
return {installed=true}`;
}

export function updateTestCode(name: string, context: TestContext, before: string, source: string): string {
  return `${testsFolderCode(context, false)}
local m=tests and tests:FindFirstChild(${luaString(name)})
if not m or not m:IsA('ModuleScript') then error('Test is missing') end
if m.Source~=${luaString(before)} then error('Test source changed since it was read') end
m.Source=${luaString(source)}
return {updated=true}`;
}

export function removeTestCode(name: string, context: TestContext, before: string): string {
  return `${testsFolderCode(context, false)}
local m=tests and tests:FindFirstChild(${luaString(name)})
if not m or not m:IsA('ModuleScript') then error('Test is missing') end
if m.Source~=${luaString(before)} then error('Test source changed since it was read') end
m:Destroy()
return {removed=true}`;
}

/**
 * Prepares one owned run: the request names the selected tests per context and only runners with work are enabled.
 * Restoring passes request=undefined, which clears the request and disables both runners.
 */
export function runnerStateCode(request: { runId: string; tests: Partial<Record<TestContext, string[]>> } | undefined) {
  const json = request
    ? JSON.stringify({ runId: request.runId, server: request.tests.server ?? [], client: request.tests.client ?? [] })
    : "";
  const toggles = TEST_CONTEXTS.map((context) => {
    const { path, className } = RUNNER_LOCATION[context];
    const enabled = Boolean(request?.tests[context]?.length);
    return `do
	local runner=runnerAt(${path}, '${className}')
	${enabled ? `if not runner then error('The ${context} runner is missing; set up the framework first') end` : ""}
	if runner then runner.Enabled=${enabled} end
end`;
  }).join("\n");
  return `${FRAMEWORK_PRELUDE}
local folder=rs:FindFirstChild('${FRAMEWORK_FOLDER}')
local request=folder and folder:FindFirstChild('${REQUEST_VALUE}')
if request and request:IsA('StringValue') then request.Value=${luaString(json)} elseif ${request ? "true" : "false"} then error('${FRAMEWORK_FOLDER}.${REQUEST_VALUE} is missing') end
${toggles}
return {ok=true}`;
}

/** Test API reference returned by describe; the runner passes this table to each module's function. */
export const TEST_CONTRACT = `Luau tests run inside a fresh owned PIE session with the vendored frktest library (MIT, https://github.com/itsfrank/frktest).
Editor execute.luau cannot run tests: it has no require/task/debug.

Layout (all managed by this tool; never edit managed code):
- ReplicatedStorage.${FRAMEWORK_FOLDER}: frktest modules, ${RUNNER_MODULE}, ${REQUEST_VALUE}. Injected when the Studio testing experiment is enabled and re-ensured before install/update/run.
- ServerStorage.${TESTS_FOLDER}.<name>: server tests, run by a disabled ServerScriptService.${RUNNER_SCRIPT} Script.
- ReplicatedStorage.${TESTS_FOLDER}.<name>: client tests, run by a disabled StarterPlayerScripts.${RUNNER_SCRIPT} LocalScript after the player joins.
Turning the experiment off removes the framework and runners; test modules stay.

A test ModuleScript returns one function that receives the test API:
return function(t)
	local test, check, req = t.test, t.check, t.req
	local Inventory = require(game:GetService("ReplicatedStorage"):WaitForChild("Inventory"))
	test.suite("Inventory", function()
		test.case("adds stackable items", function()
			local inv = Inventory.new()
			req.not_nil(inv)
			inv:add("Coin", 3)
			check.equal(inv:count("Coin"), 3)
		end)
		test.case("rejects negative counts", function()
			check.should_error(function() Inventory.new():add("Coin", -1) end)
		end)
	end)
end
t.test: suite(name, fn), case(name, fn), focus.suite/case, skip.suite/case. Cases outside a suite are grouped under the module name.
t.check.*: records a failure and continues. t.req.*: records a failure and stops the case.
Assertions: equal, not_equal, greater, greater_eq, lesser, lesser_eq, is_true, is_false, truthy, falsy, not_nil, should_error, should_not_error (req uses should_errors/should_not_errors), array.contains, array.equal, table.contains, table.equal.
t.msg("text") attaches a message to the next failing assertion. t.context is "server" or "client".
Cases may yield (task.wait) to let game systems initialize; keep each run within timeoutMs.
Test real game modules and authoritative state. Do not change gameplay code to make a test pass, and do not put test hooks in production modules.
Strict validation runs on test modules before every run; type errors block the run.`;
