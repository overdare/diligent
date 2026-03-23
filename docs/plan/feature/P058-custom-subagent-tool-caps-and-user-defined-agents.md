---
id: P058
status: backlog
created: 2026-03-23
---

# Custom Subagent Tool Caps and User-Defined Agents

## Goal

Allow each `spawn_agent` call to narrow the child agent's tool set with an explicit per-spawn allow-list, and standardize built-in and user-defined agent definitions on the same frontmatter-backed markdown format.

After this work, Diligent can spawn named agents such as `general`, `explore`, and `code-reviewer`, all defined through the same markdown frontmatter format, while preserving separate loading responsibilities for built-in defaults versus user-defined project/global agents.

## Prerequisites

- Existing collab runtime with `spawn_agent`, `wait`, `send_input`, and `close_agent`
- Existing built-in agent registry in `packages/runtime/src/agent/agent-types.ts`, whose prompt/metadata files will be normalized to the same format used by user-defined agents
- Existing child-tool filtering in `packages/runtime/src/collab/registry.ts`
- Existing skill discovery/frontmatter pipeline that can be used as the reference pattern for file-based agent discovery (D052, D053)
- Existing runtime config loading and system-prompt assembly flow in `packages/runtime/src/config/runtime.ts`

## Artifact

Built-in and user-defined agents use the same markdown frontmatter format, but not the same filesystem layout. A user-defined example in `.diligent/agents/code-reviewer/AGENT.md`:

```md
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: read, glob, grep
model_class: general
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Then the main agent can use it directly:

```text
User → "Review the recent auth refactor carefully."
Agent → calls spawn_agent with agent_type="code-reviewer"
Agent → child agent runs with only read/glob/grep available
Agent → returns a focused review summary to the parent
```

And the parent can further narrow tools for a specific invocation:

```text
User → "Use the code reviewer, but only inspect files without grep."
Agent → calls spawn_agent with agent_type="code-reviewer", allowed_tools=["read", "glob"]
Agent → child agent runs with read/glob only
```

If the parent narrows too far and no tools remain, the child still runs with no tools available rather than erroring during spawn:

```text
User → "Use the reviewer but do not let it use any tools."
Agent → calls spawn_agent with agent_type="code-reviewer", allowed_tools=[] or an effective empty intersection
Agent → child agent runs as a pure prompt-only reviewer
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| packages/runtime/src/collab | Extend `spawn_agent` params and child-tool resolution so each child session can be capped by per-spawn `allowed_tools` |
| packages/runtime/src/agent | Introduce a shared resolved-agent-definition layer that represents all agents after loading built-in defaults and user-defined `AGENT.md` files |
| packages/runtime/src/agents | Add file-based `AGENT.md` discovery, frontmatter parsing, validation, and prompt extraction using the same directory-oriented pattern as skills |
| packages/runtime/src/config | Add config support for enabling/disabling agent discovery paths and load discovered agents into runtime config |
| packages/runtime/src/tools | Update `spawn_agent` tool description/schema to surface custom agents and the new allow-list parameter |
| packages/runtime/src/config/instructions.ts | Add an agents section to the system prompt so the parent model can discover available custom agents |
| packages/runtime/test | Add unit/integration coverage for parsing, discovery, resolution, and collab child-tool enforcement |
| packages/e2e | Add protocol-level coverage proving custom agents and per-spawn tool caps work through the runtime boundary |

### What does NOT change

- No agent marketplace, remote download, or published-agent registry
- No natural-language generation of agent files
- No UI-first agent editor in this phase; authoring remains file-based
- No per-agent custom approval rules or independent sandbox model in this phase
- No nested sub-agent spawning; collab tools remain unavailable to child agents
- No direct model-id selection from agent frontmatter in this phase; frontmatter carries `model_class` directly instead of model IDs or aliases
- No separate frontend-only behavior; Web and TUI continue to rely on shared runtime/protocol behavior
- No user editing of shipped built-in agents in this phase; built-ins remain runtime-owned defaults even though they share the same file format

