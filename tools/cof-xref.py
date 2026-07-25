#!/usr/bin/env python3
"""cof-xref — which COF aulas discuss the people our datasets track.

The corpus is a SEARCH AND IDENTIFICATION base (`archive/adr/0005`): 589
lectures nobody is going to read, holding primary-source material under three
of the family's chronologies. The standing question is the same every time —
"does Olavo talk about this figure, and in which lecture?" — and answering it by
hand means grepping 7.2M words for every name in every dataset, in every
spelling the transcribers used.

This joins the two sides mechanically:

  dataset side  figures[] and organizations[] of each repo, plus the aliases a
                name carries in parentheses and both sides of an 'A — B' name.
  corpus side   the normalised entity table from normalise-entities.py, so
                'René Guenón' and 'René Guénon' are one entity and the ASR
                manglings a human put in the alias map come with it.

Every hit prints the aulas and their dates, so a lead is one file away from a
citable, dated reference. NOTHING HERE IS A CITATION: a hit says a lecture's
own distinctive vocabulary contains that name, not what the lecture claims
about the person. Quoting still means opening the aula and attributing the
quote to that aula and date (`archive/NOTICE.md`, sourcing-rules #5).

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, READ-ONLY.
"""

import argparse
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REPOS = ("fsspx", "tariqa", "perennialism", "rcc")
_loaded = {}


def sibling(filename, name):
    """Load a sibling tool as a module (the pattern xref.py already uses)."""
    if name not in _loaded:
        path = os.path.join(HERE, filename)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _loaded[name] = module
    return _loaded[name]


def ne():
    return sibling("normalise-entities.py", "normalise_entities")


def dq():
    return sibling("dataset-query.py", "dataset_query")


def xr():
    return sibling("xref.py", "xref")


# --------------------------------------------------------------------------
# the dataset side
# --------------------------------------------------------------------------


def skip_reason(variant, key):
    """Why a dataset string is not joined on, or None when it is joinable.

    Two rejections, both mechanical. A parenthetical like '(publisher)' or
    '(as author)' is a descriptor, not a name — dataset names are capitalised.
    And a one-word or very short key ('Francis', 'IBP', 'Campos') would match
    by accident. Neither is silently dropped: both are reported, so nobody
    reads their absence as a measured zero.
    """
    letters = [c for c in variant if c.isalpha()]
    if letters and not letters[0].isupper():
        return "descriptor, not a name (starts lowercase)"
    if len(key) < 8 or len(key.split()) < 2:
        return "too generic to join on (needs 2+ words, 8+ characters)"
    return None


def near_misses(groups, token_index, variant, limit=3):
    """Entities close to a name that found no match. NEVER counted as hits.

    'Marcel Lefebvre' is not in the entity index; 'Monsenhor Lefebvre' is.
    'Mark Sedgwick' is not; 'Mark Sedwick' is. Those are the two most useful
    things this tool can say about a zero, so it says them, by two mechanical
    signals:

      surname     the dataset name's LAST token is shared, and that token is
                  rare (at most RARE_TOKEN_MAX entities carry it) — so a shared
                  given name ('Marcel Proust' for Marcel Lefebvre) does not
                  qualify and 'Igreja'/'Escola' never do;
      edit-1/2    the whole match keys are within edit distance 2.

    Both are near misses a human resolves. Father and son share a surname, and
    an ASR mangling looks exactly like a different person.
    """
    module = ne()
    key = module.fold_key(variant)
    parts = key.split()
    if not parts:
        return []
    surname = parts[-1] if len(parts[-1]) >= 4 else None
    scored = []
    for group in groups:
        other = group["key"]
        if other == key:
            continue
        why = None
        tokens = other.split()
        if surname and surname in tokens and \
                len(token_index.get(surname, ())) <= RARE_TOKEN_MAX:
            why = "shares the rare name part '%s'" % surname
        elif len(key) >= 8 and abs(len(other) - len(key)) <= 2 \
                and other[0] == key[0]:
            distance = module.levenshtein(key, other, 2)
            if distance <= 2:
                why = "edit distance %d" % distance
        if not why:
            continue
        scored.append({"entity": group["display"], "docs": group["docs"],
                       "aulas": group["aulas"], "why": why})
    scored.sort(key=lambda s: (0 if s["why"].startswith("edit") else 1,
                               -s["docs"], s["entity"]))
    return scored[:limit]


RARE_TOKEN_MAX = 3


def index_tokens(groups):
    """{token: [entity key, ...]} — how common a name part is in the index."""
    tokens = {}
    for group in groups:
        for token in set(group["key"].split()):
            tokens.setdefault(token, []).append(group["key"])
    return tokens


PEOPLE_SPLIT = re.compile(r"\s*&\s*|\s+and\s+|\s*,\s*")


