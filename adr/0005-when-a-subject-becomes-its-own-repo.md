# ADR-0005 — When a subject becomes its own repo

- **Status:** accepted (2026-07-25)
- **Context repo:** `cronologia/core`
- **Relates to:** `DEPENDENCIES.md` (the family map and the standing boundaries);
  ADR-0001 (shared-renderer contract — the `branchTimeline` optional key);
  ADR-0002 (vendored glossary ids and skills); ADR-0003 (preservation and
  link-health pipeline); `skills/bootstrap-project`; `skills/adopt-template`;
  `template/adrs/0001-multilingual.md`; `cronologia/archive` ADR-0005 (corpus
  admission — the same "this is an owner decision, and it gets an ADR" shape);
  core#3 (visualization catalog)

## Context

The family's repos are peers that cross-reference and never duplicate
(`DEPENDENCIES.md`). Nothing yet says **when a subject growing inside one repo
has become a subject of its own** — and the question is now live rather than
hypothetical.

The owner's framing: *"if a topic like TFP grows and reaches a new topic like
the Heralds of the Gospel, we need to suggest to create a new repo for it."*

Two pressures make this a rule rather than a case-by-case judgement:

- **The corpus.** `cronologia/archive` ADR-0005 admitted the COF corpus as a
  unit — 589 transcript files in `cof/` (257 `revisadas`, 332
  `revisao_pendente`) — precisely so it can be searched as a base. A searchable
  base of that size surfaces recurring subjects constantly. Most of those
  recurrences are *themes*, not institutions, and the default answer must not
  be "open a repo".
- **The cost.** A ninth or tenth repo is no longer a `cp -r` of a template. It
  is a template-adoption obligation in perpetuity, a preservation pipeline, an
  i18n surface, a vendored glossary and skills set, a weekly link-health issue,
  and one more dataset that a committer must own in every wave. The expensive
  option must be argued *against the cheap ones*, not chosen because a topic
  felt big.

There is also a precedent that must not be misread. `tariqa` and
`perennialism` are two repos, and neither outgrew the other: they document
**different objects** — an initiatic order versus a school of ideas — and
`DEPENDENCIES.md` already fixes that boundary and maintains it by
cross-linking. Object-type scoping is decided at bootstrap. It is not a growth
trigger, and "these two are separate repos" is not a precedent for splitting
whenever a theme gets big.

## Decision

### 1. The test — five dimensions, all must hold

