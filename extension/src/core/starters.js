/*
 * punnet — message starters. Pure functions, no DOM, no network.
 * A starter only ever fills Facebook's message box with the person's own words; they press Send.
 */
(function (root) {
  'use strict';

  const MAX = 6;
  const MAX_LEN = 300;
  const DEFAULT_STARTERS = Object.freeze([
    'Hi! Is this still available?',
    'Hi, is the {title} still available? I can pick up today, cash.',
    'Hi! Would you take a bit less for the {title}?',
  ]);

  /** Trimmed, unique, non-empty, at most MAX of them. Missing storage gets the defaults. */
  function sanitise(list) {
    if (!Array.isArray(list)) return DEFAULT_STARTERS.slice();
    const out = [];
    for (const raw of list) {
      const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= MAX) break;
    }
    return out;
  }

  /** Fill {title} and {price} from the listing. Unknown values drop out cleanly. */
  function fill(template, item) {
    const it = item || {};
    const title = String(it.title || '').trim();
    const price = String(it.priceText || '').trim();
    return String(template || '')
      .replace(/\{title\}/gi, title || 'item')
      .replace(/\s*\{price\}/gi, price ? ' ' + price : '')
      .replace(/\s+([?!.,])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const api = { MAX, MAX_LEN, DEFAULT_STARTERS, sanitise, fill };
  root.MarketMode = Object.assign(root.MarketMode || {}, { starters: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
