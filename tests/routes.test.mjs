import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { buildRules } from '../tools/build-rules.mjs';

const require = createRequire(import.meta.url);
const routes = require('../extension/src/core/routes.js');

const REDIRECTED = [
  ['https://www.facebook.com/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/?sk=h_chr', 'https://www.facebook.com/marketplace/'],
  ['https://facebook.com/', 'https://facebook.com/marketplace/'],
  ['https://m.facebook.com/', 'https://m.facebook.com/marketplace/'],
  ['https://web.facebook.com/watch/?v=1', 'https://web.facebook.com/marketplace/'],
  ['https://www.facebook.com/home.php', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/watch', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/reel/123456', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/reels/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/stories/123/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/groups/feed/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/groups/123/permalink/9/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/gaming/', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/notifications', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/friends/requests', 'https://www.facebook.com/marketplace/'],
  ['https://www.facebook.com/events/?ref=bookmarks', 'https://www.facebook.com/marketplace/'],
];

const KEPT = [
  'https://www.facebook.com/marketplace/',
  'https://www.facebook.com/marketplace/perth/search/?query=desk',
  'https://www.facebook.com/marketplace/item/1234567890/',
  'https://www.facebook.com/marketplace/inbox/',
  'https://www.facebook.com/marketplace/you/saved/',
  'https://www.facebook.com/marketplace/profile/555/',
  'https://www.facebook.com/messages/t/1000/',
  'https://www.facebook.com/messages/',
  'https://www.facebook.com/login/?next=%2Fmarketplace%2F',
  'https://www.facebook.com/checkpoint/block/',
  'https://www.facebook.com/settings/',
  'https://www.facebook.com/help/',
  'https://www.facebook.com/profile.php?id=4',
  'https://www.facebook.com/watchmaker.perth', // a Page whose name only starts with "watch"
  'https://www.facebook.com/groupsforgood', // ditto "groups"
  'https://www.messenger.com/',
  'https://example.com/',
  'http://www.facebook.com/watch/', // not https: the DNR rule is https-only, so the guard agrees
  'not a url',
];

test('distraction routes go to Marketplace on the same host', () => {
  for (const [from, to] of REDIRECTED) assert.equal(routes.redirectTarget(from), to, from);
});

test('Marketplace, Messenger, login and account routes are never redirected', () => {
  for (const url of KEPT) assert.equal(routes.redirectTarget(url), null, url);
});

test('declarativeNetRequest rule and the in-page guard agree on every case', () => {
  const rules = JSON.parse(readFileSync(new URL('../extension/rules/redirects.json', import.meta.url), 'utf8'));
  const compiled = rules.map((r) => ({
    re: new RegExp(r.condition.regexFilter),
    sub: r.action.redirect.regexSubstitution.replace(/\\(\d)/g, (_, n) => '$' + n),
  }));
  for (const [from, to] of REDIRECTED) {
    const hits = compiled.filter((c) => c.re.test(from));
    assert.equal(hits.length, 1, 'exactly one rule should match ' + from);
    assert.equal(from.replace(hits[0].re, hits[0].sub), to, from);
  }
  for (const url of KEPT) assert.ok(!compiled.some((c) => c.re.test(url)), 'no rule may match ' + url);
  for (const r of rules) {
    assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
    assert.equal(r.condition.regexFilter.split('|').length, 3, 'one section per rule (Chrome RE2 memory cap)');
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'unique rule ids');
});

test('committed rules file is generated from the route table', () => {
  const committed = JSON.parse(readFileSync(new URL('../extension/rules/redirects.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, buildRules(), 'run: npm run build:rules');
});

test('pageKind classifies Marketplace pages', () => {
  const k = routes.pageKind;
  assert.equal(k('https://www.facebook.com/marketplace/'), 'browse');
  assert.equal(k('https://www.facebook.com/marketplace/perth/'), 'browse');
  assert.equal(k('https://www.facebook.com/marketplace/search/?query=x'), 'search');
  assert.equal(k('https://www.facebook.com/marketplace/perth/search?query=x'), 'search');
  assert.equal(k('https://www.facebook.com/marketplace/category/furniture/'), 'category');
  assert.equal(k('https://www.facebook.com/marketplace/item/42/'), 'item');
  assert.equal(k('https://www.facebook.com/marketplace/you/saved/'), 'saved');
  assert.equal(k('https://www.facebook.com/marketplace/inbox/'), 'inbox');
  assert.equal(k('https://www.facebook.com/marketplace/profile/9/'), 'seller');
  assert.equal(k('https://www.facebook.com/messages/t/1/'), 'messages');
  assert.equal(k('https://www.facebook.com/settings/'), 'other');
  assert.equal(k('https://example.com/marketplace/'), 'none');
});

test('itemIdFromHref reads listing ids', () => {
  assert.equal(routes.itemIdFromHref('/marketplace/item/123456/?ref=search'), '123456');
  assert.equal(routes.itemIdFromHref('https://www.facebook.com/marketplace/item/9/'), '9');
  assert.equal(routes.itemIdFromHref('/marketplace/'), null);
});

test('search pages get newest-first and price params, only where absent', () => {
  const s = { newestFirst: true, minPrice: 50, maxPrice: 400 };
  const out = new URL(routes.withBuyerParams('https://www.facebook.com/marketplace/perth/search/?query=desk', s));
  assert.equal(out.searchParams.get('sortBy'), 'creation_time_descend');
  assert.equal(out.searchParams.get('minPrice'), '50');
  assert.equal(out.searchParams.get('maxPrice'), '400');
  assert.equal(out.searchParams.get('query'), 'desk');
  // already complete: nothing to do, so no reload loop
  assert.equal(routes.withBuyerParams(out.href, s), null);
  // a choice made in Facebook's own UI wins
  assert.equal(
    routes.withBuyerParams('https://www.facebook.com/marketplace/search/?query=x&sortBy=price_ascend&minPrice=1&maxPrice=2', s),
    null
  );
  // the browse feed can't be sorted server-side: untouched
  assert.equal(routes.withBuyerParams('https://www.facebook.com/marketplace/', s), null);
  assert.equal(
    routes.withBuyerParams('https://www.facebook.com/marketplace/search/?query=x', { newestFirst: false, minPrice: null, maxPrice: null }),
    null
  );
});

test('searchUrl builds a Marketplace search', () => {
  const url = new URL(routes.searchUrl('  oak table ', { newestFirst: true }, 'https://www.facebook.com'));
  assert.equal(url.pathname, '/marketplace/search/');
  assert.equal(url.searchParams.get('query'), 'oak table');
  assert.equal(url.searchParams.get('sortBy'), 'creation_time_descend');
});
