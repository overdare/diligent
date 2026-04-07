# docs/plan

Implementation plans and architectural decisions.

## Role

`docs/plan` is for future-facing material:

- proposed work
- backlog and pending designs
- implementation planning
- historical planning context when retained

Plan documents are not the source of truth for current implemented behavior.

Current implemented behavior should be documented in:

- `ARCHITECTURE.md` for repository-wide invariants, boundaries, and ownership
- `docs/guide/*` for feature-specific behavior, examples, and change procedures
- `decisions.md` for durable design decisions and rationale when worth preserving

## Lifecycle for implemented work

When planned work is implemented:

1. Promote repository-wide invariants and architectural boundaries into `ARCHITECTURE.md`.
2. Move detailed current behavior and operational guidance into `docs/guide/*`.
3. Remove the plan document or move it to an archive location if it is worth keeping as historical context.
4. Preserve only the durable decision and rationale in `decisions.md` when needed.

Implemented plan documents must not remain the only or primary documentation for current behavior.

## Structure

| Path | Contents |
|---|---|
| `decisions.md` | Full decision log (D001–D088) |
| `feature/` | Feature plans (P-series) |
| `refactor/` | Refactor plans |
| `fix/` | Fix plans |
| `infra/` | Infrastructure plans |
| `uncategorized/` | Drafts pending tidy |

## Naming

Feature/refactor/fix/infra plans use `P###-short-name.md`.