## File Manifest

### packages/runtime/src/agent/

| File | Action | Description |
|------|--------|------------|
| `agent-types.ts` | MODIFY | Keep built-in runtime semantics but source built-in prompt/metadata from normalized markdown files |
| `mode.ts` | MODIFY | Reuse or expose readonly tool-set filtering helpers needed by resolved agent policies |
| `resolved-agent.ts` | CREATE | Shared agent-definition types and resolution helpers for built-in plus user-defined agents |

### packages/runtime/src/agent/default/

| File | Action | Description |
|------|--------|------------|
| `general.md` | CREATE | Built-in general agent definition using the same frontmatter/body format as custom agents |
| `explore.md` | MODIFY | Normalize built-in explore agent file to the same frontmatter/body format as custom agents |

### packages/runtime/src/agents/

| File | Action | Description |
|------|--------|------------|
| `index.ts` | CREATE | Public exports for agent discovery, parsing, and rendering |
| `types.ts` | CREATE | `AgentFrontmatter`, `AgentMetadata`, `ResolvedAgentDefinition`, and load result types |
| `frontmatter.ts` | CREATE | Parse and validate `AGENT.md` frontmatter and normalize tool names plus `model_class` |
| `discovery.ts` | CREATE | Discover project/global/additional-path custom agents |
| `render.ts` | CREATE | Render available-agent metadata into the parent system prompt |

### packages/runtime/src/collab/

| File | Action | Description |
|------|--------|------------|
| `spawn-agent.ts` | MODIFY | Add `allowed_tools` parameter and expanded `agent_type` semantics |
| `registry.ts` | MODIFY | Resolve child tool sets via built-in/custom agent definitions plus per-spawn allow-list intersection |
| `types.ts` | MODIFY | Thread custom-agent registry metadata and/or resolved-agent dependencies into collab deps |

### packages/runtime/src/config/

| File | Action | Description |
|------|--------|------------|
| `schema.ts` | MODIFY | Add `agents.enabled` and `agents.paths` config schema |
| `runtime.ts` | MODIFY | Load discovered agents and include them in runtime config + system prompt assembly |
| `instructions.ts` | MODIFY | Accept an optional agents section alongside knowledge and skills |

### packages/runtime/src/tools/

| File | Action | Description |
|------|--------|------------|
| `defaults.ts` | MODIFY | Pass discovered agents into collab tool construction |
| `tool-metadata.ts` | MODIFY | Document whether new agent-related tools/metadata need plan-mode or collab treatment |

### packages/runtime/test/agents/

| File | Action | Description |
|------|--------|------------|
| `frontmatter.test.ts` | CREATE | Validate required fields, alias normalization, duplicate handling, and invalid tool/model errors |
| `discovery.test.ts` | CREATE | Verify discovery precedence, file-shape expectations, and name collision handling |
| `render.test.ts` | CREATE | Verify prompt rendering stays concise and deterministic |

### packages/runtime/test/collab/

| File | Action | Description |
|------|--------|------------|
| `registry.test.ts` | MODIFY | Add tests for custom agent resolution and per-spawn `allowed_tools` intersection |
| `spawn-agent.test.ts` | MODIFY | Add schema/description tests for the new parameter and agent lookup behavior |

### packages/runtime/test/config/

| File | Action | Description |
|------|--------|------------|
| `runtime.test.ts` | MODIFY | Verify runtime config loads agents and system prompt metadata correctly |

### packages/e2e/

| File | Action | Description |
|------|--------|------------|
| `custom-agents.test.ts` | CREATE | End-to-end coverage for spawning custom agents and enforcing child-tool caps |

### docs/plan/feature/

| File | Action | Description |
|------|--------|------------|
| `P058-custom-subagent-tool-caps-and-user-defined-agents.md` | CREATE | This execution plan |

