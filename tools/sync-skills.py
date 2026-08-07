#!/usr/bin/env python3
"""sync-skills — vendor the shared skills into a project repo.

The skills in `cronologia/core` → `skills/` are canonical, but an agent working
inside `cronologia/fsspx` only discovers skills that live in that checkout. So
the skills are **vendored**: a committed, pinned copy under the project's
`.claude/skills/`, refreshed by this script and never hand-edited — exactly the
pattern already used for `data/glossary-terms.json` (see core ADR-0002).

Copies `core/skills/<name>/SKILL.md` -> `<repo>/.claude/skills/<name>/SKILL.md`
and writes `<repo>/.claude/skills/_synced.json`, a manifest recording the source
repo, the skill names with content hashes, the sync date, and the fact that the
files are GENERATED — edits belong upstream in cronologia/core.

`--check` writes nothing and exits non-zero when a target is stale (a skill is
missing, its content differs, or it no longer exists upstream), so CI or an
agent can detect drift.

Agent-side tooling: Python 3 stdlib only, never runs in CI-as-build, and it
never touches `data/` — the only files it writes are the vendored copies under
`.claude/skills/`.

Usage:
  python3 tools/sync-skills.py <repo> [<repo> ...]        # sync
  python3 tools/sync-skills.py <repo> --check             # drift check
  python3 tools/sync-skills.py <repo> --skills a,b        # subset
  python3 tools/sync-skills.py --list                     # what's canonical
"""

import argparse
import datetime
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORE_ROOT = os.path.dirname(HERE)
SKILLS_DIR = os.path.join(CORE_ROOT, "skills")
VENDOR_REL = os.path.join(".claude", "skills")
MANIFEST_NAME = "_synced.json"
SOURCE_REPO = "cronologia/core"
GENERATED_NOTE = ("GENERATED — vendored copies of cronologia/core skills/. "
                  "Do not edit here; edit in cronologia/core and re-run "
                  "core/tools/sync-skills.py. Verify with --check.")

def family_root():
    env = os.environ.get("CRONOLOGIA_HOME")
    if env:
        return env
    return os.path.dirname(CORE_ROOT)


def known_repos():
    """Sibling checkouts that look like project repos, for the help text.

    Derived, not listed. The hardcoded tuple this replaces named five repos of
    the twenty-one that exist, having been written when there were five — the
    mirroring defect core ADR-0008 retires, in miniature.
    """
    root = family_root()
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return []
    found = []
    for name in names:
        path = os.path.join(root, name)
        if name.startswith(".") or path == CORE_ROOT or not os.path.isdir(path):
            continue
        if os.path.isdir(os.path.join(path, "data")) or \
                os.path.isdir(os.path.join(path, VENDOR_REL)):
            found.append(name)
    return found


def resolve_repo(name):
    """A bare repo name ('fsspx') or a path -> the repo directory."""
    if os.path.isdir(os.path.join(name, ".git")) or \
            os.path.isdir(os.path.join(name, "data")):
        return os.path.abspath(name)
    candidate = os.path.join(family_root(), name)
    if os.path.isdir(candidate):
        return candidate
    return os.path.abspath(name)


