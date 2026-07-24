# ADR-0003 — Preservation and link-health run outside the build

- **Status:** accepted (2026-07-24)
- **Context repo:** `cronologia/core`
- **Relates to:** `cronologia/fsp` ADR-0004 (Wayback as the preservation layer)
  and ADR-0006 (run archiving in CI when the sandbox blocks archive.org —
  never route around egress policy); `cronologia/archive` ADR-0001 (shared
  source vault) and ADR-0002 (egress and geoblocked sources); core ADR-0002
  (network-free build)

## Context

The references *are* the product: these sites are citation chains, and a dead
link is a broken claim. So the family needs two network-touching jobs —
snapshotting every reference URL (Wayback / Save Page Now) and probing every
reference URL for rot.

Both are tempting to run inside `build.js`, where the reference list already
sits in memory. That would be wrong on three counts: it makes the build
non-deterministic (the same commit compiles differently depending on what
archive.org answered), it makes the build fail for reasons unrelated to the
data, and it puts network access on the one path that must work in a sandbox
with restricted egress.

There is also a semantic trap. A probe that returns `403` or `429` says
something about the *probe*, not about the URL: many publishers block bots and
HEAD requests outright (`sspx.org`, `vatican.va`, `catholic-hierarchy.org` — see
archive ADR-0002's register). Treating those as "dead" would delete good
citations.

## Decision

1. **The build is network-free.** `node scripts/validate-data.js`,
   `node --test` and `node build.js` never open a socket. Everything they need
   is committed (`data/*.json`, including the vendored pinned copies).
2. **Preservation is a separate script and a separate schedule.**
   `scripts/archive-refs.js` looks up an existing snapshot per
   `references[].url`, triggers polite Save Page Now captures for those without
   one (≥10s apart, capped by `ARCHIVE_MAX_SAVES`), and writes
   `data/archives.json`; `build.js` renders those as "archived" fallback links.
   `.github/workflows/wayback.yml` runs it weekly on a GitHub runner and commits
   the result — in CI precisely so no session routes around its egress policy.
3. **Link health only reports; it never edits data.**
   `scripts/check-links.js` emits a JSON + Markdown report (HTTP status via HEAD
   with a ranged-GET fallback, a `<title>`-based soft-404 heuristic, and a
   Wayback lookup). `.github/workflows/link-health.yml` runs weekly and
   opens/updates a *single* "link health" issue per repo. Correcting or
   retiring a reference is a sourcing decision made by a human or an agent with
   a citation.
4. **INCONCLUSIVE ≠ dead.** `403`, `429`, `5xx` and timeouts are inconclusive
   and are reported as such; only real `4xx` (404/410/451) count as dead. The
   same rule governs archive.org's own `403/429/520/523` responses.
5. **Priority is dead-or-suspect AND unsnapshotted.** That combination is the
   only genuinely losable state and heads the archiving queue
   (`priorityArchive`); `dataset-query.py <repo> refs --unarchived` lists the
   gaps. Sources cited by 2+ projects are vaulted in `cronologia/archive` per
   its ADR-0001; single-project sources stay in the project's own vault.

## Consequences

- A checkout builds and tests with no network, in any sandbox, forever.
- Link rot is discovered on a schedule instead of at the worst moment, and the
  discovery never mutates a dataset behind anyone's back.
- Bot-blocked publishers do not cause citation loss through false "dead" calls.
- The cost is latency: a reference archived on Monday's run is unarchived on
  Sunday. Acceptable — the original URL is still cited, and the queue is
  regenerable at any time.
