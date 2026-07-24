---
name: ingest-report
description: Turn research reports posted as ticket comments into dataset entries. Use when a ticket carries research findings that should become facts, events, figures or references.
---

# Ingest a research report

Load `sourcing-rules` and `data-edit` first. A report is a *proposal*, not a
source. Nothing enters a dataset because a report says so.

1. **Read the reports in full**, including their caveats section. Note what each
   one marked verified, what it marked paywalled, single-source, contested or
   unreachable, and which sources it actually consulted.
2. **Ingest only what the report marked verified with a named source.** For each
   candidate: is there a `references[]` entry (existing or new) with a real URL
   or bibliographic record? If not, it does not enter — or it enters flagged
   (`dateVerified: false`, `"(to verify)"`), never silently.
3. **Spot-check the load-bearing citations yourself.** The dates a whole section
   hangs on, the numbers, the direct quotes: open the cited source (the
   `net-access` ladder if it 403s) and confirm it says what the report says it
   says. Reports paraphrase, and paraphrase drifts.
4. **Use the report's exact attribution language.** If it wrote "the DDF decree
   of 2 July 2026 declares…", keep that framing; do not compress an attributed
   claim into a bare assertion, and do not upgrade "reportedly" to "was".
5. **Leave the rest out, and say so.** Unverified, paywalled-and-unread, or
   single-source-and-contested items stay out of the dataset. List them
   explicitly in the ticket comment so the exclusion is a recorded decision
   rather than a silent omission.
6. **Record conflicts, don't resolve them.** Two sources disagreeing on a date
   is a *fact about the sources*: state both, attributed and dated
   (`sourcing-rules` #4), and flag the field. Preference is not evidence.
7. **Then follow `data-edit`**: query for existing records first (a report often
   duplicates something already present — enrich the record, don't append a
   second one), edit, validate + test + build, commit data with regenerated
   `docs/`, and reply on the ticket with what landed, what was deferred and why.

**Serialize.** Exactly one agent owns a repo's dataset at a time. If another
wave holds it, queue the ingest instead of racing it.
