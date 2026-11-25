// End-to-end: the real unpacked extension in a real Chromium browser.
// www.facebook.com is mapped (inside this browser only) to a local HTTPS server that serves
// fixtures, so no traffic reaches Facebook, while Chrome's own redirect rules, the in-app guard,
// the shell UI, filters and seller messaging all run exactly as they do for a real person.
// Run: npm run test:e2e   (MM_BROWSER=msedge|chrome|chromium, default chromium)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const OUT = fileURLToPath(new URL('../../smoke-out/', import.meta.url));
const fixture = (n) => readFileSync(new URL('../fixtures/' + n, import.meta.url), 'utf8');
const FEED = '<!doctype html><title>Facebook</title><h1 id="feed">News Feed</h1>';

let context;
let page;
let server;
let work;
const served = [];
// Search results that change between visits: bump searchGen[query] to "list" new items.
const searchGen = {};
function searchPage(q) {
  const gen = searchGen[q] || 0;
  const base = 5000 + [...q].reduce((a, ch) => a + ch.charCodeAt(0), 0) * 10;
  const cells = [];
  for (let g = 0; g <= gen; g++) {
    for (let i = 0; i < 2; i++) {
      const id = base * 100 + g * 10 + i;
      cells.push(`<div class="cell"><div><a href="/marketplace/item/${id}/"><div class="img"></div><div><span>A$${40 + g * 10 + i}</span></div><div><span>${q} no.${g}-${i}</span></div><div><span>Perth, WA</span></div></a></div></div>`);
    }
  }
  return `<!doctype html><title>Search</title><div role="banner"></div><div role="main" style="padding-top:56px"><div class="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${cells.reverse().join('')}</div></div>`;
}

