# Temporary Chroma-Key Workflow

Use for isolated, opaque buttons, glyphs, and backplates whose exterior should be transparent. Generate the artwork with a flat key-colored background, then remove that color locally. This edits the generated pixels; it does not replace the artwork with code-drawn shapes. Keep the normal alpha-generation workflow for glass, smoke, soft shadows, or other deliberately translucent art.

## Prepare and generate

First verify an available Python 3 environment can import Pillow (`from PIL import Image`). Python/Pillow is an optional host dependency, not bundled by Diligent. Use the actual available executable (`python3`, `python`, or a verified environment path). If missing, report the prerequisite before generating keyed files; do not install packages silently or import green backgrounds as finished assets.

Choose a key color absent from the artwork: green `#00FF00` by default, or blue `#0000FF` with `--key blue` for green artwork. Do not use a key that occurs in the subject, including fine edge details; color keying cannot distinguish those pixels from the background. Keep the normal alpha path if neither key is suitable.

Use `generate_image` with `background: "opaque"` and the guide/anchor references as usual. Request one opaque isolated object on a perfectly flat, opaque key background, with clear padding, no backdrop texture, gradients, shadows, green spill, or checkerboard. Do not simultaneously ask the generator for transparency. For a hollow frame, fill the opening with the same key color; for a solid button, keep its face opaque.

Example prompt addition: "Opaque button face and rim on uniform solid RGB(0,255,0) background. No transparency or checkerboard. No green in the button, no green reflections, no outside shadow. Keep the full object inside clear green padding."

Inspect the keyed output before processing. A nonuniform background or green-tinted subject needs correction, not a higher tolerance that erases artwork. Generation/correction calls still share the initial-call-plus-two-retries budget from [image-assets.md](image-assets.md).

## Remove the key and verify

Resolve the bundled [chroma-key script](../scripts/chroma_key.py) against the skill base directory and run it with the generated input and a fresh output filename:

```sh
python3 "<skill-base>/scripts/chroma_key.py" "<generated-file>" "<new-output>.png"
```

The script removes near-key background, converts keyed edge pixels to partial alpha, and reduces key-color contamination at those edges. It preserves dimensions and existing alpha, saves RGBA PNG, and refuses to overwrite the source or an existing output. `--tolerance` defaults to 32; inspect edge quality before changing it. JSON output reports the resulting `file` and alpha-pixel counts, not visual correctness.

Check the alpha result on light and dark backgrounds: exterior transparency, opaque object interior, intact cyan/white detail, readable edges, no colored halo, and no accidental holes. Preserve the original keyed file. Import only the processed PNG's absolute path through the existing Studio image import tool, then continue native GUI binding and play verification. Local key removal does not consume another image-generation call.
