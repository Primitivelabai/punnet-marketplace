// DOM tests for mobile-site cards, strict distance, shortlist controls,
// message starters, and their shell surfaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fixture = (n) => readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8');
const CORE = [
  'core/routes.js',
  'core/filters.js',
  'core/memory.js',
  'core/watches.js',
  'data/au-places.js',
  'core/places.js',
  'core/shortlist.js',
  'core/starters.js',
  'core/enhance.js',
  'content/ui.js',
].map((p) => readFileSync(new URL('../extension/src/' + p, import.meta.url), 'utf8'));

function load(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  for (const src of CORE) dom.window.eval(src);
  return { dom, doc: dom.window.document, MM: dom.window.MarketMode };
}
const mobile = () => load(fixture('m-marketplace.html'), 'https://m.facebook.com/marketplace/perth/');
const desktop = () => load(fixture('marketplace.html'), 'https://www.facebook.com/marketplace/perth/');
const none = () => ({ viewed: new Set(), hidden: new Set() });

test('mobile site: finds listing cards without links, with stable ids and full titles', () => {
  const { doc, MM } = mobile();
  const cards = MM.enhance.findCards(doc);
  assert.equal(cards.length, 6, 'six listings; the Open app / Categories buttons are not cards');
  assert.ok(cards.every((c) => c.mobile && /^m[0-9a-z]+$/.test(c.id) && c.href === null));
  assert.equal(new Set(cards.map((c) => c.id)).size, 6);
  // same photo file, same id, on any visit (the query string changes, the file name doesn't)
  assert.equal(MM.enhance.mobileId('https://m.facebook.com/fixture/301_oak_n.jpg?stp=a'), MM.enhance.mobileId('https://x/fixture/301_oak_n.jpg?stp=b'));
  assert.equal(cards[1].fullTitle, 'Road bike carbon frame 56cm', 'the card text is cut short; the label is not');
  assert.equal(MM.enhance.mobileTitle('Pots for sale - New - A$40 in Perth, WA'), 'Pots');
  assert.equal(MM.enhance.mobileTitle('Categories'), null);
  assert.equal(MM.enhance.mobileTitle('Near New TV 65 inch\nSMART TV for sale - Used - A$300 in Perth, WA'), 'Near New TV 65 inch SMART TV', 'labels can wrap');
  assert.equal(cards[5].fullTitle, 'Pot plant in a big pot');
});

test('mobile site: filters, junk, badges and row folding work on the same pipeline', () => {
  const { doc, MM } = mobile();
  const settings = MM.filters.sanitiseSettings({ exclusions: ['carbon'] });
  const stats = MM.enhance.applyFilters(doc, settings, none(), { now: 1, firstRun: true, seen: {}, prices: {}, sessionNew: new Set() });
  const hide = (n) => doc.querySelector(`[data-action-id="${n}"]`).getAttribute('data-mm-hide');
  assert.equal(stats.total, 6);
  assert.equal(hide(302), 'keyword', 'matched on the full title from the label');
  assert.equal(hide(304), 'junk', 'WANTED post');
  assert.equal(hide(301), null);
  const rows = doc.querySelectorAll('.row');
  assert.equal(rows[0].hasAttribute('data-mm-hide-row'), false, 'one card left in the row');
  // hide the other card in row 1 by hand: the whole row folds
  const oak = doc.querySelector('[data-action-id="301"]').getAttribute('data-mm-card');
  MM.enhance.applyFilters(doc, settings, { viewed: new Set(), hidden: new Set([oak]) });
  assert.equal(rows[0].hasAttribute('data-mm-hide-row'), true);
  // real structure: a card in its own wrapper folds with it, and the row folds once both are hidden
  const lamp = doc.querySelector('[data-action-id="305"]');
  const plant = doc.querySelector('[data-action-id="306"]');
  MM.enhance.applyFilters(doc, settings, { viewed: new Set(), hidden: new Set([oak, lamp.getAttribute('data-mm-card')]) });
  assert.equal(lamp.parentElement.hasAttribute('data-mm-hide-row'), true, 'wrapper folds');
  assert.equal(rows[2].hasAttribute('data-mm-hide-row'), false, 'plant still showing');
  MM.enhance.applyFilters(doc, settings, { viewed: new Set(), hidden: new Set([lamp.getAttribute('data-mm-card'), plant.getAttribute('data-mm-card')]) });
  assert.equal(rows[2].hasAttribute('data-mm-hide-row'), true);
  assert.equal(rows[0].hasAttribute('data-mm-hide-row'), false, 'unhidden rows come back');
  // "Price drop" is Facebook's own label, not the title
  assert.equal(stats.cards.find((c) => c.price === 25).title, 'Desk lamp');
  // card controls are added to the card, and carry the synthetic id
  const star = doc.querySelector('[data-action-id="301"] [data-mm-act="star"]');
  assert.equal(star.getAttribute('data-mm-id'), oak);
});

