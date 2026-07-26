# tools

Two kinds of tool live in this family, and the line between them is
architectural — keep it.

| | build / CI tooling | agent-side analysis tooling |
|---|---|---|
| language | **zero-dependency Node** | **Python 3, stdlib only** |
| lives in | `template/scripts/` and each project's `scripts/` | `core/tools/` |
| examples | `validate-data.js`, `archive-refs.js`, `check-links.js`, `sync-glossary-terms.js`, `translate.js` | `vtt2txt.py`, `mine-prep.py`, `dataset-query.py`, `unverified-report.py`, `xref.py`, `sync-skills.py`, `build-keywords.py`, `normalise-entities.py`, `cof-xref.py`, `cof-graph.py` |
| runs | in `build.js`, `node --test`, GitHub Actions — the build is **network-free** | on an agent's machine, on demand |
| writes | `docs/`, `data/archives.json`, link-health reports | **nothing in `data/`** |

The full rationale is `../adr/0004-python-agent-tooling-vs-node-build.md`.

The Python tools **never run in CI and never edit a dataset.** They read and
report, so an agent spends its tokens on judgement instead of scrolling (the two
exceptions write no data either: `sync-skills.py` writes vendored
`.claude/skills/` copies, `build-keywords.py` writes a `KEYWORDS.md`). Every
one takes `--help`, prints dense fixed-field output meant to be read by a
model, and exits non-zero only on a real error (unreadable dataset = 1, bad
argument = 2) — never because it found something.

No pip installs: Python 3 standard library only, same discipline as the
zero-dependency Node side.

```
python3 -m unittest discover -s tools -p 'test_*.py' -v     # 126 tests, no network
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

## `build-keywords.py` — the generated half of a project's KEYWORDS.md

```
python3 tools/build-keywords.py <repo> [--out KEYWORDS.md]
                                       [--glossary REPO] [--json]
```

Searching the COF corpus (592 files, ~7.0M words, counted 2026-07) for
**`FSSPX` returns zero files. So does `SSPX`.** The corpus writes
"Sociedade de São Pio X" (3 files), "São Pio X" (6) and "Monsenhor Lefebvre"
(3), and misspells the name — `Lefebre` in 2 files, `Lefevre` in 1, `Econe`
unaccented in 1. An agent that greps the obvious acronym concludes there is no
SSPX content in the corpus. The obvious spelling also *misranks*: `Lefebvre`
appears in 7 files, but COF081 says it exactly once in ~18k words while COF138
— the densest — says it four times.

So each project keeps a **`KEYWORDS.md`** at its root, with two halves:

| | |
|---|---|
| **hand-written** | dead terms, ASR manglings, corpus traps, which file is dense on what — judgement, and the valuable part |
| **generated** | subject names, people, organizations, terms of art, places, date coverage — all already in `data/` |

This tool writes the generated half **between markers** and preserves
everything outside them, so both halves live in one regenerable file:

```
<!-- BEGIN GENERATED build-keywords.py -->
…
<!-- END GENERATED build-keywords.py -->
```

- `--out PATH` — file exists with the markers → the block is replaced, all
  other text kept byte-for-byte; file exists without them → the block is
  appended and the previous content is untouched; file absent → a scaffold is
  written (H1, the hand-written "naming traps and dead terms" section, then
  the block). Unbalanced or out-of-order markers exit `2` and write nothing,
  rather than risk mangling a hand-written file.
- no `--out` — the block goes to stdout. `--json` prints the collected
  vocabulary instead (and refuses `--out`).

Sections generated, from either dataset shape (`chronology.json` or
`glossary.json`, detected as `dataset-query.py` detects them):

- **Subject names** — `meta.title` and any alternate/short-name key, plus the
  names `meta.subtitle`/`meta.description` put in parentheses. This is what
  yields `SSPX` and `FSSPX` for fsspx and `Renovação Carismática Católica` for
  rcc.
- **People** — every `figures[]` name with its locator, its parenthetical
  aliases and both sides of an `A — B` or `A / B` name; a figure's `id` is
  printed with its page URL (`<siteUrl>figures/<id>.html`, ADR-0003), a
  permanent handle to search on.
- **Organizations** — every `organizations[]` name and alias; acronym and full
  name listed separately, because sources use one or the other.
- **Terms of art** — every `[[term-id]]` marker used anywhere in the dataset,
  resolved to a display name (sibling glossary dataset via `--glossary`, else
  the pinned `data/glossary-terms.json`), with the glossary's own `variants`
  field, the visible text authors actually typed in `[[id|visible text]]`, and
  a flag on any id missing from the vendored list (the build validator rejects
  those markers).
- **Places** — every place/country/location string verbatim, with counts.
- **Dates coverage** — the year span of `events`, of `figures[].dates` and of
  `organizations[].founded`, plus the union: the window a searcher is inside.

Two disciplines are baked in. **Nothing is invented**: every string emitted is
a substring of the dataset as written — no transliteration, no expansion, no
remembered spelling. A variant seen in a corpus but absent from `data/` belongs
in the hand-written half, with a note on where it was seen. And the block opens
by saying what the file is: **a finding aid makes no claims about the world.**
Listing `schism` as a search term does not assert anyone is schismatic, and
listing a hostile source's vocabulary is how its pages get found, not an
endorsement (`sourcing-rules` #2).

Output is deterministic for a given dataset (it stamps `meta.lastUpdated`, not
today's date), so regenerating with no data change produces no diff.

## Analysing the COF corpus — the three tools, chained

`cronologia/archive/cof/` holds the *Curso Online de Filosofia*: **589
community transcriptions, ~7.16M words**, admitted as a corpus under
[`archive/adr/0005`](https://github.com/cronologia/archive/blob/main/adr/0005-corpus-admission.md).
That ADR governs everything below: the corpus is a **search and identification
base**, admission does **not** make it citable in bulk, quotation is sparing and
always attributed to a specific aula and date, and no lecture is reproduced
wholesale into a public build. These three tools help you *find* the aula; the
citation is still a human act performed on the file.

Its manifest, `cof/index.json`, gives each aula a mechanical `entities` list —
the runs of capitalised tokens that aula dwells on, ranked by distinctiveness.
Read straight, that list is unusable as a join key: the corpus spells one man
six ways, and ASR invents new people. So:

```
# 1. what entities are actually there, once the spellings are collapsed
python3 tools/normalise-entities.py --min-aulas 3

