// Builds extension/src/data/au-places.js: Australian suburb/locality centroids for strict distance.
//
// Source: GeoNames postal code export for Australia (https://download.geonames.org/export/zip/AU.zip),
// licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Credit: GeoNames, www.geonames.org.
//
//   curl -LO https://download.geonames.org/export/zip/AU.zip && unzip AU.zip AU.txt
//   node tools/build-places.mjs path/to/AU.txt
//
// The extension never fetches this or anything else: the table is bundled, and lookups are local.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/build-places.mjs path/to/AU.txt');
  process.exit(1);
}

// Postal facilities rather than places people live in.
const FACILITY = /\b(dc|po|gpo|bc|mc|lpo|delivery centre|mail centre|business centre|post office|parcel)$|delivery centre|mail centre/i;
const AMBIGUOUS_KM = 15; // same name in one state, centroids further apart than this = two different places

const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const groups = new Map(); // "STATE|Name" -> [{lat, lon, acc}]
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 12 || f[0] !== 'AU') continue;
  const name = f[2].replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  const state = f[4].trim();
  const lat = Number(f[9]);
  const lon = Number(f[10]);
  const acc = Number(f[11]) || 0;
  if (!name || !state || !Number.isFinite(lat) || !Number.isFinite(lon) || FACILITY.test(name)) continue;
  const key = state + '|' + name;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ lat, lon, acc });
}

const byState = new Map();
let kept = 0;
let ambiguous = 0;
for (const [key, rows] of groups) {
  const best = Math.max(...rows.map((r) => r.acc));
  const top = rows.filter((r) => r.acc === best);
  let spread = 0;
  for (const a of top) for (const b of top) spread = Math.max(spread, km([a.lat, a.lon], [b.lat, b.lon]));
  if (spread > AMBIGUOUS_KM) {
    ambiguous++;
    continue;
  }
  const lat = top.reduce((s, r) => s + r.lat, 0) / top.length;
  const lon = top.reduce((s, r) => s + r.lon, 0) / top.length;
  const [state, name] = key.split('|');
  if (!byState.has(state)) byState.set(state, []);
  byState.get(state).push(`${name},${Math.round(lat * 1000)},${Math.round(lon * 1000)}`);
  kept++;
}

const body = [...byState.keys()]
  .sort()
  .map((s) => [s, ...byState.get(s).sort((a, b) => a.localeCompare(b))].join('\n'))
  .join('\n');

const out = `/*
 * punnet — Australian suburb and locality centroids, for strict distance. GENERATED, do not edit:
 * node tools/build-places.mjs AU.txt
 *
 * Data: GeoNames postal code export for Australia, https://www.geonames.org (CC BY 4.0,
 * https://creativecommons.org/licenses/by/4.0/). Changes: postal facilities removed, one point per
 * name and state, names that mean two places more than ${AMBIGUOUS_KM} km apart in one state left out.
 *
 * Format: a state line ("WA"), then "Name,lat*1000,lon*1000" lines until the next state line.
 * ${kept} places (${ambiguous} ambiguous names left out).
 */
(function (root) {
  'use strict';
  const AU = ${JSON.stringify(body)};
  root.MarketMode = Object.assign(root.MarketMode || {}, { placeData: { AU } });
  if (typeof module === 'object' && module.exports) module.exports = { AU };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
writeFileSync(new URL('../extension/src/data/au-places.js', import.meta.url), out);
console.log(`au-places.js: ${kept} places, ${ambiguous} ambiguous left out, ${(out.length / 1024).toFixed(0)} KB`);
