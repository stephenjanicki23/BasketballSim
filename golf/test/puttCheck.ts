/**
 * Putting calibration against the specified bands.
 *
 *   3 ft   elite 95+   average 90–95   poor 80–90
 *   5 ft   elite 80–90 average 70–80   poor 55–70
 *   8 ft   elite 50–60 average 40–50   poor 25–40
 *  15 ft   elite 20–30 average 15–20   poor 8–15
 *  30 ft   elite 6–10  average 3–6     poor 1–3
 */
import { COURSE_BY_ID } from '../src/data/courses';
import { createTour } from '../src/data/golfers';
import { holeGeometry } from '../src/simulation/courseEngine';
import { calmWeather, conditionsFor } from '../src/simulation/weatherEngine';
import {
  choosePuttIntent, puttDecision, readGreen, resolvePutt, type PuttSituation,
} from '../src/simulation/puttingEngine';
import { createRng } from '../src/simulation/rng';
import { add, scale, vec } from '../src/simulation/geometry';
import type { ShotContext } from '../src/simulation/shotEngine';
import type { Golfer, Ratings } from '../src/simulation/types';

const tour = createTour();
const course = COURSE_BY_ID.desert;
const hole = holeGeometry(course, 12);
const rng = createRng('putt');

/** A golfer with every putting rating pinned, so the bands are clean. */
function dummy(rating: number, name: string): Golfer {
  const base = tour[0];
  const ratings: Ratings = { ...base.ratings };
  for (const key of ['putting', 'shortPutting', 'longPutting', 'lagPutting', 'greenReading', 'speedControl', 'puttingPressure'] as const) {
    ratings[key] = rating;
  }
  return { ...base, id: `dummy-${rating}`, name, ratings, puttingStyle: 'steady', fatigue: 0 };
}

function context(golfer: Golfer, feet: number, pressure = 0, holeNumber = 12): ShotContext {
  // Straight up the fall line is not representative; offset so there is a read.
  const g = holeGeometry(course, holeNumber);
  const ball = add(g.pin, scale(vec(-0.7, -0.71), feet / 3));
  return {
    hole: g, golfer, ball, lie: 'green', onTee: false,
    conditions: conditionsFor(calmWeather(course), 'putt'), shotIndex: 0, pressure,
  };
}

console.log('Make percentage by distance (analytic headline / simulated)\n');
console.log('           ' + [3, 5, 8, 10, 15, 20, 30, 40, 60].map((f) => `${f}ft`.padStart(9)).join(''));
for (const [label, rating] of [['elite', 95], ['average', 72], ['poor', 48]] as const) {
  const golfer = dummy(rating, label);
  const cells: string[] = [];
  for (const feet of [3, 5, 8, 10, 15, 20, 30, 40, 60]) {
    const ctx = context(golfer, feet);
    const plan = puttDecision(ctx);
    let made = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (resolvePutt(ctx, 'attack', rng, plan.read).holed) made++;
    cells.push(`${(plan.estimatedMake * 100).toFixed(0)}/${((made / N) * 100).toFixed(0)}`.padStart(9));
  }
  console.log(`${label.padEnd(10)} ${cells.join('')}`);
}

console.log('\nLag versus go-for-it (average putter)');
const avg = dummy(72, 'average');
for (const feet of [8, 15, 25, 45]) {
  const ctx = context(avg, feet);
  const plan = puttDecision(ctx);
  console.log(`  ${String(feet).padStart(2)} ft — headline ${(plan.estimatedMake * 100).toFixed(0)}%`);
  for (const option of plan.options) {
    console.log(
      `      ${option.name.padEnd(10)} make ${(option.make * 100).toFixed(0)}%  3-putt ${(option.threePutt * 100).toFixed(0)}%  ` +
        `leave ${option.expectedLeaveFeet.toFixed(1)} ft  within 3ft ${(option.within3 * 100).toFixed(0)}%  ` +
        `within 5ft ${(option.within5 * 100).toFixed(0)}%  within 10ft ${(option.within10 * 100).toFixed(0)}%  ` +
        `E[putts] ${option.expectedPutts.toFixed(2)}`,
    );
  }
}

console.log('\nSimulated three-putt rate from 45 feet (2000 putts each, second putt played out)');
for (const intent of ['safe', 'lag', 'attack'] as const) {
  const ctx = context(avg, 45);
  const read = readGreen(ctx);
  let putts = 0;
  let three = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    let taken = 0;
    let current = ctx;
    let choice = intent;
    for (let k = 0; k < 5; k++) {
      const result = resolvePutt(current, choice, rng, k === 0 ? read : undefined);
      taken++;
      if (result.holed) break;
      current = { ...current, ball: result.final };
      choice = 'attack';
    }
    putts += taken;
    if (taken >= 3) three++;
  }
  console.log(`  ${intent.padEnd(7)} average ${(putts / N).toFixed(2)} putts, three-putt ${((three / N) * 100).toFixed(1)}%`);
}

