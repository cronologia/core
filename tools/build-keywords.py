#!/usr/bin/env python3
"""build-keywords — generate the mechanical half of a project's KEYWORDS.md.

Why this exists (measured, not remembered — counts taken from the COF corpus
in cronologia/archive: 592 files, ~7.0M words):

    "FSSPX"                  -> 0 files          "SSPX"      -> 0 files
    "Sociedade de São Pio X" -> 3 files          "São Pio X" -> 6 files
    "Monsenhor Lefebvre"     -> 3 files          "Lefebvre"  -> 7 files
    "Lefebre" -> 2 files     "Lefevre" -> 1 file  "Econe"    -> 1 file

An agent that greps the obvious acronym concludes the corpus has no SSPX
content; there are six-plus files. And the obvious spelling also *misranks*:
COF081 says "Lefebvre" exactly once in ~18k words while COF138 — the densest
file — says it four times. The negative results and the misspellings are the
valuable part of a keyword list; the obvious names are the cheap part.

So each project keeps a KEYWORDS.md with two halves:

    hand-written   dead terms, ASR spellings, corpus-specific traps, which
                   file is actually dense on what — judgement, not data
    generated      every subject name, person, alias, organization, glossary
                   term and the date window — all of it already in data/

This tool writes the generated half between BEGIN/END markers and preserves
everything outside them, so both halves live in one regenerable file.

Everything it emits was read out of the dataset it was pointed at: no variant
is inferred, transliterated or remembered. A spelling that appears nowhere in
the data belongs in the hand-written half, with a note on where it was seen.

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, and it
never writes to any dataset — its only output is stdout or the --out Markdown
file.

Both dataset shapes are supported, detected as dataset-query.py detects them:
  chronology  data/chronology.json — meta, figures, organizations, events, …
  glossary    data/glossary.json   — meta, terms (term + variants), references
"""

import argparse
import importlib.util
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWN_REPOS = ("fsspx", "tariqa", "perennialism", "rcc", "glossary")

# The contract with the hand-written half. Keep these strings stable: an
# existing KEYWORDS.md is spliced on them, and everything outside survives.
BEGIN_MARKER = "<!-- BEGIN GENERATED build-keywords.py -->"
END_MARKER = "<!-- END GENERATED build-keywords.py -->"

GLOSSARY_BASE = "https://cronologia.github.io/glossary/"

_dq = None


