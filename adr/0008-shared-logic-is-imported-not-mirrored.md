# ADR-0008 — Shared logic is imported, not mirrored

- **Status:** accepted (2026-08-06)
- **Context repo:** `cronologia/core`
- **Relates to:** ADR-0001 (the shared-renderer contract); ADR-0002 (vendored
  glossary and skills); core#81, core#82

## Context

`scripts/translate.js` reports which strings still need a translation and, run
without `--stats`, prunes cache keys that no longer appear in the dataset. To do
either it must know which fields `build.js` sends through the dictionaries.

It knew by keeping its own copy of `TRANSLATABLE_KEYS` and its own tree walk,
under a comment reading *"It MUST mirror build.js's set."* It did not. The copy
had drifted in both directions at once, and each direction produced a confident
wrong number:

- it skipped the whole `references` array, so the coverage count omitted every
  `publisherNote` the localized pages actually render;
- it knew nothing of `SUBTREE_TRANSLATABLE`, so it applied the general key set
  to `approvalLadder` and counted `status` — a closed enum. Acting on that
  report means translating `not-found` into `no encontrado`, which fails the
  localized build outright;
- it had never picked up `dateNote`.

Reporting was the smaller half. The prune runs against the same wrong set, so a
single mistyped flag (`--list-missing` instead of `--stats`) **deleted 44
committed Spanish translations** from `cronologia/lasalette` while printing a
coverage line that looked healthy. Recovered from git.

The comment was not ignored. Somebody read it, believed it, and shipped against
it. A convention that depends on every future editor updating two files in
lockstep is a convention that will be broken, and the breakage is silent.

## Decision

**Where two call sites must agree on a rule, one of them owns the rule and the
other imports it. Mirroring is not a design; it is a deferred defect.**

1. `build.js` exports the shared walk — `keysFor`, `collectTranslatable` —
   alongside `TRANSLATABLE_KEYS` and `SUBTREE_TRANSLATABLE`. Requiring
   `build.js` is safe: it runs `main()` only under `require.main === module`.
2. `scripts/translate.js` imports `collectTranslatable`. It holds no key list
   and no walk of its own.
3. **A test pins the two walks to the same answer.** Not "does the collector
   return the right keys" — that is a second mirror. It instruments
   `localizeData`'s dictionary lookup through a `Proxy` and asserts the two
   walks visit exactly the same set of strings. The Proxy traps
   `getOwnPropertyDescriptor`, because that is what `hasOwnProperty.call` fires;
   the test also asserts the trap fired, so it cannot pass by observing nothing.
4. **Where a repo genuinely cannot share the implementation, it mirrors its own
   renderer, not the template's.** Five repos run older `localizeData`
   generations; each got a `collectTranslatable` shaped to *its* walk. The
   invariant is not "every repo walks the same tree" but "within a repo, the
   coverage report and the renderer walk the same tree", and the same test
   holds in each.

## The corollary, learned the hard way

**A template change is a breaking change for every repo it does not reach.**

core#81 landed in the template and deliberately skipped five repos as the
conservative choice. It was not conservative. The template drift check compares
each repo's `scripts/translate.js` against the template's, so those five failed
`Template drift check` and **skipped the deploy step** — their published sites
silently stopped updating, including an unrelated fix merged an hour earlier.

The gate did exactly its job. Porting is therefore part of the change, not
follow-up work: either the change reaches every repo in the same wave, or the
difference is declared as an ADOPT point in the template, or the template is
not changed yet.

## Consequences

- Adding a key to `TRANSLATABLE_KEYS` or a subtree to `SUBTREE_TRANSLATABLE`
  is now a one-file edit that both the renderer and the reporter pick up.
- `scripts/translate.js` gained a hard dependency on `build.js` living one
  directory up. That is already true of every other script in `scripts/`.
- The same pattern applies wherever it recurs: `check-links.js` and
  `archive-refs.js` both carry a `collectReferences` under an
  `extra-reference-arrays` ADOPT point, and are the next candidates for the
  same treatment if they diverge again.
- Coverage numbers moved when the real walk was applied, and every affected
  repo turned out to be complete — the `publisherNote` strings the old report
  never counted had been translated all along. The report had been wrong, not
  the data.
