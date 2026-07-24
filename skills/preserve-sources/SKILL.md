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