def dq():
    """dataset-query.py as a module (repo resolution + dataset loading)."""
    global _dq
    if _dq is None:
        path = os.path.join(HERE, "dataset-query.py")
        spec = importlib.util.spec_from_file_location("dataset_query", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _dq = module
    return _dq


# --------------------------------------------------------------------------
# pure helpers — name surfaces
# --------------------------------------------------------------------------

PAREN_RE = re.compile(r"\(([^)]*)\)")
DASH_SPLIT_RE = re.compile(r"\s+[—–]\s+|\s+-\s+")
SLASH_SPLIT_RE = re.compile(r"\s+/\s+")
COMMA_SPLIT_RE = re.compile(r"\s*,\s*")
YEAR_RE = re.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b")


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def dedupe(values):
    """Order-preserving dedupe on an accent- and case-insensitive key."""
    seen, out = set(), []
    for value in values:
        value = " ".join((value or "").split())
        key = deaccent(value).lower()
        if key and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def has_upper(s):
    return any(c.isupper() for c in s)


def slash_parts(part):
    """['Joseph Ratzinger', 'Benedict XVI'] — but only when every side reads
    as a name (starts uppercase), so 'Foundation … / journal Sophia' stays
    whole rather than yielding the fragment 'journal Sophia'."""
    pieces = [p.strip() for p in SLASH_SPLIT_RE.split(part) if p.strip()]
    if len(pieces) > 1 and all(p[:1].isupper() for p in pieces):
        return pieces
    return []


def comma_list(part):
    """A single field holding several people ('A B, C D, E F, G H') -> each.

    Requires 3+ comma-separated pieces of 2+ capitalized-initial words, so an
    ordinary name with a comma in it is never chopped in half.
    """
    pieces = [p.strip() for p in COMMA_SPLIT_RE.split(part) if p.strip()]
    if len(pieces) >= 3 and all(len(p.split()) >= 2 and p[:1].isupper()
                                for p in pieces):
        return pieces
    return []


def search_variants(name):
    """Surface forms of an entity name that are worth searching for.

    'René Guénon (Abd al-Wahid Yahya)' -> the full name + 'Abd al-Wahid Yahya'
    'FSSP — Priestly Fraternity of Saint Peter' -> both sides of the dash
    'Joseph Ratzinger / Benedict XVI'          -> both names

    A parenthetical is kept only when it contains an uppercase letter, so a
    descriptor ('Tariqa Alawiyya (parent order)') does not masquerade as an
    alias. Every string returned is a substring of the name as the dataset
    writes it — nothing is expanded, transliterated or guessed. Unlike
    xref.name_variants, which builds *match keys*, this is conservative about
    splitting: the output is a list of strings to grep for, and half a name is
    a bad search term.
    """
    name = " ".join((name or "").split())
    if not name:
        return []
    out = [name]
    aliases = [m.group(1).strip() for m in PAREN_RE.finditer(name)]
    base = " ".join(PAREN_RE.sub(" ", name).split())
    parts = [p.strip() for p in DASH_SPLIT_RE.split(base) if p.strip()]
    if len(parts) > 1:
        out.extend(parts)
    elif base and base != name:
        out.append(base)
    for part in (parts if len(parts) > 1 else [base]):
        out.extend(slash_parts(part))
        out.extend(comma_list(part))
    out.extend(a for a in aliases if has_upper(a))
    return dedupe(out)


def paren_terms(text, max_len=60):
    """Name-shaped fragments inside parentheses of a prose field.

    meta.description '… (Society of Saint Pius X, SSPX/FSSPX) …'
        -> ['Society of Saint Pius X', 'SSPX', 'FSSPX']
    A fragment is kept only if it carries an uppercase letter, so
    '(1970–present)' and '(to verify)' drop out.
    """
    out = []
    for match in PAREN_RE.finditer(text or ""):
        for piece in re.split(r"\s*[,/;]\s*", match.group(1)):
            piece = " ".join(piece.split()).strip(" .")
            if 2 <= len(piece) <= max_len and has_upper(piece):
                out.append(piece)
    return dedupe(out)


# --------------------------------------------------------------------------
# pure helpers — glossary markers and the generated-block splice
# --------------------------------------------------------------------------

# Mirrors build.js GLOSSARY_MARKER: [[term-id]] or [[term-id|visible text]].
MARKER_RE = re.compile(r"\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\]|]*))?\]\]")


def find_markers(text):
    """[(term-id, visible text or '')] for every [[…]] marker in a string."""
    if not isinstance(text, str) or "[[" not in text:
        return []
    return [(m.group(1), " ".join((m.group(2) or "").split()))
            for m in MARKER_RE.finditer(text)]


def walk_strings(node, path=""):
    """(dotted/indexed path, string) for every string anywhere in the data."""
    if isinstance(node, dict):
        for key, value in node.items():
            for item in walk_strings(value,
                                     "%s.%s" % (path, key) if path else key):
                yield item
    elif isinstance(node, list):
        for i, value in enumerate(node):
            for item in walk_strings(value, "%s[%d]" % (path, i)):
                yield item
    elif isinstance(node, str):
        yield path, node


def merge_generated(existing, block):
    """Splice `block` into `existing`, preserving everything outside markers.

    Returns (text, status): 'replaced' when the file already had a generated
    block, 'appended' when it had none. Unbalanced or out-of-order markers
    raise ValueError rather than risk mangling a hand-written file.
    """
    start = existing.find(BEGIN_MARKER)
    end = existing.find(END_MARKER)
    if start < 0 and end < 0:
        head = existing.rstrip("\n")
        return (head + "\n\n" if head else "") + block, "appended"
    if start < 0 or end < 0:
        raise ValueError("file has one generated marker but not the other "
                         "(need both %s and %s) — fix it by hand"
                         % (BEGIN_MARKER, END_MARKER))
    if end < start:
        raise ValueError("END marker appears before BEGIN marker — fix it "
                         "by hand")
    return (existing[:start] + block + existing[end + len(END_MARKER):],
            "replaced")


# --------------------------------------------------------------------------
# collection
# --------------------------------------------------------------------------

NAME_KEYS = ("title", "shortTitle", "shortName", "altTitle", "altTitles",
             "altNames", "alternateNames", "otherNames", "aka", "nativeName",
             "names")
PROSE_KEYS = ("subtitle", "description")
PLACE_KEYS = ("place", "country", "location", "birthplace")
# "<subject> — Cronologia" is the family's own title suffix, a house artifact
# rather than a name anyone searches the subject by; drop it from the split.
TITLE_SUFFIXES = ("cronologia",)


def as_strings(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [v for v in value if isinstance(v, str)]
    return []


def collect_subject_names(meta):
    """[{term, source}] — what this project's subject is called, per meta."""
    meta = meta or {}
    rows, seen = [], set()

    def add(term, source):
        key = deaccent(" ".join(term.split())).lower()
        if key in TITLE_SUFFIXES:
            return
        if key and key not in seen:
            seen.add(key)
            rows.append({"term": " ".join(term.split()), "source": source})

    for key in NAME_KEYS:
        for value in as_strings(meta.get(key)):
            for variant in search_variants(value):
                add(variant, "meta.%s" % key)
    for key in PROSE_KEYS:
        for value in as_strings(meta.get(key)):
            for term in paren_terms(value):
                add(term, "meta.%s (parenthetical)" % key)
    return rows


def site_url(meta):
    url = (meta or {}).get("siteUrl") or ""
    return url if not url or url.endswith("/") else url + "/"


def collect_entities(data, collection, base):
    """[{name, locator, id, url, variants}] for figures[] or organizations[].

    A figure `id` is the slug of its own page (figures/<id>.html, ADR-0003), so
    it is both a permanent URL and a searchable handle for the record.
    """
    rows = []
    for i, rec in enumerate(data.get(collection) or []):
        if not isinstance(rec, dict):
            continue
        name = rec.get("name") or ""
        if not name.strip():
            continue
        variants = search_variants(name)
        ident = rec.get("id") or ""
        url = ""
        if ident and base and collection == "figures":
            url = "%sfigures/%s.html" % (base, ident)
        rows.append({"name": variants[0], "locator": "%s[%d]" % (collection, i),
                     "id": ident, "url": url, "variants": variants[1:]})
    return rows


def load_vendored_terms(repo):
    """(set of pinned term ids, glossary base url) from data/glossary-terms.json.

    The vendored file is the pinned id list the build validates markers against
    (ADR-0002); it carries ids and a baseUrl, and — should it ever carry
    objects — an id/term pair, which is used as the display name when present.
    """
    path = os.path.join(repo, "data", "glossary-terms.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}, ""
    base = data.get("baseUrl") or "" if isinstance(data, dict) else ""
    entries = data.get("terms") if isinstance(data, dict) else data
    out = {}
    for entry in entries or []:
        if isinstance(entry, str):
            out[entry] = ""
        elif isinstance(entry, dict) and entry.get("id"):
            out[entry["id"]] = entry.get("term") or ""
    return out, base


def load_glossary_terms(glossary_repo):
    """{id: {term, variants}} from a sibling glossary dataset, or {}."""
    if not glossary_repo:
        return {}
    try:
        repo = dq().resolve_repo(glossary_repo)
        data, kind = dq().load_dataset(repo)
    except (IOError, OSError, ValueError):
        return {}
    if kind != "glossary":
        return {}
    out = {}
    for rec in data.get("terms") or []:
        if isinstance(rec, dict) and rec.get("id"):
            out[rec["id"]] = {"term": rec.get("term") or "",
                              "variants": rec.get("variants") or ""}
    return out


def collect_terms(data, kind, vendored, glossary):
    """[{id, display, variants, used, displays, locators, url, pinned}].

    Sources, in order of authority: the sibling glossary dataset (display name
    + its own `variants` field), the pinned id list, and the visible text an
    author actually typed in `[[id|visible text]]` — the last being a surface
    form observed in *this* dataset, which is exactly what a searcher wants.
    """
    seen = {}

    def entry(term_id):
        if term_id not in seen:
            seen[term_id] = {"id": term_id, "display": "", "variants": "",
                             "used": 0, "displays": [], "locators": [],
                             "url": "", "pinned": term_id in vendored}
        return seen[term_id]

    for path, text in walk_strings(data):
        for term_id, visible in find_markers(text):
            rec = entry(term_id)
            rec["used"] += 1
            if visible:
                rec["displays"].append(visible)
            if len(rec["locators"]) < 4:
                rec["locators"].append(path)

    if kind == "glossary":
        for i, rec in enumerate(data.get("terms") or []):
            if not isinstance(rec, dict) or not rec.get("id"):
                continue
            item = entry(rec["id"])
            item["display"] = rec.get("term") or item["display"]
            item["variants"] = rec.get("variants") or item["variants"]
            item["locators"].insert(0, "terms[%d]" % i)
            item["defined_here"] = True

    for term_id, item in seen.items():
        from_glossary = glossary.get(term_id) or {}
        item["display"] = (item["display"] or from_glossary.get("term")
                           or vendored.get(term_id) or "")
        item["variants"] = item["variants"] or from_glossary.get("variants", "")
        item["displays"] = dedupe(item["displays"])
    return [seen[k] for k in sorted(seen)]


def collect_places(data):
    """[{place, count, fields}] for every place-ish string in the dataset."""
    places = {}
    for path, value in walk_strings(data):
        key = path.rsplit(".", 1)[-1]
        value = " ".join(value.split())
        if key not in PLACE_KEYS or not value:
            continue
        collection = re.sub(r"\[\d+\].*$", "", path).split(".")[0]
        rec = places.setdefault(value, {"place": value, "count": 0,
                                        "fields": set()})
        rec["count"] += 1
        rec["fields"].add("%s.%s" % (collection, key))
    rows = sorted(places.values(), key=lambda r: (-r["count"], r["place"]))
    for row in rows:
        row["fields"] = ",".join(sorted(row["fields"]))
    return rows


def years_in(values):
    out = []
    for value in values:
        out.extend(int(y) for y in YEAR_RE.findall(str(value or "")))
    return out


def collect_dates(data):
    """[{scope, count, span, note}] — the window the dataset covers."""
    rows, spread = [], []

    events = data.get("events") or []
    event_years = [y for y in (dq().event_year(e) for e in events
                               if isinstance(e, dict)) if y is not None]
    if events:
        unverified = sum(1 for e in events
                         if isinstance(e, dict) and e.get("dateVerified") is False)
        rows.append({"scope": "events", "count": len(events),
                     "span": span_of(event_years),
                     "note": "%d with dateVerified:false" % unverified})
        spread.extend(event_years)

    for collection, field in (("figures", "dates"),
                              ("organizations", "founded"),
                              ("terms", "definition")):
        records = [r for r in (data.get(collection) or []) if isinstance(r, dict)]
        if not records or field == "definition":
            continue
        found = years_in(r.get(field) for r in records)
        if found:
            rows.append({"scope": "%s.%s" % (collection, field),
                         "count": len(records), "span": span_of(found),
                         "note": "years parsed from the field text"})
            spread.extend(found)

    meta = data.get("meta") or {}
    rows.append({"scope": "dataset (all of the above)", "count": "-",
                 "span": span_of(spread),
                 "note": "meta.lastUpdated %s" % (meta.get("lastUpdated") or "-")})
    return rows


def span_of(years):
    if not years:
        return "-"
    lo, hi = min(years), max(years)
    return str(lo) if lo == hi else "%d–%d" % (lo, hi)


def collect(repo, glossary_repo):
    """Everything the generated block reports, as plain data."""
    data, kind = dq().load_dataset(repo)
    meta = data.get("meta") or {}
    vendored, vbase = load_vendored_terms(repo)
    base = site_url(meta)
    return {
        "repo": os.path.basename(repo),
        "kind": kind,
        "title": meta.get("title") or os.path.basename(repo),
        "dataset": "data/%s.json" % kind,
        "lastUpdated": meta.get("lastUpdated") or "",
        "siteUrl": base,
        "glossaryBase": vbase or GLOSSARY_BASE,
        "subject_names": collect_subject_names(meta),
        "people": collect_entities(data, "figures", base),
        "organizations": collect_entities(data, "organizations", base),
        "terms": collect_terms(data, kind, vendored,
                               load_glossary_terms(glossary_repo)),
        "places": collect_places(data),
        "dates": collect_dates(data),
    }


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------

DISCLAIMER = """\
**This block is a finding aid, not a dataset.** It lists strings worth
searching for — names, aliases, acronyms, spellings, and the vocabulary of
sources across the spectrum, hostile ones included. Listing a term asserts
nothing about the world: `schism` appearing in a search list does not claim
anyone is schismatic, and a critical source's word for something is listed so
its pages can be *found*, not endorsed. Every claim about the subject lives in
`data/`, attributed to whoever makes it and cited (`sourcing-rules` #1, #2).

Every string below was read out of this repo's dataset by the generator.
Nothing here is inferred or remembered. Variants seen elsewhere — in a corpus,
a transcript, an auto-caption — and terms that return **zero** hits belong in
the hand-written section outside this block, with a note on where they were
seen or searched."""


def code(s):
    return "`%s`" % s


def render_block(bundle):
    """The generated block, markers included, deterministic for a given data."""
    out = [BEGIN_MARKER,
           "<!-- Generated by core/tools/build-keywords.py from %s/%s "
           "(meta.lastUpdated %s).\n"
           "     Regenerate: python3 core/tools/build-keywords.py %s --out "
           "KEYWORDS.md\n"
           "     Edits INSIDE this block are lost on regeneration; everything "
           "outside it is kept. -->"
           % (bundle["repo"], bundle["dataset"], bundle["lastUpdated"] or "-",
              bundle["repo"]),
           "",
           "## How to use this list", "", DISCLAIMER, ""]

    out += ["## Subject names (%d)" % len(bundle["subject_names"]), "",
            "What the subject is called, from `meta` — plus every name the "
            "description puts in parentheses (acronyms, native-language "
            "forms, and whatever else it names in passing; the source field "
            "is on each line). A corpus may use exactly one of these and "
            "none of the others.", ""]
    for row in bundle["subject_names"]:
        out.append("- %s — %s" % (code(row["term"]), row["source"]))
    if not bundle["subject_names"]:
        out.append("- (no names in `meta`)")
    out.append("")

    out += ["## People (%d)" % len(bundle["people"]), "",
            "Every `figures[]` name, with the aliases and both sides of an "
            "`A — B` name. An `id` is that figure's own page — a permanent "
            "URL and a searchable handle.", ""]
    out += render_entities(bundle["people"], "no figures[] in this dataset")

    out += ["## Organizations (%d)" % len(bundle["organizations"]), "",
            "Every `organizations[]` name and alias. Acronym and full name are "
            "listed separately: sources use one or the other, rarely both.", ""]
    out += render_entities(bundle["organizations"],
                           "no organizations[] in this dataset")

    out += ["## Terms of art (%d)" % len(bundle["terms"]), "",
            "Glossary ids used in this dataset (`[[term-id]]` markers), with "
            "the visible text authors actually typed. These are *vocabulary*, "
            "including contested vocabulary — see the note at the top.", ""]
    for row in bundle["terms"]:
        bits = ["- %s" % code("[[%s]]" % row["id"])]
        if row["display"]:
            bits.append("**%s**" % row["display"])
        if row.get("defined_here"):
            bits.append("defined here (`%s`)" % row["locators"][0])
        else:
            bits.append("used %d×" % row["used"])
        if row["variants"]:
            bits.append("variants: %s" % row["variants"])
        if row["displays"]:
            bits.append("as written: %s"
                        % ", ".join(code(d) for d in row["displays"]))
        bits.append("%s%s/" % (bundle["glossaryBase"], row["id"]))
        if not row["pinned"] and not row.get("defined_here"):
            bits.append("**not in data/glossary-terms.json** (the build "
                        "validator rejects this marker)")
        out.append(" · ".join(bits))
    if not bundle["terms"]:
        out.append("- (no `[[term-id]]` markers in this dataset)")
    out.append("")

    out += ["## Places (%d)" % len(bundle["places"]), "",
            "Place strings exactly as the dataset writes them, most-used "
            "first. Search a component (`Écône`) as well as the full string.",
            ""]
    for row in bundle["places"]:
        out.append("- %s — %d× (%s)" % (code(row["place"]), row["count"],
                                        row["fields"]))
    if not bundle["places"]:
        out.append("- (no place fields in this dataset)")
    out.append("")

    out += ["## Dates coverage", "",
            "The window this dataset spans. A source outside it is not "
            "necessarily irrelevant — it is not yet covered here.", "",
            "| scope | records | years | note |", "|---|---|---|---|"]
    for row in bundle["dates"]:
        out.append("| %s | %s | %s | %s |" % (row["scope"], row["count"],
                                              row["span"], row["note"]))
    out.append("")
    out.append(END_MARKER)
    return "\n".join(out)


def render_entities(rows, empty_note):
    out = []
    for row in rows:
        bits = ["- %s" % code(row["name"]), row["locator"]]
        if row["id"]:
            bits.append("id %s" % code(row["id"]))
        if row["url"]:
            bits.append(row["url"])
        if row["variants"]:
            bits.append("also: %s"
                        % ", ".join(code(v) for v in row["variants"]))
        out.append(" · ".join(bits))
    if not rows:
        out.append("- (%s)" % empty_note)
    out.append("")
    return out


SCAFFOLD = """\
# KEYWORDS — %(title)s

The search vocabulary for this project: what the subject is called, who and
what to look for, and which obvious searches are dead ends. Read this before
searching a corpus, mining a transcript or drafting a dossier.

## Naming traps and dead terms (hand-written)

The generator cannot know any of this — it is what someone learned by
searching. Keep it here, outside the generated block, where regeneration
leaves it alone. Record the term, what happened when it was searched, and
where.

- (nothing recorded yet — add the first trap you hit)

%(block)s
"""


def scaffold(bundle, block):
    return SCAFFOLD % {"title": bundle["title"], "block": block}


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="build-keywords.py",
        description="Generate the mechanical sections of a project's "
                    "KEYWORDS.md (subject names, people, organizations, terms "
                    "of art, places, date coverage) from its dataset. "
                    "Read-only on data/; writes only Markdown.",
        epilog="repo may be a path or a bare name (%s). With --out, the "
               "sections are spliced between the markers %s / %s and "
               "everything outside them is preserved."
               % (", ".join(KNOWN_REPOS), BEGIN_MARKER, END_MARKER))
    ap.add_argument("repo", help="repo path or name (fsspx, glossary, …)")
    ap.add_argument("--out", metavar="PATH",
                    help="write/update a KEYWORDS.md instead of stdout")
    ap.add_argument("--glossary", default="glossary", metavar="REPO",
                    help="repo holding the glossary dataset, for term display "
                         "names (default: glossary; '' to skip)")
    ap.add_argument("--json", action="store_true",
                    help="print the collected vocabulary as JSON (stdout)")
    args = ap.parse_args(argv)

    if args.json and args.out:
        sys.stderr.write("build-keywords: --json writes to stdout; drop --out\n")
        return 2

    repo = dq().resolve_repo(args.repo)
    try:
        bundle = collect(repo, args.glossary)
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("build-keywords: %s\n" % exc)
        return 1

    if args.json:
        print(json.dumps(bundle, ensure_ascii=False, indent=1, default=str))
        return 0

    block = render_block(bundle)
    if not args.out:
        print(block)
        return 0

    if os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as fh:
            existing = fh.read()
        try:
            text, status = merge_generated(existing, block)
        except ValueError as exc:
            sys.stderr.write("build-keywords: %s: %s\n" % (args.out, exc))
            return 2
    else:
        text, status = scaffold(bundle, block), "created"

    if not text.endswith("\n"):
        text += "\n"
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("# %s keywords | kind=%s | %s %s"
          % (bundle["repo"], bundle["kind"], status, args.out))
    print("sections: subject_names=%d people=%d organizations=%d terms=%d "
          "places=%d"
          % (len(bundle["subject_names"]), len(bundle["people"]),
             len(bundle["organizations"]), len(bundle["terms"]),
             len(bundle["places"])))
    if status == "appended":
        print("note: no markers were present — the generated block was added "
              "at the end; the previous content is untouched above it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
