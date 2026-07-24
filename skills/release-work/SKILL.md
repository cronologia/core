---
name: release-work
description: The delivery ceremony for a wave of work — branch, fast-forward, commit data with regenerated docs, push with retries, and describe what shipped and what was deferred. Use when finishing work in any cronologia repo.
---

# Deliver a wave of work

1. **Work on the designated branch**, and only in the repo the task names. If
   the branch is missing locally, create it from the remote base:
   `git checkout -b <branch> origin/main`.
2. **Bring it current before committing:**
   ```
   git fetch origin && git checkout <branch> && git merge --ff-only origin/main
   ```
   `--ff-only` is non-destructive. **If it cannot fast-forward, STOP and report
   it** — never `git reset --hard`, never `--force`, never rebase someone else's
   published history to make it fit.
3. **Commit data and regenerated `docs/` together**, after
   `node scripts/validate-data.js && node --test && node build.js`. One logical
   change per commit; a message that says what changed and why. End every commit
   message with the trailers the task specifies (`Co-Authored-By:` and
   `Claude-Session:`), and never put internal model identifiers in a commit
   message, a PR body or a ticket comment.
4. **One repo, one committer, per wave.** Two agents committing to the same repo
   produce conflicts nobody asked for. If a repo is held, say so and stop rather
   than working around it. `git status` in every repo you did *not* touch should
   be empty at the end — check it, and report it.
5. **Push normally, with backoff.** `git push -u origin <branch>`; on a network
   failure retry 4× at 2s/4s/8s/16s. **Never `--force`.** If the remote rejects
   because it moved, fast-forward again (step 2) and re-push.
6. **Report both halves.** A PR body or ticket comment states what shipped
   *and* what was deliberately deferred, with the reason — flags left open,
   sources that came back inconclusive, items excluded for lack of a citation.
   Silent omissions are how the next agent redoes your work. Do not open or
   merge PRs when the orchestrator owns that step.
