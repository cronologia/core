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
    python3 tools/cof-dates.py --index          # header vs every other witness
    python3 tools/cof-dates.py --cadence        # dates off the course's weekday

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

The filename witness
--------------------
A third, substantially independent set of date claims exists: the dates
embedded in the audio filenames of the archive.org `cof_completo` zip, vaulted
as `archive/webcaptures/cof-completo-zip-listing.json` (504 dated filenames,
mostly seminariodefilosofia.org-style server download names). Measured on
ingest it contradicts the index lineage at four of that lineage's five
idiosyncratic quirks, and the index shares none of its slips — so neither
copied the other. It is NOT clean: it is a grab-bag of five naming families,
11 duplicate aulas carry internally disagreeing dates, 21 of its dates break
its own sequence, and at aula 220 it shares the index's sequence-breaking
value (one shared upstream typo, most likely). When the vaulted listing is
present, --index shows it as a third column with its own sequence-fit verdict;
aulas whose duplicate files disagree are excluded rather than picked between.
As with the other two sources: never bulk-import, adjudicate per aula.

The Resumos witness
-------------------
A fourth set of date claims, and the only CONTEMPORANEOUS one: the six volumes
of *Resumos de Aulas* compiled by Mário Chainho, a student, while the course
ran — vaulted at `archive/webcaptures/cof-resumos-chainho-dates.json` with the
PDFs beside them. Aulas 1-30 only, but it adjudicates 7 of the 33
disagreements, backing the header at aulas 1-3 and the index at 12, 18, 23 and
27 — a 3/4 split, one more demonstration that neither may be preferred
wholesale. It also carries an error of its own at aula 6, so it adjudicates
nothing on its own authority here either.

The cadence check (--cadence)
-----------------------------
The course ran on Saturdays: 242 of 257 transcription headers, 552 of 585
index-lineage dates and 30 of 30 Resumos dates. That makes the weekday a cheap
test wholly independent of the neighbour sequence, and it catches errors the
neighbour test structurally cannot — a date can be off by exactly seven days,
or sit at the end of the corpus with no following neighbour, and still be
wrong.

It is a FLAG, NOT A VERDICT, and the distinction is load-bearing: aula 263 is a
Friday in all three sources, which reads as a genuine off-cadence session
rather than three independent errors. Where every candidate for an aula is
off-cadence, suspect the session, not the sources.
"""

import datetime
import json
from collections import Counter
import os
import sys

INDEX_LINEAGE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'archive', 'webcaptures', 'cof-index-mateus-santos-pereira.json')

FILENAME_WITNESS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'archive', 'webcaptures', 'cof-completo-zip-listing.json')

RESUMOS_WITNESS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'archive', 'webcaptures', 'cof-resumos-chainho-dates.json')

# The course ran on Saturdays. Measured: 242 of 257 transcription headers, 552
# of 585 index-lineage dates, and 30 of 30 Chainho Resumos dates. A weekday
# other than Saturday is therefore a FLAG, never a verdict — aula 263 is a
# Friday in all three sources and reads as a genuine off-cadence session.
COURSE_WEEKDAY = 5          # Monday=0
WEEKDAYS = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')

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


def filename_dates(files):
    """Return {aula: iso date} from zip-listing entries.

    An aula whose files carry more than one distinct embedded date is
    excluded entirely — picking between duplicate files would be a silent
    adjudication, and those aulas need a per-case reading.
    """
    seen = {}
    for f in files:
        if f.get('aula') and f.get('date'):
            seen.setdefault(f['aula'], set()).add(f['date'])
    return {a: dates.pop() for a, dates in seen.items() if len(dates) == 1}


def load_filename_witness(path=FILENAME_WITNESS):
    """Return {aula: iso date} from the vaulted cof_completo listing, or {}."""
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    return filename_dates(data.get('files', []))


def load_resumos_witness(path=RESUMOS_WITNESS):
    """Return {aula: iso date} from the vaulted Chainho Resumos table, or {}.

    Aulas 1-30 only. A participant document written while the course ran, so
    the closest thing to a contemporaneous witness the family holds — and it
    carries an error of its own at aula 6, which is why it adjudicates
    nothing on its own here either.
    """
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    return {int(k): v['date'] for k, v in data.get('aulas', {}).items()
            if v.get('date')}


def off_cadence(value):
    """True when a date is not the course's usual weekday. A flag, not a verdict."""
    return datetime.date.fromisoformat(value).weekday() != COURSE_WEEKDAY


def weekday_of(value):
    return WEEKDAYS[datetime.date.fromisoformat(value).weekday()]


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


def _fits_sequence(aula, value, dated_by_aula):
    """True/False when the nearest dated neighbours can judge, else None."""
    if value is None:
        return None
    prev = max((a for a in dated_by_aula if a < aula), default=None)
    nxt = min((a for a in dated_by_aula if a > aula), default=None)
    if prev is None or nxt is None:
        return None
    lo, hi = dated_by_aula[prev], dated_by_aula[nxt]
    if lo > hi:
        return None
    return lo <= value <= hi


