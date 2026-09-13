/**
 * Where are golfers when they miss a green, and how often do they get up and
 * down from there? Tour scrambling is 58%.
 */
import { createTour } from '../src/data/golfers';
import { COURSES } from '../src/data/courses';
import { holeGeometry } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import type { LieType } from '../src/simulation/types';

const tour = createTour();
const buckets = new Map<string, { tries: number; saves: number }>();
const lies = new Map<LieType, { tries: number; saves: number }>();
let tries = 0;
let saves = 0;

for (const course of COURSES) {
  const conditions = conditionsFor(calmWeather(course), 'scr');
  for (const golfer of tour) {
    const rng = createRng(`scr:${course.id}:${golfer.id}`);
    golfer.fatigue = 0;
    for (let h = 1; h <= 18; h++) {
      const hole = holeGeometry(course, h);
      const outcome = playHole({ hole, golfer, conditions, rng, pressure: 0 });
      if (outcome.scrambled === null) continue;
      tries++;
      if (outcome.scrambled) saves++;
      // The ball's position when the green was missed in regulation.
      const regulation = outcome.par - 2;
      const shot = outcome.shots[regulation - 1];
      if (!shot) continue;
      const yards = shot.toPinAfter;
      const bucket = yards < 10 ? '0-10y' : yards < 20 ? '10-20y' : yards < 35 ? '20-35y' : yards < 60 ? '35-60y' : yards < 110 ? '60-110y' : '110y+';
      const entry = buckets.get(bucket) ?? { tries: 0, saves: 0 };
      entry.tries++;
      if (outcome.scrambled) entry.saves++;
      buckets.set(bucket, entry);
      const lieEntry = lies.get(shot.lieAfter) ?? { tries: 0, saves: 0 };
      lieEntry.tries++;
      if (outcome.scrambled) lieEntry.saves++;
      lies.set(shot.lieAfter, lieEntry);
    }
  }
}

console.log(`Overall scrambling: ${((saves / tries) * 100).toFixed(1)}% over ${tries} attempts (tour 58%)`);
console.log('\nBy distance from the pin when the green was missed:');
for (const key of ['0-10y', '10-20y', '20-35y', '35-60y', '60-110y', '110y+']) {
  const e = buckets.get(key);
  if (!e) continue;
  console.log(`  ${key.padEnd(9)} ${String(e.tries).padStart(5)} attempts  ${((e.saves / e.tries) * 100).toFixed(0)}% saved  (${((e.tries / tries) * 100).toFixed(0)}% of misses)`);
}
console.log('\nBy lie:');
for (const [lie, e] of [...lies.entries()].sort((a, b) => b[1].tries - a[1].tries)) {
  console.log(`  ${lie.padEnd(17)} ${String(e.tries).padStart(5)} attempts  ${((e.saves / e.tries) * 100).toFixed(0)}% saved`);
}
