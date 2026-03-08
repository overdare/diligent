---
id: P041
status: proposed
created: 2026-03-07
updated: 2026-03-08
---

# P041: Branded Distribution Packaging

## Summary

Add a productization layer that allows Diligent to ship official branded releases without renaming the internal core.

The feature should support exporting releases such as `OVERCODE` that bundle:

1. branded product identity such as app name, CLI name, and visible titles
2. release-default configuration values
3. bundled custom tool plugins
4. optional bundled skills, prompts, and assets
5. a repeatable packaging pipeline that can produce official release artifacts from a declarative spec

This plan intentionally keeps `diligent` as the internal engine name. The goal is not to fork the codebase into a separate product per brand, but to add a formal branded distribution layer on top of the existing core.

## Motivation

Today, Diligent can be built and shipped as a working CLI, Web app, and Desktop app, but it is still a single-product codebase:

- visible product identity is hardcoded in multiple places
- config and storage namespaces are tightly coupled to `.diligent` and `~/.config/diligent`
- plugin loading is designed for developer installation and global fallback, not official bundled distribution
- there is no first-class concept of a branded release manifest
- release packaging is tied to repository build scripts rather than a reusable distribution pipeline

That makes it difficult to produce an official release that says `OVERCODE` externally while still reusing the existing internal engine.

## Problem Statement

The desired product behavior is roughly:

- internal code, packages, and engine types can stay `diligent`
- exported artifacts should be able to present themselves as a different product name such as `OVERCODE`
- branded releases should be able to ship with their own default config and curated custom tools
- the same repository should be able to produce more than one branded release over time

The current codebase lacks the abstractions needed for that. Product identity, storage paths, and packaging inputs are mixed together with implementation details.

## Refresh Notes (2026-03-08)

This refresh updates P041 from a mostly forward-looking concept document into an execution-oriented plan grounded in the current repo state.

Important corrections and new facts:

- P036 groundwork is already landed.
  - CLI now supports `diligent app-server --stdio`.
  - Web now uses raw JSON-RPC and receives bootstrap metadata from `initialize`.
  - `DiligentAppServer` already has a concrete `getInitializeResult()` injection point that can carry product identity.
- Packaging groundwork already exists.
  - root `package.json` already ships compiled CLI build targets
  - `packages/web` already has a standalone build pipeline
  - `apps/desktop` already packages a Tauri app with a compiled Bun sidecar and post-build artifact copy step
- Tool settings behavior in the repo is currently global-first, not project-local.
  - `loadDiligentConfig()` ignores project-level `tools` overrides
  - app-server `TOOLS_LIST`/`TOOLS_SET` currently read and write the global config path
- Because of that, P041 should reuse the current transport and build entry points where possible instead of inventing parallel bootstrap or packaging flows.

## Current Checkpoint in Repo

### Product identity is hardcoded in visible surfaces

Examples already present in the repo:

- `packages/cli/package.json`
  - CLI bin name is currently `diligent`
- `packages/cli/src/index.ts`
  - version output prints `diligent 0.0.1`
- `packages/cli/src/tui/commands/builtin/misc.ts`
  - visible TUI text includes `Exit diligent` and `diligent v...`
- `packages/web/src/client/components/Sidebar.tsx`
  - sidebar title shows `diligent`
- `packages/web/index.html`
  - document title is hardcoded to `Diligent`
- `packages/web/src/client/App.tsx`
  - initialize call currently sends hardcoded `clientName: "diligent-web"`
- `apps/desktop/src-tauri/src/lib.rs`
  - desktop window title is `Diligent`
- `apps/desktop/src-tauri/tauri.conf.json`
  - desktop identifier is `app.diligent.desktop`
- `apps/desktop/scripts/copy-dist.ts`
  - packaged app and binary output names are hardcoded to `Diligent.app` and `diligent-desktop...`
- `apps/desktop/scripts/build-sidecar.ts`
  - sidecar output name is hardcoded to `diligent-web-server-<target>`
- root `package.json`
  - compiled CLI artifact names are hardcoded to `dist/diligent*`

### Storage and config namespaces are tied to `diligent`

Examples already present in the repo:

- `packages/core/src/infrastructure/diligent-dir.ts`
  - project-local directory is `.diligent`
- `packages/core/src/config/loader.ts`
  - global config path uses `~/.config/diligent/diligent.jsonc`
  - project config path uses `.diligent/diligent.jsonc`
  - current merge behavior explicitly ignores project-level `tools` overrides
- `packages/core/src/config/writer.ts`
  - exposes both project and global config path helpers under the diligent namespace
