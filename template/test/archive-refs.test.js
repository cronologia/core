'use strict';
/* archive-refs.js: the URL handling that kept references unarchived (cristo#13).
 * Network calls are not exercised here; the helpers decide what is asked. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wbEncode, selfArchived, hopCandidates } = require('../scripts/archive-refs.js');

test('a literal * in a path is encoded, so Wayback does not read it as a wildcard', () => {
  const q = wbEncode('https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Tacitus/Annals/15B*.html');
  assert.ok(q.endsWith('15B%2A.html'));
  assert.ok(!q.includes('*'));
});

test('an Internet Archive item is its own preserved copy', () => {
  assert.ok(selfArchived('https://archive.org/details/mmoiresurlesin00rohauoft'));
  assert.ok(selfArchived('https://web.archive.org/web/2020/https://example.org/'));
  assert.ok(!selfArchived('https://example.org/archive.org/x'));
});

test('a DOI view hop also tries the canonical /doi/ page', () => {
  assert.deepEqual(hopCandidates('https://pubs.acs.org/doi/abs/10.1021/ar00171a004'),
    ['https://pubs.acs.org/doi/abs/10.1021/ar00171a004', 'https://pubs.acs.org/doi/10.1021/ar00171a004']);
  assert.deepEqual(hopCandidates('https://example.org/moved/'), ['https://example.org/moved/']);
});
