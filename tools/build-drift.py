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
3. The client scripts (src/river.js, src/cite.js) must be byte-identical to
   the template's.
4. The self-contained stylesheet blocks (time river, citation previews, look
   and feel, print, dark mode) must be
   identical to the template's. A site may add rules of its own anywhere
   else in its stylesheet.
6. The shared tests (core#121): every `test/*.test.js` the template ships
   must exist in the site and match it OUTSIDE its `// >>> ADOPT` ...
   `// <<< ADOPT` regions (those hold the site's dataset name and allowlists
   by design). A site that must change a shared test declares it under
   `"tests"` in `.template-drift.json`, with a reason and the template test's
   hash as `base` - the same contract, and the same STALE signal, as a
   customised function. A test a site needs in addition goes in a new file.
5. The vendored skills: the site's `.claude/skills/_synced.json` must record
   the same skills, with the same hashes, as core's `skills/` (core#117). A
   core change to a skill otherwise turns every site's CI red on its next,
   unrelated push - which is how the #114 skill edit surfaced.

What it deliberately does NOT check: the UI string tables and other data
literals (sites extend them; the sites' own tests render them), and the whole
stylesheet (every site's copy has a history; the blocks are the contract).

Usage
-----
    python3 tools/build-drift.py                   # discover sites, fetch from GitHub
    python3 tools/build-drift.py --repos cristo,rcc
    python3 tools/build-drift.py --root ..         # sibling checkouts instead of fetching
    python3 tools/build-drift.py --hash renderPage # print a template function's hash
    python3 tools/build-drift.py --hash data-invariants.test.js   # ... or a shared test's
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
SKILLS_MANIFEST = ".claude/skills/_synced.json"

# The self-contained stylesheet blocks: each starts at its header comment and
# runs to the next header comment of the same shape or to the end of file.
CSS_BLOCKS = ("Time river (core#108)", "Citation previews (core#119)", "Look and feel (core#118)", "Print (core#3)", "Dark mode (core#113)")
# Client scripts a site ships byte-identical to the template.
CLIENT_SCRIPTS = ("src/river.js", "src/cite.js")
CSS_HEADER = "/* ---------------------------------------------------------------------------"

ADOPT_RE = re.compile(r"(// >>> ADOPT[^\n]*\n).*?(// <<< ADOPT)", re.S)

FUNC_RE = re.compile(r"^(?:async )?function ([A-Za-z0-9_$]+)\(")

# Sites the portal lists whose build.js is NOT a copy of the template: a
# different program that shares the filename. Checking them would report
# every template function as MISSING forever, the check would be muted, and
# the muting would take the real signal with it (template-drift.py excludes
# validate-data.js for the same reason). Listed with the reason so the
# omission is not mistaken for an oversight.
NOT_TEMPLATE_BUILD = {
    "fsp": "its own generator over data/forum.json (the Foro de Sao Paulo site); "
           "shares the architecture, not the code",
    "glossary": "its own generator over data/glossary.json, one page per term; "
                "the template's chronology renderers do not apply",
}


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


def mask_adopt(text):
    """A shared test with its ADOPT regions' contents blanked."""
    return ADOPT_RE.sub(lambda m: m.group(1) + m.group(2), text)


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

    for rel in CLIENT_SCRIPTS:
        text = read(rel)
        if text is None:
            findings.append(("MISSING", rel))
        elif text != tpl["scripts"][rel]:
            findings.append(("DRIFT", f"{rel} differs from the template"))

    if tpl.get("tests") is not None:
        declared_tests = {}
        if decl_raw:
            declared_tests = json.loads(decl_raw).get("tests", {})
        for name, text in sorted(tpl["tests"].items()):
            site_text = read(f"test/{name}")
            d = declared_tests.get(name)
            if d is None:
                if site_text is None:
                    findings.append(("MISSING", f"test/{name} - shared test not adopted"))
                elif mask_adopt(site_text) != text:
                    findings.append(("DRIFT", f"test/{name} differs from the template outside its ADOPT regions and is not declared in {DECL}"))
            elif site_text is not None and mask_adopt(site_text) == text:
                findings.append(("UNUSED-DECLARATION", f"test/{name} is declared customized but matches the template; remove it from {DECL}"))
            elif d.get("base") != fhash(text):
                findings.append(("STALE", f"test/{name}: the template's version changed since this customisation was reconciled "
                                          f"(declared base {d.get('base')}, template now {fhash(text)}); port the change, then bump base"))
        for name in declared_tests:
            if name not in tpl["tests"]:
                findings.append(("UNUSED-DECLARATION", f"test/{name} is declared but the template ships no such test"))

    if tpl.get("skills") is not None:
        raw = read(SKILLS_MANIFEST)
        try:
            recorded = {e.get("name"): e.get("sha256") for e in json.loads(raw).get("skills", [])} if raw else None
        except (json.JSONDecodeError, AttributeError):
            recorded = None
        if recorded is None:
            findings.append(("MISSING", f"{SKILLS_MANIFEST} (vendored skills)"))
        else:
            stale = sorted(n for n in set(tpl["skills"]) | set(recorded) if tpl["skills"].get(n) != recorded.get(n))
            if stale:
                findings.append(("SKILLS", f"vendored skills behind core: {', '.join(stale)}; "
                                           f"run python3 core/tools/sync-skills.py <site> and commit"))

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


def canonical_skills():
    """name -> sha256 of core's skills, hashed exactly as sync-skills.py does."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("sync_skills", os.path.join(HERE, "sync-skills.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {name: mod.digest(text) for name, _path, text in mod.discover_skills()}


def load_template():
    with open(os.path.join(TEMPLATE, "build.js"), encoding="utf-8") as fh:
        build = fh.read()
    scripts = {}
    for rel in CLIENT_SCRIPTS:
        with open(os.path.join(TEMPLATE, rel), encoding="utf-8") as fh:
            scripts[rel] = fh.read()
    with open(os.path.join(TEMPLATE, "src", "styles.css"), encoding="utf-8") as fh:
        css = fh.read()
    tdir = os.path.join(TEMPLATE, "test")
    tests = {}
    for name in sorted(os.listdir(tdir)):
        if name.endswith(".test.js"):
            with open(os.path.join(tdir, name), encoding="utf-8") as fh:
                tests[name] = mask_adopt(fh.read())
    return {
        "tests": tests,
        "skills": canonical_skills(),
        "functions": functions(build),
        "keys": translatable_keys(build),
        "scripts": scripts,
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
    if args.hash and args.hash in tpl["tests"]:
        print(fhash(tpl["tests"][args.hash]))
        return 0
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
        if repo in NOT_TEMPLATE_BUILD:
            report[repo] = [("SKIPPED", NOT_TEMPLATE_BUILD[repo])]
            continue
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
            elif findings[0][0] == "SKIPPED":
                print(f"skip  {repo}: {findings[0][1]}")
            else:
                for kind, detail in findings:
                    print(f"{kind:<19} {repo}: {detail}")
        checked = [r for r, f in report.items() if not (f and f[0][0] == "SKIPPED")]
        print(f"\n{len(checked) - bad} of {len(checked)} template-built site(s) in step with the template.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
