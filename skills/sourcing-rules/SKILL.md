---
name: sourcing-rules
description: The Cronologia sourcing discipline. Load before editing any project's data files, writing site copy, or mining sources. Applies to every repo in the cronologia organization.
---

# Cronologia sourcing rules

These projects document politically and religiously contested subjects. Accuracy
and neutrality matter more than completeness. Five rules govern everything:

1. **Cite it, or flag it as unverified.** Every fact in a `data/*.json` file
   carries a non-empty `sources[]` of reference ids. If a date or claim cannot
   be verified against a source, mark it (`dateVerified: false`,
   `verified: false`, `"(to verify)"`) — flagged-but-honest beats
   confident-but-wrong. Never fabricate; never guess.
2. **Attribute, don't assert.** Contested characterizations ("schismatic",
   "rehabilitated", "front organization", "condemned") are always someone's
   claim: write *who* says so and *when* ("the 2 July 2026 DDF decree
   declares…", "the SSPX rejects…", "commentators read this as…"). The site's
   own voice never takes a side.
3. **Sources span the spectrum by design.** Official, sympathetic, independent,
   academic and critical sources all belong in `references[]` — each labeled
   for perspective where it isn't obvious (e.g. "advocacy think tank —
   critical perspective", "sedevacantist site — labeled as such").
4. **Time-sensitive statuses must be dated.** Canonical status, membership,
   office-holding: state the period, not just the state. What was true in 2009
   may be false after 2026.
5. **Testimony and video are perspectives, not fact sources.** Claims from
   interviews, podcasts and testimony enter a dataset only after independent
   corroboration; otherwise they are cited as attributed perspectives. Verify
   proper names against audio before quoting auto-captions.

## Thread taxonomies are a reading

Tagging events with thread lanes (`meta.threads` + `events[].threads`,
core#23) is classifying a contested chronology — an interpretive act, not a
schema chore. A taxonomy over a contested chronology *is a reading of it*, so
the five rules above apply to the taxonomy itself:

- **Declare it; never derive it.** Lanes exist only as a per-repo declaration
  in `meta.threads`, each with a `basis` naming what grounds it (an actor's own
  periodization, a scholarly framework — cite it in `sources` where one
  exists). Never invent lane values in code, and never assign them by
  clustering the text.
- **Omission editorializes.** No lane for something reads as "not part of the
  story". When deciding the lanes, write down what was left out and why —
  in the ticket that decides them, not silently.
- **Beware false symmetry.** Giving "the Society's account" and "Rome's
  account" equal lanes implies a parity the sources may not support. Lanes are
  containers for events, not a claim that the parties' accounts weigh the same.
- **Cross-cutting is normal.** `threads` is always an array; an event that
  belongs to two storylines is tagged with both. If events keep needing to be
  forced into one lane, the taxonomy is distorting — fix the lanes.
- **Per-repo vocabularies differ, and should.** A project charting ideas needs
  different lanes from one charting an institution. Never impose one shared
  vocabulary across repos, and never backfill lane values across a dataset in
  a single automated pass — tagging is per-event editorial work.
- **Say it is not neutral.** `meta.threads.note` (required by the validator) is
  the visible statement that the lanes are an editorial reading; any UI that
  renders lanes must render it.

## Absence is a claim, and needs its own evidence

Before searching a corpus or a source for a name, read the project's
`KEYWORDS.md`: the naming variants and the terms known to return nothing live
there, and it is a finding aid — listing a term is not asserting it.

- **Verify every zero before reporting it.** A zero is a claim about the
  corpus, and most false zeros are produced by the search rather than by the
  source: an accented string matched with a wildcard, a phrase broken across a
  hard-wrapped line, a glob that covered one file extension of two.
- **Pair every zero with a positive control.** A sweep reporting "PSB: 0" is
  credible only alongside "PSDB: 82" from the same corpus by the same method.
- **A positive control proves the SEARCH worked. It does not prove the CORPUS
  is entire.** For an absence claim the control must test the property the
  claim depends on. Legibility is not completeness. A term found in all
  nineteen files says the reader can read them; it says nothing about whether
  each file is the whole document — and a corpus that was 20% of itself,
  every document truncated at page one, answered "never" to a question whose
  real answer was 2013. Where the corpus is derived from binaries, the
  property is asserted by a test beside it, not by a probe: see
  `core/adr/0006-derived-corpora-ship-an-integrity-test.md`.
- **Say which was checked.** When a finding rests on an absence, write down the
  corpus, the method, the control, and what established completeness. An
  unqualified "never says X" is not publishable.

Operationally: after any data edit run `node scripts/validate-data.js`,
`node --test`, `node build.js`, and commit the regenerated `docs/` in the same
change. Never hand-edit generated files.
