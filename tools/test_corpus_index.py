#!/usr/bin/env python3
"""Unit tests for corpus-index.py (stdlib unittest only).

    python3 -m unittest discover -s tools -p 'test_*.py' -v

Every test here is pinned to a failure this codebase has actually produced.
That is deliberate: a search tool's tests should not check that search works —
that is obvious the first time you run it — but that it cannot repeat the
specific ways searching has already gone wrong here.

  - A scope that under-reports itself. `archive-refs.js` printed "Done: 90
    references" over a dataset of 160; a link report headed itself "Checked 76"
    over 158; and the search that built this tool concluded "not in the corpus"
    about a collection it had never opened.
  - A phrase that exists and does not match: across a line break (a measured
    count of 77 against a true 89), or across a chunk boundary.
  - A name the recogniser destroyed, so the correct spelling finds nothing.
  - A zero presented as a finding rather than as the absence of one.
  - A hit from a garbled unreviewed file, indistinguishable from a reviewed one.

No network, no vault mutation: every test builds a miniature vault in a
temporary directory.
"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    """Import the hyphenated script as a module."""
    spec = importlib.util.spec_from_file_location(
        'corpus_index', os.path.join(HERE, 'corpus-index.py'))
    mod = importlib.util.module_from_spec(spec)
    sys.modules['corpus_index'] = mod
    spec.loader.exec_module(mod)
    return mod


@contextlib.contextmanager
def captured():
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        yield buf


class VaultFixture(unittest.TestCase):
    """A miniature vault: three collections, a handful of documents each."""

    def setUp(self):
        self.mod = load()
        self.tmp = tempfile.mkdtemp()
        self.mod.ROOT = self.tmp
        self.db = os.path.join(self.tmp, 'corpus.db')

        # collection 1 — reviewed and unreviewed, with dates
        for sub in ('revisadas', 'revisao_pendente'):
            os.makedirs(os.path.join(self.tmp, 'cof', sub))
        self.write('cof/revisadas/COF001.md',
                   'Uma exegese simbólica de Fílon de Alexandria sobre o logos divino.')
        # the line-break trap: a phrase a naive search would miss
        self.write('cof/revisao_pendente/COF002.md',
                   'Ele citou o Foro de São\nPaulo naquela reunião, e depois o Russel.')
        self.index('cof/index.json', [
            {'id': 'COF001', 'file': 'revisadas/COF001.md', 'date': '2009-03-14',
             'dateVerified': True, 'reviewStatus': 'revisada'},
            {'id': 'COF002', 'file': 'revisao_pendente/COF002.md',
             'reviewStatus': 'revisao_pendente'},
        ])

        # collection 2 — the one the original search never opened
        os.makedirs(os.path.join(self.tmp, 'olavo-video', 'transcripts'))
        self.write('olavo-video/transcripts/to-049.txt',
                   'Eu escrevi um livro sobre a história das origens islâmicas, '
                   'premiado pela Universidade de Lázaro.')
        self.index('olavo-video/index.json', [
            {'id': 'to-049', 'file': 'transcripts/to-049.txt',
             'titleDate': '2007-11-19', 'dateVerified': False, 'captured': True},
        ])

        # collection 3 — a different subject entirely
        os.makedirs(os.path.join(self.tmp, 'transcripts'))
        self.write('transcripts/transcript-1.txt', 'Uma discussão sobre a FSSPX e a missa.')
        self.index('transcripts/index.json',
                   [{'id': 't-1', 'file': 'transcript-1.txt', 'captured': True}])

        # the variant table the expander reads
        self.keywords = os.path.join(self.tmp, 'KEYWORDS.md')
        with open(self.keywords, 'w', encoding='utf-8') as fh:
            fh.write('| Actual | Variants |\n|---|---|\n'
                     '| **Husserl** | `Russel`, `russer` |\n'
                     '| **Al-Azhar** | `Universidade de Lázaro` |\n')

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, text):
        path = os.path.join(self.tmp, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)

    def index(self, rel, docs):
        self.write(rel, json.dumps({'docs': docs}, ensure_ascii=False))

    def build(self):
        with captured() as out:
            self.mod.build(self.db)
        return out.getvalue()

    def search(self, query, **kw):
        kw.setdefault('paths', [self.keywords])
        paths = kw.pop('paths')
        real = self.mod.load_variants
        self.mod.load_variants = lambda *a, **k: real(paths=paths, aliases=None)
        try:
            with captured() as out:
                self.mod.search(self.db, query, **kw)
            return out.getvalue()
        finally:
            self.mod.load_variants = real


class TestScope(VaultFixture):
    """The defect this tool exists to prevent: a scope that under-reports."""

    def test_scope_line_counts_every_indexed_file(self):
        self.build()
        out = self.search('Fílon')
        # 2 + 1 + 1 across three collections. If the printed total ever drifts
        # from what was indexed, the tool is lying in the same way archive-refs
        # did when it printed "Done: 90 references" over a dataset of 160.
        self.assertIn('searched 4 file(s) across 3 collection(s)', out)
        for name in ('cof (2)', 'olavo-video (1)', 'transcripts (1)'):
            self.assertIn(name, out)

    def test_every_declared_collection_is_reachable(self):
        """A collection in the code that no search can reach is worse than absent."""
        self.build()
        for query, expect in (('Fílon', 'cof'),
                              ('islâmicas', 'olavo-video'),
                              ('FSSPX', 'transcripts')):
            out = self.search(query)
            self.assertIn(expect, out, '%r did not reach %s' % (query, expect))

    def test_missing_directory_still_appears_in_the_scope_report(self):
        """A collection that vanishes from disk must not vanish from the count.

        Silently dropping it is how a scope shrinks without anyone noticing —
        the search would go on reporting confident zeros over a corpus that had
        quietly lost a third of itself.
        """
        shutil.rmtree(os.path.join(self.tmp, 'olavo-video'))
        self.build()
        out = self.search('Fílon')
        self.assertIn('olavo-video (0)', out)
        self.assertIn('across 3 collection(s)', out)


class TestMatching(VaultFixture):
    """Phrases that exist and must not silently fail to match."""

    def test_accent_folding(self):
        self.build()
        self.assertIn('COF001', self.search('filon'))

    def test_phrase_across_a_line_break_is_found(self):
        """KEYWORDS.md records this trap as a measured 77 against a true 89."""
        self.build()
        out = self.search('"Foro de São Paulo"', raw=True)
        self.assertIn('COF002', out)

    def test_phrase_across_a_chunk_boundary_is_found(self):
        """The overlap has to actually work, or long documents grow blind spots.

        A phrase is planted so that it straddles the first chunk boundary; with
        no overlap it would be split between two chunks and match neither.
        """
        needle = 'a diferença imensurável de poder'
        filler = 'palavra ' * ((self.mod.CHUNK_CHARS // 8) - 2)
        self.write('cof/revisadas/COF003.md', filler + needle + ' ' + filler)
        self.index('cof/index.json', [
            {'id': 'COF001', 'file': 'revisadas/COF001.md', 'reviewStatus': 'revisada'},
            {'id': 'COF002', 'file': 'revisao_pendente/COF002.md',
             'reviewStatus': 'revisao_pendente'},
            {'id': 'COF003', 'file': 'revisadas/COF003.md', 'reviewStatus': 'revisada'},
        ])
        self.build()
        self.assertIn('COF003', self.search('"%s"' % needle, raw=True))


class TestVariants(VaultFixture):
    """The recogniser destroys names; searching the correct spelling must work."""

    def test_canonical_query_finds_the_mangled_occurrence(self):
        self.build()
        out = self.search('Husserl')
        self.assertIn('COF002', out)

    def test_the_expansion_is_reported(self):
        """A hit that only matched a mangling must be discountable by the reader."""
        self.build()
        out = self.search('Husserl')
        self.assertIn('expand:', out)
        self.assertIn('Russel', out)

    def test_multiword_canonical_expands(self):
        self.build()
        out = self.search('Al-Azhar')
        self.assertIn('to-049', out)
        self.assertIn('Universidade de Lázaro', out)

    def test_raw_bypasses_expansion(self):
        """--raw must mean raw: no silent widening of a deliberately exact query."""
        self.build()
        out = self.search('Husserl', raw=True)
        self.assertNotIn('expand:', out)
        self.assertNotIn('COF002', out)


class TestHonesty(VaultFixture):
    """What the output must say about its own limits."""

    def test_zero_results_say_it_is_not_evidence_of_absence(self):
        self.build()
        out = self.search('zoroastrismo')
        self.assertIn('hits  : 0', out)
        self.assertIn('not evidence of absence', out)
        self.assertIn('CLAIM rather than the NAME', out)

    def test_zero_results_still_print_the_scope(self):
        """A zero is worthless unless it says what was looked at."""
        self.build()
        out = self.search('zoroastrismo')
        self.assertIn('searched 4 file(s)', out)

    def test_unverified_dates_are_labelled(self):
        self.build()
        out = self.search('islâmicas')
        self.assertIn('2007-11-19 (unverified)', out)

    def test_verified_dates_are_not_labelled_unverified(self):
        self.build()
        out = self.search('Fílon')
        self.assertIn('2009-03-14', out)
        self.assertNotIn('2009-03-14 (unverified)', out)

    def test_undated_documents_say_undated(self):
        self.build()
        out = self.search('Foro')
        self.assertIn('undated', out)

    def test_review_status_travels_with_the_hit(self):
        """A garbled unreviewed file must never look like a reviewed one."""
        self.build()
        self.assertIn('revisada', self.search('Fílon'))
        self.assertIn('revisao_pendente', self.search('Foro'))


class TestCoverage(VaultFixture):
    """archive#37: a file can be present, legible, and missing its last third."""

    def setUp(self):
        super().setUp()
        os.makedirs(os.path.join(self.tmp, 'webcaptures'), exist_ok=True)
        self.write('webcaptures/cof-audio-durations.json', json.dumps({'aulas': {
            '1': {'estimatedCoverage': 0.98},     # COF001 — whole
            '2': {'estimatedCoverage': 0.34},     # COF002 — abandoned mid-stream
        }}))

    def test_incomplete_files_are_named_with_every_search(self):
        self.build()
        out = self.search('Fílon')
        self.assertIn('caveat:', out)
        self.assertIn('COF002', out)
        self.assertIn('archive#37', out)

    def test_a_zero_says_the_corpus_is_not_entire(self):
        """The whole point. A zero over a truncated corpus is not an absence."""
        self.build()
        out = self.search('zoroastrismo')
        self.assertIn('hits  : 0', out)
        self.assertIn('INCOMPLETE', out.upper())
        self.assertIn('positional', out)
        self.assertIn('may not be quoted as a', out)

    def test_a_hit_from_an_incomplete_file_is_marked(self):
        self.build()
        out = self.search('Foro')          # lives in COF002, coverage 0.34
        self.assertIn('INCOMPLETE 34%', out)

    def test_a_hit_from_a_whole_file_is_not_marked(self):
        self.build()
        out = self.search('Fílon')         # lives in COF001, coverage 0.98
        self.assertNotIn('INCOMPLETE', out.split('caveat:')[-1].split('hits')[-1])

    def test_loop_corrected_coverage_wins_when_present(self):
        """estimatedCoverage counts junk as content; ExLoops is the honest one."""
        self.write('webcaptures/cof-audio-durations.json', json.dumps({'aulas': {
            '2': {'estimatedCoverage': 0.48, 'estimatedCoverageExLoops': 0.41},
        }}))
        self.build()
        out = self.search('Fílon')
        self.assertIn('COF002 41%', out)
        self.assertNotIn('COF002 48%', out)

    def test_no_coverage_data_means_no_false_reassurance(self):
        """Absent measurements must not render as 'complete'."""
        os.remove(os.path.join(self.tmp, 'webcaptures', 'cof-audio-durations.json'))
        self.build()
        out = self.search('zoroastrismo')
        self.assertNotIn('caveat:', out)
        self.assertIn('not evidence of absence', out)


