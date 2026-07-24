# ADR-0002 — Vendored pinned copies (glossary ids, skills) instead of live fetches

- **Status:** accepted (2026-07-24)
- **Context repo:** `cronologia/core`
- **Relates to:** ADR-0001 (shared-renderer contract); ADR-0003 (network-free
  build); `cronologia/glossary`

## Context

Sites cross-link the shared glossary with inline `[[term-id]]` markers instead
of re-explaining a term in every project. The validator must reject an id that
does not exist — a broken cross-link is a 404 on a citation-bearing page. The
obvious implementation is to fetch the glossary's term list at build time.

The same shape appears again for **skills**: the working method lives in
`core/skills/`, but an agent working inside `cronologia/fsspx` only discovers
skills present in that checkout. A live fetch (or a git submodule) would make
every project's tooling depend on the network and on core's current `main`.

Fetching at build time would mean: a build that fails when GitHub is slow, a
build whose result depends on *when* it ran, no way to build offline or in a
sandbox with restricted egress, and a validator whose verdict on an unchanged
dataset can change without a commit.

## Decision

Shared inputs are **vendored as pinned, committed copies, refreshed by an
explicit script, never hand-edited**:

1. **`data/glossary-terms.json`** — the pinned list of glossary term ids, with
   `syncedFrom` / `syncedAt` and a `_comment` saying it is generated. Written by
   `node scripts/sync-glossary-terms.js` (out-of-band, network-touching);
   `scripts/validate-data.js` checks every `[[term-id]]` against it offline.
2. **`.claude/skills/<name>/SKILL.md`** — vendored copies of `core/skills/`,
   written by `python3 core/tools/sync-skills.py <repo>`, with a
   `.claude/skills/_synced.json` manifest (source repo, skill names, content
   hashes, sync date, the GENERATED note). `--check` writes nothing and exits
   non-zero when a target has drifted, so CI or an agent detects a stale copy.
3. **The copy is part of the diff.** Refreshing is a commit, reviewable like any
   other change: you can see exactly which term ids or which skill text a build
   was validated against.
4. **Edits go upstream.** A vendored file is never edited in the consuming repo;
   fix it in `cronologia/glossary` or `cronologia/core` and re-sync.

## Consequences

- The build is deterministic and offline: the same commit validates and compiles
  identically today, in CI, and in a year.
- Cost: the pinned copies go stale. That is deliberate and visible — staleness
  is detected by `--check` (skills) and by a failing `[[term-id]]` validation
  after the glossary renames an id, and fixed by a one-line script run.
- Projects never depend on core's or the glossary's `main` at build time; they
  depend on a specific committed snapshot they chose.
- The pattern generalizes: any future shared input (schemas, style tokens) is
  vendored the same way rather than fetched.
