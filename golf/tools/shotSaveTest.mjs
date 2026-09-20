#!/usr/bin/env node
/**
 * Can you un-hit a shot by reloading the page?
 *
 *   npm run build && node tools/shotSaveTest.mjs
 *
 * Plays a few real shots in a tournament round, kills the page, and checks that
 * the round comes back exactly as it was left — same hole, same stroke count,
 * same ball, same shot log — and that the button that used to say "Play round 1"
 * now resumes rather than starting again.
 *
 * Everything is read from localStorage rather than from the screen, because the
 * question is what is on disk, not what is being displayed.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { findChromium } from './chromium.mjs';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let failures = 0;
const check = (ok, what) => {
  if (ok) console.log(`  ok    ${what}`);
  else { failures++; console.log(`  FAIL  ${what}`); }
};

/** The saved round, straight out of the save file. */
const savedRound = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('golf-universe:save');
    if (!raw) return null;
    const universe = JSON.parse(raw);
    const session = universe.session;
    if (!session) return null;
    // `shots` is the hole in hand; `roundShots` is every hole before it. The
    // round's real total is the two together, which is what `allShots` returns
    // in the app and what has to survive a reload here.
    const all = [...session.roundShots, ...session.shots];
    return {
      mode: session.mode,
      round: session.round,
      holeNumber: session.holeNumber,
      strokesThisHole: session.strokesThisHole,
      shotIndex: session.shotIndex,
      shots: all.length,
      holesPlayed: session.holeScores.filter((score) => score !== null).length,
      ball: session.ball,
      status: session.status,
      last: all.length ? { club: all.at(-1).club, to: all.at(-1).to, quality: all.at(-1).quality } : null,
    };
  });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.topbar');

console.log('Starting a tournament round');
await page.getByRole('button', { name: 'Players', exact: true }).first().click();
await page.getByRole('button', { name: 'Play as' }).first().click();
await page.getByRole('button', { name: 'Home', exact: true }).first().click();
await page.getByRole('button', { name: /^Play round/ }).click();
await page.waitForSelector('.course-canvas');

const before = await savedRound();
check(before !== null, 'the round is in the save file as soon as it starts');
check(before?.mode === 'tournament' && before?.shots === 0, 'and it starts on the first tee with no shots played');

/** Hit whatever the next shot is, and wait for the ball to stop. */
async function playShot() {
  const putting = await page.locator('.putt-options').isVisible().catch(() => false);
  if (putting) {
    await page.locator('.putt-option .hit').first().click();
  } else {
    const hit = page.locator('.shot-controls .hit').first();
    if (!(await hit.isVisible())) return false;
    await hit.click();
  }
  await page.waitForTimeout(2600);
  if (await page.locator('.play__interstitial').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Next hole|Walk to/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
  return true;
}

console.log('\nPlaying three shots');
for (let i = 0; i < 3; i++) await playShot();

const played = await savedRound();
console.log(`  (saved: hole ${played.holeNumber}, ${played.shots} shots on the round, ${played.holesPlayed} holes complete)`);
check(played.shots >= 3, `every shot of the round is in the ledger (${played.shots} recorded)`);
check(played.shotIndex >= 3, 'the shot counter advanced with them');

// The important one: the shot is on disk *before* the ball is drawn moving, so
// a page that dies during the flight cannot un-hit it. Hit one more and read the
// save while the animation is still running.
console.log('\nKilling the page mid-flight');
const midFlightBefore = await savedRound();
await page.locator('.shot-controls .hit, .putt-option .hit').first().click();
await page.waitForTimeout(120);
const midFlight = await savedRound();
check(
  midFlight.shots === midFlightBefore.shots + 1,
  `the shot is on disk while the ball is still in the air (${midFlightBefore.shots} → ${midFlight.shots})`,
);

console.log('\nReloading the page');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.topbar');
await page.waitForTimeout(800);

const after = await savedRound();
check(after !== null, 'the round survived the reload');
check(after.shots === midFlight.shots, `every shot still there (${midFlight.shots} → ${after.shots})`);
check(
  after.last && midFlight.last && after.last.quality === midFlight.last.quality &&
    Math.abs(after.last.to.x - midFlight.last.to.x) < 0.001,
  'and the last one came back identical, down to where it finished',
);
check(after.holeNumber === midFlight.holeNumber, 'on the same hole');
check(
  Math.abs(after.ball.x - midFlight.ball.x) < 0.001 && Math.abs(after.ball.y - midFlight.ball.y) < 0.001,
  'with the ball exactly where it finished',
);
check(after.status !== 'animating', 'and the interrupted shot settled rather than being offered again');

console.log('\nThe button no longer starts a new round');
await page.getByRole('button', { name: 'Home', exact: true }).first().click();
const label = await page.locator('.home__you button').first().innerText().catch(() => '');
check(/Resume round/.test(label), `it says "${label.trim()}"`);
await page.locator('.home__you button').first().click();
await page.waitForSelector('.course-canvas');
const resumed = await savedRound();
check(resumed.shots === after.shots, `resuming did not reset the round (${after.shots} shots still played)`);
check(resumed.holeNumber === after.holeNumber, 'and it is the same hole');

console.log('\nA tournament round cannot be thrown away');
const abandon = await page.getByRole('button', { name: /Abandon this practice round/ }).count();
check(abandon === 0, 'there is no abandon button on a tournament round');
await page.getByRole('button', { name: /Save and leave/ }).click();
await page.waitForTimeout(500);
const left = await savedRound();
check(left !== null && left.shots === after.shots, 'leaving the round keeps every shot');

console.log('\nThe tour will not move on past an unfinished round');
await page.getByRole('button', { name: 'Home', exact: true }).first().click();
await page.getByRole('button', { name: 'Simulate the whole event' }).click();
await page.waitForTimeout(900);
const toast = await page.locator('.toast span').innerText().catch(() => '');
check(/round in progress/i.test(toast), `simulating the event is refused — "${toast.slice(0, 60)}…"`);
const afterRefusal = await savedRound();
check(afterRefusal !== null && afterRefusal.shots === after.shots, 'and the round is untouched by the attempt');

console.log('\nThe caddie can finish it, and the played holes stand');
await page.locator('.toast button').click().catch(() => undefined);
await page.locator('.home__you button').first().click();
await page.waitForSelector('.course-canvas');
const beforeCaddie = await savedRound();
page.once('dialog', (dialog) => dialog.accept());
await page.getByRole('button', { name: /Let the caddie finish/ }).click();
await page.waitForTimeout(2500);
const finished = await savedRound();
check(finished !== null && finished.status === 'roundComplete', 'the round is complete');
check(
  finished.shots >= beforeCaddie.shots,
  `the shots already played are still on the card (${beforeCaddie.shots} → ${finished.shots})`,
);

check(problems.length === 0, `no console errors${problems.length ? ` — ${problems[0]}` : ''}`);

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'Shots are saved: reloading cannot un-hit one.' : `${failures} FAILURES`}`);
process.exitCode = failures === 0 ? 0 : 1;
