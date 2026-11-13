import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const p = require('../extension/src/core/places.js');
const f = require('../extension/src/core/filters.js');
const DATA = new URL('../extension/src/data/au-places.js', import.meta.url);

test('the bundled suburb table is local, attributed and small enough to ship', () => {
  const src = readFileSync(DATA, 'utf8');
  assert.match(src, /GeoNames/);
  assert.match(src, /CC BY 4\.0/);
  assert.ok(statSync(DATA).size < 2 * 1024 * 1024, 'under 2 MB');
  const { AU } = require('../extension/src/data/au-places.js');
  const states = AU.split('\n').filter((l) => !l.includes(','));
  assert.deepEqual(states.sort(), ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);
  assert.ok(AU.split('\n').length > 15000, 'covers the country');
});

test('resolve reads the place line Facebook shows on cards', () => {
  const fre = p.resolve('Fremantle, WA');
  assert.equal(p.label(fre), 'Fremantle, WA');
  assert.ok(Math.abs(fre.lat - -32.05) < 0.05 && Math.abs(fre.lon - 115.75) < 0.05);
  assert.equal(p.label(p.resolve('Joondalup, Western Australia')), 'Joondalup, WA');
  assert.equal(p.label(p.resolve('saint kilda, vic')), 'St Kilda, VIC');
  assert.equal(p.label(p.resolve('O’Connor, WA')), "O'Connor, WA");
  assert.equal(p.label(p.resolve('Fremantle')), 'Fremantle, WA', 'a bare name that means one place');
});

test('unknown and ambiguous places resolve to nothing (so they are never filtered out)', () => {
  assert.equal(p.resolve('Atlantis Downs, WA'), null);
  assert.equal(p.resolve('Ships to you'), null);
  assert.equal(p.resolve(''), null);
  assert.equal(p.resolve('Perth'), null, 'Perth WA and Perth TAS');
  assert.equal(p.resolve('Richmond'), null, 'one Richmond per state');
  assert.equal(p.resolve('Perth, Scotland'), null);
});

test('distances are real kilometres', () => {
  const km = (a, b) => p.distanceKm(p.resolve(a), p.resolve(b));
  assert.ok(Math.abs(km('Fremantle, WA', 'Joondalup, WA') - 35) < 3);
  assert.ok(Math.abs(km('Perth, WA', 'Sydney, NSW') - 3290) < 40);
  assert.equal(km('Fremantle, WA', 'Fremantle, WA'), 0);
  assert.equal(p.distanceKm(null, p.resolve('Perth, WA')), null);
  assert.equal(p.formatKm(0.42), '< 1 km');
  assert.equal(p.formatKm(12.4), '12 km');
  assert.equal(p.formatKm(null), '');
});

test('suggest offers suburbs for the home picker', () => {
  assert.ok(p.suggest('fremantl').includes('Fremantle, WA'));
  assert.ok(p.suggest('Victoria Pa').includes('Victoria Park, WA'));
  assert.deepEqual(p.suggest('f'), [], 'needs two letters');
  assert.ok(p.suggest('s', 6).length === 0 && p.suggest('su', 6).length <= 6);
});

test('strict distance hides only known places beyond the radius', () => {
  const s = f.sanitiseSettings({ home: 'Fremantle, WA', maxKm: 20 });
  const card = f.parseCard('A$40\nLamp\nJoondalup, WA');
  assert.equal(f.decide(card, '1', s, null, null, { km: 35 }).reason, 'distance');
  assert.equal(f.decide(card, '1', s, null, null, { km: 5 }).hide, false);
  assert.equal(f.decide(card, '1', s, null, null, { km: null }).hide, false, 'unknown place stays');
  assert.equal(f.decide(card, '1', f.sanitiseSettings({ home: 'Fremantle, WA' }), null, null, { km: 900 }).hide, false, 'no radius: distances only');
});

test('settings keep a sane home and radius', () => {
  assert.deepEqual(
    (({ home, maxKm }) => ({ home, maxKm }))(f.sanitiseSettings({ home: '  Fremantle, WA ', maxKm: '25' })),
    { home: 'Fremantle, WA', maxKm: 25 }
  );
  assert.equal(f.sanitiseSettings({ maxKm: -3 }).maxKm, null);
  assert.equal(f.sanitiseSettings({ maxKm: 'far' }).maxKm, null);
  assert.equal(f.sanitiseSettings({ home: '' }).home, null);
  assert.equal(f.sanitiseSettings({ home: 42 }).home, null);
});