# 2. which of them are people our datasets track — the research leads
python3 tools/cof-xref.py --markdown > /tmp/leads.md

# 3. what he discusses together, as a graph any tool can open
python3 tools/cof-graph.py --min-cooccurrence 2 --drop-isolated \
        --graphml /tmp/cof.graphml --dot /tmp/cof.dot
```

Measured on the corpus as committed (2026-07-25): step 1 turns **1,457 surface
strings into 1,415 entities**; step 2 finds **14 dataset figures across 31
aulas**; step 3 emits **1,415 nodes and 4,638 edges**, of which 45 edges survive
`--min-cooccurrence 2`.

## `normalise-entities.py` — one node per entity

```
python3 tools/normalise-entities.py [--corpus PATH] [--aliases PATH|--no-aliases]
                                    [--min-aulas N] [--dates]
                                    [--no-suggestions] [--max-suggestions N]
                                    [--json]
```

The entity index carries `René Guénon`, `René Guenon`, `René Guenón`,
`Rene Guénon`, `Réne Guénon` and `Rene Guenon` — **six strings, one man, 15
aulas.** Anything built on the raw index splits him six ways. Two merge rules,
and no third:

1. **Folding** — de-accent, lowercase, flatten punctuation and whitespace to a
   *match key*. Purely mechanical and reproducible from the manifest. The match
   key is never displayed: the name shown is always a surface the corpus
   writes.
2. **The alias map** — `cof-entity-aliases.json`, committed beside the tool.
   ASR manglings cannot be folded (`John Don Scott` → John Duns Scotus,
   `Ortega C` → Ortega y Gasset) and must not be guessed, so each entry carries
   a **reason**, a **source** and, where useful, an **evidence** quote that the
   tool re-verifies as a literal substring of the aula it names. Entries that
   match nothing are printed as `unused` on every run, and entries the folding
   already handles are printed as `redundant`; the tool never writes to the map.

**No merge on similarity, ever.** `Martin Lings` and `Martin Lins` are one
character apart and may or may not be one man; `Titus Burckhardt` and `Jacob
Burckhardt` are certainly two. Near-misses are printed as **SUGGESTIONS** for a
human — edit distance ≤ 1–2, token-subset, a shared rare token, and compound
surfaces like `Guénon e Schuon` that name two entities — and pairs settled
under the map's `doNotMerge` are suppressed with their reason, so a decided
question is not re-asked every run. Merging two people is invisible downstream;
the tool errs the other way and leaves the work visible.

On the corpus as committed: **1,457 surfaces → 1,415 entities**, 33 groups
absorbing 42 extra surfaces (30 by folding alone), 6 alias variants applied,
12 recorded but unused, 3/3 evidence quotes verified, and **576 suggestions**
nobody has ruled on — among them `Otto Maria Carpo` / `Otto Maria Carpou`,
`Max Orkheimer` / `Max Horkheimer`, `Herbert Marcuse` / `Marcusa` / `Marcusi`.

Seed vocabulary comes from the projects' hand-measured traps tables
(`fsspx`, `tariqa`, `perennialism`, `rcc`, `glossary` each keep a `KEYWORDS.md`
with an ASR-mangling section) — the map cites which table each entry came from
rather than re-inventing the variants. Note its scope: the manifest's entity
index holds *multiword* proper nouns, so single-token manglings (`Genon`,
`Chuon`, `Comarassoume`) can never appear in it and stay where they belong, in
the projects' full-text search traps.

**Why a file naming people sits in core.** `../AGENTS.md` says no content lives
here, and the alias map does name theologians. It is not content in that sense:
it asserts nothing about the world, it is a **spelling-equivalence table for one
corpus** — the same category as a project's `KEYWORDS.md` search vocabulary or
the corpus's own `cof/tag-lexicon.json`, and it is data precisely so the merges
are auditable in a diff instead of buried in code. It lives beside the tool that
reads it because there is exactly one of it and three tools share it;
`--aliases PATH` overrides it, and if the vault ever carries its own map these
tools take it unchanged.

## `cof-xref.py` — which aulas discuss what we track

```
python3 tools/cof-xref.py [--repos a,b,c] [--corpus PATH] [--aliases PATH]
                          [--min-aulas N] [--markdown] [--json]
