#!/usr/bin/env python3
"""dataset-query — answer one question about a dataset without reading it all.

A project's `data/chronology.json` is ~16k tokens; the glossary is similar. An
agent that needs one date, one figure or the list of unarchived references
should not have to load the whole file. This prints the answer, compactly, with
a locator (`events[12]`) so the agent can open exactly that record if it needs
the full text.

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, READ-ONLY —
it never writes to any dataset.

Supports both dataset shapes, detected by which file exists:
  chronology  data/chronology.json — facts, events, figures, organizations,
              disambiguation, lineage/episcopalLineage, branchTimeline,
              numbersChart, references
  glossary    data/glossary.json   — terms, references
"""

import argparse
import json
import os
import re
import sys
import unicodedata

KNOWN_REPOS = ("fsspx", "tariqa", "perennialism", "rcc", "glossary")


def family_root():
    env = os.environ.get("CRONOLOGIA_HOME")
    if env:
        return env
    here = os.path.abspath(__file__)
    return os.path.dirname(os.path.dirname(os.path.dirname(here)))


def resolve_repo(name):
    """A bare repo name ('fsspx') or a path -> the repo directory."""
    if os.path.isdir(os.path.join(name, "data")):
        return os.path.abspath(name)
    candidate = os.path.join(family_root(), name)
    if os.path.isdir(candidate):
        return candidate
    return os.path.abspath(name)


def dataset_path(repo):
    """(path, kind) for a repo dir; kind is 'chronology' or 'glossary'."""
    for filename, kind in (("chronology.json", "chronology"),
                           ("glossary.json", "glossary")):
        path = os.path.join(repo, "data", filename)
        if os.path.exists(path):
            return path, kind
    return None, None


def load_dataset(repo):
    path, kind = dataset_path(repo)
    if not path:
        raise IOError("no data/chronology.json or data/glossary.json in %s"
                      % repo)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh), kind


