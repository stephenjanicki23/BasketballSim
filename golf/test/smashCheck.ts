/**
 * Strike quality: does a bag of drives look like a bag of drives?
 *
 * What we are after is the left skew — most shots near the player's full number,
 * the misses all short, and the short ones also offline.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry } from '../src/simulation/courseEngine';
import { bagFor } from '../src/simulation/golferEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { planShot, resolveShot, smashProfile, type ShotContext } from '../src/simulation/shotEngine';
import { CLUB_BY_ID, LIES } from '../src/simulation/config';
import { createRng } from '../src/simulation/rng';
import { add, scale, vec } from '../src/simulation/geometry';

const tour = createTour();
const course = COURSE_BY_ID.desert;
const hole = holeGeometry(course, 1);
const conditions = conditionsFor(calmWeather(course), 'smash');
const rng = createRng('smash');

console.log('Expected smash factor by club and player\n');
console.log('                       ' + ['D', '3W', '5i', '7i', 'PW', 'SW'].map((c) => c.padStart(8)).join(''));
for (const name of ['Lars Öhlund', 'Marcus Vandehey', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const g = tour.find((t) => t.name === name)!;
  const cells = ['D', '3W', '5i', '7i', 'PW', 'SW'].map((id) => {
    const p = smashProfile(g, CLUB_BY_ID[id as 'D'], LIES.fairway, 'full');
    return p.expected.toFixed(3).padStart(8);
  });
  console.log(`${name.padEnd(22)} ${cells.join('')}`);
}

console.log('\nA hundred drives each (carry + roll, from the tee)\n');
for (const name of ['Lars Öhlund', 'Marcus Vandehey', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const g = tour.find((t) => t.name === name)!;
  const ctx: ShotContext = {
    hole, golfer: g, ball: hole.tee, lie: 'tee', onTee: true, conditions, shotIndex: 0, pressure: 0,
  };
  const plan = planShot(ctx, { club: 'D', shotType: 'full', target: add(hole.tee, scale(vec(0, 1), 290)) });
  const totals: number[] = [];
  const smashes: number[] = [];
  let mishits = 0;
  for (let i = 0; i < 3000; i++) {
    const r = resolveShot(ctx, plan, rng);
    totals.push(r.total);
    smashes.push(r.smash);
    if (r.mishit) mishits++;
  }
  totals.sort((a, b) => a - b);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const sd = Math.sqrt(totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length);
  const skew = totals.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / totals.length;
  const meanSmash = smashes.reduce((a, b) => a + b, 0) / smashes.length;
  console.log(
    `${name.padEnd(22)} bag ${bagFor(g).D.total.toFixed(0)}  mean ${mean.toFixed(0)}  sd ${sd.toFixed(1)}  skew ${skew.toFixed(2)}  ` +
      `smash ${meanSmash.toFixed(3)}  mishits ${((mishits / 3000) * 100).toFixed(0)}%`,
  );
  const pct = (q: number) => totals[Math.floor(q * totals.length)].toFixed(0);
  console.log(`                       5% ${pct(0.05)}   25% ${pct(0.25)}   50% ${pct(0.5)}   75% ${pct(0.75)}   95% ${pct(0.95)}   longest ${totals[totals.length - 1].toFixed(0)}`);
}

console.log('\nStrike quality versus where it finished (Marcus Vandehey, driver)');
{
  const g = tour.find((t) => t.name === 'Marcus Vandehey')!;
  const ctx: ShotContext = { hole, golfer: g, ball: hole.tee, lie: 'tee', onTee: true, conditions, shotIndex: 0, pressure: 0 };
  const plan = planShot(ctx, { club: 'D', shotType: 'full', target: add(hole.tee, scale(vec(0, 1), 290)) });
  const buckets = new Map<string, { n: number; total: number; offline: number; fairway: number }>();
  for (let i = 0; i < 6000; i++) {
    const r = resolveShot(ctx, plan, rng);
    const key = r.quality;
    const e = buckets.get(key) ?? { n: 0, total: 0, offline: 0, fairway: 0 };
    e.n++;
    e.total += r.total;
    e.offline += Math.abs(r.deviation);
    if (r.finalLie === 'fairway' || r.finalLie === 'firstCut') e.fairway++;
    buckets.set(key, e);
  }
  for (const [key, e] of [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${key.padEnd(28)} ${((e.n / 6000) * 100).toFixed(0).padStart(3)}%  ` +
        `${(e.total / e.n).toFixed(0)} yd  ${(e.offline / e.n).toFixed(0)} yd offline  fairway ${((e.fairway / e.n) * 100).toFixed(0)}%`,
    );
  }
}
