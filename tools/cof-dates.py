#!/usr/bin/env python3
"""Neighbour-consistency check for COF lecture dates.

Why this exists
---------------
`cof/index.json` marks every `revisada` file `dateVerified: true` because the
lecture date was read from the transcription's own header
(`dateProvenance: header-long-form`). Consuming repos then cite "aula N, <date>"
on that basis.

The headers are not all right. Measured 2026-07-26, fourteen of 257 dated files
carry a date inconsistent with BOTH their immediate dated neighbours, including
five that are off by very close to a whole year while the day and month fit the
sequence perfectly — COF079 reads `16 de outubro de 2012` between two aulas dated
October 2010.

That was found by hand. This turns it into a check that runs whenever the
manifest is rebuilt, so it is not rediscovered by hand a second time
(the lesson of core#21).

What it does NOT do
-------------------
It does not correct anything. The header is the evidence; an inference from
neighbouring aulas is not, and a course can legitimately be recorded, released
or renumbered out of order. The tool reports; a human decides. See archive#20.

Usage
-----
    python3 tools/cof-dates.py                  # report anomalies, exit 1 if any
    python3 tools/cof-dates.py --quiet          # exit status only
    python3 tools/cof-dates.py --json           # machine-readable
    python3 tools/cof-dates.py --index          # header vs the community index lineage

The --index mode
----------------
A second source exists: the community index lineage vaulted in
`archive/webcaptures/` (Rafael Almeida -> the Mateus Santos Pereira extension ->
the Jornal Cidadania continuation). Measured on ingest, those three carry
identical dates for 485 of 485 shared aulas, so they are ONE source, not three.

It disagrees with the transcription headers on 33 aulas, and BOTH sources carry
year typos. Aulas 217-220 are a continuous weekly series: at aula 220 the header
(2013-09-14) fits the sequence and the index (2012-09-14) does not, while at
aula 222 the reverse holds. So neither source may be preferred wholesale, and
the direction of error has to be established per aula.

--index applies the same neighbour test to both and says which side, if either,
the sequence supports. It adjudicates nothing on its own: where the neighbours
cannot decide, it says so.
"""

import datetime
import json
from collections import Counter
import os
import sys

INDEX_LINEAGE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'archive', 'webcaptures', 'cof-index-mateus-santos-pereira.json')

DEFAULT_MANIFEST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'archive', 'cof', 'index.json')

# A whole-year offset with the day and month intact is the signature of a typed
# year. Anything smaller is more likely a genuine out-of-order recording.
YEAR_TYPO_MIN_DAYS = 300


def _date(value):
    return datetime.date.fromisoformat(value)


def find_anomalies(docs):
    """Return entries whose date is inconsistent with both dated neighbours.

    Only files with BOTH neighbours dated can be judged, and only when those
    neighbours are themselves in order — otherwise the anomaly is theirs.
    """
    dated = sorted((d for d in docs if d.get('date') and d.get('aula')),
                   key=lambda d: d['aula'])
    out = []
    for i in range(1, len(dated) - 1):
        prev, cur, nxt = dated[i - 1], dated[i], dated[i + 1]
        if _date(prev['date']) > _date(nxt['date']):
            continue                       # the neighbours disagree; not this file's fault
        if _date(prev['date']) <= _date(cur['date']) <= _date(nxt['date']):
            continue                       # in sequence
        off = min(abs((_date(cur['date']) - _date(prev['date'])).days),
                  abs((_date(cur['date']) - _date(nxt['date'])).days))
        same_day_month = (
            _date(cur['date']).month == _date(prev['date']).month
            or _date(cur['date']).month == _date(nxt['date']).month)
        out.append({
            'id': cur['id'], 'aula': cur['aula'], 'date': cur['date'],
            'dateProvenance': cur.get('dateProvenance'),
            'prev': {'id': prev['id'], 'date': prev['date']},
            'next': {'id': nxt['id'], 'date': nxt['date']},
            'offByDays': off,
            'kind': 'probable-year-typo'
                    if off >= YEAR_TYPO_MIN_DAYS and same_day_month
                    else 'ordering-anomaly',
        })
    return out


