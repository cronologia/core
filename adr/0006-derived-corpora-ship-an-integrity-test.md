# ADR-0006 — A derived corpus ships an integrity test

- **Status:** accepted (2026-08-04)
- **Context repo:** `cronologia/core`
- **Relates to:** `skills/sourcing-rules` (absence claims and positive
  controls); `cronologia/fsp#210`, `cronologia/fsp#212`, `cronologia/core#55`
- **Reference implementation:** `cronologia/fsp` →
  `test/declaration-corpus.test.js`

## Context

Several projects derive a searchable text corpus from binaries: PDFs of
declarations, auto-captions from video, scanned bulletins. The corpus is then
used to answer questions of the form *"does this actor ever say X?"* — which
means reporting an **absence**, and an absence is worth nothing if the corpus
is not entire.

In `fsp` it was not. A hand-rolled PDF extractor located each stream's end by
searching for the next `endstream`; those bytes occur by chance inside
FlateDecode output, so the first stream ended early, the scan resumed inside
compressed data and never re-synced. Every one of the nineteen documents was
page one and nothing after it — 69,898 characters where there are 340,593,
about 20%. Separately, one document stored every glyph twice
(`DDEECCLLAARRAACCIIOONN`), which reads correctly to a human and makes the
whole file unsearchable, because `FARC` is stored as `FFAARRCC`.

Neither failure raised an exception, emptied a file, or produced obviously
broken output. Every existing check was green. A published claim-check — *"the
FARC appears in none of the nineteen declarations"* — was drawn from that
corpus and was wrong: it appears in 2013.

The sweep that produced it **was** controlled. The control was `Cuba`, present
in all nineteen files, and it passed. It proved the search worked. It could not
prove the corpus was whole, because it was answering a different question.

## Decision

**A repo that derives a corpus from binaries ships a test beside it that
asserts the corpus's SHAPE, in the same change as the extractor.** Truncation
and doubling each leave a signature; content checks cannot see them, so the
test asserts the signature is absent. Five checks, each earned by a real
defect:

1. **Nothing ends mid-sentence.** A complete document closes on terminal
   punctuation, a page number, or its own place-and-date line. A hanging
   sentence is what partial extraction looks like.
2. **More than one content unit per source document.** The truncation bug
   yielded exactly one usable stream per document — page one. Record the unit
   count (streams, pages, caption cues) in the corpus index so the test can
   read it without re-parsing the binary.
3. **A size floor, plus no runt files.** The floor sits well above the
   known-broken total and below the real one (fsp: `> 250k` against a broken
   70k and a whole 340k); the per-file minimum catches one damaged document
   inside a healthy total. A floor, not a target.
4. **No glyph doubling.** Compare adjacent character pairs with whitespace
   stripped: the background rate in clean text is 1.0–1.4%, a doubled file is
   100%. Anything over 50% is the defect, not prose.
5. **Every record carries the field the corpus was built to mine.** The corpus
   exists for a reason — a dateline, a speaker, an edition. A record missing it
   is either damaged upstream or a genuine exception, and genuine exceptions
   are listed by id with their reason (fsp: `NO_DATELINE_IN_PDF`), never
   filtered away silently.

Thresholds are per-repo and are written with the numbers that motivated them,
so a later reader can tell a floor from a wish. Exceptions are enumerated with
reasons in the test, in the same style as the template's other ADOPT-style
exception lists.

**This is not shipped as a template test.** `core/template/` ships no corpus,
and a corpus test with no corpus either fails on adoption or skips silently —
and a check that quietly passes when it cannot find what it is meant to check
is the exact failure this ADR exists to prevent. It is not a skill either: it
applies to the minority of repos that derive corpora, and the discipline it
serves already has a home in `sourcing-rules`, which now carries the rule and
points here.

## Consequences

- An absence claim drawn from a derived corpus is only publishable from a repo
  whose corpus test is green. "The search returned zero" and "the corpus
  contains zero" become separately checkable statements.
- The corpus index (`index.json` or equivalent) is part of the deliverable, not
  a by-product: it carries the per-document counts the test reads.
- An extractor rewrite is verified by shape, not by eye. The 20% corpus looked
  right in every file anyone opened.
- New corpus-shaped defects are added to the list above rather than fixed in
  one repo, per the standing rule that fixes found downstream come back up.
