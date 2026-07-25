#!/usr/bin/env python3
"""normalise-entities — one node per entity in the COF manifest's entity index.

`archive/cof/index.json` ranks, per aula, the multiword proper nouns that aula
dwells on. Those surfaces are transcription text, so the same person arrives
under several spellings: the index carries `René Guénon`, `René Guenon`,
`Rene Guénon`, `Réne Guénon`, `René Guenón` and `Rene Guenon` as six separate
strings. Any graph or cross-reference built on the raw index therefore splits
one person into six nodes, each with a fraction of the evidence.

This collapses them, and it is deliberately conservative about how:

  1. FOLDING (mechanical, no judgement). Two surfaces merge when their match
     key is identical - de-accented, lowercased, punctuation and whitespace
     flattened. This is reproducible from the manifest by re-running the tool.
     Folding is for MATCHING ONLY: the display string is always a surface the
     corpus actually writes, never a folded one.
  2. THE ALIAS MAP (human, committed). ASR manglings - `John Don Scott` for
     John Duns Scotus, `Ortega C` for Ortega y Gasset - cannot be folded and
     must not be guessed. They merge only when a human has written the pair
     into `cof-entity-aliases.json` with a reason and a source. The tool never
     adds to that file.

HARD RULE: no merge on fuzzy similarity. `Martin Lings` and `Martin Lins`
differ by one character and may or may not be the same man; two names that
similarity would join are printed as SUGGESTIONS for a human and are NOT
merged. Merging two people is a data-corrupting error that is invisible
downstream, so the tool errs the other way and leaves work for a reader.

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, READ-ONLY —
it writes nothing, neither to a dataset nor to the corpus.
"""

import argparse
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ALIASES = os.path.join(HERE, "cof-entity-aliases.json")
CORPUS_RELATIVE = os.path.join("archive", "cof", "index.json")


def family_root():
    env = os.environ.get("CRONOLOGIA_HOME")
    if env:
        return env
    return os.path.dirname(os.path.dirname(HERE))


def resolve_corpus(arg=None):
    """Path to the COF manifest: explicit, else <family root>/archive/cof."""
    if arg:
        if os.path.isdir(arg):
            return os.path.join(arg, "index.json")
        return arg
    return os.path.join(family_root(), CORPUS_RELATIVE)


def load_corpus(path):
    with open(path, encoding="utf-8") as fh:
        index = json.load(fh)
    if not isinstance(index, dict) or not isinstance(index.get("docs"), list):
        raise ValueError("%s is not a COF manifest (no docs[])" % path)
    return index


# --------------------------------------------------------------------------
# keys — folding is for matching, never for display
# --------------------------------------------------------------------------


def deaccent(text):
    return "".join(c for c in unicodedata.normalize("NFD", text)
                   if unicodedata.category(c) != "Mn")


def fold_key(name):
    """Match key: de-accented, lowercased, punctuation and runs flattened.

    'René Guénon' / 'Réne Guenón' / 'rene  guenon.' -> 'rene guenon'.
    NEVER shown to a reader as a name: display strings stay as written.
    """
    text = deaccent(name).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def initials_key(name):
    """fold_key with single-letter tokens dropped.

    'Ananda K. Coomaraswamy' -> 'ananda coomaraswamy'. A weaker key: used to
    OFFER a match at reduced confidence, never to merge two corpus surfaces.
    """
    return " ".join(t for t in fold_key(name).split() if len(t) > 1)


def levenshtein(a, b, limit=None):
    """Edit distance, with an early exit once every cell exceeds `limit`."""
    if a == b:
        return 0
    if limit is not None and abs(len(a) - len(b)) > limit:
        return limit + 1
    if not a or not b:
        return max(len(a), len(b))
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1,
                               previous[j - 1] + (ca != cb)))
        if limit is not None and min(current) > limit:
            return limit + 1
        previous = current
    return previous[-1]


CONJUNCTION = re.compile(r"^(.+?)\s+(?:e|and|&|y)\s+(.+)$")


