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


class TestReadOnly(unittest.TestCase):
    """No tool may contain a write to a dataset path."""

    def test_no_dataset_writes_in_sources(self):
        for filename in ("mine-prep.py", "dataset-query.py",
                         "unverified-report.py", "xref.py", "sync-skills.py"):
            with open(os.path.join(HERE, filename), encoding="utf-8") as fh:
                source = fh.read()
            self.assertNotIn("json.dump(data", source, filename)
            for pattern in ("chronology.json\", \"w", "glossary.json\", \"w"):
                self.assertNotIn(pattern, source, filename)


if __name__ == "__main__":
    unittest.main()
