import { chromium } from 'playwright-core';

const ARGS = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--no-first-run'];

/**
 * Candidates in order: an explicit KNIME_AGENT_BROWSER executable, then installed
 * Edge (default on Windows), then installed Chrome. No browser is downloaded.
 */
export function browserCandidates(env = process.env) {
  const candidates = [];
  if (env.KNIME_AGENT_BROWSER) candidates.push({ name: 'Custom Chromium / Playwright', options: { executablePath: env.KNIME_AGENT_BROWSER } });
  candidates.push({ name: 'Microsoft Edge / Playwright', options: { channel: 'msedge' } });
  candidates.push({ name: 'Google Chrome / Playwright', options: { channel: 'chrome' } });
  return candidates;
}

/** Launch the first available headless Chromium-family browser. */
export async function launchRenderer({ env = process.env, launch = options => chromium.launch(options) } = {}) {
  const attempts = [];
  for (const candidate of browserCandidates(env)) {
    try { return { browser: await launch({ ...candidate.options, headless: true, args: ARGS }), name: candidate.name }; }
    catch (error) { attempts.push({ renderer: candidate.name, message: String(error.message).split('\n')[0].slice(0, 300) }); }
  }
  const error = new Error('No supported browser for canvas rendering. Install Microsoft Edge or Google Chrome, or set KNIME_AGENT_BROWSER to a Chromium executable.');
  error.code = 'RENDERER_UNAVAILABLE'; error.details = { attempts };
  throw error;
}