def conjunction_parts(surface):
    """('Guénon', 'Schuon') for a surface that joins two capitalised runs.

    A compound surface names two entities; splitting it is a judgement (it may
    be one person's double-barrelled name, or a title), so this only ever feeds
    a SUGGESTION.
    """
    match = CONJUNCTION.match(surface.strip())
    if not match:
        return None
    left, right = match.group(1).strip(), match.group(2).strip()
    for part in (left, right):
        if not part or not part[0].isupper() or len(fold_key(part)) < 4:
            return None
    return left, right


# --------------------------------------------------------------------------
# the alias map
# --------------------------------------------------------------------------


class AliasMap(object):
    """The committed human decisions. Read-only; the tool never adds to it."""

    def __init__(self, payload, path):
        self.path = path
        self.version = payload.get("version")
        self.entries = []
        self.by_variant = {}
        self.do_not_merge = []
        seen = {}
        for i, entry in enumerate(payload.get("aliases") or []):
            canonical = (entry.get("canonical") or "").strip()
            reason = (entry.get("reason") or "").strip()
            source = (entry.get("source") or "").strip()
            variants = [v.strip() for v in entry.get("variants") or []
                        if v and v.strip()]
            if not canonical or not reason or not source:
                raise ValueError(
                    "%s: aliases[%d] needs canonical, reason and source - a "
                    "merge without a stated reason is not allowed" % (path, i))
            record = {"canonical": canonical, "variants": variants,
                      "reason": reason, "source": source,
                      "canonicalInCorpus": bool(entry.get("canonicalInCorpus")),
                      "evidence": entry.get("evidence") or [],
                      "key": fold_key(canonical)}
            for variant in variants:
                key = fold_key(variant)
                if key in seen and seen[key] != record["key"]:
                    raise ValueError(
                        "%s: variant %r is claimed by two entries (%s, %s)"
                        % (path, variant, seen[key], record["key"]))
                seen[key] = record["key"]
                self.by_variant[key] = record
            self.entries.append(record)
        for entry in payload.get("doNotMerge") or []:
            names = [n.strip() for n in entry.get("names") or [] if n.strip()]
            if len(names) < 2 or not (entry.get("reason") or "").strip():
                raise ValueError("%s: every doNotMerge entry needs 2+ names "
                                 "and a reason" % path)
            self.do_not_merge.append(
                {"names": names, "keys": [fold_key(n) for n in names],
                 "reason": entry["reason"].strip(),
                 "source": (entry.get("source") or "").strip()})
        self.blocked = set()
        for entry in self.do_not_merge:
            keys = entry["keys"]
            for i, a in enumerate(keys):
                for b in keys[i + 1:]:
                    self.blocked.add(tuple(sorted((a, b))))

    def target(self, key):
        """Canonical fold key for a surface key, or None when unmapped."""
        entry = self.by_variant.get(key)
        return entry["key"] if entry else None

    def entry_for_key(self, key):
        for entry in self.entries:
            if entry["key"] == key:
                return entry
        return None


def load_aliases(path):
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    return AliasMap(payload, path)


def empty_aliases():
    return AliasMap({"version": 0, "aliases": [], "doNotMerge": []}, "(none)")


# --------------------------------------------------------------------------
# the canonical table
# --------------------------------------------------------------------------


def entity_postings(index):
    """{surface: [aula id, ...]} straight from the manifest, deduplicated."""
    postings = {}
    for doc in index.get("docs") or []:
        doc_id = doc.get("id")
        for surface in dict.fromkeys(doc.get("entities") or []):
            if not surface or not surface.strip():
                continue
            postings.setdefault(surface, [])
            if doc_id not in postings[surface]:
                postings[surface].append(doc_id)
    return postings


def doc_dates(index):
    return dict((doc.get("id"), doc.get("date"))
                for doc in index.get("docs") or [])