test('strict distance: km badges from home, far listings hidden, unknown places kept and counted', () => {
  const { doc, MM } = mobile();
  const settings = MM.filters.sanitiseSettings({ home: 'Fremantle, WA', maxKm: 30 });
  const home = MM.places.resolve(settings.home);
  const stats = MM.enhance.applyFilters(doc, settings, none(), { home, now: 1, firstRun: true, seen: {}, prices: {}, sessionNew: new Set() });
  const card = (n) => doc.querySelector(`[data-action-id="${n}"]`);
  const km = (n) => (card(n).querySelector('[data-mm-badge="km"]') || {}).textContent;
  assert.equal(km(301), '< 1 km');
  assert.equal(card(302).getAttribute('data-mm-hide'), 'distance', 'Joondalup is ~35 km away');
  assert.equal(card(303).getAttribute('data-mm-hide'), 'distance', 'Sydney');
  assert.equal(card(305).getAttribute('data-mm-hide'), null, 'Atlantis Downs is not a real place: kept');
  assert.equal(km(305), undefined);
  assert.equal(stats.unknownPlaces, 1);
  assert.equal(stats.reasons.distance, 2);
  assert.ok(stats.cards.find((c) => c.title === 'Pot plant in a big pot').km > 5);

  // desktop grid: same, and shipped listings are never measured
  const d = desktop();
  const s2 = d.MM.enhance.applyFilters(d.doc, settings, none(), { home });
  assert.equal(d.doc.querySelector('[data-mm-card="1004"]').getAttribute('data-mm-hide'), 'distance', 'Joondalup');
  assert.equal(d.doc.querySelector('[data-mm-card="1006"] [data-mm-badge="km"]'), null, 'ships to you');
  assert.ok(s2.unknownPlaces === 0);
});

test('shortlist stars sit beside Facebook links, never inside them, and reflect state', () => {
  const { doc, MM } = desktop();
  MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({}), none(), { starred: new Set(['1001']) });
  const star = (id) => doc.querySelector(`[data-mm-card="${id}"] [data-mm-act="star"]`);
  assert.equal(star('1001').closest('a'), null);
  assert.equal(star('1001').getAttribute('aria-pressed'), 'true');
  assert.equal(star('1001').getAttribute('aria-label'), 'Remove from shortlist');
  assert.equal(star('1002').getAttribute('aria-pressed'), 'false');
  assert.ok(doc.querySelector('[data-mm-card="1001"]').hasAttribute('data-mm-starred'));
  // unstarring updates the same button, no duplicates
  MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({}), none(), { starred: new Set() });
  assert.equal(star('1001').getAttribute('aria-pressed'), 'false');
  assert.equal(doc.querySelectorAll('[data-mm-card="1001"] [data-mm-act="star"]').length, 1);
  const c = MM.enhance.applyFilters(doc, MM.filters.sanitiseSettings({}), none()).cards.find((x) => x.id === '1001');
  assert.deepEqual([c.href, c.title, c.price, c.location], ['/marketplace/item/1001/', 'Oak dining table', 120, 'Fremantle, WA']);
});

