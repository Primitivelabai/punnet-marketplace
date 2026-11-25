/*
 * punnet — shortlist and compare. Pure functions, no DOM, no network.
 * The shortlist is punnet's own (chrome.storage.local), separate from Facebook's Saved.
 */
(function (root) {
  'use strict';

  const MAX = 40;
  const FIELDS = ['id', 'href', 'title', 'priceText', 'price', 'img', 'location'];

  function getMemory() {
    return (root.MarketMode && root.MarketMode.memory) || (typeof require === 'function' ? require('./memory.js') : null);
  }
  function getPlaces() {
    return (root.MarketMode && root.MarketMode.places) || (typeof require === 'function' ? require('./places.js') : null);
  }

  function clean(entry) {
    const out = {};
    for (const k of FIELDS) {
      const v = entry[k];
      if (k === 'price') out.price = typeof v === 'number' && Number.isFinite(v) ? v : null;
      else out[k] = v == null ? null : String(v).slice(0, 300);
    }
    // Only Facebook's own CDN photos over https are kept (shown with no referrer).
    if (out.img && !/^https:\/\//.test(out.img)) out.img = null;
    if (out.href && !/^\/marketplace\/item\/\d+\/?$/.test(out.href)) out.href = null;
    return out;
  }

  function has(list, id) {
    return (Array.isArray(list) ? list : []).some((e) => e.id === id);
  }

  /** Add (or remove, if already there) a listing. Newest first, capped at MAX. */
  function toggle(list, entry, now) {
    const cur = Array.isArray(list) ? list : [];
    if (!entry || !entry.id) return cur;
    if (has(cur, entry.id)) return cur.filter((e) => e.id !== entry.id);
    const next = [Object.assign(clean(entry), { added: now || Date.now(), signals: null }), ...cur];
    return next.slice(0, MAX);
  }

  function remove(list, id) {
    return (Array.isArray(list) ? list : []).filter((e) => e.id !== id);
  }

  /**
   * Refresh what we know about a shortlisted listing (its page was opened). Returns the same list
   * object if nothing changed, so callers can skip a storage write.
   */
  function update(list, id, patch, now) {
    const cur = Array.isArray(list) ? list : [];
    const i = cur.findIndex((e) => e.id === id);
    if (i < 0) return cur;
    const prev = cur[i];
    const next = Object.assign({}, prev);
    for (const k of FIELDS) if (k !== 'id' && patch[k] != null && patch[k] !== '') next[k] = clean(Object.assign({}, prev, patch))[k];
    if (Array.isArray(patch.signals)) {
      next.signals = patch.signals.slice(0, 8).map((s) => ({ key: String(s.key), tone: String(s.tone), label: String(s.label) }));
      next.signalsAt = now || Date.now();
    }
    const same = JSON.stringify(Object.assign({}, prev, { signalsAt: 0 })) === JSON.stringify(Object.assign({}, next, { signalsAt: 0 }));
    if (same) return cur;
    const out = cur.slice();
    out[i] = next;
    return out;
  }

  /**
   * Rows for the compare view, one per shortlisted listing, with what punnet knows:
   * price and drop (price memory), how long it's been around (first seen), distance from home,
   * and the trust hints from its listing page (if opened since it was starred).
   * ctx: { prices, seen, home: {lat, lon}|null, now }
   */
  function compare(list, ctx) {
    const mem = getMemory();
    const places = getPlaces();
    const c = ctx || {};
    const prices = c.prices || {};
    const seen = c.seen || {};
    const now = c.now || Date.now();
    const rows = (Array.isArray(list) ? list : []).map((e) => {
      const p = prices[e.id];
      const price = p && p.p != null ? p.p : e.price;
      const drop = mem.priceDrop(p);
      const first = Math.min(...[seen[e.id], p && p.t0, e.added].filter((t) => typeof t === 'number' && t > 0));
      const place = c.home && e.location ? places.resolve(e.location) : null;
      const km = place ? places.distanceKm(c.home, place) : null;
      return {
        id: e.id,
        href: e.href,
        title: e.title || '',
        img: e.img,
        priceText: e.priceText || '',
        price,
        drop,
        firstSeen: Number.isFinite(first) ? first : null,
        age: Number.isFinite(first) ? mem.ago(first, now) : '',
        location: e.location || '',
        km,
        kmText: km == null ? '' : places.formatKm(km),
        signals: e.signals,
        warnings: e.signals ? e.signals.filter((s) => s.tone === 'warn').length : null,
        best: [],
      };
    });
    if (rows.length > 1) {
      markBest(rows, 'price', (r) => r.price);
      markBest(rows, 'km', (r) => r.km);
      markBest(rows, 'warnings', (r) => r.warnings);
    }
    return rows;
  }

  function markBest(rows, name, get) {
    const vals = rows.map(get).filter((v) => typeof v === 'number');
    if (vals.length < 2) return;
    const min = Math.min(...vals);
    if (vals.every((v) => v === min)) return;
    for (const r of rows) if (get(r) === min) r.best.push(name);
  }

  const api = { MAX, has, toggle, remove, update, compare };
  root.MarketMode = Object.assign(root.MarketMode || {}, { shortlist: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