class TestFilters(VaultFixture):

    def test_collection_filter_narrows_and_says_so(self):
        self.build()
        out = self.search('a', collection='olavo-video')
        self.assertIn('filter: collection = olavo-video', out)
        self.assertNotIn('cof / COF', out)

    def test_reviewed_filter_excludes_pending(self):
        self.build()
        out = self.search('a', reviewed=True)
        self.assertIn('filter: reviewed transcriptions only', out)
        self.assertNotIn('COF002', out)


class TestUnits(unittest.TestCase):
    """The pure helpers, without a vault."""

    def setUp(self):
        self.mod = load()

    def test_normalise_collapses_all_whitespace(self):
        self.assertEqual(self.mod.normalise('a\n b\t\tc  \n\nd'), 'a b c d')

    def test_chunks_cover_the_whole_text(self):
        text = 'x' * 5000
        pieces = list(self.mod.chunks(text))
        self.assertTrue(pieces)
        # every character reachable: last chunk must run to the end
        self.assertEqual(pieces[-1][0] + len(pieces[-1][1]), len(text))

    def test_chunks_overlap(self):
        text = 'y' * 5000
        pieces = list(self.mod.chunks(text))
        starts = [p[0] for p in pieces]
        for a, b in zip(starts, starts[1:]):
            self.assertLess(b - a, self.mod.CHUNK_CHARS,
                            'consecutive chunks do not overlap')

    def test_short_text_yields_one_chunk(self):
        self.assertEqual(len(list(self.mod.chunks('curto'))), 1)

    def test_empty_text_yields_nothing(self):
        self.assertEqual(list(self.mod.chunks('')), [])

    def test_strip_accents(self):
        self.assertEqual(self.mod.strip_accents('Fílon de São Paulo'),
                         'Filon de Sao Paulo')

    def test_load_index_leaves_unknown_dates_none(self):
        """An unknown date must never render as a known one."""
        tmp = tempfile.mkdtemp()
        try:
            p = os.path.join(tmp, 'i.json')
            with open(p, 'w', encoding='utf-8') as fh:
                json.dump({'docs': [{'id': 'X', 'file': 'a.txt'}]}, fh)
            meta = self.mod.load_index(p)
            self.assertIsNone(meta['a.txt']['date'])
            self.assertEqual(meta['a.txt']['date_verified'], 0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_load_index_survives_a_broken_file(self):
        tmp = tempfile.mkdtemp()
        try:
            p = os.path.join(tmp, 'i.json')
            with open(p, 'w', encoding='utf-8') as fh:
                fh.write('{not json')
            self.assertEqual(self.mod.load_index(p), {})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_load_index_of_a_missing_file_is_empty(self):
        self.assertEqual(self.mod.load_index('/nonexistent/i.json'), {})

    def test_dedup_collapses_a_machine_loop_but_keeps_the_phrase(self):
        """355 consecutive copies of one sentence are indexed as three.

        The phrase must stay findable -- dropping it entirely would turn a
        recogniser defect into a false absence, which is the exact class of
        error this tool exists to prevent. What dies is the frequency count.
        """
        text = 'Antes disso ele falou de Kant. ' + 'Você não pode. ' * 355 + 'Depois continuou a aula.'
        out = self.mod.dedup_runs(self.mod.normalise(text))
        self.assertEqual(out.count('Você não pode.'), 3)
        self.assertIn('Antes disso ele falou de Kant.', out)
        self.assertIn('Depois continuou a aula.', out)

    def test_dedup_leaves_genuine_repetition_alone(self):
        """Up to three identical sentences in a row is speech, not a loop."""
        text = 'Obrigado. Obrigado. Obrigado. E boa noite a todos.'
        self.assertEqual(self.mod.dedup_runs(self.mod.normalise(text)),
                         self.mod.normalise(text))

    def test_dedup_does_not_touch_nonadjacent_repeats(self):
        text = 'É isso. Mas há mais. É isso. Mas há mais. É isso.'
        self.assertEqual(self.mod.dedup_runs(text), text)

    def test_expand_leaves_unknown_terms_alone(self):
        fts, notes = self.mod.expand('Aristóteles', {})
        self.assertEqual(notes, [])
        self.assertIn('Aristóteles', fts)


if __name__ == '__main__':
    unittest.main()