function selfSignedCert(dir) {
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=www.facebook.com',
    '-addext', 'subjectAltName=DNS:www.facebook.com,DNS:facebook.com,DNS:m.facebook.com', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

before(async () => {
  mkdirSync(OUT, { recursive: true });
  work = mkdtempSync(join(tmpdir(), 'mm-e2e-'));
  server = createServer(selfSignedCert(work), (req, res) => {
    const url = new URL(req.url, 'https://www.facebook.com');
    served.push(url.pathname);
    let body = FEED;
    const mobileSite = /^m\.facebook\.com/.test(req.headers.host || '');
    if (mobileSite && url.pathname.startsWith('/marketplace/')) body = fixture('m-marketplace.html');
    else if (url.pathname.startsWith('/marketplace/item/')) body = fixture('item.html');
    else if (/^\/marketplace\/(?:[^/]+\/)?search\/?$/.test(url.pathname)) body = searchPage((url.searchParams.get('query') || '').toLowerCase());
    else if (url.pathname.startsWith('/marketplace/')) body = fixture('marketplace.html');
    else if (url.pathname.startsWith('/messages/')) body = '<!doctype html><title>Messenger</title><div role="banner"></div><h1 id="messenger">Chats</h1>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  context = await chromium.launchPersistentContext(join(work, 'profile'), {
    channel: process.env.MM_BROWSER || 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 860 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP www.facebook.com 127.0.0.1:${port},MAP m.facebook.com 127.0.0.1:${port},MAP facebook.com 127.0.0.1:${port},MAP *.facebook.com ~NOTFOUND,MAP *.fbcdn.net ~NOTFOUND`,
      '--ignore-certificate-errors',
    ],
  });
  // wait for the service worker so the redirect ruleset is live
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
  page = context.pages()[0] || (await context.newPage());
  // first install opens Marketplace in a new tab; close extras for a clean run
  await new Promise((r) => setTimeout(r, 800));
  for (const p of context.pages()) if (p !== page) await p.close();
});

after(async () => {
  await context?.close();
  server?.close();
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // Windows may hold the profile briefly; the OS cleans temp.
  }
});

const shell = () => page.locator('[data-mm-ui="shell"]');
async function ready() {
  await page.waitForSelector('[data-mm-ui="shell"]', { state: 'attached' });
  await page.waitForSelector('[data-mm-card]', { state: 'attached' });
}

test('Chrome accepts every redirect rule (RE2 limits)', async () => {
  const [sw] = context.serviceWorkers();
  const rules = JSON.parse(readFileSync(join(EXT, 'rules/redirects.json'), 'utf8'));
  for (const r of rules) {
    const res = await sw.evaluate((regex) => chrome.declarativeNetRequest.isRegexSupported({ regex }), r.condition.regexFilter);
    assert.deepEqual(res, { isSupported: true }, r.condition.regexFilter);
  }
});

test('facebook.com (the feed) opens Marketplace instead — at the network layer', async () => {
  served.length = 0;
  await page.goto('https://www.facebook.com/');
  assert.equal(new URL(page.url()).pathname, '/marketplace/');
  assert.ok(!served.includes('/'), 'the feed was never requested: ' + served.join(','));
  assert.ok(served.includes('/marketplace/'));
  await page.goto('https://www.facebook.com/watch/?v=123');
  assert.equal(new URL(page.url()).pathname, '/marketplace/');
});

test('Marketplace shows the punnet shell instead of Facebook chrome', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  assert.equal(await page.evaluate(() => document.documentElement.className.includes('mm-shell')), true);
  assert.equal(await page.locator('[role=banner]').evaluate((el) => getComputedStyle(el).visibility), 'hidden');
  assert.equal(await page.locator('[data-mm="fb-side"]').isVisible(), false);
  await assert.doesNotReject(shell().locator('.brand').waitFor());
  await page.screenshot({ path: join(OUT, 'marketplace-desktop.png') });
});

test('default filters hide sold listings and show the hidden pill', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await page.waitForSelector('[data-mm-card="1003"][data-mm-hide="sold"]', { state: 'attached' });
  assert.equal(await page.locator('[data-mm-card="1003"]').isVisible(), false);
  assert.equal(await page.locator('[data-mm-card="1001"]').isVisible(), true);
  // junk: wanted post, $1,234 placeholder, same-page duplicate, and the sponsored tile
  for (const id of ['1009', '1010', '1011']) {
    assert.equal(await page.locator(`[data-mm-card="${id}"]`).getAttribute('data-mm-hide'), 'junk', id);
  }
  assert.equal(await page.locator('#ad').isVisible(), false);
  assert.match(await shell().locator('.pill').innerText(), /5 hidden/);
});

test('links into distractions are caught during in-app navigation', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  // a Facebook link to Groups, clicked inside the page
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = '/groups/123/';
    a.id = 'to-groups';
    a.textContent = 'Groups';
    document.querySelector('[role=main]').prepend(a);
  });
  await Promise.all([page.waitForURL('**/marketplace/'), page.click('#to-groups')]);
  // Facebook's router doing pushState to Reels
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await Promise.all([page.waitForURL('**/marketplace/'), page.evaluate(() => history.pushState({}, '', '/reel/42'))]);
});

test('searching from the bar opens a newest-first Marketplace search', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await shell().locator('.search input').fill('oak table');
  await Promise.all([page.waitForURL(/\/marketplace\/search\//), shell().locator('.search input').press('Enter')]);
  const url = new URL(page.url());
  assert.equal(url.searchParams.get('query'), 'oak table');
  assert.equal(url.searchParams.get('sortBy'), 'creation_time_descend');
});

test('listing page keeps Facebook’s seller messaging working, and records the listing as opened', async () => {
  await page.goto('https://www.facebook.com/marketplace/item/1001/');
  await page.waitForSelector('[data-mm-ui="shell"]', { state: 'attached' });
  await page.click('#message-seller');
  assert.equal(await page.evaluate(() => document.body.dataset.messageClicked), 'yes');
  await page.fill('#message-box', 'Hi! Is this still available?');
  assert.equal(await page.inputValue('#message-box'), 'Hi! Is this still available?');
  // the seller's Marketplace profile is reachable; a Groups link is not
  assert.equal(await page.locator('a[href="/marketplace/profile/555/"]').isVisible(), true);
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await page.waitForSelector('[data-mm-card="1001"][data-mm-seen]', { state: 'attached' });
  assert.equal(await page.locator('[data-mm-card="1001"] [data-mm-badge="seen"]').isVisible(), true);
});

test('listing page shows trust signals that explain themselves', async () => {
  await page.goto('https://www.facebook.com/marketplace/item/1001/');
  await page.waitForSelector('[data-mm-ui="shell"]', { state: 'attached' });
  const panel = shell().locator('[data-signals]');
  await panel.waitFor({ state: 'visible' });
  const keys = await shell().locator('[data-signal]').evaluateAll((els) => els.map((e) => e.getAttribute('data-signal')));
  assert.deepEqual(keys, ['off-platform', 'pay-first', 'new-profile']);
  await page.screenshot({ path: join(OUT, 'trust-signals.png') });
});

test('watched searches: Watch, then Catch up gathers only what is new, across searches', async () => {
  // look at two searches once (so their current results count as seen) and watch them
  for (const q of ['desk', 'lamp']) {
    await page.goto(`https://www.facebook.com/marketplace/search/?query=${q}`);
    await page.waitForSelector('[data-mm-card]', { state: 'attached' });
    await shell().locator('[data-watch]').click();
    await shell().locator('[data-watch]').waitFor({ state: 'hidden' });
  }
  await page.waitForTimeout(1800); // let "seen" memory flush to storage

  // sellers list new things
  searchGen.desk = 1;
  searchGen.lamp = 1;

  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  assert.match(await shell().locator('[data-catchup]').innerText(), /Catch up\s*2/);
  served.length = 0;
  await shell().locator('[data-catchup]').click();
  // Catch up visits each watched search in this tab, then shows the results
  await shell().locator('[data-results]').waitFor({ state: 'visible', timeout: 30000 });
  const titles = await shell().locator('[data-results-list] li').allInnerTexts();
  assert.equal(titles.length, 4, titles.join(' / '));
  assert.ok(titles.every((t) => /no\.1-/.test(t)), 'only the newly listed items: ' + titles.join(' / '));
  assert.equal(served.filter((p) => p.includes('search')).length, 2, 'one visible load per watched search');
  await page.screenshot({ path: join(OUT, 'catch-up-results.png') });
  await shell().locator('[data-clear-results]').click();
  await shell().locator('[data-results]').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
});

test('Messenger stays reachable', async () => {
  await page.goto('https://www.facebook.com/messages/t/1000/');
  assert.equal(new URL(page.url()).pathname, '/messages/t/1000/');
  await page.waitForSelector('#messenger');
});

test('hiding a listing persists, and Undo brings it back', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await page.hover('[data-mm-card="1007"]');
  await page.click('[data-mm-card="1007"] [data-mm-act="hide"]');
  await page.waitForSelector('[data-mm-card="1007"][data-mm-hide="hidden"]', { state: 'attached' });
  assert.match(await shell().locator('.toast').innerText(), /Listing hidden/);
  await page.reload();
  await ready();
  await page.waitForSelector('[data-mm-card="1007"][data-mm-hide="hidden"]', { state: 'attached' });
  await page.hover('[data-mm-card="1001"]');
  await page.click('[data-mm-card="1001"] [data-mm-act="hide"]');
  await shell().locator('[data-toast-action]').click();
  await page.waitForFunction(() => !document.querySelector('[data-mm-card="1001"]').hasAttribute('data-mm-hide'));
});

test('filters sheet: leave-out words apply live', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await shell().locator('.filters-btn').click();
  await shell().locator('[data-word-form] input').fill('broken');
  await shell().locator('[data-word-form] input').press('Enter');
  await page.waitForSelector('[data-mm-card="1002"][data-mm-hide="keyword"]', { state: 'attached' });
  await page.screenshot({ path: join(OUT, 'filters-sheet.png') });
  await page.keyboard.press('Escape');
  assert.equal(await shell().locator('.sheet').evaluate((el) => el.classList.contains('on')), false);
});

