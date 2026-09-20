#!/usr/bin/env node
/**
 * Capture the ball-flight animation frame by frame, so the arc can be looked at
 * rather than guessed at.
 *
 *   npm run build && node tools/flightShots.mjs
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../dist/flight/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

await mkdir(OUT, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.topbar');
await page.getByRole('button', { name: 'Players', exact: true }).first().click();
await page.getByRole('button', { name: 'Play as' }).first().click();
await page.getByRole('button', { name: 'Courses', exact: true }).first().click();
await page.locator('.card-table tbody tr').nth(3).getByRole('button', { name: 'Select' }).click();
await page.getByRole('button', { name: /^Play hole/ }).click();
await page.waitForSelector('.course-canvas');
await page.waitForTimeout(400);

const box = await page.locator('.course-canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
await page.waitForTimeout(200);
await page.locator('.shot-controls .hit').first().click();
const t0 = Date.now();

// Grab the whole animation: the shot lasts up to 3.4 seconds. Screenshots are
// not free, so each wait is measured from the strike rather than the last frame.
const stamps = [150, 450, 750, 1050, 1350, 1700, 2050, 2350, 2650, 2950, 3250];
for (const at of stamps) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(OUT, `flight-${String(at).padStart(4, '0')}.png`), clip: box });
}

// And a putt, which uses the same sampler on a different curve.
for (let i = 0; i < 8; i++) {
  if (await page.locator('.putt-options').isVisible().catch(() => false)) break;
  const b = await page.locator('.course-canvas').boundingBox();
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.28);
  await page.waitForTimeout(150);
  const hit = page.locator('.shot-controls .hit').first();
  if (await hit.isVisible()) await hit.click();
  await page.waitForTimeout(3600);
}
if (await page.locator('.putt-options').isVisible().catch(() => false)) {
  const green = await page.locator('.course-canvas').boundingBox();
  await page.locator('.putt-option .hit').first().click();
  const p0 = Date.now();
  for (const at of [120, 400, 700, 1000]) {
    const wait = at - (Date.now() - p0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: join(OUT, `putt-${String(at).padStart(4, '0')}.png`), clip: green });
  }
} else {
  console.log('note the hole never reached the green');
}

console.log(problems.length === 0 ? 'ok   no console errors' : `FAIL ${problems.join(' | ')}`);
await browser.close();
server.close();
process.exit(problems.length === 0 ? 0 : 1);
