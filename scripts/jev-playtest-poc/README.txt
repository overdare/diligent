Autonomous playtest PoC: curated evidence
=========================================

The production implementation is the native Studio playtest tool under
apps/overdare-ai-agent/sidecar/src/tools/studiorpc/tools/playtest/.
Start with docs/review/autonomous-playtest-poc.md for the walkthrough, recorded
results, exact source revisions and remaining acceptance. Provider configuration
is documented in docs/guide/playtest-decision-providers.md.

This directory contains a selected historical evidence set, not runnable game
setup or an automated approval bridge. It includes raid results, HexFall repair
summaries, five Horror GUI trials and an earlier collect/deposit loop, plus the
Decisions authentication probes. A recorded success or failed attempt applies
only to its source revision, settings and scenario.

Original generated evidence is preserved without formatting changes. The Biome
scan excludes evidence/ to avoid rewriting these archived records. JSONL excerpts
are explicitly selected records, not complete traces. Provenance files identify
the original locations and selection. Absolute local paths identify where the
historical run occurred; they are not portable setup instructions.

Raw agent session logs, intermediate game-source dumps, full trace archives,
experimental Python runners and videos remain in the original local workspace.
They are intentionally not shipped in this PR. References inside historical
reports may name those local-only files. Do not treat an archived report as a
claim that every historical companion file is included here.

The last Horror adapter was saved and validated, but its final run never offered
an inspect candidate. Grouped drawer completion and full mission completion are
unverified. API probes returned 401; no authenticated Decisions or vision-backed
live gameplay result is claimed.