test('location button opens Facebook’s own location panel as a drawer', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await shell().locator('.filters-btn').click();
  await shell().locator('[data-open-location]').click();
  await page.locator('#fb-location').waitFor({ state: 'visible' });
});

test('mobile layout uses the bottom tab bar', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  assert.equal(await shell().locator('.tabbar').isVisible(), true);
  assert.equal(await shell().locator('.tabs').isVisible(), false);
  await page.screenshot({ path: join(OUT, 'marketplace-mobile.png') });
  await shell().locator('.tabbar [data-open-sheet]').click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, 'filters-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('shortlist: star from the grid and from a listing, then compare side by side', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  for (const id of ['1004', '1005']) {
    await page.hover(`[data-mm-card="${id}"]`);
    await page.click(`[data-mm-card="${id}"] [data-mm-act="star"]`);
    await page.waitForSelector(`[data-mm-card="${id}"] [data-mm-act="star"][aria-pressed="true"]`, { state: 'attached' });
  }
  assert.match(await shell().locator('.toast').innerText(), /Added to your shortlist/);
  assert.equal(new URL(page.url()).pathname, '/marketplace/perth/', 'starring never opens the listing');

  // star from the listing page itself: its hints come along
  await page.goto('https://www.facebook.com/marketplace/item/1001/');
  await shell().locator('[data-star]').waitFor({ state: 'visible' });
  await shell().locator('[data-star]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-mm-ui="shell"]').shadowRoot.querySelector('[data-star]').getAttribute('aria-pressed') === 'true'
  );
  await shell().locator('.tabs [data-open-shortlist]').click();
  await shell().locator('[data-compare-item="1001"] [data-tone="warn"]').first().waitFor();
  const cols = await shell().locator('[data-compare-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-compare-item')));
  assert.deepEqual(cols, ['1001', '1005', '1004']);
  assert.equal(await shell().locator('[data-compare-item="1005"] [data-best="price"]').count(), 1, 'cheapest marked');
  await page.waitForTimeout(350); // let the sheet finish sliding in
  await page.screenshot({ path: join(OUT, 'shortlist-compare.png') });
  await page.keyboard.press('Escape');
});

