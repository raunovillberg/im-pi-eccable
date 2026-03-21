# AGENTS Guide

## Purpose

This repository packages Impeccable commands for pi as a standalone extension.

## Source of truth for design guidance

- Commands are in `./commands/*.md`.
- The frontend design guidance they must follow is vendored in this repo at:
  - `./skills/frontend-design/SKILL.md`
  - `./skills/frontend-design/reference/*.md`

When a command mentions anti-patterns, DOs/DON'Ts, or frontend design guidance, treat the local `./skills/frontend-design/**` files as authoritative.

## Important behavior

- Do **not** rely on an externally registered `frontend-design` pi skill for these commands.
- Commands are written to reference local files directly so execution always uses the vendored copy.
- The `/impeccable` picker adds a final built-in `frontend-design` option that loads this vendored guidance; this does not register a standalone pi skill.

## Refreshing upstream content

Use:

```bash
./scripts/refresh-upstream.sh
```

This script pulls:
- `source/commands/*.md`
- `source/skills/frontend-design/**`

Then it normalizes command references to runtime placeholders that are resolved to extension-local absolute paths by `index.ts`:
- `{{frontend_design_skill_path}}`
- `{{frontend_design_reference_glob}}`

After running it, verify attribution in `NOTICE.md` still matches shipped content.
