import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../extension/src/core/watches.js');

const FB = 'https://www.facebook.com';

test('queryOf reads only Marketplace search pages', () => {
  assert.equal(W.queryOf(FB + '/marketplace/perth/search/?query=Oak%20Table'), 'oak table');
  assert.equal(W.queryOf(FB + '/marketplace/search?query=lamp'), 'lamp');
  assert.equal(W.queryOf(FB + '/marketplace/perth/'), null);
  assert.equal(W.queryOf(FB + '/marketplace/search/?query='), null);
});

test('addWatch dedupes and caps; removeWatch removes', () => {
  let list = W.addWatch([], FB + '/marketplace/perth/search/?query=desk&sortBy=x', 1);
  list = W.addWatch(list, FB + '/marketplace/search/?query=DESK', 2);
  assert.equal(list.length, 1);
  assert.equal(list[0].path, '/marketplace/perth/search/');
  for (let i = 0; i < 12; i++) list = W.addWatch(list, FB + '/marketplace/search/?query=q' + i, 10 + i);
  assert.equal(list.length, W.MAX_WATCHES);
  const id = list[0].id;
  assert.equal(W.removeWatch(list, id).length, W.MAX_WATCHES - 1);
  assert.equal(W.watchUrl({ path: '/marketplace/perth/search/', query: 'oak table' }, FB), FB + '/marketplace/perth/search/?query=oak+table');
});

test('Catch up walks each watch once, gathers only new listings, and finishes', () => {
  const watches = [
    { id: 'a', query: 'desk', path: '/marketplace/search/' },
    { id: 'b', query: 'lamp', path: '/marketplace/search/' },
  ];
  let c = W.startCatchup(watches, 1000);
  assert.ok(W.catchupActive(c, 2000));
  assert.equal(W.currentWatch(c, watches).query, 'desk');

  let r = W.recordStep(c, watches, [{ id: '1', title: 'Desk' }, { id: '2', title: 'Desk 2' }], 3000);
  assert.equal(r.catchup.found.length, 2);
  assert.equal(r.watches[0].lastNew, 2);
  assert.equal(W.currentWatch(r.catchup, r.watches).query, 'lamp');
  assert.equal(r.catchup.done, false);

  r = W.recordStep(r.catchup, r.watches, [{ id: '2', title: 'Desk 2' }, { id: '3', title: 'Lamp' }], 4000);
  assert.deepEqual(r.catchup.found.map((f) => [f.id, f.watch]), [['1', 'desk'], ['2', 'desk'], ['3', 'lamp']]);
  assert.equal(r.catchup.done, true);
  assert.equal(W.catchupActive(r.catchup, 5000), false);
});

test('Catch up times out and never starts empty', () => {
  assert.equal(W.startCatchup([], 1), null);
  const c = W.startCatchup([{ id: 'a', query: 'x' }], 0);
  assert.equal(W.catchupActive(c, W.CATCHUP_TIMEOUT + 1), false);
});