def dataset_variants(surface):
    """Every name string worth searching for in one dataset record.

    Starts from xref.py's name_variants (parentheticals, both sides of an
    'A — B' or 'A / B' name) and adds the members of a record that names
    several people at once — 'Mark Sedgwick & Wouter Hanegraaff', 'Kevin and
    Dorothy Ranaghan'. Without the split, a record's second person is never
    searched for; the whole string is kept too, so nothing is lost.
    """
    out = []
    for variant in xr().name_variants(surface):
        variant = variant.strip()
        if variant and variant not in out:
            out.append(variant)
        for part in PEOPLE_SPLIT.split(variant):
            part = part.strip()
            if part and part != variant and part not in out:
                out.append(part)
    return out


def dataset_entities(repo_arg):
    """[(repo, locator, kind, name, variant)] for figures[] and organizations[]."""
    repo = dq().resolve_repo(repo_arg)
    data, _kind = dq().load_dataset(repo)
    name = os.path.basename(repo.rstrip(os.sep))
    rows = []
    for collection in ("figures", "organizations"):
        for i, rec in enumerate(data.get(collection) or []):
            surface = (rec.get("name") or "").strip()
            if not surface:
                continue
            locator = "%s[%d]" % (collection, i)
            for variant in dataset_variants(surface):
                rows.append({"repo": name, "locator": locator,
                             "kind": collection, "name": surface,
                             "variant": variant.strip(),
                             "dates": rec.get("dates") or rec.get("founded")
                             or ""})
    return name, rows


# --------------------------------------------------------------------------
# the join
# --------------------------------------------------------------------------


def match(lookup, variant):
    """(group, confidence, how) for a dataset name, or None.

    high   — the match key is identical after folding accents/punctuation.
    medium — identical once single-letter initials are dropped ('Ananda K.
             Coomaraswamy' ~ 'Ananda Coomaraswamy'): almost always the same
             person, but the strings genuinely differ, so it is flagged.
    """
    module = ne()
    key = module.fold_key(variant)
    if key in lookup:
        return lookup[key], "high", "exact match key"
    weak = module.initials_key(variant)
    if weak and weak != key and ("~" + weak) in lookup:
        return lookup["~" + weak], "medium", "initials dropped"
    if weak and weak in lookup:
        return lookup[weak], "medium", "initials dropped"
    return None


CONFIDENCE_ORDER = {"high": 0, "medium": 1}


def build_report(repo_args, corpus_path, aliases, min_aulas=1):
    module = ne()
    index = module.load_corpus(corpus_path)
    groups = module.build_table(index, aliases)
    lookup = module.group_index(groups)
    dates = module.doc_dates(index)

    tokens = index_tokens(groups)
    hits, zero, skipped, repos = {}, [], [], []
    for arg in repo_args:
        repo, rows = dataset_entities(arg)
        repos.append(repo)
        seen = set()
        for row in rows:
            key = module.fold_key(row["variant"])
            reason = skip_reason(row["variant"], key)
            if reason:
                row = dict(row, why=reason)
                skipped.append(row)
                continue
            if (row["repo"], row["locator"], key) in seen:
                continue
            seen.add((row["repo"], row["locator"], key))
            found = match(lookup, row["variant"])
            if not found:
                zero.append(dict(row, near=near_misses(groups, tokens,
                                                       row["variant"])))
                continue
            group, confidence, how = found
            hit = hits.setdefault(group["key"], {
                "entity": group["display"], "key": group["key"],
                "label": group["label"], "labelInCorpus": group["labelInCorpus"],
                "mergedBy": group["mergedBy"],
                "surfaces": [(s["surface"], s["docs"])
                             for s in group["surfaces"]],
                "aulas": group["aulas"], "docs": group["docs"],
                "claims": []})
            hit["claims"].append({"repo": row["repo"], "locator": row["locator"],
                                  "kind": row["kind"], "name": row["name"],
                                  "matchedOn": row["variant"],
                                  "confidence": confidence, "how": how,
                                  "datasetDates": row["dates"]})
    rows = [h for h in hits.values() if h["docs"] >= min_aulas]
    for hit in rows:
        hit["claims"].sort(key=lambda c: (CONFIDENCE_ORDER[c["confidence"]],
                                          c["repo"], c["locator"]))
        hit["confidence"] = hit["claims"][0]["confidence"]
        hit["repos"] = sorted(set(c["repo"] for c in hit["claims"]))
    rows.sort(key=lambda h: (CONFIDENCE_ORDER[h["confidence"]], -h["docs"],
                             h["entity"]))
    zero.sort(key=lambda r: (r["repo"], r["locator"], r["variant"]))
    skipped.sort(key=lambda r: (r["repo"], r["locator"], r["variant"]))
    return {"repos": repos, "corpus": corpus_path, "aliasMap": aliases.path,
            "entities": len(groups), "aulas": len(index.get("docs") or []),
            "hits": rows, "hitAulas": len(set(a for h in rows
                                              for a in h["aulas"])),
            "zero": zero, "zeroWithNear": sum(1 for r in zero if r["near"]),
            "skipped": skipped, "minAulas": min_aulas, "dates": dates}


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