def build_table(index, aliases):
    """Group surfaces into entities. Returns groups sorted by aula count.

    A group is keyed by its fold key, except where the alias map re-points a
    surface onto another entity's key. Every group records which surfaces it
    absorbed and why, so the merge is auditable line by line.
    """
    postings = entity_postings(index)
    groups = {}
    for surface in sorted(postings):
        key = fold_key(surface)
        merged_by = "fold"
        alias_entry = None
        target = aliases.target(key)
        if target and target != key:
            alias_entry = aliases.by_variant[key]
            key = target
            merged_by = "alias"
        group = groups.setdefault(key, {
            "key": key, "surfaces": [], "aulas": [], "mergedBy": set(),
            "aliasEntry": None, "label": None, "labelInCorpus": True})
        group["surfaces"].append({"surface": surface,
                                  "aulas": list(postings[surface]),
                                  "docs": len(postings[surface]),
                                  "via": merged_by})
        group["mergedBy"].add(merged_by)
        if alias_entry is not None:
            group["aliasEntry"] = alias_entry
        for doc_id in postings[surface]:
            if doc_id not in group["aulas"]:
                group["aulas"].append(doc_id)
    for key, group in groups.items():
        entry = group["aliasEntry"] or aliases.entry_for_key(key)
        group["surfaces"].sort(key=lambda s: (-s["docs"], s["surface"]))
        group["aulas"].sort()
        group["docs"] = len(group["aulas"])
        group["variants"] = len(group["surfaces"])
        group["mergedBy"] = sorted(group["mergedBy"])
        # Display: the surface the alias map's canonical names when the corpus
        # writes it, else the surface carrying the most aulas. Either way a
        # string the corpus contains — the fold key is never displayed.
        group["display"] = group["surfaces"][0]["surface"]
        if entry is not None:
            group["aliasEntry"] = entry
            group["label"] = entry["canonical"]
            attested = [s["surface"] for s in group["surfaces"]
                        if fold_key(s["surface"]) == entry["key"]]
            group["labelInCorpus"] = bool(attested)
            if attested:
                group["display"] = attested[0]
        group["matchKeys"] = sorted(set(
            [key] + [fold_key(s["surface"]) for s in group["surfaces"]]
            + ([fold_key(group["label"])] if group["label"] else [])))
    ordered = sorted(groups.values(),
                     key=lambda g: (-g["docs"], -g["variants"], g["key"]))
    return ordered


def group_index(groups):
    """{match key: group} so another tool can look an entity up by name."""
    lookup = {}
    for group in groups:
        for key in group["matchKeys"]:
            lookup.setdefault(key, group)
        weak = initials_key(group["display"])
        if weak and weak not in lookup:
            lookup.setdefault("~" + weak, group)
    return lookup


# --------------------------------------------------------------------------
# alias-map audit and suggestions — reported, never acted on
# --------------------------------------------------------------------------


def audit_aliases(aliases, postings, corpus_root=None):
    """Which alias entries fired, which matched nothing, which were redundant.

    `evidence` quotes are re-verified as literal substrings of the aula they
    name whenever the corpus files are readable, so a quote cannot rot into a
    remembered one.
    """
    keys = set(fold_key(s) for s in postings)
    applied, unused, redundant, evidence = [], [], [], []
    for entry in aliases.entries:
        for variant in entry["variants"]:
            key = fold_key(variant)
            row = {"canonical": entry["canonical"], "variant": variant,
                   "reason": entry["reason"], "source": entry["source"]}
            if key == entry["key"]:
                redundant.append(row)
            elif key in keys:
                applied.append(row)
            else:
                unused.append(row)
        for item in entry["evidence"]:
            aula = item.get("aula") or ""
            quote = item.get("quote") or ""
            row = {"canonical": entry["canonical"], "aula": aula,
                   "quote": quote, "status": "unchecked"}
            if corpus_root:
                row["status"] = verify_quote(corpus_root, aula, quote)
            evidence.append(row)
    return {"applied": applied, "unused": unused, "redundant": redundant,
            "evidence": evidence}


def verify_quote(corpus_root, aula, quote):
    """'verified' when the quote is a literal substring of that aula's file."""
    if not aula or not quote:
        return "incomplete"
    for sub in ("revisadas", "revisao_pendente"):
        path = os.path.join(corpus_root, sub, "%s.md" % aula)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            return "unreadable"
        return "verified" if quote in text else "NOT-LITERAL"
    return "file-missing"


