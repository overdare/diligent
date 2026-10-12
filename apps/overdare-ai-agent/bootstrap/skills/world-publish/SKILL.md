---
name: world-publish
description: "Use when the user wants to make the current OVERDARE Studio world public, live, released, deployed, or published, even if they call it a project, game, map, experience, content, or build; examples include 'publish this world' or 'deploy this game'."
---

# World Publish Skill

This document defines the workflow for publishing the current OVERDARE Studio world. The official term is **world**, but users may call it a project, game, map, experience, content, or build.

The key decision is **whether this world has already been published**, tracked via the `overdare.publish_state` Knowledge card.

## Required Tools

This skill expects the agent runtime to provide these tools. All of them are first-party tools shipped with this agent — no external HTTP tool is needed.

- `studiorpc_level_save_file`
  - Saves the current project to disk before publishing so the publish reflects the latest edits.
- `studiorpc_level_publish`
  - Sends a publish request to OVERDARE Studio.
  - If the world was not published before, call it with the metadata fields as top-level arguments.
  - If the world was already published, call it without metadata fields.
  - Studio opens the Creator Hub publish page in the browser after this call.
  - Error code `-32009` means the user canceled the publish in the Studio UI. Treat it as a final outcome and do not retry automatically — just tell the user it was canceled.
- `update_knowledge`
  - Records the publish state after a successful publish (see Step 7). Use the stable id `overdare.publish_state` so updates replace the same entry.
- `hub_world_categories_list`
  - Returns `{ categories: string[] }` with the valid category labels accepted by the backend at the moment of the call. Use the returned values exactly as-is (preserve case).

If `studiorpc_level_publish` is unavailable, stop and tell the user that publishing is not possible in this runtime. Do not pretend the publish succeeded.

If `hub_world_categories_list` is unavailable or fails for an authentication or network reason, follow the fallbacks defined per step below.

## High-Level Workflow

1. Confirm the user wants to publish or make the current world live.
2. Save the current project by calling `studiorpc_level_save_file`. If this tool is not available in the current toolset, skip saving and warn the user that the publish may use a stale state.
3. Check the Knowledge cards already injected into this session's context for the `overdare.publish_state` card (identified by the `OVERDARE_PUBLISH_STATE` content marker; see Step 1).
4. If the card is missing or does not say `published: true`, treat the world as **not yet published**: prepare metadata and call `studiorpc_level_publish` with metadata fields.
5. If the card says `published: true`, treat the world as **already published**: call `studiorpc_level_publish` without metadata fields.
6. If the publish call returns `{ success: true }`, record `published: true` to Knowledge via `update_knowledge` (stable id `overdare.publish_state`).
7. Report the result and tell the user to review/confirm on the Creator Hub page in the browser if needed.

## Step 1: Determine Whether the World Was Already Published

The important question is:

```text
Has this world already been published successfully from this project?
```

Check the Knowledge cards already injected into this session's context (no lookup tool call is needed). Injected cards show only their type and content, not their id, so identify the `overdare.publish_state` card by the marker at the start of its content:

```text
OVERDARE_PUBLISH_STATE
```

Interpret it:

- Card missing, or its content does not contain `published: true` → treat the world as **not yet published**. Prepare metadata and call `studiorpc_level_publish` with metadata fields.
- Card present with `published: true` → treat the world as **already published**. Call `studiorpc_level_publish` without metadata fields.

## Step 2: Publish When the World Was Already Published

The world counts as already published when the `overdare.publish_state` Knowledge card is present with `published: true`.

In this case, call:

```text
studiorpc_level_publish
```

without metadata fields.

Do not generate or overwrite metadata unless the user explicitly requested a metadata update.

After calling `studiorpc_level_publish`, Studio should open the Creator Hub publish page in the browser.

## Step 3: Publish When the World Was Not Published Before

The world counts as not yet published when the `overdare.publish_state` Knowledge card is missing or does not contain `published: true`.

