#!/usr/bin/env node
/**
 * Walk the whole career flow in a real browser, and screenshot every step.
 *
 *   npm run build && node tools/careerSmoke.mjs [--server]
 *
 * With `--server` it starts the account API on a spare port and points the page at
 * it, so the remote backend gets exercised over real HTTP as well. Without it the
 * page uses the browser backend, which is what the published build does.
 *
 * Fails on any console error. Screenshots land in tools/shots/career/.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { findChromium } from './chromium.mjs';

const useServer = process.argv.includes('--server');
const ROOT = new URL('../dist/', import.meta.url).pathname;
const SHOTS = new URL('./shots/career/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

await mkdir(SHOTS, { recursive: true });

// --- the API, when asked for -------------------------------------------------
let api = null;
let dataDir = null;
let apiPort = 0;
if (useServer) {
  dataDir = mkdtempSync(join(tmpdir(), 'golf-career-smoke-'));
  process.env.GOLF_DATA_DIR = dataDir;
  process.env.GOLF_NO_LISTEN = '1';
  process.env.GOLF_ORIGINS = '*';
  const { build } = await import('esbuild');
  const bundleDir = mkdtempSync(join(tmpdir(), 'golf-career-api-'));
  const outfile = join(bundleDir, 'server.mjs');
  await build({
    entryPoints: [new URL('../server/index.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile, logLevel: 'error',
  });
  const { start } = await import(`file://${outfile}`);
  api = start(0);
  await new Promise((resolve) => api.once('listening', resolve));
  apiPort = api.address().port;
  console.log(`account API on http://127.0.0.1:${apiPort}`);
}

// --- the static app ----------------------------------------------------------
const server = createServer(async (request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  const file = url === '/' ? 'index.html' : normalize(url).replace(/^\/+/, '');
  try {
    const body = await readFile(join(ROOT, file));
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: await findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

let failures = 0;
let shot = 0;
const step = async (label, fn) => {
  const before = problems.length;
  try {
    await fn();
  } catch (error) {
    problems.push(`threw: ${error.message}`);
  }
  await page.waitForTimeout(250);
  const added = problems.slice(before);
  if (added.length) failures++;
  console.log(`${added.length === 0 ? 'ok  ' : 'FAIL'} ${label}${added.length ? ` — ${added.join(' | ')}` : ''}`);
  await page.screenshot({ path: join(SHOTS, `${String(++shot).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) });
};

// The remote backend is chosen at build time through import.meta.env, so for this
// harness it is injected before the app's script runs instead.
if (useServer) {
  await page.addInitScript(`window.__GOLF_API__ = 'http://127.0.0.1:${apiPort}';`);
}

await step('load', async () => {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar');
});

await step('career screen', async () => {
  await page.getByRole('button', { name: 'Career', exact: true }).click();
  await page.waitForSelector('.career__gate');
});

await step('register', async () => {
  await page.fill('input[name="username"]', 'smoketest');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.getByRole('button', { name: 'Create the account' }).click();
  await page.waitForSelector('.steps', { timeout: 20_000 });
});

await step('identity', async () => {
  await page.fill('input[name="firstName"]', 'Sandy');
  await page.fill('input[name="lastName"]', 'Kerrigan');
  await page.selectOption('select[name="country"]', 'Scotland');
  await page.getByRole('button', { name: /Choose an archetype/ }).click();
  await page.waitForSelector('.archetypes');
});

await step('archetypes', async () => {
  await page.getByRole('button', { name: /Short Game Wizard/ }).click();
});

await step('allocate', async () => {
  await page.getByRole('button', { name: /Build a Short Game Wizard/ }).click();
  await page.waitForSelector('.skillbar__input');

  // Take the signature lines as high as they will start, then spend what is left
  // evenly. Leaving points unspent is legal and produces a golfer who cannot
  // break 77 — which is a real outcome worth having seen, but not the one this
  // test is for.
  for (const name of ['Chipping & Pitching', 'Bunker Play', 'Recovery']) {
    await page.locator(`.skillbar__input[aria-label^="${name}"]`).fill('82');
  }
  const sliders = page.locator('.skillbar__input');
  const count = await sliders.count();
  const left = () => page.locator('.points strong').innerText().then(Number);
  for (let target = 63; target <= 82 && (await left()) > 0; target++) {
    for (let index = 0; index < count && (await left()) > 0; index++) {
      const slider = sliders.nth(index);
      const value = Number(await slider.inputValue());
      const max = Number(await slider.getAttribute('max'));
      if (value >= Math.min(target, max)) continue;
      await slider.fill(String(Math.min(target, max)));
      // The store refuses a change that would go over budget, so a slider that
      // did not move means the budget is spent to the point that it cannot.
      if (Number(await slider.inputValue()) === value) break;
    }
  }
  console.log(`     points left: ${await left()}`);
});

await step('review', async () => {
  await page.getByRole('button', { name: 'Review the golfer' }).click();
  await page.waitForSelector('.review');
});

await step('turn professional', async () => {
  await page.getByRole('button', { name: 'Turn professional' }).click();
  await page.waitForSelector('.career__identity', { timeout: 20_000 });
});

await step('simulate the season', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: /rest of the season/i }).click();
  // Twenty events of a 157-player field takes a while.
  await page.waitForSelector('text=season complete', { timeout: 600_000 });
});

await step('roll the calendar', async () => {
  // The offseason opens when the season is rolled over, not when the last event
  // finishes — so this click is the thing that triggers it.
  await page.getByRole('button', { name: /Start the \d+ season/ }).click();
  await page.waitForSelector('.xp-banner', { timeout: 120_000 });
});

await step('offseason', async () => {
  const earned = await page.locator('.xp-banner strong').first().innerText();
  console.log(`     season XP earned: ${earned}`);
});

await step('spend xp', async () => {
  // Spend on whatever is affordable, cheapest lines first, until nothing is.
  // A rookie season does not buy much, and buying near a ceiling buys less still,
  // so asking for a fixed number of points would be asking the wrong question.
  let bought = 0;
  for (let round = 0; round < 12; round++) {
    const affordable = page.locator('.upgrade__buttons button:not([disabled])', { hasText: '+' });
    if ((await affordable.count()) === 0) break;
    await affordable.first().click();
    bought++;
  }
  console.log(`     points bought: ${bought}`);
  if (bought > 0) {
    await page.getByRole('button', { name: /Put in the work/ }).click();
    await page.waitForSelector('.basket', { state: 'detached', timeout: 20_000 });
  }
});

await step('start the next season', async () => {
  await page.getByRole('button', { name: /Start the \d+ season/ }).click();
  await page.waitForSelector('.career__identity', { timeout: 30_000 });
});

await step('career hub', async () => {
  await page.waitForSelector('.career__identity');
  const used = await page.locator('.stat', { hasText: 'Potential used' }).locator('.stat__value').innerText();
  const xp = await page.locator('.stat', { hasText: 'XP available' }).locator('.stat__value').innerText();
  console.log(`     potential used: ${used}, XP available: ${xp}`);
});

await step('sign out and back in', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.career__gate');
  await page.getByRole('button', { name: 'I already have an account' }).click();
  await page.fill('input[name="username"]', 'smoketest');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.career__identity', { timeout: 30_000 });
});

await step('reload resumes the career', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Career', exact: true }).click();
  await page.waitForSelector('.career__identity', { timeout: 30_000 });
  const name = await page.locator('.topbar__you strong').innerText();
  const seasons = await page.locator('.table tbody tr').count();
  console.log(`     resumed as: ${name}, ${seasons} season(s) on the record`);
  if (seasons < 1) throw new Error('the season history did not survive the reload');
});

await browser.close();
server.close();
if (api) api.close();
if (dataDir) rmSync(dataDir, { recursive: true, force: true });

console.log(`\nshots in ${SHOTS}`);
console.log(failures === 0 ? 'Career smoke test passed with no console errors.' : `${failures} steps had problems.`);
process.exitCode = failures === 0 ? 0 : 1;