def suggestions(groups, aliases, max_pairs=200):
    """Near-misses for a HUMAN. Nothing here is merged by the tool.

    Four mechanical signals, each cheap and reproducible:
      edit1        - match keys within edit distance 1 (2 for keys 14+ chars)
      token-subset - one name's tokens are a strict subset of another's
      shared-token - a token rare across the index (<= 3 entities) shared by
                     two entities whose other tokens differ
      conjunction  - a surface joining two capitalised runs ('Guénon e Schuon')
    Pairs listed in the alias map's doNotMerge are suppressed and reported
    separately, so a settled question is not re-asked every run.
    """
    by_token = {}
    for group in groups:
        for token in set(group["key"].split()):
            if len(token) > 2:
                by_token.setdefault(token, []).append(group)
    pairs = {}

    def offer(a, b, kind, detail):
        if a["key"] == b["key"]:
            return
        pair = tuple(sorted((a["key"], b["key"])))
        if pair in aliases.blocked:
            return
        first, second = (a, b) if a["key"] == pair[0] else (b, a)
        existing = pairs.get(pair)
        if existing is None or SUGGESTION_ORDER[kind] < \
                SUGGESTION_ORDER[existing["kind"]]:
            pairs[pair] = {"kind": kind, "detail": detail,
                           "a": first, "b": second}

    for token, members in sorted(by_token.items()):
        if len(members) > 12:
            continue
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                ta, tb = set(a["key"].split()), set(b["key"].split())
                limit = 2 if max(len(a["key"]), len(b["key"])) >= 14 else 1
                distance = levenshtein(a["key"], b["key"], limit)
                if distance <= limit:
                    offer(a, b, "edit1", "edit distance %d" % distance)
                elif ta < tb or tb < ta:
                    offer(a, b, "token-subset",
                          "%s ⊂ %s" % (min(a["key"], b["key"], key=len),
                                       max(a["key"], b["key"], key=len)))
                elif len(members) <= 3 and len(token) >= 4:
                    offer(a, b, "shared-token",
                          "share the rare token '%s' (%d entities)"
                          % (token, len(members)))
    rows = []
    for pair in sorted(pairs):
        item = pairs[pair]
        rows.append({"kind": item["kind"], "detail": item["detail"],
                     "a": summarise(item["a"]), "b": summarise(item["b"])})
    for group in groups:
        for surface in group["surfaces"]:
            parts = conjunction_parts(surface["surface"])
            if parts:
                rows.append({"kind": "conjunction",
                             "detail": "names two entities: %s | %s" % parts,
                             "a": summarise(group), "b": None})
    rows.sort(key=lambda r: (SUGGESTION_ORDER[r["kind"]],
                             -(r["a"]["docs"] + (r["b"]["docs"] if r["b"]
                                                 else 0)),
                             r["a"]["display"]))
    total = len(rows)
    return (rows[:max_pairs] if max_pairs else rows), total


SUGGESTION_ORDER = {"edit1": 0, "token-subset": 1, "shared-token": 2,
                    "conjunction": 3}


def summarise(group):
    return {"display": group["display"], "key": group["key"],
            "docs": group["docs"], "aulas": group["aulas"][:8],
            "variants": [s["surface"] for s in group["surfaces"]]}


def build_report(corpus_path, aliases, min_aulas=1, want_suggestions=True,
                 max_suggestions=200):
    index = load_corpus(corpus_path)
    groups = build_table(index, aliases)
    postings = entity_postings(index)
    corpus_root = os.path.dirname(os.path.abspath(corpus_path))
    audit = audit_aliases(aliases, postings, corpus_root)
    merged = [g for g in groups if g["variants"] > 1]
    rows = [g for g in groups if g["docs"] >= min_aulas]
    near, near_total = (suggestions(groups, aliases, max_suggestions)
                        if want_suggestions else ([], 0))
    return {
        "corpus": corpus_path,
        "aliasMap": aliases.path,
        "surfaces": len(postings),
        "entities": len(groups),
        "mergedGroups": len(merged),
        "surfacesAbsorbed": sum(g["variants"] - 1 for g in merged),
        "byFold": sum(1 for g in merged if "fold" in g["mergedBy"]),
        "byAlias": sum(1 for g in merged if "alias" in g["mergedBy"]),
        "minAulas": min_aulas,
        "audit": audit,
        "doNotMerge": aliases.do_not_merge,
        "merged": merged,
        "groups": rows,
        "suggestions": near,
        "suggestionsTotal": near_total,
    }


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def aula_list(group, dates=None, limit=0):
    ids = group["aulas"]
    shown = ids[:limit] if limit else ids
    if dates is None:
        text = ",".join(shown)
    else:
        text = ",".join("%s(%s)" % (i, dates.get(i) or "?") for i in shown)
    if limit and len(ids) > limit:
        text += ",+%d" % (len(ids) - limit)
    return text


