/**
 * Putting.
 *
 * Deliberately not a precision minigame. The player sees the slope, the break,
 * the pace and an honest dispersion cone, and clicks where they want to start
 * the ball. Everything after that is the golfer's skill: a poor putter's cone is
 * simply wider, and their read is worse, so they miss more.
 *
 * Calibration target is tour make percentages — roughly 97% from 3 feet, 85%
 * from 5, 60% from 8, 45% from 10, 28% from 15, 18% from 20 and 8% from 30.
 */

import { type Vec2, add, dist, norm, perp, scale, sub } from './geometry';
import { type Rng, clamp, lerp, normalCdf } from './rng';
import { TUNING } from './config';
import { NEUTRAL_TOUCH, effective, effectiveFatigue, pressureEffect, sigmaFactor } from './golferEngine';
import { greenSlopeAt } from './courseEngine';
import type { Golfer, LieType } from './types';
import type { ShotContext } from './shotEngine';

const FT = 3; // feet per yard

export interface PuttPlan {
  /** Straight-line distance to the hole. */
  distanceFeet: number;
  /** Distance the putt plays as, once the hill is taken into account. */
  playsLikeFeet: number;
  aim: Vec2;
  /** Unit vector from ball to hole. */
  line: Vec2;
  right: Vec2;
  /** How far the ball will curve, in feet; positive breaks right. */
  breakFeet: number;
  /** The point the golfer should start the ball on. */
  recommendedAim: Vec2;
  /** Downhill grade along the putt, in percent; positive is downhill. */
  grade: number;
  /** Side grade in percent; positive falls right. */
  sideGrade: number;
  riseFeet: number;
  sigmaLatFeet: number;
  sigmaDistFeet: number;
  greenSpeed: number;
  makeChance: number;
  threePuttChance: number;
  expectedPutts: number;
  /** How far the aim differs from the recommended line, in feet. */
  aimOffsetFeet: number;
  speedNote: string;
  readNote: string;
}

export interface PuttResult {
  holed: boolean;
  final: Vec2;
  /** How far from the hole the ball finished, in feet. */
  leaveFeet: number;
  /** How far past (or short of) the hole the ball ran, in feet. */
  paceFeet: number;
  path: Vec2[];
  notes: string[];
}

/** Blended putting skill: short putts, long putts and the stroke itself. */
function puttingSkill(golfer: Golfer, distanceFeet: number): number {
  const longShare = clamp((distanceFeet - 6) / 26, 0, 1);
  const lengthSkill = lerp(effective(golfer, 'shortPutting'), effective(golfer, 'longPutting'), longShare);
  return effective(golfer, 'putting') * 0.55 + lengthSkill * 0.45;
}

function readSkill(golfer: Golfer): number {
  return effective(golfer, 'putting') * 0.5 + effective(golfer, 'longPutting') * 0.3 + effective(golfer, 'decisionMaking') * 0.2;
}

/** How much of the break a golfer of this quality curves it, per foot of slope. */
export function breakFor(distanceFeet: number, sideGrade: number, greenSpeed: number): number {
  return 0.0075 * sideGrade * Math.pow(Math.max(distanceFeet, 0.5), 1.6) * (greenSpeed / 11);
}

