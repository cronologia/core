---
name: data-edit
description: The mandatory loop for changing any Cronologia dataset — query, edit, validate, test, build, commit data plus regenerated docs together. Use before touching any data/*.json.
---

# Edit a dataset

Load `sourcing-rules` first. `data/chronology.json` (or `data/glossary.json`)
is the source of truth; everything under `docs/` is compiled output.

1. **Query, don't read the whole file.** A chronology is ~16k tokens. Ask one
   question at a time:
   ```
   python3 core/tools/dataset-query.py <repo> find <keyword>
   python3 core/tools/dataset-query.py <repo> event 1988 | figure <name> | stats
   ```
   Every row starts with a locator (`events[12]`, `disambiguation.items[0]`) —
   read that record, edit that record. Whole-file reads are a last resort.
2. **Make the edit.** Match the shapes already in the file. Every entry carries
   a non-empty `sources[]` of reference ids — the validator fails otherwise.
   Anything you cannot verify gets **flagged, never guessed**:
   `dateVerified: false`, `verified: false`, `"(to verify)"`. Contested
   characterizations are attributed, not asserted (`sourcing-rules` #2).
   Cross-link shared terms with `[[term-id]]` instead of re-explaining them.
3. **Run the gate, in order:**
   ```
   node scripts/validate-data.js && node --test && node build.js
   ```
   All three must pass. `node build.js` regenerates `docs/`; CI fails the PR if
   `docs/` drifts from `data/`.
4. **Commit data and regenerated `docs/` in the same commit.** Never hand-edit a
   generated file — `docs/`, `data/i18n/*.json`, `data/archives.json`,
   `data/glossary-terms.json` all have a script that owns them.
5. **Re-check the flags you touched.** `python3 core/tools/unverified-report.py
   <repo>` shows what is still open; clearing a flag requires a citation, and
   that decision belongs to whoever found the source.

If the edit spans repos that share an entity, run `python3 core/tools/xref.py`
afterwards — the datasets must agree about people and organizations they both
name. One agent owns a repo's dataset at a time; do not edit a repo another
wave is holding.