In this case, prepare metadata and call `studiorpc_level_publish` with the metadata fields as top-level arguments.

Payload shape:

```json
{
	"worldName": "World Name",
	"description": "Made with OVERDARE Studio.",
	"category": ["<category from hub_world_categories_list>"],
	"keyword": ["OVERDARE"]
}
```

The `description` field above is shown in **raw** form. Encoding is applied as a separate step right before the tool call — see §5 for the encoding rules.

Use exactly these top-level field names:

- `worldName`
- `description`
- `category`
- `keyword`

Do not use `name`, `categories`, or `keywords` in the `studiorpc_level_publish` arguments.

## Step 4: Prepare Metadata for a First Publish

Metadata is only needed when the world was not published before.

Metadata fields:

```ts
{
	worldName: string,
	description: string,
	category: string[],
	keyword?: string[]
}
```

### 4.1 Metadata Sources

Infer metadata by considering all available context together:

1. Previous conversation with the user.
2. The world instance tree and asset list, including scripts.
3. The template name used by the project, if available.

These are not priority-ordered fallback steps. Use all available information from items 1 to 3 together to infer the best `worldName`, `description`, `category`, and `keyword` values.

Only use fallback defaults when items 1 to 3 provide little or no useful context.

Fallback defaults (shown in raw form — apply encoding from §5 only at send time):

```ts
worldName = <current project folder name>   // truncate to 50 chars if longer (see §5 worldName rules)
description = "Made with OVERDARE Studio."
category = [<first category from hub_world_categories_list>]
keyword = ["OVERDARE"]
```

If `hub_world_categories_list` cannot be called or returns an empty list, see §4.3.

### 4.2 Inspect World Contents

Use available Studio/tree/script tools to inspect the current world enough to create useful metadata.

Look for:

- Major models or folders that suggest the genre or theme.
- UI names such as shop, inventory, skill bar, health, timer, scoreboard, lobby, result screen.
- Scripts that suggest gameplay such as racing, obby, PvP, tycoon, simulator, RPG, combat, puzzle, social, survival, or sports.
- Imported assets and template names.

Do not spend excessive time reading every script. Use a quick overview unless the world is ambiguous.

### 4.3 Get Valid Categories

Before choosing `category` for a first publish, call:

```text
hub_world_categories_list({})
```

The tool returns `{ categories: string[] }`. Choose 1 to 3 values **exactly as returned by the tool** (preserve case and spelling). Do not assume specific category labels in advance — the valid set is defined by the backend and may change.

If the tool throws or returns an empty list, ask the user once which category fits best, or as a last resort call `studiorpc_level_publish` with `category` omitted and let the user set it later on the Creator Hub page. Never invent a category label that did not come from the backend.

### 4.4 Category Selection Guidance

Match the inferred world type against the labels returned by `hub_world_categories_list` using semantic similarity. For example, if the backend returned `Action`, `Adventure`, `RPG`, `Simulation`, `Social` and the world looks like a PvP shooter, pick `Action`. Use the returned spelling exactly.

General mapping intuition (use only when a corresponding label is actually present in the tool response):

- Combat, battle, arena, shooter, boss fight → an action-themed category.
- Exploration, platforming, obby, adventure map → an adventure-themed category.
- Role-playing, quests, classes, skills, progression → an RPG-themed category.
- Tycoon, management, farming, driving, sports-like systems → a simulation-themed category.
- Hangout, chat, avatar showcase, party, lobby-focused world → a social-themed category.

Always keep the selected category count between 1 and 3.

### 4.5 Keyword Selection Guidance

Generate 0 to 5 keywords.

Good keywords are short searchable tags such as:

- `OVERDARE`
- `action`
- `adventure`
- `obby`
- `rpg`
- `simulator`
- `social`
- `pvp`
- `parkour`
- `racing`
- `combat`

Rules:

