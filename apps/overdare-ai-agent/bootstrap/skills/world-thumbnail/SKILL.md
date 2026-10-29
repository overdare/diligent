---
name: world-thumbnail
description: Create or revise an upload-ready OVERDARE world/game thumbnail from the current Studio game's code, assets, and scene using Nutty character references. Delivers a 1080x1080 PNG under 10 MB in the project with an inline image preview; does not publish or upload the world.
---

# World Thumbnail

Create a thumbnail that communicates this game's actual play at a glance, including when displayed around 250x250 pixels on mobile. Deliver one 1080x1080 PNG below 10,000,000 bytes unless the user explicitly requests multiple candidates. Users upload the file themselves.

## Understand the game and clarify the brief

Use existing conversation context together with the current Studio state. Browse the level with `studiorpc_level_browse`; selectively read relevant objects with `studiorpc_instance_read` and gameplay scripts with `studiorpc_script_read`. Inspect available asset information and scene/gameplay captures when they clarify the visual identity. Bound exploration to the main gameplay loop, recognizable environment, player characters, and distinctive actions or props. Names alone do not prove a feature is implemented.

Summarize the game in a sentence and choose a visible action that represents it: what the player does, what makes that action recognizable, and one distinguishing setting or prop. Do not invent mechanics or promise rewards that the implemented game does not support. If live Studio inspection is unavailable, use available project files and explain the limitation; ask for missing game information instead of guessing from the style references.

Before generation, ask only for consequential information not already provided. Resolve the title in one question with three answer paths: no title, a concrete recommended title, or custom text entered in the same response. Write the recommendation from the inspected game and conversation in the user's language, and show its exact wording in the question or option description so selecting it approves that text. Do not infer the public title solely from the project folder name.

With `request_user_input`, list two options: `No title` and `Use recommended title`, with the exact proposed title in the latter's description. The clients already provide a custom free-form input row as the third path; tell the user in the question to enter their own exact title there. Do not add a selectable `Include title` or `Enter title` option that requires a second question. In ordinary chat, present the same three paths and ask for either a choice or the custom title directly in the reply. Use the user's language for the question and labels.

Proceed without another title confirmation: no title means no added text; selecting the recommendation uses the displayed wording; custom input supplies the exact title, spelling, and language. If the user already specified no title or an exact title, honor it without asking. If they requested a title but have not supplied its wording, offer the concrete recommendation and custom input together in one question, without asking again whether to include a title.

Bundle any unresolved focal action, mood, or requested emphasis that materially changes the image with this question, up to three concise questions total.

Honor answers and additional user prompts on later revisions without asking again. If a requested element conflicts with the implemented game, clarify the intended depiction.

## Use the supplied Nutty references

Resolve these files relative to this skill's installed directory, inspect them, and attach their actual local paths through `generate_image.referenceImages`:

- `assets/nutty-character.png`: character identity and silhouette reference. Preserve the stylized segmented construction, black face/limbs, expressive orange eyes, broad toothy grin, and oversized hands/shoes where applicable to the depicted Nutty character.
- `assets/nutty-render-style.png`: stylized 3D promotional rendering, material treatment, dramatic lighting, and character presentation reference.

These establish visual language, not the game's content. The second reference's Christmas costume, wings, snow, mountains, and moon are not evidence about the current world. Use the actual game's costumes, props, setting, and palette; do not copy reference lettering or add branding by default. Avoid replacing Nutty with a generic human, realistic person, or unrelated avatar style.

Add relevant current-game captures or user references and explain each reference's role in the prompt. Verify agent-host paths before passing them; a remote Studio path is not automatically readable locally. Resolve or report missing required references.

## Generate a mobile-readable composition

Both `generate_image` and `prepare_world_thumbnail` must be available. If either is missing, explain the unavailable capability rather than claiming an upload-ready result.

Call `generate_image` for one image using the game brief, user preferences, and attached references, with `background: "opaque"` and no grid. Follow the tool's model guidance and honor an explicit user model choice. Include:

- A square composition requested at 1080x1080, with one dominant action, large readable silhouettes, strong foreground/background contrast, and a restrained background.
- A focal character/prop arrangement that makes the genre and action apparent without tiny details, UI panels, or small explanatory text.
- Safe margins around faces, hands, important props, and any title so a centered square crop will retain them.
- If a title is included: exact quoted wording, large high-contrast lettering, short line breaks, and separation from the main action. If excluded: explicitly no title, captions, or added text.

For a single thumbnail, omit the `grid` argument entirely, including during repairs. Do not use `null` as a placeholder: a null grid item requests a blank cell, not the scene described in `prompt`. For example, replace the prompt and paths below with the actual brief and verified references:

```text
generate_image({
  prompt: "Create one square, text-free thumbnail showing the game's main action.",
  background: "opaque",
  referenceImages: ["<verified character reference path>", "<verified style reference path>"]
})
```


## Finalize and inspect

Requested dimensions are not guaranteed. Always pass the generated `file` to:

```text
prepare_world_thumbnail({ sourceImage: "<actual generated file path>" })
```

Inspect the returned final image, especially if `source` and `crop` show that content was removed. Check:

- The main action and distinctive environment match the inspected game.
- Nutty identity and stylized rendering remain recognizable.
- Faces, limbs, important props, and title are intact; included title text is correct.
- The subject, action, and any lettering remain understandable at roughly 250x250 display size. Assess the same image at reduced display scale when possible; do not save a separate preview file. Do not claim a visual check you could not perform.

Use targeted reference-guided repairs for material visual defects within `generate_image`'s retry rules. For dimension, encoding, or other local finalization failures, fix the local cause and reuse the generated source. Report an unfinished deliverable if the required result cannot be produced within these bounds.

## Deliver the thumbnail

The final file is saved under the current project's `thumbnails/` directory. Embed the final image with Markdown image syntax using the returned absolute `file` path, with an angle-bracket destination for spaces. The inline preview supports opening the enlarged image; omit separate image and folder links unless the user asks for them.

Keep the message brief and state the verified dimensions, PNG format, and byte size. Do not import into Studio, change publish metadata, publish the world, or upload the image as part of this skill.
