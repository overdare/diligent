---
name: asset-pack-import
description: Import and place themed asset packs (pack_* collections) from the Asset Store. Use when a request needs many related assets at once — building a themed scene ("build a subway station", "add a forest", "fill this area with props"), or when overdaresearch detects a suitable pack for autonomous selection.
---

# Asset Pack Import

Workflow for turning a themed request into imported, placed Asset Store content.

## 1. Discover and choose a palette

Search with `overdaresearch(source="assets")`. By default, it returns asset
candidates with descriptions and image URLs, plus detected packs. Choose suitable
assets yourself. A themed pack may fit a scene better than the individual search
matches. Read its entire palette with
`overdaresearch_deep(action="asset-pack", packKeyword="pack_...")`.

Use descriptions to compare members. If appearance matters, inspect one to four
candidate `imageUrl` values with
`overdaresearch_deep(action="asset-preview", urls=[...])`. This returns actual
images; an image URL or a gallery alone does not mean you have seen the image.
If a preview fails, use the descriptions or try another candidate.

Set `requestUserInput=true` on asset search only when you want to offer the user
a choice. A user-selected pack returns the same palette. None, cancellation, or
free-text feedback does not select an importable asset; use that feedback to
choose the next approach. If no candidates fit, refine the search or build from
other content without requiring a picker.

**The member list is your palette — do not re-search per item.**

## 2. Select a subset; a pack is a palette, not a prefab

A pack is a themed collection (walls, floors, props, vehicles…), not a pre-assembled
scene. Composition is your job:

- Pick only the members the request actually needs. "Build a subway platform" might
  need 15 of 145 metro assets; never blind-import the whole pack just because it exists.
- Balance categories: structure first (floors, walls, pillars), then fixtures
  (machines, signs), then scatter props (cans, posters).
- Match the subset to the requested scale. Choose a modest, relevant subset when
  the request leaves room for interpretation; offer the user a choice when it
  helps clarify their intended result.

## 3. Branch on subset size

- **Fewer than 5 assets** — import each with `studiorpc_asset_drawer_import`.
- **5 or more assets** — import all with `studiorpc_asset_drawer_import_bulk`
  (one approval, returns an assetid→guids map).

Then place the selected roots.

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

Use the returned GUIDs as exact placement targets. `studiorpc_instance_move` only reparents; it does not translate objects. Place
structure before fixtures and scatter props. Read back the target subtree after a
batch so the next placement uses current positions rather than stale assumptions.

## 6. Verify

After placement, read back the affected subtree (`studiorpc_instance_read` /
`studiorpc_level_browse`) and take a screenshot when visual arrangement matters.
Report any `failed` imports to the user instead of silently dropping them.
