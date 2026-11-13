/*
 * punnet — buyer filters. Pure functions, no DOM, no network.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    newestFirst: true,
    hideSold: true,
    hideViewed: false,
    hideShipped: false,
    hideJunk: true,
    onlyNew: false,
    tidySaved: false,
    exclusions: [],
    minPrice: null,
    maxPrice: null,
    home: null, // "Fremantle, WA": strict distance is measured from here
    maxKm: null,
  });

  const PRICE_LINE = /^(?:[A-Z]{1,3}\s?)?[$€£¥₹₩₱]\s?\d[\d,.\s]*$|^\d[\d,.\s]*\s?(?:kr|zł|€|₫|R\$)$|^free$/i;
  const STATUS_LINE = /^(sold|pending|unavailable|no longer available)$/i;
  const SHIPPING_LINE = /\b(ships to you|shipping|ships from)\b/i;
  const NOISE_LINE = /^(sponsored|just listed|new|·|price drop|price dropped)$/i;

  // Non-sale posts: that aren't really for sale, or prices that aren't real prices.
  // Anywhere in the title: unambiguous 'I want this' words. At the start only: 'After:' ('After: PS5'),
  // because mid-title it's ordinary English ('after-market wheels').
  const WANTED_TITLE = /(?:^|[^\p{L}\p{N}])(wanted|wtb|iso|looking for|in search of)(?=$|[^\p{L}\p{N}])/iu;
  const WANTED_START = /^\s*after\s*(?::|–|—|\s-\s)/i;
  const RENTAL_TITLE = /(?:^|[^\p{L}\p{N}])(for rent|for lease|to rent|room for rent|rental)(?=$|[^\p{L}\p{N}])/iu;
  const PLACEHOLDER_PRICES = new Set([1, 2, 12, 123, 1234, 12345, 123456, 1111, 11111, 111111, 99999, 999999, 9999999]);

  /** Number from a price string like "A$1,250", "$40", "Free". null if unreadable. */
  function parsePrice(text) {
    if (text == null) return null;
    const s = String(text).trim();
    if (/^free$/i.test(s)) return 0;
    const digits = s.replace(/[^\d.,]/g, '');
    if (!digits) return null;
    // "1,250.50" -> 1250.5 ; "1.250" (thousands dot) -> 1250 ; "12.50" -> 12.5
    let normal = digits;
    if (/,\d{2}$/.test(normal) && !normal.includes('.')) normal = normal.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(normal)) normal = normal.replace(/\./g, '');
    normal = normal.replace(/,/g, '');
    const n = Number.parseFloat(normal);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Read a listing card's visible text (innerText) into fields.
   * Facebook cards render as lines: price(s), title, location, optional extras.
   */
  function parseCard(text) {
    const lines = String(text || '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap(splitPrices);
    const card = { price: null, priceText: null, title: '', location: '', status: null, shipped: false, sponsored: false, lines };
    const rest = [];
    for (const line of lines) {
      if (STATUS_LINE.test(line)) {
        card.status = line.toLowerCase().startsWith('sold') ? 'sold' : line.toLowerCase().startsWith('pending') ? 'pending' : 'unavailable';
      } else if (PRICE_LINE.test(line) && !(card.priceText != null && /^free$/i.test(line))) {
        // ("Free" after a price is a title: "$0" then "Free". A second number is the old price.)
        // first price is the current price; a second one is the struck-through old price
        if (card.priceText == null) {
          card.priceText = line;
          card.price = parsePrice(line);
        }
      } else if (SHIPPING_LINE.test(line)) {
        card.shipped = true;
      } else if (/^sponsored$/i.test(line)) {
        card.sponsored = true;
      } else if (!NOISE_LINE.test(line)) {
        rest.push(line);
      }
    }
    card.title = rest[0] || '';
    card.location = rest[1] || '';
    return card;
  }

  /**
   * A price drop shows the new and old price side by side, and the text can arrive as one run:
   * "$15,500$17,000" or "AU$95AU$120". Split it, but only if every piece is a price.
   */
  function splitPrices(line) {
    if (PRICE_LINE.test(line)) return [line];
    const parts = line.replace(/(\d)\s*(?=(?:[A-Z]{1,3}\s?)?[$€£¥₹₩₱]\s?\d)/g, '$1\n').split('\n');
    return parts.length > 1 && parts.every((p) => PRICE_LINE.test(p.trim())) ? parts.map((p) => p.trim()) : [line];
  }

  /** Normalise the user's exclusion list: trimmed, lower-case, unique, non-empty. */
  function normaliseExclusions(list) {
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const w = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
      if (w && w.length <= 60) seen.add(w);
    }
    return [...seen];
  }

  /** Whole-word, case-insensitive matchers. "iphone 11" will not match "iphone 115". */
  function compileExclusions(list) {
    return normaliseExclusions(list).map((word) => {
      const body = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
      return { word, re: new RegExp('(?:^|[^\\p{L}\\p{N}])' + body + '(?=$|[^\\p{L}\\p{N}])', 'iu') };
    });
  }

  /** Why a card is not a real sale ('wanted' | 'placeholder' | 'rental' | 'sponsored'), or null. */
  function junkReason(card) {
    const t = card.title || '';
    if (card.sponsored) return 'sponsored';
    if (WANTED_START.test(t) || WANTED_TITLE.test(t)) return 'wanted';
    if (RENTAL_TITLE.test(t)) return 'rental';
    if (card.price != null && card.price > 0 && PLACEHOLDER_PRICES.has(card.price)) return 'placeholder';
    return null;
  }

  /**
   * Decide what to do with one card.
   * extra: { isNew, duplicate, onSaved, km } from the page context (km: distance from home, if known).
   * @returns {{hide: boolean, reason: string|null, seen: boolean}}
   */
  function decide(card, id, settings, state, matchers, extra) {
    const x = extra || {};
    const s = settings || DEFAULT_SETTINGS;
    const viewed = (state && state.viewed) || new Set();
    const hidden = (state && state.hidden) || new Set();
    const seen = id != null && viewed.has(id);
    const out = (reason) => ({ hide: reason != null, reason, seen });

    if (id != null && hidden.has(id)) return out('hidden');
    // On Saved, sold items are badged rather than hidden unless the person asks to tidy Saved.
    if (card.status && (x.onSaved ? s.tidySaved : s.hideSold)) return out('sold');
    const ms = matchers || compileExclusions(s.exclusions);
    const haystack = card.title || '';
    for (const m of ms) if (m.re.test(haystack)) return out('keyword');
    if (s.hideJunk && !x.onSaved && (junkReason(card) || x.duplicate)) return out('junk');
    if (card.price != null) {
      if (isNum(s.minPrice) && card.price < s.minPrice) return out('price');
      if (isNum(s.maxPrice) && card.price > s.maxPrice) return out('price');
    }
    // Strict distance: only when the place is known (x.km). Unknown places always stay.
    if (isNum(s.maxKm) && isNum(x.km) && x.km > s.maxKm) return out('distance');
    if (s.hideShipped && card.shipped) return out('shipped');
    if (s.hideViewed && seen && !x.onSaved) return out('viewed');
    if (s.onlyNew && x.isNew === false && !x.onSaved) return out('not-new');
    return out(null);
  }

  function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /** Merge stored settings over defaults and coerce types, so bad storage can't break the page. */
  function sanitiseSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
    for (const k of ['enabled', 'newestFirst', 'hideSold', 'hideViewed', 'hideShipped', 'hideJunk', 'onlyNew', 'tidySaved']) s[k] = Boolean(s[k]);
    s.exclusions = normaliseExclusions(s.exclusions);
    for (const k of ['minPrice', 'maxPrice']) {
      const n = s[k] === '' || s[k] == null ? null : Number(s[k]);
      s[k] = Number.isFinite(n) && n >= 0 ? n : null;
    }
    s.home = typeof s.home === 'string' && s.home.trim() ? s.home.trim().slice(0, 80) : null;
    const km = s.maxKm === '' || s.maxKm == null ? null : Number(s.maxKm);
    s.maxKm = Number.isFinite(km) && km > 0 ? Math.min(km, 5000) : null;
    if (s.minPrice != null && s.maxPrice != null && s.minPrice > s.maxPrice) {
      [s.minPrice, s.maxPrice] = [s.maxPrice, s.minPrice];
    }
    return s;
  }

  /** Keep the newest `cap` ids, most recent last. */
  function remember(list, id, cap) {
    const next = (Array.isArray(list) ? list : []).filter((x) => x !== id);
    next.push(id);
    return next.length > cap ? next.slice(next.length - cap) : next;
  }

  const api = {
    DEFAULT_SETTINGS,
    parsePrice,
    parseCard,
    normaliseExclusions,
    compileExclusions,
    junkReason,
    decide,
    sanitiseSettings,
    remember,
  };

  root.MarketMode = Object.assign(root.MarketMode || {}, { filters: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
