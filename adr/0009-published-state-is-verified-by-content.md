# ADR-0009 — Published state is verified by content, not by a green check

- **Status:** accepted (2026-08-06)
- **Context repo:** `cronologia/core`
- **Relates to:** ADR-0003 (preservation and link-health split); core#82,
  core#83; `.claude/skills/release-work/SKILL.md`

## Context

The delivery path has four layers, and each reports success on its own terms:

```
commit  ->  merged into main  ->  a run built it  ->  Pages served it
```

On 6 August 2026 all three joints failed, separately, in a single session.

1. **Merged, but not in `main`.** The merge API merges the PR's *recorded head*.
   Two PRs (`fatima#8`, `olavo#55`) were merged moments after a push the API had
   not yet observed, so the merge returned `"merged": true` and left the commit
   on the branch. Caught only by running
   `git merge-base --is-ancestor HEAD origin/main` across all fourteen repos —
   the live page not changing was the first symptom.
2. **In `main`, but never built.** `cimbres` merged to `a8b6fd4` and no workflow
   run was ever created for that SHA. Not queued, not failed — absent.
3. **Built, but never served.** Seven repos' `deploy` jobs timed out in
   `deployment_queued`. Verified as GitHub-side by dispatching a single
   isolated run with an empty queue, which failed identically.

None of these is exotic, and the earlier precedents rhyme. `ENABLE_PAGES` once
gated the deploy job so that eight freshly bootstrapped repos reported green
while serving 404s. `perennialism` sat red from 5 August behind three gates in
series — template drift, then vendored-skill drift — with nobody looking at a
branch nobody reads.

The common shape: **every layer's success signal is about that layer.** A green
check means the runner finished, not that a reader can see the change.

## Decision

**The only acceptable proof that work shipped is the served content.**

1. **Verify by fetching the page and matching the change**, not by reading a
   run's conclusion:

   ```
   curl -s https://cronologia.github.io/<repo>/en/ | grep -c '<a phrase from the change>'
   ```

   This is now the last step of the release ceremony, before reporting done.

2. **After any merge, assert the commit is actually in `main`** — for every
   repo in the wave, not the one whose page you happened to check:

   ```
   git merge-base --is-ancestor HEAD origin/main
   ```

3. **A merge is not assumed to have triggered a build.** If no run exists for
   `main`'s head SHA, dispatch one.

4. **Report the gap, never round it up.** "Merged and correct on `main`, not yet
   published, blocked on X" is the honest state and is more useful than
   "shipped". Never describe work as live without having fetched it.

5. **Do not stack re-runs.** Calling `rerun_failed_jobs` on a run whose deploy
   is still in flight cancels the in-flight deployment and produces a different
   error (`Deployment cancelled.`) that masks the real one. One run at a time,
   to completion.

## Consequences

- The release ceremony gets slower by one HTTP request per locale, and stops
  producing false "done" reports.
- Nothing yet **detects** a frozen site on its own: a repo whose deploy has been
  failing for a week looks exactly like one with nothing to publish. A periodic
  job comparing each site's served content against its `main` `docs/` would
  catch all three failure modes above at once, including the two that are not
  GitHub's fault. That is the open follow-up in core#83, and it is the
  monitoring counterpart to this ADR's manual discipline.
- Where a gate can silently skip the deploy step rather than fail loudly, it
  should fail loudly — the reasoning already written into `deploy.yml` when
  `ENABLE_PAGES` was removed. A gate that does nothing and calls it success is
  the failure mode this project refuses everywhere else.
