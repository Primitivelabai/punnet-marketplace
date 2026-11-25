// Live check against the real Facebook Marketplace (read-only, a fresh browser profile).
// Opens facebook.com with the extension loaded and reports what punnet found on the real page.
// It never signs in, types credentials, clicks listings or sends anything.
//
//   node tools/live-check.mjs [city-slug]        e.g. perth (default), sydney, nyc
//   MM_BROWSER=msedge|chrome|chromium            browser channel (default msedge)
//   MM_PROFILE=<dir>                             reuse a profile you signed into by hand, to check
//                                                logged-in pages (Inbox, Saved, Message seller)
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../extension/', import.meta.url));
const OUT = fileURLToPath(new URL('../smoke-out/', import.meta.url));
const city = process.argv[2] || 'perth';
mkdirSync(OUT, { recursive: true });

const headless = !process.env.MM_PROFILE;
const ctx = await chromium.launchPersistentContext(process.env.MM_PROFILE || mkdtempSync(join(tmpdir(), 'mm-live-')), {
  channel: process.env.MM_BROWSER || 'msedge',
  headless,
  viewport: { width: 1366, height: 900 },
  locale: 'en-AU',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();

const report = {};
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
report.homeRedirectedTo = new URL(page.url()).pathname;

await page.goto(`https://www.facebook.com/marketplace/${city}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
// Facebook shows a sign-in prompt to logged-out visitors; close it if it offers a close button.
const close = page.locator('[aria-label="Close"]').first();
if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
await page.mouse.wheel(0, 1500);
await page.waitForTimeout(2500);
await page.mouse.wheel(0, -1500);
await page.waitForTimeout(800);

Object.assign(
  report,
  await page.evaluate(() => ({
    url: location.pathname,
    shellMounted: !!document.querySelector('[data-mm-ui="shell"]'),
    htmlClasses: document.documentElement.className,
    fbBarTagged: !!document.querySelector('[data-mm="fb-bar"]'),
    fbSideTagged: !!document.querySelector('[data-mm="fb-side"]'),
    listingLinks: document.querySelectorAll('a[href*="/marketplace/item/"]').length,
    cardsTagged: document.querySelectorAll('[data-mm-card]').length,
    cardsHidden: document.querySelectorAll('[data-mm-hide]').length,
    sample: [...document.querySelectorAll('[data-mm-card]')].slice(0, 5).map((c) => {
      const a = c.querySelector('a[href*="/marketplace/item/"]');
      return (a ? a.innerText : '').split('\n').filter(Boolean).slice(0, 4).join(' | ');
    }),
  }))
);
await page.screenshot({ path: join(OUT, 'live-marketplace.png') });

// Strict distance against real place names: set a home suburb (local storage only) and see how many
// real cards get a distance, and which place names the bundled table doesn't know.
const home = process.env.MM_HOME || 'Perth, WA';
const [sw] = ctx.serviceWorkers();
await sw.evaluate(async (home) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: Object.assign({}, settings, { home }) });
}, home);
await page.waitForTimeout(1500);
report.distance = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mm-card]')];
  const withKm = cards.filter((c) => c.querySelector('[data-mm-badge="km"]'));
  const unknown = cards
    .filter((c) => !c.querySelector('[data-mm-badge="km"]'))
    .map(
      (c) =>
        (c.getAttribute('data-mm-hide') ? `[hidden: ${c.getAttribute('data-mm-hide')}] ` : '') +
        (c.querySelector('a[href*="/marketplace/item/"]') || c).innerText.split('\n').filter(Boolean).join(' | ')
    );
  return { home: null, cards: cards.length, withKm: withKm.length, sampleKm: withKm.slice(0, 4).map((c) => c.querySelector('[data-mm-badge="km"]').textContent), unknownPlaces: [...new Set(unknown)].slice(0, 8) };
});
report.distance.home = home;
console.log(JSON.stringify(report, null, 2));
await ctx.close();

// The mobile site (m.facebook.com), as an iPhone would see it: the iPhone/Safari path.
if (process.env.MM_SKIP_MOBILE !== '1') {
  const mctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-live-m-')), {
    channel: process.env.MM_BROWSER || 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'en-AU',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  if (!mctx.serviceWorkers().length) await mctx.waitForEvent('serviceworker');
  const [msw] = mctx.serviceWorkers();
  const mp = await mctx.newPage();
  const mobile = {};
  await mp.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded' });
  mobile.homeRedirectedTo = new URL(mp.url()).host + new URL(mp.url()).pathname;
  await mp.goto(`https://m.facebook.com/marketplace/${city}/`, { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(5000);
  // set the home suburb after the install-time defaults have been written
  await msw.evaluate(async (home) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: Object.assign({}, settings, { home }) });
  }, home);
  await mp.waitForTimeout(2000);
  Object.assign(
    mobile,
    await mp.evaluate(() => ({
      shellMounted: !!document.querySelector('[data-mm-ui="shell"]'),
      compact: !!document.querySelector('[data-mm-ui="shell"]')?.shadowRoot.querySelector('.root.compact'),
      cardsTagged: document.querySelectorAll('[data-mm-card]').length,
      cardsHidden: document.querySelectorAll('[data-mm-card][data-mm-hide]').length,
      hiddenWhy: [...document.querySelectorAll('[data-mm-card][data-mm-hide]')].map((c) => c.getAttribute('data-mm-hide')),
      withKm: document.querySelectorAll('[data-mm-card] [data-mm-badge="km"]').length,
      sample: [...document.querySelectorAll('[data-mm-card]')].slice(0, 5).map((c) =>
        [...c.querySelectorAll('[data-mcomponent="ServerTextArea"]')].map((t) => t.textContent.trim()).join(' | ') +
        ' | ' + ((c.querySelector('[data-mm-badge="km"]') || {}).textContent || '?')
      ),
    }))
  );
  await mp.screenshot({ path: join(OUT, 'live-mobile-site.png') });
  console.log(JSON.stringify({ mobileSite: mobile }, null, 2));
  await mctx.close();
}
