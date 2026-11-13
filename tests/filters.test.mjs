import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const f = require('../extension/src/core/filters.js');

test('parsePrice handles common formats', () => {
  assert.equal(f.parsePrice('A$1,250'), 1250);
  assert.equal(f.parsePrice('$40'), 40);
  assert.equal(f.parsePrice('£12.50'), 12.5);
  assert.equal(f.parsePrice('€1.250'), 1250);
  assert.equal(f.parsePrice('Free'), 0);
  assert.equal(f.parsePrice('call me'), null);
});

test('parseCard reads price, old price, title, location, status and shipping', () => {
  const c = f.parseCard('A$120\nA$150\nOak dining table\nFremantle, WA');
  assert.equal(c.price, 120);
  assert.equal(c.title, 'Oak dining table');
  assert.equal(c.location, 'Fremantle, WA');
  assert.equal(c.status, null);
  const sold = f.parseCard('Sold\nA$300\nRoad bike\nSubiaco, WA');
  assert.equal(sold.status, 'sold');
  assert.equal(sold.title, 'Road bike');
  const ship = f.parseCard('A$65\nDesk lamp\nShips to you');
  assert.equal(ship.shipped, true);
  assert.equal(ship.title, 'Desk lamp');
  assert.equal(f.parseCard('Free\nMoving boxes\nPerth').price, 0);
});

test('exclusions match whole words and phrases, case-insensitively', () => {
  const m = f.compileExclusions(['iPhone 11', 'broken', ' Broken ', '']);
  assert.equal(m.length, 2, 'normalised and de-duplicated');
  const hit = (t) => m.some((x) => x.re.test(t));
  assert.ok(hit('Broken iPhone 11 for parts'));
  assert.ok(hit('iphone   11 pro'));
  assert.ok(!hit('iPhone 115 case collection'));
  assert.ok(!hit('Unbroken vase'));
  assert.ok(hit('BROKEN!'));
});

test('regex characters in a word are treated literally', () => {
  const [m] = f.compileExclusions(['c++ (book)']);
  assert.ok(m.re.test('Learn c++ (book) 3rd ed'));
  assert.ok(!m.re.test('learn c book'));
});

test('decide applies each rule with a reason', () => {
  const s = f.sanitiseSettings({ exclusions: ['broken'], minPrice: 10, maxPrice: 1000, hideSold: true, hideShipped: true, hideViewed: true });
  const state = { viewed: new Set(['7']), hidden: new Set(['9']) };
  const d = (text, id = '1') => f.decide(f.parseCard(text), id, s, state).reason;
  assert.equal(d('A$100\nOak table\nPerth'), null);
  assert.equal(d('A$100\nOak table\nPerth', '9'), 'hidden');
  assert.equal(d('Sold\nA$100\nOak table\nPerth'), 'sold');
  assert.equal(d('A$40\nBroken phone\nPerth'), 'keyword');
  assert.equal(d('A$5\nPen\nPerth'), 'price');
  assert.equal(d('A$5000\nCar\nPerth'), 'price');
  assert.equal(d('A$50\nLamp\nShips to you'), 'shipped');
  assert.equal(d('A$50\nLamp\nPerth', '7'), 'viewed');
});

test('opened listings are marked Seen, not hidden, unless asked', () => {
  const s = f.sanitiseSettings({});
  const v = f.decide(f.parseCard('A$15\nThing\nPerth'), '7', s, { viewed: new Set(['7']), hidden: new Set() });
  assert.deepEqual(v, { hide: false, reason: null, seen: true });
});

test('sanitiseSettings survives junk storage', () => {
  const s = f.sanitiseSettings({ enabled: 'yes', minPrice: '500', maxPrice: 100, exclusions: 'nope', hideSold: 0 });
  assert.equal(s.enabled, true);
  assert.equal(s.minPrice, 100, 'swapped so min <= max');
  assert.equal(s.maxPrice, 500);
  assert.deepEqual(s.exclusions, []);
  assert.equal(s.hideSold, false);
  assert.deepEqual(f.sanitiseSettings(null), { ...f.DEFAULT_SETTINGS, exclusions: [] });
  assert.equal(f.sanitiseSettings({ minPrice: -3 }).minPrice, null);
});

