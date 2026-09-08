---
name: geometry-recipe
description: Deprecated compatibility guide for the former geometry-recipe workflow. Use Editor Luau and native ProceduralModel for persistent procedural generation; do not select this as a separate authoring system.
---

# Deprecated workflow

This name remains only to replace instructions in existing Studio installations.
The previous authoring workflow is retired. Do not use its old runner, recipe-file
protocol, dedicated generation tools, or report format.

Use `studiorpc_execute_luau` with `target: "Editor"` for world creation and editing.
For persistent parameter-driven geometry, configure native `ProceduralModel`
Source, Size, attributes, and AutoRebuild. Follow the system prompt's native Source
authoring reference and inspect the asynchronous generated result. Ordinary
one-time placement can use Editor Luau without a ProceduralModel.

Use empty-query schema search to discover class names, then query the selected
classes for property details. JSON schemas are not a Luau method catalog. If this skill is loaded directly, follow the same replacement workflow
and return a concise result with the checks actually performed.
