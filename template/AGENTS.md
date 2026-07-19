# AGENTS.md (template — adapt per project)

Operating guide for AI coding agents (and humans) working in this repository.
Read this and `context.md` before making changes. The shared method lives in
`cronologia/core` (skills: sourcing-rules, bootstrap-project, mine-video,
dossier-research); the architecture rationale in `cronologia/fsp` → `docs/adrs/`.

## What this project is

A compiled static website documenting the chronology of **<SUBJECT>**.
A single JSON file is the source of truth; a zero-dependency Node script
compiles it into static HTML served by GitHub Pages.

## Repository map

```
data/chronology.json     SOURCE OF TRUTH — facts, events, figures, organizations, references (hand-edited)
data/archives.json       MACHINE-GENERATED Wayback snapshot cache (written by scripts/archive-refs.js; committed)
src/styles.css           Stylesheet (copied into the build)
scripts/validate-data.js Schema check (runs in CI before the build)
scripts/archive-refs.js  Wayback preservation: snapshot lookup + Save Page Now for references[] -> data/archives.json
build.js                 Compiler: data/chronology.json (+ data/archives.json fallback links) -> docs/
test/                    node:test suites (helpers + data invariants + drift check)
.github/workflows/deploy.yml  CI: validate, test, build, drift check, Pages deploy (main + manual dispatch)
.github/workflows/wayback.yml CI: weekly archive-refs run; commits data/archives.json + rebuilt docs/
docs/                    COMPILED OUTPUT, served by GitHub Pages (committed)
```

## Optional visualizations (data-driven, off by default)

The compiler renders extra visual sections only when the corresponding key
exists in `data/chronology.json`; when a key is absent the output is
byte-identical to a build without the feature. Shapes are shown in
`data/chronology.example.json`; the validator checks all of them.

- **`meta.vizChips[]`** — header pill links to the visual sections
  (`{ "href": "#lineage", "label": "🌳 Genealogy" }`).
- **`lineage`** (alias `episcopalLineage`, the original fsspx key) — genealogy
  / lineage trees (`renderLineageSection`). One `trees[]` entry per branch;
  `separate: true` sets a branch apart visually for lines that must NOT be
  read as connected (the fsspx Thục/Palmar pattern). **Typed edges**: a node
  with `edge: "indirect"` (plus optional `edgeLabel`) renders a DASHED
  connector — a reference/association, not a direct consecration/initiation —
  and a solid/dashed legend appears automatically (labels overridable via
  `edgeLegend`). With no typed edges the markup is byte-identical to the
  fsspx site's genealogy section. `heading`/`navLabel` default to
  "Episcopal genealogy"/"Genealogy".
- **`branchTimeline`** — horizontal "subway diagram" of an organization's
  divisions (`renderBranchTimeline`): a trunk line with labeled branches
  forking off at dated points (e.g. SSPX → SSPV 1983 → Resistance 2012 →
  2026). Static inline SVG — print scales it to the page via its viewBox;
  on screen it sits in its own horizontal-scroll container (`.viz-scroll`).
  Lanes follow listing order; `from` forks a branch off an earlier branch;
  `end` terminates a branch (dot) instead of running to the right edge.
  Every trunk/branch entry needs `sources[]` — the figure's claims are cited
  in its `<figcaption>` list.

Print baseline: `src/styles.css` ships an `@media print` block (nav/chips
hidden, figures `break-inside: avoid`, the subway SVG scaled to page width) —
extend it when adding a new visualization.

## Working agreements

1. **Edit data, not output.** Change `data/chronology.json`, run
   `node build.js`, commit the regenerated `docs/` in the same change.
2. **Keep the build green.** `node scripts/validate-data.js`, `node --test`
   and `node build.js` must all pass; CI fails if `docs/` drifts.
3. **Cite every fact; flag every uncertainty; attribute every contested
   characterization.** The validator enforces non-empty `sources[]`.
4. **A merged PR is finished** — branch fresh from `main` for new work.

## Data quality & sourcing rules

<Adapt the subject-specific rules here: the project's disambiguations, its
contested terrain, its primary sources. Keep the five core rules from the
sourcing-rules skill verbatim in spirit.>
