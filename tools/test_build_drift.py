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
TPL_CSS = f"body {{}}\n{H}\n   Time river (core#108): x\n   --- */\n.rv {{}}\n\n{H}\n   Dark mode (core#113): y\n   --- */\n.dk {{}}\n"


def tpl():
    return {"functions": bd.functions(TPL_BUILD), "keys": bd.translatable_keys(TPL_BUILD),
            "river": "RIVER", "css": {m: bd.css_block(TPL_CSS, m) for m in bd.CSS_BLOCKS}}


def site(build=TPL_BUILD, decl=None, river="RIVER", css=TPL_CSS):
    files = {"build.js": build, "src/river.js": river, "src/styles.css": css}
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
        self.assertEqual(self.kinds(site(css="body {}\n")), ["MISSING", "MISSING"])

    def test_site_rules_after_a_block_are_allowed(self):
        css = TPL_CSS.replace(f"\n{H}\n   Dark mode", f"/* site rules */\n.mine {{}}\n\n{H}\n   Dark mode")
        self.assertEqual(self.kinds(site(css=css)), [])


if __name__ == "__main__":
    unittest.main()
