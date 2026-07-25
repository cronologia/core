# DEPENDENCIES.md — how the Cronologia repos depend on each other

The canonical interdependency map for the family. Every repo's `AGENTS.md`
should point here rather than restating it. Kept in `cronologia/core` because
core is the only repo that is upstream of all the others.

The one-line version: **three infrastructure repos are consumed by everyone;
the chronology projects are peers that cross-reference and never duplicate.**

```
        core ────────────────────────────────┐  template + skills + tools
      (build machinery, method, tooling)     │  (copied, never fetched)
                                             v
   glossary ──[[term-id]] cross-links──>  PROJECT REPOS  <──cross-references──
   (shared terms, depends on nothing)     fsspx  tariqa  perennialism  rcc     (peers)
                                          fsp  tl  celam  grupopuebla  tfp
                                             ^
        archive ─────────────────────────────┘  shared sources + transcripts
      (private vault; cited, not linked)        (ADR-0001, ADR-0002)
```

## The three shared repos

### `core` — machinery and method (upstream of everything)

Provides `template/` (compiler, validator, tests, workflows, styles),
`skills/` (the working method), `tools/` (agent-side Python analysis).
Consumed **by copy**: `tools/new-project.sh` instantiates a project;
`skills/adopt-template` governs later ports; `tools/sync-skills.py` vendors the
skills into a project's `.claude/skills/`. Nothing in a project's build fetches
core, and core depends on no other repo. See `core/AGENTS.md` and `core/adr/`.

### `glossary` — shared terminology (depends on nothing)

`data/glossary.json` defines the family's shared terms (`schism`, `cebs`,
`latae-sententiae`, `philosophia-perennis`, `bayah`, …). Every site links into
it from prose with an inline `[[term-id]]` (or `[[term-id|visible text]]`)
marker, which renders as a link to
`https://cronologia.github.io/glossary/<term-id>/`.

Validation is **offline against a vendored, pinned copy**,
`data/glossary-terms.json`, refreshed by `node scripts/sync-glossary-terms.js`
and committed — the build never fetches the glossary (core ADR-0002, ADR-0003).
Direction is one-way: projects depend on the glossary; the glossary depends on
no project. **A shared term is defined once, in the glossary, and cross-linked —
never re-explained in each project.**

### `archive` — the shared source vault (private)

Holds sources cited by two or more projects, plus video transcripts, each with a
manifest entry (id, title, original URL, capture date, language, citing
projects). Rule of thumb from its **ADR-0001**: cited by one project → that
project's own vault; cited by two or more → here. Stable paths are API; files
may be superseded, never renamed or deleted.

The vault is **private by owner decision**: reader-facing citations are the
original URL plus its Wayback snapshot, never a raw archive URL. Its **ADR-0002**
is the standing networking policy — the UA-filtering vs country-gating
distinction, the per-site register, and the rule that no session routes around
its proxy (see the `net-access` skill).

## The project repos are peers

`fsspx`, `tariqa`, `perennialism`, `rcc` — plus, outside this wave's scope,
`fsp`, `tl`, `celam`, `grupopuebla`, `tfp`. They all consume core, the glossary
and the archive. **They do not depend on each other, and they never duplicate
each other's material.** When two projects touch the same person, organization
or event, one of them owns it and the other cross-links.

Standing boundaries, as currently agreed:

| Boundary | Who owns what |
|---|---|
| `tariqa` vs `perennialism` | **tariqa** = the Maryamiyya **order**: initiations, zawiyas, branch politics, the 1991 Bloomington affair, order-internal ruptures. **perennialism** = the **ideas**: works, journals, reception, the Evola line and its political readings. An event belongs to exactly one of the two; the other links. |
| `fsspx` ↔ both | **fsspx** = Catholic traditionalism (SSPX, its splits, canonical status). It **cross-links** tariqa and perennialism where a figure or claim touches them — and keeps the three "traditionalisms" apart: Catholic traditionalism ≠ the Guénon–Schuon Traditionalist School ≠ Evola's political Traditionalism. |
| `rcc` vs `tl` | **rcc** = the Catholic Charismatic Renewal. **CEBs, liberation theology and their sociological framings belong to `tl`**; rcc attributes such framings to their authors and cross-links, rather than arguing them. |
| any project vs `glossary` | A term that more than one project needs is defined in the glossary and linked with `[[term-id]]`. |
| any project vs `archive` | A source cited by 2+ projects is vaulted centrally (archive ADR-0001), not copied into each repo. |

## Growing a new project

A subject growing inside a repo does **not** become a repo because it got big.
`adr/0005-when-a-subject-becomes-its-own-repo.md` is the test: five dimensions
(own institutional identity · explanatory burden on the parent · own search
identity · standalone sourced mass, symmetric · genealogy rather than theme),
**all** of which must hold, applied with citations.

Before proposing a split, the cheaper options are tried in order — a
disambiguation card, a `figures[]`/`organizations[]` entry, a `branchTimeline`
branch, a cross-link between existing repos. A new repo is the most expensive
option in the family (template adoption debt, preservation pipeline, i18n,
vendored glossary and skills, a boundary row here, and one more dataset owned
per wave), and it is **the owner's decision**: an agent suggests with evidence,
in a ticket in the parent repo, and never creates a repo unilaterally.

Note the trap the ADR names: `tariqa` vs `perennialism` are two repos because
they document **different objects**, not because one outgrew the other. That is
a scoping decision made at bootstrap and maintained by cross-linking — it is
not a precedent for splitting a theme out of its parent.

## Two rules that hold the family together

1. **One repo, one committer, per wave.** Exactly one agent owns a repo's
   dataset at a time. Serialize instead of racing; `git status` in every repo
   you were not assigned stays empty. (`release-work`, `ingest-report`)
2. **Datasets must agree about shared entities.** A figure or organization may
   legitimately appear in several chronologies, but the repos must not contradict
   each other about them — "a member of the order" in one and "never a member" in
   another is a defect in at least one of them. Check with:
   ```
   python3 core/tools/xref.py --repos fsspx,tariqa,perennialism,rcc
   ```
   It prints every entity present in 2+ repos with each repo's own line side by
   side, flagging `CONTRADICTION` and `DIFFERS`. Divergence is sometimes
   legitimate (different period, different scope — `sourcing-rules` #4), so
   nothing is auto-resolved: the flags are review candidates, and resolving one
   is a sourcing decision backed by citations.
