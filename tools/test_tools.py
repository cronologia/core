#!/usr/bin/env python3
"""Unit tests for the agent-side analysis tools (stdlib unittest only).

    python3 -m unittest discover -s tools -p 'test_*.py' -v

Covers the pure helpers — extraction, parsing, matching, rendering. No network,
no repo mutation: the dataset fixtures are built in a temporary directory, and
nothing here writes to a real project.
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


@contextlib.contextmanager
def silent():
    """Run a tool's main() without its report landing in the test output."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        with contextlib.redirect_stderr(io.StringIO()):
            yield buffer


def load(filename, name):
    spec = importlib.util.spec_from_file_location(name,
                                                  os.path.join(HERE, filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


mp = load("mine-prep.py", "mine_prep")
dq = load("dataset-query.py", "dataset_query")
ur = load("unverified-report.py", "unverified_report")
xr = load("xref.py", "xref")
ss = load("sync-skills.py", "sync_skills")
bk = load("build-keywords.py", "build_keywords")
ne = load("normalise-entities.py", "normalise_entities")
cx = load("cof-xref.py", "cof_xref")
cg = load("cof-graph.py", "cof_graph")


TRANSCRIPT = """Título do vídeo | Canal
https://example.invalid/watch?v=abc — transcript: auto-captions
==============================================================================

Bom dia.
>> Em 1988 dom Marcel Lefebvre sagrou
quatro bispos em Écône.
>> Exatamente. O Lefevre disse que a
missa de 1962 seria mantida.
Havia cerca de 600 padres e 95% dos
fiéis apoiavam, segundo o Lefébvre.
Em julho de 2026 tudo mudou.
"""


class TestFlow(unittest.TestCase):
    def test_header_end_skips_banner(self):
        lines = TRANSCRIPT.split("\n")
        self.assertEqual(lines[mp.header_end(lines)], "")
        self.assertEqual(mp.header_end(["a", "b"]), 0)

    def test_strip_speaker_preserves_length(self):
        line = ">> Em 1988 alguém falou"
        self.assertEqual(len(mp.strip_speaker(line)), len(line))
        self.assertNotIn(">>", mp.strip_speaker(line))

    def test_flow_excludes_header_and_locates_offsets(self):
        flow = mp.Flow.build(TRANSCRIPT)
        self.assertNotIn("example.invalid", flow.text)
        pos = flow.text.index("1988")
        line, char = flow.locate(pos)
        self.assertEqual(TRANSCRIPT.split("\n")[line - 1],
                         ">> Em 1988 dom Marcel Lefebvre sagrou")
        # the offset points past the speaker marker, at the text itself
        self.assertEqual(TRANSCRIPT[char:char + 4], "1988")

    def test_turn_starts_marked(self):
        flow = mp.Flow.build(TRANSCRIPT)
        self.assertTrue(flow.turn_starts)
        for start in flow.turn_starts:
            self.assertTrue(flow.text[start].isupper() or
                            flow.text[start].isalpha())

    def test_context_window_snaps_and_marks_elision(self):
        text = "Uma frase antes. O evento de 1988 aconteceu aqui. Depois disso."
        window = mp.context_window(text, text.index("1988"), 40)
        self.assertIn("1988", window)
        self.assertTrue(len(window) <= 80)
        self.assertNotIn("Uma frase antes", window)


class TestDated(unittest.TestCase):
    def test_year_and_pt_month_expressions(self):
        flow = mp.Flow.build(TRANSCRIPT)
        items = mp.find_dated(flow, "pt")
        matched = " ".join(it["match"] for it in items)
        self.assertIn("1988", matched)
        self.assertIn("julho", matched)
        for item in items:
            self.assertGreater(item["line"], 0)
            self.assertGreater(item["char"], 0)

    def test_english_may_alone_is_not_a_date(self):
        pattern = mp.dated_pattern("en")
        self.assertFalse(pattern.search("they may begin to imbibe that"))
        self.assertTrue(pattern.search("it was November of 1970"))
        self.assertTrue(pattern.search("on May 5 the protocol was signed"))
        self.assertTrue(pattern.search("during the late 60s"))

    def test_portuguese_two_digit_year_but_not_quantity(self):
        pattern = mp.dated_pattern("pt")
        self.assertTrue(pattern.search("as sagrações de 88 foram válidas"))
        self.assertFalse(pattern.search("um homem de 50 anos"))


class TestProperNouns(unittest.TestCase):
    def test_variants_cluster_on_one_key(self):
        self.assertEqual(mp.name_key("Lefebvre"), mp.name_key("Lefevre"))
        self.assertEqual(mp.name_key("Lefebvre"), mp.name_key("Lefébvre"))
        self.assertEqual(mp.name_key("Dom Marcel Lefebvre"),
                         mp.name_key("Marcel Lefebvre"))
        self.assertNotEqual(mp.name_key("Guénon"), mp.name_key("Schuon"))

    def test_extraction_groups_spellings_and_drops_fillers(self):
        flow = mp.Flow.build(TRANSCRIPT)
        names, total = mp.extract_proper_nouns(flow, min_count=1)
        by_key = dict((n["key"], n) for n in names)
        self.assertIn("lefevre", by_key,
                      "expected one Lefebvre cluster: %r" % list(by_key))
        cluster = by_key["lefevre"]
        self.assertEqual(cluster["count"], 2)  # 'Lefevre' + 'Lefébvre'
        self.assertEqual(len(cluster["spellings"]), 2)
        self.assertIn(mp.name_key("Marcel Lefebvre"), by_key)
        self.assertNotIn("exatamente", [k for k in by_key])
        self.assertEqual(total, len(names))

    def test_lowercase_common_words_are_not_names(self):
        text = "banner\n" + "=" * 10 + "\n\nEntendi. entendi mesmo, entendi.\n"
        flow = mp.Flow.build(text)
        names, _ = mp.extract_proper_nouns(flow, min_count=1)
        self.assertEqual([n["name"] for n in names], [])

    def test_caption_artifacts_ignored(self):
        text = "banner\n" + "=" * 10 + "\n\n[Music] and [Music] again [Music]\n"
        flow = mp.Flow.build(text)
        names, _ = mp.extract_proper_nouns(flow, min_count=1)
        self.assertEqual([n["name"] for n in names], [])


class TestNumbersQuotes(unittest.TestCase):
    def test_numbers_catch_units_and_percentages(self):
        pattern = mp.numbers_pattern()
        self.assertTrue(pattern.search("cerca de 600 padres"))
        self.assertTrue(pattern.search("95% dos fiéis"))
        self.assertTrue(pattern.search("2 mil pessoas"))
        self.assertTrue(pattern.search("R$ 1.000"))

    def test_numbers_report_one_item_per_sentence(self):
        # two figures in one sentence collapse to a single candidate line,
        # whose context carries both — dedup is deliberate
        items = mp.find_numbers(mp.Flow.build(TRANSCRIPT))
        self.assertEqual([it["match"] for it in items], ["600 padres"])
        self.assertIn("95%", items[0]["context"])

    def test_bare_years_are_not_numbers(self):
        self.assertTrue(mp.BARE_YEAR.match("1988"))
        flow = mp.Flow.build("h\n" + "=" * 5 + "\n\nfoi em 1988 e pronto\n")
        self.assertEqual(mp.find_numbers(flow), [])

    def test_quotes_pick_up_attribution_verbs(self):
        flow = mp.Flow.build(TRANSCRIPT)
        matches = [it["match"].lower() for it in mp.find_quotes(flow, "pt")]
        self.assertTrue(any(m.startswith("disse") for m in matches))
        pattern = mp.quotes_pattern("pt")
        self.assertTrue(pattern.search("segundo o autor"))
        self.assertTrue(pattern.search("ele afirmou que"))
        self.assertTrue(pattern.search("eu vi aquilo"))
        self.assertFalse(pattern.search("a conta de energia"))

    def test_english_first_person_attribution(self):
        pattern = mp.quotes_pattern("en")
        self.assertTrue(pattern.search("I was attending the chapel"))
        self.assertTrue(pattern.search("he claims the decree is void"))


class TestSheet(unittest.TestCase):
    def test_cap_items_samples_across_the_file(self):
        items = [{"line": i, "char": i} for i in range(100)]
        picked = mp.cap_items(items, 5)
        self.assertEqual(len(picked), 5)
        self.assertEqual(picked[0]["line"], 0)
        self.assertEqual(picked[-1]["line"], 99)
        self.assertEqual(mp.cap_items(items[:3], 10), items[:3])

    def test_build_sheet_shape_and_asr_note(self):
        sheet = mp.build_sheet("t.txt", TRANSCRIPT, {"id": "x", "title": "T",
                                                     "language": "pt"},
                               "auto", 5, 120)
        self.assertEqual(sheet["language"], "pt")
        self.assertEqual(sorted(sheet["sections"]),
                         ["dated", "names", "numbers", "quotes"])
        text = mp.render(sheet)
        self.assertIn("ASR", text)
        self.assertIn("verify against the audio", text)
        self.assertIn("## DATED CLAIMS", text)
        json.dumps(sheet)  # must stay JSON-serializable

    def test_detect_language(self):
        self.assertEqual(mp.detect_language("você não sabe que ele é muito "
                                            "bom para uma coisa dessas"), "pt")
        self.assertEqual(mp.detect_language("the thing that you said and it's "
                                            "the way with that"), "en")

    def test_resolve_transcript_by_id_and_file(self):
        docs = [{"id": "abc-1", "file": "transcript-1.txt", "language": "pt"}]
        path, doc = mp.resolve_transcript("abc-1", docs, "/tmp/x")
        self.assertEqual(path, os.path.join("/tmp/x", "transcript-1.txt"))
        self.assertEqual(doc["language"], "pt")
        path, doc = mp.resolve_transcript("transcript-1.txt", docs, "/tmp/x")
        self.assertEqual(doc["id"], "abc-1")
        path, doc = mp.resolve_transcript("other.txt", docs, "/tmp/x")
        self.assertIsNone(doc)


# --------------------------------------------------------------------------
# dataset fixtures (temporary — no real repo is read or written)
# --------------------------------------------------------------------------

CHRONOLOGY = {
    "meta": {"title": "Test"},
    "facts": [{"label": "What it is", "value": "A society founded by "
                                               "Marcel Lefebvre in 1970.",
               "sources": ["ref-a"]}],
    "events": [
        {"year": 1970, "date": "1970-11-01", "dateVerified": True,
         "place": "Fribourg", "title": "Founding", "text": "Erected as a "
         "pia unio.", "sources": ["ref-a"]},
        {"year": 1988, "date": "1988", "dateVerified": False,
         "place": "Écône", "title": "Consecrations", "text": "Four bishops.",
         "sources": []},
    ],
    "figures": [
        {"name": "Marcel Lefebvre", "role": "Founder and first Superior "
         "General; a member of the order.", "dates": "1905–1991",
         "country": "France", "sources": ["ref-a"]},
    ],
    "organizations": [
        {"name": "FSSP — Priestly Fraternity of Saint Peter",
         "founded": "1988", "relation": "Founded by twelve priests.",
         "sources": ["ref-b"]},
    ],
    "disambiguation": {"note": "n", "items": [
        {"title": "X is not Y", "text": "Status to confirm.",
         "sources": ["ref-a"]}]},
    "references": [
        {"id": "ref-a", "title": "Source A", "url": "https://a.invalid/",
         "publisher": "P", "type": "encyclopedia"},
        {"id": "ref-b", "title": "Source B (to verify)",
         "url": "https://b.invalid/", "publisher": "P", "type": "news"},
    ],
}

GLOSSARY = {
    "meta": {"title": "Glossary"},
    "terms": [{"id": "schism", "term": "Schism", "definition": "A rupture.",
               "projects": ["fsspx"], "sources": ["ref-a"]}],
    "references": [{"id": "ref-a", "title": "Source A",
                    "url": "https://a.invalid/", "publisher": "P",
                    "type": "primary"}],
}

OTHER_CHRONOLOGY = {
    "meta": {"title": "Other"},
    "facts": [{"label": "What it is", "value": "A school whose figures "
                                               "include Marcel Lefebvre."}],
    "events": [],
    "figures": [{"name": "Marcel Lefebvre", "role": "Adjacent to the "
                 "movement but never a member of it.", "dates": "1905–1991",
                 "sources": ["ref-c"]}],
    "organizations": [],
    "references": [{"id": "ref-c", "title": "Source C",
                    "url": "https://c.invalid/", "publisher": "P",
                    "type": "news"}],
}


class DatasetFixture(unittest.TestCase):
    """Builds repo-shaped directories in a temp dir; nothing real is touched."""

    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp(prefix="cronologia-tools-test-")
        cls.previous = os.environ.get("CRONOLOGIA_HOME")
        os.environ["CRONOLOGIA_HOME"] = cls.root
        cls.write("alpha", "chronology.json", CHRONOLOGY)
        cls.write("alpha", "archives.json",
                  {"snapshots": {"https://a.invalid/": {"refId": "ref-a"}}})
        cls.write("beta", "chronology.json", OTHER_CHRONOLOGY)
        cls.write("words", "glossary.json", GLOSSARY)

    @classmethod
    def write(cls, repo, filename, payload):
        directory = os.path.join(cls.root, repo, "data")
        if not os.path.isdir(directory):
            os.makedirs(directory)
        with open(os.path.join(directory, filename), "w",
                  encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root, ignore_errors=True)
        if cls.previous is None:
            os.environ.pop("CRONOLOGIA_HOME", None)
        else:
            os.environ["CRONOLOGIA_HOME"] = cls.previous


class Args(object):
    def __init__(self, **kwargs):
        self.args = kwargs.pop("args", [])
        self.unarchived = kwargs.pop("unarchived", False)
        for key, value in kwargs.items():
            setattr(self, key, value)


class TestDatasetQuery(DatasetFixture):
    def test_resolve_repo_by_bare_name_and_kind_detection(self):
        repo = dq.resolve_repo("alpha")
        self.assertEqual(repo, os.path.join(self.root, "alpha"))
        _data, kind = dq.load_dataset(repo)
        self.assertEqual(kind, "chronology")
        _data, kind = dq.load_dataset(dq.resolve_repo("words"))
        self.assertEqual(kind, "glossary")

    def test_iter_records_reaches_nested_sections(self):
        locators = [loc for _c, loc, _r in dq.iter_records(CHRONOLOGY)]
        self.assertIn("events[1]", locators)
        self.assertIn("disambiguation.items[0]", locators)
        self.assertIn("references[1]", locators)

    def test_record_id_and_date(self):
        self.assertEqual(dq.record_id(CHRONOLOGY["events"][0]), "Founding")
        self.assertEqual(dq.record_date(CHRONOLOGY["events"][0]), "1970-11-01")
        self.assertEqual(dq.record_id({}), "-")
        self.assertEqual(dq.record_date({}), "-")

    def test_find_is_accent_insensitive(self):
        rows, fields = dq.cmd_find(CHRONOLOGY, "chronology",
                                   Args(args=["econe"]))
        self.assertEqual(fields[0], "locator")
        self.assertTrue(any(r["locator"] == "events[1]" for r in rows))

    def test_snippet_centres_on_the_keyword(self):
        text = "x" * 300 + " Lefebvre " + "y" * 300
        self.assertIn("Lefebvre", dq.snippet(text, "Lefebvre", 60))

    def test_event_year_range(self):
        self.assertEqual(dq.parse_year_range("1988"), (1988, 1988))
        self.assertEqual(dq.parse_year_range("1970-1990"), (1970, 1990))
        self.assertRaises(ValueError, dq.parse_year_range, "soon")
        rows, _f = dq.cmd_event(CHRONOLOGY, "chronology", Args(args=["1988"]))
        self.assertEqual([r["locator"] for r in rows], ["events[1]"])
        self.assertEqual(rows[0]["verified"], "N")

    def test_figure_matches_organizations_too(self):
        rows, _f = dq.cmd_figure(CHRONOLOGY, "chronology", Args(args=["fssp"]))
        self.assertEqual(rows[0]["locator"], "organizations[0]")
        self.assertEqual(rows[0]["dates"], "1988")

    def test_refs_unarchived_filter(self):
        archives = dq.load_archives(dq.resolve_repo("alpha"))
        rows, _f = dq.cmd_refs(CHRONOLOGY, "chronology", Args(), archives)
        self.assertEqual([r["archived"] for r in rows], ["y", "N"])
        rows, _f = dq.cmd_refs(CHRONOLOGY, "chronology",
                               Args(unarchived=True), archives)
        self.assertEqual([r["id"] for r in rows], ["ref-b"])

    def test_stats_counts_and_flags(self):
        rows, _f = dq.cmd_stats(CHRONOLOGY, "chronology", Args(), {})
        counts = dict((r["collection"], r["count"]) for r in rows)
        self.assertEqual(counts["events"], 2)
        self.assertEqual(counts["references"], 2)
        self.assertEqual(counts["unverified.flags"], 3)

    def test_main_exit_codes(self):
        with silent():
            self.assertEqual(dq.main(["alpha", "stats"]), 0)
            self.assertEqual(dq.main(["words", "event", "1988"]), 2)
            self.assertEqual(dq.main(["nope", "stats"]), 1)


class TestFlagRule(unittest.TestCase):
    def test_boolean_and_text_flags(self):
        flags = dq.flagged_fields(CHRONOLOGY["events"][1])
        self.assertEqual([f[1] for f in flags], ["dateVerified:false"])
        flags = dq.flagged_fields(CHRONOLOGY["references"][1])
        self.assertEqual(flags[0][0], "title")
        self.assertEqual(flags[0][1], "text:(to verify)")
        self.assertEqual(dq.flagged_fields(CHRONOLOGY["events"][0]), [])

    def test_nested_paths_are_reported(self):
        flags = dq.flagged_fields({"a": {"b": [{"verified": False}]}})
        self.assertEqual(flags[0][0], "a.b[0].verified")


class TestUnverifiedReport(DatasetFixture):
    def test_natural_key_sorts_numerically(self):
        order = sorted(["events[24]", "events[9]", "facts[1]"],
                       key=ur.natural_key)
        self.assertEqual(order, ["events[9]", "events[24]", "facts[1]"])

    def test_collect_groups_and_counts(self):
        report = ur.collect("alpha")
        self.assertEqual(report["repo"], "alpha")
        reasons = sorted(r["reason"] for r in report["rows"])
        self.assertEqual(reasons, ["dateVerified:false", "text:(to verify)",
                                   "text:to confirm"])
        groups = dict(ur.group_by_collection(report["rows"]))
        self.assertIn("events", groups)
        self.assertIn("references", groups)

    def test_markdown_is_a_checklist(self):
        text = ur.render_markdown([ur.collect("alpha")])
        self.assertIn("- [ ] `events[1]`", text)
        self.assertIn("sourcing-rules", text)

    def test_text_render_states_the_rule(self):
        text = ur.render_text([ur.collect("alpha")])
        self.assertIn("dateVerified:false", text)
        self.assertIn("## alpha (chronology) — 3", text)

    def test_main_reports_missing_repo_without_crashing(self):
        with silent():
            self.assertEqual(ur.main(["alpha"]), 0)
            self.assertEqual(ur.main(["definitely-not-a-repo"]), 1)


class TestXref(DatasetFixture):
    def test_name_variants_split_aliases_and_dashes(self):
        self.assertIn("René Guénon",
                      xr.name_variants("René Guénon (Abd al-Wahid Yahya)"))
        self.assertIn("Abd al-Wahid Yahya",
                      xr.name_variants("René Guénon (Abd al-Wahid Yahya)"))
        self.assertIn("Priestly Fraternity of Saint Peter",
                      xr.name_variants("FSSP — Priestly Fraternity of "
                                       "Saint Peter"))

    def test_normal_name_drops_honorifics_and_accents(self):
        self.assertEqual(xr.normal_name("Dom Marcel Lefebvre"),
                         "marcel lefebvre")
        self.assertEqual(xr.normal_name("René Guénon"), "rene guenon")

    def test_is_notable_name_requires_two_words(self):
        self.assertTrue(xr.is_notable_name("marcel lefebvre"))
        self.assertFalse(xr.is_notable_name("roma"))
        self.assertFalse(xr.is_notable_name(""))

    def test_proper_nouns_in_facts(self):
        found = [n for n, _c in xr.proper_nouns_in_facts(CHRONOLOGY)]
        self.assertIn("Marcel Lefebvre", found)

    def test_affiliation_terms_scope_negation(self):
        self.assertEqual(xr.affiliation_terms("a member of the order"),
                         set(["member"]))
        self.assertEqual(xr.affiliation_terms("adjacent to it but never a "
                                              "member of it"),
                         set(["adjacent", "!member"]))
        self.assertEqual(xr.affiliation_terms("a quiet biography"), set())

    def test_divergence_levels(self):
        status, _r = xr.divergence([{"repo": "a", "description": "a member"},
                                    {"repo": "b",
                                     "description": "never a member"}])
        self.assertEqual(status, "contradiction")
        status, _r = xr.divergence([{"repo": "a", "description": "a member"},
                                    {"repo": "b", "description": "a founder"}])
        self.assertEqual(status, "differs")
        status, _r = xr.divergence([{"repo": "a", "description": "a member"},
                                    {"repo": "b", "description": "a member"}])
        self.assertEqual(status, "ok")

    def test_build_report_finds_shared_entity_and_contradiction(self):
        report = xr.build_report(["alpha", "beta"])
        keys = dict((row["key"], row) for row in report["rows"])
        self.assertIn("marcel lefebvre", keys)
        row = keys["marcel lefebvre"]
        self.assertEqual(sorted(row["repos"]), ["alpha", "beta"])
        self.assertEqual(row["status"], "contradiction")
        self.assertEqual(report["contradictions"], 1)
        text = xr.render(report)
        self.assertIn("CONTRADICTION", text)
        self.assertIn("Nothing here is auto-resolved", text)

    def test_min_repos_filter(self):
        report = xr.build_report(["alpha", "beta"], min_repos=3)
        self.assertEqual(report["rows"], [])

    def test_main_returns_zero(self):
        with silent() as out:
            self.assertEqual(xr.main(["--repos", "alpha,beta", "--json"]), 0)
        self.assertEqual(json.loads(out.getvalue())["contradictions"], 1)


# --------------------------------------------------------------------------
# build-keywords — the generated half of a KEYWORDS.md
# --------------------------------------------------------------------------

KEYWORDS_CHRONOLOGY = {
    "meta": {
        "title": "Alpha Society — Cronologia",
        "subtitle": "Chronology of the Alpha Society (1970–present)",
        "description": "A chronology of the Alpha Society "
                       "(Sociedade Alfa, AS/ALS), founded in 1970.",
        "siteUrl": "https://example.invalid/alpha/",
        "lastUpdated": "2026-07-25",
    },
    "facts": [{"label": "What it is", "value": "A [[pia-unio|pious union]] "
                                               "erected in 1970."}],
    "events": [
        {"year": 1970, "date": "1970-11-01", "dateVerified": True,
         "place": "Fribourg", "title": "Founding", "text": "Erected."},
        {"year": 1988, "date": "1988", "dateVerified": False,
         "place": "Fribourg", "title": "Break", "text":
         "Described as a [[schism|schismatic]] act; also [[not-pinned]]."},
    ],
    "figures": [
        {"id": "jean-doe", "name": "Jean Doe (Yahya Doe)", "dates": "1905–1991",
         "country": "France", "role": "Founder."},
        {"name": "Ana Silva, Bruno Costa, Carla Dias", "role": "Signatories."},
    ],
    "organizations": [
        {"name": "XYZ — Example Society of Things", "founded": "1988",
         "place": "Fribourg", "relation": "A later foundation."},
        {"name": "Casa Alfa (regional house)", "relation": "A house."},
    ],
    "references": [],
}


class TestKeywordHelpers(unittest.TestCase):
    """Pure helpers: every variant must be a form present in the input."""

    def test_search_variants_alias_and_dash(self):
        got = bk.search_variants("René Guénon (Abd al-Wahid Yahya)")
        self.assertEqual(got, ["René Guénon (Abd al-Wahid Yahya)",
                               "René Guénon", "Abd al-Wahid Yahya"])
        self.assertIn("Priestly Fraternity of Saint Peter",
                      bk.search_variants("FSSP — Priestly Fraternity of "
                                         "Saint Peter"))
        self.assertIn("FSSP", bk.search_variants("FSSP — Priestly Fraternity "
                                                 "of Saint Peter"))

    def test_search_variants_drops_lowercase_descriptor_parenthetical(self):
        got = bk.search_variants("Tariqa Alawiyya (parent order)")
        self.assertEqual(got, ["Tariqa Alawiyya (parent order)",
                               "Tariqa Alawiyya"])
        self.assertNotIn("parent order", got)

    def test_search_variants_slash_only_between_names(self):
        self.assertIn("Benedict XVI",
                      bk.search_variants("Joseph Ratzinger / Benedict XVI"))
        got = bk.search_variants("Foundation for Studies / journal Sophia")
        self.assertEqual(got, ["Foundation for Studies / journal Sophia"])

    def test_search_variants_splits_a_field_holding_several_people(self):
        got = bk.search_variants("Ana Silva, Bruno Costa, Carla Dias")
        self.assertIn("Bruno Costa", got)
        self.assertEqual(bk.search_variants("Doe, Jean"), ["Doe, Jean"])

    def test_search_variants_dedupes_and_handles_empty(self):
        self.assertEqual(bk.search_variants("  "), [])
        self.assertEqual(bk.search_variants("Alfa (Alfa)"),
                         ["Alfa (Alfa)", "Alfa"])
        self.assertEqual(bk.dedupe(["Écône", "Ecône", "écone", "Rome"]),
                         ["Écône", "Rome"])

    def test_paren_terms_pulls_acronyms_not_date_ranges(self):
        got = bk.paren_terms("The Society of Saint Pius X "
                             "(Sociedade de São Pio X, SSPX/FSSPX) since "
                             "(1970–present)")
        self.assertEqual(got, ["Sociedade de São Pio X", "SSPX", "FSSPX"])
        self.assertEqual(bk.paren_terms("a status (to verify)"), [])

    def test_find_markers_reads_grammar_and_visible_text(self):
        self.assertEqual(bk.find_markers("a [[schism]] and "
                                         "[[pia-unio|pious union]]"),
                         [("schism", ""), ("pia-unio", "pious union")])
        self.assertEqual(bk.find_markers("no markers here"), [])
        self.assertEqual(bk.find_markers("[[Not A Slug]]"), [])
        self.assertEqual(bk.find_markers(None), [])

    def test_walk_strings_paths(self):
        found = dict(bk.walk_strings({"a": [{"b": "x"}], "c": "y"}))
        self.assertEqual(found["a[0].b"], "x")
        self.assertEqual(found["c"], "y")


class TestKeywordMerge(unittest.TestCase):
    """The whole design: regenerate the block, keep the hand-written half."""

    BLOCK = bk.BEGIN_MARKER + "\ngenerated v2\n" + bk.END_MARKER

    def test_replace_preserves_text_before_and_after(self):
        existing = ("# KEYWORDS\n\nhand-written trap: FSSPX is a dead term\n\n"
                    + bk.BEGIN_MARKER + "\ngenerated v1\n" + bk.END_MARKER
                    + "\n\n## Appendix\n\nkeep me\n")
        text, status = bk.merge_generated(existing, self.BLOCK)
        self.assertEqual(status, "replaced")
        self.assertIn("hand-written trap: FSSPX is a dead term", text)
        self.assertIn("keep me", text)
        self.assertIn("generated v2", text)
        self.assertNotIn("generated v1", text)
        self.assertEqual(text.count(bk.BEGIN_MARKER), 1)

    def test_replace_is_idempotent(self):
        first, _s = bk.merge_generated("# K\n\nnotes\n", self.BLOCK)
        second, status = bk.merge_generated(first, self.BLOCK)
        self.assertEqual(second, first)
        self.assertEqual(status, "replaced")

    def test_append_when_file_has_no_markers(self):
        text, status = bk.merge_generated("# K\n\nnotes\n", self.BLOCK)
        self.assertEqual(status, "appended")
        self.assertTrue(text.startswith("# K\n\nnotes\n\n"))
        self.assertTrue(text.endswith(bk.END_MARKER))

    def test_unbalanced_or_reversed_markers_refuse_to_write(self):
        self.assertRaises(ValueError, bk.merge_generated,
                          "x\n" + bk.BEGIN_MARKER + "\n", self.BLOCK)
        self.assertRaises(ValueError, bk.merge_generated,
                          "x\n" + bk.END_MARKER + "\n", self.BLOCK)
        self.assertRaises(ValueError, bk.merge_generated,
                          bk.END_MARKER + "\n" + bk.BEGIN_MARKER, self.BLOCK)


class TestBuildKeywords(DatasetFixture):
    @classmethod
    def setUpClass(cls):
        super(TestBuildKeywords, cls).setUpClass()
        cls.write("kw", "chronology.json", KEYWORDS_CHRONOLOGY)
        cls.write("kw", "glossary-terms.json",
                  {"baseUrl": "https://glossary.invalid/",
                   "terms": ["schism", "pia-unio"]})

    def bundle(self):
        return bk.collect(dq.resolve_repo("kw"), "words")

    def test_subject_names_from_title_and_description(self):
        terms = [row["term"] for row in self.bundle()["subject_names"]]
        self.assertIn("Alpha Society", terms)
        self.assertIn("Sociedade Alfa", terms)
        self.assertIn("AS", terms)
        self.assertIn("ALS", terms)
        self.assertNotIn("Cronologia", terms)

    def test_people_carry_locator_id_and_page_url(self):
        rows = self.bundle()["people"]
        self.assertEqual(rows[0]["locator"], "figures[0]")
        self.assertEqual(rows[0]["id"], "jean-doe")
        self.assertEqual(rows[0]["url"],
                         "https://example.invalid/alpha/figures/jean-doe.html")
        self.assertIn("Yahya Doe", rows[0]["variants"])
        self.assertEqual(rows[1]["url"], "")
        self.assertIn("Carla Dias", rows[1]["variants"])

    def test_organizations_split_acronym_from_full_name(self):
        rows = self.bundle()["organizations"]
        self.assertEqual(rows[0]["locator"], "organizations[0]")
        self.assertIn("XYZ", rows[0]["variants"])
        self.assertIn("Example Society of Things", rows[0]["variants"])
        self.assertEqual(rows[1]["variants"], ["Casa Alfa"])

    def test_terms_resolve_display_name_and_flag_unpinned_ids(self):
        rows = dict((row["id"], row) for row in self.bundle()["terms"])
        self.assertEqual(rows["schism"]["display"], "Schism")
        self.assertEqual(rows["schism"]["displays"], ["schismatic"])
        self.assertTrue(rows["schism"]["pinned"])
        self.assertEqual(rows["pia-unio"]["displays"], ["pious union"])
        self.assertEqual(rows["pia-unio"]["locators"], ["facts[0].value"])
        self.assertFalse(rows["not-pinned"]["pinned"])

    def test_glossary_dataset_lists_its_own_terms_with_variants(self):
        bundle = bk.collect(dq.resolve_repo("words"), "words")
        self.assertEqual(bundle["kind"], "glossary")
        row = bundle["terms"][0]
        self.assertEqual(row["id"], "schism")
        self.assertTrue(row["defined_here"])

    def test_places_are_counted_verbatim(self):
        rows = self.bundle()["places"]
        self.assertEqual(rows[0]["place"], "Fribourg")
        self.assertEqual(rows[0]["count"], 3)
        self.assertIn("events.place", rows[0]["fields"])

    def test_dates_span_the_whole_dataset(self):
        rows = dict((row["scope"], row) for row in self.bundle()["dates"])
        self.assertEqual(rows["events"]["span"], "1970–1988")
        self.assertEqual(rows["events"]["note"], "1 with dateVerified:false")
        self.assertEqual(rows["figures.dates"]["span"], "1905–1991")
        self.assertEqual(rows["dataset (all of the above)"]["span"],
                         "1905–1991")

    def test_render_block_is_deterministic_and_self_describing(self):
        block = bk.render_block(self.bundle())
        self.assertTrue(block.startswith(bk.BEGIN_MARKER))
        self.assertTrue(block.endswith(bk.END_MARKER))
        self.assertIn("finding aid, not a dataset", block)
        self.assertEqual(block, bk.render_block(self.bundle()))

    def test_main_creates_scaffold_then_preserves_hand_written_half(self):
        out = os.path.join(self.root, "KEYWORDS.md")
        with silent():
            self.assertEqual(bk.main(["kw", "--out", out]), 0)
        with open(out, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("# KEYWORDS — Alpha Society — Cronologia", text)
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(text.replace("- (nothing recorded yet — add the first "
                                  "trap you hit)",
                                  "- `ALFA` — zero hits; use `Sociedade Alfa`")
                     + "\n## Appendix\n\nkeep me\n")
        with silent() as buffer:
            self.assertEqual(bk.main(["kw", "--out", out]), 0)
        self.assertIn("replaced", buffer.getvalue())
        with open(out, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("- `ALFA` — zero hits; use `Sociedade Alfa`", text)
        self.assertIn("keep me", text)
        self.assertEqual(text.count(bk.BEGIN_MARKER), 1)

    def test_main_stdout_json_and_argument_errors(self):
        with silent() as buffer:
            self.assertEqual(bk.main(["kw", "--json"]), 0)
        self.assertEqual(json.loads(buffer.getvalue())["repo"], "kw")
        with silent():
            self.assertEqual(bk.main(["kw", "--json", "--out", "x.md"]), 2)
            self.assertEqual(bk.main(["definitely-not-a-repo"]), 1)

    def test_main_refuses_a_file_with_broken_markers(self):
        out = os.path.join(self.root, "BROKEN.md")
        with open(out, "w", encoding="utf-8") as fh:
            fh.write("# K\n" + bk.BEGIN_MARKER + "\nhalf a block\n")
        with silent():
            self.assertEqual(bk.main(["kw", "--out", out]), 2)
        with open(out, encoding="utf-8") as fh:
            self.assertIn("half a block", fh.read())


class TestSyncSkills(unittest.TestCase):
    """Vendoring core/skills into a project's .claude/skills."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="cron-skills-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.src = os.path.join(self.tmp, "skills")
        for name, body in (("alpha-skill", "---\nname: alpha-skill\n---\nA\n"),
                           ("beta-skill", "---\nname: beta-skill\n---\nB\n")):
            os.makedirs(os.path.join(self.src, name))
            with open(os.path.join(self.src, name, "SKILL.md"), "w",
                      encoding="utf-8") as fh:
                fh.write(body)
        os.makedirs(os.path.join(self.src, "not-a-skill"))
        self.repo = os.path.join(self.tmp, "project")
        os.makedirs(os.path.join(self.repo, "data"))
        self.skills = ss.discover_skills(self.src)
        self.vendor = os.path.join(self.repo, ss.VENDOR_REL)

    def test_discover_skips_dirs_without_skill_md(self):
        self.assertEqual([name for name, _p, _t in self.skills],
                         ["alpha-skill", "beta-skill"])

    def test_discover_subset(self):
        subset = ss.discover_skills(self.src, only=["beta-skill"])
        self.assertEqual([name for name, _p, _t in subset], ["beta-skill"])

    def test_digest_ignores_line_endings(self):
        self.assertEqual(ss.digest("a\r\nb\r\n"), ss.digest("a\nb\n"))

    def test_plan_add_then_ok(self):
        self.assertEqual(ss.plan(self.skills, self.vendor),
                         [("add", "alpha-skill"), ("add", "beta-skill")])
        ss.apply_plan(self.skills, self.vendor,
                      ss.plan(self.skills, self.vendor), "2026-07-24")
        self.assertEqual(ss.plan(self.skills, self.vendor),
                         [("ok", "alpha-skill"), ("ok", "beta-skill")])

    def test_plan_detects_hand_edit_and_orphan(self):
        ss.apply_plan(self.skills, self.vendor,
                      ss.plan(self.skills, self.vendor), "2026-07-24")
        with open(os.path.join(self.vendor, "alpha-skill", "SKILL.md"), "a",
                  encoding="utf-8") as fh:
            fh.write("hand edit\n")
        os.makedirs(os.path.join(self.vendor, "ghost-skill"))
        with open(os.path.join(self.vendor, "ghost-skill", "SKILL.md"), "w",
                  encoding="utf-8") as fh:
            fh.write("gone upstream\n")
        actions = dict((name, status)
                       for status, name in ss.plan(self.skills, self.vendor))
        self.assertEqual(actions["alpha-skill"], "update")
        self.assertEqual(actions["beta-skill"], "ok")
        self.assertEqual(actions["ghost-skill"], "stale")

    def test_apply_removes_orphan_and_writes_manifest(self):
        os.makedirs(os.path.join(self.vendor, "ghost-skill"))
        with open(os.path.join(self.vendor, "ghost-skill", "SKILL.md"), "w",
                  encoding="utf-8") as fh:
            fh.write("gone\n")
        ss.apply_plan(self.skills, self.vendor,
                      ss.plan(self.skills, self.vendor), "2026-07-24")
        self.assertFalse(os.path.exists(os.path.join(self.vendor,
                                                     "ghost-skill")))
        manifest = ss.read_manifest(self.vendor)
        self.assertEqual(manifest["source"], "cronologia/core")
        self.assertEqual(manifest["syncedAt"], "2026-07-24")
        self.assertEqual([s["name"] for s in manifest["skills"]],
                         ["alpha-skill", "beta-skill"])
        self.assertIn("GENERATED", manifest["_comment"])

    def test_manifest_current_tracks_content(self):
        actions = ss.plan(self.skills, self.vendor)
        ss.apply_plan(self.skills, self.vendor, actions, "2026-07-24")
        actions = ss.plan(self.skills, self.vendor)
        manifest = ss.read_manifest(self.vendor)
        self.assertTrue(ss.manifest_current(manifest, self.skills, actions))
        self.assertFalse(ss.manifest_current(None, self.skills, actions))
        changed = [(n, p, t + "x") for n, p, t in self.skills]
        self.assertFalse(ss.manifest_current(manifest, changed, actions))

    def test_process_check_reports_stale_without_writing(self):
        result = ss.process(self.repo, self.skills, True, "2026-07-24")
        self.assertTrue(result["stale"])
        self.assertEqual(result["manifest"], "missing")
        self.assertFalse(os.path.exists(self.vendor))
        result = ss.process(self.repo, self.skills, False, "2026-07-24")
        self.assertFalse(result["stale"])
        self.assertEqual(result["written"], 2)
        self.assertFalse(ss.process(self.repo, self.skills, True,
                                    "2026-07-24")["stale"])

    def test_render_names_the_generated_rule(self):
        results = [ss.process(self.repo, self.skills, True, "2026-07-24")]
        text = ss.render(results, self.skills, True)
        self.assertIn("GENERATED", text)
        self.assertIn("mode=check", text)
        self.assertIn("add | alpha-skill", text)

    def test_main_requires_a_target(self):
        with silent():
            self.assertEqual(ss.main([]), 2)

    def test_main_rejects_unknown_skill_name(self):
        with silent():
            self.assertEqual(ss.main([self.repo, "--skills", "nope"]), 2)

    def test_main_list_is_json_serializable(self):
        with silent() as out:
            self.assertEqual(ss.main(["--list", "--json"]), 0)
        payload = json.loads(out.getvalue())
        self.assertEqual(payload["source"], "cronologia/core")
        self.assertTrue(any(s["name"] == "sourcing-rules"
                            for s in payload["skills"]))

    def test_real_repo_check_is_stale_before_sync(self):
        with silent():
            self.assertEqual(ss.main([self.repo, "--check"]), 1)
            self.assertEqual(ss.main([self.repo]), 0)
            self.assertEqual(ss.main([self.repo, "--check"]), 0)


# --------------------------------------------------------------------------
# the COF corpus tools
# --------------------------------------------------------------------------


COF_INDEX = {
    "note": "test manifest",
    "docs": [
        {"id": "COF001", "aula": 1, "date": "2009-01-01", "series": "cof",
         "file": "revisadas/COF001.md", "words": 10,
         "entities": ["René Guénon", "Jean Borella", "Martin Lings"]},
        {"id": "COF002", "aula": 2, "date": None, "series": "cof",
         "file": "revisadas/COF002.md", "words": 10,
         "entities": ["Rene Guenon", "Martin Ling", "John Don Scott"]},
        {"id": "COF003", "aula": 3, "date": "2009-02-01", "series": "cof",
         "file": "revisadas/COF003.md", "words": 10,
         "entities": ["Réne Guénon", "Duns Scot", "Martin Lins",
                      "Guénon e Schuon"]},
        {"id": "COF004", "aula": 4, "date": "2009-03-01", "series": "cof",
         "file": "revisadas/COF004.md", "words": 10,
         "entities": ["Ananda Coomaraswamy"]},
        {"id": "COF005", "aula": 5, "date": "2009-04-01", "series": "cof",
         "file": "revisadas/COF005.md", "words": 10,
         "entities": ["René Guénon"]},
    ],
}

COF_ALIASES = {
    "version": 1,
    "aliases": [
        {"canonical": "John Duns Scotus", "canonicalInCorpus": False,
         "variants": ["John Don Scott", "Duns Scot"],
         "reason": "ASR of the scholastic's name.",
         "source": "hand-checked",
         "evidence": [{"aula": "COF002", "quote": "John Don Scott"}]},
        {"canonical": "Martin Lings", "canonicalInCorpus": True,
         "variants": ["Martin Ling", "Martin Lynch"],
         "reason": "ASR drops the final -s.", "source": "KEYWORDS.md"},
    ],
    "doNotMerge": [
        {"names": ["Martin Lings", "Martin Lins"],
         "reason": "Left open on purpose.", "source": "review"},
    ],
}


class CorpusFixture(DatasetFixture):
    """A repo-shaped temp dir plus a miniature COF corpus. Nothing real."""

    @classmethod
    def setUpClass(cls):
        DatasetFixture.setUpClass()
        cls.corpus_dir = os.path.join(cls.root, "archive", "cof")
        os.makedirs(os.path.join(cls.corpus_dir, "revisadas"))
        cls.corpus = os.path.join(cls.corpus_dir, "index.json")
        with open(cls.corpus, "w", encoding="utf-8") as fh:
            json.dump(COF_INDEX, fh, ensure_ascii=False)
        for doc in COF_INDEX["docs"]:
            path = os.path.join(cls.corpus_dir, doc["file"])
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("aula %s. %s\n" % (doc["id"],
                                            " ".join(doc["entities"])))
        cls.alias_path = os.path.join(cls.root, "aliases.json")
        with open(cls.alias_path, "w", encoding="utf-8") as fh:
            json.dump(COF_ALIASES, fh, ensure_ascii=False)

    @classmethod
    def aliases(cls):
        return ne.load_aliases(cls.alias_path)


class TestEntityKeys(unittest.TestCase):
    def test_fold_key_ignores_accents_case_and_punctuation(self):
        for surface in ("René Guénon", "Rene Guenon", "Réne Guenón",
                        "  rene   guenon. ", "RENÉ-GUÉNON"):
            self.assertEqual(ne.fold_key(surface), "rene guenon", surface)

    def test_fold_key_is_not_a_display_string(self):
        self.assertNotEqual(ne.fold_key("René Guénon"), "René Guénon")

    def test_initials_key_drops_single_letters_only(self):
        self.assertEqual(ne.initials_key("Ananda K. Coomaraswamy"),
                         "ananda coomaraswamy")
        self.assertEqual(ne.initials_key("Rama P. Coomaraswamy"),
                         "rama coomaraswamy")
        self.assertEqual(ne.initials_key("Jean Borella"), "jean borella")

    def test_levenshtein(self):
        self.assertEqual(ne.levenshtein("martin lings", "martin lings"), 0)
        self.assertEqual(ne.levenshtein("martin lings", "martin lins"), 1)
        self.assertEqual(ne.levenshtein("mark sedgwick", "mark sedwick"), 1)
        self.assertEqual(ne.levenshtein("", "abc"), 3)

    def test_levenshtein_limit_short_circuits(self):
        self.assertGreater(ne.levenshtein("rene guenon", "totally other", 2), 2)
        self.assertGreater(ne.levenshtein("abc", "abcdefghij", 2), 2)

    def test_conjunction_parts(self):
        self.assertEqual(ne.conjunction_parts("Guénon e Schuon"),
                         ("Guénon", "Schuon"))
        self.assertEqual(ne.conjunction_parts("Lutero e Calvino"),
                         ("Lutero", "Calvino"))
        self.assertIsNone(ne.conjunction_parts("René Guénon"))
        self.assertIsNone(ne.conjunction_parts("Machado de Assis"))


class TestAliasMap(unittest.TestCase):
    def test_entry_without_a_reason_is_rejected(self):
        with self.assertRaises(ValueError):
            ne.AliasMap({"aliases": [{"canonical": "X", "variants": ["Y"]}]},
                        "t")

    def test_variant_claimed_twice_is_rejected(self):
        payload = {"aliases": [
            {"canonical": "A", "variants": ["Z"], "reason": "r",
             "source": "s"},
            {"canonical": "B", "variants": ["Z"], "reason": "r",
             "source": "s"}]}
        with self.assertRaises(ValueError):
            ne.AliasMap(payload, "t")

    def test_do_not_merge_needs_two_names_and_a_reason(self):
        with self.assertRaises(ValueError):
            ne.AliasMap({"doNotMerge": [{"names": ["A"], "reason": "r"}]}, "t")

    def test_blocked_pairs_are_symmetric_keys(self):
        aliases = ne.AliasMap(COF_ALIASES, "t")
        self.assertIn(tuple(sorted(("martin lings", "martin lins"))),
                      aliases.blocked)
        self.assertEqual(aliases.target(ne.fold_key("Duns Scot")),
                         ne.fold_key("John Duns Scotus"))
        self.assertIsNone(aliases.target("martin lins"))


class TestNormaliseEntities(CorpusFixture):
    def test_folding_collapses_diacritic_variants(self):
        report = ne.build_report(self.corpus, self.aliases())
        by_key = dict((g["key"], g) for g in report["groups"])
        guenon = by_key["rene guenon"]
        self.assertEqual(guenon["docs"], 4)
        self.assertEqual(guenon["variants"], 3)
        # display = the surface carrying the most aulas, always a string the
        # corpus writes — never the fold key
        self.assertEqual(guenon["display"], "René Guénon")
        self.assertEqual(guenon["aulas"],
                         ["COF001", "COF002", "COF003", "COF005"])

    def test_alias_map_merges_and_labels_without_inventing_a_surface(self):
        report = ne.build_report(self.corpus, self.aliases())
        by_key = dict((g["key"], g) for g in report["groups"])
        scotus = by_key["john duns scotus"]
        self.assertEqual(sorted(s["surface"] for s in scotus["surfaces"]),
                         ["Duns Scot", "John Don Scott"])
        self.assertFalse(scotus["labelInCorpus"])
        self.assertEqual(scotus["label"], "John Duns Scotus")
        self.assertIn(scotus["display"], ("Duns Scot", "John Don Scott"))

    def test_similar_names_are_suggested_never_merged(self):
        report = ne.build_report(self.corpus, self.aliases())
        keys = set(g["key"] for g in report["groups"])
        self.assertIn("martin lins", keys)
        self.assertIn("martin lings", keys)
        pairs = set()
        for row in report["suggestions"]:
            if row["b"]:
                pairs.add(tuple(sorted((row["a"]["key"], row["b"]["key"]))))
        # blocked by doNotMerge, so it is not even re-suggested
        self.assertNotIn(("martin lings", "martin lins"), pairs)

    def test_conjunction_surface_is_only_a_suggestion(self):
        report = ne.build_report(self.corpus, self.aliases())
        kinds = dict((r["a"]["display"], r["kind"])
                     for r in report["suggestions"] if r["b"] is None)
        self.assertEqual(kinds.get("Guénon e Schuon"), "conjunction")
        keys = set(g["key"] for g in report["groups"])
        self.assertIn("guenon e schuon", keys)

    def test_evidence_quotes_are_verified_against_the_files(self):
        report = ne.build_report(self.corpus, self.aliases())
        statuses = [e["status"] for e in report["audit"]["evidence"]]
        self.assertEqual(statuses, ["verified"])

    def test_unused_alias_entries_are_reported_not_hidden(self):
        report = ne.build_report(self.corpus, self.aliases())
        unused = [r["variant"] for r in report["audit"]["unused"]]
        self.assertIn("Martin Lynch", unused)

    def test_no_aliases_leaves_the_manglings_apart(self):
        report = ne.build_report(self.corpus, ne.empty_aliases())
        keys = set(g["key"] for g in report["groups"])
        self.assertIn("john don scott", keys)
        self.assertIn("duns scot", keys)
        self.assertNotIn("john duns scotus", keys)

    def test_min_aulas_filters_the_table_only(self):
        report = ne.build_report(self.corpus, self.aliases(), min_aulas=3)
        self.assertEqual([g["key"] for g in report["groups"]],
                         ["rene guenon"])
        self.assertEqual(report["entities"], len(
            ne.build_report(self.corpus, self.aliases())["groups"]))

    def test_cli_runs_and_is_deterministic(self):
        with silent() as first:
            self.assertEqual(ne.main(["--corpus", self.corpus,
                                      "--aliases", self.alias_path]), 0)
        with silent() as second:
            self.assertEqual(ne.main(["--corpus", self.corpus,
                                      "--aliases", self.alias_path]), 0)
        self.assertEqual(first.getvalue(), second.getvalue())
        self.assertIn("René Guénon", first.getvalue())

    def test_bad_alias_map_exits_two(self):
        broken = os.path.join(self.root, "broken.json")
        with open(broken, "w", encoding="utf-8") as fh:
            json.dump({"aliases": [{"canonical": "X", "variants": ["Y"]}]}, fh)
        with silent():
            self.assertEqual(ne.main(["--corpus", self.corpus,
                                      "--aliases", broken]), 2)

    def test_missing_corpus_exits_one(self):
        with silent():
            self.assertEqual(ne.main(["--corpus",
                                      os.path.join(self.root, "nope.json")]), 1)


class TestCofXref(CorpusFixture):
    def test_skip_reason_rejects_descriptors_and_generic_names(self):
        self.assertIsNone(cx.skip_reason("Jean Borella", "jean borella"))
        self.assertIn("descriptor", cx.skip_reason("as author", "as author"))
        self.assertIn("descriptor", cx.skip_reason("publisher", "publisher"))
        self.assertIn("generic", cx.skip_reason("Francis", "francis"))
        self.assertIn("generic", cx.skip_reason("FSSP", "fssp"))

    def test_dataset_variants_splits_records_naming_several_people(self):
        variants = cx.dataset_variants("Mark Sedgwick & Wouter Hanegraaff")
        self.assertIn("Mark Sedgwick", variants)
        self.assertIn("Wouter Hanegraaff", variants)
        self.assertIn("Mark Sedgwick & Wouter Hanegraaff", variants)

    def test_dataset_variants_keeps_parentheticals_and_dash_sides(self):
        variants = cx.dataset_variants("René Guénon (Abd al-Wahid Yahya)")
        self.assertIn("René Guénon", variants)
        self.assertIn("Abd al-Wahid Yahya", variants)

    def test_match_confidence_high_then_initials(self):
        groups = ne.build_table(ne.load_corpus(self.corpus), self.aliases())
        lookup = ne.group_index(groups)
        group, confidence, _how = cx.match(lookup, "Rene Guenon")
        self.assertEqual(group["display"], "René Guénon")
        self.assertEqual(confidence, "high")
        group, confidence, _how = cx.match(lookup, "Ananda K. Coomaraswamy")
        self.assertEqual(group["display"], "Ananda Coomaraswamy")
        self.assertEqual(confidence, "medium")
        self.assertIsNone(cx.match(lookup, "Someone Absent"))

    def test_near_miss_needs_a_shared_surname_not_a_given_name(self):
        groups = ne.build_table(ne.load_corpus(self.corpus), self.aliases())
        tokens = cx.index_tokens(groups)
        near = cx.near_misses(groups, tokens, "Rama P. Coomaraswamy")
        self.assertEqual([n["entity"] for n in near], ["Ananda Coomaraswamy"])
        self.assertEqual(cx.near_misses(groups, tokens, "Jean Piaget"), [])

    def test_near_miss_catches_an_asr_mangling_by_edit_distance(self):
        groups = ne.build_table(ne.load_corpus(self.corpus), self.aliases())
        tokens = cx.index_tokens(groups)
        near = cx.near_misses(groups, tokens, "Martin Linds")
        self.assertTrue(any(n["entity"] == "Martin Lings" for n in near))

    def test_report_counts_aulas_through_the_alias_map(self):
        report = cx.build_report(["alpha"], self.corpus, self.aliases())
        self.assertEqual(report["repos"], ["alpha"])
        self.assertEqual([h["entity"] for h in report["hits"]], [])
        marcel = [z for z in report["zero"]
                  if z["variant"] == "Marcel Lefebvre"]
        self.assertEqual(len(marcel), 1)

    def test_markdown_carries_the_caveat(self):
        report = cx.build_report(["alpha"], self.corpus, self.aliases())
        text = cx.render_markdown(report)
        self.assertIn("LEAD, not a citation", text)
        self.assertIn("not a mention index", text)

    def test_markdown_and_json_together_exit_two(self):
        with silent():
            self.assertEqual(cx.main(["--repos", "alpha", "--corpus",
                                      self.corpus, "--markdown", "--json"]), 2)

    def test_cli_runs_over_a_fixture_repo(self):
        with silent() as out:
            self.assertEqual(cx.main(["--repos", "alpha", "--corpus",
                                      self.corpus, "--aliases",
                                      self.alias_path]), 0)
        self.assertIn("cof-xref", out.getvalue())


class TestCofGraph(CorpusFixture):
    def graph(self, min_cooccurrence=1):
        groups = ne.build_table(ne.load_corpus(self.corpus), self.aliases())
        return cg.build_graph(groups, min_cooccurrence)

    def test_edges_are_weighted_by_shared_aulas(self):
        nodes, edges = self.graph()
        weights = dict(((e["source"], e["target"]), e["weight"])
                       for e in edges)
        self.assertEqual(weights[("jean borella", "rene guenon")], 1)
        self.assertEqual(weights[("martin lings", "rene guenon")], 2)
        self.assertNotIn(("rene guenon", "rene guenon"), weights)
        self.assertIn("rene guenon", nodes)

    def test_min_cooccurrence_cuts_the_long_tail(self):
        _nodes, edges = self.graph(2)
        self.assertEqual([(e["source"], e["target"]) for e in edges],
                         [("john duns scotus", "rene guenon"),
                          ("martin lings", "rene guenon")])

    def test_isolated_node_has_degree_zero(self):
        nodes, edges = self.graph()
        degree = cg.degrees(nodes, edges)
        self.assertEqual(degree["ananda coomaraswamy"][0], 0)
        self.assertEqual(degree["rene guenon"][0], 5)

    def test_components_are_sorted_largest_first(self):
        nodes, edges = self.graph()
        parts = cg.components(nodes, edges)
        self.assertEqual(len(parts[0]), len(nodes) - 1)
        self.assertEqual(parts[-1], ["ananda coomaraswamy"])

    def test_graphml_is_well_formed_and_declares_its_keys(self):
        import xml.etree.ElementTree as ET
        nodes, edges = self.graph()
        text = cg.to_graphml(nodes, edges, sorted(nodes))
        root = ET.fromstring(text)
        namespace = "{http://graphml.graphdrawing.org/xmlns}"
        self.assertEqual(root.tag, namespace + "graphml")
        graph = root.find(namespace + "graph")
        self.assertEqual(len(graph.findall(namespace + "node")), len(nodes))
        self.assertEqual(len(graph.findall(namespace + "edge")), len(edges))
        self.assertIn("NOT a relationship", text)

    def test_graphml_escapes_markup(self):
        nodes = {"a & b": {"key": "a & b", "label": "A <b> & \"c\"",
                           "label2": "", "docs": 1, "variants": 1,
                           "aulas": ["COF001"], "mergedBy": "fold"}}
        text = cg.to_graphml(nodes, [], ["a & b"])
        self.assertIn("&amp;", text)
        self.assertNotIn("<b>", text)
        import xml.etree.ElementTree as ET
        ET.fromstring(text)

    def test_dot_quotes_and_escapes(self):
        nodes, edges = self.graph(2)
        text = cg.to_dot(nodes, edges, sorted(nodes))
        self.assertIn("graph cof_entities {", text)
        self.assertIn('"martin lings" -- "rene guenon"', text)
        self.assertTrue(text.rstrip().endswith("}"))
        self.assertIn("// Co-occurrence", text)

    def test_dot_escape_handles_quotes_and_newlines(self):
        self.assertEqual(cg.dot_escape('a"b\nc'), 'a\\"b c')

    def test_refuse_write_target_protects_data_and_corpus(self):
        self.assertIsNone(cg.refuse_write_target(
            os.path.join(self.root, "g.dot"), self.corpus))
        self.assertIsNone(cg.refuse_write_target("-", self.corpus))
        self.assertIn("corpus", cg.refuse_write_target(
            os.path.join(self.corpus_dir, "g.dot"), self.corpus))
        self.assertIn("data/", cg.refuse_write_target(
            os.path.join(self.root, "alpha", "data", "g.dot"), self.corpus))
        self.assertIn("dataset", cg.refuse_write_target(
            os.path.join(self.root, "chronology.json"), self.corpus))

    def test_cli_writes_only_where_told(self):
        target = os.path.join(self.root, "out.graphml")
        with silent() as out:
            self.assertEqual(cg.main(["--corpus", self.corpus, "--aliases",
                                      self.alias_path, "--graphml", target]), 0)
        self.assertTrue(os.path.exists(target))
        self.assertIn("wrote graphml", out.getvalue())
        with silent():
            self.assertEqual(cg.main(["--corpus", self.corpus, "--graphml",
                                      os.path.join(self.corpus_dir, "x.graphml")
                                      ]), 2)
        self.assertFalse(os.path.exists(os.path.join(self.corpus_dir,
                                                     "x.graphml")))

    def test_bad_min_cooccurrence_exits_two(self):
        with silent():
            self.assertEqual(cg.main(["--corpus", self.corpus,
                                      "--min-cooccurrence", "0"]), 2)



class TestPlaces(unittest.TestCase):
    """Gazetteer resolution — the three defects it exists to fix."""

    def setUp(self):
        self.places = load("places.py", "places_tool")
        self.entries, self.index = self.places.load_gazetteer()

    def ids(self, string):
        got, _ = self.places.resolve(string, self.index)
        return got

    # 1. compound places: ONE event in TWO locations
    def test_compound_resolves_to_every_location(self):
        self.assertEqual(self.ids("Topeka / Los Angeles, USA"),
                         ["topeka", "los-angeles"])
        self.assertEqual(self.ids("Lucca, Italy / Rome"), ["lucca", "rome"])

    def test_compound_never_silently_drops_the_second_location(self):
        for string in ("Topeka / Los Angeles, USA", "Lucca, Italy / Rome",
                       "Lausanne / United States", "Astana / Rome",
                       "Amsterdam / Cambridge"):
            self.assertEqual(len(self.ids(string)), 2, string)

    def test_a_comma_is_address_structure_not_a_separator(self):
        # "Ann Arbor, Michigan, USA" is ONE place, not three.
        self.assertEqual(self.ids("Ann Arbor, Michigan, USA"), ["ann-arbor"])

    # 2. the same place written more than one way
    def test_variant_spellings_unify(self):
        for a, b in (("\u00c9c\u00f4ne", "\u00c9c\u00f4ne, Valais, Switzerland"),
                     ("Fribourg", "Fribourg, Switzerland"),
                     ("Bloomington", "Bloomington (Monroe County), Indiana, USA"),
                     ("Washington", "Washington, DC, USA")):
            self.assertEqual(self.ids(a), self.ids(b), f"{a} vs {b}")
            self.assertEqual(len(self.ids(a)), 1)

    def test_resolution_is_case_insensitive(self):
        self.assertEqual(self.ids("rome"), self.ids("Rome"))

    # 3. scopes are not places
    def test_non_geographic_entries_carry_no_coordinates(self):
        for string in ("Worldwide", "international",
                       "online (traditionalist-Catholic media)"):
            got = self.ids(string)
            self.assertEqual(len(got), 1, string)
            entry = self.entries[got[0]]
            self.assertEqual(entry["kind"], "non-geographic", string)
            self.assertNotIn("lat", entry, string)
            self.assertNotIn("lon", entry, string)

    def test_survey_populations_get_no_pin(self):
        for string in ("Latin America (survey)", "USA (survey, 10 countries)"):
            entry = self.entries[self.ids(string)[0]]
            self.assertEqual(entry["precision"], "none", string)

    # disambiguations that a geocoder's top hit gets wrong
    def test_ambiguous_names_resolved_against_dataset_context(self):
        cases = {
            "Astana": (51.13, 71.43),      # Kazakhstan, not a castle in Malaysia
            "Cairo": (30.04, 31.24),       # Egypt, not Cairo, Illinois
            "Bloomington": (39.17, -86.53),  # Indiana, not Illinois or Minnesota
            "Fribourg": (46.81, 7.16),     # the city, not the canton
            "Lucca, Italy": (43.84, 10.50),  # the city, not the province
        }
        for string, (lat, lon) in cases.items():
            entry = self.entries[self.ids(string)[0]]
            self.assertAlmostEqual(entry["lat"], lat, places=1, msg=string)
            self.assertAlmostEqual(entry["lon"], lon, places=1, msg=string)

    # provenance and shape
    def test_every_coordinate_records_its_source(self):
        for entry in self.entries.values():
            if "lat" in entry:
                self.assertIn("source", entry, entry["id"])
                self.assertIn("Nominatim", entry["source"], entry["id"])

    def test_country_entries_are_marked_as_centroids(self):
        for entry in self.entries.values():
            if entry["kind"] in ("country", "region"):
                self.assertEqual(entry["precision"], "country-centroid",
                                 entry["id"])

    def test_ids_and_variants_are_unique(self):
        seen = {}
        for entry in self.entries.values():
            for name in [entry["name"]] + entry.get("variants", []):
                key = name.casefold()
                self.assertNotIn(key, seen,
                                 f"{name!r} claimed by {seen.get(key)} and {entry['id']}")
                seen[key] = entry["id"]

    def test_every_dataset_place_string_resolves(self):
        counts, _ = self.places.collect()
        unmapped = []
        for string in counts:
            _, missing = self.places.resolve(string, self.index)
            unmapped.extend(missing)
        self.assertEqual(unmapped, [], f"unmapped: {sorted(set(unmapped))}")

    def test_check_mode_exits_nonzero_when_something_is_unmapped(self):
        # Hermetic: stub BOTH the gazetteer and the dataset scan. Relying on
        # collect() finding real sibling checkouts made this test pass or fail
        # depending on which repos happened to be cloned next to core.
        empty = ({}, {})
        one_place = ({"Nowhereville, Atlantis": 1},
                     {"Nowhereville, Atlantis": {"fsspx"}})
        original_load = self.places.load_gazetteer
        original_collect = self.places.collect
        self.places.load_gazetteer = lambda *a, **k: empty
        self.places.collect = lambda *a, **k: one_place
        try:
            with silent():
                self.assertEqual(self.places.main([]), 1)
        finally:
            self.places.load_gazetteer = original_load
            self.places.collect = original_collect



class TestCofDates(unittest.TestCase):
    """Neighbour-consistency checking for COF lecture dates."""

    def setUp(self):
        self.cd = load("cof-dates.py", "cof_dates_tool")

    @staticmethod
    def docs(*triples):
        return [{"id": f"COF{a:03d}", "aula": a, "date": d,
                 "dateProvenance": "header-long-form"} for a, d in triples]

    def test_a_date_in_sequence_is_not_an_anomaly(self):
        docs = self.docs((1, "2009-03-07"), (2, "2009-03-14"), (3, "2009-03-21"))
        self.assertEqual(self.cd.find_anomalies(docs), [])

    def test_a_whole_year_off_with_the_day_intact_is_a_probable_year_typo(self):
        docs = self.docs((26, "2009-10-03"), (27, "2010-10-10"), (28, "2009-10-17"))
        got = self.cd.find_anomalies(docs)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["id"], "COF027")
        self.assertEqual(got[0]["kind"], "probable-year-typo")

    def test_a_few_days_out_of_order_is_an_ordering_anomaly_not_a_typo(self):
        docs = self.docs((104, "2011-04-30"), (105, "2011-05-07"), (106, "2011-05-04"),
                         (107, "2011-05-28"))
        kinds = {a["id"]: a["kind"] for a in self.cd.find_anomalies(docs)}
        self.assertIn("COF106", kinds)
        self.assertEqual(kinds["COF106"], "ordering-anomaly")

    def test_a_file_is_not_blamed_when_its_neighbours_are_the_ones_in_conflict(self):
        # 10 and 12 are out of order with each other; 11 must not be flagged.
        docs = self.docs((10, "2009-06-20"), (11, "2009-06-13"), (12, "2009-06-06"))
        self.assertNotIn("COF011", [a["id"] for a in self.cd.find_anomalies(docs)])

    def test_undated_files_are_ignored_rather_than_guessed(self):
        docs = self.docs((1, "2009-03-07"), (3, "2009-03-21"))
        docs.append({"id": "COF002", "aula": 2, "date": None})
        self.assertEqual(self.cd.find_anomalies(docs), [])

    # --- adjudication between the two sources -----------------------------
    def test_sequence_can_favour_the_header(self):
        # aula 220: the header fits the weekly series, the index does not
        neighbours = {219: __import__("datetime").date(2013, 9, 7),
                      221: __import__("datetime").date(2013, 9, 21)}
        import datetime
        got = self.cd.adjudicate(220, datetime.date(2013, 9, 14),
                                 datetime.date(2012, 9, 14), neighbours)
        self.assertEqual(got, "header")

    def test_sequence_can_favour_the_index(self):
        # aula 222: the header falls after aula 223, the index fits
        import datetime
        neighbours = {221: datetime.date(2013, 9, 21), 223: datetime.date(2013, 10, 12)}
        got = self.cd.adjudicate(222, datetime.date(2013, 10, 22),
                                 datetime.date(2013, 10, 5), neighbours)
        self.assertEqual(got, "index")

    def test_undecided_when_both_values_fit(self):
        import datetime
        neighbours = {1: datetime.date(2009, 3, 1), 3: datetime.date(2009, 4, 1)}
        got = self.cd.adjudicate(2, datetime.date(2009, 3, 10),
                                 datetime.date(2009, 3, 20), neighbours)
        self.assertEqual(got, "undecided")

    def test_undecided_when_the_neighbours_themselves_disagree(self):
        import datetime
        neighbours = {1: datetime.date(2009, 4, 1), 3: datetime.date(2009, 3, 1)}
        got = self.cd.adjudicate(2, datetime.date(2009, 3, 10),
                                 datetime.date(2009, 3, 20), neighbours)
        self.assertEqual(got, "undecided")

    def test_neither_source_is_preferred_by_default(self):
        """The tool must never resolve a disagreement it cannot adjudicate."""
        import datetime
        got = self.cd.adjudicate(5, datetime.date(2009, 1, 1),
                                 datetime.date(2010, 1, 1), {})
        self.assertEqual(got, "undecided")

    # --- the filename witness ----------------------------------------------
    def test_filename_dates_excludes_aulas_whose_duplicate_files_disagree(self):
        files = [{"aula": 117, "date": "2011-08-06"},
                 {"aula": 117, "date": "2013-08-24"},
                 {"aula": 229, "date": "2013-11-30"},
                 {"aula": 229, "date": "2013-11-30"},   # same date twice is fine
                 {"aula": 305, "date": None},           # undated file, ignored
                 {"aula": None, "date": "2009-07-04"}]  # unassigned file, ignored
        got = self.cd.filename_dates(files)
        self.assertEqual(got, {229: "2013-11-30"})

    def test_filename_witness_is_a_third_voice_not_a_tiebreaker(self):
        # aula 220: header fits the sequence, index does not; the filename
        # witness sides with the index but must not change the verdict.
        docs = self.docs((219, "2013-09-07"), (220, "2013-09-14"),
                         (221, "2013-09-21"))
        lineage = {220: "2012-09-14"}
        rows = self.cd.compare_sources(docs, lineage, {220: "2012-09-14"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sequenceSupports"], "header")
        self.assertEqual(rows[0]["filenamesMatches"], "index")
        self.assertIs(rows[0]["filenamesFits"], False)

    def test_filename_witness_can_fit_where_both_named_sources_break(self):
        # aula 176: header and index both break the sequence; only the
        # filename value fits. The verdict stays undecided between the two
        # named sources - the witness is reported alongside, not promoted.
        docs = self.docs((175, "2012-10-13"), (176, "2012-09-08"),
                         (177, "2012-10-27"))
        lineage = {176: "2012-01-20"}
        rows = self.cd.compare_sources(docs, lineage, {176: "2012-10-20"})
        self.assertEqual(rows[0]["sequenceSupports"], "undecided")
        self.assertEqual(rows[0]["filenamesMatches"], "neither")
        self.assertIs(rows[0]["filenamesFits"], True)

    def test_rows_omit_witness_fields_when_no_witness_is_supplied(self):
        docs = self.docs((219, "2013-09-07"), (220, "2013-09-14"),
                         (221, "2013-09-21"))
        rows = self.cd.compare_sources(docs, {220: "2012-09-14"})
        self.assertNotIn("filenames", rows[0])
        self.assertNotIn("resumos", rows[0])

    # --- the contemporaneous Resumos witness, and the cadence check --------
    def test_resumos_witness_is_reported_without_changing_the_verdict(self):
        # aula 12: header duplicates aula 11's date; the Resumos back the
        # index. The sequence still cannot decide, and must not pretend to.
        docs = self.docs((11, "2009-06-20"), (12, "2009-06-20"),
                         (13, "2009-07-04"))
        rows = self.cd.compare_sources(docs, {12: "2009-06-27"},
                                       resumos={12: "2009-06-27"})
        self.assertEqual(rows[0]["resumos"], "2009-06-27")
        self.assertEqual(rows[0]["resumosMatches"], "index")
        self.assertEqual(rows[0]["sequenceSupports"], "undecided")

    def test_off_cadence_flags_a_non_saturday(self):
        self.assertTrue(self.cd.off_cadence("2009-08-18"))    # a Tuesday
        self.assertFalse(self.cd.off_cadence("2009-08-08"))   # a Saturday
        self.assertEqual(self.cd.weekday_of("2009-08-18"), "Tue")

    def test_every_candidate_off_cadence_is_reported_as_such(self):
        # aula 89: header Tuesday, index Wednesday. Neither is a Saturday, so
        # the row must say so rather than implying one of them is right.
        docs = self.docs((88, "2010-12-18"), (89, "2011-11-22"),
                         (90, "2011-01-15"))
        rows = self.cd.compare_sources(docs, {89: "2010-12-22"})
        self.assertEqual(rows[0]["onCadence"], [])

    def test_on_cadence_names_which_sources_fall_on_the_course_weekday(self):
        docs = self.docs((17, "2009-08-01"), (18, "2009-08-18"),
                         (19, "2009-08-15"))
        rows = self.cd.compare_sources(docs, {18: "2009-08-08"},
                                       resumos={18: "2009-08-08"})
        self.assertEqual(sorted(rows[0]["onCadence"]), ["index", "resumos"])
        self.assertEqual(rows[0]["weekday"]["header"], "Tue")



class TestTemplateDrift(unittest.TestCase):
    """Drift between the template scripts and the repos that vendor them."""

    def setUp(self):
        self.td = load("template-drift.py", "template_drift_tool")

    def test_identical_files_do_not_drift(self):
        src = "'use strict';\nconst A = 1;\nfunction f() { return A; }\n"
        self.assertIsNone(self.td.compare(src, src))

    def test_a_changed_line_outside_an_adopt_block_is_drift(self):
        a = "const A = 1;\nfunction f() { return A; }\n"
        b = "const A = 1;\nfunction f() { return A + 1; }\n"
        got = self.td.compare(a, b)
        self.assertIsNotNone(got)
        self.assertEqual(got["changedLines"], 2)

    def test_a_declared_adopt_block_may_differ_freely(self):
        a = ("const X = 1;\n// >>> ADOPT: ua\nconst UA = 'template';\n// <<< ADOPT\n"
             "function f() {}\n")
        b = ("const X = 1;\n// >>> ADOPT: ua\nconst UA = 'this repo';\nconst EXTRA = 2;\n"
             "// <<< ADOPT\nfunction f() {}\n")
        self.assertIsNone(self.td.compare(a, b))

    def test_deleting_a_declared_adopt_block_is_reported(self):
        a = "// >>> ADOPT: ua\nconst UA = 'x';\n// <<< ADOPT\nfunction f() {}\n"
        b = "const UA = 'x';\nfunction f() {}\n"
        got = self.td.compare(a, b)
        self.assertIsNotNone(got)
        self.assertEqual(got["missingAdoptPoints"], ["ua"])

    def test_the_regression_this_check_exists_for_is_caught(self):
        """headerSafe reduced to a naive fold - the real check-links drift."""
        tpl = ("function headerSafe(s) {\n  return String(s).normalize('NFKD')"
               ".replace(/x/g, '');\n}\n")
        repo = "function headerSafe(s) {\n  return String(s).replace(/y/g, '');\n}\n"
        self.assertIsNotNone(self.td.compare(tpl, repo))

    # --- what is deliberately NOT compared ---
    def test_the_module_docblock_is_not_compared(self):
        a = "'use strict';\n/**\n * Reads data/chronology.json.\n */\nconst A = 1;\n"
        b = "'use strict';\n/**\n * Reads data/glossary.json.\n */\nconst A = 1;\n"
        self.assertIsNone(self.td.compare(a, b))

    def test_comments_are_not_compared(self):
        a = "const A = 1; // official reference\n// a note\nfunction f() {}\n"
        b = "const A = 1; // primary reference\n// a different note\nfunction f() {}\n"
        # inline trailing comments are not stripped, so use whole-line comments
        a = "// official reference\nconst A = 1;\nfunction f() {}\n"
        b = "// primary reference\nconst A = 1;\nfunction f() {}\n"
        self.assertIsNone(self.td.compare(a, b))

    def test_a_code_change_hidden_among_comment_changes_is_still_caught(self):
        a = "// note one\nconst A = 1;\nfunction f() {}\n"
        b = "// note two\nconst A = 2;\nfunction f() {}\n"
        self.assertIsNotNone(self.td.compare(a, b))

    def test_blank_lines_are_not_drift(self):
        a = "const A = 1;\n\n\nfunction f() {}\n"
        b = "const A = 1;\nfunction f() {}\n"
        self.assertIsNone(self.td.compare(a, b))

    def test_validate_data_is_excluded_with_a_stated_reason(self):
        self.assertIn("validate-data.js", self.td.NOT_SHARED)
        self.assertTrue(self.td.NOT_SHARED["validate-data.js"].strip())
        self.assertNotIn("validate-data.js", self.td.SHARED)

    def test_the_family_is_currently_clean(self):
        """The real repos must pass. This is the check doing its job."""
        with silent():
            self.assertEqual(self.td.main([]), 0)


class TestReadOnly(unittest.TestCase):
    """No tool may contain a write to a dataset path."""

    def test_no_dataset_writes_in_sources(self):
        for filename in ("mine-prep.py", "dataset-query.py",
                         "unverified-report.py", "xref.py", "sync-skills.py",
                         "build-keywords.py", "normalise-entities.py",
                         "cof-xref.py", "cof-graph.py", "places.py", "cof-dates.py", "template-drift.py"):
            with open(os.path.join(HERE, filename), encoding="utf-8") as fh:
                source = fh.read()
            self.assertNotIn("json.dump(data", source, filename)
            for pattern in ("chronology.json\", \"w", "glossary.json\", \"w"):
                self.assertNotIn(pattern, source, filename)


if __name__ == "__main__":
    unittest.main()
