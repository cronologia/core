#!/usr/bin/env python3
"""xref — cross-repo consistency check for shared entities.

The family rule is "cross-reference, never duplicate": the same figure or
organization may appear in several chronologies, and those datasets must AGREE
about it. They drift silently — a real hand review caught a figure described as
an order "member" in one repo and explicitly "never a member" in another.

This finds entity names present in 2+ repos (figures, organizations, and
notable proper nouns inside `facts`) and prints each repo's own description
line side by side, so an agent can read the disagreement rather than hunt for
it. Pairs whose descriptions diverge on affiliation-type words
(member/follower/adjacent/initiate/professor/founder …), or where one repo
negates what another asserts ("never a member"), are marked FLAG.

It does not auto-resolve anything: divergence is often legitimate (different
periods, different scopes) and resolving it is an attribution decision
(sourcing-rules #2, #4). It reports.

Agent-side analysis tooling: Python 3 stdlib only, never runs in CI, READ-ONLY.
"""

import argparse
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_REPOS = ("fsspx", "tariqa", "perennialism", "rcc")

_dq = None


def dq():
    global _dq
    if _dq is None:
        import importlib.util
        path = os.path.join(HERE, "dataset-query.py")
        spec = importlib.util.spec_from_file_location("dataset_query", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _dq = module
    return _dq


# --------------------------------------------------------------------------
# name normalization
# --------------------------------------------------------------------------

HONORIFICS = ("dom", "dr", "dra", "sr", "sra", "pe", "padre", "frei", "fr",
              "mons", "monsenhor", "bishop", "archbishop", "cardinal", "pope",
              "saint", "st", "santo", "santa", "sao", "são", "shaykh", "sheikh",
              "sidi", "prof", "professor", "mr", "mrs", "ms", "rev", "reverend")

NAME_NOISE = re.compile(r"\((?P<alias>[^)]*)\)")


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if unicodedata.category(c) != "Mn")


def name_variants(name):
    """Surface forms worth matching on: the name, and any parenthetical alias.

    'René Guénon (Abd al-Wahid Yahya)' -> both names.
    'FSSP — Priestly Fraternity of Saint Peter' -> both sides of the dash.
    """
    out = []
    alias = [m.group("alias") for m in NAME_NOISE.finditer(name)]
    base = NAME_NOISE.sub(" ", name)
    for part in re.split(r"\s+[—–-]\s+|\s*[/;]\s*", base):
        part = part.strip()
        if part:
            out.append(part)
    out.extend(a.strip() for a in alias if a.strip())
    return [o for o in out if o]


def normal_name(name):
    """Comparison key: de-accented, lowercased, honorifics and noise removed."""
    text = deaccent(name).lower()
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    words = [w for w in text.split() if w and w not in HONORIFICS]
    return " ".join(words)


def is_notable_name(key):
    """Reject one-word and obviously generic keys as cross-repo anchors."""
    if not key or len(key) < 6:
        return False
    words = key.split()
    if len(words) < 2:
        return False
    return True


# --------------------------------------------------------------------------
# entity collection
# --------------------------------------------------------------------------

FACT_NAME = re.compile(
    r"\b[A-ZÀ-Þ][\wÀ-ÿ'’.-]+(?:\s+(?:de|da|do|dos|das|del|van|von|of|al|ibn|"
    r"bin|the)\s+[A-Za-zÀ-ÿ][\wÀ-ÿ'’.-]+|\s+[A-ZÀ-Þ][\wÀ-ÿ'’.-]+)+")


def proper_nouns_in_facts(data):
    """(surface, context) for capitalized multi-word names inside facts[]."""
    out = []
    for fact in data.get("facts") or []:
        text = " ".join(str(fact.get(k, "")) for k in ("label", "value"))
        text = re.sub(r"\[\[[^\]|]*\|?", " ", text).replace("]]", " ")
        for m in FACT_NAME.finditer(text):
            out.append((m.group(0).strip(" .,;"), " ".join(text.split())))
    return out


