"""Tests for build-drift.py: each finding kind, on synthetic sites."""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("build_drift", os.path.join(HERE, "build-drift.py"))
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)

H = bd.CSS_HEADER
TPL_BUILD = """const TRANSLATABLE_KEYS = new Set([
  'title', 'text', // a comment with 'quoted' words is ignored
  'founded',
]);
function a(x) {
  return x;
}
function b() {
  return 1;
}
"""
TPL_CSS = (f"body {{}}\n{H}\n   Time river (core#108): x\n   --- */\n.rv {{}}\n\n"
           f"{H}\n   Citation previews (core#119): c\n   --- */\n.cp {{}}\n\n"
           f"{H}\n   Dark mode (core#113): y\n   --- */\n.dk {{}}\n")


def tpl():
    return {"functions": bd.functions(TPL_BUILD), "keys": bd.translatable_keys(TPL_BUILD),
            "scripts": {"src/river.js": "RIVER", "src/cite.js": "CITE"}, "css": {m: bd.css_block(TPL_CSS, m) for m in bd.CSS_BLOCKS}}


def site(build=TPL_BUILD, decl=None, river="RIVER", css=TPL_CSS):
    files = {"build.js": build, "src/river.js": river, "src/cite.js": "CITE", "src/styles.css": css}
    if decl is not None:
        files[bd.DECL] = json.dumps(decl)
    return lambda path: files.get(path)


