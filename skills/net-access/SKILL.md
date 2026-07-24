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
2. **Diagnose the failure — the two modes need different fixes.**
   - *UA / bot filtering*: 403/406 to a fetch tool, **200 to a browser
     User-Agent**. Retry with `curl -A` and a desktop-browser UA. Known:
     `grupodepuebla.org` (406), `sspx.org`, `fsspx.news`, `vatican.va`,
     `press.vatican.va` — all header artifacts, not blocks.
   - *Country gating*: refuses by client-IP country regardless of UA —
     Cloudflare "Attention Required" 403 or a connection reset. Known:
     `forodesaopaulo.org` (US blocked, BR allowed). No UA fixes this.
3. **Wayback.** For country-gated pages, the archive.org crawler reaches what
   our egress cannot. `https://archive.org/wayback/available?url=…` and
   `https://web.archive.org/save/…` both work from a session; **direct
   `web.archive.org` page reads are blocked by egress policy** — use the
   availability API for existence and the live URL or a vaulted copy for text.
4. **Treat 403 / 429 / 520 / 523 as INCONCLUSIVE**, never as "dead" or
   "doesn't exist". Note the status and the date, move on, and leave any
   dependent claim flagged (`sourcing-rules` #1). Throttle and retry rate
   limits (`catholic-hierarchy.org` 429); retry transient 5xx later.
5. **Escape hatch: out-of-band capture, then vault.** When a live fetch from a
   specific country is genuinely required, the owner (or a CI runner with the
   right egress) captures it outside the session and commits it to
   `cronologia/archive` under `webcaptures/` with a manifest entry. The session
   consumes the vaulted copy. Standing needs are an environment-configuration
   decision, raised with the owner — not an in-session fix.

Record what you learned: a newly diagnosed host belongs in ADR-0002's
per-site register, with the failure, the cause and the lowest rung that works.
