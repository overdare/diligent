---
name: luau-testing
description: Write and run frktest-based Luau unit and integration tests for the open OVERDARE Studio level with studiorpc_luau_test. Use to check game module logic, authoritative server state or client-side modules repeatably, or to add regression tests for a fix. Not for real-input gameplay (use autonomous-playtest) or visual checks.
---

# Luau Testing

`studiorpc_luau_test` runs test ModuleScripts inside a fresh PIE session with the vendored frktest library. Server tests (ServerStorage.DiligentTests) run in a Script; client tests (ReplicatedStorage.DiligentTests) run in a LocalScript after the player joins. Editor `execute.luau` cannot run tests.

## Workflow

1. `describe` once for the test API, then read the game modules under test. Test real modules and authoritative state; never add test hooks to production code or change gameplay to make a test pass.
2. `list` to find existing tests; `read` before `update`/`remove` (both need the current `sourceHash`).
3. `install` one module per feature with `context: "server"` for server-only modules (ServerScriptService/ServerStorage) and `"client"` for client modules. Names are lowercase and unique across contexts.
4. `run` with explicit `names` while iterating; omit `names` for a full regression run. Strict validation runs first; fix type errors it reports (cast live children found with `FindFirstChild`/`WaitForChild`, e.g. `:: RemoteEvent`).
5. Read `outcome`, `failures`, `loadErrors` and `missingModules`. `failed` means a test or module failed; `error`/`timeout` means the run itself did not complete; `reportPath` keeps every result. Do not copy results into other files.

## Writing tests

- One `test.suite` per behavior; each `test.case` checks one observable fact. Use `t.req.*` when later checks depend on a value, `t.check.*` otherwise, `t.msg("why")` for context.
- Cases may yield (`task.wait`) for game systems that initialize at startup. Bound waits, and keep the run within `timeoutMs`.
- Prefer deterministic module-level checks. Cover the normal path, the rejection/edge path and the regression being fixed.
- A passing Luau test does not prove input, camera, rendering or networking behavior; use autonomous-playtest verification mode or screenshots for those claims.

## Framework lifecycle

The Studio testing experiment injects `ReplicatedStorage.DiligentTestFramework` and two disabled `DiligentTestRunner` scripts when turned on, and removes them when turned off; test modules stay. `install`, `update` and `run` re-ensure the framework, so a level opened later works without manual setup. Use `setup`/`uninstall` only when the user asks. A run enables only the needed runners and restores them to disabled afterwards; it never reuses an existing PIE session.
