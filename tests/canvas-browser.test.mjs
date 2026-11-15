import test from 'node:test';
import assert from 'node:assert/strict';
import {browserCandidates, launchRenderer} from '../src/canvas/browser.mjs';

test('renderer candidates prefer an explicit executable, then Edge, then Chrome', () => {
  assert.deepEqual(browserCandidates({}).map(c => c.options), [{channel: 'msedge'}, {channel: 'chrome'}]);
  assert.deepEqual(browserCandidates({KNIME_AGENT_BROWSER: '/opt/chromium'}).map(c => c.options), [{executablePath: '/opt/chromium'}, {channel: 'msedge'}, {channel: 'chrome'}]);
});

test('renderer falls back to Chrome and reports the browser it actually launched', async () => {
  const tried = [];
  const result = await launchRenderer({env: {}, launch: async options => { tried.push(options.channel); if (options.channel === 'msedge') throw new Error('Edge not found\nstack'); return {fake: true}; }});
  assert.deepEqual(tried, ['msedge', 'chrome']);
  assert.equal(result.name, 'Google Chrome / Playwright');
  assert.deepEqual(result.browser, {fake: true});
});

test('renderer launches headless with extensions disabled', async () => {
  let seen;
  await launchRenderer({env: {}, launch: async options => { seen = options; return {}; }});
  assert.equal(seen.headless, true);
  assert.ok(seen.args.includes('--disable-extensions'));
});

test('no available browser fails with every attempt listed', async () => {
  await assert.rejects(launchRenderer({env: {KNIME_AGENT_BROWSER: '/missing'}, launch: async () => { throw new Error('not installed'); }}), error => {
    assert.equal(error.code, 'RENDERER_UNAVAILABLE');
    assert.equal(error.details.attempts.length, 3);
    assert.match(error.message, /Edge|Chrome|KNIME_AGENT_BROWSER/);
    return true;
  });
});
