#!/usr/bin/env bash
set -euo pipefail

# Refresh vendored upstream content from pbakaus/impeccable and normalize
# command references so they always point to this repo's local skill copy.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/pbakaus/impeccable.git}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

UPSTREAM_DIR="$TMP_DIR/impeccable"

echo "Cloning upstream: $UPSTREAM_REPO"
git clone --depth=1 --filter=blob:none --sparse "$UPSTREAM_REPO" "$UPSTREAM_DIR"

echo "Selecting sparse paths"
git -C "$UPSTREAM_DIR" sparse-checkout set source/skills

echo "Syncing skill files as commands"
mkdir -p "$ROOT_DIR/commands"
# Remove old commands that may no longer exist upstream
rm -f "$ROOT_DIR/commands"/*.md
for skill_dir in "$UPSTREAM_DIR"/source/skills/*/; do
  skill_name="$(basename "$skill_dir")"
  if [ -f "$skill_dir/SKILL.md" ]; then
    cp -f "$skill_dir/SKILL.md" "$ROOT_DIR/commands/${skill_name}.md"
  fi
done

echo "Syncing vendored reference files"
for skill_dir in "$UPSTREAM_DIR"/source/skills/*/; do
  skill_name="$(basename "$skill_dir")"
  ref_dir="$skill_dir/reference"
  if [ -d "$ref_dir" ]; then
    mkdir -p "$ROOT_DIR/skills/$skill_name/reference"
    cp -f "$ref_dir"/*.md "$ROOT_DIR/skills/$skill_name/reference/"
  fi
done

echo "Normalizing command references for agent-actionable paths"
python3 - "$ROOT_DIR" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
commands = root / "commands"

for file in sorted(commands.glob("*.md")):
    text = file.read_text(encoding="utf-8")
    original = text

    # ── Resolve template placeholders ──

    # Map generic {{command_prefix}} to our extension invocation
    text = text.replace("{{command_prefix}}", "/impeccable ")

    # ── Agent-actionable cross-skill references ──
    # Commands reference other skills via slash-command syntax (/impeccable frontend-design,
    # /impeccable teach-impeccable) which agents cannot invoke. Replace with direct file-read
    # instructions using placeholders that index.ts resolves to absolute paths at runtime.

    # "Invoke /impeccable frontend-design — <reason>" → "Read `<skill_path>` — <reason>"
    text = re.sub(
        r"Invoke /impeccable frontend-design — ",
        r"Read `{{frontend_design_skill_path}}` — ",
        text,
    )

    # "run /impeccable teach-impeccable" → "read and follow `{{teach_impeccable_path}}`"
    text = re.sub(
        r"run /impeccable teach-impeccable",
        r"read and follow `{{teach_impeccable_path}}`",
        text,
    )

    # ── Canonical file-path placeholders ──
    # (resolved by index.ts at runtime to extension-local absolute paths)

    text = text.replace("`skills/frontend-design/SKILL.md`", "`{{frontend_design_skill_path}}`")
    text = text.replace("`./skills/frontend-design/SKILL.md`", "`{{frontend_design_skill_path}}`")
    text = text.replace("`reference/*.md`", "`{{frontend_design_reference_glob}}`")
    text = text.replace("`./skills/frontend-design/reference/*.md`", "`{{frontend_design_reference_glob}}`")

    # ── Upstream skill-name variants → resolved path ──

    text = text.replace(
        "### Use frontend-design skill\n\n"
        "Use the frontend-design skill for design principles and anti-patterns. "
        "Do NOT proceed until it has executed and you know all DO's and DON'Ts.",
        "### Read local frontend-design guidance\n\n"
        "Read and follow the vendored local guidance at "
        "`{{frontend_design_skill_path}}` (plus its linked "
        "`{{frontend_design_reference_glob}}` files) for design principles and anti-patterns. "
        "Do NOT proceed until you have read them and know all DO's and DON'Ts.",
    )
    text = text.replace(
        "**First**: Use the frontend-design skill for design principles and anti-patterns.",
        "**First**: Read `{{frontend_design_skill_path}}` (plus `{{frontend_design_reference_glob}}`) "
        "for design principles and anti-patterns.",
    )

    text = text.replace(
        "Review ALL the DON'T guidelines in the frontend-design skill before proceeding.",
        "Review ALL the DON'T guidelines in `{{frontend_design_skill_path}}` before proceeding.",
    )
    text = text.replace(
        "(see frontend-design skill for inspiration)",
        "(see `{{frontend_design_skill_path}}` for inspiration)",
    )
    text = text.replace(
        "guidelines in the frontend-design skill—they are the fingerprints",
        "guidelines in `{{frontend_design_skill_path}}`—they are the fingerprints",
    )
    text = text.replace(
        "guidelines in the frontend-design skill. Look for AI slop tells",
        "guidelines in `{{frontend_design_skill_path}}`. Look for AI slop tells",
    )

    # Fallback cleanup for any remaining generic mentions
    text = re.sub(r"\bthe frontend-design skill\b", "`{{frontend_design_skill_path}}`", text)
    text = re.sub(r"\bfrontend-design skill\b", "`{{frontend_design_skill_path}}`", text)

    # ── Fix relative reference links in frontend-design command ──
    # Upstream uses relative paths like (reference/typography.md) which are meaningless
    # once the content is injected into an agent prompt. Make them absolute by
    # prepending the skill directory (dirname of the SKILL.md path).

    text = re.sub(
        r"\(reference/([^)]+)\)",
        r"({{frontend_design_skill_path}}/../reference/\1)",
        text,
    )

    if text != original:
        file.write_text(text, encoding="utf-8")

# ── Safety checks ──

errors = []

for file in sorted(commands.glob("*.md")):
    text = file.read_text(encoding="utf-8")
    fname = file.name

    # No unresolved generic "frontend-design skill" phrasing
    if re.search(r"\bfrontend-design skill\b", text):
        errors.append(f"{fname}: unresolved 'frontend-design skill' reference")

    # No agent-Dead slash-command invocations to other skills
    if re.search(r"Invoke /impeccable frontend-design", text):
        errors.append(f"{fname}: still has 'Invoke /impeccable frontend-design'")

    if re.search(r"run /impeccable teach-impeccable", text):
        errors.append(f"{fname}: still has 'run /impeccable teach-impeccable'")

if errors:
    print("ERROR: unresolved references after normalization:")
    for e in errors:
        print(f" - {e}")
    raise SystemExit(1)

print("Reference normalization complete.")
PY

echo "Done. Upstream content refreshed and command references normalized."
