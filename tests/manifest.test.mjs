import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const ext = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ext), 'utf8'));
const exists = (p) => existsSync(new URL(p, ext));

test('manifest is MV3 and every referenced file exists', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.declarative_net_request.rule_resources.map((r) => r.path),
    ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ];
  for (const f of files) assert.ok(exists(f), 'missing ' + f);
});

test('permissions stay minimal: no cookies, webRequest, tabs, history or scripting', () => {
  assert.deepEqual(manifest.permissions.sort(), ['declarativeNetRequest', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://*.facebook.com/*']);
  assert.equal(manifest.web_accessible_resources, undefined, 'nothing exposed to pages');
  assert.equal(manifest.externally_connectable, undefined);
});

test('the page-world script only observes navigation', () => {
  const main = manifest.content_scripts.find((c) => c.world === 'MAIN');
  assert.deepEqual(main.js, ['src/content/page-nav.js']);
  const src = readFileSync(new URL('src/content/page-nav.js', ext), 'utf8');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'chrome.', 'localStorage', 'document.cookie', 'postMessage']) {
    assert.ok(!src.includes(banned), 'page-nav.js must not use ' + banned);
  }
});

test('extension code makes no network calls and sends nothing anywhere', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(new URL(d.name + '/', dir)) : d.name.endsWith('.js') ? [new URL(d.name, dir)] : []
    );
  for (const file of walk(new URL('src/', ext))) {
    const src = readFileSync(file, 'utf8');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'eval(', 'new Function']) {
      assert.ok(!src.includes(banned), `${file.pathname} must not use ${banned}`);
    }
  }
});

test('icons are real PNGs', () => {
  for (const p of Object.values(manifest.icons)) {
    const buf = readFileSync(new URL(p, ext));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', p);
  }
});
