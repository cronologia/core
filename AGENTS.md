# AGENTS.md — cronologia/core

Operating guide for AI coding agents (and humans) working in this repository.
Read this and [`DEPENDENCIES.md`](DEPENDENCIES.md) before making changes.

## What this repo is

The **shared machinery** of the Cronologia project family: the project
template, the working method as Claude skills, and agent-side analysis tooling.

**No content lives here.** If a file mentions a bishop, a party, an order or a
theologian, it belongs in a project repo. Core carries structure, not subject
matter — with three narrow exceptions, each of which is resolution machinery
rather than subject matter: example data
(`template/data/chronology.example.json`), which specifies shapes and fixtures
for the template's own tests; `tools/cof-entity-aliases.json`, a
spelling-equivalence table for the COF corpus (which transcription of a name is
which) kept as data so every merge is auditable in a diff; and
`data/places.json`, the shared place gazetteer (which spelling of a place is
which, and its coordinates) that the network-free builds resolve map pins from
— kept here so every project draws the same map from the same strings. None of
them makes a claim the chronologies argue over; all three are machinery.

Core is consumed by copy, not by dependency: nothing here is published to a
registry, and no project's build fetches it. Deleting `core/tools/` must not
break a single project build.

## Repository map

```
template/    Canonical skeleton for a chronology project: zero-dependency
             compiler (build.js), schema validator, node:test suites, deploy /
             wayback / link-health workflows, base stylesheet with accent
             tokens, AGENTS.md skeleton, example data.
skills/      The working method, as Claude skills (canonical copies):
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
tools/       Agent-side analysis tooling + the project instantiator.
             mine-prep / dataset-query / unverified-report / xref /
             sync-skills / build-keywords (generates the mechanical half of a
             project's KEYWORDS.md — the search vocabulary an agent needs
             before grepping a corpus).
             COF corpus tools, chained in that order:
             normalise-entities  collapse the manifest's entity spellings into
                                 one node per entity (folding + a committed
                                 alias map; never on similarity)
             cof-xref            which aulas discuss the figures our datasets
                                 track, with dates — research leads, not
                                 citations
             cof-graph           entity co-occurrence graph in GraphML and DOT
                                 (co-occurrence is navigation, NOT a claimed
                                 relationship)
             cof-entity-aliases.json — committed data, not code: the human
             merge decisions (reason + source + verifiable evidence quote) the
             three tools share. See tools/README.md.
             Video intake:
             pick-source-track   which caption track is the ORIGINAL. YouTube
                                 auto-translations carry `tlang` on the
                                 timedtext URL and the source track does not,
                                 so a language code is never the test; exits 1
                                 rather than guess. yt-transcript.sh fetches
                                 what it detects and treats its LANG argument
                                 as an assertion (exit 2 on mismatch).
adr/         Why core is built this way (ADR-0001..0005).
```

## The line that matters: Node vs Python

| | build / CI tooling | agent-side analysis tooling |
|---|---|---|
| language | **zero-dependency Node** | **Python 3, stdlib only** |
| lives in | `template/scripts/`, a project's `scripts/`, `build.js` | `core/tools/` |
| runs | in the build, `node --test`, GitHub Actions | on an agent's machine, on demand |
| network | **never in the build**; only out-of-band scripts | as the task requires |
| writes | `docs/`, `data/archives.json`, reports | **nothing in `data/`** |

No pip installs, no npm installs, on either side. The Python tools read and
report so an agent spends its tokens on judgement instead of scrolling; they
never run in CI and never mutate a dataset. Full rationale: `adr/0004`.

## Template changes must stay backward-compatible

The template is copied into eight-odd repos that are all downstream of it at
different commits. Therefore:

1. **New renderers are optional, data-driven keys.** A section renders only when
   its top-level key exists in `data/chronology.json`; with the key absent the
   built output is **byte-identical**. Verify by building a project before and
   after with unchanged data and diffing `docs/` (`adr/0001`).
2. **Never break an existing dataset.** A validator rule that suddenly fails
   today's committed data is a breaking change; add the rule together with the
   migration, or make it apply only to the new key.
3. **Ship the whole unit**: renderer + validator rules + tests + styles
   (including `@media print`) + a line in the template `AGENTS.md` map.
4. **Fixes found downstream come back up.** A patch applied only in a project
   means the next project inherits the bug.
5. **Shared inputs are vendored, pinned copies** refreshed by a script, never
   hand-edited: `data/glossary-terms.json` and `.claude/skills/` (`adr/0002`).

## How projects consume core

- **New project:** `tools/new-project.sh <dest> <accent colors>`, then follow
  `skills/bootstrap-project`.
- **Existing project, new machinery:** follow `skills/adopt-template` — read the
  template's version, copy it, port validator + tests + styles, run the
  project's `node scripts/validate-data.js && node --test && node build.js`, and
  commit the regenerated `docs/` with the change.
- **Skills:** `python3 tools/sync-skills.py <repo>` vendors `skills/*/SKILL.md`
  into `<repo>/.claude/skills/` with a `_synced.json` manifest;
  `--check` exits non-zero when a target has drifted. The vendored copies are
  GENERATED — edit them here, then re-sync. Core does not push into other
  repos: each project's own agent runs the sync in its own repo.
- **Tooling:** run the Python tools from a checkout of core sitting beside the
  project repos (`python3 core/tools/dataset-query.py fsspx stats`). Bare repo
  names resolve against `$CRONOLOGIA_HOME`, defaulting to `core/..`.

## Working agreements

1. **One repo, one committer, per wave.** Do not commit to a repo another agent
   is holding; `git status` in every repo you did not touch stays empty.
2. **Verify before committing:** bootstrap a scratch copy of `template/` with
   `data/chronology.example.json` as `data/chronology.json` and run
   `node scripts/validate-data.js && node --test && node build.js`; run
   `python3 -m unittest discover -s tools -p 'test_*.py'`.
3. **Never edit another repo's data from here.** Core's own `data/` holds only
   the machinery exceptions above (example fixtures, the alias table, the place
   gazetteer), and no agent working in core touches a project dataset.
4. **Document the decision, not just the code.** A change to the shared
   contract gets an ADR in `adr/`; a change to the method gets a skill edit.