CAVEAT = (
    "A hit means the aula's own distinctive vocabulary contains that name. It "
    "is a LEAD, not a citation and not a claim about what the lecture says: "
    "open the aula, read the passage, and attribute any quote to that aula and "
    "date (archive/NOTICE.md; adr/0005 — the corpus is where you look, not "
    "what you cite).")
LIMIT = (
    "The corpus entity index ranks each aula's DISTINCTIVE multiword proper "
    "nouns; it is not a mention index. A lecture that names someone once will "
    "not appear here (COF081 says 'Monsenhor Lefebvre' exactly once in 18,479 "
    "words). A zero below is 'not distinctive anywhere', NOT 'absent from the "
    "corpus' — grep before concluding absence.")


def aula_cell(hit, dates, limit=0):
    ids = hit["aulas"][:limit] if limit else hit["aulas"]
    text = ", ".join("%s (%s)" % (i, dates.get(i) or "no date in file")
                     for i in ids)
    if limit and len(hit["aulas"]) > limit:
        text += ", +%d more" % (len(hit["aulas"]) - limit)
    return text


def render(report):
    dates = report["dates"]
    out = ["# cof-xref | repos=%s | corpus=%s | entities=%d over %d aulas | "
           "hits=%d covering %d aulas | zero=%d (near-miss=%d) | "
           "not-searched=%d"
           % (",".join(report["repos"]), report["corpus"], report["entities"],
              report["aulas"], len(report["hits"]), report["hitAulas"],
              len(report["zero"]), report["zeroWithNear"],
              len(report["skipped"])),
           CAVEAT, LIMIT,
           "confidence: high = identical match key after folding accents, "
           "case and punctuation; medium = identical only after dropping "
           "single-letter initials. Aulas reached through the committed alias "
           "map are marked via=alias — a human decision, readable in %s."
           % report["aliasMap"]]
    out.append("")
    out.append("## hits (%d)" % len(report["hits"]))
    for hit in report["hits"]:
        label = ""
        if hit["label"] and not hit["labelInCorpus"]:
            label = " [alias-map label: %s — NOT a corpus string]" % hit["label"]
        out.append("")
        out.append("## %s%s | aulas=%d | confidence=%s | via=%s"
                   % (hit["entity"], label, hit["docs"], hit["confidence"],
                      "+".join(hit["mergedBy"])))
        for claim in hit["claims"]:
            out.append("dataset %s %s | %s | matched on %r (%s, %s)"
                       % (claim["repo"], claim["locator"], claim["name"],
                          claim["matchedOn"], claim["confidence"],
                          claim["how"]))
        out.append("corpus writes: %s"
                   % " · ".join("%s(%d)" % (s, n) for s, n in hit["surfaces"]))
        out.append("aulas: %s" % aula_cell(hit, dates))
    out.append("")
    out.append("## zero hits (%d, of which %d have a near miss) — searched, "
               "not found in the entity index"
               % (len(report["zero"]), report["zeroWithNear"]))
    out.append("NEAR MISS = an entity sharing a rare name part. It is NOT a "
               "match and was not counted: 'Rama P. Coomaraswamy' near "
               "'Ananda Coomaraswamy' is father and son, two people. A human "
               "decides, and records the decision in the alias map.")
    for row in report["zero"]:
        line = "%s %s | %s" % (row["repo"], row["locator"], row["variant"])
        if row["near"]:
            line += "  ~ near: %s" % "; ".join(
                "%s (%d aulas: %s | %s)"
                % (n["entity"], n["docs"], ",".join(n["aulas"][:4]),
                   n["why"]) for n in row["near"])
        out.append(line)
    out.append("")
    out.append("## not searched (%d) — NOT a measured zero" %
               len(report["skipped"]))
    for row in report["skipped"]:
        out.append("%s %s | %s :: %s" % (row["repo"], row["locator"],
                                         row["variant"], row["why"]))
    return "\n".join(out)