test('message starters fill Facebook’s message box like typing, and never press Send', () => {
  const { doc, MM, dom } = load(fixture('item.html'), 'https://www.facebook.com/marketplace/item/1001/');
  let inputs = 0;
  const box = MM.enhance.findMessageBox(doc);
  assert.equal(box.id, 'message-box');
  box.addEventListener('input', () => inputs++);
  let submitted = false;
  doc.addEventListener('submit', () => (submitted = true), true);
  doc.getElementById('message-seller').addEventListener('click', () => (submitted = true));
  const text = MM.starters.fill('Hi, is the {title} still available? I can pick up today.', MM.enhance.itemDetails(doc));
  assert.equal(MM.enhance.putText(box, text), true);
  assert.equal(box.value, 'Hi, is the Oak dining table still available? I can pick up today.');
  assert.equal(inputs, 1, 'Facebook hears an input event, as if typed');
  assert.equal(submitted, false, 'nothing is sent');

  // Messenger chat (a rich editor) when there's no listing textarea
  const chat = new JSDOM(
    '<div role="main"><h1>Item</h1></div><div role="dialog"><div contenteditable="true" role="textbox" aria-label="Message">old</div></div>',
    { url: 'https://www.facebook.com/marketplace/item/5/', runScripts: 'outside-only' }
  );
  for (const src of CORE) chat.window.eval(src);
  const ed = chat.window.MarketMode.enhance.findMessageBox(chat.window.document);
  assert.equal(ed.getAttribute('role'), 'textbox');
  assert.equal(chat.window.MarketMode.enhance.putText(ed, 'Still available?'), true);
  assert.equal(ed.textContent, 'Still available?');

  // the real signed-in page has a hidden copy of the seller box first: skip it
  const twin = load(
    '<div role="main"><h1>Item</h1><textarea id="hidden-copy">Hello, is this still available?</textarea><textarea id="shown">Hello, is this still available?</textarea></div>',
    'https://www.facebook.com/marketplace/item/8/'
  );
  twin.doc.getElementById('hidden-copy').checkVisibility = () => false;
  twin.doc.getElementById('shown').checkVisibility = () => true;
  assert.equal(twin.MM.enhance.findMessageBox(twin.doc).id, 'shown');

  // nothing open: nothing found (the app then copies the text instead)
  const empty = load('<div role="main"><h1>Item</h1></div>', 'https://www.facebook.com/marketplace/item/6/');
  assert.equal(empty.MM.enhance.findMessageBox(empty.doc), null);
  void dom;
});

test('itemDetails reads the photo and the place from a listing page', () => {
  const html = '<div role="main"><h1>Oak table</h1><img src="https://scontent.example/oak.jpg"><span>A$120</span><div>Listed 2 days ago in Fremantle, WA</div></div>';
  const { doc, MM } = load(html, 'https://www.facebook.com/marketplace/item/7/');
  const d = MM.enhance.itemDetails(doc);
  assert.equal(d.img, 'https://scontent.example/oak.jpg');
  assert.equal(d.location, 'Fremantle, WA');
});