## Implementation Tasks

### Task 1: Normalize built-in agent files to the same frontmatter/body format

**Files:** `packages/runtime/src/agent/agent-types.ts`, `packages/runtime/src/agent/default/general.md`, `packages/runtime/src/agent/default/explore.md`, `packages/runtime/src/agent/resolved-agent.ts`
**Decisions:** D063, D070

Keep built-in agents runtime-owned, but normalize their markdown file format so `general` and `explore` use the same frontmatter/body structure as user-defined agents. Runtime code should still own enforcement semantics such as tool-policy interpretation and collab exclusions, while human-authored metadata/prompt content lives in markdown files.

```typescript
export interface ResolvedAgentDefinition {
  name: string;
  description: string;
  source: "builtin" | "user";
  systemPromptPrefix?: string;
  allowedTools?: string[];
  readonly: boolean;
  defaultModelClass?: "pro" | "general" | "lite";
}

export function resolveBuiltinAgentDefinition(name: string): ResolvedAgentDefinition | undefined;
```

Built-in file examples:

```md
---
name: general
description: General-purpose agent with full tool access for complex tasks
model_class: general
---

Execution agent for implementation and production work.
```

```md
---
name: explore
description: Read-only agent for codebase exploration and research
model_class: lite
---

Fast, authoritative codebase Q&A for specific scoped questions.
```

Runtime maps built-in names to policy in code:

- `general` → `readonly: false`, `allowedTools: undefined`
- `explore` → `readonly: true`, `allowedTools: undefined`

For both built-in and user-defined agents, omitted `tools` means "inherit the parent-visible tool set before any per-spawn `allowed_tools` narrowing".

Keep current spawn guidance formatting intact, but allow later composition with custom-agent metadata.

Built-ins remain loaded from `packages/runtime/src/agent/default/*.md`, not from project/global discovery roots.

**Verify:** Built-in agent behavior remains unchanged after normalizing prompt/metadata files, and built-ins do not participate in user-agent precedence rules.

### Task 2: Add a resolved-agent-definition layer for built-in and custom agents

**Files:** `packages/runtime/src/agent/agent-types.ts`, `packages/runtime/src/agent/resolved-agent.ts`, `packages/runtime/src/agents/types.ts`
**Decisions:** D063, D070

Introduce a runtime-level definition shape that can represent either a built-in agent type loaded from `src/agent/default/*.md` or a discovered user-defined agent loaded from `.diligent/agents/**/AGENT.md`. The key design goal is to make child-tool resolution and prompt injection independent from the source of the definition.

```typescript
export interface ResolvedAgentDefinition {
  name: string;
  description: string;
  source: "builtin" | "user";
  systemPromptPrefix?: string;
  allowedTools?: string[];
  readonly: boolean;
  defaultModelClass?: "pro" | "general" | "lite";
  filePath?: string;
}
```

This layer should not care whether the source was a shipped built-in file or a discovered user file.

**Verify:** Resolution and child-tool filtering operate on one unified definition shape.

### Task 3: Add file-based `AGENT.md` discovery and validation

**Files:** `packages/runtime/src/agents/types.ts`, `packages/runtime/src/agents/frontmatter.ts`, `packages/runtime/src/agents/discovery.ts`, `packages/runtime/src/agents/index.ts`
**Decisions:** D052, D053, D063

Add a discovery pipeline parallel to skills, but specialized for reusable spawnable agents.

Recommended discovery roots:

- project-local `.diligent/agents/`
- global `~/.diligent/agents/`
- optional configured paths from `config.agents.paths`

Discovery precedence:

1. project-local agents
2. configured additional paths in declared order
3. global agents

File contract:

- directory-based: `<root>/<agent-name>/AGENT.md`
- frontmatter required
- markdown body required
- mirror the same "folder contains one markdown entry file" shape used by skills

