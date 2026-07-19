---
name: bootstrap-project
description: Bootstrap a new Cronologia chronology project from research to published site. Use when starting a new project repo in the cronologia organization.
---

# Bootstrap a Cronologia project

Load `sourcing-rules` first. The proven sequence (used for fsspx and tl):

1. **Research.** Run parallel research on the subject: founding facts, a
   chronology of 25–40 key events with dates and places, key figures, related
   organizations (with disambiguations — what the subject is *not*), and 15–30
   public references with exact URLs. Verify primary-source URLs resolve.
   Mark everything the sources disagree on.
2. **Instantiate the template.** `tools/new-project.sh <dest> <accent colors>`
   — pick a distinct accent per subject (fsp red, fsspx blue, tl green).
3. **Write the data.** `data/chronology.json`: `meta`, `facts[]`, `events[]`,
   `figures[]`, `organizations[]`, `disambiguation.items[]`, `references[]`.
   Every entry cited; uncertain dates flagged. Then `README.md`, `AGENTS.md`,
   `context.md` (domain background, disambiguations, glossary pointers).
4. **Verify.** `node scripts/validate-data.js && node --test && node build.js`
   — commit `docs/` with the data. Screenshot the built page (headless
   chromium) and eyeball it.
5. **Publish.** Create the GitHub repo EMPTY; push `main` as the first branch;
   only then enable Pages (Source: GitHub Actions) — the github-pages
   environment pins its allowed branch to the default branch at enable time —
   and set the Actions variable `ENABLE_PAGES=true`. The workflow deploys on
   push to main and supports manual dispatch.
6. **Ticket the follow-up.** Open: a deep-investigation epic (every flagged
   date as a checkbox, subject-specific threads, porting the preservation
   pipeline), per-figure dossier tickets, and a project-chats ticket. Link the
   portal roadmap (cronologia.github.io issues).

Anti-traps: repos created non-empty get the wrong default branch; the Pages
environment does not follow later default-branch changes; branch deletion and
repo settings need the human — plan for it.
