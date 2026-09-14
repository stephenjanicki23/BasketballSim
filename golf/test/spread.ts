/**
 * Round-to-round variance versus player-to-player difference.
 *
 * Tour reality: a player's own scoring varies by about 2.9 strokes round to
 * round, while the gap between the best player's average and the worst on tour
 * is only about 4 strokes. That ratio is why twenty events produce fifteen
 * different winners. If between-player differences get too large relative to
 * within-player variance, the best golfer wins everything.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, pinForRound, withPin } from '../src/simulation/courseEngine';
import { playHole } from '../src/simulation/holeEngine';
import { conditionsFor, generateWeather } from '../src/simulation/weatherEngine';
import { createRng } from '../src/simulation/rng';
import { dailyTouch } from '../src/simulation/golferEngine';

const tour = createTour().sort((a, b) => b.hidden.currentAbility - a.hidden.currentAbility);
const course = COURSE_BY_ID[process.argv[2] ?? 'desert'];
const ROUNDS = Number(process.argv[3] ?? 20);
const sample = [0, 4, 9, 17, 27, 37, 44, 49].map((i) => tour[i]);

const rows: { name: string; ability: number; mean: number; sd: number; low: number; high: number }[] = [];
const start = performance.now();
for (const golfer of sample) {
  const scores: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const rng = createRng(`spread:${golfer.id}:${r}`);
    const touch = dailyTouch(golfer, rng.fork('touch'));
    const weather = generateWeather(course, createRng(`spreadw:${r}`));
    const conditions = conditionsFor(weather, `spread:${r}`);
    golfer.fatigue = 0;
    let total = 0;
    for (let h = 1; h <= 18; h++) {
      const base = holeGeometry(course, h);
      const hole = withPin(base, pinForRound(base, (r % 4) + 1));
      total += playHole({ hole, golfer, conditions, rng, pressure: 0.15, fast: true, shotSeed: h * 7 + r, touch }).strokes;
    }
    scores.push(total);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length);
  rows.push({ name: golfer.name, ability: golfer.hidden.currentAbility, mean, sd, low: Math.min(...scores), high: Math.max(...scores) });
}

console.log(`${course.name}, ${ROUNDS} rounds each, mixed weather  (${((performance.now() - start) / 1000).toFixed(1)}s)`);
for (const r of rows) {
  console.log(`  ability ${String(r.ability).padStart(2)}  ${r.name.padEnd(22)} mean ${r.mean.toFixed(2)}  sd ${r.sd.toFixed(2)}  range ${r.low}-${r.high}`);
}
const best = rows[0];
const worst = rows[rows.length - 1];
const slope = (worst.mean - best.mean) / (best.ability - worst.ability);
console.log(`\n  spread between best and worst: ${(worst.mean - best.mean).toFixed(2)} strokes over ${best.ability - worst.ability} ability points`);
console.log(`  slope: ${slope.toFixed(3)} strokes per ability point (target about 0.13)`);
console.log(`  average within-player sd: ${(rows.reduce((s, r) => s + r.sd, 0) / rows.length).toFixed(2)} (target about 2.9)`);
