# Plan: Update extension to match upstream repo structure

## Context
Upstream (pbakaus/impeccable) restructured from `source/commands/*.md` to `source/skills/*/SKILL.md`. Frontmatter changed from structured `args` array to `argument-hint` string + `user-invocable` boolean. New skills added, `simplify` removed.

## Steps

### 1. Refresh script (`scripts/refresh-upstream.sh`)
- Sparse checkout: `source/commands` → `source/skills`
- Copy each `source/skills/*/SKILL.md` → `commands/<name>.md`
- Copy `source/skills/*/reference/*.md` → `skills/<name>/reference/*.md` (for vendored refs)
- Normalize placeholders: `{{command_prefix}}` → `/impeccable `

### 2. Frontmatter parsing (`index.ts`)
- Read `argument-hint` (string) instead of `args` (array)
- Read `user-invocable` (boolean) — only show those in the picker
- Remove `CommandArg` type

### 3. Arg collection UI (`collectArgs`)
- Replace multi-field form with single input field
- Use `argument-hint` as label/placeholder
- Remove required/optional per-field validation

### 4. Inline arg handling
- Remove `parseInlineNamedArgs` (`key=value` syntax)
- `splitInvocation` stays but the tail is a single positional string passed to the input field

### 5. Autocomplete
- Remove named arg suggestions (`arg.name=` completions)
- Keep command name completions as-is

### 6. Vendored files
- Remove `commands/simplify.md`
- Add new commands: `arrange`, `critique`, `distill`, `overdrive`, `typeset`
- Add `skills/critique/reference/*.md`

### 7. Placeholders
- Add `command_prefix: "/impeccable "` to the placeholder map
- Existing `frontend_design_skill_path` and `frontend_design_reference_glob` stay

### 8. Cleanup
- Delete `PLAN.md` after all steps complete
- Commit changes
