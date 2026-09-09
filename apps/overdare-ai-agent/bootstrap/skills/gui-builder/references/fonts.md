# Studio Fonts

Choose a supported face for native GUI text. Source: the supplied internal Studio font catalog, version 1, checked 2026-09-09. This is a manually maintained snapshot, not a live catalog query; preserve its exact family keys, asset IDs, weights, and styles. Reuse this reference once loaded in the current task.

## Selection rules

- Preserve verified existing FontFace choices unless the request changes them. For new text with no typography direction, use `NotoSans Regular Normal` for body text and `NotoSans SemiBold Normal` for headings or buttons.
- Use no more than two families on one screen unless the user requests a deliberately mixed style.
- Keep body text in NotoSans, Roboto, Nunito, or VarelaRound. Decorative families belong on short headings, counters, logos, or callouts.
- For Korean, non-Latin, or mixed-language text, prefer NotoSans until actual glyph coverage is available or the result can be checked visually. The catalog lists files and faces, but does not prove script coverage.
- Select a Weight and Style explicitly listed for the family. Studio can substitute a nearby face, but authored UI should not depend on that substitution. If a requested face is not listed, verify it against an updated catalog or Studio rather than inventing an ID or weight.
- Assign the complete `FontFace` value. Do not mutate `label.FontFace.Weight` or another nested member in isolation.
- `FontFace` is the supported text font property. The Roblox legacy form `Font = Enum.Font.*` is not available here.

## Family catalog

`Family asset ID` is the number passed to `Font.fromId`. JSON uses the corresponding `ovdrassetid://<Family asset ID>` string.

| Family | Family asset ID | Weights | Styles | Intended use |
|---|---:|---|---|---|
| Anton | 900000166 | Regular | Normal | Condensed, forceful headings and large numbers |
| ArchivoBlack | 900000366 | Regular | Normal | Heavy headings, banners, and strong calls to action |
| Baloo2 | 900000566 | Regular, Medium, SemiBold, Bold, ExtraBold | Normal | Rounded, playful game UI and friendly headings |
| Creepster | 900001166 | Regular | Normal | Spooky or Halloween display text only |
| Eater | 900001366 | Regular | Normal | Distorted horror display text only |
| Fredoka | 900001566 | Light, Regular, Medium, SemiBold, Bold | Normal | Friendly rounded headings, buttons, and casual game UI |
| GreatVibes | 900002166 | Regular | Normal | Elegant script for short logos, invitations, and decorative titles |
| GrenzeGotisch | 900002366 | Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal | Gothic or fantasy display headings |
| Kalam | 900003366 | Light, Regular, Bold | Normal | Casual handwritten dialogue, notes, and labels |
| Michroma | 900003766 | Regular | Normal | Wide futuristic and technical display headings |
| Nosifer | 900003966 | Regular | Normal | Dripping horror display text only |
| NotoSans | 900004166 | Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal, Italic | Default neutral UI, body text, buttons, and mixed-language fallback choice |
| Nunito | 900006066 | ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal, Italic | Friendly rounded body text and approachable UI |
| Orbitron | 900007766 | Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal | Science-fiction HUDs, headings, counters, and numbers |
| OverWacky | 900008466 | Black | Normal, Italic | Highly decorative comic or chaotic callouts |
| PatrickHand | 900008766 | Regular | Normal | Casual hand-drawn dialogue and notes |
| PermanentMarker | 900008966 | Regular | Normal | Marker-style titles, graffiti, and emphatic callouts |
| PlayfairDisplay | 900009166 | Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal, Italic | Elegant serif titles, premium panels, and editorial headings |
| PressStart2P | 900010466 | Regular | Normal | Pixel arcade headings, counters, and retro labels |
| Roboto | 900010666 | Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal, Italic | Neutral compact UI, body text, settings, and data-heavy screens |
| Sono | 900012566 | ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold | Normal | Technical, terminal-like labels and data presentation |
| Tomorrow | 900013366 | Thin, ExtraLight, Light, Regular, Medium, SemiBold, Bold, ExtraBold, Black | Normal, Italic | Geometric science-fiction UI, headings, and futuristic labels |
| VarelaRound | 900015466 | Regular | Normal | Soft rounded labels, buttons, and light body text |
| VT323 | 900015266 | Regular | Normal | Terminal pixel text, retro counters, and console-style labels |

## Mood routing

| Requested direction | Preferred families |
|---|---|
| Neutral, modern, readable | NotoSans, Roboto |
| Soft, friendly, rounded | Fredoka, Nunito, VarelaRound, Baloo2 |
| Strong, competitive, condensed | Anton, ArchivoBlack |
| Premium, elegant, editorial | PlayfairDisplay; GreatVibes for a very short accent |
| Handwritten, casual | Kalam, PatrickHand, PermanentMarker |
| Science fiction, cyber, technical | Orbitron, Tomorrow, Michroma, Sono |
| Retro, pixel, arcade | PressStart2P, VT323 |
| Horror | Creepster, Eater, Nosifer |
| Gothic fantasy | GrenzeGotisch |
| Comic or deliberately chaotic | OverWacky |

## Editor Luau assignment (when available)

Prefer the instance-upsert form below for ordinary static GUI edits. If the host exposes an Editor Luau execution tool, these assignment forms are also supported. Replace the sample hierarchy with the verified target.

Use a family asset ID when the catalog provides one. The Editor VM uses `game.StarterGui` or another direct hierarchy path; it does not support `game:GetService`. This restriction applies to the Editor VM, not normal runtime LocalScripts.

```lua
local label = game.StarterGui.MainGui.TitleLabel

label.FontFace = Font.fromId(
	900004166,
	Enum.FontWeight.SemiBold,
	Enum.FontStyle.Normal
)

return tostring(label.FontFace)
```

The readable name form is also supported. Family names are case-sensitive catalog keys.

```lua
label.FontFace = Font.fromName(
	"Fredoka",
	Enum.FontWeight.Bold,
	Enum.FontStyle.Normal
)
```

## Instance upsert assignment

For a focused TextLabel or TextButton edit, pass the public shape below. The sidecar adds the internal `ObjectType: "Font"` tag. Supply all three public members so the authored choice is visible in the request.

```json
{
  "items": [
    {
      "guid": "<TextLabel or TextButton GUID>",
      "properties": {
        "FontFace": {
          "Family": "ovdrassetid://900004166",
          "Weight": "SemiBold",
          "Style": "Normal"
        }
      }
    }
  ]
}
```

Use `studiorpc_instance_read` after the edit for exact Family, Weight, and Style readback. Readback confirms the authored value, not actual glyph coverage or absence of font fallback. Check a focused Studio screenshot with Studio in the foreground, and play-test the actual viewport when relevant. Inspect clipping, wrapping, text/background contrast, and localized strings.

Font names and text in a generated guide image are approximate visual intent. Use this catalog to assign the native GUI fonts; do not treat generated letter shapes as proof that Studio supports that face. Keep body text, action labels, and changing counters native rather than rasterizing them.
