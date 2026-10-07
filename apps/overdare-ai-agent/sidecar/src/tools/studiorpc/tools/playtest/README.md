# Playtest code map

Start at `createPlaytestTools` in [index.ts](index.ts). It registers two tools:
[harness-tool.ts](harness-tool.ts) manages saved Studio code;
[run-tool.ts](run-tool.ts) validates an installed adapter, prepares the provider,
runs an episode and writes its evidence. Their public schemas and common tool
helpers live in [tool-shared.ts](tool-shared.ts).

## Follow one episode

[runPlaytest](runtime.ts) creates one episode with private state. Read its `run`
function for lifecycle ownership, then `runDecisionLoop` for each turn:

```text
startOwnedSession
  -> playObservedSession
       -> background frame observer continues throughout
       -> runDecisionLoop
            -> check terminal, freshness and available actions
            -> selectAction (retained intent / singleton / model)
            -> revalidate against the latest observation
            -> executeAction (input batch, newer frame, effect checks)
  -> stopOwnedSession, including cancellation and failure paths
```

| Question | Read here |
| --- | --- |
| What is a frame, action or intent? | [frame.ts](frame.ts): validated adapter wire contract |
| How does Studio's RPC envelope become usable data? | [observation.ts](observation.ts): parsing only |
| What keeps observing while a model or input is pending? | [frame-observer.ts](frame-observer.ts): background loop, freshness, waits |
| Is the choice still legal, and did its expected effect happen? | [action-checks.ts](action-checks.ts): pure comparisons |
| Which provider receives state and images? | [decision-provider.ts](decision-provider.ts), [visual-observation.ts](visual-observation.ts) |
| What ends an episode with no progress? | [progress.ts](progress.ts) |
| Did the model actually influence play? | [decision-evidence.ts](decision-evidence.ts); distinct from [coverage.ts](coverage.ts) |
| What does the runner accept and return? | [runtime-types.ts](runtime-types.ts); existing runtime type exports remain available |

The observer owns the latest frame and observation health. The episode owns the
session, current intent, decision history and outcome. The provider only chooses
an available ID; it cannot dispatch input. Game-specific controls and victory
conditions remain in the editable Studio adapter. These modules preserve the
existing protocol and timing rules; they do not introduce a new state-machine API.