def render(report, dates=None):
    out = ["# normalise-entities | corpus=%s | surfaces=%d | entities=%d | "
           "merged-groups=%d (used fold=%d, used alias map=%d) | "
           "surfaces-absorbed=%d | suggestions=%d shown of %d"
           % (report["corpus"], report["surfaces"], report["entities"],
              report["mergedGroups"], report["byFold"], report["byAlias"],
              report["surfacesAbsorbed"], len(report["suggestions"]),
              report["suggestionsTotal"]),
           "MERGE RULE: identical match key (accents/case/punctuation folded), "
           "or an explicit entry in %s with a reason. NEVER on similarity. "
           "Display strings are surfaces the corpus writes; the fold key is a "
           "match key and is not a name." % report["aliasMap"],
           "The entity index ranks the DISTINCTIVE multiword proper nouns of "
           "each aula - it is not a mention index, so an entity absent here "
           "may still be named in a lecture. Grep the corpus to be sure."]

    audit = report["audit"]
    out.append("")
    out.append("## alias map | applied=%d unused=%d redundant=%d evidence=%s"
               % (len(audit["applied"]), len(audit["unused"]),
                  len(audit["redundant"]),
                  "%d/%d verified" % (
                      sum(1 for e in audit["evidence"]
                          if e["status"] == "verified"),
                      len(audit["evidence"])) or "-"))
    for row in audit["applied"]:
        out.append("APPLIED  %s -> %s :: %s" % (row["variant"],
                                                row["canonical"],
                                                row["reason"]))
    for row in audit["unused"]:
        out.append("unused   %s -> %s (no such surface in the index)"
                   % (row["variant"], row["canonical"]))
    for row in audit["redundant"]:
        out.append("redundant %s -> %s (folds together already)"
                   % (row["variant"], row["canonical"]))
    for row in audit["evidence"]:
        out.append("evidence %s %s | %s | \"%s\"" % (
            row["status"], row["aula"], row["canonical"], row["quote"]))
    for entry in report["doNotMerge"]:
        out.append("KEPT-APART %s :: %s" % (" | ".join(entry["names"]),
                                            entry["reason"]))

    out.append("")
    out.append("## merged (%d entities absorbed %d extra surfaces)"
               % (report["mergedGroups"], report["surfacesAbsorbed"]))
    out.append("<display> [<via>] docs=<n> :: <surface>(<n>) …")
    for group in report["merged"]:
        label = ""
        if group["label"] and fold_key(group["label"]) != \
                fold_key(group["display"]):
            label = " label=%s%s" % (group["label"],
                                     "" if group["labelInCorpus"]
                                     else " (alias-map label, NOT a corpus "
                                          "string - do not grep for it)")
        out.append("%s [%s] docs=%d%s :: %s"
                   % (group["display"], "+".join(group["mergedBy"]),
                      group["docs"], label,
                      " · ".join("%s(%d)" % (s["surface"], s["docs"])
                                 for s in group["surfaces"])))

    out.append("")
    out.append("## suggestions — FOR A HUMAN, nothing below was merged "
               "(%d of %d shown)"
               % (len(report["suggestions"]), report["suggestionsTotal"]))
    out.append("A suggestion is a near-miss, not a finding: two different "
               "people may share a surname, and one lecture's mangling may be "
               "another lecture's different man. Act on one by adding it to "
               "the alias map with a reason, or record it under doNotMerge.")
    for row in report["suggestions"]:
        if row["b"] is None:
            out.append("%-13s %s (docs=%d) :: %s"
                       % (row["kind"], row["a"]["display"], row["a"]["docs"],
                          row["detail"]))
        else:
            out.append("%-13s %s (docs=%d, %s) ?= %s (docs=%d, %s) :: %s"
                       % (row["kind"], row["a"]["display"], row["a"]["docs"],
                          ",".join(row["a"]["aulas"]), row["b"]["display"],
                          row["b"]["docs"], ",".join(row["b"]["aulas"]),
                          row["detail"]))

    out.append("")
    out.append("## canonical entity table (%d entities, docs >= %d)"
               % (len(report["groups"]), report["minAulas"]))
    out.append("<display> | docs=<n> | variants=<n> | <aula>(<date|?>) …")
    for group in report["groups"]:
        out.append("%s | docs=%d | variants=%d | %s"
                   % (group["display"], group["docs"], group["variants"],
                      aula_list(group, dates)))
    return "\n".join(out)