def collect_entities(repo_arg):
    """{key: [entry]} for one repo; entry carries the repo's own description."""
    q = dq()
    repo = q.resolve_repo(repo_arg)
    data, _kind = q.load_dataset(repo)
    name = os.path.basename(repo)
    entities = {}

    def add(key, entry):
        entities.setdefault(key, []).append(entry)

    for collection, field in (("figures", "role"), ("organizations", "relation")):
        for i, rec in enumerate(data.get(collection) or []):
            surface = rec.get("name") or ""
            if not surface:
                continue
            description = rec.get(field) or ""
            for variant in name_variants(surface):
                key = normal_name(variant)
                if not is_notable_name(key):
                    continue
                add(key, {"repo": name, "locator": "%s[%d]" % (collection, i),
                          "surface": surface, "kind": collection,
                          "description": " ".join(description.split()),
                          "dates": rec.get("dates") or rec.get("founded") or "",
                          "sources": rec.get("sources") or []})
    for surface, context in proper_nouns_in_facts(data):
        key = normal_name(surface)
        if not is_notable_name(key) or key in entities:
            continue
        add(key, {"repo": name, "locator": "facts", "surface": surface,
                  "kind": "facts", "description": context, "dates": "",
                  "sources": []})
    return name, entities


# --------------------------------------------------------------------------
# divergence detection
# --------------------------------------------------------------------------

AFFILIATION = {
    "member": r"\bmembers?\b|\bmembros?\b|\bmiembros?\b",
    "follower": r"\bfollowers?\b|\bseguidor(?:es)?\b|\bdisciples?\b|"
                r"\bdisc[ií]pulos?\b",
    "adjacent": r"\badjacent\b|\badjacente\b|\bassociated\b|\bassociado\b|"
                r"\bally\b|\baliado\b|\bfellow[- ]traveller\b",
    "initiate": r"\binitiat(?:e|ed|ion)\b|\biniciad[oa]\b|\binicia[cç][aã]o\b|"
                r"\bmuqaddam\b",
    "professor": r"\bprofessors?\b|\bacad[eê]mic[oa]?\b|\bscholar\b|"
                 r"\blecturer\b",
    "founder": r"\bfounders?\b|\bfundador(?:a|es)?\b|\bfounded\b|\bfundou\b",
    "leader": r"\bsuperior general\b|\bshaykh\b|\bleader\b|\bl[ií]der\b|"
              r"\bpresident\b|\bpresidente\b",
    "critic": r"\bcritic\b|\bcr[ií]tico\b|\bopponent\b|\badvers[aá]rio\b",
}

NEGATABLE = ("member", "follower", "initiate", "adjacent")
# a denial cue close in front of the affiliation word, with no clause break
NEG_CUE = re.compile(r"\b(?:never|not|no longer|nunca|n[aã]o|jamais|neither)\b"
                     r"[^.;:]{0,24}$", re.I)


def affiliation_terms(text):
    """Set of affiliation-type labels asserted in a description.

    A denied assertion ('never a member of it') is recorded as '!member', so an
    assertion and its denial land on different labels and get flagged. Denial
    is scoped per label: 'adjacent … never a member' yields {adjacent,!member},
    not a blanket negation of the sentence.
    """
    terms = set()
    flat = " ".join(str(text).split())
    for label, pattern in AFFILIATION.items():
        hits = list(re.finditer(pattern, flat, re.I))
        if not hits:
            continue
        if label in NEGATABLE:
            denied = [bool(NEG_CUE.search(flat[:h.start()])) for h in hits]
            if denied and all(denied):
                terms.add("!" + label)
                continue
        terms.add(label)
    return terms


STATUS_ORDER = {"contradiction": 0, "differs": 1, "ok": 2}


