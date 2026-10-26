# Product experiments

Product hosts can advertise experimental capability groups to the shared runtime and Web client. A group owns all
skills and tools named by its definition, so one setting is the source of truth for the complete capability.
Definitions may also name optional subagents. Experiment-managed subagents are always owned by the experiment rather
than regular Subagents settings, and are removed from the prompt and `spawn_agent` surface while the experiment is OFF.
Required built-in agents cannot be managed this way.

The generic Diligent host injects no definitions. In that case the Web Config panel has no Experiments section.
OVERDARE injects its definitions from `apps/overdare-ai-agent/sidecar/src/experiments.ts`.

Experiment overrides are stored in the active global namespace config (`~/.overdare/config.jsonc` for prod,
`~/.overdare-dev/config.jsonc` for dev). OVERDARE registers `issue-report` and `autonomous-playtest`; both are
OFF unless explicitly enabled. For example, to opt into autonomous playtest:

```jsonc
{
  "experiments": {
    "overrides": {
      "autonomous-playtest": true
    }
  }
}
```

Missing overrides use the product definition's `defaultEnabled` value; an explicit `false` keeps a capability OFF.
Runtime changes apply on the next turn and rebuild the active skill/tool surface together. MCP and router
registries are built at startup; restart their host after editing config.

`autonomous-playtest` owns the `autonomous-playtest` skill, `studiorpc_game_playtest`, and
`studiorpc_game_playtest_harness`. While OFF, the skill is absent from the runtime system prompt and cannot
be loaded over MCP, and neither tool is exposed or callable. The base system prompt contains no unconditional
autonomous-playtest routing instruction; enabling the experiment advertises the skill and its instructions
through the existing skill discovery flow. Manual play and low-level play-test input tools remain available.

Product MCP entrypoints resolve the same definitions and config so an OFF experiment is not exposed through a
second client surface. Direct registry construction without resolved states also uses product defaults.
