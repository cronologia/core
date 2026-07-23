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
data/chronology.json     SOURCE OF TRUTH — facts, events, figures, organizations, references (hand-edited, English)
data/i18n/{es,pt}.json   MACHINE-GENERATED translation caches (written by scripts/translate.js; committed) — do NOT hand-edit
data/archives.json       MACHINE-GENERATED Wayback snapshot cache (written by scripts/archive-refs.js; committed)
data/glossary-terms.json VENDORED, PINNED list of cronologia/glossary term ids (written by scripts/sync-glossary-terms.js; committed) — validates [[term-id]] cross-links offline
src/styles.css           Stylesheet (copied into the build)
scripts/validate-data.js Schema check (runs in CI before the build) — also fails on unknown glossary [[term-id]] links
scripts/archive-refs.js  Wayback preservation: snapshot lookup + Save Page Now for references[] -> data/archives.json
scripts/check-links.js   Link-health checker (out-of-band/CI): HEAD/ranged-GET status + soft-404 heuristic + Wayback lookup for references[]; JSON + Markdown report. Never edits data.
scripts/sync-glossary-terms.js  Refresh data/glossary-terms.json from cronologia/glossary (out-of-band; needs network)
scripts/translate.js     Fills data/i18n/*.json from a translation backend (env-configured; no-op offline)
build.js                 Compiler: data/chronology.json (+ i18n + archives) -> docs/{en,es,pt}/ + sitemap + robots
test/                    node:test suites (helpers + data invariants + per-locale drift check)
.github/workflows/deploy.yml  CI: validate, test, build, drift check, Pages deploy (main + manual dispatch)
.github/workflows/wayback.yml CI: weekly archive-refs run; commits data/archives.json + rebuilt docs/
.github/workflows/link-health.yml CI: weekly check-links run; opens/updates a single "link health" issue with the failures (never edits data)
docs/                    COMPILED OUTPUT, served by GitHub Pages (committed)
  index.html               root redirect stub -> preferred locale
  en/ es/ pt/              one localized site per locale
  sitemap.xml robots.txt   per-locale SEO
```

## Multi-language (i18n) & SEO

The site ships in **English (default, authoritative), Spanish and Portuguese**.
`es`/`pt` are **machine-translated** from the committed caches in `data/i18n/`
and carry a visible "machine-translated" disclaimer. The language is a path
segment **after** the project (`/<repo>/{en|pt|es}/…`) because GitHub Pages
serves each repo under `https://<org>.github.io/<repo>/`; `/<repo>/` redirects
to the visitor's locale. See `adrs/0001-multilingual.md` and `cronologia/core#9`.

- **Never hand-edit `data/i18n/*.json`** — regenerate with `node scripts/translate.js`
  (set `TRANSLATE_ENDPOINT`/`TRANSLATE_API_KEY`; safe no-op offline).
- Localization is **data-level** (a key-based walk in `build.js`), so every
  renderer — chronology, genealogy, charts, glossary links — is covered.
- **Never translated:** reference titles/publishers, proper names, URLs, dates, ids.
- Each page emits localized `<title>`/description/OG/Twitter, a self canonical,
  `hreflang` (en/es/pt + x-default) and JSON-LD; the build also writes
  `sitemap.xml` (with hreflang alternates) and `robots.txt`.

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
- **`numbersChart`** — contested-numbers / series chart (`renderNumbersChart`):
  for figures that must NOT be silently unified (e.g. a movement's
  self-reported participant count vs. an external survey's population share).
  Each `series[]` is drawn as its OWN panel on its OWN axis, with its OWN
  `unit`, its OWN `sourceLabel` (WHO reported it), and its OWN `sources[]` —
  the series are never merged onto one scale. A required `unitNote` renders the
  explicit **"not directly comparable"** banner. `axisMax` sets that series'
  axis top (defaults to its largest point); each `points[]` entry has a numeric
  `value`, a human-readable attributed `display`, and an optional `year`. The
  `<figcaption>` cites every series. `heading`/`navLabel` default to "Numbers".
  Sits in its own `.viz-scroll` container; prints as static panels.

Print baseline: `src/styles.css` ships an `@media print` block (nav/chips
hidden, figures `break-inside: avoid`, the subway SVG scaled to page width) —
extend it when adding a new visualization.

## Glossary cross-links (optional, off by default)

Prose fields can link into the shared **Cronologia glossary**
(`https://cronologia.github.io/glossary/<term-id>/`) instead of re-explaining a
term, using an inline marker:

- `[[term-id]]` — link whose visible text is the id (e.g. `[[schism]]`).
- `[[term-id|visible text]]` — link with custom visible text
  (e.g. `[[latae-sententiae|latae sententiae]]`).

`term-id` is a glossary slug (`[a-z0-9]` then `[a-z0-9-]*`). Markers are
expanded **after** HTML-escaping and only when a `[[` is present, so a field
with no marker renders byte-for-byte identically to a build without the feature
(the same opt-in contract as the visualizations above). Markers are honored in
the main prose fields: `facts[].value`, `events[].text`, `figures[].role` /
`.notes`, `organizations[].relation` / `.notes`, and `disambiguation.items[].text`.

**Validation is offline and deterministic.** `data/glossary-terms.json` is a
*pinned, vendored* copy of the glossary's term-id list — the build never fetches
it, matching this repo's no-network-in-build rule (only the out-of-band
`archive-refs.js` / `sync-glossary-terms.js` scripts touch the network).
`scripts/validate-data.js` scans every string field for `[[…]]` markers and
**fails the build** on any id not in that pinned list. Refresh the list after
the glossary changes and commit the diff:

```
node scripts/sync-glossary-terms.js                       # sibling ../glossary or the published raw JSON
node scripts/sync-glossary-terms.js ../glossary/data/glossary.json   # explicit local source
```

## Link-health checker (out-of-band / CI only)

The references ARE the product, so link-rot is tracked automatically.
`scripts/check-links.js` reads every `references[].url` and reports, per URL:
its HTTP status (a `HEAD` probe, falling back to a **ranged `GET`** when HEAD is
unsupported or blocked); whether it redirected, plus a **soft-404 heuristic**
(a redirect — or a 200 — whose page `<title>` no longer matches the reference's
declared title, or reads as a not-found/parking page, is flagged **SUSPECT**);
and whether an Internet Archive snapshot exists. A URL that is **dead or suspect
AND has no snapshot** is marked `priorityArchive` — top of the queue for
`scripts/archive-refs.js`.

- **It hits the live network, so it is NEVER part of the build** (the build is
  network-free). Run it out of band or in CI:
  `node scripts/check-links.js --json report.json --md issue.md`.
- **Politeness / semantics:** ≥ 1 request/second (global throttle), a
  User-Agent that names the project, bounded per-request timeout. `403`/`429`
  (and `5xx`/timeouts) are **INCONCLUSIVE, never "dead"** — many publishers
  block bots or HEAD; only real `4xx` (404/410/451…) count as dead.
- **It never edits `data/chronology.json`.** Fixing rot (correct the URL, or
  archive it) is a human decision.
- `.github/workflows/link-health.yml` runs it weekly on GitHub runners
  (`schedule` + `workflow_dispatch`) and opens/updates a **single** "Link health
  report" issue with the failures. Like `wayback.yml`, it runs in CI precisely
  so it never routes around a sandbox's egress policy (fsp ADR-0006).
- Offline helpers (title parsing, the soft-404 rule, status classification, the
  Wayback parser) are unit-tested in `test/link-health.test.js`.

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
