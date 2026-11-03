# Game settings and play tests

Game settings configure the edit world's Workspace and StarterPlayer defaults.
PIE controls start, stop and inspect a play-test session. Changing defaults does
not update existing live PIE characters; restart the session to test new defaults.

## Read and update defaults

Call `studiorpc_game_settings_read` with `{}`. It returns
`{"success":true,"settings":{...}}` with the fields below.

`studiorpc_game_settings_update` accepts a nonempty partial patch. Omitted fields
are preserved; unknown fields and invalid values are rejected.

| Field | Accepted values and units |
|---|---|
| `maxPlayers` | Integer from 1 to 20; saved game player limit, separate from the PIE client count |
| `gravity` | Finite nonnegative float, cm/s² |
| `httpEnabled` | Boolean |
| `gravityScale` | Finite nonnegative float, multiplier |
| `jumpHeight` | Finite nonnegative float, cm |
| `jumpPower` | Finite nonnegative float; used when `useJumpPower` is true |
| `useJumpPower` | Boolean selecting jump power instead of jump height |
| `walkSpeed` | Finite nonnegative float, cm/s |
| `maxSlopeAngle` | Finite number from 0 to 89 degrees |

For example, pass this patch to `studiorpc_game_settings_update`:

```json
{"walkSpeed":450,"useJumpPower":false,"jumpHeight":120}
```

The native operation applies the validated patch in an editor transaction and
marks the edit-world actors dirty. The agent tool uses the shared write lock and
rollback baseline, then saves the level after a successful update. It returns
the resulting settings. If the subsequent save fails, the result reports
`saved:false` and `saveError`: inspect the settings and recover the save without
repeating an already successful mutation. These tools require a standalone
Studio build supporting game settings and an edit world containing Workspace
and StarterPlayer.

## Start, restart and add a client

`studiorpc_game_play` accepts these optional fields:

| Field | Behavior |
|---|---|
| `numberOfPlayer` | Positive integer selecting the client count when starting a stopped session; Studio enforces its build's PIE client limit |
| `restart` | `true` makes the adapter call `game.stop` before `game.play` |
| `addClient` | `true` requests one additional client in an existing ready session |

Calling play with `{}` preserves an already running session. Without restart,
`numberOfPlayer` does not resize a running session. Omit it when starting to keep
Studio's configured count. To start a fresh two-client test, pass:

```json
{"restart":true,"numberOfPlayer":2}
```

To request one extra client without restarting, pass:

```json
{"addClient":true}
```

`addClient:true` cannot be combined with `numberOfPlayer` or `restart:true`.
Studio rejects it when no session is running, the session is not ready, an
addition is already pending, or the current mode/client limit disallows it.
An accepted response includes `action:"addClient"`, `state:"clientStarting"`
and the existing `pieSessionId`. This queues an addition; it does not establish
that the new client is ready. Do not repeat an accepted request. Read status
until the new client appears and is injectable. Inspect an unknown timeout
outcome before deciding whether another addition is needed.

## Observe readiness and select a client

Call `studiorpc_game_pie_status` with `{}` after starting, restarting or adding a
client. Its public response contains `running`, an available `pieSessionId`, and
`clients` entries with `clientId`, `injectable` and `targeted`. `targeted` marks
the default client. A successful play request alone does not prove that a client
accepts input; wait for an injectable entry before driving it.

Use the returned identifiers rather than inventing client names or retaining
IDs across restarts. Input and move tools resolve the current session and first
injectable client when omitted; an explicit client must be injectable.
`studiorpc_game_observe` and `studiorpc_game_screenshot` accept `pieSessionId`
and `clientId` together to select a client. See [play-test input](play-test-input.md)
for input, movement, observations and screenshot targeting.

Call `studiorpc_game_stop` with `{}` to stop the current session. Native stop
releases injected held input and requests play-test shutdown; reread status to
confirm the session has stopped. Play and stop do not replace a level save.
