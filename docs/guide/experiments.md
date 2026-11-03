# Product experiments

Product hosts can advertise experimental capability groups to the shared runtime and Web client. A group owns all
skills and tools named by its definition, so one setting is the source of truth for the complete capability.
Definitions may also name optional subagents. Experiment-managed subagents are always owned by the experiment rather
than regular Subagents settings, and are removed from the prompt and `spawn_agent` surface while the experiment is OFF.
Required built-in agents cannot be managed this way.

The generic Diligent host injects no definitions. In that case the Web Config panel has no Experiments section.
OVERDARE injects its definitions from `apps/overdare-ai-agent/sidecar/src/experiments.ts`.

Experiment overrides are stored in the active global namespace config (`~/.overdare/config.jsonc` for prod,
`~/.overdare-dev/config.jsonc` for dev). OVERDARE registers `issue-report` and `studio-testing`; both are
OFF unless explicitly enabled. Toggle them in Web Settings → Experiments, or edit config, for example:

```jsonc
{
  "experiments": {
    "overrides": {
      "studio-testing": true
    }
  }
}
```

Missing overrides use the product definition's `defaultEnabled` value; an explicit `false` keeps a capability OFF.
Runtime changes apply on the next turn and rebuild the active skill/tool surface together. MCP and router
registries are built at startup; restart their host after editing config.

`studio-testing` owns the `autonomous-playtest` and `luau-testing` skills, `studiorpc_game_playtest`,
`studiorpc_game_playtest_harness`, and `studiorpc_luau_test`. While OFF, the skills are absent from the runtime
system prompt and cannot be loaded over MCP, and none of the tools is exposed or callable. The base system prompt
contains no unconditional testing routing instruction; enabling the experiment advertises the skills through the
existing skill discovery flow. Manual play and low-level play-test input tools remain available.

A definition may also declare `onEnabledChange(enabled)`. The runtime calls it after `experiments/set` persists a
change that actually flips the resolved state; it is not awaited and its failure only logs, so the settings save
never fails because of it. The OVERDARE Web host uses it to inject the frktest framework into the connected Studio
level when `studio-testing` turns ON and to remove it when it turns OFF (see [luau-testing.md](luau-testing.md)).
Config edits outside `experiments/set` do not run the hook; the testing tools re-ensure the framework on use.

Product MCP entrypoints resolve the same definitions and config so an OFF experiment is not exposed through a
second client surface. Direct registry construction without resolved states also uses product defaults.