console.log('\nBreak, slope and speed (average putter, 15 ft)');
for (const [label, side, grade, stimp] of [
  ['flat, medium', 0.2, 0, 11],
  ['moderate break', 2.2, 0, 11],
  ['downhill', 0.2, 2.4, 11],
  ['downhill + fast', 0.2, 2.4, 13],
  ['uphill', 0.2, -2.4, 11],
  ['severe break, fast', 2.8, 1.5, 13],
] as const) {
  const weather = { ...calmWeather(course), greenSpeed: stimp };
  const ctx: ShotContext = { ...context(avg, 15), conditions: conditionsFor(weather, 'putt') };
  // Override the slope by building the read by hand.
  const read = readGreen(ctx);
  const tuned = { ...read, sideGrade: side, grade, greenSpeed: stimp };
  tuned.breakFeet = 0.0075 * side * Math.pow(15, 1.6) * (stimp / 11) * (1 + Math.max(0, grade) * 0.06);
  tuned.riseFeet = (-grade / 100) * 15;
  tuned.playsLikeFeet = Math.max(0.5, 15 + tuned.riseFeet * 7);
  const options = ['lag', 'attack'].map((intent) => {
    const plan = puttDecision({ ...ctx });
    void plan;
    return intent;
  });
  void options;
  const decision = puttDecision(ctx);
  void decision;
  console.log(`  ${label.padEnd(20)} break ${tuned.breakFeet.toFixed(2)} ft  plays ${tuned.playsLikeFeet.toFixed(0)} ft`);
}

console.log('\nAttack versus lag on a breaking putt and a straight one (average putter, 18 ft)');
for (const [label, holeNumber] of [['desert 12', 12], ['desert 4', 4], ['woodland 7', 7]] as const) {
  const g = holeGeometry(COURSE_BY_ID[label.startsWith('desert') ? 'desert' : 'woodland'], holeNumber);
  const ball = add(g.pin, scale(vec(-0.7, -0.71), 18 / 3));
  const ctx: ShotContext = {
    hole: g, golfer: avg, ball, lie: 'green', onTee: false,
    conditions: conditionsFor(calmWeather(course), 'putt'), shotIndex: 0, pressure: 0,
  };
  const plan = puttDecision(ctx);
  const lag = plan.options.find((o) => o.intent === 'lag')!;
  const atk = plan.options.find((o) => o.intent === 'attack')!;
  console.log(
    `  ${label.padEnd(12)} break ${plan.read.breakFeet.toFixed(2)} ft  ` +
      `lag ${(lag.make * 100).toFixed(0)}%/E${lag.expectedPutts.toFixed(2)}  ` +
      `attack ${(atk.make * 100).toFixed(0)}%/E${atk.expectedPutts.toFixed(2)}`,
  );
}

console.log('\nWho attacks and who lags — 20 feet for birdie on a breaking green, Sunday two behind');
const situation: PuttSituation = { round: 4, behind: 2, holesRemaining: 5, toPar: -1 };
for (const name of ['Lars Öhlund', 'Ben Cartwright', 'Kaito Shirakawa', 'Cole Vantassel', 'Gerrit Bakker', 'Jae-won Park']) {
  const golfer = tour.find((g) => g.name === name)!;
  const ctx = context(golfer, 20, 0.6, 4);
  const { intent, decision } = choosePuttIntent(ctx, situation);
  const option = decision.options.find((o) => o.intent === intent)!;
  console.log(
    `  ${name.padEnd(20)} ${golfer.puttingStyle.padEnd(13)} → ${intent.padEnd(7)} ` +
      `(make ${(option.make * 100).toFixed(0)}%, 3-putt ${(option.threePutt * 100).toFixed(0)}%, leave ${option.expectedLeaveFeet.toFixed(1)} ft)`,
  );
}

console.log('\nSame putt, protecting a one-shot lead with three to play');
const protecting: PuttSituation = { round: 4, behind: -1, holesRemaining: 3, toPar: -1 };
for (const name of ['Lars Öhlund', 'Ben Cartwright', 'Cole Vantassel']) {
  const golfer = tour.find((g) => g.name === name)!;
  const ctx = context(golfer, 20, 0.85, 4);
  const { intent } = choosePuttIntent(ctx, protecting);
  console.log(`  ${name.padEnd(20)} → ${intent}`);
}