test('shell: shortlist compare, star button, starters tray and editor, distance picker', () => {
  const { doc, MM, dom } = desktop();
  const calls = [];
  const handlers = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const view = MM.ui.mount(doc, handlers);
  const $ = (s) => view.shadow.querySelector(s);
  const $$ = (s) => [...view.shadow.querySelectorAll(s)];
  const settings = MM.filters.sanitiseSettings({ home: 'Fremantle, WA', maxKm: 20 });
  const list = MM.shortlist.toggle(MM.shortlist.toggle([], { id: '1001', href: '/marketplace/item/1001/', title: 'Oak', priceText: 'A$120', price: 120, location: 'Fremantle, WA' }, 1), { id: '1004', href: '/marketplace/item/1004/', title: 'Sofa', priceText: 'A$90', price: 90, location: 'Joondalup, WA' }, 2);
  const compare = MM.shortlist.compare(list, { home: MM.places.resolve('Fremantle, WA'), now: 10 });
  view.render({
    settings,
    kind: 'item',
    stats: { total: 3, hidden: 0, reasons: {}, unknownPlaces: 2 },
    item: { title: 'Oak table', priceText: 'A$120' },
    starters: ['Is the {title} still available?', 'Cash today?'],
    shortlist: list,
    compare,
    canStar: true,
    itemStarred: false,
  });

  // strip: star this listing; rail: open shortlist, open shortlist (count 2)
  assert.equal($('[data-star]').hidden, false);
  assert.equal($('[data-star]').getAttribute('aria-pressed'), 'false');
  assert.equal($('.tabs [data-open-shortlist]').hidden, false);
  assert.equal($('[data-shortlist-count]').textContent, '2');
  assert.equal($('[data-count]').textContent, '1', 'a set radius counts as an active filter');

  // compare: two columns, best marks, safe links
  $('.tabs [data-open-shortlist]').click();
  assert.equal($('.sheet').getAttribute('data-mode'), 'shortlist');
  assert.equal($('#mm-sheet-title').textContent, 'Your shortlist');
  assert.deepEqual($$('[data-compare-item]').map((a) => a.getAttribute('data-compare-item')), ['1004', '1001']);
  assert.ok($('[data-compare-item="1004"] [data-best="price"]'));
  assert.ok($('[data-compare-item="1001"] [data-best="km"]'));
  assert.equal($('[data-compare-item="1001"] a').getAttribute('href'), '/marketplace/item/1001/');

  // starters tray on the listing, filled from the listing
  assert.equal($('[data-listing-panel]').hidden, false);
  assert.deepEqual($$('[data-starter]').map((b) => b.textContent), ['Is the Oak table still available?', 'Cash today?']);

  // distance status
  assert.match($('[data-distance-status]').textContent, /From Fremantle, WA · within 20 km · 2 on this page we can’t place/);
  assert.equal($('[data-home-form] input').value, 'Fremantle, WA');

  $('[data-star]').click();
  $('[data-unstar="1004"]').click();
  $('[data-starter="1"]').click();
  $('[data-starter-form] [name=starter]').value = 'Can you hold it till Saturday?';
  $('[data-starter-form]').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  $('[data-remove-starter="0"]').click();
  const homeInput = $('[data-home-form] input');
  homeInput.value = 'victoria pa';
  homeInput.dispatchEvent(new dom.window.Event('input'));
  assert.ok($('[data-pick-home="Victoria Park, WA"]'), 'suggestions from the bundled table');
  $('[data-pick-home="Victoria Park, WA"]').click();
  $('.km-row input').value = '15';
  $('.km-row input').dispatchEvent(new dom.window.Event('change'));
  $('[data-clear-home]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['onToggleStar', null],
    ['onUnstar', '1004'],
    ['onStarter', 1],
    ['onStarters', ['Is the {title} still available?', 'Cash today?', 'Can you hold it till Saturday?']],
    ['onStarters', ['Cash today?']],
    ['onSettings', { home: 'Victoria Park, WA' }],
    ['onSettings', { maxKm: 15 }],
    ['onSettings', { home: null, maxKm: null }],
  ]);

  // off a listing page: no tray, no star; empty shortlist hides the rail item
  view.render({ kind: 'browse', item: null, canStar: false, shortlist: [], compare: [] });
  assert.equal($('[data-listing-panel]').hidden, true);
  assert.equal($('[data-star]').hidden, true);
  assert.equal($('.tabs [data-open-shortlist]').hidden, true);
  assert.match($('[data-shortlist-hint]').textContent, /Star listings to compare them here/);
});

test('shell: compact mode for the mobile site, and starters render as text', () => {
  const { doc, MM } = mobile();
  const view = MM.ui.mount(doc, {}, { compact: true });
  assert.ok(view.shadow.querySelector('.root').classList.contains('compact'));
  view.render({
    settings: MM.filters.sanitiseSettings({}),
    kind: 'item',
    item: { title: '<img src=x onerror=alert(1)>', priceText: '' },
    starters: ['Is the {title} available?'],
  });
  assert.equal(view.shadow.querySelector('[data-starter] img'), null);
  assert.match(view.shadow.querySelector('[data-starter]').textContent, /<img/);
});