```

The standing question on half the mining tickets is "does Olavo discuss this
figure, and in which lecture?". This joins each repo's `figures[]` and
`organizations[]` — with parenthetical aliases, both sides of an `A — B` name,
and the members of a record naming several people — against the normalised
entity table, and prints the aulas **with their dates**, so a lead is one file
away from a dated reference.

- **confidence** — `high` when the match keys are identical after folding;
  `medium` when they match only after dropping single-letter initials
  (`Ananda K. Coomaraswamy` ~ `Ananda Coomaraswamy`).
- **zero hits are printed, not swallowed.** A name that matched nothing is
  listed by repo: that is a *finding* about the corpus, in the family's usual
  sense.
- **near misses** — a zero whose surname is shared with something the corpus
  *does* write, or which sits within edit distance 2 of it. This is where the
  leads are: `Marcel Lefebvre` → `Monsenhor Lefebvre` (COF138); `Mark Sedgwick`
  → `Mark Sedwick` (COF465); `Olavo de Carvalho` → `Olav de Carvalho` (COF278).
  Near misses are **never counted as hits** — `Rama P. Coomaraswamy` near
  `Ananda Coomaraswamy` is father and son.
- **not searched** — names too generic to join on (`Francis`, `FSSP`, `Campos`)
  or parenthetical descriptors (`publisher`, `as author`), each with its reason,
  so nobody reads them as a measured zero.

`--markdown` emits a paste-ready ticket comment: a table of leads, the aulas to
open, the corpus's own spellings, and the caveats attached rather than assumed.

Measured over `fsspx,tariqa,perennialism,rcc`: **14 entities hit, 31 aulas**
— René Guénon 15 aulas, Martin Lings 4 (three as `Martin Lings`, one as the
mangled `Martin Ling`), Aldous Huxley 3, Charles Upton 3 (COF342/343/497),
Jean Borella 3 (COF043/075/081), Seyyed Hossein Nasr 3, Julius Evola 2, Michel
Vâlsan 2, and Schuon / Pallis / Eliade / Burckhardt / Wolfgang Smith /
Coomaraswamy 1 each — against 103 zeroes (16 with a near miss) and 21 names
not searched.

**A hit is a lead, never a citation.** It says a name is among an aula's
distinctive vocabulary; it says nothing about what the lecture claims. And the
index ranks distinctiveness, not mentions: COF081 names *Monsenhor Lefebvre*
exactly once in 18,479 words and no frequency method will surface him there. A
zero means "not distinctive anywhere", not "absent from the corpus" — grep
before concluding absence.

## `cof-graph.py` — the co-occurrence graph

```
python3 tools/cof-graph.py [--corpus PATH] [--aliases PATH]
                           [--min-cooccurrence N] [--drop-isolated] [--top N]
                           [--graphml PATH] [--dot PATH] [--json]
