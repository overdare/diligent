# Luau tests in Studio

`studiorpc_luau_test` lets the agent write and run Luau tests for the open Studio level with a vendored copy of
[frktest](https://github.com/itsfrank/frktest) (MIT). It belongs to the `studio-testing` experiment together with
autoplay playtests ([play-test-input.md](play-test-input.md)); see [experiments.md](experiments.md).

## Lifecycle

| Event | Effect in the open level |
| --- | --- |
| Experiment ON (Web Settings → Experiments) | Injects `ReplicatedStorage.DiligentTestFramework` (frktest modules, `Runner`, `Request`) and two disabled `DiligentTestRunner` scripts, then saves |
| `install` / `update` / `run` | Re-ensures the same managed code first, so a level opened later or a toggle made while Studio was offline still works |
| Experiment OFF | Removes the framework folder and both runners, then saves. Test modules stay |
| `setup` / `uninstall` | The same inject/remove as explicit tool operations |

The toggle side effect is deferred, not forced, when PIE is running or Studio is unreachable. Managed modules carry
an ownership header; a same-named object without it is reported instead of overwritten or deleted.

## Layout and execution

- Server tests: `ServerStorage.DiligentTests.<name>`, run by `ServerScriptService.DiligentTestRunner` (Script).
- Client tests: `ReplicatedStorage.DiligentTests.<name>`, run by `StarterPlayerScripts.DiligentTestRunner`
  (LocalScript) after the player joins.

Editor `execute.luau` has no `require`, `task` or `debug`, so tests always run in PIE. `run`:

1. validates the selected test modules in strict mode (errors block the run);
2. writes the run id and selected names to `DiligentTestFramework.Request` and enables only the runners with work;
3. starts one owned PIE session, polls `DiligentTestResult_server` (authority world) and
   `DiligentTestResult_client` (client world) through `game.observe`;
4. stops the same session, clears the request and disables both runners, including after failures or
   cancellation.

The result reports `outcome` (`passed`, `failed`, `error`, `timeout`), aggregated counts, failing cases with
assertion messages, module load errors, missing modules and PIE cleanup. The full per-context report is saved to
`.overdare/luau-tests/<runId>.json` with owner-only permissions.

## Test module shape

```lua
return function(t)
	local test, check, req = t.test, t.check, t.req
	test.suite("Inventory", function()
		test.case("adds stackable items", function()
			check.equal(1 + 1, 2)
		end)
	end)
end
```

`t.check.*` records a failure and continues; `t.req.*` stops the case. `describe` returns the full assertion list.
Suites are prefixed with the module name in results; top-level cases are grouped under the module name.

## Code map and removal

Everything lives in `apps/overdare-ai-agent/sidecar/src/tools/studiorpc/tools/luau-test/`:
`frktest-vendor.ts` (generated upstream sources and adaptations), `framework.ts` (managed layout, runner Luau,
Editor code), `session.ts` (owned PIE session), `tool.ts` (the tool) and `index.ts` (toggle side effect). To remove
the feature, delete that directory, the `luau-testing` skill and its manifest entry, the tool registration in
`tools/studiorpc/index.ts`, and the tool/skill names plus `withStudioSideEffects` in `src/experiments.ts`.
