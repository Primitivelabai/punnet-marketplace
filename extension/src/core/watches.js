/*
 * punnet — watched searches and Catch up. Pure functions, no DOM, no network.
 *
 * Nothing runs while the person is away. Catch up only happens when they tap it: their own tab
 * opens each watched search in turn (newest first), punnet keeps the listings they haven't
 * seen, and gathers them into one list. Every page load is visible and started by them.
 */
(function (root) {
  'use strict';

  const MAX_WATCHES = 8;
  const MAX_FOUND = 60;
  const CATCHUP_TIMEOUT = 3 * 60 * 1000;

  function normQuery(q) {
    return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function toUrl(input) {
    try {
      return input instanceof URL ? input : new URL(String(input));
    } catch {
      return null;
    }
  }

  /** The search query on a Marketplace search page, or null. */
  function queryOf(input) {
    const url = toUrl(input);
    if (!url || !/^\/marketplace\/(?:[^/]+\/)?search\/?$/.test(url.pathname)) return null;
    const q = normQuery(url.searchParams.get('query'));
    return q || null;
  }

  function findWatch(watches, input) {
    const q = queryOf(input);
    return q ? (watches || []).find((w) => w.query === q) || null : null;
  }

  /** Add the search on this page to the watch list (no duplicates, capped). */
  function addWatch(watches, input, now) {
    const q = queryOf(input);
    const list = Array.isArray(watches) ? watches.slice() : [];
    if (!q || list.some((w) => w.query === q)) return list;
    const url = toUrl(input);
    const path = url.pathname.replace(/\/search\/?$/, '/search/');
    list.push({ id: 'w' + now.toString(36), query: q, path, added: now, lastRun: null, lastNew: 0 });
    return list.slice(-MAX_WATCHES);
  }

  function removeWatch(watches, id) {
    return (watches || []).filter((w) => w.id !== id);
  }

  /** URL that runs a watch, with the person's own price/sort params added by routes.withBuyerParams. */
  function watchUrl(watch, origin) {
    const url = new URL(watch.path || '/marketplace/search/', origin || 'https://www.facebook.com');
    url.searchParams.set('query', watch.query);
    return url.href;
  }

  /** Start a Catch up over all watches. */
  function startCatchup(watches, now) {
    const queue = (watches || []).map((w) => w.id);
    return queue.length ? { queue, found: [], started: now, done: false } : null;
  }

  /** Is a Catch up still valid (not timed out, not finished)? */
  function catchupActive(c, now) {
    return !!(c && !c.done && Array.isArray(c.queue) && c.queue.length && now - c.started < CATCHUP_TIMEOUT);
  }

  /** The watch Catch up is waiting on right now. */
  function currentWatch(c, watches) {
    return c && c.queue && c.queue.length ? (watches || []).find((w) => w.id === c.queue[0]) || null : null;
  }

  /**
   * Record this page's new listings for the current watch and move on.
   * newCards: [{id, title, priceText, img}] — listings this person hadn't seen before.
   * Returns { catchup, watches } (new objects).
   */
  function recordStep(c, watches, newCards, now) {
    const watch = currentWatch(c, watches);
    const known = new Set(c.found.map((f) => f.id));
    const add = newCards.filter((x) => !known.has(x.id)).map((x) => Object.assign({ watch: watch ? watch.query : '' }, x));
    const found = c.found.concat(add).slice(0, MAX_FOUND);
    const queue = c.queue.slice(1);
    const next = { queue, found, started: c.started, done: queue.length === 0 };
    const nextWatches = (watches || []).map((w) => (watch && w.id === watch.id ? Object.assign({}, w, { lastRun: now, lastNew: add.length }) : w));
    return { catchup: next, watches: nextWatches };
  }

  const api = {
    MAX_WATCHES,
    CATCHUP_TIMEOUT,
    normQuery,
    queryOf,
    findWatch,
    addWatch,
    removeWatch,
    watchUrl,
    startCatchup,
    catchupActive,
    currentWatch,
    recordStep,
  };
  root.MarketMode = Object.assign(root.MarketMode || {}, { watches: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