```

Nodes are normalised entities; an edge joins two entities appearing in the same
aula, weighted by how many aulas they share. Output is **GraphML and DOT** —
standard formats read by Gephi, Cytoscape, yEd, networkx and Graphviz. No
bespoke format, and no visualisation dependency: this emits files and prints a
summary, something else draws them. `-` writes to stdout.

**The caveat, which belongs in anything built on this:** co-occurrence in a
lecture is **not** a relationship between the people. It means Olavo names both
in the same aula — a navigational signal about what he discusses together, not
evidence about the world. A lecture attacking A for misreading B puts A and B on
the same edge, and so does a list of names read out in passing. Every graph of
this shape reads as a social network at a glance and is not one. The caveat is
in `--help`, in the printed summary, and as a comment inside both emitted files
so it travels with the data.

The text summary prints node/edge counts, the highest-degree entities, the
heaviest edges and the largest connected components. `--min-cooccurrence`
cuts the long tail — most pairs are seen exactly once.

Measured on the corpus as committed: **1,415 nodes, 4,638 edges, 42 isolated
nodes, 71 components**, the largest holding 1,289 entities. At
`--min-cooccurrence 2` only **45 edges over 63 nodes** survive, and the largest
component is the perennialist cluster — René Guénon · Nova Era · Igreja
Católica · Charles Upton · Jean Borella · `Guénon e Schuon` — which is exactly
the navigational use the tool is for.

The tool writes only the output paths you name, and **refuses** a path inside
the corpus directory, inside any repo's `data/`, or bearing a dataset filename
(exit 2, nothing written).

## `places.py` — the place gazetteer, and why it is not a geocoder

Every chronology event carries a free-text `place`. Maps need coordinates, and
the site build is **network-free** by policy (ADR-0004), so coordinates cannot
be looked up at build time. They are committed instead, in
[`data/places.json`](../data/places.json).

Three defects in the raw data motivate this:

1. **No coordinates anywhere** — `place` is free text.
2. **The same place is written more than one way.** fsspx uses both
   `Écône, Valais, Switzerland` and `Écône`; both `Fribourg, Switzerland` and
   `Fribourg`. Grouping by string treats these as different locations.
3. **Compound places — one event, two locations.** `Topeka / Los Angeles, USA`,
   `Lucca, Italy / Rome`, `Lausanne / United States`. A parser that pins the
   first token silently loses the second; for `rcc` that would **misplace the
   origin of the whole movement**.

So a place string resolves to a **list** of ids, never a single one. A comma is
address structure, not a separator — only ` / ` separates locations.

```sh
python3 tools/places.py --list          # distinct strings + usage counts
python3 tools/places.py --check         # unmapped names; exit 1 if any
python3 tools/places.py --propose 25    # Nominatim candidates for unmapped names
```

`--check` is the drift gate: add an event with a new place and it fails until
the gazetteer covers it.

### `--propose` proposes; it never writes

Geocoders return a confident top hit regardless of correctness. Accepting them
blindly would have put wrong pins across the family — measured, not
hypothetical:

| query | top hit | correct |
|---|---|---|
| `Astana` | a **castle in Malaysia** | Kazakhstan (3rd hit) |
| `Cairo` | **Cairo, Illinois** | Egypt (3rd hit) |
| `Bloomington (Monroe County), Indiana, USA` | a **Murphy USA filling station** | the city |
| `Fribourg` | the **canton** | the city, where the SSPX was founded |
| `Lucca, Italy` | the **province** | the city |

Every proposal prints the full OSM `display_name` for exactly this reason, and
every accepted entry records the `display_name` it was confirmed against — so a
wrong match is auditable later rather than invisible. Nothing is auto-accepted.

### Things that are not points

- **Countries and regions** (`Italy`, `Poland`) carry `precision:
  "country-centroid"`. The point is *not* where anything happened; a renderer
  must show it differently from a settlement, or omit it.
- **Scopes are not places.** `Worldwide`, `international`, `online
  (traditionalist-Catholic media)` and survey populations are
  `kind: "non-geographic"` with **no coordinates at all**. Dropping a pin for
  them would invent a location the source never claimed.
- **Jurisdictions.** `Diocese of Arlington, Virginia, USA` names an
  ecclesiastical territory, not a settlement. It is pinned at the see city with
  a note saying the pin marks the see, never the extent of the diocese.

Coordinates are OpenStreetMap data under ODbL 1.0 — attribution belongs on any
published map.

## `cof-dates.py` — are the COF lecture dates consistent?

`archive/cof/index.json` marks every `revisada` file `dateVerified: true` because
the lecture date was read from the transcription's own header. Consuming repos
cite "aula N, `<date>`" on that basis.

**The headers are not all right.** Sorting the 257 dated files by aula number,
fourteen carry a date inconsistent with *both* their immediate dated neighbours —
including five off by very close to a whole year while the day and month fit the
sequence perfectly. `COF079.md` reads `16 de outubro de 2012` between two aulas
dated October **2010**. The manifest is faithful; the defect is upstream.

```sh
python3 tools/cof-dates.py            # anomalies, exit 1 if any
python3 tools/cof-dates.py --index    # header vs the community index lineage
python3 tools/cof-dates.py --json     # machine-readable
```

That was found by hand once. This makes it a standing check, so it is not
rediscovered by hand a second time — the lesson of #21.

### It reports; it never corrects

The header is the evidence. An inference from neighbouring aulas is not, and a
course can legitimately be recorded, released or renumbered out of order. So the
tool separates **probable year typos** (a whole-year offset with the day and
month intact) from **ordering anomalies** (days or weeks), and decides nothing.

### `--index`: two sources, and neither is authoritative

A second source is vaulted in `archive/webcaptures/` — the community index
lineage (Rafael Almeida → the Mateus Santos Pereira extension → the Jornal
Cidadania continuation). Those three are **one source, not three**: they carry
identical dates for 485 of 485 shared aulas, quirks included.

It disagrees with the headers on **33** aulas, and **both sides carry year
typos**. Aulas 217–220 are a continuous weekly series on one book:

| aula | header | index | sequence supports |
|---|---|---|---|
| 220 | 2013-09-14 | 2012-09-14 | **header** — the index breaks its own series |
| 222 | 2013-10-22 | 2013-10-05 | **index** — the header falls after aula 223 |

So neither source may be preferred wholesale; a bulk import of the index would
have introduced a fresh error at aula 220. `--index` applies the neighbour test
to both and reports which side the sequence supports — currently **4 header, 11
index, 18 undecided**. *Undecided is a real result and must stay in the output*:
nothing is promoted to `dateVerified: true` without a third anchor, for which
the COFemAudio upload record is the obvious candidate.

## `template-drift.py` — has a template fix reached the repos that run it?

Vendored **skills** have drift detection (`sync-skills.py --check`). Vendored
template **scripts** had none, and the cost was measured, not imagined:

- `check-links.js` gained `headerSafe()` in the template ([core#12]) so that an
  em dash in a project title could not make `fetch` throw. **The fix reached
  exactly one repo** — `fsspx`, where it was written. Four repos grew four
  *different* local variants, and in two of them (`tariqa`, `rcc`) there was no
  sanitiser at all — so `fetch` threw, `checkUrl` swallowed it, and the weekly
  link-health run reported **every reference as inconclusive** while looking
  healthy.
- `translate.js` gained a provenance fix that reached **no** adopting repo until
  it was ported by hand — and even then one call site was missed in all five.

```sh
python3 tools/template-drift.py             # exit 1 on drift
python3 tools/template-drift.py --repo rcc
python3 tools/template-drift.py --json
```

### The contract: the template declares its adoption points

A byte-comparison is useless here, because adopting repos legitimately customise
parts of these files. So the template marks what may change:

```js
// >>> ADOPT: user-agent
// A repo may set its own fallback name and repo URL. It must still route the
// title through headerSafe().
function deriveUserAgent(projectName) { … }
// <<< ADOPT
```

Everything **outside** an ADOPT block is shared machinery and must match.
Everything inside is the repo's. Deleting a block the template declares is
itself reported, so a repo cannot quietly drop the marker to silence the check.

Current adoption points: `user-agent`, `translatable-keys`, `dataset`,
`official-ref`, `recapture-log`, `report-footer`, `project-fallback`.

### What is deliberately not compared, and why

- **`validate-data.js` is not a shared script.** Each repo validates its own
  schema; glossary's differs in **363 of 321 lines** — it is a different program
  that happens to share a filename. It is *seeded* by the template and owned by
  the repo.
- **The module docblock and all comments are skipped.** Comment prose is
  legitimately per-repo (glossary says "primary reference" where a chronology
  says "official"). Diffing prose would report drift forever, the check would be
  muted, and the muting would hide the code drift this exists to find — which is
  precisely how `headerSafe` went unpropagated. The trade-off is explicit: a
  comment-only template change will not be flagged. A comment-only change is not
  a fix.

11 tests, including that a code change hidden among comment changes is still
caught, that deleting a declared ADOPT block is reported, and that the real
family currently passes.

[core#12]: https://github.com/cronologia/core/issues/12

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
