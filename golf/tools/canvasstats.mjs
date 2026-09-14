/** Mean brightness and saturation of the hole canvas, for comparing renders. */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  const file = url === '/' ? 'index.html' : normalize(url).replace(/^\/+/, '');
  try {
    const body = await readFile(join(ROOT, file));
    response.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    response.end(body);
  } catch { response.writeHead(404); response.end('no'); }
});
await new Promise((r) => server.listen(4322, r));
const browser = await chromium.launch({ executablePath: await findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://localhost:4322/');
await page.waitForSelector('.app');
const play = page.getByRole('button', { name: 'Play as' }).first();
if (await play.isVisible().catch(() => false)) await play.click();
for (const [course, hole] of [['Woodland National', 2], ['Coastal Championship', 5], ['Desert Classic', 5]]) {
  await page.getByRole('button', { name: 'Courses', exact: true }).first().click();
  await page.getByRole('button', { name: course, exact: true }).click();
  await page.locator('.card-table tbody tr').nth(hole - 1).getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: `Play hole ${hole}` }).click();
  await page.waitForSelector('.course-canvas');
  await page.waitForTimeout(700);
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('.course-canvas');
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lum = 0, sat = 0, n = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sat += max === 0 ? 0 : (max - min) / max;
      n++;
    }
    return { lum: lum / n, sat: sat / n, width, height };
  });
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - start < 1500) requestAnimationFrame(tick);
      else resolve(Math.round((frames * 1000) / (performance.now() - start)));
    };
    requestAnimationFrame(tick);
  }));
  console.log(`${course} #${hole}: luminance ${stats.lum.toFixed(1)}  saturation ${stats.sat.toFixed(3)}  ${fps} fps`);
  const leave = page.getByRole('button', { name: /Leave the round/ }).first();
  if (await leave.isVisible().catch(() => false)) await leave.click();
}
await browser.close();
server.close();
