# Claude Code in OVERDARE Studio

The OVERDARE Studio AI panel offers two icon buttons in the conversation header. The **Claude symbol** runs the user's unmodified local Claude Code CLI: it starts automatically and continues the latest saved conversation in this project, or starts a new one if no history exists. The **terminal icon** opens a plain project shell (PowerShell on Windows), without starting Claude. Returning to either view reconnects to its own running process; switching views does not stop the other process.

The conversation menu uses the same responsive sidebar, list rows, relative dates and **New conversation** icon as Diligent. Search or refresh this project's saved conversations and select a row to reopen it; the active row is highlighted. **New conversation** starts fresh while preserving previous conversations. The **OVERDARE AI Agent** icon returns to Diligent without stopping the terminal. View changes stay within one browser document and reconnect to the selected process independently of the other process's state.

Normal task interruption uses **Ctrl+C** inside the terminal. The secondary **Process actions** menu contains **End Claude process** or **End terminal process** for fully terminating a stalled or unwanted process tree. **Resume latest** or reopening a stopped view starts it again. Claude Code's native `/resume`, `/clear`, and `/branch` remain available. Selecting a conversation in the sidebar always reopens that conversation, including after those native commands.

The last selected view is saved per project under `~/.overdare[-dev]/ui/projects/<project-path-hash>/view.json`. Reopening the AI panel or restarting Studio restores Claude or the shell before mounting Diligent, even if the sidecar port changes. Selecting **OVERDARE AI Agent** records Diligent as the selected view. File previews do not change this preference.

