/*
 * punnet — local memory: what you've seen, what it cost, and what that tells you.
 * Pure functions over plain objects kept in chrome.storage.local. No DOM, no network.
 *
 *   seen:   { [itemId]: firstSeenMs }                         listings that have appeared in your grids
 *   prices: { [itemId]: { p, hi, t0, tc, ti } }               p = latest price, hi = highest seen,
 *                                                              t0 = first seen, tc = last change, ti = normalised title
 */
(function (root) {
  'use strict';

  const SEEN_CAP = 6000;
  const PRICE_CAP = 6000;
  const DAY = 86400000;

  const STOP = new Set([
    'the', 'and', 'for', 'with', 'set', 'new', 'used', 'good', 'great', 'condition', 'excellent', 'sale', 'only',
    'brand', 'like', 'very', 'pick', 'pickup', 'free', 'from', 'this', 'that', 'item', 'items',
  ]);

  function normTitle(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 90);
  }

  function tokens(title) {
    return [...new Set(normTitle(title).split(' ').filter((t) => t.length >= 3 && !STOP.has(t)))];
  }

  /** Two titles describe the same kind of thing: at least 2 shared meaningful words, Jaccard >= 0.5. */
  function similar(a, b) {
    const A = tokens(a);
    const B = new Set(tokens(b));
    if (A.length < 2 || B.size < 2) return false;
    const shared = A.filter((t) => B.has(t)).length;
    return shared >= 2 && shared / (A.length + B.size - shared) >= 0.5;
  }

  /** Trim a {id: value} map to its `cap` most recent entries by `ts(value)`. */
  function cap(map, max, ts) {
    const keys = Object.keys(map);
    if (keys.length <= max) return map;
    keys.sort((a, b) => ts(map[a]) - ts(map[b]));
    const out = {};
    for (const k of keys.slice(keys.length - max)) out[k] = map[k];
    return out;
  }

  /**
   * Note that a listing appeared. Returns true if it is new to this person.
   * The very first time punnet runs nothing is "new" (otherwise everything would be).
   */
  function noteSeen(seen, id, now, firstRun) {
    if (Object.prototype.hasOwnProperty.call(seen, id)) return false;
    seen[id] = now;
    return !firstRun;
  }

  /** Record the price of a listing. Returns true if storage changed. */
  function notePrice(prices, id, price, title, now) {
    if (price == null || !Number.isFinite(price)) return false;
    const ti = normTitle(title);
    const e = prices[id];
    if (!e) {
      prices[id] = { p: price, hi: price, t0: now, tc: now, ti };
      return true;
    }
    let changed = false;
    if (e.p !== price) {
      e.p = price;
      e.tc = now;
      changed = true;
    }
    if (price > e.hi) {
      e.hi = price;
      changed = true;
    }
    if (ti && e.ti !== ti) {
      e.ti = ti;
      changed = true;
    }
    return changed;
  }

  /** How much cheaper than the highest price you've seen for it, or 0. */
  function priceDrop(entry) {
    if (!entry || entry.p == null || entry.hi == null) return 0;
    return entry.hi > entry.p ? entry.hi - entry.p : 0;
  }

  /** Index normalised title -> [ids], so repost checks are cheap across a whole grid. */
  function titleIndex(prices) {
    const idx = new Map();
    for (const [id, e] of Object.entries(prices)) {
      if (!e.ti) continue;
      if (!idx.has(e.ti)) idx.set(e.ti, []);
      idx.get(e.ti).push(id);
    }
    return idx;
  }

  /**
   * Same title at (about) the same price, first seen under a different, older listing id:
   * a likely repost. Returns the older id or null.
   */
  function repostOf(prices, idx, id, title, price) {
    const ti = normTitle(title);
    if (!ti || ti.length < 6 || price == null) return null;
    const mine = prices[id];
    for (const other of idx.get(ti) || []) {
      if (other === id) continue;
      const e = prices[other];
      if (!e || e.p == null) continue;
      const close = Math.abs(e.p - price) <= Math.max(5, price * 0.1);
      const older = !mine || e.t0 < mine.t0;
      if (close && older) return other;
    }
    return null;
  }

  /** Typical price of similar listings you've seen (median), excluding `id`. */
  function typicalPrice(prices, title, id) {
    const values = [];
    for (const [other, e] of Object.entries(prices)) {
      if (other === id || !(e.p > 0) || !e.ti) continue;
      if (similar(title, e.ti)) values.push(e.p);
    }
    if (values.length < 5) return { n: values.length, median: null };
    values.sort((a, b) => a - b);
    const mid = values.length >> 1;
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return { n: values.length, median };
  }

  // ---- trust signals ----------------------------------------------------------------------

  const OFF_PLATFORM = [
    /\bwhats\s?app\b/i,
    /\btelegram\b/i,
    /\bsignal\s+(me|app)\b/i,
    /\b(text|sms|call|ring|email)\s+me\b/i,
    /\b[\w.+-]+@(gmail|hotmail|outlook|yahoo|icloud|live|proton)\.\w+/i,
    /(\+?61\s?|\b0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/, // AU mobile
    /\b\+?1?[\s-]?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}\b/, // US-style number
  ];
  const PAY_FIRST = [
    /\bdeposit\b/i,
    /\bpay(ment)?\s+(up\s?front|first|before|in advance)\b/i,
    /\bholding fee\b/i,
    /\bgift\s?cards?\b/i,
    /\b(bitcoin|crypto|usdt)\b/i,
    /\bwestern union\b|\bmoneygram\b|\bwire transfer\b/i,
    /\b(courier|shipping|delivery)\s+only\b/i,
    /\bpayid\b.*\b(upgrade|business account|limit)\b/i,
  ];

  /**
   * Explain-yourself signals for one listing page. Hints, not verdicts.
   * input: { text, title, price, now, typical: {n, median}, repost: bool, joinedYear }
   * returns [{ tone: 'warn'|'good'|'info', key, label, why }]
   */
  function trustSignals(input) {
    const out = [];
    const text = String(input.text || '');
    const year = new Date(input.now || Date.now()).getFullYear();

    if (OFF_PLATFORM.some((re) => re.test(text))) {
      out.push({ tone: 'warn', key: 'off-platform', label: 'Wants to talk off Messenger',
        why: 'The listing mentions WhatsApp, a phone number or an email. Keep chatting in Messenger so there’s a record.' });
    }
    if (PAY_FIRST.some((re) => re.test(text))) {
      out.push({ tone: 'warn', key: 'pay-first', label: 'Mentions paying first',
        why: 'Deposits, holding fees, gift cards, crypto or shipping-only are payment requests worth extra care. Pay when you have the item.' });
    }
    const t = input.typical;
    if (t && t.median && input.price > 0 && input.price < t.median * 0.45) {
      out.push({ tone: 'warn', key: 'too-cheap', label: 'Much cheaper than similar',
        why: `You’ve seen ${t.n} similar listings at around ${Math.round(t.median)}. A price this far below is worth a careful look.` });
    } else if (t && t.median && input.price > 0) {
      out.push({ tone: 'info', key: 'typical', label: input.price <= t.median ? 'At or below typical' : 'Above typical',
        why: `Similar listings you’ve seen go for around ${Math.round(t.median)} (${t.n} seen).` });
    }
    if (input.repost) {
      out.push({ tone: 'info', key: 'repost', label: 'Listed before',
        why: 'You saw the same title at about the same price under an older listing. It may have been relisted.' });
    }
    if (input.joinedYear) {
      if (input.joinedYear >= year) {
        out.push({ tone: 'warn', key: 'new-profile', label: 'New Facebook profile',
          why: `The seller joined Facebook in ${input.joinedYear}. New profiles aren’t proof of anything, but a newer account is worth a closer look.` });
      } else if (input.joinedYear <= year - 5) {
        out.push({ tone: 'good', key: 'old-profile', label: `On Facebook since ${input.joinedYear}`,
          why: 'Long-standing profiles are a good sign.' });
      }
    }
    return out;
  }

  /** "Joined Facebook in 2019" -> 2019, as shown on Marketplace seller info. */
  function joinedYear(text) {
    const m = /Joined Facebook in (\d{4})/i.exec(String(text || ''));
    return m ? Number(m[1]) : null;
  }

  function trimSeen(seen) {
    return cap(seen, SEEN_CAP, (v) => v);
  }
  function trimPrices(prices) {
    return cap(prices, PRICE_CAP, (v) => v.tc || v.t0 || 0);
  }

  /** "3h", "2d" — how long ago, short. */
  function ago(ms, now) {
    const d = Math.max(0, (now || Date.now()) - ms);
    if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + 'm';
    if (d < DAY) return Math.round(d / 3600000) + 'h';
    return Math.round(d / DAY) + 'd';
  }

  const api = {
    normTitle,
    tokens,
    similar,
    noteSeen,
    notePrice,
    priceDrop,
    titleIndex,
    repostOf,
    typicalPrice,
    trustSignals,
    joinedYear,
    trimSeen,
    trimPrices,
    ago,
  };
  root.MarketMode = Object.assign(root.MarketMode || {}, { memory: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