class BuildDrift(unittest.TestCase):
    def kinds(self, read):
        return sorted(k for k, _ in bd.check_site(read, tpl()))

    def test_identical_site_is_in_step(self):
        self.assertEqual(self.kinds(site()), [])

    def test_undeclared_change_is_drift(self):
        self.assertEqual(self.kinds(site(build=TPL_BUILD.replace("return x;", "return x + 1;"))), ["DRIFT"])

    def test_declared_change_with_current_base_is_accepted(self):
        base = bd.fhash(tpl()["functions"]["a"])
        read = site(build=TPL_BUILD.replace("return x;", "return x + 1;"), decl={"customized": {"a": {"reason": "r", "base": base}}})
        self.assertEqual(self.kinds(read), [])

    def test_template_change_makes_a_declaration_stale(self):
        read = site(build=TPL_BUILD.replace("return x;", "return x + 1;"), decl={"customized": {"a": {"reason": "r", "base": "000000000000"}}})
        self.assertEqual(self.kinds(read), ["STALE"])

    def test_declaration_of_an_identical_function_is_flagged(self):
        base = bd.fhash(tpl()["functions"]["a"])
        self.assertEqual(self.kinds(site(decl={"customized": {"a": {"base": base}}})), ["UNUSED-DECLARATION"])

    def test_missing_function_and_missing_key(self):
        build = TPL_BUILD.replace("function b() {\n  return 1;\n}\n", "").replace("  'founded',\n", "")
        self.assertEqual(self.kinds(site(build=build)), ["DRIFT", "MISSING"])

    def test_site_may_add_functions_and_keys(self):
        build = TPL_BUILD.replace("  'founded',\n", "  'founded', 'paragraphs',\n") + "function mine() {\n}\n"
        self.assertEqual(self.kinds(site(build=build)), [])

    def test_river_and_css_blocks(self):
        self.assertEqual(self.kinds(site(river="OLD")), ["DRIFT"])
        self.assertEqual(self.kinds(site(css=TPL_CSS.replace(".dk {}", ".dk { x }"))), ["DRIFT"])
        self.assertEqual(self.kinds(site(css="body {}\n")), ["MISSING"] * len(bd.CSS_BLOCKS))

    def test_site_rules_after_a_block_are_allowed(self):
        css = TPL_CSS.replace(f"\n{H}\n   Dark mode", f"/* site rules */\n.mine {{}}\n\n{H}\n   Dark mode")
        self.assertEqual(self.kinds(site(css=css)), [])

    def skills_site(self, manifest):
        files = {"build.js": TPL_BUILD, "src/river.js": "RIVER", "src/cite.js": "CITE", "src/styles.css": TPL_CSS}
        if manifest is not None:
            files[bd.SKILLS_MANIFEST] = json.dumps({"skills": [{"name": n, "sha256": h} for n, h in manifest.items()]})
        t = dict(tpl(), skills={"a": "h1", "b": "h2"})
        return sorted(k for k, _ in bd.check_site(files.get, t))

    def test_skills_in_step(self):
        self.assertEqual(self.skills_site({"a": "h1", "b": "h2"}), [])

    def test_skill_changed_upstream_is_reported(self):
        self.assertEqual(self.skills_site({"a": "old", "b": "h2"}), ["SKILLS"])

    def test_skill_added_or_removed_upstream_is_reported(self):
        self.assertEqual(self.skills_site({"a": "h1"}), ["SKILLS"])
        self.assertEqual(self.skills_site({"a": "h1", "b": "h2", "gone": "h3"}), ["SKILLS"])

    def test_missing_manifest_is_reported(self):
        self.assertEqual(self.skills_site(None), ["MISSING"])

    def test_canonical_skills_hash_like_sync_skills(self):
        skills = bd.canonical_skills()
        self.assertIn("adopt-template", skills)
        self.assertTrue(all(len(h) == 64 for h in skills.values()))

    TPL_TEST = "const x = 1;\n// >>> ADOPT: dataset\nconst DATASET = 'chronology.example.json';\n// <<< ADOPT\ntest('a', () => {});\n"

    def shared_site(self, site_test, decl_tests=None):
        files = {"build.js": TPL_BUILD, "src/river.js": "RIVER", "src/cite.js": "CITE", "src/styles.css": TPL_CSS}
        if site_test is not None:
            files["test/a.test.js"] = site_test
        if decl_tests is not None:
            files[bd.DECL] = json.dumps({"tests": decl_tests})
        t = dict(tpl(), tests={"a.test.js": bd.mask_adopt(self.TPL_TEST)})
        return sorted(k for k, _ in bd.check_site(files.get, t))

    def test_shared_test_identical_outside_adopt_is_in_step(self):
        site_copy = self.TPL_TEST.replace("chronology.example.json", "chronology.json")
        self.assertEqual(self.shared_site(site_copy), [])

    def test_shared_test_changed_outside_adopt_is_drift(self):
        self.assertEqual(self.shared_site(self.TPL_TEST.replace("const x = 1", "const x = 2")), ["DRIFT"])

    def test_missing_shared_test(self):
        self.assertEqual(self.shared_site(None), ["MISSING"])

    def test_declared_shared_test(self):
        base = bd.fhash(bd.mask_adopt(self.TPL_TEST))
        changed = self.TPL_TEST.replace("const x = 1", "const x = 2")
        self.assertEqual(self.shared_site(changed, {"a.test.js": {"reason": "r", "base": base}}), [])
        self.assertEqual(self.shared_site(changed, {"a.test.js": {"reason": "r", "base": "000000000000"}}), ["STALE"])
        self.assertEqual(self.shared_site(self.TPL_TEST, {"a.test.js": {"reason": "r", "base": base}}), ["UNUSED-DECLARATION"])

    def test_adopt_tests_carries_site_regions_by_label(self):
        spec2 = importlib.util.spec_from_file_location("adopt_tests", os.path.join(HERE, "adopt-tests.py"))
        at = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(at)
        tpl_text = ("new();\n// >>> ADOPT: dataset  (the file)\nconst D = 'example';\n// <<< ADOPT\n"
                    "// >>> ADOPT: allow\nconst A = [];\n// <<< ADOPT\n")
        site_text = ("old();\n// >>> ADOPT: dataset  (the file)\nconst D = 'chronology';\n// <<< ADOPT\n"
                     "// >>> ADOPT: allow\nconst A = ['x'];\n// <<< ADOPT\n")
        merged = at.merge(tpl_text, site_text)
        self.assertIn("new();", merged)
        self.assertNotIn("old();", merged)
        self.assertIn("const D = 'chronology';", merged)
        self.assertIn("const A = ['x'];", merged)
        self.assertEqual(at.merge(tpl_text, None), tpl_text)
        self.assertEqual(bd.mask_adopt(merged), bd.mask_adopt(tpl_text))


if __name__ == "__main__":
    unittest.main()
