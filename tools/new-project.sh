#!/usr/bin/env bash
# new-project.sh — instantiate the Cronologia template into a new project directory.
#
# Usage: ./new-project.sh /path/to/new-repo "#1e4f8f" "#12365f" "#e1eaf6"
#        (accent, accent-dark, accent-soft — pick a distinct identity per subject)
#
# After running: write data/chronology.json (see template/data example and any
# sibling project), README.md, AGENTS.md and context.md; then
#   node scripts/validate-data.js && node --test && node build.js
# Operational order that avoids the traps we hit in July 2026:
#   1. Create the GitHub repo EMPTY, push with `main` as the first branch.
#   2. Only then enable Pages (Source: GitHub Actions) — the github-pages
#      environment pins its allowed branch to the default branch at enable time.
# That is the whole of it; there is no second switch. The ENABLE_PAGES variable
# this script used to tell you to set was removed — with Pages on and the
# variable unset, runs reported success while the deploy silently skipped.
set -euo pipefail
DEST="$1"; ACCENT="${2:-#3b4257}"; DARK="${3:-#23283a}"; SOFT="${4:-#e8eaef}"
HERE="$(dirname "$0")"
SRC="$HERE/../template"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"
sed -i "s/__ACCENT__/$ACCENT/; s/__ACCENT_DARK__/$DARK/; s/__ACCENT_SOFT__/$SOFT/" "$DEST/src/styles.css"

# Vendor the shared skills. An agent working inside the new repo only discovers
# skills that live in that checkout, so a repo bootstrapped without them sits
# outside the sourcing discipline entirely — which is what happened to the eight
# repos of 2026-08-05 (cronologia/core#85). The workflow's skill drift check
# fails a repo whose vendored copies are missing, so this is not optional.
python3 "$HERE/sync-skills.py" "$DEST"

echo "Template instantiated in $DEST (accent $ACCENT), shared skills vendored."
echo "Now write data/chronology.json and the docs."
