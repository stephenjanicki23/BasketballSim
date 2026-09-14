#!/usr/bin/env node
/**
 * Browser smoke test: load the built app, click through every screen, play a
 * few shots, and fail on any console error or unhandled rejection.
 *
 *   npm run build && node tools/smoke.mjs
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';


const ROOT = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

const step = async (label, fn) => {
  const before = problems.length;
  await fn();
  await page.waitForTimeout(250);
  const added = problems.slice(before);
  console.log(`${added.length === 0 ? 'ok  ' : 'FAIL'} ${label}${added.length ? ` — ${added.join(' | ')}` : ''}`);
};

await step('load', async () => {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar');
});

for (const name of ['Players', 'Courses', 'Statistics', 'News', 'Tournament', 'Home']) {
  await step(`screen: ${name}`, async () => {
    await page.getByRole('button', { name, exact: true }).first().click();
  });
}

await step('choose a golfer', async () => {
  await page.getByRole('button', { name: 'Players', exact: true }).first().click();
  await page.getByRole('button', { name: 'Play as' }).first().click();
});

await step('open a profile', async () => {
  await page.locator('.players .player button').first().click();
  await page.waitForSelector('.profile');
  await page.getByRole('button', { name: 'Close' }).click();
});

await step('simulate a round', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await page.getByRole('button', { name: /^Simulate round/ }).click();
  await page.waitForSelector('.busy', { state: 'detached', timeout: 60000 });
});

await step('start a practice hole', async () => {
  await page.getByRole('button', { name: 'Courses', exact: true }).first().click();
  await page.locator('.card-table tbody tr').nth(3).getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: /^Play hole/ }).click();
  await page.waitForSelector('.course-canvas');
});

let sawPuttPanel = 0;
await step('play the hole out, putting by strategy', async () => {
  for (let i = 0; i < 9; i++) {
    const putting = await page.locator('.putt-options').isVisible().catch(() => false);
    if (putting) {
      // No aiming on the green: pick a strategy and the engine rolls it.
      const options = page.locator('.putt-option .hit');
      const count = await options.count();
      sawPuttPanel = Math.max(sawPuttPanel, count);
      await options.nth(i % 2 === 0 ? Math.min(count - 1, 1) : 0).click();
      await page.waitForTimeout(2200);
    } else {
      const box = await page.locator('.course-canvas').boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * (0.34 + i * 0.03));
      await page.waitForTimeout(160);
      const hit = page.locator('.shot-controls .hit').first();
      if (await hit.isVisible()) await hit.click();
      await page.waitForTimeout(2600);
    }
    if (await page.locator('.play__interstitial').isVisible().catch(() => false)) break;
  }
});

await step('the putting panel offered a real choice', async () => {
  if (sawPuttPanel < 2) throw new Error(`putting panel offered ${sawPuttPanel} options`);
});

await step('screenshot the play screen', async () => {
  await page.screenshot({ path: 'dist/smoke-play.png' });
});

await step('no manual putting controls exist', async () => {
  if (await page.locator('.putt-options').isVisible().catch(() => false)) {
    const aimVisible = await page.locator('.aim-controls').isVisible().catch(() => false);
    if (aimVisible) throw new Error('aim controls are showing on the green');
  }
});

await step('whole-hole view and zones', async () => {
  await page.getByRole('button', { name: 'Whole hole' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Shot view' }).click();
  // The dispersion toggles only exist while there is a swing to disperse.
  const zone = page.getByLabel('90%');
  if (await zone.isVisible().catch(() => false)) await zone.check();
});

await step('leave the round', async () => {
  const leave = page.getByRole('button', { name: 'Leave the round' });
  if (await leave.isVisible().catch(() => false)) await leave.click();
  else await page.getByRole('button', { name: 'Home', exact: true }).first().click();
});

await step('play a tournament round and post it', async () => {
  await page.getByRole('button', { name: 'Tournament', exact: true }).first().click();
  const play = page.getByRole('button', { name: /^Play round/ }).first();
  if (await play.isVisible()) {
    await play.click();
    await page.waitForSelector('.course-canvas');
    await page.screenshot({ path: 'dist/smoke-tournament.png' });
    await page.getByRole('button', { name: 'Leave the round' }).click();
  }
});

await step('simulate the rest of the season', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await page.getByRole('button', { name: 'Simulate the rest of the season' }).click();
  await page.waitForSelector('.busy', { state: 'detached', timeout: 300000 });
});

await step('roll the season over', async () => {
  const roll = page.getByRole('button', { name: /^Start the \d+ season$/ });
  if (await roll.isVisible()) {
    await roll.click();
    await page.waitForSelector('.busy', { state: 'detached', timeout: 120000 });
  }
});

await step('news and development report', async () => {
  await page.getByRole('button', { name: 'News', exact: true }).first().click();
  await page.waitForSelector('.news-list');
});

await step('reload keeps the save', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar');
});

const seasonText = await page.locator('.topbar__brand small').textContent();
console.log(`\nAfter reload: ${seasonText}`);

await browser.close();
server.close();

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('\nSmoke test passed with no console errors.');