def digest(text):
    """Stable content hash, newline-normalized so CRLF checkouts don't churn."""
    return hashlib.sha256(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def discover_skills(skills_dir=SKILLS_DIR, only=None):
    """[(name, path, text)] for every canonical skill, sorted by name."""
    if not os.path.isdir(skills_dir):
        raise IOError("no skills directory at %s" % skills_dir)
    found = []
    for name in sorted(os.listdir(skills_dir)):
        path = os.path.join(skills_dir, name, "SKILL.md")
        if not os.path.isfile(path):
            continue
        if only and name not in only:
            continue
        with open(path, encoding="utf-8") as fh:
            found.append((name, path, fh.read()))
    return found


def read_manifest(vendor_dir):
    path = os.path.join(vendor_dir, MANIFEST_NAME)
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def manifest_payload(skills, synced_at):
    """The _synced.json body. `skills` is [(name, path, text)]."""
    return {
        "_comment": GENERATED_NOTE,
        "source": SOURCE_REPO,
        "sourcePath": "skills/",
        "syncedAt": synced_at,
        "tool": "core/tools/sync-skills.py",
        "skills": [{"name": name, "sha256": digest(text), "bytes": len(text)}
                   for name, _path, text in skills],
    }


def plan(skills, vendor_dir):
    """[(status, name)] — what syncing this target would do.

    add     the vendored copy is missing
    update  it exists but its content differs from the canonical skill
    stale   it exists here but no longer exists upstream (would be removed)
    ok      identical
    """
    actions = []
    canonical = {}
    for name, _path, text in skills:
        canonical[name] = text
        dest = os.path.join(vendor_dir, name, "SKILL.md")
        if not os.path.isfile(dest):
            actions.append(("add", name))
            continue
        with open(dest, encoding="utf-8") as fh:
            current = fh.read()
        actions.append(("ok" if digest(current) == digest(text) else "update",
                        name))
    if os.path.isdir(vendor_dir):
        for name in sorted(os.listdir(vendor_dir)):
            if name in canonical:
                continue
            if os.path.isfile(os.path.join(vendor_dir, name, "SKILL.md")):
                actions.append(("stale", name))
    return sorted(actions, key=lambda item: item[1])


def manifest_current(manifest, skills, actions):
    """True when the manifest matches the canonical set exactly."""
    if not isinstance(manifest, dict):
        return False
    recorded = {entry.get("name"): entry.get("sha256")
                for entry in manifest.get("skills", [])
                if isinstance(entry, dict)}
    expected = {name: digest(text) for name, _path, text in skills}
    if recorded != expected:
        return False
    return all(status == "ok" for status, _name in actions)


def apply_plan(skills, vendor_dir, actions, synced_at):
    """Write the vendored copies + manifest. Returns the number of changes."""
    text_by_name = {name: text for name, _path, text in skills}
    changed = 0
    for status, name in actions:
        dest_dir = os.path.join(vendor_dir, name)
        dest = os.path.join(dest_dir, "SKILL.md")
        if status in ("add", "update"):
            os.makedirs(dest_dir, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(text_by_name[name])
            changed += 1
        elif status == "stale":
            shutil.rmtree(dest_dir, ignore_errors=True)
            changed += 1
    os.makedirs(vendor_dir, exist_ok=True)
    with open(os.path.join(vendor_dir, MANIFEST_NAME), "w",
              encoding="utf-8") as fh:
        json.dump(manifest_payload(skills, synced_at), fh,
                  ensure_ascii=False, indent=1)
        fh.write("\n")
    return changed


def process(target, skills, check, synced_at):
    """One target repo -> a result dict (no output, no exit)."""
    repo = resolve_repo(target)
    if not os.path.isdir(repo):
        return {"repo": os.path.basename(str(target)), "path": repo,
                "error": "no such directory", "actions": [], "stale": True}
    vendor_dir = os.path.join(repo, VENDOR_REL)
    actions = plan(skills, vendor_dir)
    manifest = read_manifest(vendor_dir)
    fresh = manifest_current(manifest, skills, actions)
    result = {"repo": os.path.basename(repo.rstrip(os.sep)), "path": repo,
              "vendorDir": vendor_dir, "actions":
                  [{"status": s, "skill": n} for s, n in actions],
              "manifest": "current" if fresh else
                          ("missing" if manifest is None else "outdated"),
              "stale": not fresh}
    if not check:
        result["written"] = apply_plan(skills, vendor_dir, actions, synced_at)
        result["stale"] = False
        result["manifest"] = "current"
    return result


def render(results, skills, check):
    counts = {}
    for result in results:
        for action in result["actions"]:
            counts[action["status"]] = counts.get(action["status"], 0) + 1
    head = "# sync-skills | mode=%s | skills=%d | targets=%d" % (
        "check" if check else "sync", len(skills), len(results))
    out = [head,
           "source: %s skills/ -> <repo>/%s/<name>/SKILL.md (+ %s)"
           % (SOURCE_REPO, VENDOR_REL, MANIFEST_NAME),
           "vendored copies are GENERATED — edit skills in cronologia/core",
           "fields: repo | status | skill"]
    for result in results:
        out.append("")
        if result.get("error"):
            out.append("## %s — error: %s" % (result["repo"], result["error"]))
            continue
        out.append("## %s (%s) — manifest=%s%s"
                   % (result["repo"], result["path"], result["manifest"],
                      " | STALE" if result.get("stale") else ""))
        for action in result["actions"]:
            out.append("%s | %s | %s"
                       % (result["repo"], action["status"], action["skill"]))
        if not result["actions"]:
            out.append("%s | none | -" % result["repo"])
    out.append("")
    out.append("totals: " + (", ".join("%s=%d" % (k, counts[k])
                                       for k in sorted(counts)) or "none"))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="sync-skills.py",
        description="Vendor cronologia/core skills/ into a project's "
                    ".claude/skills/ as a pinned, generated copy.",
        epilog="Repos may be names (%s) or paths. --check writes nothing and "
               "exits 1 when a target is stale."
               % (", ".join(known_repos()) or "none found alongside core"))
    ap.add_argument("repos", nargs="*", help="target repo names or paths")
    ap.add_argument("--check", action="store_true",
                    help="report drift without writing; exit 1 if stale")
    ap.add_argument("--skills", help="comma-separated subset of skill names")
    ap.add_argument("--list", action="store_true",
                    help="list the canonical skills and exit")
    ap.add_argument("--json", action="store_true", help="JSON output")
    args = ap.parse_args(argv)

    only = None
    if args.skills:
        only = [s.strip() for s in args.skills.split(",") if s.strip()]
    try:
        skills = discover_skills(only=only)
    except IOError as exc:
        sys.stderr.write("error: %s\n" % exc)
        return 1
    if only:
        missing = sorted(set(only) - {name for name, _p, _t in skills})
        if missing:
            sys.stderr.write("error: unknown skill(s): %s\n"
                             % ", ".join(missing))
            return 2
    if not skills:
        sys.stderr.write("error: no skills found in %s\n" % SKILLS_DIR)
        return 1

    if args.list:
        payload = [{"name": name, "sha256": digest(text), "bytes": len(text)}
                   for name, _path, text in skills]
        if args.json:
            print(json.dumps({"source": SOURCE_REPO, "skills": payload},
                             ensure_ascii=False, indent=1))
        else:
            print("# sync-skills | canonical skills in %s skills/ | %d"
                  % (SOURCE_REPO, len(skills)))
            for entry in payload:
                print("%s | %d B | %s"
                      % (entry["name"], entry["bytes"], entry["sha256"][:12]))
        return 0

    if not args.repos:
        sys.stderr.write("error: no target repo given (see --help; --list "
                         "shows the canonical skills)\n")
        return 2

    synced_at = datetime.date.today().isoformat()
    results = [process(target, skills, args.check, synced_at)
               for target in args.repos]

    if args.json:
        print(json.dumps({"mode": "check" if args.check else "sync",
                          "source": SOURCE_REPO, "targets": results},
                         ensure_ascii=False, indent=1))
    else:
        print(render(results, skills, args.check))

    if any(r.get("error") for r in results):
        return 2
    if args.check and any(r.get("stale") for r in results):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