- `packages/core/src/app-server/thread-handlers.ts`
  - tool settings UI currently reports `getGlobalConfigPath()` and persists via `writeGlobalToolsConfig()`
- `packages/core/src/auth/auth-store.ts`
  - auth path uses `~/.config/diligent/auth.json`
- `packages/core/src/skills/discovery.ts`
  - global skill path uses `~/.config/diligent/skills`
  - project skill path uses `.diligent/skills`
- `packages/web/src/shared/image-routes.ts`
  - image routes assume `.diligent/images`
- `packages/core/src/app-server/server.ts`
  - image persistence paths assume `.diligent/images`

### Plugin loading already exists, but not as a branded distribution system

Relevant files:

- `packages/core/src/tools/plugin-loader.ts`
  - supports regular package import
  - falls back to `~/.diligent/plugins/<packageName>`
- `packages/core/src/tools/catalog.ts`
  - merges built-ins and configured plugin packages
- `packages/core/src/config/writer.ts`
  - provides JSONC-preserving tool config persistence helpers used by runtime settings flows
- `packages/core/src/app-server/server.ts`
  - exposes protocol-backed tool settings list and set operations
- `packages/web/src/client/components/ToolSettingsModal.tsx`
- `packages/cli/src/tui/commands/builtin/tools.ts`

This is useful groundwork, but it is not yet a release-bundling mechanism.

### Transport and bootstrap groundwork already exists

Relevant files:

- `packages/core/src/app-server/factory.ts`
  - centralizes runtime-to-app-server wiring for CLI and Web
- `packages/core/src/app-server/server.ts`
  - `initialize` already merges a `getInitializeResult()` payload into the protocol response
- `packages/protocol/src/client-requests.ts`
  - initialize response schema already carries shared bootstrap metadata such as `cwd`, `mode`, `effort`, `currentModel`, and `availableModels`
- `packages/cli/src/app-server-stdio.ts`
  - CLI child app-server path already builds `DiligentAppServer` through `createAppServerConfig()`
- `packages/web/src/server/index.ts`
  - Web server already builds initialize metadata through `createAppServerConfig({ overrides: { getInitializeResult } })`
- `packages/web/src/client/App.tsx`
  - Web client already treats `initialize` as the bootstrap source of truth

This means P041 does not need a new bootstrap channel. It should extend the existing initialize/bootstrap path with product metadata.

### Build and packaging groundwork already exists

Relevant files:

- root `package.json`
  - compiled CLI build targets already exist for darwin, linux, and windows
- `packages/web/package.json`
  - standalone Web build already exists via `vite build`
- `apps/desktop/package.json`
  - desktop build already orchestrates frontend build, Bun sidecar build, and Tauri packaging
- `apps/desktop/scripts/build-sidecar.ts`
  - compiles the Web server into Tauri sidecar binaries per target triple
- `apps/desktop/scripts/copy-dist.ts`
  - copies packaged desktop artifacts into repo-root `dist/`

This means the MVP packaging plan should wrap and parameterize existing build flows first, then replace individual hardcoded names only where needed.

## Goals

1. Support branded distributions without renaming internal `@diligent/*` packages.
2. Separate visible product identity from internal engine identity.
3. Allow official releases to bundle default configuration and trusted tool plugins.
4. Keep Web and TUI aligned through shared runtime and protocol behavior.
5. Make branded packaging declarative and repeatable from a distribution spec.
6. Preserve a clean migration path from the current single-product layout.

## Non-Goals

1. No immediate rename of internal TypeScript symbols such as `DiligentAppServer` or `DiligentConfig`.
2. No attempt to sandbox plugin execution in this phase.
3. No remote plugin marketplace or plugin installation workflow in this phase.
4. No mandatory migration to branded storage paths in the first rollout.
5. No frontend-specific plugin code execution.

## Design Principles

1. **Internal engine identity stays stable**
   - `diligent` remains the internal engine and repository identity.
   - Branded products are distributions built from that engine.

2. **Branding is configuration, not a fork**
   - Product name, executable name, titles, and identifiers should come from runtime or build-time product metadata, not hardcoded strings.

3. **Bundled defaults are distinct from user config**
   - Official release defaults should not be copied into mutable user config files by default.
   - Runtime should merge built-in distribution defaults with user overrides.

4. **Official bundled plugins are first-class runtime assets**
   - Branded releases should be able to include trusted plugin packages without requiring users to install them separately.

5. **Storage namespace changes should be staged**
   - The first branded-release milestone should not require a hard break from `.diligent` paths unless explicitly chosen.

