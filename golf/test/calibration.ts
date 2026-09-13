/**
 * Calibration harness. Runs the engines head-on and prints the numbers that
 * decide whether the game feels like golf: driving distances, fairways hit,
 * approach proximity and make percentages, against the real tour figures.
 */

import { createTour } from '../src/data/golfers';
import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, terrainAt } from '../src/simulation/courseEngine';
import { bagFor, driverCarry } from '../src/simulation/golferEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import { planShot, resolveShot, type ShotContext } from '../src/simulation/shotEngine';
import { makeProbability, planPutt, resolvePutt } from '../src/simulation/puttingEngine';
import { createRng } from '../src/simulation/rng';
import { add, scale, vec, pointAlongPolyline, perp } from '../src/simulation/geometry';
import type { Golfer } from '../src/simulation/types';

const tour = createTour();
const course = COURSE_BY_ID.desert;
const weather = calmWeather(course);
const conditions = conditionsFor(weather, 'calibration');
const rng = createRng('calibration');

console.log(`Tour size: ${tour.length}`);
const abilities = tour.map((g) => g.hidden.currentAbility).sort((a, b) => b - a);
console.log(`Ability: best ${abilities[0]}, top-5 ${abilities.slice(0, 5).join(',')}, median ${abilities[24]}, worst ${abilities[49]}`);

console.log('\n--- Driver distances (neutral conditions) ---');
const byDistance = [...tour].sort((a, b) => driverCarry(b) - driverCarry(a));
for (const g of [byDistance[0], byDistance[1], byDistance[24], byDistance[48], byDistance[49]]) {
  const bag = bagFor(g);
  console.log(
    `  ${g.name.padEnd(22)} carry ${bag.D.carry.toFixed(0)}  total ${bag.D.total.toFixed(0)}  ` +
      `7i ${bag['7i'].total.toFixed(0)}  PW ${bag.PW.total.toFixed(0)}  SW ${bag.SW.total.toFixed(0)}`,
  );
}

function contextFor(g: Golfer, holeNumber: number, ball: { x: number; y: number }, lie: ShotContext['lie'], onTee: boolean): ShotContext {
  return { hole: holeGeometry(course, holeNumber), golfer: g, ball, lie, onTee, conditions, shotIndex: 0, pressure: 0 };
}

console.log('\n--- Tee shots: driver at the middle of the fairway (hole 1, 420 yards) ---');
const hole = holeGeometry(course, 1);
const landingSpot = pointAlongPolyline(hole.centerline, 290).point;
for (const name of ['Lars Öhlund', 'Kaito Shirakawa', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const g = tour.find((t) => t.name === name)!;
  const ctx = contextFor(g, 1, hole.tee, 'tee', true);
  const plan = planShot(ctx, { club: 'D', shotType: 'full', target: landingSpot });
  let fairway = 0;
  let trouble = 0;
  let totalDistance = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const result = resolveShot(ctx, plan, rng);
    const lie = result.finalLie;
    if (lie === 'fairway' || lie === 'firstCut' || lie === 'tee') fairway++;
    if (lie === 'water' || lie === 'ob' || lie === 'recovery' || lie === 'deepRough') trouble++;
    totalDistance += result.total;
  }
  console.log(
    `  ${g.name.padEnd(22)} σ ${plan.sigmaLong.toFixed(1)}/${plan.sigmaLat.toFixed(1)} yd  ` +
      `fairway ${((fairway / N) * 100).toFixed(1)}%  trouble ${((trouble / N) * 100).toFixed(1)}%  ` +
      `avg ${(totalDistance / N).toFixed(0)} yd  model-odds fwy ${(plan.odds.fairway * 100).toFixed(0)}%`,
  );
}

console.log('\n--- Approach from 165 yards to a middle pin ---');
const approachHole = holeGeometry(course, 3);
const right = perp({ x: 0, y: 1 });
for (const name of ['Diego Sandoval', 'Marcus Vandehey', 'Hugo Marchetti', 'Alec Pemberton']) {
  const g = tour.find((t) => t.name === name)!;
  const ball = add(approachHole.pin, scale(vec(0, -1), 165));
  const ctx = contextFor(g, 3, ball, 'fairway', false);
  const club = Object.values(bagFor(g)).filter((y) => y.club.id !== 'P').reduce((best, y) => (Math.abs(y.total - 165) < Math.abs(best.total - 165) ? y : best));
  const plan = planShot(ctx, { club: club.club.id, shotType: 'full', target: approachHole.pin });
  let green = 0;
  let proximity = 0;
  let inside10 = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const result = resolveShot(ctx, plan, rng);
    const d = Math.hypot(result.final.x - approachHole.pin.x, result.final.y - approachHole.pin.y);
    if (result.finalLie === 'green') green++;
    proximity += d;
    if (d <= 10 / 3) inside10++;
  }
  console.log(
    `  ${g.name.padEnd(20)} ${club.club.short}  σ ${plan.sigmaLong.toFixed(1)}/${plan.sigmaLat.toFixed(1)}  ` +
      `green ${((green / N) * 100).toFixed(0)}%  proximity ${((proximity / N) * 3).toFixed(0)} ft  inside 10ft ${((inside10 / N) * 100).toFixed(0)}%`,
  );
}
console.log(`  ${right ? '' : ''}`.trim());

