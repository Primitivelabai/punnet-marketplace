/*
 * punnet — DOM layer. Finds Facebook's own page regions and listing cards and marks them
 * with data-mm-* attributes. CSS (page.css) does the visual work; nothing is removed from the DOM,
 * so Facebook's own handlers (Message seller, Save, etc.) keep working.
 *
 * Works on any Document (the live page, or jsdom in tests). No chrome.* calls here.
 */
(function (root) {
  'use strict';

  const ITEM_LINK = 'a[href*="/marketplace/item/"]';
  // m.facebook.com renders listings without links or ids: a container with an action id holds an
  // image area labelled "<title> for sale - <condition> - <price> in <place>", then text lines.
  const M_IMAGE = '[data-mcomponent="ServerImageArea"][aria-label]';
  const M_CELL = '[data-mcomponent="MContainer"][data-action-id]';
  const M_TEXT = '[data-mcomponent="ServerTextArea"]';
  const MAX_CLIMB = 8;

  function getPlaces() {
    return (root.MarketMode && root.MarketMode.places) || (typeof require === 'function' ? require('./places.js') : null);
  }
  function getRoutes() {
    return (root.MarketMode && root.MarketMode.routes) || (typeof require === 'function' ? require('./routes.js') : null);
  }
  function getFilters() {
    return (root.MarketMode && root.MarketMode.filters) || (typeof require === 'function' ? require('./filters.js') : null);
  }

  /** Tag Facebook's global top bar and Marketplace's own side panel so CSS can restyle them. */
  function tagChrome(doc) {
    const found = { bar: false, side: false };
    for (const el of doc.querySelectorAll('[role="banner"]')) {
      if (el.closest('[data-mm-ui]')) continue;
      el.setAttribute('data-mm', 'fb-bar');
      found.bar = true;
    }
    for (const nav of doc.querySelectorAll('[role="navigation"]')) {
      if (nav.getAttribute('data-mm') === 'fb-side') {
        found.side = true;
        continue;
      }
      if (nav.closest('[data-mm="fb-bar"]')) continue;
      // Marketplace's panel is the navigation that links to the buyer's own areas.
      if (nav.querySelector('a[href*="/marketplace/you/"], a[href*="/marketplace/inbox"], a[href*="/marketplace/category/"]')) {
        // Climb to the outer panel container (the fixed-width column), staying beneath main layout.
        let panel = nav;
        for (let i = 0; i < 4 && panel.parentElement && panel.parentElement.children.length === 1; i++) {
          panel = panel.parentElement;
        }
        panel.setAttribute('data-mm', 'fb-side');
        found.side = true;
      }
    }
    return found;
  }

  /** The grid cell that holds exactly one listing (climb until the parent holds more than one). */
  function cellFor(anchor) {
    const routes = getRoutes();
    const id = routes.itemIdFromHref(anchor.getAttribute('href'));
    let el = anchor;
    for (let i = 0; i < MAX_CLIMB; i++) {
      const parent = el.parentElement;
      if (!parent || parent.tagName === 'BODY' || parent.getAttribute('role') === 'main') break;
      let other = false;
      for (const a of parent.querySelectorAll(ITEM_LINK)) {
        if (routes.itemIdFromHref(a.getAttribute('href')) !== id) {
          other = true;
          break;
        }
      }
      if (other) break;
      el = parent;
    }
    return el;
  }

  function textOf(el) {
    // innerText follows the rendered layout (one line per block), which is how a card reads.
    // If layout gives a single run (inline markup, or no layout as in jsdom), split by text node.
    const t = typeof el.innerText === 'string' ? el.innerText.trim() : '';
    if (t.includes('\n')) return t;
    const parts = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) {
          const v = c.nodeValue.trim();
          if (v) parts.push(v);
        } else if (c.nodeType === 1 && !c.hasAttribute('data-mm-ui')) walk(c);
      }
    };
    walk(el);
    return parts.join('\n');
  }

  /**
   * All listing cards currently on the page, one per listing:
   * [{cell, anchor, id, href, text, fullTitle, mobile}]. Desktop cards come from item links; mobile-site
   * cards (no links) get a stable id from their photo, prefixed "m".
   */
  function findCards(doc) {
    const routes = getRoutes();
    const cards = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll(ITEM_LINK)) {
      if (anchor.closest('[data-mm-ui]')) continue;
      const id = routes.itemIdFromHref(anchor.getAttribute('href'));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cards.push({ cell: cellFor(anchor), anchor, id, href: `/marketplace/item/${id}/`, text: textOf(anchor), fullTitle: null, mobile: false });
    }
    for (const label of doc.querySelectorAll(M_IMAGE)) {
      const fullTitle = mobileTitle(label.getAttribute('aria-label'));
      if (fullTitle == null) continue;
      const cell = label.closest(M_CELL);
      if (!cell || cell.closest('[data-mm-ui]')) continue;
      const img = label.querySelector('img') || cell.querySelector('img');
      const id = mobileId(img && img.getAttribute('src'), label.getAttribute('aria-label'));
      if (seen.has(id)) continue;
      seen.add(id);
      const text = [...cell.querySelectorAll(M_TEXT)].map((t) => t.textContent.trim()).filter(Boolean).join('\n');
      cards.push({ cell, anchor: null, id, href: null, text, fullTitle, mobile: true });
    }
    return cards;
  }

  /** "Oak table for sale - Used - Good - A$100 in Perth, WA" -> "Oak table" (null if not a listing). */
  function mobileTitle(aria) {
    const m = /^([\s\S]+?) for sale(?: - |$)/.exec(String(aria || ''));
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  }

  /** Stable id for a mobile-site card: hash of its photo's file name (FNV-1a), else of its label. */
  function mobileId(src, fallback) {
    let key = String(fallback || '');
    try {
      if (src) key = new URL(src, 'https://m.facebook.com/').pathname.split('/').pop() || key;
    } catch {
      // keep the label
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'm' + h.toString(36);
  }

  function getMemory() {
    return (root.MarketMode && root.MarketMode.memory) || (typeof require === 'function' ? require('./memory.js') : null);
  }

  /**
   * Apply filters to every card, note what's new and what it costs, and badge cards.
   * @param {Document} doc
   * @param {object} settings  sanitised settings
   * @param {{viewed:Set<string>, hidden:Set<string>}} state
   * @param {object} [ctx] { pageKind, now, firstRun, seen:{}, prices:{}, sessionNew:Set, home:{lat,lon}|null, starred:Set }
   *   seen/prices are mutated in place; the result says whether they changed.
   * @returns {{total, hidden, reasons, newCount, unknownPlaces, dirty:{seen, prices},
   *   cards:[{id,href,title,priceText,price,location,km,img,isNew}]}}
   */
  function applyFilters(doc, settings, state, ctx) {
    const filters = getFilters();
    const mem = getMemory();
    const c = ctx || {};
    const now = c.now || Date.now();
    const seen = c.seen || {};
    const prices = c.prices || {};
    const sessionNew = c.sessionNew || new Set();
    const starred = c.starred || new Set();
    const places = c.home ? getPlaces() : null;
    const onSaved = c.pageKind === 'saved';
    const idx = mem.titleIndex(prices);
    const matchers = filters.compileExclusions(settings.exclusions);
    const stats = { total: 0, hidden: 0, reasons: {}, newCount: 0, unknownPlaces: 0, dirty: { seen: false, prices: false }, cards: [] };
    const onPage = new Map(); // title|price|location -> first id, to fold duplicates
    const mobileCells = [];

    for (const { cell, anchor, id, href, text, fullTitle, mobile } of findCards(doc)) {
      stats.total++;
      cell.setAttribute('data-mm-card', id);
      if (mobile) mobileCells.push(cell);
      const isStarred = starred.has(id);
      ensureCardControls(doc, cell, id, isStarred);
      const card = filters.parseCard(text);
      if (fullTitle) card.title = fullTitle;

      let km = null;
      if (places && card.location && !card.shipped) {
        const place = places.resolve(card.location);
        if (place) km = places.distanceKm(c.home, place);
        else stats.unknownPlaces++;
      }

      if (!Object.prototype.hasOwnProperty.call(seen, id)) stats.dirty.seen = true;
      if (mem.noteSeen(seen, id, now, c.firstRun)) sessionNew.add(id);
      const isNew = sessionNew.has(id);
      if (isNew) stats.newCount++;

      const repost = mem.repostOf(prices, idx, id, card.title, card.price);
      if (mem.notePrice(prices, id, card.price, card.title, now)) stats.dirty.prices = true;
      const drop = mem.priceDrop(prices[id]);

      const key = mem.normTitle(card.title) + '|' + card.price + '|' + card.location.toLowerCase();
      const duplicate = Boolean(card.title) && onPage.has(key) && onPage.get(key) !== id;
      if (card.title && !onPage.has(key)) onPage.set(key, id);

      const verdict = filters.decide(card, id, settings, state, matchers, { isNew, duplicate, onSaved, km });
      if (verdict.hide) {
        cell.setAttribute('data-mm-hide', verdict.reason);
        stats.hidden++;
        stats.reasons[verdict.reason] = (stats.reasons[verdict.reason] || 0) + 1;
      } else if (cell.hasAttribute('data-mm-hide')) {
        cell.removeAttribute('data-mm-hide');
      }
      toggleAttr(cell, 'data-mm-seen', verdict.seen);
      toggleAttr(cell, 'data-mm-new', isNew);
      toggleAttr(cell, 'data-mm-starred', isStarred);

      const badges = [];
      if (isNew) badges.push(['new', 'New']);
      if (drop > 0) badges.push(['drop', '↓ ' + currencyOf(card.priceText) + formatAmount(drop)]);
      if (card.status) badges.push(['status', card.status === 'sold' ? 'Sold' : card.status === 'pending' ? 'Pending' : 'Unavailable']);
      if (repost) badges.push(['repost', 'Relisted']);
      if (verdict.seen) badges.push(['seen', 'Seen']);
      if (km != null) badges.push(['km', places.formatKm(km)]);
      setBadges(doc, cell, badges);

      const img = (anchor || cell).querySelector('img');
      stats.cards.push({
        id,
        href,
        title: card.title,
        priceText: card.priceText,
        price: card.price,
        location: card.location,
        km,
        img: img ? img.getAttribute('src') : null,
        isNew,
      });
    }

    if (mobileCells.length) foldMobileRows(mobileCells);

    const sponsored = markSponsored(doc, settings.hideJunk);
    if (sponsored) {
      stats.hidden += sponsored;
      stats.reasons.junk = (stats.reasons.junk || 0) + sponsored;
    }
    return stats;
  }

  /**
   * Mobile site: each card sits in its own wrapper(s), two to a row, and those keep their size when
   * the card is hidden. Fold a hidden card's wrapper (the highest ancestor holding only that card),
   * and a row once every card in it is hidden.
   */
  function foldMobileRows(cells) {
    const rows = new Set();
    for (const cell of cells) {
      let unit = cell;
      for (let i = 0; i < 3; i++) {
        const p = unit.parentElement;
        if (!p || p.children.length > 3 || p.querySelectorAll('[data-mm-card]').length > 1) break;
        unit = p;
      }
      if (unit !== cell) toggleAttr(unit, 'data-mm-hide-row', cell.hasAttribute('data-mm-hide'));
      if (unit.parentElement) rows.add(unit.parentElement);
    }
    for (const row of rows) {
      const cards = row.querySelectorAll('[data-mm-card]');
      if (row.children.length > 4 || cards.length < 2) continue; // a list, not a row
      toggleAttr(row, 'data-mm-hide-row', [...cards].every((c) => c.hasAttribute('data-mm-hide')));
    }
  }

  function toggleAttr(el, name, on) {
    if (on) {
      if (!el.hasAttribute(name)) el.setAttribute(name, '');
    } else if (el.hasAttribute(name)) el.removeAttribute(name);
  }

  function currencyOf(priceText) {
    const m = /^[^\d]*/.exec(String(priceText || ''));
    return m && !/free/i.test(m[0]) ? m[0].trim() : '';
  }

  function formatAmount(n) {
    return Math.round(n).toLocaleString('en-AU');
  }

  /** Badge row on a card. Only touches the DOM when the badges actually change. */
  function setBadges(doc, cell, badges) {
    if (cell.matches('a')) return;
    const key = badges.map((b) => b.join(':')).join('|');
    let row = cell.querySelector(':scope > [data-mm-ui="badges"]');
    if (row && row.getAttribute('data-mm-key') === key) return;
    if (!row) {
      row = doc.createElement('div');
      row.setAttribute('data-mm-ui', 'badges');
      cell.appendChild(row);
    }
    row.setAttribute('data-mm-key', key);
    row.textContent = '';
    for (const [kind, label] of badges) {
      const b = doc.createElement('span');
      b.setAttribute('data-mm-badge', kind);
      b.textContent = label;
      row.appendChild(b);
    }
  }

  /**
   * Sponsored tiles in the Marketplace grid aren't listing links, so they aren't cards.
   * Find the "Sponsored" label and mark the grid cell that holds it (the ancestor whose
   * parent also holds listing cards).
   */
  function markSponsored(doc, hide) {
    const main = doc.querySelector('[role="main"]');
    if (!main) return 0;
    let count = 0;
    const walker = doc.createTreeWalker(main, 4 /* NodeFilter.SHOW_TEXT */);
    const labels = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim().toLowerCase() === 'sponsored') labels.push(n.parentElement);
    }
    for (const label of labels) {
      if (!label || label.closest('[data-mm-card]') || label.closest('[data-mm-ui]')) continue;
      let el = label;
      let found = false;
      for (let i = 0; i < 12 && el.parentElement && el.parentElement !== main; i++) {
        if (el.parentElement.querySelector('[data-mm-card]')) {
          found = true;
          break;
        }
        el = el.parentElement;
      }
      if (!found) continue;
      el.setAttribute('data-mm-sponsored', '');
      if (hide) {
        el.setAttribute('data-mm-hide', 'junk');
        count++;
      } else if (el.hasAttribute('data-mm-hide')) el.removeAttribute('data-mm-hide');
    }
    return count;
  }

  /** What a listing page says: title, price, the full text (for trust signals), seller join year. */
  function itemDetails(doc) {
    const filters = getFilters();
    const mem = getMemory();
    const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter((d) => d.querySelector('h1') && !d.closest('[data-mm-ui]'));
    const box = dialogs[dialogs.length - 1] || doc.querySelector('[role="main"]');
    if (!box) return null;
    const h1 = box.querySelector('h1');
    const title = h1 ? h1.textContent.trim() : '';
    const text = textOf(box);
    let priceText = null;
    for (const line of text.split('\n')) {
      const card = filters.parseCard(line);
      if (card.priceText) {
        priceText = card.priceText;
        break;
      }
    }
    const img = [...box.querySelectorAll('img[src^="https://"]')].find((i) => !i.closest('[data-mm-ui]'));
    // Listing pages give the place as "Listed 2 days ago in Fremantle, WA".
    let location = '';
    for (const line of text.split('\n')) {
      const m = /^listed\b.*?\bin (.{2,60}?, [A-Za-z ]{2,30})$/i.exec(line.trim());
      if (m) {
        location = m[1];
        break;
      }
    }
    return {
      title,
      priceText,
      price: filters.parsePrice(priceText),
      text,
      joinedYear: mem.joinedYear(text),
      img: img ? img.getAttribute('src') : null,
      location,
    };
  }

  /** Small controls on each card: shortlist (star) and "hide this listing". Ours, so data-mm-ui. */
  function ensureCardControls(doc, cell, id, starred) {
    // Never put a button inside Facebook's link: a click on it would open the listing.
    if (cell.matches('a')) return;
    const existing = cell.querySelector(':scope > [data-mm-ui="card-actions"]');
    if (existing) {
      const star = existing.querySelector('[data-mm-act="star"]');
      if (star && star.getAttribute('aria-pressed') !== String(!!starred)) setStar(star, starred);
      return;
    }
    if (getComputedPosition(cell) === 'static') cell.setAttribute('data-mm-pos', '');
    const box = doc.createElement('div');
    box.setAttribute('data-mm-ui', 'card-actions');
    const star = doc.createElement('button');
    star.type = 'button';
    star.setAttribute('data-mm-act', 'star');
    star.setAttribute('data-mm-id', id);
    setStar(star, starred);
    box.appendChild(star);
    const hide = doc.createElement('button');
    hide.type = 'button';
    hide.setAttribute('data-mm-act', 'hide');
    hide.setAttribute('data-mm-id', id);
    hide.setAttribute('aria-label', 'Hide this listing');
    hide.title = 'Not interested';
    hide.textContent = '×';
    box.appendChild(hide);
    cell.appendChild(box);
  }

  function setStar(btn, on) {
    btn.setAttribute('aria-pressed', String(!!on));
    btn.setAttribute('aria-label', on ? 'Remove from shortlist' : 'Add to shortlist');
    btn.title = on ? 'On your shortlist' : 'Shortlist';
    btn.textContent = on ? '★' : '☆';
  }

  /**
   * Facebook's message box for this listing, if one is open: the "Send seller a message" textarea
   * on the listing, else an open Messenger chat box. null if there isn't one.
   */
  function findMessageBox(doc) {
    const usable = (el) => {
      if (el.closest('[data-mm-ui]') || el.disabled || el.readOnly) return false;
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      // Facebook's listing page carries a second, hidden copy of the seller box (seen signed in, 9 Nov).
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false;
      try {
        const cs = el.ownerDocument.defaultView.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      } catch {
        // no layout information: assume visible
      }
      return true;
    };
    const wantsMessage = (el) => /message|seller|send/i.test(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
    const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter((d) => d.querySelector('h1') && !d.closest('[data-mm-ui]'));
    const scope = dialogs[dialogs.length - 1] || doc.querySelector('[role="main"]') || doc.body;
    const areas = [...scope.querySelectorAll('textarea')].filter(usable);
    const area = areas.find(wantsMessage) || areas[0];
    if (area) return area;
    const chat = [...doc.querySelectorAll('[contenteditable="true"][role="textbox"]')].filter((el) => usable(el) && wantsMessage(el));
    return chat[chat.length - 1] || null;
  }

  /**
   * Put the person's text into Facebook's message box the way typing would, so Facebook's own code
   * sees it. Never sends: the person reads it and presses Send themselves.
   */
  function putText(el, text) {
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      try {
        el.setSelectionRange(text.length, text.length);
      } catch {
        // some inputs don't support selection
      }
      return el.value === text;
    }
    // Rich editors (Messenger): select what's there and insert, as typing or a paste would.
    const sel = win.getSelection && win.getSelection();
    if (sel) {
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let ok = false;
    try {
      ok = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok || !el.textContent.includes(text)) {
      el.textContent = text;
      el.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return el.textContent.includes(text);
  }

  function getComputedPosition(el) {
    try {
      const view = el.ownerDocument.defaultView;
      return view && view.getComputedStyle ? view.getComputedStyle(el).position : 'static';
    } catch {
      return 'static';
    }
  }

  const api = {
    ITEM_LINK,
    tagChrome,
    cellFor,
    findCards,
    applyFilters,
    markSponsored,
    itemDetails,
    textOf,
    mobileTitle,
    mobileId,
    findMessageBox,
    putText,
  };
  root.MarketMode = Object.assign(root.MarketMode || {}, { enhance: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