export function planPutt(ctx: ShotContext, target: Vec2): PuttPlan {
  const { hole, golfer, ball, conditions } = ctx;
  const toHole = sub(hole.pin, ball);
  const distanceYards = Math.max(0.08, dist(ball, hole.pin));
  const distanceFeet = distanceYards * FT;
  const line = norm(toHole.x === 0 && toHole.y === 0 ? { x: 0, y: 1 } : toHole);
  const right = perp(line);

  // Read the slope halfway along the putt.
  const mid = add(ball, scale(line, distanceYards / 2));
  const slope = greenSlopeAt(hole, mid);
  const grade = slope.x * line.x + slope.y * line.y; // positive: downhill
  const sideGrade = slope.x * right.x + slope.y * right.y; // positive: falls right
  const riseFeet = (-grade / 100) * distanceFeet;

  const greenSpeed = conditions.weather.greenSpeed;
  const breakFeet = breakFor(distanceFeet, sideGrade, greenSpeed);
  const recommendedAim = add(hole.pin, scale(right, -breakFeet / FT));

  // Uphill putts have to be hit harder, which is a longer putt in every way.
  const playsLikeFeet = Math.max(0.5, distanceFeet + riseFeet * 7);

  const skill = puttingSkill(golfer, distanceFeet);
  const pressure = pressureEffect(golfer, ctx.pressure, 'putt');
  const fatigue = 1 + effectiveFatigue(golfer) / 100 * 0.10;
  const wet = 1 + conditions.weather.rain * 0.10;
  const lieExtra = (ctx.lie as LieType) === 'fringe' ? 1.35 : 1;
  const touch = (ctx.touch ?? NEUTRAL_TOUCH).putting;

  const sigmaLatFeet =
    Math.max(TUNING.puttSigmaFloor, TUNING.puttSigmaCoef * Math.pow(distanceFeet, TUNING.puttSigmaExp)) *
    sigmaFactor(skill) * pressure.sigma * fatigue * wet * lieExtra * touch * (1 + Math.abs(sideGrade) * 0.06);

  const sigmaDistFeet =
    (TUNING.puttDistanceCoef * playsLikeFeet + TUNING.puttDistanceBase) *
    sigmaFactor(skill) * pressure.sigma * fatigue * wet * lieExtra * touch *
    (1 + Math.abs(grade) * 0.05 + Math.max(0, grade) * 0.05) *
    (greenSpeed > 12 ? 1.06 : 1);

  const offset = sub(target, hole.pin);
  const aimOffsetFeet = (offset.x * right.x + offset.y * right.y) * FT;
  // Aiming at the recommended line cancels the break exactly; anything else is
  // a deliberate choice the golfer has to live with.
  const meanLatFeet = aimOffsetFeet + breakFeet;
  const sigmaReadFeet = Math.abs(breakFeet) * TUNING.readErrorShare * (1 - (readSkill(golfer) - 50) * 0.006);
  const stats = puttStats(distanceFeet, playsLikeFeet, sigmaLatFeet, sigmaDistFeet, meanLatFeet, sigmaReadFeet, skill);

  const speedNote =
    Math.abs(riseFeet) < 0.2
      ? 'Flat'
      : riseFeet > 0
        ? `Uphill ${riseFeet.toFixed(1)} ft — plays ${Math.round(playsLikeFeet)} ft`
        : `Downhill ${Math.abs(riseFeet).toFixed(1)} ft — plays ${Math.round(playsLikeFeet)} ft`;
  const readNote =
    Math.abs(breakFeet) < 0.15
      ? 'Dead straight'
      : `Breaks ${Math.abs(breakFeet) < 1 ? Math.round(Math.abs(breakFeet) * 12) + ' in' : Math.abs(breakFeet).toFixed(1) + ' ft'} ${breakFeet > 0 ? 'right' : 'left'}`;

  return {
    distanceFeet,
    playsLikeFeet,
    aim: target,
    line,
    right,
    breakFeet,
    recommendedAim,
    grade,
    sideGrade,
    riseFeet,
    sigmaLatFeet,
    sigmaDistFeet,
    greenSpeed,
    makeChance: stats.make,
    threePuttChance: stats.threePutt,
    expectedPutts: stats.expected,
    aimOffsetFeet,
    speedNote,
    readNote,
  };
}

/** Effective capture width: a ball travelling fast has less of a hole to fall into. */
function captureWidth(paceFeet: number): number {
  return TUNING.holeCapture * (1 - clamp(paceFeet / 7, 0, 0.55));
}

/** Average capture width over a normal spread of paces. */
const AVERAGE_CAPTURE = TUNING.holeCapture * 0.86;

/** How far past the hole a golfer tries to carry the ball. */
function holdFeet(distanceFeet: number): number {
  return clamp(1.1 + distanceFeet * 0.02, 0.9, 2.2);
}

function window(lo: number, hi: number, mean: number, sigma: number): number {
  const s = Math.max(sigma, 1e-6);
  return normalCdf((hi - mean) / s) - normalCdf((lo - mean) / s);
}

export interface PuttStats {
  make: number;
  threePutt: number;
  expected: number;
  expectedLeaveFeet: number;
}

/**
 * The odds on a putt, analytically.
 *
 * Quadrature is no good here: the hole is a fifth of a foot wide and a 20-footer
 * has a lateral spread five times that, so any sampling scheme coarse enough to
 * be cheap simply misses the hole entirely. Two normal integrals do the job
 * exactly — one for the line, one for the pace — and the leave distance, which
 * *is* smooth, is the only thing worth sampling.
 */
export function puttStats(
  distanceFeet: number,
  playsLikeFeet: number,
  sigmaLatFeet: number,
  sigmaDistFeet: number,
  meanLatFeet: number,
  sigmaReadFeet: number,
  skill: number,
): PuttStats {
  const sigmaLine = Math.hypot(sigmaLatFeet, sigmaReadFeet);
  const hold = holdFeet(distanceFeet);
  // A downhill putt needs less energy, so the same energy error runs the ball
  // further past the hole in real feet. That is why downhill is the hard one.
  const paceSigma = sigmaDistFeet * clamp(distanceFeet / Math.max(playsLikeFeet, 0.5), 0.7, 1.6);
  const line = window(-AVERAGE_CAPTURE, AVERAGE_CAPTURE, meanLatFeet, sigmaLine);
  const pace = window(-0.05, 5.0, hold, paceSigma);
  const make = clamp(line * pace, 0.0004, 0.999);

  // Expected leave, sampled over the two error axes. Smooth, so strata are fine.
  const nodes = [-1.968, -1.205, -0.757, -0.386, 0, 0.386, 0.757, 1.205, 1.968];
  let leaveSum = 0;
  let leaveWeight = 0;
  for (const zi of nodes) {
    const paceFeet = hold + zi * paceSigma;
    for (const zj of nodes) {
      const lat = meanLatFeet + zj * sigmaLine;
      if (paceFeet >= -0.05 && paceFeet <= 5.0 && Math.abs(lat) <= captureWidth(paceFeet)) continue;
      const along = paceFeet < 0 ? paceFeet : paceFeet * 0.92;
      const leave = Math.hypot(along, lat * (paceFeet < 0 ? 0.65 : 1));
      leaveSum += Math.max(0.3, leave);
      leaveWeight += 1;
    }
  }
  const expectedLeaveFeet = leaveWeight > 0 ? leaveSum / leaveWeight : 0.8;
  const secondMake = simpleMake(expectedLeaveFeet, skill);
  const threePutt = (1 - make) * (1 - secondMake);
  const expected = 1 + (1 - make) * (1 + (1 - secondMake) * 1.12);
  return { make, threePutt, expected, expectedLeaveFeet };
}

