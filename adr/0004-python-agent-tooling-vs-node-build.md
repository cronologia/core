# ADR-0004 — Agent-side Python tooling in `tools/`, zero-dependency Node in the build

- **Status:** accepted (2026-07-24)
- **Context repo:** `cronologia/core`
- **Relates to:** `cronologia/fsp` ADR-0001 (zero dependencies); core ADR-0003
  (network-free build); precedent: `tools/vtt2txt.py`

## Context

Two kinds of program serve this family, and they have opposite requirements.

**Build and CI programs** must be reproducible on a bare GitHub runner years
from now: `validate-data.js`, `build.js`, `archive-refs.js`, `check-links.js`,
`sync-glossary-terms.js`, `translate.js`. Their virtue is that they have no
dependencies at all and their output is deterministic.

**Agent-side analysis programs** serve a different scarcity: an agent's context
window. A preserved transcript is 20k–63k tokens; a chronology is ~16k; the
verification worklist is spread across five datasets. Reading those end to end
burns the whole budget on scrolling, before any judgement happens. These
programs must be quick to write, string- and text-heavy, and easy for a model to
read the output of — and they run on an agent's machine, never in CI.

Mixing the two would either drag npm dependencies into a zero-dependency build,
or force every text-analysis tool into Node for no benefit. Python 3 was already
present for `vtt2txt.py`, which set the precedent.

## Decision

The line is architectural. Keep it.

| | build / CI tooling | agent-side analysis tooling |
|---|---|---|
| language | **zero-dependency Node** | **Python 3, stdlib only** |
| lives in | `template/scripts/`, a project's `scripts/`, `build.js` | `core/tools/` |
| runs | in the build, `node --test`, GitHub Actions | on an agent's machine, on demand |
| network | never in the build (ADR-0003); only the out-of-band scripts | as the task requires |
| writes | `docs/`, `data/archives.json`, reports | **nothing in `data/`** |

1. **No pip installs, no npm installs.** Standard library on both sides.
2. **The Python tools never run in CI** and are not a build dependency: deleting
   `core/tools/` must not break any project's build.
3. **They never edit a dataset.** `mine-prep`, `dataset-query`,
   `unverified-report` and `xref` read and report; `sync-skills.py` writes only
   vendored `.claude/skills/` copies. Editing data is a sourcing decision that
   stays with the agent or human who has the citation (`sourcing-rules` #1), and
   a test asserts no dataset write path appears in these sources.
4. **Output is written for a model to read**: dense fixed-field lines, a
   locator on every row (`events[12]`, `L412 C16051`) so the full record is one
   targeted read away, `--json` where a program consumes it, `--help` on all of
   them, and a non-zero exit only for a *real* error (unreadable dataset = 1,
   bad argument or inapplicable subcommand = 2) — never because the tool found
   something.
5. **Tested with stdlib `unittest`**, fixtures in a temp dir, no network, no
   repo mutation: `python3 -m unittest discover -s tools -p 'test_*.py' -v`.

## Consequences

- Measured effect: a candidate sheet is 8–16× smaller than its transcript, so an
  agent spends its tokens on judgement rather than scrolling.
- The build's determinism guarantee is untouched — the Python side cannot
  regress CI, because CI never invokes it.
- A new tool's home is decided by one question: *does the build or CI run it?*
  Yes → zero-dependency Node in `scripts/`. No → Python 3 stdlib in
  `core/tools/`.
