#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Find a Chromium to drive. playwright-core ships no browser of its own, so
 * this looks where Playwright normally puts them (the exact build number moves,
 * hence the search rather than a pinned path), then at the usual system
 * installs. Set CHROMIUM_PATH to override.
 */
export async function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', join(process.env.HOME ?? '', '.cache/ms-playwright')];
  for (const root of roots) {
    if (!root) continue;
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries.filter((name) => name.startsWith('chromium-')).sort().reverse()) {
      for (const suffix of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const candidate = join(root, entry, suffix);
        try {
          await stat(candidate);
          return candidate;
        } catch {
          // Try the next layout.
        }
      }
    }
  }
  for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  throw new Error('No Chromium found. Set CHROMIUM_PATH to a browser binary.');
}
