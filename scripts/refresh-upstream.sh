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

echo "Normalizing command references to local skill path"
python3 - "$ROOT_DIR" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
commands = root / "commands"

explicit = (
    "Read and follow the vendored local guidance in this repository at "
    "`{{frontend_design_skill_path}}` (plus its linked "
    "`{{frontend_design_reference_glob}}` files) for design principles and anti-patterns."
)

for file in sorted(commands.glob("*.md")):
    text = file.read_text(encoding="utf-8")
    original = text

    # Normalize command_prefix references to our /impeccable invocation
    text = text.replace("{{command_prefix}}", "/impeccable ")

    # Canonical placeholders (resolved by index.ts at runtime to extension-local absolute paths)
    text = text.replace("`skills/frontend-design/SKILL.md`", "`{{frontend_design_skill_path}}`")
    text = text.replace("`./skills/frontend-design/SKILL.md`", "`{{frontend_design_skill_path}}`")
    text = text.replace("`reference/*.md`", "`{{frontend_design_reference_glob}}`")
    text = text.replace("`./skills/frontend-design/reference/*.md`", "`{{frontend_design_reference_glob}}`")

    # Common upstream instruction variants
    text = text.replace(
        "### Use frontend-design skill\n\n"
        "Use the frontend-design skill for design principles and anti-patterns. "
        "Do NOT proceed until it has executed and you know all DO's and DON'Ts.",
        "### Read local frontend-design guidance\n\n"
        f"{explicit} Do NOT proceed until you have read them and know all DO's and DON'Ts.",
    )
    text = text.replace(
        "**First**: Use the frontend-design skill for design principles and anti-patterns.",
        f"**First**: {explicit}",
    )

    # Targeted known phrases
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

    if text != original:
        file.write_text(text, encoding="utf-8")

# Safety check: commands should not use generic "frontend-design skill" phrasing anymore
leftovers = []
for file in sorted(commands.glob("*.md")):
    text = file.read_text(encoding="utf-8")
    if re.search(r"\bfrontend-design skill\b", text):
        leftovers.append(file)

if leftovers:
    print("ERROR: unresolved frontend-design skill references:")
    for f in leftovers:
        print(f" - {f}")
    raise SystemExit(1)

print("Reference normalization complete.")
PY

echo "Done. Upstream content refreshed and command references normalized."
