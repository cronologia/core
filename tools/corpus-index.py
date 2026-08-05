#!/usr/bin/env python3
"""corpus-index.py — one full-text index over every transcript collection in the vault.

WHY THIS EXISTS
---------------
On 2026-08-04 a search for the book `O Profeta da Paz` returned zero across the
589 COF transcription files, and the honest-looking conclusion was drawn: not in
the corpus. It was in the corpus. It was in True Outspeak #146, in a collection
the search had never been pointed at, and the passage calls the book only "um
livro sobre o Islam" — so even the right collection would not have matched the
title.

Two distinct failures, and this tool is built against both:

  1. SCOPE. "Not in the corpus" meant "not in the part I opened". The fix is
     structural rather than disciplinary: ONE index over EVERY collection, and
     every result set states the scope it searched. A tool that reports a zero
     must be able to say what it looked at, or the zero is worthless. (The same
     week, `archive-refs.js` reported "Done: 90 references" over a dataset of
     160, and a link report headed itself "Checked 76" over 158.)

  2. THE ASR. These are auto-captioned and hand-reviewed transcriptions of
     spoken Portuguese, and the manglings are severe: Jouvenel becomes
     `do jogo né`, Husserl becomes `Russel`, Ibn Khaldun becomes
     `Weven Caldono`. An exact search for a name is a search for whichever
     spelling the recogniser happened to choose. So queries are EXPANDED using
     the variants already recorded in KEYWORDS.md and cof-entity-aliases.json,
     and the tool says which expansions it used.

WHAT IT DOES NOT DO
-------------------
It is lexical, not semantic. It cannot find "um livro sobre o Islam" from the
query "O Profeta da Paz" — no amount of variant expansion bridges that, because
the words genuinely are not there. Finding that passage still needed a human to
search the CLAIM instead of the NAME. Semantic search would need embeddings,
which would mean either a heavy local model or sending the private vault's
contents to a third party; that is a disclosure decision, not a technical one,
and it has not been taken. Until it is, this tool makes the lexical half fast
and honest and leaves the other half to the reader.

WHERE IT LIVES, AND WHY IT IS NOT IN THE VAULT
----------------------------------------------
The transcripts are in `cronologia/archive`; this tool is not, and must not be.
archive ADR-0004 is explicit: the vault has no build, no test suite and no CI,
tooling that touches it is READ-ONLY and lives in `cronologia/core/tools/`, and
if the vault ever needs automated checking the check belongs here rather than
there. This tool was first written into the vault, which broke all three of
those, and was moved.

So: reads `$CRONOLOGIA_HOME/archive` (or the sibling checkout, or `--vault`),
writes the index beside itself in core, and never writes to the vault at all.

Zero dependencies: stdlib sqlite3 with FTS5, which every supported Python ships.
Accent folding is the tokenizer's (`remove_diacritics 2`), so `filon` matches
`Fílon` without the caller thinking about it — one of the documented traps.

USAGE
    corpus-index.py build [--vault PATH] [--db PATH]
    corpus-index.py search QUERY [--collection C] [--reviewed] [--limit N] [--raw]
    corpus-index.py stats

The database is a derived artifact and is not committed; rebuild it in ~12s
from the transcripts, which are the source of record.
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata

def family_root():
    """Directory holding the sibling repos (core, archive, fsspx, ...).

    Same resolution as the other vault-reading tools here, so all of them agree
    about where the family lives and honour the same override.
    """
    env = os.environ.get('CRONOLOGIA_HOME')
    if env:
        return env
    here = os.path.abspath(__file__)
    return os.path.dirname(os.path.dirname(os.path.dirname(here)))


# The vault holds the transcripts; this tool lives in core and only reads them
# (archive ADR-0004: tooling that touches the vault is read-only and lives
# here). ROOT is rebindable so `--vault` and the tests can point it elsewhere.
ROOT = os.path.join(family_root(), 'archive')

# The index is DERIVED and is written HERE, never into the vault -- ADR-0004
# says core tooling never writes to archive, and a 58 MB database appearing in
# a repo whose whole point is preserved-as-captured source would be exactly the
# kind of in-place mutation it forbids.
DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'corpus.db')
CORE_ALIASES = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'cof-entity-aliases.json')

# Chunk size is a compromise between two failure modes. Whole documents are
# useless as results -- a COF lecture runs to 25,000 words and "it is in this
# file somewhere" is what we already had. Chunks much smaller than this cut
# through the middle of the argument a passage is making. The overlap exists so
# a claim spanning a boundary is still wholly present in one chunk.
CHUNK_CHARS = 1500
CHUNK_OVERLAP = 400


# --------------------------------------------------------------------------
# Collections
# --------------------------------------------------------------------------

def collections():
    """Every transcript collection in the vault, with how to read its metadata.

    Deliberately enumerated rather than discovered by globbing: a new collection
    should be a visible edit here, so that nobody can add one and have searches
    silently keep reporting a scope that no longer covers it.

    `transcripts/` is a DIFFERENT SUBJECT from the other two -- FSSPX and
    traditionalist-Catholic material belonging to the sibling projects. It is
    indexed anyway and tagged, because the alternative is a second tool with a
    second scope to forget about, and because a query can filter.
    """
    return [
        {
            'name': 'cof',
            'label': 'Curso Online de Filosofia transcriptions',
            'subject': 'olavo',
            'dirs': [os.path.join(ROOT, 'cof', 'revisadas'),
                     os.path.join(ROOT, 'cof', 'revisao_pendente')],
            'index': os.path.join(ROOT, 'cof', 'index.json'),
            'ext': '.md',
        },
        {
            'name': 'olavo-video',
            'label': 'olavo-video captures (True Outspeak, Fórum da Liberdade, courses, singles)',
            'subject': 'olavo',
            'dirs': [os.path.join(ROOT, 'olavo-video', 'transcripts')],
            'index': os.path.join(ROOT, 'olavo-video', 'index.json'),
            'ext': '.txt',
        },
        {
            'name': 'transcripts',
            'label': 'general transcript captures (FSSPX and related, sibling projects)',
            'subject': 'other',
            'dirs': [os.path.join(ROOT, 'transcripts')],
            'index': os.path.join(ROOT, 'transcripts', 'index.json'),
            'ext': '.txt',
        },
    ]


def load_coverage():
    """Per-aula transcript-vs-audio coverage, where the vault has measured it.

    archive#37 is the reason this is here. Twenty-one COF transcripts are
    incomplete: fifteen break off mid-stream (as low as 0.34 of their audio) and
    six sign off normally while covering under 0.60 — COF513 ends with a proper
    closing formula over 18.5% of its lecture.

    The consequence is stated in that ticket and is the whole point: "a measured
    zero search hit in the missing tail of these files is meaningless." An index
    that counts FILES and reports a confident scope is measuring the wrong
    thing, because a file can be present, legible, and missing its last third.
    """
    path = os.path.join(ROOT, 'webcaptures', 'cof-audio-durations.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    out = {}
    for key, rec in (data.get('aulas') or {}).items():
        # Prefer the loop-corrected figure where it exists: the raw estimate
        # counts recogniser loops as content, so it is optimistic exactly for
        # the files where honesty matters most.
        cov = rec.get('estimatedCoverageExLoops', rec.get('estimatedCoverage'))
        if isinstance(cov, (int, float)):
            out['COF%03d' % int(key)] = float(cov)
    return out


# Below this, a transcript is treated as materially incomplete. archive#37 uses
# 0.75 for the abandoned-mid-stream set; the same threshold is used here so the
# tool and the ticket cannot drift apart into two different definitions.
COVERAGE_FLOOR = 0.75


def load_index(path):
    """Pull per-document metadata out of a collection's index.json.

    The three indexes do not share a schema, so this looks for the fields by
    name wherever they sit and returns a map keyed on BASENAME. Anything it
    cannot find stays None -- an unknown date must never render as a known one.
    """
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}

    found = {}

    def visit(node):
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        f = node.get('file')
        if isinstance(f, str) and f:
            found[os.path.basename(f)] = {
                'doc_id': node.get('id'),
                'title': node.get('title') or node.get('indexTitle'),
                'date': node.get('date') or node.get('establishedDate') or node.get('titleDate'),
                'date_verified': 1 if node.get('dateVerified') else 0,
                'review': node.get('reviewStatus') or ('captured' if node.get('captured') else None),
                'series': node.get('series'),
                'url': node.get('sourceUrl') or node.get('url'),
            }
        for v in node.values():
            visit(v)

    visit(data)
    return found


# --------------------------------------------------------------------------
# Query expansion
# --------------------------------------------------------------------------

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def keyword_paths():
    """Where a KEYWORDS.md might live. First one that exists wins."""
    return (os.path.join(family_root(), 'olavo', 'KEYWORDS.md'),
            '/workspace/olavo/KEYWORDS.md',
            os.path.join(ROOT, 'KEYWORDS.md'))


def load_variants(paths=None, aliases=None):
    """Known ASR manglings, keyed on the accent-folded canonical name.

    Two sources, both already maintained by hand for exactly this purpose:
    the KEYWORDS.md tables in the project repos, and core's
    cof-entity-aliases.json. Neither was written for this tool; both are read
    rather than copied, so a variant added there reaches searches here without
    anybody remembering to sync a third list.

    The inputs are parameters so the tests can drive this with a fixture rather
    than whatever happens to be checked out beside the vault.
    """
    variants = {}

    def add(canon, vs):
        key = strip_accents(canon).lower()
        bucket = variants.setdefault(key, {'canonical': canon, 'variants': set()})
        for v in vs:
            if v and strip_accents(v).lower() != key:
                bucket['variants'].add(v)

    # KEYWORDS.md markdown tables: | Actual | Variants | ... |
    for kw in (paths if paths is not None else keyword_paths()):
        if not os.path.exists(kw):
            continue
        with open(kw, encoding='utf-8') as fh:
            for line in fh:
                if not line.startswith('|'):
                    continue
                cells = [c.strip() for c in line.strip().strip('|').split('|')]
                if len(cells) < 2 or not cells[0] or cells[0].lower() in ('actual', 'philosopher'):
                    continue
                canon = re.sub(r'\*+', '', cells[0]).strip()
                if not canon or set(canon) <= set('-: '):
                    continue
                # variants cell: backticked or comma-separated, counts in parens
                raw = cells[1]
                vs = re.findall(r'`([^`]+)`', raw) or re.split(r',\s*', re.sub(r'\*+', '', raw))
                vs = [re.sub(r'\s*\(\d+\)\s*$', '', v).strip() for v in vs]
                add(canon, [v for v in vs if v and len(v) > 2])
        break

    # core's committed alias table (multiword proper nouns)
    alias_path = CORE_ALIASES if aliases is None else aliases
    if alias_path and os.path.exists(alias_path):
        try:
            with open(alias_path, encoding='utf-8') as fh:
                data = json.load(fh)
            for entry in data.get('aliases', []):
                add(entry.get('canonical', ''), entry.get('variants', []))
        except (OSError, ValueError):
            pass

    return variants


def expand(query, variants):
    """Return (fts_query, notes) — the query with known manglings OR-ed in.

    Only whole query terms are expanded, and only when a canonical name matches
    exactly. Expanding aggressively would be worse than not expanding: a false
    hit that looks like corroboration is the failure this vault's rules exist to
    prevent, so the tool reports every expansion it applied and lets the reader
    discount them.
    """
    notes = []
    terms = [t for t in re.split(r'\s+', query.strip()) if t]
    if not terms:
        return query, notes

    # try the whole query first (multiword canonicals like "Ibn Khaldun")
    whole = strip_accents(query).lower()
    if whole in variants and variants[whole]['variants']:
        vs = sorted(variants[whole]['variants'])
        notes.append((variants[whole]['canonical'], vs))
        parts = ['"%s"' % query] + ['"%s"' % v for v in vs]
        return '(%s)' % ' OR '.join(parts), notes

    out = []
    for t in terms:
        key = strip_accents(t).lower()
        if key in variants and variants[key]['variants']:
            vs = sorted(variants[key]['variants'])
            notes.append((variants[key]['canonical'], vs))
            out.append('(%s)' % ' OR '.join(['"%s"' % t] + ['"%s"' % v for v in vs]))
        else:
            out.append('"%s"' % t)
    return ' '.join(out), notes


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def normalise(text):
    """Collapse whitespace before indexing.

    KEYWORDS.md documents this as a measured trap: a phrase wrapped across a
    newline defeats multiword search, and it produced a count of 77 against a
    true 89 on a corpus-wide sweep. Normalising at index time means every caller
    gets the fix rather than each one rediscovering it.
    """
    return re.sub(r'\s+', ' ', text).strip()


def dedup_runs(text, keep=3):
    """Collapse runs of identical consecutive sentences to at most `keep`.

    31 vault transcripts carry recogniser loops -- up to 355 consecutive copies
    of one sentence, emitted over silence or dead air (the measurement lives in
    archive/webcaptures/cof-audio-durations.json, loopRuns). The vault files
    stay as captured (archive ADR-0004); this index is DERIVED, so the junk is
    dropped here instead, at read time.

    Collapsing to three rather than one is deliberate: a speaker genuinely
    saying "Obrigado. Obrigado. Obrigado." survives verbatim, and any phrase
    remains findable -- what dies is only the frequency inflation, where a
    search over this corpus counted 355 hits of a sentence nobody said 355
    times.
    """
    sents = re.split(r'(?<=[.!?])\s+', text)
    out = []
    run = 0
    for sent in sents:
        if out and sent == out[-1]:
            run += 1
            if run >= keep:
                continue
        else:
            run = 0
        out.append(sent)
    return ' '.join(out)


def chunks(text):
    step = CHUNK_CHARS - CHUNK_OVERLAP
    for start in range(0, max(len(text), 1), step):
        piece = text[start:start + CHUNK_CHARS]
        if piece.strip():
            yield start, piece
        if start + CHUNK_CHARS >= len(text):
            break


def build(db_path):
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.executescript("""
        CREATE TABLE docs(
            rowid INTEGER PRIMARY KEY,
            collection TEXT, subject TEXT, doc_id TEXT, title TEXT,
            date TEXT, date_verified INTEGER, review TEXT, series TEXT,
            url TEXT, path TEXT, chars INTEGER, coverage REAL);
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
        CREATE VIRTUAL TABLE chunks USING fts5(
            body, doc UNINDEXED, offset UNINDEXED,
            tokenize='unicode61 remove_diacritics 2');
    """)

    coverage = load_coverage()
    totals = []
    doc_rowid = 0
    chunk_count = 0
    for col in collections():
        meta = load_index(col['index'])
        files = []
        for d in col['dirs']:
            if not os.path.isdir(d):
                continue
            for name in sorted(os.listdir(d)):
                if name.endswith(col['ext']):
                    files.append(os.path.join(d, name))
        for path in files:
            base = os.path.basename(path)
            m = meta.get(base, {})
            try:
                with open(path, encoding='utf-8', errors='ignore') as fh:
                    text = dedup_runs(normalise(fh.read()))
            except OSError:
                continue
            doc_rowid += 1
            doc_id = m.get('doc_id') or os.path.splitext(base)[0]
            con.execute(
                'INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (doc_rowid, col['name'], col['subject'], doc_id, m.get('title'),
                 m.get('date'), m.get('date_verified') or 0, m.get('review'),
                 m.get('series'), m.get('url'), path, len(text),
                 coverage.get(doc_id)))
            for off, piece in chunks(text):
                con.execute('INSERT INTO chunks(body, doc, offset) VALUES (?,?,?)',
                            (piece, doc_rowid, off))
                chunk_count += 1
        totals.append((col['name'], col['label'], len(files)))

    for k, v in (('built_files', str(sum(t[2] for t in totals))),
                 ('built_chunks', str(chunk_count)),
                 ('collections', json.dumps(totals, ensure_ascii=False))):
        con.execute('INSERT INTO meta VALUES (?,?)', (k, v))
    con.commit()
    con.close()

    print('Indexed:')
    for name, label, n in totals:
        print('  %-14s %4d files   %s' % (name, n, label))
    print('  %-14s %4d files, %d chunks -> %s'
          % ('TOTAL', sum(t[2] for t in totals), chunk_count, db_path))


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------

def scope_line(con):
    row = con.execute("SELECT value FROM meta WHERE key='collections'").fetchone()
    cols = json.loads(row[0]) if row else []
    return 'searched %d file(s) across %d collection(s): %s' % (
        sum(c[2] for c in cols), len(cols),
        ', '.join('%s (%d)' % (c[0], c[2]) for c in cols))


def incomplete(con, collection=None):
    """Files known to hold less than their audio, worst first.

    A file counts as searched whether or not it is whole, so the scope line
    alone overstates what was actually looked at. This is the correction, and
    it is printed with every zero.
    """
    sql = ('SELECT doc_id, coverage FROM docs WHERE coverage IS NOT NULL '
           'AND coverage < ? ')
    args = [COVERAGE_FLOOR]
    if collection:
        sql += 'AND collection = ? '
        args.append(collection)
    sql += 'ORDER BY coverage'
    return con.execute(sql, args).fetchall()


def coverage_line(con, collection=None):
    rows = incomplete(con, collection)
    if not rows:
        return None
    worst = ', '.join('%s %.0f%%' % (d, c * 100) for d, c in rows[:5])
    more = '' if len(rows) <= 5 else ', +%d more' % (len(rows) - 5)
    return ('%d indexed file(s) hold less than %.0f%% of their audio '
            '(archive#37) — worst: %s%s' % (len(rows), COVERAGE_FLOOR * 100, worst, more))


def search(db_path, query, collection=None, reviewed=False, limit=10, raw=False):
    if not os.path.exists(db_path):
        sys.exit('No index at %s — run: corpus-index.py build' % db_path)
    con = sqlite3.connect(db_path)

    notes = []
    fts = query if raw else None
    if fts is None:
        fts, notes = expand(query, load_variants())

    sql = ("SELECT d.collection, d.doc_id, d.date, d.date_verified, d.review, "
           "       c.offset, snippet(chunks, 0, '[', ']', ' … ', 18), d.coverage "
           "FROM chunks c JOIN docs d ON d.rowid = c.doc "
           "WHERE chunks MATCH ? ")
    args = [fts]
    if collection:
        sql += 'AND d.collection = ? '
        args.append(collection)
    if reviewed:
        sql += "AND d.review = 'revisada' "
    sql += 'ORDER BY rank LIMIT ?'
    args.append(limit)

    try:
        rows = con.execute(sql, args).fetchall()
    except sqlite3.OperationalError as exc:
        sys.exit('bad query: %s' % exc)

    print('query : %s' % query)
    if fts != '"%s"' % query:
        print('as    : %s' % fts)
    for canon, vs in notes:
        print('expand: %s -> %s' % (canon, ', '.join(vs)))
    print('scope : %s' % scope_line(con))
    cov = coverage_line(con, collection)
    if cov:
        print('caveat: %s' % cov)
    if collection:
        print('filter: collection = %s' % collection)
    if reviewed:
        print('filter: reviewed transcriptions only')
    print('hits  : %d shown (limit %d)\n' % (len(rows), limit))

    if not rows:
        # A zero here is a real finding only if the reader knows what was looked
        # at and how. Both are printed above; these lines say the rest.
        print('  No lexical match. That is not evidence of absence, for two')
        print('  separate reasons.')
        print('  1. This index matches WORDS, and the corpus mangles names and')
        print('     paraphrases titles. Try the CLAIM rather than the NAME.')
        n = len(incomplete(con, collection))
        if n:
            print('  2. %d of the files just searched are INCOMPLETE (above).' % n)
            print('     Fifteen of them break off mid-lecture, so their gap is')
            print('     positional: a term spoken in the missing tail cannot')
            print('     appear here at all. This zero was measured over a')
            print('     corpus that is not entire, and may not be quoted as a')
            print('     corpus-wide absence without saying so.')
        return

    for col, doc, date, dv, review, off, snip, cov in rows:
        stamp = date or 'undated'
        if date and not dv:
            stamp += ' (unverified)'
        flag = review or '—'
        short = '' if cov is None or cov >= COVERAGE_FLOOR else \
            ' · INCOMPLETE %.0f%%' % (cov * 100)
        print('  %s / %s  [%s · %s · @%d%s]' % (col, doc, stamp, flag, off, short))
        print('      %s\n' % snip.replace('\n', ' '))


def stats(db_path):
    if not os.path.exists(db_path):
        sys.exit('No index at %s — run: corpus-index.py build' % db_path)
    con = sqlite3.connect(db_path)
    print(scope_line(con))
    rows = con.execute(
        'SELECT collection, review, COUNT(*), SUM(chars) FROM docs '
        'GROUP BY collection, review ORDER BY collection, review').fetchall()
    print('\n%-14s %-16s %6s %12s' % ('collection', 'review', 'files', 'chars'))
    for c, r, n, ch in rows:
        print('%-14s %-16s %6d %12d' % (c, r or '—', n, ch or 0))
    dated = con.execute('SELECT COUNT(*) FROM docs WHERE date IS NOT NULL').fetchone()[0]
    verified = con.execute('SELECT COUNT(*) FROM docs WHERE date_verified=1').fetchone()[0]
    total = con.execute('SELECT COUNT(*) FROM docs').fetchone()[0]
    print('\ndated: %d/%d, of which date-verified: %d' % (dated, total, verified))
    v = load_variants()
    print('variant map: %d canonical name(s) with known manglings' % len(v))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--vault', default=None,
                    help='path to the archive checkout (default: sibling of core, '
                         'or $CRONOLOGIA_HOME/archive)')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('build')
    s = sub.add_parser('search')
    s.add_argument('query')
    s.add_argument('--collection')
    s.add_argument('--reviewed', action='store_true')
    s.add_argument('--limit', type=int, default=10)
    s.add_argument('--raw', action='store_true', help='pass the query to FTS5 unexpanded')
    sub.add_parser('stats')
    a = ap.parse_args()
    if a.vault:
        global ROOT
        ROOT = os.path.abspath(a.vault)

    if a.cmd == 'build':
        build(a.db)
    elif a.cmd == 'search':
        search(a.db, a.query, a.collection, a.reviewed, a.limit, a.raw)
    else:
        stats(a.db)


if __name__ == '__main__':
    # A search tool gets piped into `head` constantly. Without this, doing so
    # prints a BrokenPipeError traceback after perfectly good output, which
    # reads as a failure and is not one.
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass
        os._exit(0)
    except KeyboardInterrupt:
        sys.exit(130)