def divergence(entries):
    """('contradiction'|'differs'|'ok', reason) across per-repo descriptions.

    contradiction — one repo asserts what another denies ('member' vs
                    '!member'): the class of error a hand review caught.
    differs       — the affiliation vocabulary simply does not match; often
                    legitimate (different scope or period), worth an eye.
    """
    sets = [(e["repo"], affiliation_terms(e["description"])) for e in entries]
    labelled = [(repo, terms) for repo, terms in sets if terms]
    differs = None
    for i, (repo_a, terms_a) in enumerate(labelled):
        for repo_b, terms_b in labelled[i + 1:]:
            if repo_a == repo_b:
                continue
            for term in terms_a:
                other = term[1:] if term.startswith("!") else "!" + term
                if other in terms_b:
                    return "contradiction", "%s: %s says %s, %s says %s" % (
                        term.lstrip("!"), repo_a, term, repo_b, other)
            if terms_a != terms_b and differs is None:
                differs = "%s=%s vs %s=%s" % (
                    repo_a, ",".join(sorted(terms_a)) or "-",
                    repo_b, ",".join(sorted(terms_b)) or "-")
    if differs:
        return "differs", differs
    return "ok", ",".join(sorted(set(t for _, t in sets for t in t))) or "-"


def build_report(repo_args, min_repos=2):
    merged = {}
    repos = []
    for arg in repo_args:
        name, entities = collect_entities(arg)
        repos.append(name)
        for key, entries in entities.items():
            merged.setdefault(key, []).extend(entries)
    rows = []
    for key, entries in merged.items():
        present = sorted(set(e["repo"] for e in entries))
        if len(present) < min_repos:
            continue
        status, reason = divergence(entries)
        rows.append({"key": key, "repos": present, "status": status,
                     "reason": reason,
                     "entries": sorted(entries,
                                       key=lambda e: (e["repo"], e["locator"]))})
    rows.sort(key=lambda r: (STATUS_ORDER[r["status"]], -len(r["repos"]),
                             r["key"]))
    return {"repos": repos, "minRepos": min_repos, "shared": len(rows),
            "contradictions": sum(1 for r in rows
                                  if r["status"] == "contradiction"),
            "differs": sum(1 for r in rows if r["status"] == "differs"),
            "rows": rows}


def render(report, width=220):
    out = ["# xref | repos=%s | shared=%d | contradictions=%d | differs=%d | "
           "min-repos=%d"
           % (",".join(report["repos"]), report["shared"],
              report["contradictions"], report["differs"],
              report["minRepos"]),
           "status: CONTRADICTION = one repo asserts what another denies "
           "(member vs !member); DIFFERS = affiliation vocabulary "
           "(member/follower/adjacent/initiate/professor/founder/leader/critic)"
           " does not match. Both are review candidates, not errors — check the "
           "sources; divergence is often legitimate (different period or "
           "scope). Nothing here is auto-resolved.",
           "entity lines: <repo> <locator> | <surface> | <dates> | "
           "<description>"]
    for row in report["rows"]:
        out.append("")
        out.append("## %s [%s] %s :: %s"
                   % (row["key"], "|".join(row["repos"]),
                      row["status"].upper() if row["status"] != "ok" else "ok",
                      row["reason"]))
        for e in row["entries"]:
            desc = e["description"]
            if len(desc) > width:
                desc = desc[:width - 1] + "…"
            out.append("%s %s | %s | %s | %s"
                       % (e["repo"], e["locator"], e["surface"],
                          e["dates"] or "-", desc or "-"))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="xref.py",
        description="Cross-repo consistency: entities shared by 2+ datasets, "
                    "with each repo's own description side by side. Read-only, "
                    "never auto-resolves.",
        epilog="Default repos: %s" % ",".join(DEFAULT_REPOS))
    ap.add_argument("--repos", default=",".join(DEFAULT_REPOS),
                    help="comma-separated repo names or paths")
    ap.add_argument("--min-repos", type=int, default=2, metavar="N",
                    help="only entities present in N+ repos (default 2)")
    ap.add_argument("--flagged", action="store_true",
                    help="only entities whose descriptions diverge "
                         "(contradiction or differs)")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args(argv)

    targets = [r.strip() for r in args.repos.split(",") if r.strip()]
    try:
        report = build_report(targets, args.min_repos)
    except (IOError, OSError, ValueError) as exc:
        sys.stderr.write("xref: %s\n" % exc)
        return 1
    if args.flagged:
        report["rows"] = [r for r in report["rows"] if r["status"] != "ok"]
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
