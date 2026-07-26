#!/usr/bin/env python3
"""Drift check for the template scripts vendored into adopting repos.

Why this exists
---------------
Vendored SKILLS have drift detection (`sync-skills.py --check`). Vendored
template SCRIPTS had none, and the cost was measured rather than imagined:

- `check-links.js` gained `headerSafe()` in the template (core#12) to stop an
  em dash in a project title making every `fetch` throw. The fix reached
  exactly ONE repo - fsspx, where it was written. Four repos grew four
  different local variants, and in two of them the sanitiser was absent
  entirely, so link-health reported EVERY reference as inconclusive for months
  while looking healthy.
- `translate.js` gained a provenance fix that reached NO adopting repo until it
  was ported by hand, and even then one call site was missed in all five.

A byte-comparison cannot express this, because adopting repos legitimately
customise parts of these files. So the template DECLARES its adoption points
with marker comments, and everything outside them must match.

The contract
------------
In a template script:

    // >>> ADOPT: user-agent  (one line explaining what a repo may change)
    const UA = 'cronologia-archive-refs/1.0 (...)';
    // <<< ADOPT

Everything outside an ADOPT block is SHARED MACHINERY and must match the
template exactly, modulo blank lines. Everything inside is the repo's own.

Which scripts are shared
------------------------
Measured across the five adopting repos (changed lines vs a template of N):

    archive-refs.js        0-2 of 258     shared; one User-Agent string
    translate.js           2-6 of 173     shared; TRANSLATABLE_KEYS varies
    check-links.js        20-45 of 450    shared; UA + per-repo skip lists
    validate-data.js     44-363 of 321    NOT SHARED - see below

`validate-data.js` is deliberately NOT checked. Each repo validates its own
schema, and glossary's differs from the template in 363 of 321 lines: it is a
different program that happens to share a filename. Checking it would emit
constant noise, the check would be muted, and the muting would take the real
signal with it. It is seeded by the template and owned by the repo.

Usage
-----
    python3 tools/template-drift.py            # report drift, exit 1 if any
    python3 tools/template-drift.py --repo rcc # one repo
    python3 tools/template-drift.py --json
"""

import argparse
import difflib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
ROOT = os.path.dirname(CORE)
TEMPLATE = os.path.join(CORE, "template", "scripts")

# Scripts whose machinery is shared and therefore drift-checked.
SHARED = ("archive-refs.js", "check-links.js", "translate.js", "sync-glossary-terms.js")

# Deliberately excluded, with the reason, so the omission is not mistaken for
# an oversight. See the module docstring.
NOT_SHARED = {
    "validate-data.js": "each repo validates its own schema; glossary's differs "
                        "in 363 of 321 lines. Seeded by the template, owned by "
                        "the repo.",
}

REPOS = ("fsspx", "tariqa", "perennialism", "rcc", "glossary")

ADOPT_OPEN = re.compile(r"^\s*//\s*>>>\s*ADOPT:\s*(.+?)\s*$")
ADOPT_CLOSE = re.compile(r"^\s*//\s*<<<\s*ADOPT\s*$")


def strip_adopt_blocks(lines):
    """Return (shared_lines, adopt_point_names).

    Lines inside an ADOPT block are replaced by a single placeholder carrying
    the block's name, so a repo may put anything there but may not delete the
    block or invent one the template does not declare.
    """
    out, names, depth = [], [], 0
    for line in lines:
        m = ADOPT_OPEN.match(line)
        if m:
            depth += 1
            if depth == 1:
                names.append(m.group(1))
                out.append("<<ADOPT:%s>>" % m.group(1))
            continue
        if ADOPT_CLOSE.match(line):
            depth = max(0, depth - 1)
            continue
        if depth == 0:
            out.append(line)
    return out, names


def strip_module_docblock(text):
    """Drop the leading /** ... */ module comment before comparing.

    The header docblock describes the script for the repo it sits in, and a
    repo legitimately says so: glossary's copies read data/glossary.json and
    their prose says data/glossary.json. That is adaptation of DOCUMENTATION,
    not of machinery.

    This check exists to catch a FIX that landed in the template and never
    reached the repos running the code, and a fix is code. Comparing header
    prose would emit permanent noise for every repo whose dataset is named
    differently - and a check that always fails gets muted, taking the real
    signal with it. Code outside the ADOPT blocks is still compared in full.
    """
    lines = text.splitlines()
    i = 0
    # skip a shebang, a "use strict" pragma and any blank lines before the docblock
    while i < len(lines) and (
        not lines[i].strip()
        or lines[i].lstrip().startswith("#!")
        or lines[i].strip().strip(";").strip("'\"") == "use strict"
    ):
        i += 1
    if i < len(lines) and lines[i].lstrip().startswith("/*"):
        while i < len(lines) and "*/" not in lines[i]:
            i += 1
        i += 1
    return "\n".join(lines[i:])


