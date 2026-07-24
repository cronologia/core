# tools

Two kinds of tool live in this family, and the line between them is
architectural — keep it.

| | build / CI tooling | agent-side analysis tooling |
|---|---|---|
| language | **zero-dependency Node** | **Python 3, stdlib only** |
| lives in | `template/scripts/` and each project's `scripts/` | `core/tools/` |
| examples | `validate-data.js`, `archive-refs.js`, `check-links.js`, `sync-glossary-terms.js`, `translate.js` | `vtt2txt.py`, `mine-prep.py`, `dataset-query.py`, `unverified-report.py`, `xref.py`, `sync-skills.py` |
| runs | in `build.js`, `node --test`, GitHub Actions — the build is **network-free** | on an agent's machine, on demand |
| writes | `docs/`, `data/archives.json`, link-health reports | **nothing in `data/`** |

The full rationale is `../adr/0004-python-agent-tooling-vs-node-build.md`.

The Python tools **never run in CI and never edit a dataset.** They read and
report, so an agent spends its tokens on judgement instead of scrolling (the one
exception writes no data either: `sync-skills.py` writes vendored
`.claude/skills/` copies). Every one takes `--help`, prints dense fixed-field
output meant to be read by a model, and exits non-zero only on a real error
(unreadable dataset = 1, bad argument = 2) — never because it found something.

No pip installs: Python 3 standard library only, same discipline as the
zero-dependency Node side.

```
python3 -m unittest discover -s tools -p 'test_*.py' -v     # 61 tests, no network
```

Repo arguments accept a bare name (`fsspx`, `tariqa`, `perennialism`, `rcc`,
`glossary`) or a path. Bare names resolve against `$CRONOLOGIA_HOME`, defaulting
to the directory holding the sibling repos (`core/..`).

---

## `mine-prep.py` — transcript → candidate sheet

```
python3 tools/mine-prep.py <transcript.txt|transcript-id> [--lang pt|en|es|auto]
                           [--max-per-section N] [--context N] [--json OUT]
```

A preserved transcript is 20k–63k tokens of noisy auto-caption text. Reading one
end to end costs an agent its whole context. `mine-prep` does the mechanical
pass of the `mine-video` mining checklist and prints a **candidate sheet**:

- **DATED CLAIMS** — years (18xx–20xx), numeric dates, PT/ES/EN month
  expressions, decades, centuries, and spoken two-digit years (`de 88`, `in '88`)
  which is how dates actually appear in speech.
- **PROPER NOUNS — ASR-UNRELIABLE** — capitalized sequences with frequencies,
  near-duplicates clustered by a phonetic key so mangled spellings collapse into
  one row (`LeFevre(28), Archbishop LeFevre(19), Archbishop Lefevre(1)` — likely
  one name, three spellings). Sentence-openers, conversational fillers, words
  that occur more often in lowercase, and `[Music]`-style caption artifacts are
  filtered out.
- **NUMBERS** — percentages, currency, magnitudes (`mil`, `milhões`, `million`)
  and counts attached to a unit (priests, faithful, members, years…).
- **QUOTABLE / ATTRIBUTED** — sentences carrying claim verbs (`afirma`, `disse`,
  `declarou`, `says`, `claims`, `alleges`, `segundo`) or first-person testimony
  (`eu vi`, `when I joined`) — candidates for *attributed* positions, never for
  the site's own voice.

Every item carries `L<line> C<char>` offsets into the **original file** plus a
~200-char context window, so the agent re-reads precisely the passages it wants
and nothing else. Sections are de-duplicated (one item per sentence) and capped
(`--max-per-section`, default 40); when a section overflows the cap, items are
sampled **evenly across the file** rather than truncated, so a two-hour video
isn't represented by its sponsor read alone.

A path, a manifest `id` or a bare file name all work — ids and file names
resolve through `archive/transcripts/index.json`, whose `language` field drives
`--lang auto` (falling back to stopword detection).

**Measured compression** (default `--context 200 --max-per-section 40`):

| transcript | input | sheet | ratio |
|---|---|---|---|
| `transcript-7-nobarco-191-ex-membro-fsspx-dr-juliano.txt` (PT, 45.2k words) | 254,678 B | 16,318 B | **15.6×** |
| `transcript-4-fradd-salza-schismatics-sspx-sedes.txt` (EN, 33.9k words) | 183,827 B | 23,499 B | **7.8×** |
| the same EN transcript at `--context 120` | 183,827 B | 16,509 B | **11.1×** |

English auto-captions carry no punctuation, so context windows can't snap to
sentence ends and run the full width — `--context 120` restores the order of
magnitude.

