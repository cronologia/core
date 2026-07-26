---
name: preserve-sources
description: Keep cited sources reachable — Wayback snapshots, link-health reports, and what belongs in the shared archive. Use when working on references[], archiving, or a link-health report.
---

# Preserve the sources

The references *are* the product. Links rot; the snapshot is the citation of
record. Neither archiving nor link-checking ever runs inside the build — the
build is network-free (core ADR-0003).

1. **Find the gaps.**
   ```
   python3 core/tools/dataset-query.py <repo> refs --unarchived
   ```
   Lists every `references[]` entry with no snapshot in `data/archives.json`.
   A repo without an `archives.json` says so rather than reporting everything
   as unarchived.
2. **Snapshot with `scripts/archive-refs.js`.** It looks up an existing Internet
   Archive capture per `references[].url`, triggers polite Save Page Now for
   those without one (≥10s between saves, capped by `ARCHIVE_MAX_SAVES`), and
   writes `data/archives.json` — which `build.js` renders as "archived"
   fallback links. It runs weekly in `.github/workflows/wayback.yml`, on a
   GitHub runner, precisely so nobody routes around a sandbox's egress policy.
3. **Check rot with `scripts/check-links.js`.** HEAD (falling back to a ranged
   GET), a soft-404 heuristic on `<title>`, plus a Wayback lookup; JSON +
   Markdown report; weekly `link-health.yml` opens/updates one "link health"
   issue per repo. **It never edits data** — fixing a URL is a human decision.
4. **403 / 429 / 5xx / timeout are INCONCLUSIVE, not dead.** Only real 4xx
   (404/410/451) count as dead. Never delete or rewrite a reference on an
   inconclusive probe; see `net-access` for the access ladder.
5. **Prioritize dead-or-suspect AND unsnapshotted.** That combination
   (`priorityArchive` in the report) is the only genuinely losable state — every
   other row can wait. Archive those first.
6. **Route the copy correctly.** Cited by one project → the project's own
   vault. Cited by two or more → `cronologia/archive`, per its ADR-0001, with a
   manifest entry (id, title, original URL, capture date, language, citing
   projects). The archive is private: never link raw archive URLs as
   reader-facing citations — reader-facing means original URL + Wayback.
7. **Catalogue from the file, never from the URL.** Both failures of this rule
   in the family so far came from describing a capture without opening it:
   - `archive#25` — the manifest recorded the **site root**, not the post. The
     original could not be re-fetched, verified or archived, for a
     self-published contested claim about a named individual. The permalink was
     in the captured HTML the whole time (`<link rel="canonical">`, `og:url`,
     `twitter:url` all agreed): one grep.
   - `fsspx#29` — a capture was catalogued as *"a Liénart letter to Lefebvre,
     hostile frame"* because the slug read
     `du-cardinal-achille-lienart-a-mgr-marcel-lefebvre`. It contains **no
     letter**, and the piece argues the opposite of what the label implied. The
     wrong description then propagated into the ticket and into a merged
     dataset reference.

   So: **capture the permalink, not a site root, section index or search
   result** — one is a citation, the others are a page that will change. And
   write `title`, `type` and `note` from the file's contents. A URL slug is a
   guess about a document, not a reading of it.
8. **Verify fidelity while the original is still reachable.** At capture or
   recovery, diff the extracted text of the vaulted copy against the live page
   and record the result. `archive#25`'s copy came back byte-identical at
   10,017 characters, so vault and original are interchangeable as evidence —
   which is worth knowing *before* the page disappears. Afterwards it is
   usually unknowable. This is cheap (one fetch) and it is the difference
   between "we have a copy" and "we have a copy we can vouch for".
