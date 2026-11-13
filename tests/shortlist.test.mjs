import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SL = require('../extension/src/core/shortlist.js');
const ST = require('../extension/src/core/starters.js');
const places = require('../extension/src/core/places.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 9, 2);
const oak = { id: '1001', href: '/marketplace/item/1001/', title: 'Oak table', priceText: 'A$120', price: 120, img: 'https://scontent.example/1.jpg', location: 'Fremantle, WA' };
const pine = { id: '1002', href: '/marketplace/item/1002/', title: 'Pine table', priceText: 'A$90', price: 90, img: null, location: 'Joondalup, WA' };

test('toggle stars and unstars, newest first, capped', () => {
  let list = SL.toggle([], oak, NOW);
  list = SL.toggle(list, pine, NOW + 1);
  assert.deepEqual(list.map((e) => e.id), ['1002', '1001']);
  assert.ok(SL.has(list, '1001'));
  list = SL.toggle(list, oak, NOW + 2);
  assert.deepEqual(list.map((e) => e.id), ['1002']);
  let many = [];
  for (let i = 0; i < SL.MAX + 5; i++) many = SL.toggle(many, { id: String(i), title: 't' }, NOW + i);
  assert.equal(many.length, SL.MAX);
  assert.equal(SL.remove(list, '1002').length, 0);
});

test('only safe links and photos are stored', () => {
  const [e] = SL.toggle([], { id: '9', href: 'https://evil.example/', img: 'javascript:alert(1)', title: 'x' }, NOW);
  assert.equal(e.href, null);
  assert.equal(e.img, null);
  const [m] = SL.toggle([], { id: 'mabc', href: null, title: 'Mobile card' }, NOW);
  assert.equal(m.href, null, 'mobile-site cards have no link');
});

test('update refreshes a listing from its page, and reports no change when there is none', () => {
  const list = SL.toggle([], oak, NOW);
  const signals = [{ key: 'pay-first', tone: 'warn', label: 'Mentions paying first', why: 'x' }];
  const next = SL.update(list, '1001', { priceText: 'A$100', price: 100, signals }, NOW + DAY);
  assert.notEqual(next, list);
  assert.equal(next[0].price, 100);
  assert.deepEqual(next[0].signals, [{ key: 'pay-first', tone: 'warn', label: 'Mentions paying first' }]);
  assert.equal(SL.update(next, '1001', { priceText: 'A$100', price: 100, signals }, NOW + 2 * DAY), next, 'unchanged');
  assert.equal(SL.update(next, 'nope', { price: 1 }, NOW), next, 'not shortlisted');
});

test('compare lines listings up with price, drop, age, distance and hints, and marks the best', () => {
  let list = SL.toggle([], oak, NOW - DAY);
  list = SL.toggle(list, pine, NOW);
  list = SL.update(list, '1001', { signals: [{ key: 'old-profile', tone: 'good', label: 'Long-standing profile' }] }, NOW);
  list = SL.update(list, '1002', { signals: [{ key: 'pay-first', tone: 'warn', label: 'Mentions paying first' }] }, NOW);
  const prices = { 1001: { p: 95, hi: 120, t0: NOW - 3 * DAY, tc: NOW, ti: 'oak table' } };
  const rows = SL.compare(list, { prices, seen: { 1002: NOW - 2 * DAY }, home: places.resolve('Fremantle, WA'), now: NOW });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId['1001'].price, 95, 'latest price from memory');
  assert.equal(byId['1001'].drop, 25);
  assert.equal(byId['1001'].age, '3d');
  assert.equal(byId['1002'].age, '2d');
  assert.equal(byId['1001'].kmText, '< 1 km');
  assert.ok(byId['1002'].km > 30);
  assert.deepEqual(byId['1001'].best, ['km', 'warnings']);
  assert.deepEqual(byId['1002'].best, ['price']);
  const solo = SL.compare([list[0]], { now: NOW });
  assert.deepEqual(solo[0].best, [], 'nothing to beat');
  assert.equal(solo[0].kmText, '', 'no home, no distance');
});

test('message starters: defaults, cleaning and filling', () => {
  assert.deepEqual(ST.sanitise(undefined), ST.DEFAULT_STARTERS);
  assert.deepEqual(ST.sanitise([]), [], 'the person can remove them all');
  assert.deepEqual(ST.sanitise(['  Hi  there ', 'Hi there', '', null, 'x'.repeat(400)]), ['Hi there', 'x'.repeat(300)]);
  assert.equal(ST.sanitise(Array.from({ length: 10 }, (_, i) => 's' + i)).length, ST.MAX);
  const item = { title: 'Oak table', priceText: 'A$120' };
  assert.equal(ST.fill('Hi, is the {title} still available?', item), 'Hi, is the Oak table still available?');
  assert.equal(ST.fill('Would you take less than {price}?', item), 'Would you take less than A$120?');
  assert.equal(ST.fill('Would you take less than {price}?', {}), 'Would you take less than?');
  assert.equal(ST.fill('Is the {title} available?', {}), 'Is the item available?');
});
