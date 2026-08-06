# ADR-0007 — Approval is an act about an object, not a verdict about a case

- **Status:** accepted (2026-08-06)
- **Context repo:** `cronologia/core`
- **Applies to:** every repo carrying an `approvalLadder` — currently cimbres,
  fatima, gracas, guadalupe, lagrimas, lasalette, lourdes
- **Relates to:** ADR-0001 (a renderer fires on one optional data key);
  `.claude/skills/sourcing-rules/SKILL.md` (attribute, never assert)

## Context

Every apparition repo faces the same question from readers, and it is a fair
one: *if the Church built a basilica, crowned the image, granted indulgences,
put the feast in the universal calendar and sent four popes on pilgrimage, in
what sense is the apparition "not approved"?*

The ladders answer "the apparition was not ruled on" while the same page
records a shrine, a cult and a stack of papal acts. Read quickly, that looks
like the project withholding an approval the Church plainly gave. The question
has been raised repeatedly and the answer lived only in reviewers' heads.

It matters because the alternative is not neutral. If honours counted as
findings, a case a bishop examined and endorsed would render identically to a
case nobody ever ruled on — both have pilgrims — and the chart would carry no
information at all.

## Decision

**A rung records one authority's act about one object, at one date, citing the
document. Objects are never merged, and an act about one object is never
promoted to a finding about another.**

Concretely:

1. **The object is named in the rung's label** when it is not the apparition:
   "Rome — the cult, the calendar and the shrine (not the apparitions)", "Holy
   Office — Mélanie's printed booklet (not the apparition)". A reader scanning
   the cascade sees what was judged before reading a word of prose.
2. **Acts of cult get `adjacent`**, not `favourable`. Coronations, feasts,
   indulgences, basilicas, patronages, faculties, imprimaturs and papal
   consecrations regulate or honour worship. They presuppose the devotion; they
   do not adjudicate the event.
3. **A judgment about a person is its own rung** — a seer's beatification or
   canonization judges holiness of life, not what they reported seeing.
4. **`not-found` is a statement about the evidence reached; `not-reached` is a
   claim about the case** and needs positive evidence that the case was never
   referred. Where a bishop submitted his judgment upward, as at Lourdes in
   1862, the case demonstrably reached Rome and the rung is `not-found`.
5. **Where a bishop did rule on the apparition, the rung is `favourable` and
   quotes him.** This ADR is not a policy of withholding approval. It is a
   policy of locating it.
6. **Every ladder carries a `note`** stating both halves in the reader's terms:
   what was approved, by whom, and what was never adjudicated.

## Why this is the Church's distinction and not ours

The strongest argument for the decision is that the Church makes it explicitly.

The Dicastery for the Doctrine of the Faith's **Norms for Proceeding in the
Discernment of Alleged Supernatural Phenomena** (17 May 2024) establishes six
possible conclusions and states in art. 23 that "as a rule, neither the
Diocesan Bishop, nor the Episcopal Conferences, nor the Dicastery will declare
that these phenomena are of supernatural origin", the Pope excepted. The
ordinary favourable outcome is *Nihil obstat*, defined in art. 17 as
acknowledging "many signs of the action of the Holy Spirit" **without**
"expressing any certainty about the supernatural authenticity of the phenomenon
itself". The document's own presentation observes that most shrines "have never
had an official declaration of the supernatural nature of the events".

Cite it as `ddf-norms-2024`. It is in all seven repos, with a shared
disambiguation item whose English text is byte-identical across them, so the
es/pt translations are authored once and a reader moving between sites meets
one wording.

Three independent confirmations, all from sources with the opposite interest:

- **Ullathorne, 1854.** A sympathetic bishop catalogues nine favours Pius IX
  granted La Salette and opens the same chapter: *"The Holy See has not
  formally pronounced upon the fact of La Salette."*
- **Pius XII, 1957.** An entire encyclical on Lourdes credits the recognition
  to the bishop of Tarbes in 1862.
- **The Lourdes sanctuary's own page on the popes** lists what every pope from
  Pius IX to Benedict XVI granted, and claims no papal approval.

And one from the other direction: the Bishop of Pesqueira's pastoral letter of
2021 on Cimbres permits the devotion and speaks of the "great probability" of a
supernatural character *without declaring one* — the shape of a *Nihil obstat*
three years before the norms defined it.

## The failure mode this prevents

Four claims of papal approval were checked against their own documents in a
single day. Every one turned out to be a real papal act, correctly dated,
describing something else:

| Claim in circulation | The document |
|---|---|
| La Salette — "Pius IX approved the devotion, 19 Sep 1851" | Bishop de Bruillard's doctrinal pronouncement |
| Lourdes — "Pius IX's decree of approval, 1 Feb 1876" | The decree of canonical coronation |
| Coromoto — "Pius XII, 11 Sep 1952" | The canonical coronation |
| Jiříkov — "Leo XIII, 1885" | The elevation to minor basilica |

The relabelling only ever runs one way: nobody mistakes an approval for a
coronation. Two of the four were found while deliberately hunting for
counterexamples to this ADR, which is the strongest test it has had.

The mirror error is equally common and equally wrong — reading the Holy Office
acts of 1915 and 1923 against Mélanie's expanded secrets as Rome condemning La
Salette. Same mistake, opposite sign. Both are prevented by the same rule.

## Consequences

- **Some ladders look emptier than the devotion's standing suggests.** gracas
  is one `inconclusive`, one `not-found` and three `adjacent` rungs while the
  Miraculous Medal has been struck by the hundreds of millions with the
  Church's blessing. That gap is the finding, and the ladder note says so in
  the reader's own terms: *anyone who says the medal is approved is right.*
- **New rungs need an object before they need a status.** A reviewer's first
  question on any proposed rung is "about what?", not "favourable or not?".
- **`ladderRungs()` enforces the mechanics**, not the judgment: unknown status
  throws, an uncited rung throws, and the two "nothing here" statuses must
  carry `noDocument` prose saying what was searched. The object discipline is
  editorial and lives here.
- **This ADR does not settle any case.** Where sources disagree on whether an
  approval was issued — the Miraculous Medal's 1836 inquiry, Campinas 1931 —
  both accounts are carried on the rung and neither is resolved.
