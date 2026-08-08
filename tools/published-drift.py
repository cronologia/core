#!/usr/bin/env python3
"""published-drift — does each site SERVE what its `main` branch says it should?

Why this exists
---------------
The delivery path has four layers and each reports success on its own terms:

    commit  ->  merged into main  ->  a run built it  ->  Pages served it

On 6 August 2026 all three joints failed separately in one session (core#83),
and ADR-0009 was written to record the manual discipline: verify by fetching
the page, never by reading a run's conclusion. The discipline only fires when
somebody is looking. **A repo whose deploy has been failing for a week looks
exactly like one with nothing to publish** — `perennialism` sat red from 5
August behind two drift gates with nobody watching a branch nobody reads.

This is the monitoring counterpart. It compares, for every site, the bytes the
site actually serves against the bytes committed to `main`, and fails loudly
when they differ. That single comparison catches all three of core#83's failure
modes at once, plus the two that were not GitHub's fault:

  - merged but not in `main`     -> main has the commit, the page does not
  - in `main` but never built    -> same signature
  - built but never served       -> same signature
  - deploy gated off / skipped   -> same signature
  - drift check red for days     -> same signature

It does NOT diagnose which one; it says "this site is stale, here is the page".
That is deliberate. The value is noticing at all.

How it decides
--------------
GitHub Pages serves the deployed `docs/` tree verbatim, so a live page and its
committed source are byte-identical. Verified across the family: comparing
`https://cronologia.github.io/<slug>/en/` with
`https://raw.githubusercontent.com/cronologia/<slug>/main/docs/en/index.html`
matches to the byte on a site that is up to date.

Nothing here uses api.github.com: no token, no rate limit, and the check runs
the same way from a laptop as from CI.

The site list is DISCOVERED, not listed. It comes from the portal's own served
index — the org's published statement of which sites exist. A hardcoded list is
the failure this repo keeps retiring (ADR-0008), and one that silently omitted
a repo would reintroduce exactly the blind spot this tool exists to close. The
discovered set is always printed, so an omission is visible rather than
implicit.

A freshly merged commit is legitimately not served yet while its deploy runs.
Mismatches are therefore re-checked after a grace delay before being reported,
and a run that is merely racing a deploy comes back clean on the second look.

Usage:
  python3 tools/published-drift.py                  # discover and check all
  python3 tools/published-drift.py --repos tl,rcc   # just these
  python3 tools/published-drift.py --json
  python3 tools/published-drift.py --grace 0        # no re-check (tests)

Exit status: 0 = every site serves its main; 1 = at least one is stale or
unreachable.
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request

ORG = "cronologia"
PORTAL_SLUG = "%s.github.io" % ORG
SITE_BASE = "https://%s.github.io/" % ORG
RAW_BASE = "https://raw.githubusercontent.com/%s/" % ORG
PORTAL_INDEX = SITE_BASE + "en/"
LOCALES = ("en", "es", "pt")
USER_AGENT = "cronologia-published-drift/1.0 (+https://github.com/cronologia/core)"

# A project link on the portal: /<slug>/en/ — but not the portal's own /en/.
PROJECT_LINK = re.compile(r'href="/([a-z0-9][a-z0-9.-]*)/(?:%s)/"' % "|".join(LOCALES))


def fetch(url, timeout=30):
    """-> (status, body_bytes). status is an int, or 0 when unreachable."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, b""
    except Exception:
        return 0, b""


def discover_slugs(timeout=30):
    """Project slugs the portal itself publishes, sorted. [] when unreachable."""
    status, body = fetch(PORTAL_INDEX, timeout=timeout)
    if status != 200:
        return []
    text = body.decode("utf-8", "replace")
    found = {m.group(1) for m in PROJECT_LINK.finditer(text)}
    found.discard(PORTAL_SLUG)
    return sorted(found)


def targets_for(slug):
    """[(label, served_url, raw_url)] for one site.

    The portal serves the domain root and keeps its pages at the repo root; a
    project site lives under /<slug>/ and keeps them in docs/.
    """
    if slug == PORTAL_SLUG:
        base, prefix = SITE_BASE, "%s/main/" % PORTAL_SLUG
    else:
        base, prefix = "%s%s/" % (SITE_BASE, slug), "%s/main/docs/" % slug
    out = []
    for loc in LOCALES:
        out.append((loc, "%s%s/" % (base, loc), "%s%s%s/index.html" % (RAW_BASE, prefix, loc)))
    return out