## Proposed Architecture

## 1. Introduce a product context layer

Add a new runtime concept that captures brand, storage policy, and bundled assets.

Illustrative shape:

```ts
interface ProductIdentity {
  internalName: "diligent";
  displayName: string;
  executableName: string;
  cliClientName: string;
  webClientName: string;
  desktopTitle: string;
  bundleIdentifier?: string;
  issueTrackerUrl?: string;
}

interface StoragePolicy {
  projectDirName: string;
  globalConfigNamespace: string;
  globalPluginNamespace: string;
}

interface DistributionDefaults {
  config?: Partial<DiligentConfig>;
  bundledPluginRoots?: string[];
  bundledSkillRoots?: string[];
  bundledPromptRoots?: string[];
}

interface ProductContext {
  identity: ProductIdentity;
  storage: StoragePolicy;
  defaults: DistributionDefaults;
}
```

This object should be available anywhere the runtime currently relies on hardcoded product identity or path naming.

## 2. Separate three concerns that are currently mixed together

### A. Engine layer

This is the existing internal platform:

- `@diligent/core`
- `@diligent/protocol`
- `@diligent/cli`
- internal runtime types and classes

This layer remains stable.

### B. Product identity layer

This controls what the user sees:

- product name such as `OVERCODE`
- CLI executable name
- window and sidebar titles
- app identifier and metadata
- help text and issue tracker URLs
- client names used during initialization

### C. Distribution bundle layer

This controls what ships in an official branded release:

- default config values
- bundled plugin packages
- optional skills and prompts
- icons and packaging assets
- packaging-time metadata such as bundle identifiers and artifact names

## 3. Add a branded distribution spec

Introduce a declarative release manifest that describes a branded product.

Illustrative shape:

```json
{
  "brand": {
    "displayName": "OVERCODE",
    "executableName": "overcode",
    "cliClientName": "overcode-cli",
    "webClientName": "overcode-web",
    "desktopTitle": "OVERCODE",
    "bundleIdentifier": "com.acme.overcode"
  },
  "storage": {
    "projectDirName": ".diligent",
    "globalConfigNamespace": "diligent",
    "globalPluginNamespace": ".diligent"
  },
  "defaults": {
    "config": {
      "tools": {
        "plugins": [
          {
            "package": "@acme/overcode-tools",
            "enabled": true
          }
        ]
      }
    },
    "bundledPluginRoots": [
      "./bundled/plugins"
    ]
  }
}
```

The exact shape can evolve, but the architectural point is important: branded releases should be generated from a manifest, not from ad hoc code edits.

## 4. Add a distribution-defaults config layer

Current config layering is effectively built around global and project config files. Branded packaging needs another layer beneath those.

Recommended precedence:

1. built-in distribution defaults
2. user global config
3. project-local config
4. CLI flags and other runtime overrides

This keeps official release defaults immutable and upgrade-friendly while preserving user control.

### Current runtime nuance to preserve during rollout

In the current repo, tool settings are effectively global-first:

- `loadDiligentConfig()` ignores project-level `tools` overrides
- app-server tool settings endpoints return and persist the global config path

P041 should not accidentally regress that behavior while introducing distribution defaults. If tool-scope policy changes (global vs project) are desired later, that should be an explicit follow-up decision.

### Why this matters

If release defaults are copied directly into user config on first run, upgrades become awkward:

- new release defaults do not naturally flow forward
- the source of truth becomes unclear
- user changes become hard to distinguish from packaged defaults

A read-only built-in defaults layer avoids this.

## 5. Extend plugin resolution to support bundled plugin roots

Current plugin resolution is:

1. package import
2. fallback to `~/.diligent/plugins/<packageName>`

Recommended direction for branded releases:

1. bundled plugin registry or bundled plugin roots from the distribution
2. regular package import in the current environment
3. branded global plugin path
4. legacy global plugin fallback path if compatibility mode is enabled

This allows official distributions to ship trusted plugins as part of the artifact while preserving advanced user extensibility.

### Important trust model

Bundled plugins should still be treated as fully trusted, same-process code. This plan does not change the security model for tool plugins.

## 6. Stage storage namespace work separately from branding

Branding and storage renaming should not be forced into the same milestone.

There are three viable strategies:

### Strategy A. Brand only, keep storage paths on `diligent`

Examples:

- app name: `OVERCODE`
- project dir: `.diligent`
- global config dir: `~/.config/diligent`

Pros:

- minimal migration work
- low implementation risk
- preserves compatibility with current projects and data

Cons:

- user-visible product name and storage namespace diverge