def load_index_lineage(path=INDEX_LINEAGE):
    """Return {aula: iso date} from the vaulted community index, or {}."""
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    return {int(k): v['date'] for k, v in data.get('aulas', {}).items() if v.get('date')}


def adjudicate(aula, header, index, dated_by_aula):
    """Which value, if either, does the surrounding sequence support?

    Returns 'header', 'index', or 'undecided'. Uses the nearest dated
    neighbours on each side, skipping the aula under test.
    """
    prev = max((a for a in dated_by_aula if a < aula), default=None)
    nxt = min((a for a in dated_by_aula if a > aula), default=None)
    if prev is None or nxt is None:
        return 'undecided'
    lo, hi = dated_by_aula[prev], dated_by_aula[nxt]
    if lo > hi:
        return 'undecided'                     # neighbours themselves disagree
    fits_h = header is not None and lo <= header <= hi
    fits_i = index is not None and lo <= index <= hi
    if fits_h and not fits_i:
        return 'header'
    if fits_i and not fits_h:
        return 'index'
    return 'undecided'


def compare_sources(docs, lineage):
    """Rows where the header and the index lineage disagree, with a verdict."""
    man = {d['aula']: d for d in docs if d.get('aula')}
    dated = {a: _date(d['date']) for a, d in man.items() if d.get('date')}
    rows = []
    for aula, doc in sorted(man.items()):
        h = _date(doc['date']) if doc.get('date') else None
        i = _date(lineage[aula]) if aula in lineage else None
        if h is None or i is None or h == i:
            continue
        neighbours = {a: v for a, v in dated.items() if a != aula}
        rows.append({
            'aula': aula,
            'header': h.isoformat(),
            'index': i.isoformat(),
            'offByDays': abs((h - i).days),
            'sequenceSupports': adjudicate(aula, h, i, neighbours),
        })
    return rows


def main(argv):
    path = next((a for a in argv if not a.startswith('--')), DEFAULT_MANIFEST)
    quiet = '--quiet' in argv
    as_json = '--json' in argv

    with open(path, encoding='utf-8') as fh:
        docs = json.load(fh)['docs']

    if '--index' in argv:
        lineage = load_index_lineage()
        if not lineage:
            print('index lineage not found at', INDEX_LINEAGE)
            return 2
        rows = compare_sources(docs, lineage)
        if as_json:
            json.dump(rows, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write('\n')
            return 1 if rows else 0
        tally = Counter(r['sequenceSupports'] for r in rows)
        print(f'{len(lineage)} aulas in the index lineage | '
              f'{len(rows)} disagree with the transcription header')
        print(f"sequence supports: header {tally['header']} | index {tally['index']} | "
              f"undecided {tally['undecided']}")
        print('\nNeither source is authoritative and BOTH carry year typos.'
              '\nNothing here is corrected; a verdict of "undecided" is a real result.\n')
        for r in rows:
            print(f"  aula {r['aula']:>3}  header {r['header']}  index {r['index']}  "
                  f"[~{r['offByDays']}d]  -> {r['sequenceSupports']}")
        return 1 if rows else 0

    anomalies = find_anomalies(docs)

    if as_json:
        json.dump(anomalies, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
        return 1 if anomalies else 0

    if not quiet:
        dated = sum(1 for d in docs if d.get('date'))
        print(f'{dated} dated of {len(docs)} docs | {len(anomalies)} anomal'
              f'{"y" if len(anomalies) == 1 else "ies"}')
        if anomalies:
            print('\nThese are REPORTED, not corrected. The header is the evidence;'
                  '\nan inference from neighbours is not. See archive#20.\n')
        for a in anomalies:
            print(f"  {a['id']} aula {a['aula']:>3}  {a['date']}  "
                  f"[{a['kind']}, ~{a['offByDays']}d]")
            print(f"      neighbours: {a['prev']['id']} {a['prev']['date']}"
                  f" / {a['next']['id']} {a['next']['date']}")
    return 1 if anomalies else 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