An agent applies this to a **candidate** (the subject) against its **parent**
(the repo it currently lives in). Every answer is backed by something read this
session and cited; unverified answers are marked unverified (`sourcing-rules`
#1) and count as **not** holding.

| # | Dimension | The question, operationally |
|---|---|---|
| **D1** | **Own institutional identity** | Can you write a `facts[]` block *about the candidate* — founded (date, place, actor), its own canonical/legal status **dated** (`sourcing-rules` #4), its own seat/governance — in which no entry is merely about the parent's relation to it? A subject with no founder, no founding date and no status of its own fails here. |
| **D2** | **Explanatory burden on the parent** | Does the candidate generate events the parent would have to **explain** rather than **mention**? Signal: parent `events[]` whose `note` keeps supplying background on the candidate's internal life (its own governance, its own recognitions, its own disputes) that a reader of the parent did not come for. Rule of thumb: ≥10 such events, none of which change the parent's own story. |
| **D3** | **Own search identity** | Would a reader plausibly look for it **by its own name**, not by the parent's? Evidence: its own self-designation, its own official site and literature, external coverage that names it in the title. |
| **D4** | **Standalone sourced mass, symmetric** | Is there enough *already-sourced* material for a standalone chronology at the bootstrap floor — 25–40 dated events and 15–30 references with exact resolving URLs (`skills/bootstrap-project` §1) — and, because these subjects are contested, **more than one side's voice** (self-presentation *plus* independent/critical, `sourcing-rules` #3)? Mining tickets and leads are not sourced mass. If you cannot reach the floor from sources you have read, it is a section, not a repo. |
| **D5** | **Genealogy, not theme** | Do parent and candidate share a **genealogy** — the candidate comes out of the parent by a **datable division** (shared founder, shared membership or patrimony, a contested succession), the thing a `branchTimeline` exists to draw? A shared *theme* (same ideas, same milieu, overlapping figures) is a cross-link, never a split. |

**All five must hold.** Four out of five is not a split; it is one of the
cheaper options below, and the agent must name which.

Which failure points where:

- **D1 fails** → a `disambiguation.items[]` card, or a `figures[]` /
  `organizations[]` entry in the parent.
- **D5 fails, relation is thematic with an existing repo** → a **cross-link**
  and, if the boundary is new, a row in `DEPENDENCIES.md`. Not a repo.
- **D5 holds, D4 fails** → an `organizations[]` entry **plus** a
  `branchTimeline` branch in the parent. Revisit when the sourcing catches up;
  say so in the ticket.
- **D2 fails** (parent can still mention rather than explain) → a
  `branchTimeline` branch and dated `facts[]`. No repo.
- **D3 fails** (readers only reach it through the parent's name) → a
  disambiguation card; the confusion, not the volume, is the real problem.

### 2. The cheaper alternatives, in increasing cost — try them first

1. **A disambiguation card** — `disambiguation.items[]`, the "X ≠ Y" shape.
   Right when the risk is **confusion**, not missing content. Cost: one cited
   item.
2. **A `figures[]` / `organizations[]` entry** — right when the candidate is an
   **actor in the parent's story** with its own name and dates, but its events
   are the parent's events. Cost: one cited entry, plus agreement with any
   sibling repo that also names it (`xref.py`, `DEPENDENCIES.md` rule 2).
3. **A `branchTimeline` branch** — right when there is a **datable division**
   with a genealogy (D5 holds) but the parent still carries the story. Cost:
   cited branch data, plus the renderer under ADR-0001's optional-key contract
   (the renderer itself is core#3's item 3).
4. **A cross-link between existing repos** — right when the material actually
   belongs to a **sibling's object** rather than to a new one (the
   `tariqa`/`perennialism` and `rcc`/`tl` shape). Cost: a boundary row in
   `DEPENDENCIES.md` and datasets that do not contradict each other.
5. **A new repo** — the last resort, below.

### 3. The real cost of a split, which must be stated in the suggestion

Splitting is the most expensive option in the family. Enumerated, as of today:

- **Repo creation is a human step.** Create the GitHub repo **empty**, push
  `main` first, only then enable Pages and set `ENABLE_PAGES=true` — repo
  settings and branch deletion need the owner (`skills/bootstrap-project` §5
  and its anti-traps).
- **Template instantiation and permanent adoption debt.**
  `tools/new-project.sh` plus a distinct accent identity; thereafter every
  template change (renderers, validator rules, tests, print styles) has one
  more consumer to port into (`skills/adopt-template`, ADR-0001).
- **A dataset from zero** at the bootstrap floor: `meta`, `facts[]`,
  `events[]`, `figures[]`, `organizations[]`, `disambiguation.items[]`,
  `references[]` — every entry cited, uncertain dates flagged — plus
  `README.md`, `AGENTS.md`, `context.md`.
- **A preservation pipeline**: `scripts/archive-refs.js` + `wayback.yml`,
  `scripts/check-links.js` + `link-health.yml`, and a weekly link-health issue
  to triage forever (ADR-0003).
- **An i18n surface**: EN authoritative plus ES and PT with per-locale SEO
  paths (`template/adrs/0001-multilingual.md`, `scripts/translate.js`).
- **Vendored shared inputs**: `data/glossary-terms.json` refreshed by
  `sync-glossary-terms.js`, `.claude/skills/` via `sync-skills.py` with its
  `_synced.json` kept from drifting (ADR-0002) — and any term the split makes
  *shared* now belongs in `cronologia/glossary`, defined once.
- **Family bookkeeping**: a boundary row in `DEPENDENCIES.md`, an `xref.py`
  clean bill against the parent, updated `projects[]` in the archive manifests,
  a hub/portal entry, and a per-repo visualization ticket (core#3).
- **Ongoing load**: one repo, one committer, per wave (`DEPENDENCIES.md` rule
  1) — a new repo is a permanent claim on wave capacity.
- **Paid twice.** The parent is edited too: entries move out, cross-links
  replace them, and the two datasets must then agree about every shared entity.

### 4. Who decides: the owner

**An agent suggests; it never creates.** No agent runs `new-project.sh` for a
split, creates a GitHub repo, or starts moving a parent's entries out on its own
judgement. This mirrors `cronologia/archive` ADR-0005 §5: an exception of this
size is an owner decision and gets a decision record.

A suggestion is a ticket **in the parent repo**, titled
`Split candidate: <subject>`, containing:

1. **The five dimensions, answered with citations** — each D1–D5 marked
   holds / fails / unverified, with the reference or capture behind it.
2. **Which cheaper option was tried or is in place**, and precisely why it is
   insufficient — a split proposed without this is incomplete.
3. **The cost list from §3**, acknowledged.
4. **The proposed boundary row** for `DEPENDENCIES.md` — who would own what,
   and what the parent would cross-link instead.
5. **What moves and what stays**, entry by entry, so the parent's diff is
   knowable before anyone agrees.

If the owner accepts, the work then follows `skills/bootstrap-project` from
step 1, and this ADR is cited in the new repo's first ADR.

### 5. Worked example: TFP → Heralds of the Gospel

Applied to the family's live case (evidence read this session; the underlying
claims are attributed, per `sourcing-rules` #2, and several are flagged
unverified in their own tickets):

- **D1 — holds, with flags.** Per `cronologia/tfp#4`, the Heralds' *official
  materials* state a foundation in 1999, pontifical recognition in 2001, a
  founder (Mons. João Scognamiglio Clá Dias), and a 2017 resignation; the same
  ticket flags these as the movement's own claims still to be verified
  independently, and marks the founder's ordination year (2005) unconfirmed.
  Independently of the Heralds' own voice, the other heir asserts the
  distinctness: the IPCO statement captured 2026-07-20 as
  `tfp-ipco-comunicado-arautos` is titled *"O Instituto Plinio Corrêa de
  Oliveira e os Arautos do Evangelho são associações completamente distintas"*.
- **D2 — holds.** Per `cronologia/tfp#5`, a 2017–2019 sequence (resignation,
  apostolic visitation, a commissioner) belongs to the Heralds' own
  institutional life; a TFP chronology would have to explain it, not mention it.
  (The ticket lists that timeline as a claim to cross-check, not as settled.)
- **D3 — holds.** Readers search *Arautos do Evangelho* / *Heralds of the
  Gospel*; the mined material includes the movement's own channel and a
  Spanish-language branch under its own name (`tfp#4`).
- **D4 — not yet met.** What the family holds today is mining tickets, two web
  captures and transcripts (`tfp#4`, `tfp#5`, `tfp#6`) — one heir's
  self-presentation, the other heir's statement, one external chronicle. That
  is the right *symmetry*, but it is not yet 25–40 dated, verified events and
  15–30 references.
- **D5 — holds.** core#3 already models this as a division: its branch-timeline
  item lists **"TFP → Heralds/IPCO"**, and its genealogy item lists `tfp`
  (succession split).

**Verdict under this ADR, today: four of five — not a split yet.** The correct
current answer is §2's option 3 plus option 2: a `branchTimeline` branch and an
`organizations[]` entry inside `tfp`, per the D5-holds/D4-fails row. It becomes
a suggestion to the owner when D4 is met symmetrically — and the suggestion is
a ticket, not a repo.

### 6. Counter-example that must NOT trigger a split: `tariqa` vs `perennialism`

They are two repos because they document **different objects** — the
Maryamiyya **order** (initiations, zawiyas, order-internal ruptures) versus the
**ideas** (works, journals, reception, the Evola line) — a boundary
`DEPENDENCIES.md` states and maintains by cross-linking, with each event
belonging to exactly one side.

Neither forked out of the other by a datable division, so **D5 fails in both
directions**: the relation is thematic. Under §1 that routes to a cross-link,
which is exactly what exists. Two consequences, stated so they are not
rediscovered by argument:

1. **Growth of a theme is never a split trigger.** More Evola-reception
   material inside `perennialism` makes `perennialism` bigger; it does not make
   an "Evola" repo.
2. **Object-type scoping is a bootstrap decision, not a split.** When two
   different objects are recognized up front, that is `skills/bootstrap-project`
   plus a `DEPENDENCIES.md` row — this ADR's test does not apply and must not be
   invoked to justify it.

The corpus case is the same shape at scale: a subject appearing in forty COF
aulas has demonstrated a **theme**, which is D5's failing side. D1 exists
precisely so that "it keeps coming up" cannot become a repo.

## Consequences

- "Should this be its own repo?" has a repeatable answer with a named failure
  mode, instead of being re-argued per subject as the COF corpus surfaces more
  of them.
- The default outcome is a **cheap** one: most candidates land as a
  disambiguation card, an `organizations[]` entry or a branch, which is the
  intended bias — those are reversible, and a repo is not.
- The family absorbs corpus-driven growth as *depth inside existing repos*,
  which is where cross-linking and the no-duplication rule already work.
- Cost: a genuine split is slower to happen — it waits on D4, the sourced mass,
  and on the owner. Accepted: a repo published thin is a citation-bearing site
  that cannot honour `sourcing-rules`, and un-publishing is worse than waiting.
- The test is falsifiable by its own worked example: applied today, TFP →
  Heralds returns **not yet**, and names what would change the answer.
