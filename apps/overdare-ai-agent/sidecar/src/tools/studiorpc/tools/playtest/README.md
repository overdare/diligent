# Playtest code map

Start at `createPlaytestTools` in [index.ts](index.ts). It registers two tools:
[harness-tool.ts](harness-tool.ts) manages saved Studio code;
[run-tool.ts](run-tool.ts) validates an installed adapter, prepares the provider
(autonomous mode only), runs an episode, writes its evidence and checks
[run-history.ts](run-history.ts) for a repeating failure. Their public schemas and
common tool helpers live in [tool-shared.ts](tool-shared.ts).

## Follow one episode

[runPlaytest](runtime.ts) creates one episode with private state. Read its `run`
function for lifecycle ownership, then `createActorLoop` for each decision loop
(one in single-player mode, one per bound client in two-player mode):

```text
startOwnedSession
  -> playObservedSession
       -> background frame observer continues throughout
       -> bindActorLoops (two-player only)
       -> runActorLoops
            -> createActorLoop(...).run
                 -> check terminal, freshness and available actions
                 -> selectAction (retained intent / singleton / scenario order / model)
                 -> revalidate against the latest observation
                 -> executeAction (input batch, newer frame, effect checks)
  -> stopOwnedSession, including cancellation and failure paths
```

| Question | Read here |
| --- | --- |
| What is a frame, action, intent or check? | [frame.ts](frame.ts): validated adapter wire contract |
| What does the managed Studio driver publish? | [harness.ts](harness.ts): driver source, `api.emit`/`api.check`, contracts |
| How does Studio's RPC envelope become usable data? | [observation.ts](observation.ts): parsing only |
| What keeps observing while a model or input is pending? | [frame-observer.ts](frame-observer.ts): background loop, freshness, waits |
| Is the choice still legal, and did its expected effect happen? | [action-checks.ts](action-checks.ts): pure comparisons |
| Did the declared requirements pass? | [checks.ts](checks.ts): latched check transitions, independent of the terminal |
| Why did a run fail or stall? | [diagnostics.ts](diagnostics.ts): readiness, last action, unmet expectations, hints |
| Has this harness failed the same way before? | [run-history.ts](run-history.ts) |
| Which provider receives state and images? | [decision-provider.ts](decision-provider.ts), [visual-observation.ts](visual-observation.ts) |
| What ends an episode with no progress? | [progress.ts](progress.ts) |
| Did the model actually influence play? | [decision-evidence.ts](decision-evidence.ts); distinct from [coverage.ts](coverage.ts) |
| How are two real clients bound and measured? | [multiplayer.ts](multiplayer.ts), [concurrency.ts](concurrency.ts) |
| How does an external process call a running sidecar's tools? | [invoke-server.ts](invoke-server.ts) |
| What does the runner accept and return? | [runtime-types.ts](runtime-types.ts); existing runtime type exports remain available |

The observer owns the latest frame and observation health. The episode owns the
session, bindings, outcome and verification; each actor loop owns its intent,
recent-action history and decision context. The provider only chooses an
available ID; it cannot dispatch input. Game-specific controls, checks and victory
conditions remain in the editable Studio adapter. These modules preserve the
existing protocol and timing rules; they do not introduce a new state-machine API.