def render_markdown(report):
    """Paste-ready for a ticket comment: leads first, caveats attached."""
    dates = report["dates"]
    out = ["## COF cross-reference — research leads", "",
           "`cof-xref.py` over %s against the COF corpus (%d aulas, %d "
           "normalised entities). **%d dataset entities hit, covering %d "
           "aulas.**"
           % (", ".join("`%s`" % r for r in report["repos"]), report["aulas"],
              report["entities"], len(report["hits"]), report["hitAulas"]),
           "", "> %s" % CAVEAT, ">", "> %s" % LIMIT, "",
           "| entity (as the corpus writes it) | dataset | aulas | conf. |",
           "|---|---|---|---|"]
    for hit in report["hits"]:
        who = "; ".join("`%s` %s" % (c["repo"], c["name"])
                        for c in hit["claims"])
        out.append("| %s | %s | %d | %s |"
                   % (hit["entity"], who, hit["docs"], hit["confidence"]))
    out.append("")
    out.append("### where to look")
    for hit in report["hits"]:
        out.append("- **%s** (%d aulas) — %s"
                   % (hit["entity"], hit["docs"], aula_cell(hit, dates, 12)))
        if len(hit["surfaces"]) > 1:
            out.append("  - the corpus spells it: %s"
                       % ", ".join("`%s` (%d)" % (s, n)
                                   for s, n in hit["surfaces"]))
    near = [r for r in report["zero"] if r["near"]]
    if near:
        out.append("")
        out.append("### near misses — for a human, NOT matches (%d)"
                   % len(near))
        out.append("A dataset name with no match that shares a rare name part "
                   "with — or is one or two characters from — something the "
                   "corpus does write. Some are the same person under another "
                   "style or an ASR mangling, some are two different people "
                   "with one surname. Resolve by reading the aula.")
        for row in near:
            out.append("- `%s` **%s** ~ %s"
                       % (row["repo"], row["variant"],
                          "; ".join("%s (%d aulas: %s — %s)"
                                    % (n["entity"], n["docs"],
                                       ", ".join(n["aulas"][:4]), n["why"])
                                    for n in row["near"])))
    if report["zero"]:
        out.append("")
        out.append("### searched, no hit (%d)" % len(report["zero"]))
        out.append("Not distinctive in any aula — which is a finding, not a "
                   "failed search. Grep the corpus before concluding absence.")
        by_repo = {}
        for row in report["zero"]:
            by_repo.setdefault(row["repo"], []).append(row["variant"])
        for repo in sorted(by_repo):
            out.append("- `%s`: %s" % (repo, ", ".join(sorted(
                set(by_repo[repo])))))
    if report["skipped"]:
        out.append("")
        out.append("### not searched (%d) — not a measured zero"
                   % len(report["skipped"]))
        out.append(", ".join(sorted(set("`%s`" % r["variant"]
                                        for r in report["skipped"]))))
    return "\n".join(out)


def json_report(report):
    payload = dict((k, v) for k, v in report.items() if k != "dates")
    for hit in payload["hits"]:
        hit["aulaDates"] = dict((a, report["dates"].get(a))
                                for a in hit["aulas"])
    return payload


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="cof-xref.py",
        description="Cross-reference the COF corpus against the figures[] and "
                    "organizations[] of the project datasets: which aulas "
                    "discuss the people we track, and when. Read-only.",
        epilog="A hit is a research lead, never a citation: the corpus is "
               "where you look, not what you cite (archive/adr/0005). "
               "Default repos: %s" % ",".join(DEFAULT_REPOS))
    ap.add_argument("--repos", default=",".join(DEFAULT_REPOS),
                    help="comma-separated repo names or paths")
    ap.add_argument("--corpus", metavar="PATH",
                    help="cof/index.json or the cof/ directory "
                         "(default: <CRONOLOGIA_HOME>/archive/cof/index.json)")
    ap.add_argument("--aliases", metavar="PATH",
                    default=os.path.join(HERE, "cof-entity-aliases.json"),
                    help="alias map used to normalise the corpus entities")
    ap.add_argument("--no-aliases", action="store_true",
                    help="fold only; ignore the committed alias map")
    ap.add_argument("--min-aulas", type=int, default=1, metavar="N",
                    help="only report entities hitting N+ aulas")
    ap.add_argument("--markdown", action="store_true",
                    help="paste-ready ticket comment")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args(argv)

    if args.markdown and args.json:
        sys.stderr.write("cof-xref: choose --markdown or --json, not both\n")
        return 2
    targets = [r.strip() for r in args.repos.split(",") if r.strip()]
    if not targets:
        sys.stderr.write("cof-xref: --repos is empty\n")
        return 2
    module = ne()
    corpus = module.resolve_corpus(args.corpus)
    try:
        aliases = module.empty_aliases() if args.no_aliases \
            else module.load_aliases(args.aliases)
    except ValueError as exc:
        sys.stderr.write("cof-xref: invalid alias map: %s\n" % exc)
        return 2
    except (IOError, OSError) as exc:
        sys.stderr.write("cof-xref: alias map: %s\n" % exc)
        return 1
    try:
        report = build_report(targets, corpus, aliases, args.min_aulas)
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("cof-xref: %s\n" % exc)
        return 1
    out = ne().write_out
    if args.json:
        out(json.dumps(json_report(report), ensure_ascii=False, indent=1))
    elif args.markdown:
        out(render_markdown(report))
    else:
        out(render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
