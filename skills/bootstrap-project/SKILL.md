---
name: bootstrap-project
description: Bootstrap a new Cronologia chronology project from research to published site. Use when starting a new project repo in the cronologia organization.
---

# Bootstrap a Cronologia project

Load `sourcing-rules` first.

**If this project is a split out of an existing repo** — a subject that grew
inside another project rather than a new subject — do not bootstrap yet. Apply
the test in core `adr/0005-when-a-subject-becomes-its-own-repo.md` first: all
five dimensions must hold, the cheaper alternatives (disambiguation card,
`figures[]`/`organizations[]` entry, `branchTimeline` branch, cross-link) must
have been tried and found insufficient, and **the owner must have accepted the
split** — an agent suggests it in a ticket in the parent repo, with citations,
and never creates the repo on its own judgement. Reference that ADR (and the
accepted suggestion ticket) before step 1, and cite it in the new repo's first
ADR.

The proven sequence (used for fsspx and tl):

1. **Research.** Run parallel research on the subject: founding facts, a
   chronology of 25–40 key events with dates and places, key figures, related
   organizations (with disambiguations — what the subject is *not*), and 15–30
   public references with exact URLs. Verify primary-source URLs resolve.
   Mark everything the sources disagree on.
2. **Instantiate the template.** `tools/new-project.sh <dest> <accent colors>`
   — pick a distinct accent per subject (fsp red, fsspx blue, tl green). This
   also vendors the shared skills into `<dest>/.claude/skills/` and brings in a
   `deploy.yml` carrying both drift checks. **Confirm both arrived**, with
   `python3 tools/sync-skills.py <dest> --check` and a grep for
   `sync-skills.py . --check` in the new `deploy.yml`; the eight repos of
   2026-08-05 were bootstrapped before either happened, so ADR-0007's rules
   never reached the apparition repos they were written for (core#85). A repo
   with no vendored skills is not "clean" — it is outside the mechanism, and an
   agent opening it gets no sourcing discipline at all.
3. **Write the data.** `data/chronology.json`: `meta`, `facts[]`, `events[]`,
   `figures[]`, `organizations[]`, `disambiguation.items[]`, `references[]`.
   Every entry cited; uncertain dates flagged. Then `README.md`, `AGENTS.md`,
   `context.md` (domain background, disambiguations, glossary pointers).
   Instead of re-explaining a shared term inline, cross-link the glossary with
   an inline `[[term-id]]` (or `[[term-id|visible text]]`) marker in any prose
   field — it renders as a link to `https://cronologia.github.io/glossary/<term-id>/`.
   The validator fails on unknown ids, checked against the vendored, pinned
   `data/glossary-terms.json`; run `node scripts/sync-glossary-terms.js` to
   refresh that list when the glossary adds terms (see `template/AGENTS.md`).
4. **Verify.** `node scripts/validate-data.js && node build.js && node --test`
   — in that order. Building before testing is not a style preference: the
   suite includes a drift check comparing committed `docs/` against a fresh
   build, so running the tests first reports a failure that is really just
   stale output. Commit `docs/` with the data. Screenshot the built page
   (headless chromium) and eyeball it.
5. **Seed the preservation cache.** `node scripts/archive-refs.js`, then
   `node build.js` again, and commit `data/archives.json` with the rest.
   `wayback.yml` ships with the template but fires **weekly, on Mondays**, and
   it only ever *refreshes* a file someone else created — so a repo bootstrapped
   on a Tuesday serves no archived fallback links at all until the following
   week, and one bootstrapped without this step never gets them from CI at all.
   Every repo in the family that has an `archives.json` got it from a hand-run
   commit; CI has never created one. This step is why the older repos have
   80–100% coverage and the eight of 2026-08-05 had none. Do not add a seed file
   to the template instead — the content is per-repo, and `loadArchives()`
   already handles a missing file.
6. **Publish.** Create the GitHub repo EMPTY; push `main` as the first branch;
   only then enable Pages (Source: GitHub Actions) — the github-pages
   environment pins its allowed branch to the default branch at enable time.
   That is the whole of it; there is no second switch. The workflow deploys on
   push to main and supports manual dispatch. (There used to be an
   `ENABLE_PAGES` Actions variable as well. It was removed: with Pages on and
   the variable unset, runs reported success while the deploy silently skipped,
   and eight repos shipped green checks over sites serving 404.)
7. **Ticket the follow-up.** Open: a deep-investigation epic (every flagged
   date as a checkbox, subject-specific threads), per-figure dossier tickets,
   and a project-chats ticket. Link the portal roadmap
   (cronologia.github.io issues). **The preservation pipeline is not follow-up
   work** — it is step 5, and listing it here is how it stopped happening: the
   bootstrap epics of 2026-08-05 all carry an unchecked "run archive-refs.js"
   box, filed as a ticket and never worked, while the repos went live.

Anti-traps: repos created non-empty get the wrong default branch; the Pages
environment does not follow later default-branch changes; branch deletion and
repo settings need the human — plan for it.
