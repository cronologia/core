# ADR-0001 — The shared-renderer contract

- **Status:** accepted (2026-07-24)
- **Context repo:** `cronologia/core`
- **Relates to:** `cronologia/fsp` ADR-0001 (zero dependencies, JSON as the
  single source of truth); `core/template/adrs/0001-multilingual.md`

## Context

Every project in the family compiles one JSON file into a static site with the
same zero-dependency Node compiler. The compiler is shared, but the projects
are not: fsspx needs an episcopal-genealogy tree, tariqa needs an initiatic
lineage, rcc needs a contested-numbers chart, tl needs a map. Each of those
arrived as a feature in one project and then had to reach the others.

Two failure modes had to be designed out. First, **fork drift**: a project that
copies the compiler and then edits it diverges permanently, and the next shared
fix has to be re-implemented per repo. Second, **churn**: a new renderer landing
in `build.js` must not change the output of the seven sites that do not use it —
otherwise every port rewrites every other project's committed `docs/`, and the
CI drift check becomes noise nobody reads.

## Decision

A shared renderer is added under a single contract:

1. **One optional top-level data key.** A renderer fires if and only if its key
   exists in `data/chronology.json` (`lineage` / `episcopalLineage`,
   `branchTimeline`, `numbersChart`, `meta.vizChips`). No flags, no config
   files, no per-project branches in `build.js`.
2. **Byte-identical output when the key is absent.** Adding a renderer to a
   project that does not use it must produce a zero-diff `docs/`. This is
   testable and is the acceptance criterion for a port: build before, build
   after, diff. The same rule governs inline features — `[[term-id]]` glossary
   markers are expanded only when a `[[` is present in the string.
3. **The validator and the tests ship with the renderer.** Every key has
   `scripts/validate-data.js` rules (including non-empty `sources[]` on every
   cited claim inside it) and `test/` coverage. A renderer without a validator
   rule is not portable, because malformed data reaches production silently.
4. **Styles, including print, ship with it too** — `src/styles.css` plus its
   `@media print` behavior. A visualization that cannot print is half-shipped.
5. **`core/template/` is canonical; projects copy** per the `adopt-template`
   skill. Fixes found in a project are ported back up to the template, and
   template changes stay backward-compatible with existing datasets.

## Consequences

- Projects stay on one compiler lineage instead of eight forks; a fix ported to
  the template reaches everyone.
- `data/chronology.example.json` is the living specification of every key's
  shape, and doubles as the template's own test fixture.
- New visualization work is data-design work first: if a feature cannot be
  expressed as an optional key with cited entries, it does not belong in the
  shared renderer.
- The CI drift check (`docs/` must match `data/`) stays meaningful, because
  no port ever produces unrelated output churn.
