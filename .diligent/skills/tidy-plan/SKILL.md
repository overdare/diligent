---
name: tidy-plan
description: Format and categorize plan files from docs/plan/uncategorized/. Use this skill whenever the user says "/tidy-plan", asks to organize or tidy plans, mentions uncategorized plans, or when you notice files exist in docs/plan/uncategorized/ that need processing. Also trigger when the user says "정리해줘" in the context of plan files.
---

# Tidy Plan

Processes raw plan files from `docs/plan/uncategorized/` — adds frontmatter, assigns a plan ID, and moves each file to the correct category folder.

Plan mode often produces files without the project's frontmatter convention or folder structure. This skill bridges that gap so every plan ends up properly indexed and findable.

## When to Run

- After exiting plan mode, if the plan was saved to `docs/plan/uncategorized/`
- When the user asks to organize or tidy plans
- When you notice unprocessed files in `docs/plan/uncategorized/`

## Workflow

### Step 1: Scan for unprocessed files

List all `.md` files in `docs/plan/uncategorized/`. If the directory is empty or doesn't exist, tell the user there's nothing to tidy.

### Step 2: Find the next plan ID

Grep all existing plan files for their `id:` frontmatter field to determine the highest current number:

```bash
grep -rh '^id: P' docs/plan/ | sort -t'P' -k2 -n | tail -1
```

The next plan gets the next sequential number (e.g., if P015 exists, the next is P016).

### Step 3: For each file, determine the category

Read the file content and classify into one of these categories:

| Category | Folder | Signal |
|----------|--------|--------|
| `feature` | `docs/plan/feature/` | Adds new user-facing capability, new tool, new provider, new UI element |
| `refactor` | `docs/plan/refactor/` | Restructures existing code, extracts shared logic, changes internal architecture |
| `fix` | `docs/plan/fix/` | Addresses a bug or correctness issue that requires investigation and planning |
| `layer` | `docs/plan/layer/` | Spans multiple layers or builds an entire new system layer from scratch |

If the category isn't clear from the content, ask the user. Don't guess.

### Step 4: Format and move

For each file:

1. **Strip any existing frontmatter** (plan mode may add its own)

2. **Add project frontmatter:**
   ```yaml
   ---
   id: PNNN
   status: backlog
   created: YYYY-MM-DD
   ---
   ```
   Use today's date for `created`.

3. **Generate a kebab-case name** from the plan title (first `#` heading). Remove generic prefixes like "Plan:", "Feature:", "Implementation Plan for".

4. **Rename and move:**
   ```
   docs/plan/uncategorized/random-name.md
   → docs/plan/feature/P016-descriptive-name.md
   ```

5. **Report** what was done:
   ```
   P016 feature/P016-mcp-client.md (backlog)
   P017 refactor/P017-event-bus.md (backlog)
   ```

### Step 5: Clean up

If `docs/plan/uncategorized/` is now empty, leave it in place (plan mode will use it again).

## Reference

Read `.claude/skills/write-plan/references/plan-template.md` for the canonical frontmatter fields, status values, and file naming convention. This is the single source of truth — if conventions change, they change there first.

## Edge Cases

- **File already has correct frontmatter**: If it already has `id:`, `status:`, and `created:`, just move it to the right folder without modifying the frontmatter.
- **Multiple files**: Process them in alphabetical order, assigning sequential IDs.
- **Korean content**: The plan content may be in Korean. Classify based on the actual content regardless of language. File names should always be English kebab-case.
