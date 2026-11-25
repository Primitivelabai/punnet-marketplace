import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const m = require('../extension/src/core/memory.js');

const NOW = Date.UTC(2026, 10, 9, 2, 0, 0);

test('noteSeen: new to you once, never on the very first run', () => {
  const seen = {};
  assert.equal(m.noteSeen(seen, '1', NOW, true), false, 'first run: nothing is new');
  assert.equal(m.noteSeen(seen, '1', NOW, false), false, 'already seen');
  assert.equal(m.noteSeen(seen, '2', NOW, false), true);
  assert.equal(seen['2'], NOW);
});

test('notePrice tracks the latest and highest price, and reports drops', () => {
  const prices = {};
  assert.equal(m.notePrice(prices, '1', 200, 'Oak Table!', NOW), true);
  assert.equal(m.notePrice(prices, '1', 200, 'Oak Table!', NOW + 1), false, 'unchanged = no write');
  assert.equal(m.notePrice(prices, '1', 150, 'Oak Table!', NOW + 2), true);
  assert.equal(m.priceDrop(prices['1']), 50);
  assert.equal(prices['1'].ti, 'oak table');
  assert.equal(m.notePrice(prices, '2', null, 'x', NOW), false);
  assert.equal(m.priceDrop(undefined), 0);
});

test('similar titles share meaningful words', () => {
  assert.ok(m.similar('Apple iPhone 13 Pro 128GB', 'iPhone 13 Pro 128gb unlocked'));
  assert.ok(!m.similar('iPhone 13 Pro', 'Samsung Galaxy S22'));
  assert.ok(!m.similar('Brand new', 'Brand new condition'), 'stop words alone never match');
});

test('repostOf finds the same title and price under an older id', () => {
  const prices = {};
  m.notePrice(prices, 'old', 300, 'Road bike 54cm', NOW - 86400000);
  m.notePrice(prices, 'new', 310, 'Road bike 54cm', NOW);
  m.notePrice(prices, 'other', 900, 'Road bike 54cm', NOW);
  const idx = m.titleIndex(prices);
  assert.equal(m.repostOf(prices, idx, 'new', 'Road bike 54cm', 310), 'old');
  assert.equal(m.repostOf(prices, idx, 'other', 'Road bike 54cm', 900), null, 'different price');
  assert.equal(m.repostOf(prices, idx, 'old', 'Road bike 54cm', 300), null, 'the original is not a repost');
});

test('typicalPrice needs at least 5 similar listings', () => {
  const prices = {};
  [400, 420, 450, 480, 500].forEach((p, i) => m.notePrice(prices, 'p' + i, p, `iPhone 13 Pro 128GB #${i}`, NOW));
  m.notePrice(prices, 'x', 9, 'Garden gnome', NOW);
  assert.deepEqual(m.typicalPrice(prices, 'Apple iPhone 13 Pro', 'me'), { n: 5, median: 450 });
  assert.equal(m.typicalPrice(prices, 'Garden gnome statue', 'me').median, null);
});

test('trust signals explain themselves', () => {
  const s = m.trustSignals({
    text: 'Pick up only. Small deposit to hold. WhatsApp me 0412 345 678. Joined Facebook in 2026',
    title: 'iPhone 13 Pro',
    price: 150,
    now: NOW,
    typical: { n: 6, median: 450 },
    repost: true,
    joinedYear: 2026,
  });
  const keys = s.map((x) => x.key);
  assert.deepEqual(keys, ['off-platform', 'pay-first', 'too-cheap', 'repost', 'new-profile']);
  for (const x of s) assert.ok(x.label && x.why && ['warn', 'good', 'info'].includes(x.tone));
});

test('trust signals stay quiet on an ordinary listing, and credit old profiles', () => {
  const s = m.trustSignals({ text: 'Solid oak table, pick up Fremantle.', price: 120, now: NOW, joinedYear: 2012 });
  assert.deepEqual(s.map((x) => x.key), ['old-profile']);
  assert.equal(m.trustSignals({ text: 'PayID on pickup is fine', price: 50, now: NOW }).length, 0, 'plain PayID is normal in AU');
});

test('joinedYear reads Facebook seller info', () => {
  assert.equal(m.joinedYear('Seller details\nJoined Facebook in 2014\n'), 2014);
  assert.equal(m.joinedYear('nothing here'), null);
});

test('memory is capped, keeping the most recent', () => {
  const seen = {};
  for (let i = 0; i < 6100; i++) seen['i' + i] = i;
  const trimmed = m.trimSeen(seen);
  assert.equal(Object.keys(trimmed).length, 6000);
  assert.ok(!('i0' in trimmed) && 'i6099' in trimmed);
});