- Each keyword must be a separate array item, not a comma-separated string.
- Maximum 5 keywords.
- Each keyword must be 1 to 50 characters.
- Trim leading and trailing spaces.
- Middle spaces are allowed, for example `open world`.
- Avoid duplicates.
- Avoid swear words or unsafe terms.

When there are no useful keywords to send, omit the `keyword` field entirely rather than sending an empty array. The field is optional and the backend treats omission and an empty array the same way, but omitting keeps payloads minimal and predictable.

## Step 5: Validate Metadata Before Calling `studiorpc_level_publish`

Only validate metadata when metadata fields will be sent.

All length and character rules below apply to the **raw, unencoded** value. Encoding (§5 `description` section) is applied as the last step before the tool call and must not change which value passes validation.

### `worldName`

- Required.
- Type: `string`.
- Minimum: 1 character.
- Maximum: 50 characters (raw).
- Must not have leading or trailing spaces.
- Middle spaces are allowed.
- Special characters are allowed.
- Avoid swear words or unsafe terms.

If the inferred `worldName` is too long, shorten it to fit within 50 characters while preserving the main meaning. When the fallback (current project folder name) exceeds 50 characters, simply truncate the trailing characters — a clean cut at the 50-character boundary is acceptable.

If no `worldName` can be inferred, use the (possibly truncated) project folder name.

### `description`

- Required.
- Type: `string`.
- Minimum: 1 character (raw).
- Maximum: 500 characters **measured on the raw, unencoded value** — do not measure the encoded form, since percent-escapes inflate length.
- Line breaks are allowed in the raw description.
- Special characters are allowed.
- Leading/trailing whitespace is allowed by server rules, but avoid unnecessary leading/trailing blank lines for quality.
- Avoid swear words or unsafe terms.

The agent sends metadata to Studio as JSON through `studiorpc_level_publish`, but Studio passes these values directly into the Creator Hub URL query parameter without URL-encoding them.

Therefore, the agent must URL-encode query-sensitive characters in `description` immediately before calling `studiorpc_level_publish`. Encoding happens **after** the §5 raw-length validation passes.

Recommended encoding behavior:

- Build the natural raw description text first.
- Trim only unnecessary accidental outer blank lines for quality, but keep intentional line breaks.
- Validate raw length (1–500) and other raw rules.
- Right before calling `studiorpc_level_publish`, encode the description for URL query usage.
- Newlines must become `%0A`.
- Spaces may become `%20` if using full URL component encoding.
- Do not encode twice. If the value already contains `%0A` from a previous encoding step, do not convert `%` into `%25` again.

Example raw description:

```text
Welcome to Skyline Battle Royale!

A fast-paced PvP world with parkour, vehicles, and weekly events.
```

Example after full URL-component encoding (what actually gets sent to `studiorpc_level_publish`):

```text
Welcome%20to%20Skyline%20Battle%20Royale!%0A%0AA%20fast-paced%20PvP%20world%20with%20parkour%2C%20vehicles%2C%20and%20weekly%20events.
```

If doing only the required newline conversion, this is also acceptable when the rest of the text is URL-safe enough for the runtime:

```text
Welcome to Skyline Battle Royale!%0A%0AA fast-paced PvP world with parkour, vehicles, and weekly events.
```

However, full URL component encoding is safer because the value is used as a web URL query parameter.

### `category`

- Required.
- Type: `string[]`.
- Minimum: 1 item.
- Maximum: 3 items.
- Each item must be a label returned by `hub_world_categories_list`. Preserve the exact spelling and case from the tool response.
- If `hub_world_categories_list` failed, see §4.3 — either ask the user or omit `category` so the user can set it on the Creator Hub page. Never invent a category label.

### `keyword`

- Optional.
- Type: `string[]`.
- Minimum: 0 items (in which case omit the field entirely; see §4.5).
- Maximum: 5 items.
- Each keyword must be 1 to 50 characters (raw).
- Each keyword must not have leading or trailing spaces.
- Middle spaces are allowed.
- Avoid duplicates.
- Avoid swear words or unsafe terms.

