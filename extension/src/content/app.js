/*
 * punnet — content script controller (isolated world, document_start on facebook.com).
 * Owns storage, navigation guards, Catch up and the update loop. Rendering lives in ui.js,
 * card logic in core/enhance.js, local memory in core/memory.js, watches in core/watches.js.
 */
(() => {
  'use strict';
  const { routes, filters, enhance, memory, watches: W, places, shortlist: SL, starters: ST, ui } = globalThis.MarketMode;
  const doc = document;
  const html = doc.documentElement;
  // m.facebook.com (the iPhone path): Facebook keeps its own top bar, ours is the bottom tab bar.
  const MOBILE_SITE = location.hostname === 'm.facebook.com';

  const VIEWED_CAP = 3000;
  const HIDDEN_CAP = 3000;
  const PERSIST_DELAY = 1500;
  const SETTLE_MS = 1500; // Catch up: results count stable this long = page loaded
  const SETTLE_MAX = 9000; // ...or give up waiting after this long
  // Pages where the shell replaces Facebook's bar. Login, checkpoints and settings are left alone.
  const SHELL_KINDS = new Set(['browse', 'search', 'category', 'item', 'saved', 'inbox', 'account', 'seller', 'messages']);

  let settings = filters.sanitiseSettings({});
  let viewed = [];
  let hidden = [];
  let seen = {};
  let prices = {};
  let watches = [];
  let catchup = null;
  let shortlist = [];
  let starters = ST.sanitise(undefined);
  let home = { label: null, point: null };
  let firstRun = false;
  let sessionNew = new Set();
  let reveal = false;
  let view = null;
  let stats = { total: 0, hidden: 0, reasons: {}, newCount: 0, cards: [] };
  let scheduled = 0;
  let persistTimer = 0;
  let pending = { seen: false, prices: false };
  let lastHref = '';
  let loaded = false;
  let pageStart = Date.now();
  let settle = { total: -1, since: 0 };
  let stepping = false;

  // Optimistic: apply classes before Facebook paints, undo if storage says punnet is paused.
  html.classList.add('mm-on');
  html.classList.toggle('mm-msite', MOBILE_SITE);
  syncShellClass();
  // Full page loads into distractions are already redirected by the declarativeNetRequest rules;
  // in-app navigation is guarded once settings load (so a paused punnet is never overridden).

  chrome.storage.local.get(['settings', 'viewed', 'hidden', 'seen', 'prices', 'watches', 'catchup', 'shortlist', 'starters']).then((data) => {
    shortlist = Array.isArray(data.shortlist) ? data.shortlist : [];
    starters = ST.sanitise(data.starters);
    settings = filters.sanitiseSettings(data.settings);
    viewed = Array.isArray(data.viewed) ? data.viewed : [];
    hidden = Array.isArray(data.hidden) ? data.hidden : [];
    firstRun = !data.seen || !Object.keys(data.seen).length;
    seen = obj(data.seen);
    prices = obj(data.prices);
    watches = Array.isArray(data.watches) ? data.watches : [];
    catchup = data.catchup || null;
    loaded = true;
    onLocation();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = filters.sanitiseSettings(changes.settings.newValue);
    if (changes.viewed) viewed = changes.viewed.newValue || [];
    if (changes.hidden) hidden = changes.hidden.newValue || [];
    if (changes.watches) watches = changes.watches.newValue || [];
    if (changes.catchup) catchup = changes.catchup.newValue || null;
    if (changes.shortlist) shortlist = changes.shortlist.newValue || [];
    if (changes.starters) starters = ST.sanitise(changes.starters.newValue);
    // seen/prices from another tab: merge rather than replace, so this tab's unsaved notes survive
    if (changes.seen && !pending.seen) seen = Object.assign(obj(changes.seen.newValue), seen);
    if (changes.prices && !pending.prices) prices = Object.assign(obj(changes.prices.newValue), prices);
    if (changes.seen && !changes.seen.newValue) seen = {};
    if (changes.prices && !changes.prices.newValue) prices = {};
    onLocation();
  });

  window.addEventListener('mm:locationchange', onLocation);
  window.addEventListener('popstate', onLocation);
  window.addEventListener('pagehide', flush);
  doc.addEventListener('click', onClickCapture, true);
  // Our card buttons sit inside Facebook's tappable cards (the mobile site reacts to touches and
  // pointers, not just clicks), so a press on them must not reach Facebook's card handlers.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    doc.addEventListener(type, onPressCapture, true);
  }

  const observer = new MutationObserver(schedule);
  if (doc.body) startObserving();
  else doc.addEventListener('DOMContentLoaded', startObserving, { once: true });

  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function startObserving() {
    observer.observe(doc.body, { childList: true, subtree: true });
    onLocation();
  }

  /** Leave distraction pages. Returns true if we are navigating away. */
  function guardLocation() {
    if (!settings.enabled) return false;
    const target = routes.redirectTarget(location.href);
    if (target) {
      location.replace(target);
      return true;
    }
    const withParams = routes.withBuyerParams(location.href, settings);
    if (withParams) {
      location.replace(withParams);
      return true;
    }
    return false;
  }

  function onLocation() {
    if (!loaded) return;
    if (!settings.enabled) return teardown();
    html.classList.add('mm-on');
    if (guardLocation()) return;
    syncShellClass();
    const kind = routes.pageKind(location.href);
    if (location.href !== lastHref) {
      lastHref = location.href;
      sessionNew = new Set();
      pageStart = Date.now();
      settle = { total: -1, since: 0 };
      if (kind === 'item') rememberViewed(routes.itemIdFromHref(location.pathname));
      html.classList.remove('mm-side-open');
    }
    if (SHELL_KINDS.has(kind) && doc.body && !view) mountShell();
    schedule();
  }

  function syncShellClass() {
    const kind = routes.pageKind(location.href);
    html.classList.toggle('mm-shell', settings.enabled && SHELL_KINDS.has(kind));
    html.classList.toggle('mm-only-new', settings.enabled && settings.onlyNew);
  }

  function teardown() {
    html.classList.remove('mm-on', 'mm-shell', 'mm-side-open', 'mm-reveal', 'mm-only-new');
    if (view) {
      view.destroy();
      view = null;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = 0;
      update();
    }, 120);
  }

  /** Home suburb as a point, resolved once per label from the bundled table. */
  function homePoint() {
    if (home.label !== settings.home) home = { label: settings.home, point: settings.home ? places.resolve(settings.home) : null };
    return home.point;
  }

  function update() {
    if (!loaded || !settings.enabled || !doc.body) return;
    const now = Date.now();
    const kind = routes.pageKind(location.href);
    enhance.tagChrome(doc);
    stats = enhance.applyFilters(
      doc,
      settings,
      { viewed: new Set(viewed), hidden: new Set(hidden) },
      { pageKind: kind, now, firstRun, seen, prices, sessionNew, home: homePoint(), starred: new Set(shortlist.map((e) => e.id)) }
    );
    if (stats.dirty.seen || stats.dirty.prices) persistSoon(stats.dirty);

    let signals = null;
    let item = null;
    const itemId = kind === 'item' ? routes.itemIdFromHref(location.pathname) : null;
    if (kind === 'item') {
      item = enhance.itemDetails(doc);
      const id = itemId;
      if (item && item.title && id) {
        if (memory.notePrice(prices, id, item.price, item.title, now)) persistSoon({ prices: true });
        const idx = memory.titleIndex(prices);
        signals = memory.trustSignals({
          text: item.text,
          title: item.title,
          price: item.price,
          now,
          typical: memory.typicalPrice(prices, item.title, id),
          repost: !!memory.repostOf(prices, idx, id, item.title, item.price),
          joinedYear: item.joinedYear,
        });
        // A shortlisted listing's page is open: refresh what the compare view knows about it.
        const next = SL.update(shortlist, id, Object.assign(itemEntry(id, item), { signals }), now);
        if (next !== shortlist) {
          shortlist = next;
          chrome.storage.local.set({ shortlist });
        }
      }
    }

    stepCatchup(kind, now);

    if (view) {
      const url = new URL(location.href);
      view.render({
        settings,
        stats,
        reveal,
        kind,
        tab: tabFor(kind),
        query: url.searchParams.get('query') || '',
        hiddenCount: hidden.length,
        viewedCount: viewed.length,
        watches,
        watching: W.findWatch(watches, url),
        canWatch: !!W.queryOf(url),
        catchup: catchup ? Object.assign({ active: W.catchupActive(catchup, now) }, catchup) : null,
        signals,
        item: item && item.title ? { title: item.title, priceText: item.priceText } : null,
        starters,
        shortlist,
        compare: SL.compare(shortlist, { prices, seen, home: homePoint(), now }),
        canStar: !!(itemId && item && item.title),
        itemStarred: !!itemId && SL.has(shortlist, itemId),
      });
    }
  }

  function itemEntry(id, item) {
    return {
      id,
      href: `/marketplace/item/${id}/`,
      title: item.title,
      priceText: item.priceText,
      price: item.price,
      img: item.img,
      location: item.location,
    };
  }

  function toggleStar(id) {
    let entry = null;
    if (id) {
      const card = stats.cards.find((c) => c.id === id);
      entry = card ? Object.assign({}, card) : { id };
    } else {
      const itemId = routes.itemIdFromHref(location.pathname);
      const item = itemId && enhance.itemDetails(doc);
      if (item && item.title) entry = itemEntry(itemId, item);
    }
    if (!entry) return;
    const was = SL.has(shortlist, entry.id);
    if (!was && shortlist.length >= SL.MAX) {
      view && view.toast(`Your shortlist is full (${SL.MAX}). Remove one to add another.`);
      return;
    }
    shortlist = SL.toggle(shortlist, entry, Date.now());
    chrome.storage.local.set({ shortlist });
    update();
    if (view) {
      if (was) view.toast('Removed from your shortlist');
      else view.toast('Added to your shortlist', 'Compare', () => view.openSheet('shortlist'));
    }
  }

  /** Put a starter in Facebook's message box. The person reads it and presses Send themselves. */
  function useStarter(i) {
    const template = starters[i];
    if (template == null) return;
    const item = enhance.itemDetails(doc) || {};
    const text = ST.fill(template, item);
    const box = enhance.findMessageBox(doc);
    if (box && enhance.putText(box, text)) {
      view && view.toast('In your message box. Check it, then press Send.');
      return;
    }
    const copied = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject();
    copied.then(
      () => view && view.toast('Copied. Tap Message, paste it, then press Send.'),
      () => view && view.toast('Tap Message first, then pick a starter.')
    );
  }

  // ---- Catch up -------------------------------------------------------------------------

  /** If a Catch up is running and this is the search it's waiting on, collect new listings once loaded. */
  function stepCatchup(kind, now) {
    if (!catchup || catchup.done || stepping) return;
    if (!W.catchupActive(catchup, now)) {
      saveCatchup(null);
      return;
    }
    const want = W.currentWatch(catchup, watches);
    const here = W.findWatch(watches, location.href);
    if (!want || kind !== 'search' || !here || here.id !== want.id) {
      // The person went somewhere else mid-way: stop, keep what was found.
      if (now - catchup.started > 4000) saveCatchup(Object.assign({}, catchup, { queue: [], done: true }));
      return;
    }
    if (stats.total !== settle.total) settle = { total: stats.total, since: now };
    const settled = stats.total > 0 && now - settle.since >= SETTLE_MS;
    if (!settled && now - pageStart < SETTLE_MAX) {
      setTimeout(schedule, 400); // keep checking while results stream in
      return;
    }
    stepping = true;
    const fresh = stats.cards.filter((c) => c.isNew && c.title);
    const res = W.recordStep(catchup, watches, fresh, now);
    watches = res.watches;
    catchup = res.catchup;
    chrome.storage.local.set({ watches, catchup }).then(() => {
      stepping = false;
      const next = W.currentWatch(catchup, watches);
      if (next) {
        // The catch-up strip (ui.js) shows progress; it's rebuilt from storage on the next page.
        const url = W.watchUrl(next, location.origin);
        location.assign(routes.withBuyerParams(url, settings) || url);
      } else {
        flush();
        if (view) view.openSheet('results');
      }
    });
  }

  function saveCatchup(c) {
    catchup = c;
    chrome.storage.local.set({ catchup: c });
  }

  // ---- storage ---------------------------------------------------------------------------

  function persistSoon(dirty) {
    pending.seen = pending.seen || !!dirty.seen;
    pending.prices = pending.prices || !!dirty.prices;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flush, PERSIST_DELAY);
  }

  function flush() {
    clearTimeout(persistTimer);
    const out = {};
    if (pending.seen) out.seen = seen = memory.trimSeen(seen);
    if (pending.prices) out.prices = prices = memory.trimPrices(prices);
    pending = { seen: false, prices: false };
    // firstRun stays true for this whole page load, so the very first visit badges nothing as "new".
    if (Object.keys(out).length) chrome.storage.local.set(out);
  }

  function tabFor(kind) {
    if (kind === 'saved') return 'saved';
    if (kind === 'inbox' || kind === 'messages') return 'inbox';
    if (kind === 'account') return null;
    return 'browse';
  }

  function mountShell() {
    view = ui.mount(doc, {
      onToggleStar(id) {
        toggleStar(id);
      },
      onUnstar(id) {
        shortlist = SL.remove(shortlist, id);
        chrome.storage.local.set({ shortlist });
        update();
      },
      onStarter(i) {
        useStarter(i);
      },
      onStarters(list) {
        starters = ST.sanitise(list);
        chrome.storage.local.set({ starters });
        update();
      },
      onSearch(q) {
        location.assign(routes.searchUrl(q, settings, location.origin));
      },
      onSettings(patch) {
        saveSettings(patch);
      },
      onRestoreHidden() {
        chrome.storage.local.set({ hidden: [] });
        view.toast('All hidden listings are back');
      },
      onClearViewed() {
        chrome.storage.local.set({ viewed: [] });
        view.toast('Opened history cleared');
      },
      onClearMemory() {
        seen = {};
        prices = {};
        pending = { seen: false, prices: false };
        firstRun = true;
        chrome.storage.local.remove(['seen', 'prices']);
        view.toast('Price and “new” memory cleared');
      },
      onPause() {
        saveSettings({ enabled: false });
      },
      onOpenLocation() {
        const side = doc.querySelector('[data-mm="fb-side"]');
        if (side) {
          html.classList.add('mm-side-open');
          side.scrollTop = 0;
        } else if (routes.pageKind(location.href) !== 'browse') {
          location.assign('/marketplace/');
        } else {
          view.toast('Facebook’s location panel isn’t on this page yet — try again once it loads');
        }
      },
      onToggleReveal() {
        reveal = !reveal;
        html.classList.toggle('mm-reveal', reveal);
        update();
      },
      onWatch() {
        watches = W.addWatch(watches, location.href, Date.now());
        chrome.storage.local.set({ watches });
        view.toast('Watching this search — Catch up shows what’s new');
      },
      onUnwatch(id) {
        watches = W.removeWatch(watches, id);
        chrome.storage.local.set({ watches });
      },
      onOpenWatch(id) {
        const w = watches.find((x) => x.id === id);
        if (!w) return;
        const url = W.watchUrl(w, location.origin);
        location.assign(routes.withBuyerParams(url, settings) || url);
      },
      onCatchup() {
        flush();
        const c = W.startCatchup(watches, Date.now());
        if (!c) return;
        catchup = c;
        chrome.storage.local.set({ catchup: c }).then(() => {
          const first = W.currentWatch(c, watches);
          const url = W.watchUrl(first, location.origin);
          location.assign(routes.withBuyerParams(url, settings) || url);
        });
      },
      onStopCatchup() {
        if (!catchup) return;
        saveCatchup(Object.assign({}, catchup, { queue: [], done: true }));
        update();
        view.openSheet('results');
      },
      onClearResults() {
        saveCatchup(null);
      },
    }, { compact: MOBILE_SITE });
    update();
    // The popup's "Your shortlist" link lands here with ?punnet=shortlist: open the compare sheet once.
    const url = new URL(location.href);
    if (url.searchParams.get('punnet') === 'shortlist') {
      url.searchParams.delete('punnet');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      view.openSheet('shortlist');
    }
  }

  function saveSettings(patch) {
    const next = filters.sanitiseSettings(Object.assign({}, settings, patch));
    settings = next;
    chrome.storage.local.set({ settings: next });
  }

  function rememberViewed(id) {
    if (!id) return;
    viewed = filters.remember(viewed, id, VIEWED_CAP);
    chrome.storage.local.set({ viewed });
  }

  function onPressCapture(e) {
    if (!loaded || !settings.enabled) return;
    if (e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-mm-act'))) e.stopPropagation();
  }

  function onClickCapture(e) {
    if (!loaded || !settings.enabled) return;
    const path = e.composedPath();

    // Our own "shortlist" star on a card.
    const starBtn = path.find((n) => n instanceof Element && n.getAttribute('data-mm-act') === 'star');
    if (starBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleStar(starBtn.getAttribute('data-mm-id'));
      return;
    }

    // Our own "hide this listing" button on a card.
    const hideBtn = path.find((n) => n instanceof Element && n.getAttribute('data-mm-act') === 'hide');
    if (hideBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = hideBtn.getAttribute('data-mm-id');
      hidden = filters.remember(hidden, id, HIDDEN_CAP);
      chrome.storage.local.set({ hidden });
      view && view.toast('Listing hidden', 'Undo', () => {
        hidden = hidden.filter((x) => x !== id);
        chrome.storage.local.set({ hidden });
      });
      return;
    }

    // Click outside the open location drawer closes it.
    if (html.classList.contains('mm-side-open') && !path.some((n) => n instanceof Element && n.getAttribute('data-mm') === 'fb-side')) {
      html.classList.remove('mm-side-open');
    }

    // A Facebook link into a distraction (Watch, Groups, the feed…) goes to Marketplace instead.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = path.find((n) => n instanceof HTMLAnchorElement && n.href);
    if (!a) return;
    const target = routes.redirectTarget(a.href);
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      location.assign(target);
    }
  }
})();