The header of every sheet repeats the rule that governs its use: **all proper
names and quotes are auto-caption text and must be verified against the audio
before citing** (`sourcing-rules` #5). A candidate sheet is a to-verify list, not
a source.

## `dataset-query.py` — one question, one answer

```
python3 tools/dataset-query.py <repo> find <keyword>          [--json]
python3 tools/dataset-query.py <repo> event <year|year-year>  [--json]
python3 tools/dataset-query.py <repo> figure <name>           [--json]
python3 tools/dataset-query.py <repo> refs [--unarchived]     [--json]
python3 tools/dataset-query.py <repo> unverified              [--json]
python3 tools/dataset-query.py <repo> stats                   [--json]
```

Answers a single question about `data/chronology.json` (~16k tokens) or
`data/glossary.json` without loading the file into context. The dataset kind is
detected by which file exists; `find`, `refs`, `unverified` and `stats` work on
both shapes, `event` and `figure` are chronology-only (asking for them on a
glossary exits 2 with the list of applicable subcommands).

- `find` searches every collection — facts, events, figures, organizations,
  references, terms, and the nested sections (`disambiguation.items[…]`,
  `lineage.*`, `branchTimeline.*`, `numbersChart.*`) — accent-insensitively, and
  prints `locator | date | id | snippet`.
- `event` accepts `1988` or `1970-1990` and shows the `dateVerified` flag and
  `sources[]` per row.
- `figure` matches figures **and** organizations by substring.
- `refs --unarchived` lists references with no snapshot in `data/archives.json`
  — the queue for the Wayback pipeline. Repos without an `archives.json` get a
  note saying so rather than a misleading "all unarchived".
- `stats` gives per-collection counts, the events year span, the unarchived
  count and the number of open verification flags.

Every row starts with a **locator** (`events[12]`, `disambiguation.items[0]`) so
the full record is one targeted read away.

## `unverified-report.py` — the standing verification worklist

```
python3 tools/unverified-report.py [repo ...] [--markdown] [--json]
```

Hand-maintained checklists in tickets (fsspx#1 §1 and friends) rot the moment
someone edits a dataset. The data already knows: this walks every project
dataset (all of `fsspx tariqa perennialism rcc glossary` by default) and prints
everything flagged —

- `dateVerified: false`
- `verified: false`
- any string containing `(to verify)` / `to confirm` / `unverified`

— grouped by repo and collection, with the entity, the exact flagged field path
and the offending text. `--markdown` emits a paste-ready `- [ ]` checklist for a
ticket comment; regenerate it instead of editing it by hand.

The tool never clears a flag. Clearing one is a sourcing decision that requires
a citation (`sourcing-rules` #1) and stays with the agent or human who found the
source.

## `xref.py` — cross-repo consistency

```
python3 tools/xref.py [--repos a,b,c] [--min-repos 2] [--flagged] [--json]
```

The family rule is *cross-reference, never duplicate*: a figure or organization
may legitimately appear in several chronologies, and those datasets must **agree
about it**. They drift silently — a hand review once caught a figure described
as an order "member" in one repo and explicitly "never a member" in another.

`xref` collects entity names from `figures[]`, `organizations[]` (including
parenthetical aliases and both sides of an `A — B` name) plus notable multi-word
proper nouns inside `facts[]`, normalizes them (accents, honorifics), and prints
every entity present in 2+ repos with **each repo's own description line side by
side**. Status per entity:

- `CONTRADICTION` — one repo asserts what another denies (`member` vs
  `!member`), negation scoped per affiliation word so *"adjacent … but never a
  member"* reads as `{adjacent, !member}`, not a blanket denial;
- `DIFFERS` — the affiliation vocabulary
  (member/follower/adjacent/initiate/professor/founder/leader/critic) simply
  doesn't match;
- `ok` — no disagreement detected.

Both flags are **review candidates, not errors**: divergence is often legitimate
(different period, different scope — `sourcing-rules` #4). Nothing is
auto-resolved; resolving an attribution is a human/agent judgement backed by
sources.

## `sync-skills.py` — vendor the skills into a project

```
python3 tools/sync-skills.py <repo> [<repo> ...]        # sync
python3 tools/sync-skills.py <repo> --check             # drift check, exit 1
python3 tools/sync-skills.py <repo> --skills a,b        # subset
python3 tools/sync-skills.py --list                     # what's canonical
```

`core/skills/` is canonical, but an agent working inside `cronologia/fsspx` only
discovers skills that live in *that* checkout. So the skills are **vendored**:
`core/skills/<name>/SKILL.md` is copied to
`<repo>/.claude/skills/<name>/SKILL.md` as a committed, pinned copy that is
never hand-edited — the same pattern as `data/glossary-terms.json`, for the same
reasons (deterministic, offline, visible in the diff). See
`../adr/0002-vendored-glossary-and-skills.md`.

Alongside the copies it writes `<repo>/.claude/skills/_synced.json`:

```json
{ "_comment": "GENERATED — … edit in cronologia/core and re-run …",
  "source": "cronologia/core", "sourcePath": "skills/",
  "syncedAt": "2026-07-24", "tool": "core/tools/sync-skills.py",
  "skills": [ { "name": "data-edit", "sha256": "…", "bytes": 2132 } ] }
```

Per-skill status is `add` (missing downstream), `update` (present but its
content differs — typically a hand-edit), `stale` (present downstream but gone
upstream; a sync removes it), or `ok`. **`--check` writes nothing** and exits
`1` when any target is stale, so CI or an agent can detect drift; a bad argument
or unknown skill name exits `2`. Hashes are newline-normalized, so a CRLF
checkout doesn't produce phantom drift.

Core never pushes into another repo: each project's own agent runs the sync in
its own repo and commits the result (one repo, one committer — see
`../DEPENDENCIES.md`).

## Older tools

- `new-project.sh` — instantiate `template/` with a project accent.
- `yt-transcript.sh` — YouTube captions → clean transcript (the incantation that
  works from sandboxes).
- `vtt2txt.py` — VTT → deduplicated plain text; the precedent for Python
  analysis tooling here.
