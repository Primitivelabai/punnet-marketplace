import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FIXTURE = readFileSync(new URL('./fixtures/marketplace.html', import.meta.url), 'utf8');
const CORE = ['core/routes.js', 'core/filters.js', 'core/memory.js', 'core/watches.js', 'data/au-places.js', 'core/places.js', 'core/shortlist.js', 'core/starters.js', 'core/enhance.js', 'content/ui.js'].map((p) =>
  readFileSync(new URL('../extension/src/' + p, import.meta.url), 'utf8')
);

/** A Marketplace-like page with the extension's core scripts loaded into the window, as Chrome does. */
function page() {
  const dom = new JSDOM(FIXTURE, { url: 'https://www.facebook.com/marketplace/perth/', runScripts: 'outside-only' });
  for (const src of CORE) dom.window.eval(src);
  return { dom, doc: dom.window.document, MM: dom.window.MarketMode };
}

test('tags Facebook top bar and Marketplace side panel', () => {
  const { doc, MM } = page();
  const found = MM.enhance.tagChrome(doc);
  assert.deepEqual({ ...found }, { bar: true, side: true });
  assert.equal(doc.querySelector('[role=banner]').getAttribute('data-mm'), 'fb-bar');
  const side = doc.querySelector('[data-mm=fb-side]');
  assert.ok(side.querySelector('#fb-location'), 'the panel with Facebook location control is the one tagged');
});

test('finds one card per listing, at the grid cell', () => {
  const { doc, MM } = page();
  const cards = MM.enhance.findCards(doc);
  assert.equal(cards.length, 11);
  for (const c of cards) assert.ok(c.cell.classList.contains('cell'), 'cell for ' + c.id);
});

test('filters hide the right cards, keep the rest, and never remove DOM', () => {
  const { doc, MM } = page();
  const settings = MM.filters.sanitiseSettings({ exclusions: ['broken'], maxPrice: 1000, hideSold: true, hideShipped: true });
  const before = doc.querySelectorAll('a[href*="/marketplace/item/"]').length;
  const stats = MM.enhance.applyFilters(doc, settings, { viewed: new Set(['1007']), hidden: new Set(['1005']) });
  const hiddenIds = [...doc.querySelectorAll('[data-mm-hide]')].map((el) => [el.getAttribute('data-mm-card'), el.getAttribute('data-mm-hide')]);
  assert.deepEqual(Object.fromEntries(hiddenIds), {
    1002: 'keyword', // "Broken iPhone 11 for parts"
    1003: 'sold',
    1004: 'price', // A$2,400 > 1000
    1005: 'hidden', // hidden by the person
    1006: 'shipped',
    1009: 'junk', // WANTED: road bike
    1010: 'junk', // A$1,234 placeholder
    1011: 'junk', // duplicate of 1007 on the same page
    null: 'junk', // the sponsored tile (not a listing card, so no id)
  });
  assert.ok(doc.querySelector('#ad').hasAttribute('data-mm-sponsored'));
  assert.equal(stats.total, 11);
  assert.equal(stats.hidden, 9);
  assert.ok(doc.querySelector('[data-mm-card="1007"]').hasAttribute('data-mm-seen'), 'opened listing is marked Seen');
  assert.ok(!doc.querySelector('[data-mm-card="1008"]').hasAttribute('data-mm-hide'), '"iPhone 115" is not "iPhone 11"');
  assert.equal(doc.querySelectorAll('a[href*="/marketplace/item/"]').length, before, 'no Facebook nodes removed');
});

test('re-applying is idempotent and reflects changed settings', () => {
  const { doc, MM } = page();
  const state = { viewed: new Set(), hidden: new Set() };
  MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({ exclusions: ['broken'] }), state);
  MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({ exclusions: ['broken'] }), state);
  assert.equal(doc.querySelectorAll('[data-mm-ui="card-actions"]').length, 11, 'one control per card');
  const stats = MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({ hideSold: false, hideJunk: false }), state);
  assert.equal(stats.hidden, 0);
  assert.equal(doc.querySelectorAll('[data-mm-hide]').length, 0);
});

