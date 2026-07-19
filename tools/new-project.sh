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
#   3. Set the Actions variable ENABLE_PAGES=true.
set -euo pipefail
DEST="$1"; ACCENT="${2:-#3b4257}"; DARK="${3:-#23283a}"; SOFT="${4:-#e8eaef}"
SRC="$(dirname "$0")/../template"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"
sed -i "s/__ACCENT__/$ACCENT/; s/__ACCENT_DARK__/$DARK/; s/__ACCENT_SOFT__/$SOFT/" "$DEST/src/styles.css"
echo "Template instantiated in $DEST (accent $ACCENT). Now write data/chronology.json and the docs."
