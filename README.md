# Cronologia core

The shared machinery of the [Cronologia](https://cronologia.github.io) project
family: a **project template**, **tools**, and **Claude skills**. No content
lives here — if a file mentions a bishop, a party or a theologian, it belongs
in a project repo.

```
template/   Skeleton for a new chronology project: zero-dependency compiler,
            schema validator, node:test suite, corrected deploy workflow
            (main-gated + manual dispatch), Wayback preservation pipeline
            (scripts/archive-refs.js + weekly wayback.yml workflow that
            snapshots every reference URL and commits data/archives.json),
            base stylesheet with accent tokens, AGENTS.md skeleton,
            example data.
tools/      new-project.sh     instantiate the template with a project accent
            yt-transcript.sh   YouTube captions -> clean transcript (the
                               incantation that works from sandboxes)
            vtt2txt.py         VTT -> deduplicated plain text
skills/     Claude skills encoding the working method:
            sourcing-rules     the discipline every repo follows (load first)
            bootstrap-project  research -> data -> build -> publish -> tickets
            mine-video         video -> transcript -> ticket -> verified data
            dossier-research   the person-dossier checklist
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

The Wayback pipeline is ported: `template/scripts/archive-refs.js` looks up
an existing Internet Archive snapshot for every `references[].url`, triggers
polite Save Page Now captures for URLs without one (>=10s between saves,
capped per run via `ARCHIVE_MAX_SAVES`, 429/403 treated as retry-later), and
writes `data/archives.json`, which `build.js` renders as "archived" fallback
links. `template/.github/workflows/wayback.yml` runs it weekly on GitHub
runners (per fsp ADR-0006: when a sandbox blocks archive.org, run in CI —
never route around egress policy) and commits the result.

Still to port from `cronologia/fsp`: the document vault and CI harvesting —
tracked in the issues. The *why* of this architecture lives in fsp's ADRs
(`fsp/docs/adrs/`).

## License

[MIT](LICENSE)