### Strategy B. Full branded storage namespace

Examples:

- app name: `OVERCODE`
- project dir: `.overcode`
- global config dir: `~/.config/overcode`

Pros:

- clean brand consistency
- better support for independent branded products

Cons:

- broader refactor
- migration and fallback behavior become necessary

### Strategy C. Branded path with legacy fallback

Examples:

- prefer `.overcode` and `~/.config/overcode`
- fall back to legacy `.diligent` and `~/.config/diligent`

Pros:

- strong migration story
- brand consistency with compatibility path

Cons:

- more complicated resolution and debugging
- precedence rules must be explicit

### Recommendation

Use Strategy A for the first official branded-release milestone.

That means:

- separate visible product identity first
- add bundled defaults and bundled plugins second
- postpone storage namespace rebranding until the productization layer is proven

## 7. Add a packaging/export pipeline

The repo needs a first-class build pathway for branded artifacts.

Illustrative command shape:

```bash
diligent package --spec ./brands/overcode.json --target darwin-arm64 --output ./release
```

Or a repository build script with equivalent behavior.

The packaging pipeline should:

1. read the distribution spec
2. build CLI, Web, and Desktop assets with branded identity values
3. assemble bundled config defaults
4. copy or embed bundled plugins
5. apply icons and package metadata
6. emit final artifacts such as platform binaries, archives, or desktop bundles

This should be implemented as a repeatable release process, not as one-off repo edits.

## Detailed Implementation Direction

Note:

- The phase sections below group work by concern. Actual delivery priority is defined later in "Suggested Delivery Order" and "Suggested MVP Cut Line."

## Phase 0: Reuse the existing runtime and packaging spine

### Scope

Before adding new abstraction modules, anchor implementation to already landed entry points.

### Required anchor points

- app-server bootstrap path via `createAppServerConfig()`
- initialize metadata extension via `getInitializeResult()`
- CLI child runtime via `diligent app-server --stdio`
- existing root/Web/Desktop build scripts as packaging primitives

### Expected outcome

P041 lands as an incremental extension of current architecture instead of introducing parallel runtime or build paths.

## Phase 1: Product identity abstraction

### Scope

Replace hardcoded visible product strings with runtime or build-time identity values.

### Example touch points

