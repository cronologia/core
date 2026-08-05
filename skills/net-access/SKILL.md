---
name: net-access
description: The access ladder for blocked, geoblocked or bot-filtered sources. Use when a fetch returns 403/406/429 or a connection reset, or before citing a source known to be hard to reach.
---

# Reach a blocked source

Policy of record: `cronologia/archive` ADR-0002 (read it — it carries the
per-site register). A session's egress is a **US datacenter IP behind a
pre-configured proxy**. Never route around it: no VPN, no tunnel, no direct
connection. That is not a workaround, it is the one prohibited move.

1. **Check the vault first.** `/home/user/archive` (`transcripts/`,
   `webcaptures/`, per-collection `index.json`) and the project's own vault
   often already hold the page. A vaulted copy beats any fetch, costs nothing
   and is the citation of record anyway.
2. **Diagnose the failure — five modes, different fixes. Three are not
   networking problems at all, so stop retrying and escalate or record.**
   - *UA / bot filtering*: 403/406 to a fetch tool, **200 to a browser
     User-Agent**. Retry with `curl -A` and a desktop-browser UA. Known:
     `grupodepuebla.org` (406), `sspx.org`, `fsspx.news`, `vatican.va`,
     `press.vatican.va` — all header artifacts, not blocks.
   - *Country gating*: refuses by client-IP country regardless of UA —
     Cloudflare "Attention Required" 403 or a connection reset. Known:
     `forodesaopaulo.org` (US blocked; Brazil confirmed working by owner
     test — other Latin American exits are untested but worth trying first
     when more convenient; a new working exit goes in ADR-0002's register).
     No UA fixes this.
   - *Login-walled*: **302 → a login page** for any anonymous client, and
     usually **no Wayback snapshot** (crawlers can't reach it either). Known:
     `facebook.com/story.php`. Nothing technical fixes this — go to rung 5.
   - *Withdrawn / dark*: `details` 404s but `archive.org/metadata/<id>` returns
     `"is_dark": true`. The item was taken out of public access. Do **not**
     report it as "not found" — record it as withdrawn, dated. That is
     provenance, not a transport error.
   - *Publisher bot-wall*: scholarly platforms front content with Cloudflare
     ("Just a moment…") plus a paywall. Known: `academic.oup.com`. Citation-
     and abstract-level metadata is obtainable via search; **full text is not —
     never imply you read it.**
3. **Wayback.** For country-gated pages, the archive.org crawler reaches what
   our egress cannot. `https://archive.org/wayback/available?url=…` and
   `https://web.archive.org/save/…` both work from a session; **direct
   `web.archive.org` page reads are blocked by egress policy** — use the
   availability API for existence and the live URL or a vaulted copy for text.
4. **Treat 403 / 429 / 520 / 523 as INCONCLUSIVE**, never as "dead" or
   "doesn't exist". Note the status and the date, move on, and leave any
   dependent claim flagged (`sourcing-rules` #1). Throttle and retry rate
   limits (`catholic-hierarchy.org` 429); retry transient 5xx later.
5. **Out-of-band capture, then vault — a routine procedure, not a last resort.**
   When no session-reachable path exists (country-gated, login-walled, or
   Wayback-uncapturable), whoever *does* have the access captures it outside
   the session: the owner's own device — a Latin American VPN exit for FSP
   (Brazil is the tested one; any exit the site serves works), a logged-in
   browser for a Facebook post — or a CI runner. The artifact is committed to
   `cronologia/archive` under `webcaptures/` with a manifest entry, and the
   session consumes the vaulted copy. **Ask the owner** rather than assuming
   the source is lost.
   - Any faithful format counts — saved HTML, PDF, or a **screenshot** when the
     platform yields nothing else. Say which it is in the manifest.
   - Transcribe the load-bearing text into the manifest note so the claim is
     greppable without opening an image, record `capturedBy`, and flag anything
     in the captured content that conflicts with better sources.
   - Standing needs are an environment-configuration decision raised with the
     owner — not an in-session fix.

**Say which mode it was.** "Could not fetch" is not a finding. "Login-walled,
captured out-of-band 2026-07-24" and "withdrawn (`is_dark`), observed
2026-07-24" are — unreachability is itself provenance and belongs in the
record, in the ticket and in the manifest.

Record what you learned: a newly diagnosed host belongs in ADR-0002's
per-site register, with the failure, the cause and the lowest rung that works.
