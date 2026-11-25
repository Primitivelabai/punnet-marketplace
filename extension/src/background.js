/*
 * punnet — service worker. Its only jobs: seed default settings, and switch the redirect
 * ruleset on/off with punnet. No network requests, no analytics, no tabs access.
 */
importScripts('core/filters.js');

const { filters } = globalThis.MarketMode;

async function syncRules() {
  const { settings } = await chrome.storage.local.get('settings');
  const enabled = filters.sanitiseSettings(settings).enabled;
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: ['redirects'] } : { disableRulesetIds: ['redirects'] }
  );
  await chrome.action.setBadgeText({ text: enabled ? '' : 'off' });
  await chrome.action.setBadgeBackgroundColor({ color: '#11201b' });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: filters.sanitiseSettings(settings) });
  await syncRules();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'https://www.facebook.com/marketplace/' });
  }
});

chrome.runtime.onStartup.addListener(syncRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncRules();
});