/** Make probability for a straight putt of a given length. */
function simpleMake(distanceFeet: number, skill: number): number {
  const sigmaLat = Math.max(TUNING.puttSigmaFloor, TUNING.puttSigmaCoef * Math.pow(distanceFeet, TUNING.puttSigmaExp)) * sigmaFactor(skill);
  const sigmaDist = (TUNING.puttDistanceCoef * distanceFeet + TUNING.puttDistanceBase) * sigmaFactor(skill);
  const hold = holdFeet(distanceFeet);
  return clamp(
    window(-AVERAGE_CAPTURE, AVERAGE_CAPTURE, 0, sigmaLat) * window(-0.05, 5.0, hold, sigmaDist),
    0.0004,
    0.999,
  );
}

/**
 * Standalone make probability, for second putts, the leaderboard AI and the
 * strokes-gained baseline. `sideGrade` is the average side slope in percent.
 */
export function makeProbability(distanceFeet: number, skill: number, sideGrade = 1.2, greenSpeed = 11.5): number {
  const sigmaLat =
    Math.max(TUNING.puttSigmaFloor, TUNING.puttSigmaCoef * Math.pow(distanceFeet, TUNING.puttSigmaExp)) * sigmaFactor(skill);
  const sigmaDist = (TUNING.puttDistanceCoef * distanceFeet + TUNING.puttDistanceBase) * sigmaFactor(skill);
  const brk = breakFor(distanceFeet, sideGrade, greenSpeed);
  const readSigma = Math.abs(brk) * TUNING.readErrorShare * (1 - (skill - 50) * 0.006);
  return puttStats(distanceFeet, distanceFeet, sigmaLat, sigmaDist, 0, readSigma, skill).make;
}

export function resolvePutt(ctx: ShotContext, plan: PuttPlan, rng: Rng): PuttResult {
  const { hole, golfer } = ctx;
  const notes: string[] = [];

  // The golfer's own read, on top of wherever the player aimed.
  const read = readSkill(golfer);
  const readError = rng.normal() * Math.abs(plan.breakFeet) * TUNING.readErrorShare * (1 - (read - 50) * 0.006);
  const target = plan.playsLikeFeet + clamp(1.1 + plan.distanceFeet * 0.02, 0.9, 2.2);
  const travelled = target + rng.normal() * plan.sigmaDistFeet;
  const latMiss = rng.normal() * plan.sigmaLatFeet + readError + plan.aimOffsetFeet + plan.breakFeet;

  const pace = travelled - plan.playsLikeFeet;
  const holed = pace >= -0.05 && pace <= 5.5 && Math.abs(latMiss) <= captureWidth(pace);

  if (holed) {
    return {
      holed: true,
      final: hole.pin,
      leaveFeet: 0,
      paceFeet: pace,
      path: puttPath(ctx.ball, hole.pin, plan, 0),
      notes: [plan.distanceFeet > 25 ? 'Poured in from long range!' : 'Holed.'],
    };
  }

  const alongFeet = pace < 0 ? pace : pace * 0.92;
  const lateralFeet = latMiss * (pace < 0 ? 0.65 : 1);
  const final = add(add(hole.pin, scale(plan.line, alongFeet / FT)), scale(plan.right, lateralFeet / FT));
  const leaveFeet = Math.max(0.3, Math.hypot(alongFeet, lateralFeet));

  if (pace < -1.2) notes.push('Left it short.');
  else if (pace > 4) notes.push('Ran it well past.');
  else if (Math.abs(latMiss) < TUNING.holeCapture * 1.8) notes.push('Just slid by the edge.');

  return { holed: false, final, leaveFeet, paceFeet: pace, path: puttPath(ctx.ball, final, plan, latMiss), notes };
}

/** A curved path for the animation: the ball bends with the slope as it slows. */
function puttPath(from: Vec2, to: Vec2, plan: PuttPlan, latMiss: number): Vec2[] {
  const points: Vec2[] = [];
  const steps = 22;
  const bend = (plan.breakFeet - latMiss * 0.2) / FT;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const base = add(from, scale(sub(to, from), t));
    // Break accumulates late, as the ball loses speed.
    const curve = bend * Math.pow(t, 1.8) - bend * t;
    points.push(add(base, scale(plan.right, curve)));
  }
  return points;
}