console.log('\n--- Putting make percentages (tour targets: 3ft 97, 5ft 85, 8ft 60, 10ft 45, 15ft 28, 20ft 18, 30ft 8) ---');
const puttHole = holeGeometry(course, 12);
for (const name of ['Jae-won Park', 'Marcus Vandehey', 'Hugo Marchetti', 'Tevita Fonoti']) {
  const g = tour.find((t) => t.name === name)!;
  const cells: string[] = [];
  for (const feet of [3, 5, 8, 10, 15, 20, 30, 40]) {
    const ball = add(puttHole.pin, scale(vec(0, -1), feet / 3));
    const ctx = contextFor(g, 12, ball, 'green', false);
    const plan = planPutt(ctx, plan0(ctx, feet));
    let made = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (resolvePutt(ctx, plan, rng).holed) made++;
    cells.push(`${feet}ft ${((made / N) * 100).toFixed(0)}%`);
  }
  console.log(`  ${g.name.padEnd(20)} putting ${String(g.ratings.putting).padStart(2)}  ${cells.join('  ')}`);
}

function plan0(ctx: ShotContext, _feet: number) {
  // Aim at the recommended line: what a player following the read would do.
  const provisional = planPutt(ctx, ctx.hole.pin);
  return provisional.recommendedAim;
}

console.log('\n--- Analytic make probability (no simulation) ---');
for (const skill of [96, 80, 68, 50]) {
  const row = [3, 5, 8, 10, 15, 20, 30].map((f) => `${f}ft ${(makeProbability(f, skill) * 100).toFixed(0)}%`);
  console.log(`  skill ${String(skill).padStart(2)}  ${row.join('  ')}`);
}

console.log('\n--- Lie effects: 7 iron from 160 yards out of each lie (Marcus Vandehey) ---');
{
  const g = tour.find((t) => t.name === 'Marcus Vandehey')!;
  const target = approachHole.pin;
  const ball = add(target, scale(vec(0, -1), 160));
  for (const lie of ['fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough', 'fairwayBunker', 'pineStraw', 'recovery'] as const) {
    const ctx = contextFor(g, 3, ball, lie, false);
    const plan = planShot(ctx, { club: '6i', shotType: 'full', target });
    let proximity = 0;
    let short = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const r = resolveShot(ctx, plan, rng);
      proximity += Math.hypot(r.final.x - target.x, r.final.y - target.y);
      short += r.total;
    }
    console.log(
      `  ${lie.padEnd(16)} carry ${plan.expectedCarry.toFixed(0)}  σ ${plan.sigmaLong.toFixed(1)}/${plan.sigmaLat.toFixed(1)}  ` +
        `avg total ${(short / N).toFixed(0)}  proximity ${(proximity / N).toFixed(0)} yd  warnings: ${plan.warnings.length}`,
    );
  }
}

console.log('\n--- Wind: 7 iron, 165 yards, Coastal hole 8 ---');
{
  const windCourse = COURSE_BY_ID.coastal;
  const windHole = holeGeometry(windCourse, 8);
  const g = tour.find((t) => t.name === 'Rory Ballantyne')!;
  const weak = tour.find((t) => t.name === 'Tevita Fonoti')!;
  for (const speed of [0, 12, 25, 38]) {
    const w = { ...calmWeather(windCourse), windSpeed: speed, gust: 0, windFrom: windHole.spec.bearing };
    const cond = conditionsFor(w, 'wind');
    for (const golfer of [g, weak]) {
      const ball = add(windHole.pin, scale(vec(0, -1), 165));
      const ctx: ShotContext = { hole: windHole, golfer, ball, lie: 'fairway', onTee: false, conditions: cond, shotIndex: 0, pressure: 0 };
      const plan = planShot(ctx, { club: '6i', shotType: 'full', target: windHole.pin });
      console.log(
        `  ${String(speed).padStart(2)} mph into  ${golfer.name.padEnd(18)} wind ${String(golfer.ratings.wind).padStart(2)}  ` +
          `plays like ${plan.playsLike.toFixed(0)} yd  σ ${plan.sigmaLong.toFixed(1)}/${plan.sigmaLat.toFixed(1)}  expected ${plan.expectedTotal.toFixed(0)} yd`,
      );
    }
  }
}
