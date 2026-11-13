// Renders the punnet mark to the PNG sizes Chrome needs, using Playwright's Chromium.
// The shipped PNGs in extension/icons are the pixel-exact brand set. Only rerun this if the mark changes.
// 16 px is the bare mark (below 24 px it goes without a tile); 32, 48 and 128 use the oat store tile.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect x="2" y="0" width="1" height="1" fill="#4f7a3a"/><rect x="1" y="1" width="2" height="2" fill="#d23b2a"/><g fill="#3d4a9e"><rect x="5" y="1" width="1" height="1"/><rect x="4" y="2" width="3" height="1"/></g><rect x="0" y="3" width="8" height="1" fill="#7a4a22"/><rect x="0" y="4" width="8" height="2" fill="#c98f52"/><rect x="1" y="6" width="6" height="1" fill="#c98f52"/><rect x="1" y="7" width="6" height="1" fill="#7a4a22"/><g fill="#7a4a22"><rect x="1" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/></g></svg>`;
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="punnet"><rect width="128" height="128" rx="28" fill="#f4efe6"/><g transform="translate(24 24) scale(10)" shape-rendering="crispEdges"><rect x="2" y="0" width="1" height="1" fill="#4f7a3a"/><rect x="1" y="1" width="2" height="2" fill="#d23b2a"/><g fill="#3d4a9e"><rect x="5" y="1" width="1" height="1"/><rect x="4" y="2" width="3" height="1"/></g><rect x="0" y="3" width="8" height="1" fill="#7a4a22"/><rect x="0" y="4" width="8" height="2" fill="#c98f52"/><rect x="1" y="6" width="6" height="1" fill="#c98f52"/><rect x="1" y="7" width="6" height="1" fill="#7a4a22"/><g fill="#7a4a22"><rect x="1" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/></g></g></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const svg = (size < 24 ? MARK : TILE).replace(/<svg /, `<svg width="${size}" height="${size}" `).replace(/ width="128" height="128"/, '');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const png = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(new URL(`../extension/icons/icon-${size}.png`, import.meta.url), png);
  console.log('icon', size);
}
await browser.close();
