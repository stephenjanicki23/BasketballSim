#!/usr/bin/env node
/**
 * Screenshot holes from the built app, so a layout can be looked at rather than
 * inferred from numbers. Useful after changing course geometry.
 *
 *   npm run build && node tools/shots.mjs [course:hole ...] [--out DIR] [--bare]
 *
 * Defaults to a hole from each venue. Images land in dist/ unless --out says
 * otherwise, one per hole, named course-hole.png.
 *
 * --bare hides the HUD and the panels, leaving the ground on its own. That is
 * the view to hold up against the overhead a hole was traced from, because the
 * chrome otherwise sits over the green.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';

const NAMES = {
  woodland: 'Woodland National',
  coastal: 'Coastal Championship',
  desert: 'Desert Classic',
  concord: 'Revere Concord',
  ranch: 'The Ranch',
  pebble: 'Pebble Beach Golf Links',
};

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : new URL('../dist/', import.meta.url).pathname;
const asked = args.filter((a) => a.includes(':')).map((a) => {
  const [course, hole] = a.split(':');
  return [course, Number(hole)];
});
const shots = asked.length > 0 ? asked : [['woodland', 2], ['coastal', 5], ['desert', 5]];

const ROOT = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  const file = url === '/' ? 'index.html' : normalize(url).replace(/^\/+/, '');
  try {
    const body = await readFile(join(ROOT, file));
    response.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(4321, resolve));

const browser = await chromium.launch({ executablePath: await findChromium(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://localhost:4321/');
await page.waitForSelector('.app');
const play = page.getByRole('button', { name: 'Play as' }).first();
if (await play.isVisible().catch(() => false)) await play.click();

for (const [course, hole] of shots) {
  await page.getByRole('button', { name: 'Courses', exact: true }).first().click();
  await page.getByRole('button', { name: NAMES[course] ?? course, exact: true }).click();
  // course:card screenshots the scorecard screen rather than playing a hole.
  if (Number.isNaN(hole)) {
    await page.waitForTimeout(400);
    const path = join(outDir, `${course}-card.png`);
    await page.locator('.screen.courses').screenshot({ path });
    console.log(`  ${path}`);
    continue;
  }
  await page.locator('.card-table tbody tr').nth(hole - 1).getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: `Play hole ${hole}` }).click();
  await page.waitForSelector('.course-canvas');
  // --bare hides the chrome for the screenshot and then puts it back, because
  // the chrome includes the button this loop needs to leave the round.
  let bare = null;
  if (args.includes('--bare')) {
    bare = await page.addStyleTag({
      content:
        '.hud, .play__status, .play__log, .play__left, .play__right, .course-view__controls, .course-view__map, button' +
        ' { visibility: hidden !important; } .course-canvas { visibility: visible !important; }',
    });
  }
  await page.waitForTimeout(600);
  // --debug presses D for the trace check: source image plus traced geometry.
  if (args.includes('--debug')) {
    await page.keyboard.press('d');
    await page.waitForTimeout(900);
  }
  const suffix = args.includes('--debug') ? '-debug' : args.includes('--bare') ? '-bare' : '';
  const path = join(outDir, `${course}-${hole}${suffix}.png`);
  await page.locator('.course-canvas').screenshot({ path });
  if (bare) await bare.evaluate((node) => node.remove());
  console.log(`  ${path}`);
  const leave = page.getByRole('button', { name: /Leave the round/ }).first();
  if (await leave.isVisible().catch(() => false)) await leave.click();
}

await browser.close();
server.close();
