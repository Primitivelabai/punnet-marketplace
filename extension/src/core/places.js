/*
 * punnet — places and strict distance. Pure functions over the bundled suburb table
 * (src/data/au-places.js). No geocoding service, no network: a place either is in the table or is
 * "unknown", and unknown places are never filtered out.
 */
(function (root) {
  'use strict';

  const STATES = Object.freeze({
    wa: 'WA', 'western australia': 'WA',
    nsw: 'NSW', 'new south wales': 'NSW',
    vic: 'VIC', victoria: 'VIC',
    qld: 'QLD', queensland: 'QLD',
    sa: 'SA', 'south australia': 'SA',
    tas: 'TAS', tasmania: 'TAS',
    act: 'ACT', 'australian capital territory': 'ACT',
    nt: 'NT', 'northern territory': 'NT',
  });

  let cache = null; // { byKey: Map(norm|STATE -> {name, state, lat, lon}), byName: Map(norm -> entry|null), list: [] }

  function getData() {
    const d = root.MarketMode && root.MarketMode.placeData;
    if (d && d.AU) return d.AU;
    if (typeof require === 'function') {
      try {
        return require('../data/au-places.js').AU;
      } catch {
        return '';
      }
    }
    return '';
  }

  /** Lower-case, no accents or punctuation, "saint" as "st", single spaces. */
  function norm(s) {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[’'`.]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bsaint\b/g, 'st')
      .replace(/\bmount\b/g, 'mt')
      .trim();
  }

  function index() {
    if (cache) return cache;
    const byKey = new Map();
    const byName = new Map();
    const list = [];
    let state = '';
    for (const line of getData().split('\n')) {
      if (!line.includes(',')) {
        state = line.trim();
        continue;
      }
      const [name, lat, lon] = line.split(',');
      const entry = { name, state, lat: Number(lat) / 1000, lon: Number(lon) / 1000, key: norm(name) };
      byKey.set(entry.key + '|' + state, entry);
      // A bare name ("Richmond") only resolves if it means one place in all of Australia.
      byName.set(entry.key, byName.has(entry.key) ? null : entry);
      list.push(entry);
    }
    cache = { byKey, byName, list };
    return cache;
  }

  /**
   * A card's location line ("Fremantle, WA", "Fremantle, Western Australia", "Fremantle") to a place.
   * Returns {name, state, lat, lon} or null when the table doesn't know it (or it's ambiguous).
   */
  function resolve(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const { byKey, byName } = index();
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const st = STATES[norm(parts[parts.length - 1])];
      if (st) return byKey.get(norm(parts.slice(0, -1).join(' ')) + '|' + st) || null;
      if (parts.length > 2) return null;
    }
    return byName.get(norm(parts[0])) || null;
  }

  /** Great-circle distance in km between two {lat, lon}. */
  function distanceKm(a, b) {
    if (!a || !b) return null;
    const r = (d) => (d * Math.PI) / 180;
    const h =
      Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** "Fremantle, WA" for an entry. */
  function label(p) {
    return p ? `${p.name}, ${p.state}` : '';
  }

  /** Up to n places whose name starts with the query (then contains it), for the home picker. */
  function suggest(query, n) {
    const q = norm(String(query || '').split(',')[0]);
    if (q.length < 2) return [];
    const max = n || 6;
    const starts = [];
    const contains = [];
    for (const p of index().list) {
      if (p.key.startsWith(q)) starts.push(p);
      else if (contains.length < max && p.key.includes(' ' + q)) contains.push(p);
    }
    starts.sort((a, b) => a.key.length - b.key.length || a.key.localeCompare(b.key));
    return starts.concat(contains).slice(0, max).map(label);
  }

  /** Display distance. Suburb centres are only good to about a kilometre, so no metres. */
  function formatKm(km) {
    if (km == null || !Number.isFinite(km)) return '';
    if (km < 1) return '< 1 km';
    return Math.round(km) + ' km';
  }

  const api = { STATES, norm, resolve, distanceKm, suggest, label, formatKm };
  root.MarketMode = Object.assign(root.MarketMode || {}, { places: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
