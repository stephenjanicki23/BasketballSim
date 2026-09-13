/**
 * Short game and scrambling: proximity and up-and-down rates from around the
 * green. Tour benchmarks — scrambling 58%, sand saves 50%, proximity from 20
 * yards about 7 feet, from a greenside bunker about 9 feet.
 */
import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, terrainAt } from '../src/simulation/courseEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { chooseShot } from '../src/simulation/holeEngine';
import { resolveShot, type ShotContext } from '../src/simulation/shotEngine';
import { planPutt, resolvePutt } from '../src/simulation/puttingEngine';
import { createRng } from '../src/simulation/rng';
import { add, scale, vec, norm, sub, dist } from '../src/simulation/geometry';

const tour = createTour();
const course = COURSE_BY_ID.woodland;
const hole = holeGeometry(course, 5);
const conditions = conditionsFor(calmWeather(course), 'sg');
const rng = createRng('shortgame');

// Approach the green from the tee side, so "short of the green" is realistic.
const inward = norm(sub(hole.pin, hole.centerline[hole.centerline.length - 8]));

for (const name of ['Paulo Bettencourt', 'Marcus Vandehey', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const golfer = tour.find((g) => g.name === name)!;
  const cells: string[] = [];
  for (const yards of [8, 15, 25, 40, 60]) {
    const ball = add(hole.pin, scale(inward, -yards));
    const info = terrainAt(hole, ball);
    const ctx: ShotContext = { hole, golfer, ball, lie: info.lie, onTee: false, conditions, shotIndex: 0, pressure: 0 };
    let proximity = 0;
    let upDown = 0;
    const N = 1200;
    for (let i = 0; i < N; i++) {
      const plan = chooseShot(ctx, rng, true);
      const result = resolveShot(ctx, plan, rng);
      const left = dist(result.final, hole.pin);
      proximity += result.holed ? 0 : left;
      if (result.holed) {
        upDown++;
        continue;
      }
      // One putt to save.
      const puttCtx: ShotContext = { ...ctx, ball: result.final, lie: result.finalLie };
      if (result.finalLie === 'green') {
        const provisional = planPutt(puttCtx, hole.pin);
        if (resolvePutt(puttCtx, planPutt(puttCtx, provisional.recommendedAim), rng).holed) upDown++;
      }
    }
    cells.push(`${yards}y(${info.lie.slice(0, 4)}) ${((proximity / N) * 3).toFixed(0)}ft/${((upDown / N) * 100).toFixed(0)}%`);
  }
  console.log(`${golfer.name.padEnd(20)} chip ${String(golfer.ratings.chipping).padStart(2)}  ${cells.join('  ')}`);
}

console.log('\nGreenside bunker (sand saves — tour 50%)');
for (const name of ['Paulo Bettencourt', 'Marcus Vandehey', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const golfer = tour.find((g) => g.name === name)!;
  const bunker = hole.bunkers.find((b) => b.kind === 'greenside')!;
  const ball = bunker.blob.center;
  const info = terrainAt(hole, ball);
  const ctx: ShotContext = { hole, golfer, ball, lie: info.lie, onTee: false, conditions, shotIndex: 0, pressure: 0, deepBunker: info.deepBunker };
  let proximity = 0;
  let saves = 0;
  let stillIn = 0;
  const N = 1500;
  for (let i = 0; i < N; i++) {
    const plan = chooseShot(ctx, rng, true);
    const result = resolveShot(ctx, plan, rng);
    if (result.holed) {
      saves++;
      continue;
    }
    proximity += dist(result.final, hole.pin);
    if (result.finalLie === 'greensideBunker') stillIn++;
    if (result.finalLie === 'green') {
      const puttCtx: ShotContext = { ...ctx, ball: result.final, lie: 'green' };
      const provisional = planPutt(puttCtx, hole.pin);
      if (resolvePutt(puttCtx, planPutt(puttCtx, provisional.recommendedAim), rng).holed) saves++;
    }
  }
  console.log(
    `${golfer.name.padEnd(20)} bunker ${String(golfer.ratings.bunkerPlay).padStart(2)}  lie ${info.lie}  ` +
      `${dist(ball, hole.pin).toFixed(0)} yd  proximity ${((proximity / N) * 3).toFixed(0)} ft  saves ${((saves / N) * 100).toFixed(0)}%  left in ${((stillIn / N) * 100).toFixed(0)}%`,
  );
}
console.log(`${vec(0, 0).x === 0 ? '' : ''}`);