- `packages/core/src/app-server/factory.ts`
- `packages/core/src/app-server/server.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/cli/package.json`
- `packages/cli/src/index.ts`
- `packages/cli/src/tui/runner.ts`
- `packages/cli/src/tui/commands/builtin/misc.ts`
- `packages/web/src/client/components/Sidebar.tsx`
- `packages/web/src/client/App.tsx`
- `packages/web/index.html`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/scripts/build-sidecar.ts`
- `apps/desktop/scripts/copy-dist.ts`

### Expected outcome

A branded build can show `OVERCODE` in:

- CLI version output
- TUI visible text
- Web title areas
- Desktop window title and app metadata

### Recommendation

This is the lowest-risk MVP and should land first.

## Phase 2: Distribution defaults and bundled runtime assets

### Scope

Add support for:

- distribution default config layer
- bundled plugin roots
- optional bundled skills and prompts

### Likely touch points

- `packages/core/src/config/loader.ts`
- `packages/core/src/config/runtime.ts`
- `packages/core/src/tools/plugin-loader.ts`
- `packages/core/src/skills/discovery.ts`
- app-server and frontend bootstrap paths that need product metadata

### Expected outcome

A branded release can ship opinionated defaults and custom tools without requiring manual installation steps.

## Phase 3: Storage policy abstraction

### Scope

Replace hardcoded `.diligent` and `~/.config/diligent` assumptions with configurable path policy.

### Likely touch points

- `packages/core/src/infrastructure/diligent-dir.ts`
- `packages/core/src/config/loader.ts`
- `packages/core/src/config/writer.ts`
- `packages/core/src/auth/auth-store.ts`
- `packages/core/src/skills/discovery.ts`
- `packages/core/src/tools/plugin-loader.ts`
- `packages/core/src/app-server/server.ts`
- `packages/web/src/shared/image-routes.ts`
- tests that assert literal diligent paths

### Expected outcome

The runtime can support `.overcode` and `~/.config/overcode`, or deliberate legacy compatibility behavior.

## Phase 4: Formal packaging command and release validation

### Scope

Create an official packaging pipeline that consumes a distribution spec and emits branded artifacts.

### Expected outcome

A single repo can reliably produce official releases for one or more branded products.

## File-Level Design Considerations

## Core

### `packages/core/src/infrastructure/diligent-dir.ts`

Current role:

- defines `.diligent` structure and helpers

Recommended change:

- move to a product-aware path policy
- keep a default policy that preserves current behavior

### `packages/core/src/config/loader.ts`

Current role:

- resolves global and project config locations

Recommended change:

- accept distribution defaults as an additional config layer
- resolve config paths through storage policy rather than hardcoded `diligent`

### `packages/core/src/config/writer.ts`

Current role:

- exposes JSONC-preserving helpers for both project and global diligent config paths
- app-server tool settings currently use global write semantics

Recommended change:

- resolve both project and global config paths through storage policy
- preserve the existing JSONC patch semantics

### `packages/core/src/auth/auth-store.ts`

Current role:

- uses `~/.config/diligent/auth.json`

Recommended change:

- route auth path through storage policy
- decide whether auth namespace is branded in MVP or only in a later phase

### `packages/core/src/tools/plugin-loader.ts`

Current role:

- resolves plugin package import or `~/.diligent/plugins/<packageName>` fallback

Recommended change:

- support bundled plugin roots from the distribution
- make global plugin root namespaced via storage policy
- optionally support legacy diligent fallback mode during migration

### `packages/core/src/skills/discovery.ts`

Current role:

- searches `.diligent/skills` and `~/.config/diligent/skills`

Recommended change:

- resolve these roots through storage policy
- optionally merge bundled skill roots as read-only defaults

## CLI

### `packages/cli/package.json`

Current role:

- hardcodes the `diligent` executable name

Recommended change:

- keep internal package name stable if desired, but make branded artifact naming part of packaging
- avoid forcing npm package rename as part of branded distribution support

### `packages/cli/src/index.ts`

Current role:

- prints product name and uses diligent-oriented text

Recommended change:

- source visible product strings from product identity

### `packages/cli/src/config-writer.ts`

Current role:

- writes global config under the diligent namespace

Recommended change:

- route through storage policy when path names become configurable

## Web

### `packages/web/src/client/components/Sidebar.tsx`

Current role:

- shows `diligent`

Recommended change:

- consume product identity from bootstrap metadata or injected build config

### Web bootstrap and app metadata paths

Recommended change:

- ensure product identity reaches the client through shared bootstrap rather than duplicated constants
- include `packages/web/index.html` title handling in the branding path

## Desktop

### `apps/desktop/src-tauri/src/lib.rs`

Current role:

- hardcodes desktop title

Recommended change:

- replace with build-time product metadata injection

### `apps/desktop/src-tauri/tauri.conf.json`

Current role:

- hardcodes bundle identifier

Recommended change:

- support templating or build-time generation from a distribution spec

### `apps/desktop/scripts/build-sidecar.ts` and `apps/desktop/scripts/copy-dist.ts`

Current role:

- hardcode sidecar and packaged artifact naming conventions under diligent branding

Recommended change:

- parameterize artifact naming and copy targets from distribution metadata
- preserve current naming as default behavior when no distribution spec is provided

## Recommended MVP

The first official implementation should stop short of a full storage migration.

### MVP scope

1. product identity abstraction
2. branded CLI, Web, and Desktop visible naming
3. bundled distribution defaults layer
4. bundled plugin roots
5. packaging spec and release build script
6. storage remains on current `.diligent` and `~/.config/diligent` paths

### Why this is the right MVP

It solves the main product need:

- Diligent stays the internal core
- official release can present itself as `OVERCODE`
- custom tools and config can ship inside the release

At the same time, it avoids the highest-risk migration work in the first pass.

## Risks and Tradeoffs

## 1. Storage namespace mismatch may feel odd

If the product is called `OVERCODE` but paths remain `.diligent`, some users will find that inconsistent.

Mitigation:

- document it as an intentional compatibility-first MVP
- add branded storage as a follow-up phase

## 2. Plugin bundling increases release responsibility

Once official releases bundle custom tool plugins, the release process becomes responsible for:

- plugin version pinning
- plugin inventory visibility
- validating bundled plugin manifests
- ensuring repeatable builds

Mitigation:

- use locked versions and deterministic asset assembly
- expose bundled plugin state clearly in tool settings UI

## 3. Path-policy work can sprawl if started too early

Replacing literal `.diligent` and `~/.config/diligent` usage across core, CLI, Web, and tests is feasible but broad.

Mitigation:

- stage it after product identity and bundled defaults are proven

## Open Product Decisions

These decisions materially affect implementation shape and should be made explicitly before coding beyond MVP.

1. Should branded releases keep using `.diligent` paths initially, or adopt branded paths immediately?
2. Should official bundled plugins be resolved before or after local package imports?
3. Should the packaging system target only CLI first, or CLI plus Web and Desktop together?
4. Should user-visible plugin inventory distinguish bundled plugins from user-added plugins?
5. Should a branded release be able to hide internal `diligent` terminology completely from the UI and support docs?

## Recommended Decisions

For the first implementation pass, this plan recommends:

1. **Keep internal names stable**
   - do not rename `@diligent/*` packages or internal runtime types
2. **Brand visible product identity first**
   - add a formal product identity layer
3. **Add a read-only distribution-defaults config layer**
   - do not copy defaults into user config automatically
4. **Support bundled plugin roots**
   - treat official plugins as trusted bundled runtime assets
5. **Keep storage on diligent paths for MVP**
   - postpone branded path migration to a later phase
6. **Design for all frontends, but prioritize the shared runtime**
   - the branded distribution model should work across CLI, Web, and Desktop, even if packaging milestones land incrementally

## Implementation Task Breakdown

This section turns the plan into execution-oriented work items. The tasks are grouped by milestone so implementation can land incrementally without blocking on full storage namespace migration.

## Milestone 1: Product identity foundation

Goal: remove hardcoded visible product strings from shared runtime and frontends while preserving current default behavior.

Implementation note:

- This milestone should extend the existing initialize/bootstrap path and existing client boot flows, not add a separate branding transport.

### Task 1. Add product identity types and defaults in core

Deliverables:

- add a shared product identity module in core
- define default identity values that preserve current `diligent` behavior
- expose helpers for reading product identity in CLI, Web, Desktop, and app-server bootstrap

Likely files:

- `packages/core/src/...` new product metadata module
- `packages/core/src/index.ts`
- app-server bootstrap/config creation paths

Verification:

- unit tests for default product identity resolution
- no visible behavior change when no branded spec is supplied

### Task 2. Thread product identity through app-server bootstrap

Deliverables:

- make app-server initialization/bootstrap responses expose effective product identity needed by clients
- ensure Web and TUI can consume one shared source of truth instead of duplicating constants

Likely files:

- `packages/core/src/app-server/server.ts`
- `packages/core/src/app-server/factory.ts`
- protocol types if additional bootstrap metadata is required
- `packages/cli/src/tui/runner.ts` (replace hardcoded `clientName`)
- `packages/web/src/client/App.tsx` (replace hardcoded `clientName`)

Verification:

- protocol tests for new initialize/bootstrap shape
- integration tests proving clients receive identity metadata

### Task 3. Replace CLI-visible hardcoded branding

Deliverables:

- source CLI version text, help text, and user-facing product strings from product identity
- preserve internal package and code names

Likely files:

- `packages/cli/src/index.ts`
- `packages/cli/src/tui/commands/builtin/misc.ts`
- any other TUI command/help surfaces with literal `diligent`

Verification:

- CLI tests updated to assert default `diligent` identity
- smoke run for `--version`

### Task 4. Replace Web-visible hardcoded branding

Deliverables:

- source product name from bootstrap or injected runtime config
- remove duplicated visible `diligent` strings from core product surfaces in Web

Likely files:

- `packages/web/src/client/components/Sidebar.tsx`
- `packages/web/src/client/App.tsx`
- `packages/web/index.html`
- Web RPC/bootstrap handling modules

Verification:

- Web tests proving rendered product title tracks bootstrap identity

### Task 5. Replace Desktop-visible hardcoded branding

Deliverables:

- desktop window title and app metadata become driven by brand metadata
- keep default build behavior unchanged when no brand override is present

Likely files:

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- desktop build scripts that can inject metadata
- `apps/desktop/scripts/build-sidecar.ts`
- `apps/desktop/scripts/copy-dist.ts`

Verification:

- desktop smoke build or config-generation test
- default build still identifies as Diligent

## Milestone 2: Distribution defaults and bundled runtime assets

Goal: allow official releases to ship opinionated defaults and bundled trusted plugins without mutating user config.

### Task 6. Add distribution defaults model in core

Deliverables:

- define a read-only distribution-defaults layer separate from user config
- support default config payload plus bundled plugin and skill roots
- establish merge precedence beneath global and project config

Likely files:

- `packages/core/src/config/loader.ts`
- `packages/core/src/config/runtime.ts`
- new core distribution-defaults module

Verification:

- unit tests proving precedence: distribution defaults < global config < project config < runtime flags

### Task 7. Extend runtime config loading to accept injected distribution defaults

Deliverables:

- wire distribution defaults through app-server and CLI runtime creation
- preserve current behavior when no distribution defaults are present

Likely files:

- `packages/core/src/app-server/factory.ts`
- CLI config/bootstrap code
- desktop/web server bootstrap code as needed

Verification:

- integration tests with a synthetic branded distribution config

### Task 8. Add bundled plugin root support to plugin loading

Deliverables:

- extend plugin resolution to search bundled plugin roots supplied by the distribution
- define explicit search ordering for bundled plugins versus local package import and global plugin fallback
- surface clear load errors and provenance where practical

Likely files:

- `packages/core/src/tools/plugin-loader.ts`
- `packages/core/src/tools/catalog.ts`
- relevant plugin loader and catalog tests

Verification:

- unit tests for search-order behavior
- tests for missing bundled plugin, successful bundled load, and collision cases

### Task 9. Optionally add bundled skill/prompt roots

Deliverables:

- allow distribution defaults to contribute read-only skill and prompt roots
- keep project and global user content overriding or augmenting them as designed

Likely files:

- `packages/core/src/skills/discovery.ts`
- prompt-loading surfaces if prompt bundles are formalized

Verification:

- discovery tests covering bundled plus project/global roots

### Task 10. Expose bundled asset provenance in settings surfaces

Deliverables:

- decide whether tools/settings UI should indicate that a plugin came from the official bundled distribution
- expose enough metadata through protocol for Web and TUI to show it consistently

Likely files:

- protocol tool descriptor types
- `packages/core/src/app-server/server.ts`
- `packages/web/src/client/components/ToolSettingsModal.tsx`
- `packages/cli/src/tui/commands/builtin/tools.ts`

Verification:

- Web and TUI tests for bundled plugin labeling if adopted

## Milestone 3: Distribution spec and packaging pipeline

Goal: define a branded release manifest and use it to build repeatable official artifacts.

### Task 11. Define distribution spec schema

Deliverables:

- formalize a schema for brand identity, storage policy, bundled defaults, plugin roots, and packaging metadata
- document which fields are MVP-required versus later-phase fields

Likely files:

- new schema module in core or packaging layer
- docs examples under `docs/` or a dedicated `brands/` example directory

Verification:

- schema unit tests with valid and invalid branded specs

### Task 12. Add an example branded spec for `OVERCODE`

Deliverables:

- create a checked-in example spec that demonstrates intended usage
- include visible product name, executable name, default plugin package, and default config

Likely files:

- `brands/overcode.json` or similar example path
- documentation references from P041 or related docs

Verification:

- packaging smoke test can consume the example spec

### Task 13. Build a packaging assembly script

Deliverables:

- add a build script or command that reads a distribution spec and assembles a branded release directory
- include brand metadata, bundled defaults, and bundled plugin assets in the assembled output

Likely files:

- script under `scripts/` or a dedicated packaging module
- root `package.json` scripts
- `apps/desktop/package.json` (wire branded build path if desktop packaging is in MVP scope)

Verification:

- script smoke test producing a release directory from the example spec

### Task 14. Support branded CLI artifact naming

Deliverables:

- packaging script emits platform artifacts named after the branded executable, not just `diligent`
- avoid forcing a rename of internal workspace package names

Likely files:

- root build scripts in `package.json`
- packaging script
- CLI compile/build output configuration
- optionally `packages/cli/package.json` bin metadata if distribution flow requires generated wrapper metadata

Verification:

- smoke builds produce branded binary names such as `overcode`

### Task 15. Support branded Desktop metadata during packaging

Deliverables:

- packaging flow injects desktop title, bundle identifier, and icons from the distribution spec
- default desktop build still works without a spec

Likely files:

- desktop build scripts
- generated or templated Tauri config flow
- asset-copy logic for icons

Verification:

- desktop packaging smoke test for title and bundle identifier substitution

### Task 16. Support branded Web metadata during packaging

Deliverables:

- packaging/build flow injects visible product identity and any required app metadata into Web output
- keep Web bootstrap aligned with app-server identity source

Likely files:

- Web build config
- server-side bootstrap wiring
- packaging assembly script
- `packages/web/index.html`

Verification:

- Web integration test or smoke build proving branded title and metadata propagation

## Milestone 4: Storage policy abstraction

Goal: make `.diligent` and `~/.config/diligent` configurable without breaking MVP rollout.

### Task 17. Introduce storage policy abstractions in core

Deliverables:

- centralize project and global path naming into a storage policy module
- default policy preserves current diligent paths

Likely files:

- `packages/core/src/infrastructure/diligent-dir.ts`
- `packages/core/src/config/loader.ts`
- new storage policy module

Verification:

- unit tests for default and custom path-policy resolution

### Task 18. Route config, auth, skills, images, and plugin globals through storage policy

Deliverables:

- replace remaining literal path assumptions in core and relevant clients
- cover project config, global config, auth, skills, image storage, and global plugin lookup
- explicitly preserve current tool-settings semantics unless changed by a separate product decision

Likely files:

- `packages/core/src/config/writer.ts`
- `packages/core/src/auth/auth-store.ts`
- `packages/core/src/skills/discovery.ts`
- `packages/core/src/tools/plugin-loader.ts`
- `packages/core/src/app-server/server.ts`
- `packages/web/src/shared/image-routes.ts`

Verification:

- targeted tests for each path family
- regression tests preserving legacy diligent behavior by default

### Task 19. Decide and implement legacy compatibility mode

Deliverables:

- choose whether branded storage paths support fallback reads from diligent paths
- document precedence rules if both branded and legacy paths exist

Likely files:

- storage policy module
- config loader and asset lookup helpers
- docs for migration behavior

Verification:

- tests for fallback resolution order and conflict behavior

### Task 20. Add migration UX if branded paths are adopted

Deliverables:

- first-run or explicit migration path for moving user data from diligent namespaces to branded namespaces
- avoid silent destructive moves

Likely files:

- CLI or app bootstrap flow
- docs and migration helpers

Verification:

- migration tests on representative config/auth/skills fixtures

## Milestone 5: Cross-cutting polish and documentation

Goal: make branded distributions maintainable and debuggable as a long-term product surface.

### Task 21. Update documentation for branded distributions

Deliverables:

- add user-facing and maintainer-facing docs describing branded release concepts
- explain internal-name-versus-product-name distinction clearly
- document plugin trust model for official bundled plugins

Likely files:

- `README.md`
- `docs/tool-settings.md`
- `docs/plan/feature/P041-branded-distribution-packaging.md`
- any release docs

Verification:

- docs review for consistency of terminology

### Task 22. Add release validation checks

Deliverables:

- add automated validation that a distribution spec produces a coherent artifact
- check required brand fields, asset presence, plugin bundle existence, and generated output names

Likely files:

- packaging tests or CI scripts
- release validation utilities

Verification:

- CI smoke test for example branded build

### Task 23. Audit user-visible `diligent` strings after MVP

Deliverables:

- perform a repository-wide audit for remaining user-visible `diligent` text that should be product-identity-driven
- explicitly classify remaining internal-only references as acceptable

Likely files:

- CLI, Web, Desktop, docs, packaging scripts

Verification:

- tracked checklist or grep-based audit in the final milestone

## Suggested Delivery Order

For a practical first release, the recommended order is:

1. Task 1 through Task 5
2. Task 6 through Task 8
3. Task 11 through Task 16
4. optional Task 9 and Task 10 if bundled skills/provenance are needed in MVP
5. Task 17 through Task 20 only after branded-release MVP is working
6. Task 21 through Task 23 as release hardening

## Suggested MVP Cut Line

A credible first branded-release MVP can stop after the following tasks:

- Task 1 through Task 8
- Task 11 through Task 16
- Task 21 and Task 22

That delivers:

- branded visible product identity
- bundled defaults
- bundled plugins
- example `OVERCODE` spec
- packaging assembly path
- release validation

It intentionally does **not** require branded storage namespaces yet.

## Validation Strategy

When implementation begins, validation should include:

1. unit tests for product context and path-policy resolution
2. config-loader tests proving merge precedence between distribution defaults, global config, and project config
3. plugin-loader tests for bundled plugin roots and fallback ordering
4. CLI tests for visible product identity strings
5. Web bootstrap tests for brand metadata delivery
6. Desktop packaging smoke tests for title and bundle identifier substitution
7. release-script tests or smoke builds from an example branded spec

## Example End State

After this work, the repo should be able to produce a release where:

- internal engine packages remain `@diligent/*`
- the executable is named `overcode`
- the desktop app title says `OVERCODE`
- the Web UI shows `OVERCODE`
- bundled config enables curated tools by default
- bundled plugin packages ship inside the release artifact
- user overrides still apply through normal config layers

## Final Recommendation

Implement branded distribution packaging as a formal productization layer, not as a one-off rename.

The recommended execution order is:

1. product identity abstraction
2. distribution defaults and bundled plugin roots
3. packaging command and release pipeline
4. storage policy abstraction (after MVP)

This preserves Diligent as the internal core while making branded official releases such as `OVERCODE` practical, repeatable, and maintainable.