## Step 6: Ask the User Only When Necessary

Prefer to infer metadata automatically when there is enough context.

Ask the user for confirmation or choices when:

- The world type is unclear and category selection would be a guess.
- The generated title could be misleading.
- The list returned by `hub_world_categories_list` has no obvious match for the inferred world type.
- `hub_world_categories_list` failed and the user must pick a category manually (see §4.3).
- The user explicitly asks to choose or edit metadata.

When asking, use a clear UI input tool if available.

Ask at most 1 to 3 questions, for example:

1. Which category best fits this world?
2. What title should players see?
3. Do you want to use this generated description?

## Step 7: Call `studiorpc_level_publish` and Record the Result

### World Already Published

Call:

```text
studiorpc_level_publish
```

without metadata fields.

### World Not Published Before

Call:

```text
studiorpc_level_publish
```

with metadata fields:

```json
{
	"worldName": "World Name",
	"description": "Made%20with%20OVERDARE%20Studio.",
	"category": ["<exact label from hub_world_categories_list>"],
	"keyword": ["OVERDARE"]
}
```

The `description` in the payload sent to the tool must already be URL-encoded per §5.

After calling `studiorpc_level_publish`, Studio should open the Creator Hub publish page in the browser.

### Record the Publish State

Only when `studiorpc_level_publish` returns `{ success: true }`, record the state so future sessions know this world was published:

```text
update_knowledge({
	id: "overdare.publish_state",
	type: "discovery",
	content: "OVERDARE_PUBLISH_STATE\npublished: true"
})
```

Do not record anything when the call fails or returns error `-32009` (user canceled) — a canceled or failed publish means the world may still not exist on the backend, so the next attempt must send metadata fields again.

### Handling `studiorpc_level_publish` Errors

- Error code `-32009`: the user canceled the publish in the Studio UI. Treat this as a final outcome. Do not retry automatically. Tell the user the publish was canceled and ask whether they want to try again.
- Any other error: tell the user clearly, include the error message if available, and stop. Do not pretend the publish succeeded.
- The browser page does not open: tell the user and ask them to check Studio.

## Step 8: Final User Message

After a successful `studiorpc_level_publish` call, tell the user:

- Whether this was a first publish or an update, based on `publishResult.mode` in the tool result (`CREATE` = new world, `UPDATE` = new version of an existing world).
- That the Creator Hub publish page should now be open in the browser.
- Whether they need to review and confirm anything on that page.
- The metadata used, if metadata fields were sent (show the raw, human-readable form — do not show the URL-encoded `description`).

Keep the message short.

## Error Handling Summary

Stop and explain the issue when:

- `studiorpc_level_publish` is unavailable.
- `studiorpc_level_publish` returns error `-32009` (user canceled) — final outcome, do not retry automatically.
- `studiorpc_level_publish` returns any other error.

Treat the world as **not yet published** and call `studiorpc_level_publish` with metadata fields when:

- The `overdare.publish_state` Knowledge card is missing from this session's context.
- The card exists but does not contain `published: true`.

Treat the world as **already published** and call `studiorpc_level_publish` without metadata fields when:

- The `overdare.publish_state` Knowledge card is present with `published: true`.

Record `published: true` to Knowledge (stable id `overdare.publish_state`) only after `studiorpc_level_publish` returns `{ success: true }` — never on cancel or error.

## Key Rules

- `description` supports line breaks, but Studio passes values directly into the Creator Hub URL query without encoding. Validate description length on the **raw** value (max 500), then encode immediately before calling `studiorpc_level_publish`; at minimum, line breaks must become `%0A`.
- `category` and `keyword` are arrays, not comma-separated strings.
- Use `worldName`, `description`, `category`, and `keyword` as top-level arguments for metadata.
- Do not use `name`, `categories`, or `keywords` in the `studiorpc_level_publish` arguments.
- Treat `studiorpc_level_publish` error `-32009` as a final user-cancel signal; do not retry automatically.
