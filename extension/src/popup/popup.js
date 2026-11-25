'use strict';
const { filters } = globalThis.MarketMode;

const power = document.querySelector('[data-pause]');
const ON = 'Marketplace opens tidy: your filters, your shortlist, the good ones first.';
const PAUSED = 'Facebook looks exactly like Facebook. Your filters and shortlist wait here until you’re back.';

async function load() {
  const data = await chrome.storage.local.get(['settings', 'shortlist']);
  const s = filters.sanitiseSettings(data.settings);
  power.setAttribute('aria-checked', String(s.enabled));
  document.body.classList.toggle('on', s.enabled);
  document.querySelector('[data-state]').textContent = s.enabled ? 'On' : 'Paused';
  document.querySelector('[data-state-sub]').textContent = s.enabled ? ON : PAUSED;
  document.querySelector('[data-shortlist-count]').textContent = String((data.shortlist || []).length);

  const bits = [];
  if (s.exclusions.length) bits.push(`${s.exclusions.length} left-out word${s.exclusions.length === 1 ? '' : 's'}`);
  if (s.minPrice != null && s.maxPrice != null) bits.push(`${s.minPrice}–${s.maxPrice}`);
  else if (s.maxPrice != null) bits.push(`under ${s.maxPrice}`);
  else if (s.minPrice != null) bits.push(`over ${s.minPrice}`);
  if (s.home && s.maxKm) bits.push(`within ${s.maxKm} km`);
  if (s.hideSold) bits.push('hide sold');
  if (s.newestFirst) bits.push('newest first');
  const summary = document.querySelector('[data-summary]');
  summary.hidden = !s.enabled || !bits.length;
  summary.textContent = '';
  if (bits.length) {
    const b = document.createElement('strong');
    b.textContent = 'Active:';
    summary.append(b, ' ' + bits.join(', ') + '.');
  }
}

power.addEventListener('click', async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const enabled = power.getAttribute('aria-checked') !== 'true';
  await chrome.storage.local.set({ settings: filters.sanitiseSettings({ ...settings, enabled }) });
  load();
});

for (const a of document.querySelectorAll('a[data-open]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: a.href });
    window.close();
  });
}

load();