def compare_sources(docs, lineage, filenames=None, resumos=None):
    """Rows where the header and the index lineage disagree, with a verdict.

    When the filename or Resumos witnesses are supplied, each row also carries
    their values, and the weekday of each candidate. No witness ever changes
    `sequenceSupports` — they are further voices, not tiebreakers.
    """
    man = {d['aula']: d for d in docs if d.get('aula')}
    dated = {a: _date(d['date']) for a, d in man.items() if d.get('date')}
    rows = []
    for aula, doc in sorted(man.items()):
        h = _date(doc['date']) if doc.get('date') else None
        i = _date(lineage[aula]) if aula in lineage else None
        if h is None or i is None or h == i:
            continue
        neighbours = {a: v for a, v in dated.items() if a != aula}
        row = {
            'aula': aula,
            'header': h.isoformat(),
            'index': i.isoformat(),
            'offByDays': abs((h - i).days),
            'sequenceSupports': adjudicate(aula, h, i, neighbours),
        }
        if filenames is not None:
            f = _date(filenames[aula]) if aula in filenames else None
            row['filenames'] = f.isoformat() if f else None
            row['filenamesFits'] = _fits_sequence(aula, f, neighbours)
            row['filenamesMatches'] = (
                'header' if f is not None and f == h
                else 'index' if f is not None and f == i
                else 'neither' if f is not None
                else None)
        if resumos is not None:
            r = _date(resumos[aula]) if aula in resumos else None
            row['resumos'] = r.isoformat() if r else None
            row['resumosMatches'] = (
                'header' if r is not None and r == h
                else 'index' if r is not None and r == i
                else 'neither' if r is not None
                else None)
        # The cadence read. Off-cadence is a flag worth checking, not a
        # verdict: where EVERY candidate is off-cadence the session itself
        # was probably off-cadence.
        row['weekday'] = {'header': weekday_of(row['header']),
                          'index': weekday_of(row['index'])}
        for key in ('filenames', 'resumos'):
            if row.get(key):
                row['weekday'][key] = weekday_of(row[key])
        on = [k for k, v in row['weekday'].items() if v == WEEKDAYS[COURSE_WEEKDAY]]
        row['onCadence'] = on
        rows.append(row)
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
        filenames = load_filename_witness() or None
        resumos = load_resumos_witness() or None
        rows = compare_sources(docs, lineage, filenames, resumos)
        if as_json:
            json.dump(rows, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write('\n')
            return 1 if rows else 0
        tally = Counter(r['sequenceSupports'] for r in rows)
        print(f'{len(lineage)} aulas in the index lineage | '
              f'{len(rows)} disagree with the transcription header')
        print(f"sequence supports: header {tally['header']} | index {tally['index']} | "
              f"undecided {tally['undecided']}")
        if filenames:
            covered = sum(1 for r in rows if r.get('filenames'))
            print(f'filename witness (cof_completo zip): {len(filenames)} dated aulas, '
                  f'covers {covered} of the {len(rows)} disagreements')
        if resumos:
            covered = sum(1 for r in rows if r.get('resumos'))
            print(f'Resumos witness (Chainho, aulas 1-30): {len(resumos)} dated aulas, '
                  f'covers {covered} of the {len(rows)} disagreements')
        cadence = Counter(len(r['onCadence']) for r in rows)
        print(f"cadence: {cadence[0]} disagreements where NO candidate falls on a "
              f"{WEEKDAYS[COURSE_WEEKDAY]}")
        print('\nNo source is authoritative and ALL carry typos. Off-cadence is a flag,'
              '\nnot a verdict. Nothing here is corrected; "undecided" is a real result.\n')
        for r in rows:
            line = (f"  aula {r['aula']:>3}  header {r['header']} {r['weekday']['header']}"
                    f"  index {r['index']} {r['weekday']['index']}"
                    f"  [~{r['offByDays']}d]  -> {r['sequenceSupports']}")
            if r.get('filenames'):
                fit = {True: 'fits sequence', False: 'breaks sequence',
                       None: 'sequence cannot judge'}[r['filenamesFits']]
                line += (f"\n         filenames {r['filenames']} "
                         f"{r['weekday']['filenames']} ({r['filenamesMatches']}; {fit})")
            if r.get('resumos'):
                line += (f"\n         resumos   {r['resumos']} "
                         f"{r['weekday']['resumos']} ({r['resumosMatches']}; contemporaneous)")
            if not r['onCadence']:
                line += '\n         NO candidate is on cadence - possibly a genuine off-cadence session'
            print(line)
        return 1 if rows else 0

    if '--cadence' in argv:
        rows = [{'id': d['id'], 'aula': d.get('aula'), 'date': d['date'],
                 'weekday': weekday_of(d['date']),
                 'alsoNeighbourAnomaly': bool(d.get('dateAnomaly')),
                 'alsoDisagrees': bool(d.get('dateDisagreement'))}
                for d in docs if d.get('date') and off_cadence(d['date'])]
        rows.sort(key=lambda r: (r['aula'] or 0))
        dated = [d for d in docs if d.get('date')]
        if as_json:
            json.dump(rows, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write('\n')
            return 1 if rows else 0
        print(f'{len(dated)} dated docs | {len(rows)} NOT on the course cadence '
              f'({WEEKDAYS[COURSE_WEEKDAY]})')
        print('\nOff-cadence is a FLAG, NOT a verdict. The course ran on '
              f'{WEEKDAYS[COURSE_WEEKDAY]}s\n(242/257 headers, 552/585 index dates, 30/30 '
              'Resumos), but special and\nrescheduled sessions are real - where every source '
              'agrees on an off-cadence\ndate, the session was probably held off cadence.\n')
        for r in rows:
            flags = [k for k, v in (('neighbour-anomaly', r['alsoNeighbourAnomaly']),
                                    ('disagrees-with-a-witness', r['alsoDisagrees'])) if v]
            print(f"  {r['id']} aula {str(r['aula']):>4}  {r['date']} {r['weekday']}"
                  f"   {', '.join(flags) or 'NOT otherwise flagged - look here first'}")
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
