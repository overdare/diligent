---
name: asset-pack-import
description: Import and place themed asset packs (pack_* collections) from the Asset Store. Use when a request needs many related assets at once — building a themed scene ("build a subway station", "add a forest", "fill this area with props"), or when an overdaresearch asset picker returns a pack member list instead of a single assetId.
---

# Asset Pack Import

Workflow for turning a themed request into imported, placed Asset Store content.

## 1. Search normally; the picker surfaces packs

Search with `overdaresearch(source=assets)` as usual. When the results belong to a
themed pack (shared `pack_*` keyword), the picker automatically offers an
"Import full pack" option alongside the single assets. If the user picks it, the tool
returns the full member list JSON (`{ pack, memberCount, members }`) instead of a
single assetId. **That member list is your palette — do not re-search per item.**

## 2. Select a subset; a pack is a palette, not a prefab

A pack is a themed collection (walls, floors, props, vehicles…), not a pre-assembled
scene. Composition is your job:

- Pick only the members the request actually needs. "Build a subway platform" might
  need 15 of 145 metro assets; never blind-import the whole pack just because it exists.
- Balance categories: structure first (floors, walls, pillars), then fixtures
  (machines, signs), then scatter props (cans, posters).
- If the request is ambiguous about scale ("add some metro stuff" vs "build a
  station"), ask before importing dozens of assets.

## 3. Branch on subset size

- **Fewer than 5 assets** — import each with `studiorpc_asset_drawer_import`, then
  position with `studiorpc_instance_upsert`.
- **5 or more assets** — import all with `studiorpc_asset_drawer_import_bulk`
  (one approval, returns an assetid→guids map), then place the selected roots with
  `studiorpc_instance_upsert`.

## 4. GUID discipline (mandatory)

Imported scene names differ from store titles (store "Can 01" spawns as
`Metro_Can01`), so **never locate imported models by name**. The bulk import output
maps every assetid to its scene GUIDs — use those GUIDs in each placement call:

```json
["653B201E4C45D9CAAC1040A0D816D859", "..."]
```

Check the bulk output's `failed` list before placement; only place the GUIDs that
actually imported.

## 5. Placement pattern

Use the bundled upsert parameters for known transform JSON shapes; supplement with `studiorpc_instance_schema_search` when needed. Use the returned GUIDs as exact update targets for `studiorpc_instance_upsert`, or edit through Editor Luau. Use `studiorpc_instance_move` only for reparenting; it does not translate objects. Place
structure before fixtures and scatter props. Read back the target subtree after a
batch so the next placement uses current positions rather than stale assumptions.

## 6. Verify

After placement, read back the affected subtree (`studiorpc_instance_read` /
`studiorpc_level_browse`) and take a screenshot when visual arrangement matters.
Report any `failed` imports to the user instead of silently dropping them.