test('hide controls sit beside Facebook links, never inside them', () => {
  const { doc, MM } = page();
  MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({}), { viewed: new Set(), hidden: new Set() });
  for (const btn of doc.querySelectorAll('[data-mm-act="hide"]')) {
    assert.equal(btn.closest('a'), null);
    assert.match(btn.getAttribute('data-mm-id'), /^\d+$/);
    assert.equal(btn.getAttribute('aria-label'), 'Hide this listing');
  }
});

test('shell UI mounts in a shadow root and reports intent through handlers', () => {
  const { doc, MM, dom } = page();
  const calls = [];
  const handlers = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const view = MM.ui.mount(doc, handlers);
  const settings = MM.filters.sanitiseSettings({ exclusions: ['wanted'] });
  view.render({ settings, tab: 'saved', query: 'oak', stats: { total: 8, hidden: 3, reasons: { keyword: 3 } }, hiddenCount: 2, viewedCount: 5 });
  const $ = (s) => view.shadow.querySelector(s);

  assert.equal($('.search input').value, 'oak');
  assert.equal($('.tabs [data-tab="saved"]').getAttribute('aria-current'), 'page');
  assert.equal($('.pill [data-pill-text]').textContent, '3 hidden · left-out words');
  assert.equal($('[data-count]').textContent, '1');
  assert.ok($('[data-remove="wanted"]'));
  assert.equal($('input[name="newestFirst"]').checked, true);

  $('.search input').value = 'desk';
  $('.search').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  $('input[name="hideViewed"]').checked = true;
  $('input[name="hideViewed"]').dispatchEvent(new dom.window.Event('change'));
  $('input[name="maxPrice"]').value = '250';
  $('input[name="maxPrice"]').dispatchEvent(new dom.window.Event('change'));
  $('[data-word-form] input').value = 'swap';
  $('[data-word-form]').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  $('[data-remove="wanted"]').click();
  $('[data-reveal]').click();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['onSearch', 'desk'],
    ['onSettings', { hideViewed: true }],
    ['onSettings', { maxPrice: 250 }],
    ['onSettings', { exclusions: ['wanted', 'swap'] }],
    ['onSettings', { exclusions: [] }],
    ['onToggleReveal'],
  ]);

  view.destroy();
  assert.equal(doc.querySelector('[data-mm-ui="shell"]'), null);
});

test('words added in the UI are rendered as text, not HTML', () => {
  const { doc, MM } = page();
  const view = MM.ui.mount(doc, {});
  view.render({ settings: MM.filters.sanitiseSettings({ exclusions: ['<img src=x onerror=alert(1)>'] }) });
  assert.equal(view.shadow.querySelector('.chips img'), null);
  assert.match(view.shadow.querySelector('.chip').textContent, /<img/);
});

const ITEM = readFileSync(new URL('./fixtures/item.html', import.meta.url), 'utf8');

test('memory: first visit badges nothing; later, new listings and price drops are badged', () => {
  const { doc, MM } = page();
  const settings = MM.filters.sanitiseSettings({});
  const state = { viewed: new Set(), hidden: new Set() };
  const seen = {};
  const prices = {};
  const first = MM.enhance.applyFilters(doc, settings, state, { now: 1000, firstRun: true, seen, prices, sessionNew: new Set() });
  assert.equal(first.newCount, 0);
  assert.ok(first.dirty.seen && first.dirty.prices);
  assert.equal(Object.keys(seen).length, 11);

  // next visit: one listing id is new, and the oak table dropped from A$120 to A$95
  const next = page();
  next.doc.querySelector('a[href^="/marketplace/item/1004/"]').setAttribute('href', '/marketplace/item/2004/');
  next.doc.querySelector('a[href^="/marketplace/item/1001/"] span').textContent = 'A$95';
  const stats = next.MM.enhance.applyFilters(next.doc, settings, state, { now: 2000, firstRun: false, seen, prices, sessionNew: new Set() });
  assert.equal(stats.newCount, 1);
  const badges = (id) => [...next.doc.querySelectorAll(`[data-mm-card="${id}"] [data-mm-badge]`)].map((b) => b.textContent);
  // same title and price as 1004 under a newer id: new to you, and flagged as relisted
  assert.deepEqual(badges('2004'), ['New', 'Relisted']);
  assert.deepEqual(badges('1001'), ['↓ A$25']);
  assert.equal(stats.cards.find((c) => c.id === '2004').isNew, true);
});

