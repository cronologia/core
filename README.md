# Cronologia core

The shared machinery of the [Cronologia](https://cronologia.github.io) project
family: a **project template**, **tools**, and **Claude skills**. No content
lives here — if a file mentions a bishop, a party or a theologian, it belongs
in a project repo.

Start with [`AGENTS.md`](AGENTS.md) (how to work in this repo, the Node-vs-Python
line, the backward-compatibility rules for template changes),
[`DEPENDENCIES.md`](DEPENDENCIES.md) (the interdependency map for the whole
family — who consumes what, and the standing project boundaries), and
[`adr/`](adr/) for why core is built this way:

- [`adr/0001-shared-renderer-contract.md`](adr/0001-shared-renderer-contract.md)
  — optional data key, byte-identical output when absent, validator + tests ship
  with the renderer.
- [`adr/0002-vendored-glossary-and-skills.md`](adr/0002-vendored-glossary-and-skills.md)
  — pinned vendored copies (glossary ids, skills) instead of live fetches.
- [`adr/0003-preservation-and-link-health-split.md`](adr/0003-preservation-and-link-health-split.md)
  — network-free build; archiving and link-checking are CI/out-of-band;
  inconclusive ≠ dead.
- [`adr/0004-python-agent-tooling-vs-node-build.md`](adr/0004-python-agent-tooling-vs-node-build.md)
  — agent-side Python in `tools/` vs zero-dependency Node in the build.
- [`adr/0005-when-a-subject-becomes-its-own-repo.md`](adr/0005-when-a-subject-becomes-its-own-repo.md)
  — the five-dimension test for when a subject graduates from a section to its
  own project repo; an owner decision, recorded as an ADR.

```
template/   Skeleton for a new chronology project: zero-dependency compiler,
            schema validator, node:test suite, corrected deploy workflow
            (main-gated + manual dispatch), Wayback preservation pipeline
            (scripts/archive-refs.js + weekly wayback.yml workflow that
            snapshots every reference URL and commits data/archives.json),
            link-health checker (scripts/check-links.js + weekly
            link-health.yml workflow that checks every reference URL for
            rot and opens/updates a single "link health" issue — never
            edits data),
            glossary cross-links ([[term-id]] markers in prose fields ->
            links to cronologia.github.io/glossary/<id>/, validated offline
            against a pinned data/glossary-terms.json synced by
            scripts/sync-glossary-terms.js), base stylesheet with accent
            tokens, AGENTS.md skeleton, example data.
tools/      new-project.sh     instantiate the template with a project accent
            yt-transcript.sh   YouTube captions -> clean transcript (the
                               incantation that works from sandboxes)
            vtt2txt.py         VTT -> deduplicated plain text
            mine-prep.py       transcript -> compact candidate sheet
                               (dated claims, ASR-unreliable proper nouns,
                               numbers, attributed passages) with line/char
                               offsets -- ~8-16x smaller than the transcript
            dataset-query.py   one question about a chronology/glossary
                               dataset (find/event/figure/refs/unverified/
                               stats) without reading the whole file
            unverified-report.py  the standing verification worklist across
                               all project datasets (--markdown for tickets)
            xref.py            cross-repo consistency: entities in 2+ repos,
                               each repo's description side by side, with
                               affiliation contradictions flagged
            sync-skills.py     vendor skills/ into a project's .claude/skills/
                               as a pinned, GENERATED copy + _synced.json
                               manifest; --check exits non-zero on drift
            test_tools.py      stdlib unittest for the Python tools:
                               python3 -m unittest discover -s tools \
                                   -p 'test_*.py' -v
            See tools/README.md. The line that matters: anything the BUILD or
            CI runs is zero-dependency Node in template/scripts/ or a
            project's scripts/ (the build is network-free); agent-side
            ANALYSIS tooling is Python 3 stdlib-only in core/tools/, never
            runs in CI, and never mutates a dataset -- it reads and reports.
skills/     Claude skills encoding the working method (canonical copies;
            vendored into projects by tools/sync-skills.py):
            sourcing-rules     the discipline every repo follows (load first)
            bootstrap-project  research -> data -> build -> publish -> tickets
            mine-video         video -> transcript -> ticket -> verified data
            dossier-research   the person-dossier checklist
            net-access         the ladder for blocked/geoblocked sources
            data-edit          query -> edit -> validate/test/build -> commit
            ingest-report      research reports -> dataset entries
            adopt-template     pulling shared machinery into a project
            preserve-sources   snapshots, link health, what goes in the vault
            release-work       branch, fast-forward, commit, push, report
            See skills/README.md.
adr/        Core's own decisions (0001 renderer contract, 0002 vendored
            pinned copies, 0003 preservation/link-health split, 0004
            Python tooling vs the Node build, 0005 when a subject
            becomes its own repo).
```

## Starting a new project

```bash
tools/new-project.sh ../new-repo "#a06e14" "#6b4a10" "#f6ecd8"
```

Then follow `skills/bootstrap-project/SKILL.md`. The operational order matters:
create the GitHub repo **empty**, push `main` first, **then** enable Pages
(Source: GitHub Actions) and set the `ENABLE_PAGES=true` Actions variable —
the `github-pages` environment pins its allowed branch to the default branch
at the moment Pages is enabled.

## Syncing the toolkit into existing projects

The template is the canonical copy of the shared files. When it changes,
propagate deliberately (a PR per project) — projects may carry per-subject
extensions (fsspx's genealogy renderer, tl's map) on top of the shared base.
The procedure is the `adopt-template` skill; the compatibility contract is
`adr/0001` (optional data key, byte-identical output when the key is absent).

The **skills** propagate the same way, as pinned vendored copies (`adr/0002`):

```bash
python3 tools/sync-skills.py fsspx            # -> fsspx/.claude/skills/*/SKILL.md
python3 tools/sync-skills.py fsspx --check    # exit 1 if that copy has drifted
```

Each project's own agent runs the sync in its own repo and commits the result;
core never pushes into another repo. The vendored files are GENERATED — edit a
skill here, then re-sync.

The Wayback pipeline is ported: `template/scripts/archive-refs.js` looks up
an existing Internet Archive snapshot for every `references[].url`, triggers
polite Save Page Now captures for URLs without one (>=10s between saves,
capped per run via `ARCHIVE_MAX_SAVES`, 429/403 treated as retry-later), and
writes `data/archives.json`, which `build.js` renders as "archived" fallback
links. `template/.github/workflows/wayback.yml` runs it weekly on GitHub
runners (per fsp ADR-0006: when a sandbox blocks archive.org, run in CI —
never route around egress policy) and commits the result. For the networking
and geoblocked-source policy (which hosts 403/geoblock, and the sanctioned
workarounds), see `cronologia/archive` ADR-0002.

The link-health checker ties into the same discipline:
`template/scripts/check-links.js` reads every `references[].url` and reports its
HTTP status (a `HEAD` probe, falling back to a ranged `GET` when HEAD is
blocked), a soft-404 heuristic (a redirect or 200 whose page `<title>` no longer
matches the reference, or reads as a not-found page, is flagged *suspect*), and
whether a Wayback snapshot exists — emitting a JSON report plus a Markdown
summary. A URL that is dead or suspect **and has no snapshot** is marked
top-priority for archiving (feeding `archive-refs.js`). It throttles to ≥ 1
req/s with a project-named User-Agent and treats `403`/`429` (and `5xx`/
timeouts) as *inconclusive*, never "dead". It never touches
`data/chronology.json`. Like Wayback, it runs out of band, never in the
network-free build: `template/.github/workflows/link-health.yml` runs it weekly
on GitHub runners (`schedule` + `workflow_dispatch`) and opens/updates a single
"link health" issue per repo with the failures.

Still to port from `cronologia/fsp`: the document vault and CI harvesting —
tracked in the issues. The *why* of this architecture lives in fsp's ADRs
(`fsp/docs/adrs/`).

## License

[MIT](LICENSE)