def check_target(label, served_url, raw_url, timeout=30):
    """One page -> a result dict. `stale` is only True on a real mismatch."""
    s_status, s_body = fetch(served_url, timeout=timeout)
    r_status, r_body = fetch(raw_url, timeout=timeout)
    result = {"page": label, "servedUrl": served_url, "sourceUrl": raw_url,
              "servedStatus": s_status, "sourceStatus": r_status,
              "servedBytes": len(s_body), "sourceBytes": len(r_body)}
    if s_status != 200 or r_status != 200:
        result["verdict"] = "unreachable"
        result["stale"] = True
        return result
    if s_body == r_body:
        result["verdict"] = "current"
        result["stale"] = False
        return result
    result["verdict"] = "stale"
    result["stale"] = True
    return result


def check_site(slug, timeout=30, grace=90, sleep=time.sleep):
    """Check one site, re-checking any mismatch after `grace` seconds.

    The re-check exists so a run that merely raced an in-flight deploy does not
    cry wolf; it is skipped entirely when nothing looked wrong.
    """
    results = [check_target(*t, timeout=timeout) for t in targets_for(slug)]
    if grace and any(r["stale"] for r in results):
        sleep(grace)
        results = [check_target(*t, timeout=timeout) for t in targets_for(slug)]
        for r in results:
            r["rechecked"] = True
    return {"repo": slug, "pages": results, "stale": any(r["stale"] for r in results)}


def render(report):
    slugs = report["discovered"]
    out = ["# published-drift | sites=%d | %s" % (len(slugs), report["summary"]),
           "compares each served page with %s<repo>/main/docs/<locale>/index.html" % RAW_BASE,
           "site list discovered from %s — not hardcoded" % PORTAL_INDEX,
           "fields: repo | page | verdict | served/source bytes",
           ""]
    for site in report["sites"]:
        flag = " | STALE" if site["stale"] else ""
        out.append("## %s%s" % (site["repo"], flag))
        for page in site["pages"]:
            out.append("%s | %s | %s | %d/%d%s"
                       % (site["repo"], page["page"], page["verdict"],
                          page["servedBytes"], page["sourceBytes"],
                          " (rechecked)" if page.get("rechecked") else ""))
            if page["stale"]:
                out.append("    served: %s (HTTP %s)" % (page["servedUrl"], page["servedStatus"]))
                out.append("    source: %s (HTTP %s)" % (page["sourceUrl"], page["sourceStatus"]))
        out.append("")
    out.append(report["summary"])
    if report["staleRepos"]:
        out.append("")
        out.append("A stale site is serving older content than its main branch. It is not a")
        out.append("failure of this check — it means a deploy did not reach the reader, and")
        out.append("the run that was supposed to do it may still be reporting success.")
        out.append("Start at: https://github.com/%s/<repo>/actions" % ORG)
    return "\n".join(out)


def build_report(slugs, timeout, grace, sleep=time.sleep):
    sites = [check_site(s, timeout=timeout, grace=grace, sleep=sleep) for s in slugs]
    stale = [s["repo"] for s in sites if s["stale"]]
    summary = ("all %d site(s) serve their main branch" % len(sites) if not stale
               else "%d of %d site(s) STALE: %s" % (len(stale), len(sites), ", ".join(stale)))
    return {"discovered": slugs, "sites": sites, "staleRepos": stale, "summary": summary}


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="published-drift.py",
        description="Fail when a site serves older content than its main branch.")
    ap.add_argument("--repos", help="comma-separated slugs instead of discovering")
    ap.add_argument("--timeout", type=float, default=30.0, help="per-request timeout (s)")
    ap.add_argument("--grace", type=float, default=90.0,
                    help="seconds to wait before re-checking a mismatch (0 disables)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    if args.repos:
        slugs = [s.strip() for s in args.repos.split(",") if s.strip()]
    else:
        slugs = discover_slugs(timeout=args.timeout)
        if not slugs:
            sys.stderr.write(
                "error: could not read the site list from %s.\n"
                "The portal itself may be down — which is a finding, not a reason to\n"
                "pass. Re-run with --repos to check specific sites.\n" % PORTAL_INDEX)
            return 1
        slugs.append(PORTAL_SLUG)

    report = build_report(slugs, args.timeout, args.grace)
    print(json.dumps(report, indent=1) if args.json else render(report))
    return 1 if report["staleRepos"] else 0


if __name__ == "__main__":
    sys.exit(main())