test('badges only rewrite the DOM when they change (no observer loops)', () => {
  const { doc, MM, dom } = page();
  const settings = MM.filters.sanitiseSettings({});
  const ctx = { now: 1, firstRun: true, seen: {}, prices: {}, sessionNew: new Set() };
  MM.enhance.applyFilters(doc, settings, { viewed: new Set(), hidden: new Set() }, ctx);
  let mutations = 0;
  const obs = new dom.window.MutationObserver((list) => (mutations += list.length));
  obs.observe(doc.body, { childList: true, subtree: true });
  MM.enhance.applyFilters(doc, settings, { viewed: new Set(), hidden: new Set() }, ctx);
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    obs.disconnect();
    assert.equal(mutations, 0);
  });
});

test('itemDetails reads the listing page', () => {
  const dom = new JSDOM(ITEM, { url: 'https://www.facebook.com/marketplace/item/1001/', runScripts: 'outside-only' });
  for (const src of CORE) dom.window.eval(src);
  const d = dom.window.MarketMode.enhance.itemDetails(dom.window.document);
  assert.equal(d.title, 'Oak dining table');
  assert.equal(d.price, 120);
  assert.equal(d.joinedYear, 2026);
  assert.match(d.text, /WhatsApp me/);
});

test('shell renders watches, Catch up results and trust signals', () => {
  const { doc, MM } = page();
  const calls = [];
  const handlers = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const view = MM.ui.mount(doc, handlers);
  const $ = (s) => view.shadow.querySelector(s);
  const settings = MM.filters.sanitiseSettings({});
  view.render({
    settings,
    kind: 'item',
    canWatch: true,
    watching: null,
    watches: [{ id: 'a', query: 'oak table', lastRun: Date.now() - 7200000, lastNew: 3 }],
    catchup: { done: true, queue: [], found: [{ id: '9', title: 'Oak table', priceText: 'A$80', img: 'javascript:alert(1)', watch: 'oak table' }] },
    signals: [{ tone: 'warn', key: 'pay-first', label: 'Mentions paying first', why: 'Pay when you have the item.' }],
  });
  assert.equal($('[data-watch]').hidden, false);
  assert.equal($('[data-catchup]').hidden, false);
  assert.match($('[data-watch-list]').textContent, /oak table.*3 new · 2h ago/);
  assert.equal($('[data-results]').hidden, false);
  assert.equal($('[data-results-list] a').getAttribute('href'), '/marketplace/item/9/');
  assert.equal($('[data-results-list] img'), null, 'only https images are shown');
  assert.equal($('[data-signals]').hidden, false);
  assert.equal($('[data-signal="pay-first"]').getAttribute('data-tone'), 'warn');

  $('[data-watch]').click();
  $('[data-catchup]').click();
  $('[data-open-watch="a"]').click();
  $('[data-unwatch="a"]').click();
  $('[data-clear-results]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['onWatch'], ['onCatchup'], ['onOpenWatch', 'a'], ['onUnwatch', 'a'], ['onClearResults']]);

  view.render({ kind: 'browse', watching: { id: 'a' } });
  assert.equal($('[data-signals]').hidden, true, 'trust panel only on listing pages');
  assert.equal($('[data-watch]').hidden, true, 'already watching');
});
