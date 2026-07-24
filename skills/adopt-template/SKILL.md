---
name: adopt-template
description: Pull shared machinery from cronologia/core template into a project repo. Use when porting a renderer, script, validator rule or workflow that already exists in the template.
---

# Adopt template machinery

`cronologia/core` → `template/` is the canonical copy. A project extends the
shared base (fsspx's genealogy, tl's map); it never forks it.

1. **Read the template's version first** — `core/template/build.js`,
   `scripts/`, `test/`, `src/styles.css`, `AGENTS.md`. Whatever it does is the
   contract. **Copy, don't reinvent**: a re-implementation that behaves 95% the
   same is a permanent divergence, and the next sync will fight it.
2. **Keep additions data-driven and OPTIONAL.** A renderer fires only when its
   top-level key exists in `data/chronology.json`; with the key absent the built
   output must be **byte-identical** to a build without the feature. This is the
   contract in core ADR-0001 — verify it by building before and after the port
   with unchanged data and diffing `docs/`.
3. **Port the whole unit, not just the renderer**: the `scripts/validate-data.js`
   rules for the new key, the `test/` cases that cover it, and the `src/styles.css`
   block (including its `@media print` behavior). A shipped renderer with no
   validator rule is how malformed data reaches production.
4. **Respect the vendored-pinned-copy pattern.** Some shared inputs are
   committed copies refreshed by a script, never hand-edited:
   `data/glossary-terms.json` (`node scripts/sync-glossary-terms.js`) and the
   skills under `.claude/skills/` (`python3 core/tools/sync-skills.py <repo>`).
   Both keep the build offline and deterministic; `--check` detects drift.
5. **Run the project's own gate** and commit together:
   ```
   node scripts/validate-data.js && node --test && node build.js
   ```
   Commit the ported files and the regenerated `docs/` in one change; update the
   project's `AGENTS.md` repository map to name the new script or key.
6. **Improvements flow back up.** If you fixed something in the project copy,
   port the fix to `core/template/` too — otherwise the next project inherits
   the bug. Template changes must stay backward-compatible: existing datasets
   keep validating and keep building byte-identical output.
