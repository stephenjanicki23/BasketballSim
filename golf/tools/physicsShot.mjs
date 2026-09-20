#!/usr/bin/env node
/**
 * Open the physics panel on a real shot and photograph it, so the developer
 * view can be checked rather than assumed.
 *
 *   npm run build && node tools/physicsShot.mjs
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const OUT = new URL('../dist/physics/', import.meta.url).pathname;
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
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

// Open the physics panel from the tee.
await page.keyboard.press('p');
await page.waitForSelector('.physics', { timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: join(OUT, 'physics-tee.png') });
const tee = await page.locator('.physics').innerText();

// Hit one, then look at the panel from wherever it finished.
const box = await page.locator('.course-canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
await page.waitForTimeout(150);
await page.locator('.shot-controls .hit').first().click();
await page.waitForTimeout(4200);
await page.waitForSelector('.physics', { timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: join(OUT, 'physics-second.png') });
const second = await page.locator('.physics').innerText();

console.log('--- from the tee ---');
console.log(tee);
console.log('\n--- second shot ---');
console.log(second);
console.log(problems.length === 0 ? '\nok   no console errors' : `\nFAIL ${problems.join(' | ')}`);
await browser.close();
server.close();
process.exit(problems.length === 0 ? 0 : 1);