Each launch adds a native Claude **Stop** MCP-tool hook to its temporary settings. When the main agent finishes responding, it calls `studiorpc_level_save_file` once through the owning `overdare` MCP connection, with a 15-second timeout. It is not a hook on individual tools or subagent completion. Save errors are non-blocking and do not ask the model to continue. This lifecycle event is separate from ending the terminal process. User interrupts and API failures do not trigger the normal Stop event. Shared and project Claude settings remain untouched. See [Claude's hook reference](https://code.claude.com/docs/en/hooks#stop).

The terminal header shows the project directory and process or connection status. Initial startup waits for terminal output before dismissing the command loading card. Session changes retain their pending feedback through the old process's exit until its replacement is running. Reconnecting, stopped, and failed states provide explicit feedback without changing terminal input handling.

The session picker reads light metadata with the official Agent SDK in a short-lived process using the same selected Claude profile. It does not run inference through the SDK, parse internal transcripts, or write to Claude's saved conversations. Selection is restricted to the current project. Native `--resume` loads the conversation; per-launch Studio instructions are appended. For CLI versions that advertise `--system-prompt-snapshot`, the host disables snapshot reuse so resumed conversations receive current Studio instructions. Older CLIs do not receive that unsupported flag.

After installing a new runtime, an already-running Studio may still be serving the previous AI panel. Apply the Studio agent update or save the project and restart Studio to load the new panel. Reloading only the web page does not replace the running sidecar. Non-shipping Studio builds expose `MCP.Agent.Update` as the equivalent native console action.

## Installation and authentication

Install the official native Claude Code CLI and make `claude` discoverable on PATH. `OVERDARE_CLAUDE_PATH` can select an existing native executable. The runtime does not download, patch, or emulate Claude Code.

By default the terminal uses the normal Claude Code profile, so an existing native login is reused. It also honors an explicitly selected `CLAUDE_CONFIG_DIR` and the native authentication/provider environment (including `CLAUDE_CODE_OAUTH_TOKEN`). Claude Code itself reads and refreshes its login; OVERDARE never copies credential files or exchanges tokens on the user's behalf. If no login exists, sign in through Claude Code's own official flow.

Set `OVERDARE_CLAUDE_PROFILE_MODE=isolated` on the sidecar or native launcher for a separate product profile. This mode drops inherited Claude/Anthropic authentication and provider variables and uses a product-specific login. Both modes discard parent-agent nesting/transcript variables and `OTEL_*` exporters. The Git Bash executable location remains available.

Windows requires ConPTY (Windows 10 version 1809 or later). xterm.js renders the screen using the OVERDARE web design tokens. Normal keyboard input, Korean/Unicode text, terminal resize, Ctrl+C, and reconnect use the real native terminal protocol.

The child terminal enables truecolor output and drops inherited `NO_COLOR`, so a colorless parent build runner cannot disable Claude's terminal colors. This affects only new child processes, not global shell settings or an already-running Claude session.

The host keeps `DISABLE_TELEMETRY=1` and explicitly enables Claude's native cursor per launch with `CLAUDE_CODE_NATIVE_CURSOR=1`, unless the parent explicitly selects another value. In Claude Code 2.1.220, disabling telemetry also bypasses cached feature flags, including the native-cursor rollout. Without the explicit cursor selection, Claude draws an inverse white cell and parks the hidden real cursor elsewhere; terminal IME preedit follows that parked position. This setting leaves user profile files unchanged and applies when launching or resuming a new process.

The web terminal guards Chromium IME events before xterm's capture handlers. While xterm owns an active/deferred composition, redundant `insertText` and keypress events do not send the same commit again. xterm still reads the actual textarea and performs the commit; repeated syllables, paste, and genuine following keys are preserved. The guard also preserves an owned composition across Windows modifier virtual-key codes, composing letter keys, Process/0 and HangulMode/21, which xterm otherwise treats as premature finalization. Browser acceptance includes these controlled event traces, Korean commits, repeated syllables, final-consonant payload differences, and immediate English transitions over a real native PTY. Native OS IME coverage must be distinguished from these controlled DOM-event regressions.

## Isolation

The product environment's global storage root contains:

```text
~/.overdare[-dev]/claude-code/
  profile/                 optional isolated Claude configuration and login
    anthropic/             optional isolated Anthropic configuration
  launches/<uuid>/         per-run prompt, settings, and MCP configuration
```

Claude starts directly in the Studio project directory, for example `C:\Projects\MyWorld`, rather than in `.overdare-dev`, `.overdare`, or a global hashed workspace. Supporting files and docs therefore live with the project. Product session metadata under the hidden product directory remains managed by OVERDARE.

The host never writes the user's home configuration, project `.claude` files, shell profile, or global MCP definitions. The appended prompt, strict MCP configuration, and launch settings are per process. The launch settings exclude discovered ancestor instruction files. The shared profile retains normal user preferences and plugins, and native actions such as `/logout` or changing user settings apply to the shared profile. Isolated mode sets configuration directory overrides only on the child.

The host launches with `--dangerously-skip-permissions` (YOLO mode). This is a process argument, never a persistent change to shared permission settings. Claude runs with the user's normal OS permissions and skips its native tool-approval prompts in this session.

The host renders the deployed product `system-prompt.txt`, adapts its generic-agent convention, and passes it through `--append-system-prompt-file`. Shared memory guidance remains intact and describes what to preserve using available native memory or project documents. Claude Code retains its own system prompt and tool guidance. New launches receive the current product instructions; an explicitly resumed conversation may retain Claude Code's saved system prompt until compaction, depending on CLI version.

## Shared skills and agents

The selected storage root (`~/.overdare-dev` or `~/.overdare`) is loaded directly with session-only `--plugin-dir`. The host creates a small `.claude-plugin/plugin.json` there; it does not register a global Claude plugin or copy the skill tree. Existing bootstrap updates remain the single source of skill changes. A new Claude process discovers the updated files.

Agent definitions are read from the same root's `agents/<name>/AGENT.md`. Per-launch `--agents` JSON preserves the name, description, and body, maps `model_class: lite` to native `model: haiku`, and converts tool names to `Read`, `Glob`, `Grep`, and `mcp__overdare__studiorpc_*`. The manifest disables automatic plugin-agent discovery to prevent duplicate names and incompatible raw metadata. Sources and shared profile settings remain unchanged. Revoked agents and agents whose restrictive tool names cannot be converted are omitted instead of receiving unrestricted tools.

Skills are shared across harnesses rather than filtered by a separate compatibility list. Descriptions identify genuinely Diligent-specific configuration/reporting, while launch guidance requires the current agent to check tool and model availability. Image generation remains available as a workflow description even when the current model cannot execute it. Memory and publish-state guidance use native memory or project documents; tool names are examples. Stale product-retired skill files can still appear in native discovery; the host identifies their names in instructions and says not to use them. This descriptive approach is guidance, not enforced exclusion. Native Claude 2.1.220 does not support selective plugin-skill hiding through `skillOverrides`, manifest skill paths, or `Skill` permission denial.

## Studio binding and MCP

The runtime bundles `assets/bin/overdare-mcp` and starts it with `--embedded-studio=<owner-id>`. This connection:

- Resolves tools, prompts, and catalogs only from the owning Studio instance.
- Cannot switch to another Studio, including after its owner closes or becomes unreachable.
- Omits `ensure_system_prompt` and the duplicate `load_skill` entry point; direct attempts to invoke either are rejected.
- Keeps the product Studio tools; skills use Claude's native plugin loader.

Ordinary external MCP clients retain their existing prompt-bootstrap and Studio-selection behavior. The embedded mode is per router process, not a global sidecar setting.

Terminal transport is a separate authenticated loopback WebSocket. It uses a per-host token and an exact origin allowlist. Terminal content is not sent through the Diligent conversation protocol or host analytics/logging. Claude Code itself persists its own session data in the selected profile and communicates with its selected inference provider.

The host keeps a bounded headless terminal buffer and serializes screen, cursor position, selected terminal modes, and native cursor visibility on reconnect, rather than replaying an arbitrary truncated byte stream. Cursor shape and dynamic palette overrides are not fully covered by the snapshot. Closing/reloading the web view keeps the session alive; closing its Studio/sidecar stops the process tree. The Windows helper enters a private kill-on-close Job Object before creating children, so forced helper termination also cleans up descendants.

Windows lifecycle audit exercised explicit stop, forced helper termination and forced sidecar-parent termination with disposable child/grandchild processes. The observed descendants exited in those cases. The inherited-stdio Bun CLI fixture also exited with its descendants when its parent was forcibly stopped. This evidence applies to the exercised Windows boundaries; it does not prove every native-launcher or Unix descendant path. Keeping one shell and one Claude process alive after detaching their views is intentional, and process termination remains separately available.

One connected view controls the shared terminal size. The first connection owns sizing; clicking or typing in another terminal view transfers ownership, as do explicit start and conversation selection. Disconnecting the owner transfers sizing to the oldest remaining connection. Other views follow the authoritative grid and may scroll when it exceeds their available space. Browser resize observers propose dimensions without changing their local grid; the server broadcasts accepted changes in output order. Both browser and server drain queued terminal writes before resetting or changing geometry. On Windows, both use the same ConPTY compatibility behavior.

## Native terminal

The installed launcher also supports:

```text
overdare-ai-agent --agent-env=dev claude [--studio-id=<id>] [--new | --resume=<id> | --list-sessions]
```

This launches Claude Code in the current native terminal using the same isolation, prompt rendering, and MCP binding. One running Studio is selected automatically; multiple instances require an explicit id. The packaged sidecar also accepts `diligent-web-server claude --help`.

## Product distribution conditions

Anthropic's [official legal and compliance documentation](https://code.claude.com/docs/en/legal-and-compliance) explicitly permits running its unmodified CLI inside third-party products, including end-user subscription login. The product provider must accept the Commercial Terms, preserve every built-in authentication method, and let each user authenticate and pay directly under their own agreement. Collecting subscription tokens for a separate API client, paying for usage on users' behalf, and reselling or intermediating that usage are excluded.

Anthropic restricts using its names and logos as the host's own branding. At the user's explicit request, the launch action uses the Claude symbol to identify the installed third-party executable; the plain shell uses a separate terminal icon. This implementation choice does not establish Anthropic's written logo permission, the company's agreement acceptance, or completion of a release-specific legal review.

## Development and validation

Build Rust helpers with `cargo build --manifest-path apps/overdare-ai-agent/Cargo.toml --bins`. Source-mode hosts discover them under `target/debug`; packaged hosts use their versioned `assets/bin` copies. `OVERDARE_TERMINAL_PATH` and `OVERDARE_MCP_PATH` provide development overrides. The normal runtime-bundle build stages both native helpers.

Focused checks:

```text
cargo test --manifest-path apps/overdare-ai-agent/Cargo.toml
bun test ./apps/overdare-ai-agent/sidecar/test/claude
```

For browser acceptance, build the web client, set `CLAUDE_HOST_BROWSER_TEST=1`, and run `bun test ./apps/overdare-ai-agent/sidecar/test/web/claude-terminal.browser.test.ts`. Node.js must be on PATH or selected with `NODE_BINARY`; Chrome can be selected with `CHROME_PATH`. Node drives Playwright because Bun's Windows remote-debugging pipe is unreliable. The test uses a real native PTY and checks Unicode input, interruption, resize, and reconnect. Screenshots are written under `artifacts/claude-host/`.

The native MCP integration test runs when a debug router has been built, or when `OVERDARE_MCP_PATH` selects a packaged binary. The packaged startup fixture can be run with `bun apps/overdare-ai-agent/sidecar/test/fixtures/verify-packaged-claude.ts <extracted-runtime-directory>`. It uses a temporary home, runs Claude's own MCP health check against the packaged router, and checks actual Claude onboarding without logging in or making an inference request. The health check saves its configuration only inside the disposable profile; interactive launches continue using `--mcp-config`. Live model and Studio-world acceptance require a running Studio project and the user's native Claude authentication.

### Standalone Windows IME comparison

Run `bun apps/overdare-ai-agent/sidecar/test/fixtures/terminal-ime-lab/server.ts` for a small WinForms/WebView2 window. It requires .NET 8 or later and the WebView2 runtime. The lab compares local xterm echo, a deterministic ConPTY prompt, and the installed native Claude executable. The Claude mode uses shared authentication and a fresh session in `artifacts/terminal-ime-lab/workspace`, without Studio MCP or model requests initiated by the fixture. Event traces stay in memory until explicitly exported and include the text typed into the test terminal.

For the Studio engine comparison, add `--engine=cef --claude --cef-runtime=<absolute Studio CEF directory>`. The runner copies the actual Studio CEF DLL and resources into private lab output, verifies the DLL hash, and checks the loaded CEF/Chromium versions through `cef_version_info`. The supported comparison version is CEF 128.4.13 / Chromium 128.0.6613.138. The ordinary CefSharp wrapper version properties describe its build headers, so they are not runtime-version evidence. WinForms CEF still uses a different native input/rendering integration from Unreal's windowless Slate browser.

To eliminate the lab frontend and fresh-session differences, start Claude once in Studio, navigate that Studio panel away from `/claude`, then run the built `artifacts/terminal-ime-lab/cef-win/TerminalImeLabCef.exe` with the actual sidecar's `http://127.0.0.1:<port>/claude` URL and a separate absolute CEF profile directory. This loads the production React page and attaches to the same product-owned PTY. Compare the host's terminal ID and conversation ID before and after; only read the bootstrap `status`, not its authentication token, into diagnostic output. Keep one terminal view active at a time to avoid competing resize messages. Do not press Start, New session, or Stop during this attachment comparison.

For a pure frontend attached to that same process, the lab also accepts `--attach=http://127.0.0.1:<source-port>`. Its authenticated loopback relay never starts, selects, or stops the source session, and closing the lab only disconnects its own reader. Attached mode follows the existing grid without fitting the source to the lab window. `--product-client=<absolute dist/client directory>` optionally serves an existing product build at `/claude`, with a link from the lab, so one window can switch between the two frontends on the same process. These diagnostics are optional fixtures, not installed Studio UI.
