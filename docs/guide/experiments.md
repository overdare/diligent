# Product experiments

Hosts can advertise experimental capability groups to the shared runtime. A group owns the skills, tools and optional subagents named by its definition. Required built-in agents cannot be managed this way.

Diligent injects no definitions by default. Hosts supply definitions and their `defaultEnabled` values. Overrides are stored in the global namespace config, such as `~/.diligent/config.jsonc`:

```jsonc
{
  "experiments": {
    "overrides": {
      "report-generation": true
    }
  }
}
```

Missing overrides use the definition's default; an explicit `false` disables the capability. Disabled skills and subagents are omitted from the prompt, and disabled tools are not callable. Runtime changes apply on the next turn and rebuild the skill/tool surface together. Registries built at startup require a host restart after config edits.

A definition may declare `onEnabledChange(enabled)`. After `experiments/set` persists a change that flips the resolved state, runtime calls the hook without awaiting it. Hook failures are logged without failing the settings save. Config edits outside `experiments/set` do not run the hook.

Host entrypoints must resolve the same definitions and config so a disabled experiment is unavailable through every client surface. Direct registry construction without resolved states uses the definition defaults.
