/*
 * punnet — the shell UI (desktop rail and search strip, mobile tab bar, sheet, listing panel, toasts).
 * Lives in a shadow root so Facebook's CSS can't touch it and ours can't leak.
 * Pure view: it renders state and calls handlers; app.js owns storage and navigation.
 * Look: a side rail on desktop, ink actions, system fonts. Brand colours are in docs/brand/punnet-tokens.css.
 */
(function (root) {
  'use strict';

  // The pixel basket. Never redrawn, rounded or stroked.
  const MARK_RECTS =
    '<rect x="2" y="0" width="1" height="1" fill="#4f7a3a"/><rect x="1" y="1" width="2" height="2" fill="#d23b2a"/><g fill="#3d4a9e"><rect x="5" y="1" width="1" height="1"/><rect x="4" y="2" width="3" height="1"/></g><rect x="0" y="3" width="8" height="1" fill="#7a4a22"/><rect x="0" y="4" width="8" height="2" fill="#c98f52"/><rect x="1" y="6" width="6" height="1" fill="#c98f52"/><rect x="1" y="7" width="6" height="1" fill="#7a4a22"/><g fill="#7a4a22"><rect x="1" y="4" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/></g>';
  const stroke = (d, w) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.75}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  const ICON = {
    mark: `<svg class="mark" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${MARK_RECTS}</svg>`,
    search: stroke('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5'),
    browse: stroke('M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z'),
    saved: stroke('M6 4h12v16l-6-4-6 4z'),
    inbox: stroke('M4 5h16v11H9l-5 4z'),
    watching: stroke('M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'),
    shortlist: stroke('M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'),
    filters: stroke('M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4'),
    pause: stroke('M9 6v12M15 6v12'),
    close: stroke('M6 6l12 12M18 6L6 18', 2),
    pin: stroke('M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11zM12 7.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z'),
    chevron: stroke('M6 9l6 6 6-6', 2),
  };

  const SUGGESTED_WORDS = ['wanted', 'swap', 'broken', 'parts only', 'replica', 'rental'];

  // Phone layout. Applied below 760 px, and always on the mobile site (.compact), so it's written once
  // and emitted twice with a different prefix. Everything that floats stacks in one column (.dock).
  const phone = (p) => `
${p}.tabs { display: none; }
${p}.bar { left: 0; padding: 0 12px; gap: 8px; }
${p}.bar .btn-o svg { display: none; }
${p}.bar .btn-o { padding: 0 10px; }
${p}.bar [data-star] .txt { display: none; }
${p}.catchup { left: 0; padding: 0 12px; gap: 10px; }
${p}.catchup .meta { display: none; }
${p}.dock { left: 10px; right: 10px; bottom: max(12px, env(safe-area-inset-bottom)); align-items: stretch; }
${p}.pill { position: static; transform: none; align-self: center; }
${p}.listing { width: auto; max-height: 50vh; }
${p}.toast { width: auto; }
${p}.tabbar { display: grid; }
${p}.starters { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
${p}.starter { flex: none; max-width: 180px; height: 36px; padding: 0 10px; border: 1px solid var(--pn-hairline-2); border-radius: var(--pn-r-small); }
${p}.starter::after { display: none; }
${p}.sheet { top: 92px; left: 0; right: 0; bottom: 0; width: 100%; border-radius: var(--pn-r-sheet) var(--pn-r-sheet) 0 0; transform: translateY(100%); }
${p}.sheet[data-mode="shortlist"] { width: 100%; }
${p}.sheet::before { content: ""; width: 36px; height: 4px; border-radius: 2px; background: var(--pn-off-track); margin: 8px auto 0; flex: none; }
${p}.sheet h2 { font-size: var(--pn-text-xl); }
${p}.compare { grid-auto-columns: calc(100vw - 72px); scroll-snap-type: x mandatory; }
${p}.compare article { scroll-snap-align: start; }
`;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --pn-ink: #2b2420; --pn-primary: #2b2420; --pn-straw: #e2b783; --pn-oat: #f4efe6; --pn-white: #fff;
  --pn-apple: #d23b2a; --pn-blueberry: #3d4a9e; --pn-leaf: #4f7a3a;
  --pn-warn-bg: #fbe7e3; --pn-warn-fg: #8f2a1c; --pn-good-bg: #e9f1e1; --pn-good-fg: #3b5e2b; --pn-info-bg: #e8eaf8; --pn-info-fg: #2f3a80;
  --pn-hairline: rgba(43,36,32,.12); --pn-hairline-2: rgba(43,36,32,.16); --pn-muted: rgba(43,36,32,.66); --pn-label: rgba(43,36,32,.62);
  --pn-off-track: rgba(43,36,32,.20); --pn-scrim: rgba(43,36,32,.45); --pn-hover: rgba(43,36,32,.05);
  --pn-font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --pn-font-mono: ui-monospace, "SF Mono", Consolas, "Roboto Mono", monospace;
  --pn-text-xl: 22px; --pn-text-2xl: 24px;
  --pn-r-badge: 4px; --pn-r-small: 6px; --pn-r-field: 8px; --pn-r-switch: 7px; --pn-r-panel: 12px; --pn-r-bar: 14px; --pn-r-sheet: 16px;
  --pn-shadow-pill: 0 2px 8px rgba(43,36,32,.12); --pn-shadow-toast: 0 6px 20px rgba(43,36,32,.22); --pn-shadow-panel: 0 8px 24px rgba(0,0,0,.16);
  --pn-ease: cubic-bezier(.16,1,.3,1); --pn-fast: 160ms; --pn-base: 240ms; --pn-slow: 320ms;
  font: 400 14px/1.45 var(--pn-font-ui);
  color: var(--pn-ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-reduced-motion: reduce) { .root { --pn-fast: 0ms; --pn-base: 0ms; --pn-slow: 0ms; } }
button, input, textarea { font: inherit; color: inherit; }
a { color: inherit; text-decoration: none; }
svg { width: 20px; height: 20px; flex: none; }
:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
[hidden] { display: none !important; }
.eyebrow, h3 { margin: 0; font: 400 10px/1.4 var(--pn-font-mono); letter-spacing: .16em; text-transform: uppercase; color: var(--pn-label); }
.count { display: none; }
.count.on { display: inline-block; }

/* ---------- rail (desktop) ---------- */
.tabs {
  position: fixed; z-index: 2147482000; top: 0; left: 0; bottom: 0; width: 72px;
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 0;
  background: var(--pn-oat); border-right: 1px solid var(--pn-hairline);
}
.brand { width: 44px; height: 44px; margin-bottom: 14px; display: grid; place-items: center; flex: none;
  border-radius: 10px; background: var(--pn-white); border: 1px solid var(--pn-hairline); }
.brand .mark { width: 28px; height: 28px; }
.tab { all: unset; box-sizing: border-box; position: relative; width: 60px; padding: 8px 0; border-radius: 10px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 4px; font: 500 11px/1.2 var(--pn-font-ui); color: rgba(43,36,32,.72);
  transition: background var(--pn-fast) var(--pn-ease); }
.tab:hover { background: var(--pn-hover); }
.tab[aria-current="page"] { background: var(--pn-straw); color: var(--pn-ink); }
.tab:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.tab .count.on { position: absolute; top: 4px; right: 8px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: var(--pn-r-badge);
  background: var(--pn-apple); color: #fff; font: 700 10px/16px var(--pn-font-ui); text-align: center; }
.tab.pause { margin-top: auto; color: var(--pn-muted); }

/* ---------- search strip ---------- */
.bar {
  position: fixed; z-index: 2147482000; top: 0; left: 72px; right: 0; height: 56px;
  display: flex; align-items: center; gap: 12px; padding: 0 24px;
  background: var(--pn-white); border-bottom: 1px solid var(--pn-hairline);
}
.search { flex: 1 1 auto; min-width: 0; max-width: 560px; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  border-radius: var(--pn-r-field); background: var(--pn-oat); }
.search:focus-within { box-shadow: inset 0 0 0 2px var(--pn-primary); }
.search svg { width: 16px; height: 16px; color: rgba(43,36,32,.6); }
.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 15px; }
.search input::placeholder { color: var(--pn-muted); }
.bar-end { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.btn-o { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; white-space: nowrap; cursor: pointer;
  border: 1px solid var(--pn-hairline-2); border-radius: var(--pn-r-field); background: var(--pn-white); font-size: 14px; font-weight: 500;
  transition: background var(--pn-fast) var(--pn-ease); }
.btn-o svg { width: 16px; height: 16px; }
.btn-o:hover { background: var(--pn-hover); }
.btn-o:active, .btn:active { opacity: .82; }
.btn-ink { background: var(--pn-primary); border-color: var(--pn-primary); color: #fff; }
.btn-ink:hover { background: #3d342e; }
.btn-ink .count.on { min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--pn-r-badge); background: var(--pn-straw); color: var(--pn-ink);
  font: 700 11px/18px var(--pn-font-ui); text-align: center; }
[data-star] .glyph { color: var(--pn-ink); }
[data-star][aria-pressed="true"] .glyph { color: var(--pn-apple); }

/* ---------- catch-up strip ---------- */
.catchup { position: fixed; z-index: 2147481900; top: 56px; left: 72px; right: 0; height: 48px;
  display: flex; align-items: center; gap: 16px; padding: 0 20px; background: var(--pn-primary); color: #fff; }
.catchup .label { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.catchup .squares { display: flex; gap: 4px; }
.catchup .squares span { width: 14px; height: 14px; }
.catchup .squares .done { background: var(--pn-straw); }
.catchup .squares .cur { background: #fff; }
.catchup .squares .todo { box-shadow: inset 0 0 0 2px rgba(255,255,255,.5); }
.catchup .meta { font: 12px var(--pn-font-mono); color: rgba(255,255,255,.82); white-space: nowrap; }
.catchup button { margin-left: auto; height: 32px; padding: 0 14px; border-radius: 7px; border: 1px solid rgba(255,255,255,.4);
  background: transparent; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; }
.catchup :focus-visible, .toast :focus-visible { outline-color: #fff; }

/* ---------- dock: everything that floats, stacked so nothing overlaps ---------- */
.dock { position: fixed; z-index: 2147482100; left: 96px; bottom: 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  pointer-events: none; }
.dock > * { pointer-events: auto; }

.pill { position: fixed; left: calc(50% + 36px); bottom: 24px; transform: translateX(-50%); display: none; align-items: center; gap: 12px;
  padding: 5px 5px 5px 14px; border-radius: 10px; background: var(--pn-white); border: 1px solid var(--pn-hairline); box-shadow: var(--pn-shadow-pill);
  font-size: 14px; font-weight: 500; white-space: nowrap; }
.pill.on { display: flex; }
.pill button { height: 32px; padding: 0 12px; border: 0; border-radius: 7px; cursor: pointer; background: var(--pn-primary); color: #fff; font-size: 13px; font-weight: 600; }

.toast { display: none; align-items: center; gap: 14px; max-width: 520px; padding: 8px 8px 8px 16px; border-radius: 10px; background: var(--pn-ink);
  color: #fff; box-shadow: var(--pn-shadow-toast); font-size: 14px; }
.toast.on { display: flex; animation: rise var(--pn-base) var(--pn-ease); }
.toast span { padding: 6px 0; }
.toast button { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 7px; cursor: pointer; background: var(--pn-straw); color: var(--pn-ink); font-weight: 600; font-size: 13px; }

/* ---------- listing panel ---------- */
.listing { width: 336px; max-height: 60vh; overflow: auto; background: var(--pn-white); border: 1px solid var(--pn-hairline);
  border-radius: var(--pn-r-panel); box-shadow: var(--pn-shadow-panel); }
.listing > header { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 14px; }
.listing > header .mark { width: 12px; height: 12px; }
.listing > header .tone { width: 6px; height: 6px; display: none; }
.listing.min > header .tone { display: block; }
.listing > header button { margin-left: auto; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--pn-r-small);
  background: transparent; cursor: pointer; color: var(--pn-muted); }
.listing > header button:hover { background: var(--pn-hover); }
.listing > header button svg { width: 16px; height: 16px; transition: transform var(--pn-fast) var(--pn-ease); }
.listing.min > header button svg { transform: rotate(180deg); }
.listing.min > :not(header) { display: none !important; }
.signals ul { list-style: none; margin: 0; padding: 0; }
.signals li { display: grid; grid-template-columns: 6px 1fr; column-gap: 10px; padding: 10px 14px; border-top: 1px solid var(--pn-hairline); }
.marker { width: 6px; height: 6px; margin-top: 6px; background: var(--pn-blueberry); }
[data-tone="warn"] > .marker, .tone[data-tone="warn"] { background: var(--pn-apple); }
[data-tone="good"] > .marker, .tone[data-tone="good"] { background: var(--pn-leaf); }
.tone[data-tone="info"] { background: var(--pn-blueberry); }
.signals li b { font-size: 13px; font-weight: 600; color: var(--pn-info-fg); }
.signals li[data-tone="warn"] b { color: var(--pn-warn-fg); }
.signals li[data-tone="good"] b { color: var(--pn-good-fg); }
.signals li span:not(.marker) { grid-column: 2; font-size: 12px; color: var(--pn-muted); }
.say { padding: 10px 14px 12px; border-top: 1px solid var(--pn-hairline); }
.say-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.say-head button { border: 0; background: none; padding: 4px 0; cursor: pointer; font-size: 12px; color: var(--pn-muted); text-decoration: underline; }
.starters { display: grid; gap: 2px; }
.starter { all: unset; box-sizing: border-box; position: relative; display: block; width: 100%; padding: 8px 22px 8px 6px; border-radius: var(--pn-r-small);
  cursor: pointer; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.starter::after { content: "→"; position: absolute; right: 6px; top: 8px; color: var(--pn-muted); }
.starter:hover { background: var(--pn-oat); }
.starter:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 0; }

/* ---------- mobile tab bar ---------- */
.tabbar { display: none; grid-template-columns: repeat(4, 1fr); height: 64px; padding: 6px; border-radius: var(--pn-r-bar);
  background: var(--pn-white); border: 1px solid var(--pn-hairline); box-shadow: 0 6px 20px rgba(43,36,32,.14); }
.tabbar a, .tabbar button { all: unset; position: relative; cursor: pointer; display: grid; place-items: center; align-content: center; gap: 3px;
  border-radius: 9px; font: 500 11px/1.2 var(--pn-font-ui); color: rgba(43,36,32,.72); }
.tabbar svg { width: 18px; height: 18px; }
.tabbar [aria-current="page"] { background: var(--pn-straw); color: var(--pn-ink); }
.tabbar :focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.tabbar .count.on { position: absolute; top: 4px; right: calc(50% - 22px); min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px;
  background: var(--pn-apple); color: #fff; font: 700 10px/18px var(--pn-font-ui); text-align: center; }

/* ---------- sheet ---------- */
.scrim { position: fixed; inset: 0; z-index: 2147482500; background: var(--pn-scrim); opacity: 0; pointer-events: none;
  transition: opacity var(--pn-slow) var(--pn-ease); }
.scrim.on { opacity: 1; pointer-events: auto; }
.sheet { position: fixed; z-index: 2147482600; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); display: flex; flex-direction: column;
  background: var(--pn-oat); transform: translateX(100%); visibility: hidden;
  transition: transform var(--pn-slow) var(--pn-ease), visibility 0s linear var(--pn-slow); }
.sheet.on { transform: none; visibility: visible; transition: transform var(--pn-slow) var(--pn-ease); }
.sheet[data-mode="shortlist"] { width: min(760px, 100vw); }
.sheet > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px 8px; }
.sheet h2 { margin: 0; font-size: var(--pn-text-2xl); font-weight: 700; letter-spacing: -.03em; }
.icon-btn { flex: none; width: 40px; height: 40px; display: grid; place-items: center; cursor: pointer; border: 1px solid var(--pn-hairline-2);
  border-radius: var(--pn-r-field); background: var(--pn-white); }
.icon-btn:hover { background: #f8f5ef; }
.icon-btn.small { width: 32px; height: 32px; border-radius: var(--pn-r-small); }
.icon-btn.small svg { width: 14px; height: 14px; }
.body { overflow: auto; padding: 0 24px 24px; overscroll-behavior: contain; }
.sheet[data-mode="shortlist"] .body > :not([data-for~="shortlist"]),
.sheet[data-mode="results"] .body > :not([data-for~="results"]),
.sheet[data-mode="filters"] .body > :not([data-for~="filters"]) { display: none; }
section { padding: 14px 0; border-top: 1px solid var(--pn-hairline); }
section > h3 { margin-bottom: 8px; }
.hint { margin: 4px 0 10px; font-size: 13px; color: var(--pn-muted); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 6px 0; cursor: pointer; }
.row .label { font-size: 15px; font-weight: 500; }
.row .sub { display: block; font-size: 13px; font-weight: 400; color: var(--pn-muted); }
.switch { position: relative; width: 46px; height: 26px; flex: none; }
.switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.switch i { position: absolute; inset: 0; border-radius: var(--pn-r-switch); background: var(--pn-off-track); pointer-events: none;
  transition: background var(--pn-base) var(--pn-ease); }
.switch i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 5px; background: #fff;
  transition: transform var(--pn-base) var(--pn-ease), background var(--pn-base) var(--pn-ease); }
.switch input:checked + i { background: var(--pn-primary); }
.switch input:checked + i::after { transform: translateX(20px); background: var(--pn-oat); }
.switch input:focus-visible + i { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.prices { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
.field { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; border-radius: var(--pn-r-field); background: var(--pn-white);
  border: 1px solid var(--pn-hairline-2); }
.field:focus-within { border-color: var(--pn-primary); box-shadow: inset 0 0 0 1px var(--pn-primary); }
.field > span { color: var(--pn-muted); font-size: 13px; }
.field svg { width: 16px; height: 16px; color: var(--pn-muted); }
.field input { flex: 1; width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 15px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { display: inline-flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px 0 10px; border-radius: var(--pn-r-small);
  background: var(--pn-primary); color: #fff; font-size: 13px; font-weight: 500; }
.chip button { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: var(--pn-r-badge); display: grid; place-items: center; }
.chip button:hover { background: rgba(255,255,255,.16); }
.chip button svg { width: 12px; height: 12px; }
.suggest { all: unset; cursor: pointer; display: inline-flex; align-items: center; height: 32px; padding: 0 10px; border-radius: var(--pn-r-small);
  border: 1px dashed rgba(43,36,32,.35); font-size: 13px; color: var(--pn-ink); }
.suggest:hover { border-style: solid; }
.suggest:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 16px; cursor: pointer;
  border: 1px solid var(--pn-hairline-2); border-radius: var(--pn-r-field); background: var(--pn-white); font-size: 14px; font-weight: 500; }
.btn:hover { background: #f8f5ef; }
.btn.primary { background: var(--pn-primary); border-color: var(--pn-primary); color: #fff; }
.btn.primary:hover { background: #3d342e; }
.btn.block { width: 100%; }
.btn svg { width: 16px; height: 16px; }
.btn .count.on { font-weight: 700; }
.btn-row { display: flex; gap: 8px; margin-top: 12px; }
.btn-row .btn { flex: 1; }
.link { all: unset; cursor: pointer; font-size: 13px; color: var(--pn-ink); text-decoration: underline; text-underline-offset: 2px; }
.link:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.small-btn { height: 32px; padding: 0 12px; cursor: pointer; border: 1px solid var(--pn-hairline-2); border-radius: var(--pn-r-small);
  background: var(--pn-white); font-size: 13px; font-weight: 500; }
.small-btn:disabled { cursor: default; border-style: dashed; background: transparent; color: rgba(43,36,32,.4); }
.stat { display: flex; justify-content: space-between; align-items: center; min-height: 44px; font-size: 15px; }
.stat b { margin-left: 6px; }
.danger { all: unset; cursor: pointer; margin-top: 8px; font-size: 13px; color: var(--pn-warn-fg); text-decoration: underline; text-underline-offset: 2px; }
.danger:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.foot { display: grid; gap: 12px; padding-top: 14px; border-top: 1px solid var(--pn-hairline); }
.foot nav { display: flex; gap: 16px; }
.credit { margin: 10px 0 0; font-size: 11px; color: var(--pn-muted); }

/* distance */
.home-suggest { display: grid; margin-top: 4px; background: var(--pn-white); border: 1px solid var(--pn-hairline); border-radius: var(--pn-r-field);
  box-shadow: var(--pn-shadow-pill); overflow: hidden; }
.home-suggest:empty { display: none; }
.home-suggest button { all: unset; cursor: pointer; padding: 10px 12px; font-size: 14px; }
.home-suggest button:first-child, .home-suggest button:hover { background: var(--pn-oat); }
.home-suggest button:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: -2px; }
.km-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 15px; }
.km-row .field { width: 120px; }
[data-distance-status] { margin: 10px 0; font-size: 13px; color: var(--pn-muted); }
[data-distance-status][data-tone="warn"] { padding: 8px 10px; border-radius: var(--pn-r-small); background: var(--pn-warn-bg); color: var(--pn-warn-fg); }
.distance-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

/* watched searches and New for you */
.watches, .results { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.watches li { display: flex; align-items: center; gap: 6px; }
.watches .empty, .results .empty { display: block; font-size: 14px; color: var(--pn-muted); }
.watch { all: unset; box-sizing: border-box; cursor: pointer; flex: 1; display: grid; gap: 2px; padding: 10px 12px; border-radius: var(--pn-r-field);
  background: var(--pn-white); }
.watch b { font-size: 14px; font-weight: 500; }
.watch span { font-size: 13px; color: var(--pn-muted); }
.watch:focus-visible { outline: 2px solid var(--pn-primary); outline-offset: 2px; }
.results a { display: flex; gap: 12px; align-items: center; padding: 8px; border-radius: 10px; background: var(--pn-white); }
.results img, .results .ph { width: 64px; height: 64px; border-radius: var(--pn-r-small); object-fit: cover; background: #f0ece4; flex: none; }
.results .txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
.results .price { font-size: 15px; font-weight: 700; }
.results .title { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.results small { font: 11px var(--pn-font-mono); color: var(--pn-muted); }
.badge { align-self: flex-start; padding: 3px 6px; border-radius: var(--pn-r-badge); font-size: 11px; font-weight: 600; color: #fff; background: var(--pn-blueberry); }
.badge.drop { background: var(--pn-apple); }

/* shortlist compare */
.compare { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(180px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.compare article { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: var(--pn-r-panel); background: var(--pn-white); font-size: 13px; }
.compare .best { display: flex; flex-wrap: wrap; gap: 4px; min-height: 21px; }
.compare [data-best] { padding: 3px 6px; line-height: 15px; border-radius: var(--pn-r-badge); background: var(--pn-leaf); color: #fff; font-size: 11px; font-weight: 600; }
.compare img, .compare .ph { width: 100%; height: 150px; border-radius: var(--pn-r-field); object-fit: cover; background: #f0ece4; display: block; }
.compare .price { display: flex; align-items: center; gap: 6px; font-size: 20px; font-weight: 700; }
.compare .title a { text-decoration: underline; text-underline-offset: 2px; }
.compare dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
.compare dt { color: var(--pn-muted); }
.compare dd { margin: 0; }
.chips-sm { display: flex; flex-wrap: wrap; gap: 4px; }
.chips-sm span { padding: 3px 7px; border-radius: var(--pn-r-small); font-size: 12px; background: var(--pn-info-bg); color: var(--pn-info-fg); }
.chips-sm span[data-tone="warn"] { background: var(--pn-warn-bg); color: var(--pn-warn-fg); }
.chips-sm span[data-tone="good"] { background: var(--pn-good-bg); color: var(--pn-good-fg); }
.compare .none { color: var(--pn-muted); }
.compare [data-unstar] { margin-top: auto; }

/* starter editor */
code { padding: 1px 4px; border-radius: var(--pn-r-badge); background: var(--pn-straw); font: 12px var(--pn-font-mono); }
.starter-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
.starter-list li { display: flex; gap: 8px; align-items: center; padding: 6px 6px 6px 12px; border-radius: var(--pn-r-field); background: var(--pn-white); font-size: 14px; }
.starter-list li span { flex: 1; min-width: 0; }
.starter-list li.empty { background: transparent; padding-left: 0; color: var(--pn-muted); }
.starter-form textarea { display: block; width: 100%; padding: 10px 12px; resize: vertical; border-radius: var(--pn-r-field); background: var(--pn-white);
  border: 1px solid var(--pn-hairline-2); font-size: 15px; outline: 0; }
.starter-form textarea:focus { border-color: var(--pn-primary); box-shadow: inset 0 0 0 1px var(--pn-primary); }
.starter-form .under { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.starter-form .under span { font: 12px var(--pn-font-mono); color: var(--pn-muted); }
.starter-form .btn { height: 36px; }

@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }

@media (max-width: 760px) {${phone('')}}
${phone('.compact ')}
.compact .bar, .compact .catchup { display: none; }
`;

  // Short reason for the pill ("3 hidden · left-out words"). Card labels live in page.css.
  const REASON_LABEL = {
    hidden: 'hidden by you',
    sold: 'sold',
    keyword: 'left-out words',
    price: 'over your price',
    distance: 'too far',
    shipped: 'ships only',
    viewed: 'opened before',
    junk: 'not for sale',
    'not-new': 'not new',
  };

  function ago(ms, now) {
    const d = Math.max(0, now - ms);
    if (d < 3600000) return Math.max(1, Math.round(d / 60000)) + 'm';
    if (d < 86400000) return Math.round(d / 3600000) + 'h';
    return Math.round(d / 86400000) + 'd';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Escaped text with the {title} and {price} tokens shown as mono chips.
  const tokens = (t) => esc(t).replace(/\{(title|price)\}/g, '<code>{$1}</code>');

  function toggle(name, label, sub) {
    return `<label class="row"><span class="label">${label}<span class="sub">${sub}</span></span>
      <span class="switch"><input type="checkbox" role="switch" name="${name}"><i></i></span></label>`;
  }

  function template() {
    return `
<div class="root">
  <nav class="tabs" aria-label="punnet">
    <a class="brand" href="/marketplace/" aria-label="punnet, Browse">${ICON.mark}</a>
    <a class="tab" data-tab="browse" href="/marketplace/">${ICON.browse}Browse</a>
    <a class="tab" data-tab="saved" href="/marketplace/you/saved/">${ICON.saved}Saved</a>
    <a class="tab" data-tab="inbox" href="/marketplace/inbox/">${ICON.inbox}Inbox</a>
    <button class="tab" type="button" data-open-watching aria-haspopup="dialog" hidden>${ICON.watching}Watching<span class="count" data-watch-count></span></button>
    <button class="tab" type="button" data-open-shortlist aria-haspopup="dialog" hidden>${ICON.shortlist}Shortlist<span class="count on" data-shortlist-count></span></button>
    <button class="tab filters-btn" type="button" data-open-sheet aria-haspopup="dialog">${ICON.filters}Filters<span class="count" data-count></span></button>
    <button class="tab pause" type="button" data-pause>${ICON.pause}Pause</button>
  </nav>

  <header class="bar">
    <form class="search" role="search">
      ${ICON.search}
      <input name="q" type="search" placeholder="Search Marketplace" autocomplete="off" enterkeyhint="search" aria-label="Search Marketplace">
    </form>
    <button class="btn-o" type="button" data-watch hidden>${ICON.watching}Watch this search</button>
    <div class="bar-end">
      <button class="btn-o btn-ink" type="button" data-catchup hidden>Catch up<span class="count on" data-catchup-count></span></button>
      <button class="btn-o" type="button" data-star hidden aria-pressed="false" aria-label="Shortlist"></button>
    </div>
  </header>

  <div class="catchup" data-catchup-progress role="status" aria-live="polite" hidden>
    <span class="label" data-toast-text></span>
    <div class="squares" aria-hidden="true" data-catchup-squares></div>
    <span class="meta" data-catchup-meta></span>
    <button type="button" data-stop-catchup>Stop</button>
  </div>

  <div class="dock">
    <div class="listing" data-listing-panel hidden>
      <header>${ICON.mark}<span class="eyebrow" data-panel-title>Things to know</span><span class="tone" aria-hidden="true" data-panel-tone></span>
        <button type="button" data-minimise aria-expanded="true" aria-label="Minimise panel">${ICON.chevron}</button></header>
      <aside class="signals" data-signals hidden aria-label="Things to know about this listing">
        <ul data-signal-list></ul>
      </aside>
      <section class="say" data-starters hidden aria-label="Message starters">
        <div class="say-head"><span class="eyebrow">Say hi</span><button type="button" data-edit-starters>Edit</button></div>
        <div class="starters" data-starter-buttons></div>
      </section>
    </div>
    <div class="toast" role="status" aria-live="polite"><span data-toast-text></span><button type="button" data-toast-action hidden></button></div>
    <div class="pill" role="status"><span data-pill-text></span><button type="button" data-reveal>Show</button></div>
    <nav class="tabbar" aria-label="punnet">
      <a data-tab="browse" href="/marketplace/">${ICON.browse}Browse</a>
      <a data-tab="saved" href="/marketplace/you/saved/">${ICON.saved}Saved</a>
      <a data-tab="inbox" href="/marketplace/inbox/">${ICON.inbox}Inbox</a>
      <button type="button" data-open-sheet aria-haspopup="dialog">${ICON.filters}Filters<span class="count" data-count></span></button>
    </nav>
  </div>

  <div class="scrim" data-close-sheet></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mm-sheet-title" data-mode="filters">
    <header><h2 id="mm-sheet-title">Your filters</h2>
      <button class="icon-btn" type="button" data-close-sheet aria-label="Close filters">${ICON.close}</button></header>
    <div class="body">
      <section data-for="shortlist" data-shortlist>
        <p class="hint" data-shortlist-hint></p>
        <div class="compare" data-compare></div>
      </section>
      <section data-for="results" data-results hidden>
        <h3>New for you</h3>
        <p class="hint" data-results-hint></p>
        <ul class="results" data-results-list></ul>
        <div class="btn-row">
          <button class="btn" type="button" data-catchup-sheet>Catch up again</button>
          <button class="btn primary" type="button" data-clear-results>Done, clear these</button>
        </div>
      </section>
      <section data-for="results" data-watch-section>
        <h3>Watched searches</h3>
        <p class="hint">Catch up opens each one in this tab, newest first, and keeps only what you haven’t seen. Nothing runs while you’re away.</p>
        <ul class="watches" data-watch-list></ul>
      </section>
      <section data-for="filters">
        <h3>Order</h3>
        ${toggle('newestFirst', 'Newest first', 'Searches open sorted by date listed')}
        ${toggle('onlyNew', 'Only show new', 'Hide everything you’ve already scrolled past')}
      </section>
      <section data-for="filters">
        <h3>Price</h3>
        <div class="prices">
          <label class="field"><span>Min</span><input name="minPrice" type="number" inputmode="numeric" min="0" placeholder="0"></label>
          <span aria-hidden="true">–</span>
          <label class="field"><span>Max</span><input name="maxPrice" type="number" inputmode="numeric" min="0" placeholder="Any"></label>
        </div>
      </section>
      <section data-for="filters">
        <h3>Leave out words</h3>
        <form data-word-form><label class="field"><input name="word" placeholder="Add a word or phrase, then Enter" autocomplete="off" maxlength="60" aria-label="Add a word to leave out"></label></form>
        <div class="chips" data-chips></div>
      </section>
      <section data-for="filters">
        <h3>Clean up</h3>
        ${toggle('hideSold', 'Hide sold and pending', 'Gone already? Gone from view.')}
        ${toggle('hideViewed', 'Hide listings I’ve opened', 'Otherwise they get a small “Seen” tag')}
        ${toggle('hideShipped', 'Hide shipped listings', 'Local pickup only')}
      </section>
      <section data-for="filters" data-distance>
        <h3>Distance</h3>
        <form data-home-form><label class="field">${ICON.pin}<input name="home" placeholder="Your suburb, e.g. Fremantle" autocomplete="off" maxlength="80" aria-label="Your suburb"></label></form>
        <div class="home-suggest" data-home-suggest></div>
        <div class="km-row">
          <span>Only show within</span>
          <label class="field"><input name="maxKm" type="number" inputmode="numeric" min="1" placeholder="Any" aria-label="Kilometres"><span>km</span></label>
        </div>
        <p data-distance-status></p>
        <div class="distance-actions">
          <button class="small-btn" type="button" data-clear-home>Clear suburb</button>
          <button class="link" type="button" data-open-location>Use Facebook’s location panel</button>
        </div>
        <p class="credit">Suburb data © GeoNames, CC BY 4.0</p>
      </section>
      <section data-for="filters">
        <h3>Smarter</h3>
        ${toggle('hideJunk', 'Hide non-sale posts', 'Wanted, swaps, $1 prices, sponsored')}
        ${toggle('tidySaved', 'Tidy my Saved', 'Sold and gone items step aside')}
        <button class="btn block" type="button" data-open-shortlist>Compare shortlist · <span class="count on" data-shortlist-count></span></button>
      </section>
      <section data-for="filters" data-starter-section>
        <h3 data-starter-title>Message starters</h3>
        <p class="hint">On a listing, one tap puts your words in Facebook’s message box. You read it and press Send. <code>{title}</code> and <code>{price}</code> fill in from the listing.</p>
        <ul class="starter-list" data-starter-list></ul>
        <form class="starter-form" data-starter-form>
          <textarea name="starter" rows="3" maxlength="300" placeholder="Add a starter" aria-label="Add a message starter"></textarea>
          <div class="under"><span data-starter-counter>0 / 300</span><button class="btn primary" type="submit">Add</button></div>
        </form>
        <p class="hint" data-starter-max hidden>That’s the max of 6.</p>
      </section>
      <section data-for="filters">
        <h3>Your history</h3>
        <div class="stat"><span>Hidden by you<b data-hidden-stat>0</b></span><button class="small-btn" type="button" data-restore>Restore all</button></div>
        <div class="stat"><span>Opened before<b data-viewed-stat>0</b></span><button class="small-btn" type="button" data-clear-viewed>Clear</button></div>
        <button class="danger" type="button" data-clear-memory>Forget price history and “new since”</button>
        <p class="hint">Stored only in this browser. Nothing leaves your device.</p>
      </section>
      <div class="foot" data-for="filters">
        <nav><a class="link" href="/settings/">Facebook account</a><a class="link" href="/messages/">All messages</a></nav>
        <button class="btn block" type="button" data-pause>Pause punnet</button>
      </div>
    </div>
  </div>
</div>`;
  }

  /**
   * Mount the shell. opts.compact = mobile-site layout (no top bar). handlers: { onSearch(q), onSettings(patch),
   *   onRestoreHidden(), onClearViewed(), onToggleStar(id|null), onUnstar(id), onStarter(i), onStarters(list),
   *   onPause(), onOpenLocation(), onToggleReveal(), onWatch(), onUnwatch(id), onOpenWatch(id), onCatchup(),
   *   onStopCatchup(), onClearResults(), onClearMemory() }
   */
  function mount(doc, handlers, opts) {
    const host = doc.createElement('div');
    host.setAttribute('data-mm-ui', 'shell');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${template()}`;
    const compact = !!(opts && opts.compact);
    if (compact) shadow.querySelector('.root').classList.add('compact');
    doc.documentElement.appendChild(host);
    const places = root.MarketMode && root.MarketMode.places;
    const MAX_STARTERS = (root.MarketMode && root.MarketMode.starters && root.MarketMode.starters.MAX) || 6;
    const call = (name, ...args) => handlers[name] && handlers[name](...args);

    const $ = (s) => shadow.querySelector(s);
    const $$ = (s) => [...shadow.querySelectorAll(s)];
    const sheet = $('.sheet');
    const scrim = $('.scrim');
    const panel = $('[data-listing-panel]');
    let lastFocus = null;
    let toastTimer = 0;
    let toastAction = null;
    let state = { settings: null };

    const TITLES = { results: 'New for you', shortlist: 'Your shortlist' };
    function openSheet(mode) {
      lastFocus = doc.activeElement;
      const m = mode === 'shortlist' || mode === 'results' ? mode : mode === 'watching' ? 'results' : 'filters';
      sheet.setAttribute('data-mode', m);
      sheet.classList.add('on');
      scrim.classList.add('on');
      $('.sheet .body').scrollTop = 0;
      $('#mm-sheet-title').textContent = TITLES[m] || 'Your filters';
      $('.sheet .icon-btn').setAttribute('aria-label', m === 'filters' ? 'Close filters' : `Close ${TITLES[m].toLowerCase()}`);
      if (mode === 'starters') {
        const sec = $('[data-starter-section]');
        if (sec.scrollIntoView) sec.scrollIntoView({ block: 'start' });
      }
      setTimeout(() => $('.sheet .icon-btn').focus(), 30);
    }
    function closeSheet() {
      sheet.classList.remove('on');
      scrim.classList.remove('on');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    const isOpen = () => sheet.classList.contains('on');

    $$('[data-open-sheet]').forEach((b) => b.addEventListener('click', () => openSheet()));
    $('[data-open-watching]').addEventListener('click', () => openSheet('watching'));
    $('[data-watch]').addEventListener('click', () => call('onWatch'));
    $('[data-catchup]').addEventListener('click', () => call('onCatchup'));
    $('[data-catchup-sheet]').addEventListener('click', () => call('onCatchup'));
    $('[data-stop-catchup]').addEventListener('click', () => call('onStopCatchup'));
    $('[data-clear-results]').addEventListener('click', () => call('onClearResults'));
    $('[data-clear-memory]').addEventListener('click', () => call('onClearMemory'));
    $('[data-watch-list]').addEventListener('click', (e) => {
      const open = e.target.closest('[data-open-watch]');
      const rm = e.target.closest('[data-unwatch]');
      if (rm) call('onUnwatch', rm.getAttribute('data-unwatch'));
      else if (open) call('onOpenWatch', open.getAttribute('data-open-watch'));
    });
    $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheet));

    // Shortlist and compare
    $('[data-star]').addEventListener('click', () => call('onToggleStar', null));
    $$('[data-open-shortlist]').forEach((b) => b.addEventListener('click', () => openSheet('shortlist')));
    $('[data-compare]').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-unstar]');
      if (rm) call('onUnstar', rm.getAttribute('data-unstar'));
    });

    // Listing panel: minimise keeps just the header row.
    $('[data-minimise]').addEventListener('click', () => {
      const min = !panel.classList.contains('min');
      panel.classList.toggle('min', min);
      $('[data-minimise]').setAttribute('aria-expanded', String(!min));
      $('[data-minimise]').setAttribute('aria-label', min ? 'Open panel' : 'Minimise panel');
    });

    // Message starters
    $('[data-starter-buttons]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-starter]');
      if (b) call('onStarter', Number(b.getAttribute('data-starter')));
    });
    $('[data-edit-starters]').addEventListener('click', () => openSheet('starters'));
    const starterBox = $('[data-starter-form] textarea');
    const addStarter = () => {
      const t = starterBox.value.trim();
      if (!t) return;
      call('onStarters', [...(state.starters || []), t]);
      starterBox.value = '';
      countStarter();
    };
    const countStarter = () => ($('[data-starter-counter]').textContent = `${starterBox.value.length} / 300`);
    starterBox.addEventListener('input', countStarter);
    starterBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addStarter();
      }
    });
    $('[data-starter-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      addStarter();
    });
    $('[data-starter-list]').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove-starter]');
      if (rm) {
        const i = Number(rm.getAttribute('data-remove-starter'));
        call('onStarters', (state.starters || []).filter((_, j) => j !== i));
      }
    });

    // Strict distance: home suburb (with suggestions from the bundled table) and a radius
    const homeInput = $('[data-home-form] input');
    let unplaced = null;
    homeInput.addEventListener('input', () => {
      unplaced = null;
      renderSuggestions(homeInput.value);
    });
    $('[data-home-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = homeInput.value.trim();
      if (!v) return;
      const p = places && (places.resolve(v) || places.resolve(places.suggest(v, 1)[0] || ''));
      if (p) setHome(places.label(p));
      else {
        unplaced = v;
        renderSuggestions('');
        renderDistance();
      }
    });
    $('[data-home-suggest]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick-home]');
      if (b) setHome(b.getAttribute('data-pick-home'));
    });
    $('[data-clear-home]').addEventListener('click', () => {
      homeInput.value = '';
      unplaced = null;
      renderSuggestions('');
      call('onSettings', { home: null, maxKm: null });
    });
    $('.km-row input').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      call('onSettings', { maxKm: v === '' ? null : Number(v) });
    });
    function setHome(label) {
      homeInput.value = label;
      unplaced = null;
      renderSuggestions('');
      call('onSettings', { home: label });
    }
    function renderSuggestions(q) {
      const list = places && q.trim().length >= 2 ? places.suggest(q, 6) : [];
      const exact = list.length === 1 && list[0] === q.trim();
      $('[data-home-suggest]').innerHTML = exact
        ? ''
        : list.map((l) => `<button type="button" data-pick-home="${esc(l)}">${esc(l)}</button>`).join('');
    }

    $('.search').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('.search input').value.trim();
      if (q) call('onSearch', q);
    });

    for (const input of $$('.switch input')) {
      input.addEventListener('change', () => call('onSettings', { [input.name]: input.checked }));
    }
    for (const input of $$('.prices input')) {
      input.addEventListener('change', () => {
        const v = input.value.trim();
        call('onSettings', { [input.name]: v === '' ? null : Number(v) });
      });
    }
    $('[data-word-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('[data-word-form] input');
      const word = input.value.trim();
      if (!word) return;
      call('onSettings', { exclusions: [...state.settings.exclusions, word] });
      input.value = '';
    });
    $('[data-chips]').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      const add = e.target.closest('[data-add]');
      const list = state.settings.exclusions;
      if (rm) call('onSettings', { exclusions: list.filter((w) => w !== rm.getAttribute('data-remove')) });
      if (add) call('onSettings', { exclusions: [...list, add.getAttribute('data-add')] });
    });
    $('[data-restore]').addEventListener('click', () => call('onRestoreHidden'));
    $('[data-clear-viewed]').addEventListener('click', () => call('onClearViewed'));
    $$('[data-pause]').forEach((b) => b.addEventListener('click', () => call('onPause')));
    $('[data-open-location]').addEventListener('click', () => {
      closeSheet();
      call('onOpenLocation');
    });
    $('[data-reveal]').addEventListener('click', () => call('onToggleReveal'));
    $('[data-toast-action]').addEventListener('click', () => {
      const fn = toastAction;
      hideToast();
      if (fn) fn();
    });

    // Keyboard: "/" to search, Escape to close, Tab stays inside the open sheet.
    const onKey = (e) => {
      const t = e.composedPath()[0];
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !compact) {
        e.preventDefault();
        $('.search input').focus();
      } else if (e.key === 'Escape' && isOpen()) {
        closeSheet();
      } else if (e.key === 'Tab' && isOpen()) {
        const items = $$('.sheet button, .sheet input, .sheet textarea, .sheet a').filter((el) => !el.hidden && !el.disabled && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = shadow.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    doc.addEventListener('keydown', onKey, true);

    function hideToast() {
      $('.toast').classList.remove('on');
      toastAction = null;
    }

    function toast(text, actionLabel, action) {
      clearTimeout(toastTimer);
      $('.toast [data-toast-text]').textContent = text;
      const btn = $('[data-toast-action]');
      btn.hidden = !actionLabel;
      btn.textContent = actionLabel || '';
      toastAction = action || null;
      $('.toast').classList.add('on');
      toastTimer = setTimeout(hideToast, 5000);
    }

    /** Render everything from state: {settings, tab, query, stats, hiddenCount, viewedCount, reveal, ...} */
    function render(next) {
      state = Object.assign(state, next);
      const s = state.settings;
      if (!s) return;
      for (const input of $$('.switch input')) input.checked = Boolean(s[input.name]);
      for (const input of $$('.prices input')) {
        if (shadow.activeElement !== input) input.value = s[input.name] == null ? '' : String(s[input.name]);
      }
      const searchInput = $('.search input');
      if (shadow.activeElement !== searchInput && state.query != null) searchInput.value = state.query;

      const chips = s.exclusions.map(
        (w) => `<span class="chip">${esc(w)}<button type="button" data-remove="${esc(w)}" aria-label="Stop leaving out ${esc(w)}">${ICON.close}</button></span>`
      );
      const suggestions = SUGGESTED_WORDS.filter((w) => !s.exclusions.includes(w))
        .slice(0, Math.max(0, 4 - s.exclusions.length))
        .map((w) => `<button class="suggest" type="button" data-add="${esc(w)}">+ ${esc(w)}</button>`);
      $('[data-chips]').innerHTML = chips.concat(suggestions).join('');

      for (const a of $$('[data-tab]')) {
        if (a.getAttribute('data-tab') === state.tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }

      const active = activeFilterCount(s);
      for (const c of $$('[data-count]')) {
        c.textContent = active ? String(active) : '';
        c.classList.toggle('on', active > 0);
        c.parentElement.setAttribute('aria-label', active ? `Filters, ${active} on` : 'Filters');
      }

      const stats = state.stats || { hidden: 0, reasons: {} };
      const pill = $('.pill');
      pill.classList.toggle('on', stats.hidden > 0);
      if (stats.hidden > 0) {
        const top = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])[0];
        $('[data-pill-text]').textContent =
          `${stats.hidden} hidden` + (top && Object.keys(stats.reasons).length === 1 ? ` · ${REASON_LABEL[top[0]] || top[0]}` : '');
        const reveal = $('[data-reveal]');
        reveal.textContent = state.reveal ? 'Tidy up' : 'Show';
        reveal.classList.toggle('on', !!state.reveal);
      }

      const h = state.hiddenCount || 0;
      const v = state.viewedCount || 0;
      $('[data-hidden-stat]').textContent = String(h);
      $('[data-viewed-stat]').textContent = String(v);
      setClear($('[data-restore]'), h === 0, 'Restore all');
      setClear($('[data-clear-viewed]'), v === 0, 'Clear');

      renderWatches();
      renderCatchup();
      renderResults();
      renderSignals();
      renderDistance();
      renderShortlist();
      renderStarters();
      const noSignals = $('[data-signals]').hidden;
      panel.hidden = noSignals && $('[data-starters]').hidden;
      const sig = state.kind === 'item' ? state.signals || [] : [];
      $('[data-panel-title]').textContent = sig.length ? `Things to know · ${sig.length}` : 'Message the seller';
      const tone = sig.some((x) => x.tone === 'warn') ? 'warn' : sig.some((x) => x.tone === 'good') ? 'good' : 'info';
      $('[data-panel-tone]').setAttribute('data-tone', tone);
      $('[data-panel-tone]').hidden = !sig.length;
    }

    function setClear(btn, empty, label) {
      btn.disabled = empty;
      if (empty) btn.setAttribute('aria-label', `${label}, nothing to clear`);
      else btn.removeAttribute('aria-label');
    }

    function renderDistance() {
      const s = state.settings;
      const homeInput = $('[data-home-form] input');
      if (shadow.activeElement !== homeInput && !unplaced && homeInput.value !== (s.home || '')) homeInput.value = s.home || '';
      const kmInput = $('.km-row input');
      if (shadow.activeElement !== kmInput) kmInput.value = s.maxKm == null ? '' : String(s.maxKm);
      const unknown = (state.stats && state.stats.unknownPlaces) || 0;
      const status = $('[data-distance-status]');
      let msg;
      let warn = false;
      const cantPlace = (v) => `We can’t place “${v}”. Try the suburb with its state, like “Fremantle WA”.`;
      if (unplaced) { msg = cantPlace(unplaced); warn = true; }
      else if (!s.home) msg = 'Set your suburb to see distances on listings.';
      else if (places && !places.resolve(s.home)) { msg = cantPlace(s.home); warn = true; }
      else {
        msg = `From ${s.home}` + (s.maxKm ? ` · within ${s.maxKm} km` : ' · showing distances only');
        if (unknown) msg += ` · ${unknown} on this page we can’t place, so they stay.`;
      }
      status.textContent = msg;
      if (warn) status.setAttribute('data-tone', 'warn');
      else status.removeAttribute('data-tone');
      $('[data-clear-home]').hidden = !s.home && !homeInput.value;
    }

    function renderShortlist() {
      const list = state.shortlist || [];
      const rows = state.compare || [];
      for (const c of $$('[data-shortlist-count]')) c.textContent = String(list.length);
      // The rail item only appears once there's something to compare; the sheet one always shows.
      const railItem = $('.tabs [data-open-shortlist]');
      railItem.hidden = list.length === 0;
      railItem.setAttribute('aria-label', `Shortlist, ${list.length}`);
      const star = $('[data-star]');
      star.hidden = !state.canStar;
      star.setAttribute('aria-pressed', String(!!state.itemStarred));
      star.innerHTML = state.itemStarred
        ? '<span class="glyph" aria-hidden="true">★</span><span class="txt"> Shortlisted</span>'
        : '<span class="glyph" aria-hidden="true">☆</span><span class="txt"> Shortlist</span>';
      $('[data-shortlist-hint]').textContent = rows.length
        ? rows.length === 1
          ? 'Star one more to compare.'
          : `${rows.length} listings, side by side. Open a listing to refresh its hints.`
        : 'Star listings to compare them here.';
      const key = JSON.stringify(rows);
      const box = $('[data-compare]');
      if (box.getAttribute('data-key') === key) return;
      box.setAttribute('data-key', key);
      box.innerHTML = rows
        .map((r, i) => {
          const photo = r.img && /^https:\/\//.test(r.img) ? `<img src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>';
          const cur = (/^[^\d]*/.exec(r.priceText || '') || [''])[0].replace(/free/i, '').trim();
          const marks = [['price', 'Lowest'], ['km', 'Nearest'], ['warnings', 'Fewest warnings']]
            .filter(([k]) => (r.best || []).includes(k))
            .map(([k, label]) => `<span data-best="${k}">${label}</span>`)
            .join('');
          const hints = r.signals
            ? r.signals.length
              ? `<span class="chips-sm">${r.signals.map((x) => `<span data-tone="${esc(x.tone)}">${esc(x.label)}</span>`).join('')}</span>`
              : '<span class="none">Nothing flagged</span>'
            : '<span class="none">Open the listing to check</span>';
          const title = r.href ? `<a href="${esc(r.href)}">${esc(r.title)}</a>` : esc(r.title);
          const drop = r.drop > 0 ? `<span class="badge drop">↓ ${esc(cur)}${Math.round(r.drop).toLocaleString('en-AU')}</span>` : '';
          return (
            `<article data-compare-item="${esc(r.id)}" aria-label="${i + 1} of ${rows.length}"><div class="best">${marks}</div>${photo}` +
            `<div class="price">${esc(r.priceText || '—')}${drop}</div>` +
            `<div class="title">${title}</div>` +
            `<dl><dt>Seen for</dt><dd>${esc(r.age || '—')}</dd>` +
            `<dt>Where</dt><dd>${esc(r.location || '—')}${r.kmText ? ' · ' + esc(r.kmText) : ''}</dd></dl>` +
            hints +
            `<button class="small-btn" type="button" data-unstar="${esc(r.id)}">Remove</button></article>`
          );
        })
        .join('');
    }

    function renderStarters() {
      const list = state.starters || [];
      const onItem = state.kind === 'item' && !!state.item;
      const tray = $('[data-starters]');
      tray.hidden = !onItem || list.length === 0;
      const key = JSON.stringify([list, onItem && state.item.title, onItem && state.item.priceText]);
      if (tray.getAttribute('data-key') !== key) {
        tray.setAttribute('data-key', key);
        const fill = root.MarketMode && root.MarketMode.starters ? root.MarketMode.starters.fill : (t) => t;
        $('[data-starter-buttons]').innerHTML = onItem
          ? list
              .map((t, i) => {
                const text = fill(t, state.item);
                return `<button class="starter" type="button" data-starter="${i}" title="${esc(text)}">${esc(text)}</button>`;
              })
              .join('')
          : '';
      }
      $('[data-starter-title]').textContent = `Message starters · ${list.length} of ${MAX_STARTERS}`;
      const full = list.length >= MAX_STARTERS;
      $('[data-starter-form]').hidden = full;
      $('[data-starter-max]').hidden = !full;
      const ul = $('[data-starter-list]');
      const listKey = JSON.stringify(list);
      if (ul.getAttribute('data-key') === listKey) return;
      ul.setAttribute('data-key', listKey);
      ul.innerHTML = list.length
        ? list
            .map(
              (t, i) =>
                `<li><span>${tokens(t)}</span><button class="icon-btn small" type="button" data-remove-starter="${i}" aria-label="Remove starter">${ICON.close}</button></li>`
            )
            .join('')
        : '<li class="empty"><span>No starters. Add one below.</span></li>';
    }

    function renderWatches() {
      const list = state.watches || [];
      const now = Date.now();
      $('[data-watch]').hidden = !(state.canWatch && !state.watching) || list.length >= 8;
      $('[data-catchup]').hidden = list.length === 0;
      $('[data-catchup-count]').textContent = String(list.length);
      $('[data-catchup-sheet]').disabled = list.length === 0;
      // Rail: Watching shows once there's a watch; its badge is what the last Catch up found.
      const fresh = list.reduce((n, w) => n + (w.lastNew || 0), 0);
      const watchItem = $('[data-open-watching]');
      watchItem.hidden = list.length === 0;
      const wc = $('[data-watch-count]');
      wc.textContent = fresh ? String(fresh) : '';
      wc.classList.toggle('on', fresh > 0);
      watchItem.setAttribute('aria-label', fresh ? `Watching, ${fresh} new` : 'Watching');
      const key = JSON.stringify(list.map((w) => [w.id, w.lastRun, w.lastNew]));
      const ul = $('[data-watch-list]');
      if (ul.getAttribute('data-key') === key) return;
      ul.setAttribute('data-key', key);
      ul.innerHTML = list.length
        ? list
            .map((w) => {
              const last = w.lastRun ? `${w.lastNew} new · ${ago(w.lastRun, now)} ago` : 'Not caught up yet';
              return `<li><button class="watch" type="button" data-open-watch="${esc(w.id)}"><b>${esc(w.query)}</b><span>${esc(last)}</span></button>` +
                `<button class="icon-btn small" type="button" data-unwatch="${esc(w.id)}" aria-label="Stop watching ${esc(w.query)}">${ICON.close}</button></li>`;
            })
            .join('')
        : '<li class="empty">Watch a search to catch up on it in one go.</li>';
    }

    // The strip under the search bar while Catch up walks the watched searches. Rebuilt from storage on
    // every page load, so it stays put between searches.
    function renderCatchup() {
      const c = state.catchup;
      const strip = $('[data-catchup-progress]');
      const running = !!(c && !c.done && c.active !== false && Array.isArray(c.queue) && c.queue.length);
      strip.hidden = !running;
      doc.documentElement.classList.toggle('mm-catching', running && !compact);
      if (!running) return;
      const list = state.watches || [];
      const queue = new Set(c.queue);
      const cur = list.find((w) => w.id === c.queue[0]);
      const order = list.filter((w) => !queue.has(w.id)).concat(c.queue.map((id) => list.find((w) => w.id === id)).filter(Boolean));
      const done = order.length - c.queue.length;
      $('.catchup [data-toast-text]').textContent = `Catching up · ${cur ? cur.query : '…'}`;
      $('[data-catchup-squares]').innerHTML = order
        .map((w) => `<span class="${!queue.has(w.id) ? 'done' : w === cur ? 'cur' : 'todo'}"></span>`)
        .join('');
      const n = (c.found || []).length;
      $('[data-catchup-meta]').textContent = `${Math.min(done + 1, order.length)} of ${order.length} searches · ${n} new so far`;
    }

    function renderResults() {
      const c = state.catchup;
      const section = $('[data-results]');
      const show = !!(c && c.done);
      section.hidden = !show;
      if (!show) return;
      const key = JSON.stringify(c.found.map((f) => f.id));
      const ul = $('[data-results-list]');
      if (ul.getAttribute('data-key') === key) return;
      ul.setAttribute('data-key', key);
      const searches = new Set(c.found.map((f) => f.watch)).size;
      $('[data-results-hint]').textContent = c.found.length
        ? `${c.found.length} new across ${searches} search${searches === 1 ? '' : 'es'}.`
        : 'Nothing new since you last looked.';
      ul.innerHTML = c.found
        .map(
          (f) =>
            `<li><a href="/marketplace/item/${esc(f.id)}/">` +
            (f.img && /^https:\/\//.test(f.img) ? `<img src="${esc(f.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>') +
            `<span class="txt"><span class="price">${esc(f.priceText || '')}</span><span class="title">${esc(f.title)}</span><small>from · ${esc(f.watch)}</small></span>` +
            `<span class="badge">New</span></a></li>`
        )
        .join('');
    }

    function renderSignals() {
      const list = state.kind === 'item' ? state.signals || [] : [];
      const box = $('[data-signals]');
      box.hidden = list.length === 0;
      const key = JSON.stringify(list.map((x) => x.key));
      const ul = $('[data-signal-list]');
      if (ul.getAttribute('data-key') === key) return;
      ul.setAttribute('data-key', key);
      ul.innerHTML = list
        .map(
          (x) =>
            `<li data-tone="${esc(x.tone)}" data-signal="${esc(x.key)}"><span class="marker" aria-hidden="true"></span><b>${esc(x.label)}</b><span>${esc(x.why)}</span></li>`
        )
        .join('');
    }

    return {
      host,
      shadow,
      render,
      toast,
      openSheet,
      closeSheet,
      destroy() {
        doc.removeEventListener('keydown', onKey, true);
        doc.documentElement.classList.remove('mm-catching');
        host.remove();
      },
    };
  }

  function activeFilterCount(s) {
    return (
      s.exclusions.length +
      (s.minPrice != null || s.maxPrice != null ? 1 : 0) +
      (s.hideViewed ? 1 : 0) +
      (s.hideShipped ? 1 : 0) +
      (s.onlyNew ? 1 : 0) +
      (s.home && s.maxKm ? 1 : 0)
    );
  }

  const api = { mount, activeFilterCount, REASON_LABEL };
  root.MarketMode = Object.assign(root.MarketMode || {}, { ui: api });
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
