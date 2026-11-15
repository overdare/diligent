---
name: humanize-korean
description: Polish Korean prose when the user asks to remove mechanical phrasing or translation-like style; preserve facts, meaning, quotations, and register.
---

# Humanize Korean

Rewrite Korean prose in natural Korean while preserving the original meaning, facts, names, numbers, dates, quotations, and level of formality. Translation, new content, and ordinary spelling correction are outside this workflow unless the user also requests them.

Read `references/quick-rules.md` for the relevant style patterns. Change only passages supported by those rules; leave sound prose alone. Preserve the genre and technical terms. A polished result should not add claims, remove necessary qualifications, or replace precise wording with a vaguer expression.

Use the supplied text or the file the user identifies. Apply the smallest useful edits and check changed passages for factual drift. A fixed edit percentage, score, or repeated review loop is not required.

Return the polished text in the requested format. By default, show it in the conversation with a brief note only if a consequential ambiguity or tradeoff remains. Write a file or a detailed change report only when requested.

For a difficult passage, consult only the relevant portions of:
- `references/ai-tell-taxonomy.md`: pattern classification.
- `references/rewriting-playbook.md`: rewriting examples.