def write_out(text):
    """print(), but survive a closed pipe (`| head`) without a traceback.

    Shared by the three COF tools: their reports are long and get piped.
    """
    try:
        print(text)
        sys.stdout.flush()
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())


def json_report(report):
    payload = dict((k, v) for k, v in report.items()
                   if k not in ("groups", "merged", "suggestions"))
    payload["groups"] = [
        {"display": g["display"], "key": g["key"], "label": g["label"],
         "labelInCorpus": g["labelInCorpus"], "docs": g["docs"],
         "mergedBy": g["mergedBy"], "aulas": g["aulas"],
         "surfaces": g["surfaces"], "matchKeys": g["matchKeys"]}
        for g in report["groups"]]
    payload["merged"] = [g["key"] for g in report["merged"]]
    payload["suggestions"] = report["suggestions"]
    return payload


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="normalise-entities.py",
        description="Canonical entity table for the COF manifest's entity "
                    "index: fold diacritic/punctuation variants, apply the "
                    "committed alias map, report near-misses for a human. "
                    "Read-only; merges nothing on similarity.",
        epilog="Merging two people is invisible downstream, so this tool "
               "under-merges on purpose: anything short of an identical match "
               "key or a committed alias entry is printed as a suggestion.")
    ap.add_argument("--corpus", metavar="PATH",
                    help="cof/index.json or the cof/ directory "
                         "(default: <CRONOLOGIA_HOME>/archive/cof/index.json)")
    ap.add_argument("--aliases", metavar="PATH", default=DEFAULT_ALIASES,
                    help="alias map JSON (default: tools/cof-entity-aliases.json)")
    ap.add_argument("--no-aliases", action="store_true",
                    help="fold only; ignore the alias map (shows what the "
                         "mechanical half alone achieves)")
    ap.add_argument("--min-aulas", type=int, default=1, metavar="N",
                    help="canonical table: only entities in N+ aulas")
    ap.add_argument("--no-suggestions", action="store_true",
                    help="skip the near-miss pass")
    ap.add_argument("--max-suggestions", type=int, default=200, metavar="N",
                    help="cap the near-miss list (0 = all; default 200)")
    ap.add_argument("--dates", action="store_true",
                    help="print each aula's lecture date (? = the "
                         "transcription carries none)")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args(argv)

    corpus = resolve_corpus(args.corpus)
    try:
        aliases = empty_aliases() if args.no_aliases \
            else load_aliases(args.aliases)
    except (IOError, OSError) as exc:
        sys.stderr.write("normalise-entities: alias map: %s\n" % exc)
        return 1
    except ValueError as exc:
        sys.stderr.write("normalise-entities: invalid alias map: %s\n" % exc)
        return 2
    try:
        report = build_report(corpus, aliases, args.min_aulas,
                              not args.no_suggestions, args.max_suggestions)
        dates = doc_dates(load_corpus(corpus)) if args.dates else None
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("normalise-entities: %s\n" % exc)
        return 1
    if args.json:
        write_out(json.dumps(json_report(report), ensure_ascii=False, indent=1))
    else:
        write_out(render(report, dates))
    return 0


if __name__ == "__main__":
    sys.exit(main())
