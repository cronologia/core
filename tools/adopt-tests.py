#!/usr/bin/env python3
"""adopt-tests — bring a site's shared tests in step with the template (core#121).

The template's `test/*.test.js` are shared machinery, like build.js. Each may
carry `// >>> ADOPT: <label>` ... `// <<< ADOPT` regions: the site's dataset
file name, its allowlists. This tool writes the template's version of every
shared test into a site, carrying the site's own ADOPT region contents across
by label, so adopting a template fix never loses a site's configuration.

A test the site declares under "tests" in `.template-drift.json` is a
deliberate customisation and is left alone: port template changes into it by
hand, then bump its `base` (tools/build-drift.py reports it STALE until then).

Usage:
    python3 tools/adopt-tests.py <site-dir> [--dry-run]
Prints one line per test: added, updated, ok, or kept (declared).
Stdlib only.
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_TESTS = os.path.join(os.path.dirname(HERE), "template", "test")
REGION_RE = re.compile(r"(// >>> ADOPT:?\s*([^\n]*)\n)(.*?)(// <<< ADOPT)", re.S)


def region_label(raw):
    """'dataset  (this repo's dataset file)' -> 'dataset'."""
    return raw.split("(")[0].strip()


def site_regions(text):
    return {region_label(m.group(2)): m.group(3) for m in REGION_RE.finditer(text)}


def merge(template_text, site_text):
    """The template's test with the site's ADOPT region contents, by label."""
    keep = site_regions(site_text) if site_text else {}
    return REGION_RE.sub(lambda m: m.group(1) + keep.get(region_label(m.group(2)), m.group(3)) + m.group(4),
                         template_text)


def adopt(site, dry_run=False):
    decl_path = os.path.join(site, ".template-drift.json")
    declared = {}
    if os.path.exists(decl_path):
        with open(decl_path, encoding="utf-8") as fh:
            declared = json.load(fh).get("tests", {})
    results = []
    os.makedirs(os.path.join(site, "test"), exist_ok=True)
    for name in sorted(os.listdir(TEMPLATE_TESTS)):
        if not name.endswith(".test.js"):
            continue
        if name in declared:
            results.append(("kept", name))
            continue
        with open(os.path.join(TEMPLATE_TESTS, name), encoding="utf-8") as fh:
            tpl = fh.read()
        dest = os.path.join(site, "test", name)
        current = None
        if os.path.exists(dest):
            with open(dest, encoding="utf-8") as fh:
                current = fh.read()
        new = merge(tpl, current)
        status = "added" if current is None else ("ok" if new == current else "updated")
        if status != "ok" and not dry_run:
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(new)
        results.append((status, name))
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("site")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    for status, name in adopt(args.site, args.dry_run):
        print(f"{status:<8} test/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