```typescript
export interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  model_class?: "pro" | "general" | "lite";
}

export interface AgentMetadata {
  name: string;
  description: string;
  filePath: string;
  content: string;
  tools?: string[];
  defaultModelClass?: "pro" | "general" | "lite";
}

export interface AgentLoadResult {
  agents: AgentMetadata[];
  errors: Array<{ filePath: string; error: string }>;
}
```

Validation rules:

- `name` follows the same kebab-case rules as skills
- `description` required and length-bounded
- `tools`, when present, are normalized to canonical tool names (`read`, `glob`, `grep`, ...)
- omitted `tools` means parent-tool inheritance
- unknown tools are load errors
- duplicate names at the same precedence tier are load errors
- when the same custom-agent name exists in multiple tiers, the higher-precedence definition wins silently in effective runtime resolution
- collisions with built-in names (`general`, `explore`) are load errors
- empty markdown body is a load error
- `model_class`, when present, must already be one of `pro | general | lite`

This keeps frontmatter aligned directly with the existing collab model-class machinery and avoids introducing alias semantics in this phase.

**Verify:** Discovery returns valid agents, rejects invalid names/tools/model classes, prefers project definitions over lower-precedence duplicates, and reports same-tier collisions deterministically.

### Task 4: Load built-in plus discovered agents into runtime config and system prompt metadata

**Files:** `packages/runtime/src/config/schema.ts`, `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/config/instructions.ts`, `packages/runtime/src/agents/render.ts`, `packages/runtime/src/agent/agent-types.ts`
**Decisions:** D035, D052, D053

Extend config schema:

```typescript
agents: z
  .object({
    enabled: z.boolean().optional(),
    paths: z.array(z.string()).optional(),
  })
  .optional();
```

Extend `RuntimeConfig` to carry all available agents after precedence resolution:

```typescript
export interface RuntimeConfig {
  // ...existing fields...
  agents: AgentMetadata[];
}
```

Load order:

1. built-in agents from `packages/runtime/src/agent/default/*.md`
2. global agents
3. configured additional paths in order
4. project-local agents

Effective resolution still follows the user-confirmed precedence rule:

1. project-local
2. configured additional paths
3. global
4. built-in defaults

Render an agents section similar to skills metadata so the parent agent always knows custom agents exist without always loading their full bodies.

```typescript
export function renderAgentsSection(agents: AgentMetadata[]): string;
```

Recommended rendered fields per agent:

- name
- description
- default tools summary
- default model-class summary when present

This preserves progressive disclosure: metadata is always visible to the parent model, while the full prompt body is only loaded into the child when the agent is actually spawned.

**Verify:** Runtime config exposes discovered agents and the system prompt includes an agents section when agents exist.

### Task 5: Extend `spawn_agent` to accept per-spawn `allowed_tools`

**Files:** `packages/runtime/src/collab/spawn-agent.ts`, `packages/runtime/src/collab/types.ts`
**Decisions:** D063, D064, D070

Extend the tool schema:

```typescript
const SpawnAgentParams = z.object({
  message: z.string(),
  description: z.string(),
  agent_type: z.string().default("general"),
  resume_id: z.string().optional(),
  model_class: z.enum(["pro", "general", "lite"]).optional(),
  allowed_tools: z.array(z.string()).optional(),
  thoroughness: z.enum(["quick", "thorough"]).optional(),
});
```

Update the description so the parent model understands that:

- `agent_type` may reference a built-in or custom agent
- `allowed_tools` is an optional per-spawn subset and may intentionally narrow to zero tools
- the final tool set can only narrow, never expand, child access

Preserve current built-in parameter semantics and backward compatibility for existing calls.

**Verify:** Tool schema accepts the new field and still accepts current `general` / `explore` usage.

### Task 6: Resolve child tools from parent tools ∩ agent defaults ∩ per-spawn caps

