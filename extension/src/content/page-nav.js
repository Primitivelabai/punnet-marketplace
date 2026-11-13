/*
 * punnet — runs in the page's own JS world, only to notice Facebook's in-app navigation.
 * Facebook changes pages with history.pushState, which no extension event reports. We wrap
 * pushState/replaceState to fire a DOM event that the isolated content script listens for.
 * It exposes no globals, reads nothing and sends nothing.
 */
(() => {
  'use strict';
  const fire = () => window.dispatchEvent(new Event('mm:locationchange'));
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    if (typeof original !== 'function') continue;
    history[name] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(fire);
      return result;
    };
  }
})();
