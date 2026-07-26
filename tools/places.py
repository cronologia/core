#!/usr/bin/env python3
"""Place-string extraction and gazetteer drift check for the Cronologia family.

Why this exists
---------------
Every chronology event carries a free-text `place`. Maps need coordinates, and
the site build is network-free by policy (core ADR-0004), so coordinates cannot
be looked up at build time. They live in a committed gazetteer instead:
`core/data/places.json`, vendored into adopting repos.

Three defects in the raw data this tool exists to surface:

1. No coordinates anywhere — `place` is free text.
2. The same place is written more than one way. fsspx uses both
   "Écône, Valais, Switzerland" and "Écône"; both "Fribourg, Switzerland" and
   "Fribourg". Grouping by string treats these as different locations.
3. Compound places — ONE event in TWO locations: "Topeka / Los Angeles, USA",
   "Lucca, Italy / Rome", "Lausanne / United States". A parser that drops a pin
   on the first token silently loses the second, which for rcc would misplace
   the origin of the entire movement.

So a place string resolves to a LIST of gazetteer ids, never a single one.

On automated geocoding
----------------------
`--propose` queries OpenStreetMap Nominatim and prints candidates. It does NOT
write them. This is deliberate: geocoders return a confident top hit regardless
of correctness. Querying "Ecole Valais Switzerland" returns an aerialway platter
in Saint-Luc — the SSPX mother seminary placed on a ski lift. Every proposal
prints the full OSM display_name precisely so a wrong match is visible before a
human accepts it. Nothing enters the gazetteer unreviewed.

Usage
-----
    python3 tools/places.py --list            # distinct place strings + usage
    python3 tools/places.py --check           # unmapped strings (exit 1 if any)
    python3 tools/places.py --propose [N]     # Nominatim candidates for unmapped
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.dirname(HERE)
ROOT = os.path.dirname(CORE)
GAZETTEER = os.path.join(CORE, 'data', 'places.json')
REPOS = ('fsspx', 'tariqa', 'perennialism', 'rcc')

# A place string may name more than one location; this is the only separator
# the datasets use for that. Commas are address structure, NOT a separator.
COMPOUND_SEP = ' / '


def load_gazetteer(path=GAZETTEER):
    """Return (entries_by_id, variant_string -> [ids])."""
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}, {}
    entries = {e['id']: e for e in data.get('places', [])}
    index = {}
    for e in data.get('places', []):
        for v in [e['name']] + e.get('variants', []):
            bucket = index.setdefault(v.casefold(), [])
            # A name and one of its variants can be casefold-equal ("International"
            # vs "international"); that must resolve to one id, not two.
            if e['id'] not in bucket:
                bucket.append(e['id'])
    return entries, index


def split_compound(place):
    """Split a place string into its component location names."""
    return [p.strip() for p in place.split(COMPOUND_SEP) if p.strip()]


def collect(root=ROOT, repos=REPOS):
    """Return (Counter of place strings, place -> set of repos)."""
    counts = Counter()
    where = defaultdict(set)
    for repo in repos:
        path = os.path.join(root, repo, 'data', 'chronology.json')
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        for ev in data.get('events', []):
            place = ev.get('place')
            if place:
                counts[place] += 1
                where[place].add(repo)
    return counts, where


def resolve(place, index):
    """Resolve a place string to gazetteer ids. Returns (ids, unresolved_parts)."""
    ids, missing = [], []
    for part in split_compound(place):
        hit = index.get(part.casefold())
        if hit:
            ids.extend(hit)
        else:
            missing.append(part)
    return ids, missing


def geocode(query, email=None):
    """Query Nominatim. Returns a list of candidate dicts. Never writes."""
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({
        'q': query, 'format': 'json', 'limit': 3, 'addressdetails': 0,
    })
    req = urllib.request.Request(url, headers={
        'User-Agent': 'cronologia-gazetteer/1.0 (https://github.com/cronologia)',
    })
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.load(resp)


def main(argv):
    counts, where = collect()
    entries, index = load_gazetteer()

    if '--list' in argv:
        print(f'{len(counts)} distinct place strings, {sum(counts.values())} uses')
        for place, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
            parts = split_compound(place)
            tag = f'  [{len(parts)} locations]' if len(parts) > 1 else ''
            print(f'  {n:3}x  {place}{tag}   ({",".join(sorted(where[place]))})')
        return 0

    unmapped = {}
    for place in counts:
        _, missing = resolve(place, index)
        for m in missing:
            unmapped.setdefault(m, set()).update(where[place])

    if '--propose' in argv:
        i = argv.index('--propose')
        limit = int(argv[i + 1]) if len(argv) > i + 1 and argv[i + 1].isdigit() else 25
        todo = sorted(unmapped)[:limit]
        print(f'# {len(todo)} of {len(unmapped)} unmapped names — CANDIDATES ONLY, nothing is written.')
        print('# Read every display_name before accepting. Geocoders are confidently wrong:')
        print('# "Ecole Valais Switzerland" returns a ski-lift platter, not the seminary.\n')
        for name in todo:
            try:
                cands = geocode(name)
            except Exception as exc:                     # noqa: BLE001 - report, never crash the sweep
                print(f'{name}\n    ERROR {exc}\n')
                time.sleep(1.1)
                continue
            print(name)
            if not cands:
                print('    (no candidate)')
            for c in cands:
                print(f"    {c['lat']:>10} {c['lon']:>11}  [{c.get('type','?')}]  {c['display_name'][:110]}")
            print()
            time.sleep(1.1)                              # Nominatim usage policy: <= 1 req/sec
        return 0

    # default: --check
    print(f'gazetteer: {len(entries)} places, {len(index)} name variants')
    print(f'datasets:  {len(counts)} distinct strings, {sum(counts.values())} uses')
    if not unmapped:
        print('all place strings resolve')
        return 0
    print(f'\n{len(unmapped)} unmapped name(s):')
    for name in sorted(unmapped):
        print(f'  {name}   ({",".join(sorted(unmapped[name]))})')
    return 1


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        # Piping into head/less closes stdout early; that is not an error.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