**Files:** `packages/runtime/src/collab/registry.ts`, `packages/runtime/src/agent/resolved-agent.ts`
**Decisions:** D064, D070

Extract child-tool resolution into a helper so the policy is explicit and testable.

```typescript
export interface ResolveChildToolsArgs {
  parentTools: Tool[];
  agent: ResolvedAgentDefinition;
  allowedTools?: string[];
}

export function resolveChildTools(args: ResolveChildToolsArgs): Tool[];
```

Resolution order:

1. Start from `parentTools`
2. Apply agent default policy
   - if `readonly === true` → intersect with `PLAN_MODE_ALLOWED_TOOLS`
   - if `allowedTools` is present → intersect with named tool list
   - if `readonly === false` and `allowedTools` is omitted → keep all parent tools
3. Remove collab tools unconditionally
4. If `allowed_tools` is provided, intersect again
5. If the result is empty, continue with an empty child tool list

Validation rules:

- every `allowed_tools` entry must be a known tool in the parent-visible set
- `allowed_tools` cannot introduce tools the parent does not already have
- empty post-filter result is valid and means the child agent runs prompt-only

This task is the actual enforcement point; config/prompt metadata alone is not trusted.

**Verify:** Child agents cannot gain access to any tool absent from the parent, collab tools remain excluded, and empty tool lists are handled intentionally.

### Task 7: Spawn built-in and user-defined agents with prompt-body injection and model-class defaults

**Files:** `packages/runtime/src/collab/registry.ts`, `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/agents/types.ts`
**Decisions:** D063, D064

Resolve `agent_type` in this order:

1. resolved agent name exact match from the merged built-in/user-defined registry
2. otherwise error

For custom agents, inject the markdown body as the child role prefix:

```typescript
const childSystemPrompt = customAgentBody
  ? [{ label: "agent_role", content: customAgentBody }, ...parentSystemPrompt]
  : parentSystemPrompt;
```

Model precedence:

1. explicit `spawn_agent.model_class`
2. custom agent `defaultModelClass`
3. built-in agent default model class
4. parent-model fallback

This intentionally keeps agent frontmatter aligned with the existing `model_class` runtime behavior rather than introducing model IDs or alias mapping.

**Verify:** A custom agent spawns successfully, receives its own prompt body, and honors frontmatter `model_class` unless the spawn call explicitly overrides it.

### Task 8: Add protocol-facing and runtime-facing tests

**Files:** `packages/runtime/test/agents/frontmatter.test.ts`, `packages/runtime/test/agents/discovery.test.ts`, `packages/runtime/test/agents/render.test.ts`, `packages/runtime/test/collab/registry.test.ts`, `packages/runtime/test/collab/spawn-agent.test.ts`, `packages/runtime/test/config/runtime.test.ts`, `packages/e2e/custom-agents.test.ts`
**Decisions:** D004, D052, D063, D070

Add targeted tests first, then one runtime-spanning e2e flow.

Representative coverage:

- parse valid and invalid `AGENT.md` frontmatter
- load built-in markdown definitions successfully from `src/agent/default/*.md`
- reject same-tier duplicate names and built-in-name collisions
- prefer project-local agent definitions over duplicates from configured/global/built-in sources
- normalize `tools: Read, Glob, Grep` into canonical lower-case tool names
- treat omitted `tools` as inherited parent-tool access
- validate `model_class` frontmatter and thread it to child model resolution
- resolve child tools for built-in and custom agent policies
- enforce `allowed_tools` intersection
- allow empty child-tool result as a prompt-only child session
- confirm collab tools never appear in child tool lists
- confirm runtime system prompt exposes available custom-agent metadata
- confirm end-to-end spawn of a custom agent through the collab runtime path

**Verify:** `bun test packages/runtime` and targeted `packages/e2e` coverage pass without changing unrelated behavior.

## Acceptance Criteria