def load_archives(repo):
    """Wayback snapshot map (url -> snapshot) or {} when absent."""
    path = os.path.join(repo, "data", "archives.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return data.get("snapshots", data) if isinstance(data, dict) else {}


# --------------------------------------------------------------------------
# record walking / formatting
# --------------------------------------------------------------------------


def iter_records(data):
    """Yield (collection, locator, record) for every addressable record.

    Covers the list collections plus the dict sections (disambiguation items,
    lineage/branchTimeline/numbersChart entries) so `find` sees everything.
    """
    for name in ("facts", "events", "figures", "organizations", "references",
                 "terms"):
        for i, rec in enumerate(data.get(name) or []):
            if isinstance(rec, dict):
                yield name, "%s[%d]" % (name, i), rec
    for name in ("disambiguation", "lineage", "episcopalLineage",
                 "branchTimeline", "numbersChart"):
        section = data.get(name)
        if not isinstance(section, dict):
            continue
        for key, value in sorted(section.items()):
            if isinstance(value, dict):
                yield name, "%s.%s" % (name, key), value
            elif isinstance(value, list):
                for i, rec in enumerate(value):
                    if isinstance(rec, dict):
                        yield name, "%s.%s[%d]" % (name, key, i), rec


def record_id(rec):
    for key in ("id", "title", "name", "term", "label", "heading"):
        value = rec.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "-"


def record_date(rec):
    for key in ("date", "dates", "year", "founded", "start"):
        if rec.get(key) not in (None, ""):
            return str(rec[key])
    return "-"


def record_text(rec):
    """Concatenated free text of a record (values only, no keys)."""
    out = []

    def walk(value):
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(rec)
    return " ".join(out)


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def snippet(text, keyword, width=140):
    flat = " ".join(text.split())
    hay, needle = deaccent(flat).lower(), deaccent(keyword).lower()
    pos = hay.find(needle)
    if pos < 0:
        return flat[:width] + ("…" if len(flat) > width else "")
    lo = max(0, pos - width // 3)
    hi = min(len(flat), pos + len(keyword) + (2 * width) // 3)
    return ("…" if lo else "") + flat[lo:hi] + ("…" if hi < len(flat) else "")


def clip(text, width=200):
    flat = " ".join(str(text).split())
    return flat if len(flat) <= width else flat[:width - 1] + "…"


# --------------------------------------------------------------------------
# unverified rule — shared with unverified-report.py
# --------------------------------------------------------------------------

FLAG_PHRASES = ("(to verify)", "to verify", "to confirm", "unverified",
                "(a verificar)", "por verificar")
FLAG_RE = re.compile("|".join(re.escape(p) for p in FLAG_PHRASES), re.I)


def flagged_fields(rec):
    """[(field, reason, value)] for every unverified marker in a record.

    The rule (one place, used by dataset-query and unverified-report):
      * `dateVerified: false`  * `verified: false`
      * any string containing "(to verify)" / "to confirm" / "unverified"
    """
    found = []

    def walk(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                sub = "%s.%s" % (path, key) if path else key
                if key in ("dateVerified", "verified") and value is False:
                    found.append((sub, "%s:false" % key, ""))
                else:
                    walk(value, sub)
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, "%s[%d]" % (path, i))
        elif isinstance(node, str):
            m = FLAG_RE.search(node)
            if m:
                found.append((path, "text:%s" % m.group(0).lower(),
                              clip(node, 120)))
    walk(rec, "")
    return found


# --------------------------------------------------------------------------
# subcommands
# --------------------------------------------------------------------------


def cmd_find(data, kind, args):
    keyword = args.args[0] if args.args else ""
    if not keyword:
        raise ValueError("find needs a keyword")
    needle = deaccent(keyword).lower()
    rows = []
    for collection, locator, rec in iter_records(data):
        text = record_text(rec)
        if needle in deaccent(text).lower():
            rows.append({"collection": collection, "locator": locator,
                         "id": record_id(rec), "date": record_date(rec),
                         "snippet": snippet(text, keyword)})
    return rows, ["locator", "date", "id", "snippet"]


def parse_year_range(spec):
    m = re.match(r"^\s*(\d{3,4})\s*(?:[-:]\s*(\d{3,4}))?\s*$", spec or "")
    if not m:
        raise ValueError("year must be YYYY or YYYY-YYYY, got %r" % spec)
    lo = int(m.group(1))
    return lo, int(m.group(2)) if m.group(2) else lo


def event_year(rec):
    if isinstance(rec.get("year"), int):
        return rec["year"]
    m = re.search(r"\b(\d{3,4})\b", str(rec.get("year") or rec.get("date") or ""))
    return int(m.group(1)) if m else None


def cmd_event(data, kind, args):
    lo, hi = parse_year_range(args.args[0] if args.args else "")
    rows = []
    for i, rec in enumerate(data.get("events") or []):
        year = event_year(rec)
        if year is None or not (lo <= year <= hi):
            continue
        rows.append({"locator": "events[%d]" % i, "date": record_date(rec),
                     "verified": "y" if rec.get("dateVerified") else "N",
                     "id": record_id(rec), "place": rec.get("place", "-"),
                     "sources": ",".join(rec.get("sources") or []) or "-",
                     "text": clip(rec.get("text", ""))})
    return rows, ["locator", "date", "verified", "id", "place", "sources",
                  "text"]


def cmd_figure(data, kind, args):
    needle = deaccent(args.args[0] if args.args else "").lower()
    if not needle:
        raise ValueError("figure needs a name")
    rows = []
    for collection in ("figures", "organizations"):
        for i, rec in enumerate(data.get(collection) or []):
            name = rec.get("name", "")
            if needle not in deaccent(name).lower():
                continue
            rows.append({
                "locator": "%s[%d]" % (collection, i),
                "name": name,
                "dates": rec.get("dates") or rec.get("founded") or "-",
                "country": rec.get("country") or rec.get("place") or "-",
                "sources": ",".join(rec.get("sources") or []) or "-",
                "role": clip(rec.get("role") or rec.get("relation") or "", 400),
            })
    return rows, ["locator", "name", "dates", "country", "sources", "role"]


def cmd_refs(data, kind, args, archives=None):
    archives = archives or {}
    rows = []
    for i, rec in enumerate(data.get("references") or []):
        url = rec.get("url", "")
        archived = url in archives
        if args.unarchived and archived:
            continue
        rows.append({"locator": "references[%d]" % i, "id": rec.get("id", "-"),
                     "type": rec.get("type", "-"),
                     "archived": "y" if archived else "N",
                     "publisher": rec.get("publisher", "-"),
                     "title": clip(rec.get("title", ""), 90), "url": url})
    return rows, ["locator", "id", "type", "archived", "publisher", "title",
                  "url"]


def cmd_unverified(data, kind, args):
    rows = []
    for collection, locator, rec in iter_records(data):
        for field, reason, value in flagged_fields(rec):
            rows.append({"locator": locator, "id": record_id(rec),
                         "field": field or "-", "reason": reason,
                         "value": value or "-"})
    return rows, ["locator", "id", "field", "reason", "value"]


def cmd_stats(data, kind, args, archives=None):
    archives = archives or {}
    rows = []
    for name, value in sorted(data.items()):
        if isinstance(value, list):
            rows.append({"collection": name, "count": len(value), "note": "-"})
        elif isinstance(value, dict) and name != "meta":
            inner = sum(len(v) for v in value.values() if isinstance(v, list))
            rows.append({"collection": name, "count": len(value),
                         "note": "keys; %d nested items" % inner})
    years = [y for y in (event_year(e) for e in data.get("events") or [])
             if y is not None]
    if years:
        rows.append({"collection": "events.years", "count": len(years),
                     "note": "%d–%d" % (min(years), max(years))})
    refs = data.get("references") or []
    if refs:
        missing = sum(1 for r in refs if r.get("url") not in archives)
        rows.append({"collection": "references.unarchived", "count": missing,
                     "note": "of %d (data/archives.json)" % len(refs)})
    flags = sum(len(flagged_fields(rec)) for _, _, rec in iter_records(data))
    rows.append({"collection": "unverified.flags", "count": flags,
                 "note": "see `unverified`"})
    return rows, ["collection", "count", "note"]


SUBCOMMANDS = {
    "find": (cmd_find, ("chronology", "glossary"), "<keyword>"),
    "event": (cmd_event, ("chronology",), "<year|year-year>"),
    "figure": (cmd_figure, ("chronology",), "<name>"),
    "refs": (cmd_refs, ("chronology", "glossary"), "[--unarchived]"),
    "unverified": (cmd_unverified, ("chronology", "glossary"), ""),
    "stats": (cmd_stats, ("chronology", "glossary"), ""),
}


def render(rows, fields):
    out = []
    for row in rows:
        out.append(" | ".join(str(row.get(f, "-")) for f in fields))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="dataset-query.py",
        description="Query one Cronologia dataset (chronology or glossary) "
                    "without loading the whole file. Read-only.",
        epilog="repo may be a path or a bare name (%s). Subcommands: %s"
               % (", ".join(KNOWN_REPOS),
                  "; ".join("%s %s" % (k, v[2]) for k, v in
                            sorted(SUBCOMMANDS.items()))))
    ap.add_argument("repo", help="repo path or name (fsspx, glossary, …)")
    ap.add_argument("subcommand", choices=sorted(SUBCOMMANDS))
    ap.add_argument("args", nargs="*", help="subcommand argument")
    ap.add_argument("--unarchived", action="store_true",
                    help="refs: only references with no Wayback snapshot")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args(argv)

    repo = resolve_repo(args.repo)
    try:
        data, kind = load_dataset(repo)
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("dataset-query: %s\n" % exc)
        return 1

    handler, kinds, _usage = SUBCOMMANDS[args.subcommand]
    if kind not in kinds:
        sys.stderr.write("dataset-query: '%s' does not apply to a %s dataset "
                         "(supported: %s)\n"
                         % (args.subcommand, kind,
                            ", ".join(k for k, v in sorted(SUBCOMMANDS.items())
                                      if kind in v[1])))
        return 2

    try:
        if args.subcommand in ("refs", "stats"):
            rows, fields = handler(data, kind, args, load_archives(repo))
        else:
            rows, fields = handler(data, kind, args)
    except ValueError as exc:
        sys.stderr.write("dataset-query: %s\n" % exc)
        return 2

    if args.json:
        print(json.dumps({"repo": os.path.basename(repo), "kind": kind,
                          "subcommand": args.subcommand, "count": len(rows),
                          "fields": fields, "rows": rows},
                         ensure_ascii=False, indent=1))
        return 0
    print("# %s %s | kind=%s | rows=%d" % (os.path.basename(repo),
                                           args.subcommand, kind, len(rows)))
    if (args.subcommand in ("refs", "stats")
            and not os.path.exists(os.path.join(repo, "data",
                                                "archives.json"))):
        print("note: no data/archives.json in this repo — every reference "
              "reads as unarchived (run scripts/archive-refs.js in CI)")
    print("fields: " + " | ".join(fields))
    if rows:
        print(render(rows, fields))
    return 0


if __name__ == "__main__":
    sys.exit(main())
