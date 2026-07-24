# skills

The Cronologia working method, as Claude skills. **This directory is canonical.**
Copies inside a project (`<repo>/.claude/skills/`) are vendored and generated —
edit here, then re-sync.

Each skill is one `SKILL.md`: `name` + `description` frontmatter, then tight
imperative prose. Load `sourcing-rules` first; the rest assume it.

| skill | when |
|---|---|
| `sourcing-rules` | before editing any dataset, writing site copy, or mining a source — the five rules every repo follows |
| `bootstrap-project` | starting a new chronology repo: research → data → build → publish → tickets |
| `mine-video` | a video link arrives: transcript → mining ticket → verified data |
| `dossier-research` | working a person-dossier ticket |
| `net-access` | a fetch returns 403/406/429 or a reset — the access ladder, and the rule against routing around the proxy |
| `data-edit` | any change to `data/*.json`: query → edit → validate/test/build → commit data with regenerated `docs/` |
| `ingest-report` | turning research reports posted on tickets into dataset entries |
| `adopt-template` | pulling a renderer, script or workflow from `core/template/` into a project |
| `preserve-sources` | snapshots, link-health reports, and what belongs in the shared vault |
| `release-work` | finishing a wave: branch, fast-forward, commit, push, report what shipped and what was deferred |

## Vendoring into projects

An agent working inside `cronologia/fsspx` only discovers skills present in that
checkout, so the skills are vendored as a **pinned, committed copy** — the same
pattern as `data/glossary-terms.json`, for the same reasons (deterministic,
offline, reviewable in the diff). See `../adr/0002-vendored-glossary-and-skills.md`.

```bash
python3 ../tools/sync-skills.py fsspx              # sync all skills
python3 ../tools/sync-skills.py fsspx --check      # exit 1 if stale
python3 ../tools/sync-skills.py fsspx --skills data-edit,release-work
python3 ../tools/sync-skills.py --list             # what is canonical here
```

The sync writes `<repo>/.claude/skills/<name>/SKILL.md` plus
`<repo>/.claude/skills/_synced.json` — a manifest recording the source repo, the
skill names with content hashes, the sync date, and the note that these files are
GENERATED. `--check` writes nothing and exits non-zero when a copy is missing,
hand-edited, or no longer exists upstream, so CI or an agent can detect drift.

Each project's own agent runs the sync **in its own repo**; core never pushes
into another repo (one repo, one committer — see `../DEPENDENCIES.md`).

## Adding or changing a skill

Match the existing voice: short, procedural, numbered steps, real script paths,
no filler. Reference tooling by path (`core/tools/dataset-query.py`,
`scripts/validate-data.js`) so the reader can run it. When a skill encodes a
decision rather than a procedure, the decision belongs in an ADR (`../adr/`, or
the owning repo's) and the skill links to it. After editing, re-sync the
downstream copies — or leave them to each project's agent, whose `--check` will
catch the drift.
