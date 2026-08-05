'use strict';
/* The stylesheet has no compiler, no linter and no test — so a single missing
 * character silently changed what the site looks like, on twelve of nineteen
 * published sites, for as long as nobody thought to count braces (core#79).
 *
 * The tier-map `@media print` block was opened and never closed. Everything
 * after it — the chronology spine, the swimlanes, the places-map cards, the
 * approval ladder, .date-note — was therefore nested inside it and never
 * applied on screen. Nothing failed: the markup is an ordered list, a real
 * table and a list of links, so unstyled it reads as plain rather than broken,
 * and "duller than intended" is not a bug report.
 *
 * Two assertions, both cheap, both of which would have caught it on day one. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'src', 'styles.css');
const raw = fs.readFileSync(CSS_PATH, 'utf8');

/** Blank comments while preserving line numbers, so reports point somewhere. */
const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));

test('styles.css: every block is closed', () => {
  let depth = 0;
  let openedAt = null;
  const lines = stripped.split('\n');
  lines.forEach((line, i) => {
    for (const ch of line) {
      if (ch === '{') { if (depth === 0) openedAt = i + 1; depth += 1; }
      else if (ch === '}') {
        depth -= 1;
        assert.ok(depth >= 0, `stray closing brace at line ${i + 1}`);
      }
    }
  });
  assert.equal(depth, 0,
    `styles.css ends inside an unclosed block opened at line ${openedAt} ` +
    `(${(raw.split('\n')[openedAt - 1] || '').trim()}). Everything after it is ` +
    `nested in that block — if it is a media query, those rules never apply.`);
});

test('styles.css: every screen component is styled outside @media print', () => {
  // The right invariant is not "never mentioned in a print block" — forcing the
  // details open on paper is a legitimate print override of .al-details. It is
  // that each component is styled for SCREEN somewhere. A selector that appears
  // only inside print queries has no screen styling at all, which is exactly
  // what the missing brace did to the spine, the swimlanes and the ladder.
  const COMPONENTS = ['.al-cascade', '.al-node-link', '.al-details', '.cs-track-list', '.date-note', '.sw-grid'];
  const lines = stripped.split('\n');
  let depth = 0;
  let atRule = null;
  const seenOnScreen = new Set();
  lines.forEach((line) => {
    if (depth === 0 && line.includes('@media')) atRule = line;
    const printing = atRule && /\bprint\b/.test(atRule);
    if (!printing) for (const sel of COMPONENTS) if (line.includes(sel)) seenOnScreen.add(sel);
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) atRule = null; }
    }
  });
  const invisible = COMPONENTS.filter((sel) => raw.includes(sel) && !seenOnScreen.has(sel));
  assert.deepEqual(invisible, [],
    `these components are styled ONLY inside @media print, so they render unstyled ` +
    `on screen: ${invisible.join(', ')}`);
});