def strip_comments(lines):
    """Drop comments, so only executable code is compared.

    Run AFTER strip_adopt_blocks, which needs the marker comments intact.

    Comment prose is legitimately per-repo: glossary's copies say "primary
    reference" where a chronology says "official reference", and name their own
    dataset in a report string. Diffing prose would report drift forever, the
    check would be muted, and the muting would hide the code drift this exists
    to find - which is exactly how headerSafe went unpropagated to four repos
    while link-health silently reported every reference as inconclusive.

    The trade-off is explicit: a comment-only change in the template will not be
    flagged. That is accepted. A comment-only change is not a fix.
    """
    out, in_block = [], False
    for ln in lines:
        stripped = ln.strip()
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("/*"):
            if "*/" not in stripped:
                in_block = True
            continue
        if stripped.startswith("//"):
            continue
        out.append(ln)
    return out


def normalise(text):
    """Drop the module docblock, blank lines and trailing whitespace."""
    return [ln.rstrip() for ln in strip_module_docblock(text).splitlines() if ln.strip()]


def compare(template_text, repo_text):
    t_lines, t_names = strip_adopt_blocks(normalise(template_text))
    r_lines, r_names = strip_adopt_blocks(normalise(repo_text))
    t_lines, r_lines = strip_comments(t_lines), strip_comments(r_lines)
    if t_lines == r_lines:
        return None
    diff = list(difflib.unified_diff(t_lines, r_lines, "template", "repo", lineterm="", n=1))
    return {
        "adoptPointsInTemplate": t_names,
        "adoptPointsInRepo": r_names,
        "missingAdoptPoints": [n for n in t_names if n not in r_names],
        "changedLines": sum(1 for d in diff if d[:1] in "+-" and d[:3] not in ("---", "+++")),
        "diff": diff[:40],
    }


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", action="append", help="limit to one repo (repeatable)")
    ap.add_argument("--scripts", help="check this scripts/ directory directly (for CI, where "
                                      "the adopting repo is the workspace and core is a "
                                      "side checkout)")
    ap.add_argument("--label", default="repo", help="name to show for --scripts")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--root", default=ROOT)
    args = ap.parse_args(argv)

    if args.scripts:
        pairs = [(args.label, args.scripts)]
    else:
        pairs = [(r, os.path.join(args.root, r, "scripts")) for r in (args.repo or list(REPOS))]

    repos = [p[0] for p in pairs]
    findings = []
    for repo, scripts_dir in pairs:
        for name in SHARED:
            tpl = os.path.join(TEMPLATE, name)
            own = os.path.join(scripts_dir, name)
            if not os.path.exists(tpl) or not os.path.exists(own):
                continue
            with open(tpl, encoding="utf-8") as fh:
                t = fh.read()
            with open(own, encoding="utf-8") as fh:
                r = fh.read()
            result = compare(t, r)
            if result:
                result.update({"repo": repo, "script": name})
                findings.append(result)

    if args.json:
        json.dump(findings, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 1 if findings else 0

    checked = len(repos) * len(SHARED)
    print("template drift: %d shared script(s) x %d repo(s)" % (len(SHARED), len(repos)))
    for name, why in sorted(NOT_SHARED.items()):
        print("  not checked: %-20s %s" % (name, why))
    if not findings:
        print("\nno drift - every shared script matches the template outside its ADOPT blocks")
        return 0
    print("\n%d drifting file(s):\n" % len(findings))
    for f in findings:
        print("  %s / %s  (%d line(s) outside ADOPT blocks)" % (f["repo"], f["script"], f["changedLines"]))
        if f["missingAdoptPoints"]:
            print("     MISSING ADOPT POINTS: %s" % ", ".join(f["missingAdoptPoints"]))
        for line in f["diff"][2:12]:
            print("       %s" % line)
        print()
    print("A fix that lands in the template and not here is the failure mode this")
    print("check exists to catch. Port it, or declare the difference as an ADOPT point.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
