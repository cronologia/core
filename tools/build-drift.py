#!/usr/bin/env python3
"""Has the template's build machinery reached every site, and is every
site-specific change to it declared?

Why this exists
---------------
`template-drift.py` watches the shared SCRIPTS. Nothing watched `build.js`,
the tests' shared machinery or the stylesheet blocks, and the cost was
measured during the time-river rollout (core#108): 21 of 22 sites had copies
of `build.js` between two weeks and two months old, and three of them carried
fixes the template never received (cimbres translated `founded`, rcc the
lineage legend and the numbers chart). Bringing each site up to date meant
first finding out, by hand, which differences were old template, which were
local fixes, and which were deliberate features - a 3-way merge in olavo's
case. Every one of those questions is answerable mechanically, and answering
it weekly keeps it a one-line fix rather than an archaeology project.

What it checks, per site
------------------------
1. build.js, function by function. Every top-level `function` the template
   defines must exist in the site (MISSING otherwise: machinery not adopted)
   and be identical to the template's - unless the site DECLARES it
   customised in `.template-drift.json`:

       { "customized": {
           "renderPage": { "reason": "fsspx page order (fsspx#28)",
                           "base": "3f2a9c01b7e4" } } }

   `base` is the hash of the TEMPLATE's version of that function when the
   site's customisation was last reconciled with it. When the template's
   function changes, the declaration goes STALE: a core fix has not reached a
   customised copy, and someone must port it and bump `base`. This is the
   case that silently failed before - a fix inside a function a site had
   changed was invisible to everyone.
   Functions a site adds are its own business and are not reported.
2. TRANSLATABLE_KEYS: the template's keys must all be present (a site may add
   its own). A key the template translates and the site does not is English
   on the site's localized pages.
3. src/river.js must be byte-identical to the template's.
4. The self-contained stylesheet blocks (time river, dark mode) must be
   identical to the template's. A site may add rules of its own anywhere
   else in its stylesheet.

What it deliberately does NOT check: the UI string tables and other data
literals (sites extend them; the sites' own tests render them), and the whole
stylesheet (every site's copy has a history; the blocks are the contract).

Usage
-----
    python3 tools/build-drift.py                   # discover sites, fetch from GitHub
    python3 tools/build-drift.py --repos cristo,rcc
    python3 tools/build-drift.py --root ..         # sibling checkouts instead of fetching
    python3 tools/build-drift.py --hash renderPage # print a template function's hash
Exit status 1 when any site has a finding. Stdlib only, no token.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
TEMPLATE = os.path.join(CORE, "template")
RAW = "https://raw.githubusercontent.com/cronologia/{repo}/main/{path}"
DECL = ".template-drift.json"

# The self-contained stylesheet blocks: each starts at its header comment and
# runs to the next header comment of the same shape or to the end of file.
CSS_BLOCKS = ("Time river (core#108)", "Dark mode (core#113)")
CSS_HEADER = "/* ---------------------------------------------------------------------------"

FUNC_RE = re.compile(r"^(?:async )?function ([A-Za-z0-9_$]+)\(")


def functions(src):
    """Top-level function declarations: name -> full text (to the closing `}` line)."""
    out, lines, i = {}, src.split("\n"), 0
    while i < len(lines):
        m = FUNC_RE.match(lines[i])
        if not m:
            i += 1
            continue
        j = i
        while j < len(lines) and lines[j] != "}":
            j += 1
        out[m.group(1)] = "\n".join(lines[i:j + 1])
        i = j + 1
    return out


def fhash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def translatable_keys(src):
    body = re.search(r"const TRANSLATABLE_KEYS = new Set\(\[(.*?)\]\);", src, re.S)
    if not body:
        return None
    code = re.sub(r"//[^\n]*", "", body.group(1))
    return set(re.findall(r"'([^']+)'", code))


def css_block(css, marker):
    at = css.find(marker)
    if at == -1:
        return None
    start = css.rfind(CSS_HEADER, 0, at)
    end = css.find("\n" + CSS_HEADER, at)
    return css[start:end if end != -1 else len(css)].strip()


def read_local(root, repo, path):
    try:
        with open(os.path.join(root, repo, path), encoding="utf-8") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def read_remote(repo, path, timeout=30):
    req = urllib.request.Request(RAW.format(repo=repo, path=path),
                                 headers={"User-Agent": "cronologia-build-drift/1.0 (+https://github.com/cronologia/core)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def check_site(read, tpl):
    """Findings for one site: list of (kind, detail). Empty = in step."""
    findings = []
    build = read("build.js")
    if build is None:
        return [("NO-BUILD", "build.js not found")]
    decl_raw = read(DECL)
    try:
        declared = (json.loads(decl_raw).get("customized", {}) if decl_raw else {})
    except json.JSONDecodeError as e:
        return [("BAD-DECLARATION", f"{DECL} is not valid JSON: {e}")]

    site_fns = functions(build)
    for name, text in tpl["functions"].items():
        if name not in site_fns:
            findings.append(("MISSING", f"{name}() - template machinery not adopted"))
            continue
        same = site_fns[name] == text
        d = declared.get(name)
        if d is None:
            if not same:
                findings.append(("DRIFT", f"{name}() differs from the template and is not declared in {DECL}"))
        elif same:
            findings.append(("UNUSED-DECLARATION", f"{name}() is declared customized but matches the template; remove it from {DECL}"))
        elif d.get("base") != fhash(text):
            findings.append(("STALE", f"{name}(): the template's version changed since this customisation was reconciled "
                                      f"(declared base {d.get('base')}, template now {fhash(text)}); port the change, then bump base"))
    for name in declared:
        if name not in tpl["functions"]:
            findings.append(("UNUSED-DECLARATION", f"{name}() is declared but the template defines no such function"))

    site_keys = translatable_keys(build)
    if site_keys is None:
        findings.append(("DRIFT", "TRANSLATABLE_KEYS not found in build.js"))
    else:
        missing = sorted(tpl["keys"] - site_keys)
        if missing:
            findings.append(("DRIFT", f"TRANSLATABLE_KEYS lacks template keys: {', '.join(missing)}"))

    river = read("src/river.js")
    if river is None:
        findings.append(("MISSING", "src/river.js"))
    elif river != tpl["river"]:
        findings.append(("DRIFT", "src/river.js differs from the template"))

    css = read("src/styles.css") or ""
    for marker in CSS_BLOCKS:
        at = css.find(marker)
        if at == -1:
            findings.append(("MISSING", f"stylesheet block '{marker}'"))
            continue
        # The site's text from the block's header on must START with the
        # template's block: a site may follow it with rules of its own.
        start = css.rfind(CSS_HEADER, 0, at)
        if not css[start:].startswith(tpl["css"][marker]):
            findings.append(("DRIFT", f"stylesheet block '{marker}' differs from the template"))
    return findings


def load_template():
    with open(os.path.join(TEMPLATE, "build.js"), encoding="utf-8") as fh:
        build = fh.read()
    with open(os.path.join(TEMPLATE, "src", "river.js"), encoding="utf-8") as fh:
        river = fh.read()
    with open(os.path.join(TEMPLATE, "src", "styles.css"), encoding="utf-8") as fh:
        css = fh.read()
    return {
        "functions": functions(build),
        "keys": translatable_keys(build),
        "river": river,
        "css": {m: css_block(css, m) for m in CSS_BLOCKS},
    }


def discover():
    """The sites the portal publishes - the same list published-drift.py checks."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("published_drift", os.path.join(HERE, "published-drift.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.discover_slugs()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repos", default="", help="comma-separated slugs (default: discover from the portal)")
    ap.add_argument("--root", default="", help="read sibling checkouts under this directory instead of fetching")
    ap.add_argument("--hash", default="", help="print the hash of a template function and exit")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    tpl = load_template()
    if args.hash:
        if args.hash not in tpl["functions"]:
            print(f"template defines no function {args.hash}()", file=sys.stderr)
            return 2
        print(fhash(tpl["functions"][args.hash]))
        return 0

    repos = [r.strip() for r in args.repos.split(",") if r.strip()] or discover()
    if not repos:
        print("No sites to check: the portal did not list any. That is a finding, not a pass.")
        return 1

    report, bad = {}, 0
    for repo in repos:
        if args.root:
            read = lambda path, repo=repo: read_local(args.root, repo, path)  # noqa: E731
        else:
            read = lambda path, repo=repo: read_remote(repo, path)  # noqa: E731
        try:
            findings = check_site(read, tpl)
        except (urllib.error.URLError, TimeoutError) as e:
            findings = [("UNREACHABLE", str(e))]
        report[repo] = findings
        if findings:
            bad += 1

    if args.json:
        print(json.dumps({r: [{"kind": k, "detail": d} for k, d in f] for r, f in report.items()}, indent=2))
    else:
        for repo, findings in report.items():
            if not findings:
                print(f"ok    {repo}")
            for kind, detail in findings:
                print(f"{kind:<19} {repo}: {detail}")
        print(f"\n{len(report) - bad} of {len(report)} site(s) in step with the template.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