test('message starter fills Facebook’s seller box; the person presses Send', async () => {
  await page.goto('https://www.facebook.com/marketplace/item/1001/');
  await shell().locator('[data-starters]').waitFor({ state: 'visible' });
  const labels = await shell().locator('[data-starter]').allInnerTexts();
  assert.equal(labels[1], 'Hi, is the Oak dining table still available? I can pick up today, cash.');
  served.length = 0;
  await shell().locator('[data-starter="1"]').click();
  assert.equal(await page.inputValue('#message-box'), labels[1]);
  assert.match(await shell().locator('.toast').innerText(), /press Send/);
  assert.equal(await page.evaluate(() => document.body.dataset.messageClicked), undefined, 'nothing pressed for them');
  assert.deepEqual(served, [], 'nothing sent anywhere');
  await page.screenshot({ path: join(OUT, 'message-starters.png') });
});

test('strict distance: pick a home suburb, set a radius, far listings hide and cards show km', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await shell().locator('.filters-btn').click();
  await shell().locator('[data-home-form] input').fill('Fremant');
  await shell().locator('[data-pick-home="Fremantle, WA"]').click();
  await shell().locator('.km-row input').fill('20');
  await shell().locator('.km-row input').press('Tab');
  await page.waitForSelector('[data-mm-card="1004"][data-mm-hide="distance"]', { state: 'attached' });
  assert.equal(await page.locator('[data-mm-card="1001"] [data-mm-badge="km"]').innerText(), '< 1 km');
  assert.equal(await page.locator('[data-mm-card="1007"] [data-mm-badge="km"]').innerText(), '16 km', 'Victoria Park');
  assert.match(await shell().locator('[data-distance-status]').innerText(), /From Fremantle, WA · within 20 km/);
  await page.screenshot({ path: join(OUT, 'distance.png') });
  await shell().locator('[data-clear-home]').click();
  await page.waitForFunction(() => !document.querySelector('[data-mm-card="1004"]').hasAttribute('data-mm-hide'));
  await page.keyboard.press('Escape');
});

test('mobile site (m.facebook.com): redirects, filters and card controls, with a compact shell', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://m.facebook.com/');
  assert.equal(new URL(page.url()).pathname, '/marketplace/');
  assert.equal(new URL(page.url()).hostname, 'm.facebook.com');
  await page.goto('https://m.facebook.com/marketplace/perth/');
  await ready();
  assert.equal(await page.locator('[data-mm-card]').count(), 6);
  assert.equal(await page.locator('[data-action-id="304"]').getAttribute('data-mm-hide'), 'junk', 'WANTED post');
  assert.equal(await page.locator('[data-action-id="304"]').isVisible(), false);
  assert.equal(await shell().locator('.tabbar').isVisible(), true);
  assert.equal(await shell().locator('.bar').isVisible(), false, 'Facebook keeps its own top bar here');
  // our buttons on a card never trigger Facebook's tap-to-open
  await page.click('[data-action-id="301"] [data-mm-act="star"]');
  await page.waitForSelector('[data-action-id="301"] [data-mm-act="star"][aria-pressed="true"]', { state: 'attached' });
  await page.click('[data-action-id="306"] [data-mm-act="hide"]');
  await page.waitForSelector('[data-action-id="306"][data-mm-hide="hidden"]', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.body.dataset.cardTapped), undefined);
  await page.screenshot({ path: join(OUT, 'mobile-site.png') });
  await page.setViewportSize({ width: 1280, height: 860 });
});

test('pausing restores plain Facebook, including the feed', async () => {
  await page.goto('https://www.facebook.com/marketplace/perth/');
  await ready();
  await shell().locator('.filters-btn').click();
  await shell().locator('.sheet [data-pause]').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('mm-on'));
  assert.equal(await page.locator('[role=banner]').evaluate((el) => getComputedStyle(el).visibility), 'visible');
  await page.waitForTimeout(300); // service worker disables the ruleset
  await page.goto('https://www.facebook.com/');
  assert.equal(new URL(page.url()).pathname, '/');
  await page.waitForSelector('#feed');
});