test('remember keeps a capped, de-duplicated, most-recent-last list', () => {
  let list = [];
  for (const id of ['a', 'b', 'c', 'a', 'd']) list = f.remember(list, id, 3);
  assert.deepEqual(list, ['c', 'a', 'd']);
});

test('junk: wanted posts, rentals, placeholder prices, sponsored', () => {
  const j = (text) => f.junkReason(f.parseCard(text));
  assert.equal(j('A$100\nWANTED: road bike\nPerth'), 'wanted');
  assert.equal(j('A$1\nWTB PS5\nPerth'), 'wanted');
  assert.equal(j('A$50\nAfter: Lego Millennium Falcon\nPerth'), 'wanted');
  assert.equal(j('A$50\nAfter-market wheels\nPerth'), null, '"after" mid-sentence is fine');
  assert.equal(j('A$400\nRoom for rent Subiaco\nPerth'), 'rental');
  assert.equal(j('A$1,234\nKids scooter\nPerth'), 'placeholder');
  assert.equal(j('A$1\nCouch\nPerth'), 'placeholder');
  assert.equal(j('Free\nCouch\nPerth'), null, 'free is a real price');
  assert.equal(j('A$999\nLaptop\nPerth'), null, '999 is a real price');
  assert.equal(j('Sponsored\nA$20\nThing\nPerth'), 'sponsored');
  assert.equal(j('A$120\nOak table\nPerth'), null);
});

test('decide: junk, duplicates, only-new and Saved behave', () => {
  const s = f.sanitiseSettings({ onlyNew: true });
  const st = { viewed: new Set(), hidden: new Set() };
  const card = f.parseCard('A$120\nOak table\nPerth');
  assert.equal(f.decide(f.parseCard('A$1\nCouch\nPerth'), '1', s, st, null, { isNew: true }).reason, 'junk');
  assert.equal(f.decide(card, '1', s, st, null, { isNew: true, duplicate: true }).reason, 'junk');
  assert.equal(f.decide(card, '1', s, st, null, { isNew: false }).reason, 'not-new');
  assert.equal(f.decide(card, '1', s, st, null, { isNew: true }).reason, null);
  const sold = f.parseCard('Sold\nA$120\nOak table\nPerth');
  assert.equal(f.decide(sold, '1', s, st, null, { onSaved: true, isNew: false }).reason, null, 'Saved: sold is tagged, not hidden');
  assert.equal(f.decide(sold, '1', f.sanitiseSettings({ tidySaved: true }), st, null, { onSaved: true }).reason, 'sold');
  assert.equal(f.decide(card, '1', f.sanitiseSettings({ hideJunk: false }), st, null, { duplicate: true }).reason, null);
});

test('parseCard splits a price drop that arrives as one run of text', () => {
  for (const [text, price, title] of [
    ['$15,500$17,000\nTractor\nPerth, WA', 15500, 'Tractor'],
    ['AU$95AU$120\nOak table\nFremantle, WA', 95, 'Oak table'],
    ['$0$50\nChair\nPerth, WA', 0, 'Chair'],
  ]) {
    const c = f.parseCard(text);
    assert.deepEqual([c.price, c.title], [price, title], text);
  }
  assert.equal(f.parseCard('A$40\nSet of 10$5 notes\nPerth, WA').title, 'Set of 10$5 notes', 'only splits when every piece is a price');
  assert.equal(f.parseCard('Price drop\nA$25\nDesk lamp\nPerth, WA').title, 'Desk lamp');
  const free = f.parseCard('$0\nFree\nPerth, WA');
  assert.deepEqual([free.price, free.title, free.location], [0, 'Free', 'Perth, WA'], 'a listing titled "Free"');
});
