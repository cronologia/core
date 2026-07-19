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

Operationally: after any data edit run `node scripts/validate-data.js`,
`node --test`, `node build.js`, and commit the regenerated `docs/` in the same
change. Never hand-edit generated files.
