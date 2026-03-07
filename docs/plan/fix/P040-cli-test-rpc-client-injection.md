---
id: P040
status: in-progress
created: 2026-03-07
---

# Fix CLI unit tests broken by app-server child process architecture

## Context

P036-P038 changed `NonInteractiveRunner` and `App` to communicate with `DiligentAppServer` via a spawned child process over stdio JSON-RPC (`spawnCliAppServer`). The 11 failing CLI tests still pass mock `streamFunction` via `AppConfig`, but the spawned child process creates its own config from disk — the mock is never used.

## Approach

Add dependency injection for the RPC client factory so tests can provide an in-process `DiligentAppServer` with mock streams, bypassing the child process spawn.

## Tasks

### Task 1: Add `rpcClientFactory` option to `NonInteractiveRunner` and `App`

**`packages/cli/src/tui/runner.ts`**
- Add `rpcClientFactory?: (options: SpawnRpcClientOptions) => Promise<SpawnedAppServer>` to `RunnerOptions`
- In `run()`, replace `spawnCliAppServer(...)` with `(this.options?.rpcClientFactory ?? spawnCliAppServer)(...)`

**`packages/cli/src/tui/app.ts`**
- Add `rpcClientFactory?: (options: SpawnRpcClientOptions) => Promise<SpawnedAppServer>` to `AppOptions`
- In `restartRpcClient()`, use `(this.options?.rpcClientFactory ?? spawnCliAppServer)(...)`

### Task 2: Create in-process test helper

**`packages/cli/test/helpers/in-process-server.ts`** (new file)

Creates a `SpawnedAppServer`-compatible adapter backed by an in-process `DiligentAppServer` + direct `RpcPeer` pair.

Key references:
- `packages/e2e/helpers/protocol-client.ts` — bidirectional peer wiring pattern
- `packages/e2e/helpers/server-factory.ts` — `DiligentAppServer` config for tests
- `packages/core/src/rpc/client.ts` — `RpcClientSession` for client-side correlation

```ts
function createInProcessRpcClientFactory(
  config: AppConfig,
  paths: DiligentPaths,
): (options: SpawnRpcClientOptions) => Promise<SpawnedAppServer>
```

This creates a `DiligentAppServer` with:
- `config.streamFunction` as the stream function
- `config.systemPrompt` as system prompt
- `config.model` as model
- `resolvePaths` backed by `paths`

Then connects via in-memory `RpcPeer` and wraps the `RpcClientSession` to implement `SpawnedAppServer` interface (`request`, `notify`, `setNotificationListener`, `setServerRequestHandler`, `dispose`).

### Task 3: Update tests

**`packages/cli/test/runner.test.ts`** and **`packages/cli/test/tui-app.test.ts`**

Update `new NonInteractiveRunner(makeConfig(streamFn), workspace.paths)` to:
```ts
new NonInteractiveRunner(makeConfig(streamFn), workspace.paths, {
  rpcClientFactory: createInProcessRpcClientFactory(makeConfig(streamFn), workspace.paths),
})
```

Same pattern for `new App(...)`.

## Verification

```bash
bun test packages/cli/test/runner.test.ts
bun test packages/cli/test/tui-app.test.ts
bun test  # full suite
```