1. Users can define project-local custom agents using `AGENT.md` files with required `name` and `description` frontmatter.
2. Built-in agents such as `general` and `explore` are also represented as `AGENT.md` files and loaded through the same definition pipeline.
3. `spawn_agent.agent_type` accepts both built-in agents and discovered custom-agent names.
4. `spawn_agent.allowed_tools` narrows child access for a specific invocation and never grants tools the parent lacks.
5. Child agents continue to exclude collab tools regardless of built-in/custom/per-spawn configuration.
6. Agent `tools` frontmatter acts as a default child-tool restriction.
7. Agent prompt bodies are injected only into the spawned child agent, not globally into the parent context.
8. `model_class` in agent frontmatter is honored as the child default unless the spawn call overrides it.
9. Project-local agent definitions override configured/global/built-in agents of the same name.
10. Web and TUI both benefit automatically through shared runtime behavior, with no frontend-specific forks required.
11. Invalid custom-agent definitions fail clearly without crashing runtime startup.
12. New code remains strictly typed without `any` escape hatches.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `AGENT.md` frontmatter parsing and normalization | `bun test` on parser/discovery tests |
| Unit | Built-in `AGENT.md` loading | `bun test` on built-in loader tests |
| Unit | Child-tool resolution semantics | `bun test` for collab registry helpers |
| Integration | Runtime config loading of custom agents + prompt metadata injection | `bun test` for runtime config tests |
| Integration | Spawn behavior for custom agents and per-spawn `allowed_tools` | runtime collab tests with mock child manager/tool lists |
| End-to-end | App-server/runtime path honoring custom agent definitions | targeted `packages/e2e` scenario |
| Manual | Define a `code-reviewer` agent locally and ask Diligent to use it | Run CLI/Web and verify child output plus tool restrictions |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Built-in and custom agent name collisions create ambiguous dispatch | Wrong agent may spawn or startup may become non-deterministic | Reject collisions at discovery time with explicit load errors |
| Built-in markdown definitions drift from runtime-enforced semantics | Prompt/metadata may say one thing while code enforces another | Keep only metadata/prompt content in files and keep policy mapping explicit in runtime tests |
| Allow-list semantics become confusing if agent defaults and per-spawn caps disagree | Hard-to-debug child behavior | Make resolution order explicit and test `parent ∩ agent default ∩ allowed_tools` thoroughly |
| Prompt bloat from listing all custom agents in the parent system prompt | Reduced context efficiency | Render concise metadata only; load full custom-agent body only when spawning |
| Empty child tool lists may expose edge cases in prompt-only execution | Spawn succeeds but some assumptions in tests/runtime may expect tools | Add explicit test coverage for zero-tool child sessions and keep tool-resolution code path branch-free |
| Precedence-based overrides may hide a lower-priority agent unexpectedly | Users may not realize which definition is active | Make precedence deterministic, document it in runtime metadata/tests, and keep same-tier duplicates as errors |
| User-defined tool names drift from canonical runtime tool names | Discovery failures or silent mismatches | Normalize case-insensitively and fail fast on unknown names |
| Web/TUI later want richer agent UIs before protocol support exists | UX gap | Keep runtime definitions reusable so a future `agents/list` RPC can be added without reworking discovery/enforcement |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D035 | Discover project instructions via filesystem search | Config/discovery shape for project-local agents |
| D052 | Skills use frontmatter-backed markdown with progressive disclosure | Reference pattern for `AGENT.md` format and metadata/body split |
| D053 | Skill metadata is visible globally and body is loaded on invocation | Model for exposing custom agents in parent prompt while deferring full prompt injection |
| D063 | Agent types are code-defined with config override | Basis for unifying built-in and user-defined agent definitions |
| D064 | Sub-agent permission isolation and denied nesting | Basis for always excluding collab tools from child agents |
| D070 | Denied tools are removed from the LLM tool list | Reinforces enforcement-by-filtering instead of visible-but-failing child tools |
