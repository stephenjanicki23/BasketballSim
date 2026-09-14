/**
 * Putting, as a decision rather than an aiming exercise.
 *
 * The player never picks a line. When the ball is on the green the engine reads
 * it — distance, speed, the grade along the putt, the grade across it, the break
 * that follows from those — and offers a strategy: lag it, or go for it. The
 * choice is the whole game, and everything after it is simulation.
 *
 * How the numbers work, because this is the part that is easy to fake and worth
 * not faking:
 *
 *   1. `PUTTING.makeCurve` is the make probability for a reference tour putter
 *      on an average green with a modest break. It is a table, and it is the one
 *      thing to change if putting feels wrong.
 *   2. The engine inverts that curve *once*, at load, into the start-line error
 *      that would produce it. That is the dispersion the reference putter has.
 *   3. A real putt scales that dispersion by the golfer's ratings, the green's
 *      speed and slope, the break they have to read, the pressure they are
 *      under, and the strategy they chose.
 *   4. The make probability then falls back out of the dispersion.
 *
 * So the strategies are not a make-percentage multiplier. Going for it holds the
 * ball two feet past the hole instead of nine inches, which genuinely holes more
 * putts — a ball dying at the hole cannot fall in as often — and genuinely leaves
 * a longer second one when it misses. Everything the panel shows the player is
 * the same arithmetic the ball then obeys.
 */

import { type Vec2, add, dist, norm, perp, scale, sub } from './geometry';
import { type Rng, clamp, lerp, normalCdf } from './rng';
import { PUTTING, PUTT_INTENTS, type PuttIntentId } from './config';
import { NEUTRAL_TOUCH, PUTTING_STYLES, effective, effectiveFatigue } from './golferEngine';
import { greenSlopeAt } from './courseEngine';
import type { Golfer, LieType } from './types';
import type { ShotContext } from './shotEngine';

const FT = 3; // feet per yard

// ---------------------------------------------------------------------------
// The reference curve, inverted once
// ---------------------------------------------------------------------------

/** Inverse normal CDF by bisection. Called only at module load. */
function probit(p: number): number {
  let lo = -12;
  let hi = 12;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function interpolate(table: readonly [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/** Speed-control error for the reference putter, before any modifier. */
function referenceSpeedSigma(distanceFeet: number): number {
  return PUTTING.speedSigmaBase + PUTTING.speedSigmaPerFoot * distanceFeet;
}

/** How far past the hole a stroke is aimed to finish. */
function holdFor(intent: PuttIntentId, distanceFeet: number): number {
  const profile = PUTT_INTENTS[intent];
  return profile.holdBase + profile.holdPerFoot * distanceFeet;
}

/**
 * Effective width of the hole for a ball arriving with this much pace to spare.
 * Zero if it never got there, widest around `paceOptimum`, narrowing as the ball
 * gets quick enough to run over the edge.
 */
function captureWidth(paceFeet: number): number {
  if (paceFeet <= 0) return 0;
  if (paceFeet >= PUTTING.paceCeiling) return 0;
  if (paceFeet < PUTTING.paceOptimum) {
    return PUTTING.holeCapture * Math.pow(paceFeet / PUTTING.paceOptimum, PUTTING.paceRiseExponent);
  }
  const past = (paceFeet - PUTTING.paceOptimum) / (PUTTING.paceCeiling - PUTTING.paceOptimum);
  return PUTTING.holeCapture * (1 - PUTTING.paceCaptureLoss * past);
}

/** The chance a putt on a good line and a good pace is not knocked off it. */
function deflectionChance(distanceFeet: number): number {
  return Math.exp(-Math.max(0, distanceFeet - PUTTING.deflectionOnset) / PUTTING.deflectionLength);
}

/**
 * Equal-probability strata of a standard normal, each represented by its
 * conditional mean.
 *
 * The pace integration needs a lot of these. Capture width is zero below the
 * hole and zero above the ceiling, so a coarse grid throws away whole bins that
 * really do contain putts that drop — and the number on the panel then disagrees
 * with what the ball does, which is the one thing this engine must not do.
 */
function strata(n: number): number[] {
  const pdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const nodes: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? -Infinity : probit(i / n);
    const b = i === n - 1 ? Infinity : probit((i + 1) / n);
    nodes.push(((Number.isFinite(a) ? pdf(a) : 0) - (Number.isFinite(b) ? pdf(b) : 0)) * n);
  }
  return nodes;
}

const PACE_NODES = strata(25);

/**
 * Probability the putt drops: integrated over pace, because the width of the
 * hole depends on how fast the ball is going when it gets there. Doing it this
 * way rather than averaging the capture first is what makes the number the panel
 * shows agree with what the ball then does.
 */
function holeChance(hold: number, speedSigma: number, lineSigma: number, lineBias: number, distanceFeet: number): number {
  let total = 0;
  for (const z of PACE_NODES) {
    const pace = hold + z * speedSigma;
    const capture = captureWidth(pace);
    if (capture <= 0) continue;
    total +=
      (normalCdf((capture - lineBias) / lineSigma) - normalCdf((-capture - lineBias) / lineSigma)) /
      PACE_NODES.length;
  }
  return total * deflectionChance(distanceFeet);
}

/**
 * The start-line error the reference putter must have for the make curve to
 * come out. Precomputed per half-foot, because inverting a normal CDF inside a
 * season simulation would be silly.
 */
const REFERENCE_STEP = 0.5;
const REFERENCE_MAX = 130;
const REFERENCE_LINE_SIGMA: Float64Array = (() => {
  const values = new Float64Array(Math.ceil(REFERENCE_MAX / REFERENCE_STEP) + 1);
  for (let i = 0; i < values.length; i++) {
    const distance = Math.max(0.5, i * REFERENCE_STEP);
    const target = interpolate(PUTTING.makeCurve, distance);
    // The curve describes a normal, competent stroke: halfway between lagging
    // it and going at it.
    const hold = (holdFor('lag', distance) + holdFor('attack', distance)) / 2;
    const speedSigma = referenceSpeedSigma(distance);
    // Bisect for the start-line error that produces the curve's make rate.
    let lo = 0.01;
    let hi = 40;
    for (let step = 0; step < 60; step++) {
      const mid = (lo + hi) / 2;
      if (holeChance(hold, speedSigma, mid, 0, distance) > target) lo = mid;
      else hi = mid;
    }
    values[i] = (lo + hi) / 2;
  }
  return values;
})();

function referenceLineSigma(distanceFeet: number): number {
  const index = clamp(Math.round(distanceFeet / REFERENCE_STEP), 0, REFERENCE_LINE_SIGMA.length - 1);
  return REFERENCE_LINE_SIGMA[index];
}

/** Start-line dispersion scales with rating on its own curve, gentler than full-swing skill. */
export function puttSigmaFactor(rating: number): number {
  const delta = rating - PUTTING.referenceRating;
  return delta >= 0
    ? Math.exp(-delta * PUTTING.sigmaDecayAbove)
    : saturate(-delta, PUTTING.sigmaGrowthBelow, PUTTING.sigmaCeiling);
}

/** Speed control scales much harder: it is where putting skill actually shows. */
export function puttSpeedFactor(rating: number): number {
  const delta = rating - PUTTING.referenceRating;
  return delta >= 0
    ? Math.exp(-delta * PUTTING.speedDecayAbove)
    : saturate(-delta, PUTTING.speedGrowthBelow, PUTTING.speedCeiling);
}

/**
 * Grows at `rate` per rating point below the reference to begin with, then
 * flattens out towards `ceiling` instead of running away. The bad putter on tour
 * is measurably worse than the good one and never a different species.
 */
function saturate(shortfall: number, rate: number, ceiling: number): number {
  const room = ceiling - 1;
  return 1 + room * (1 - Math.exp((-shortfall * rate) / room));
}

// ---------------------------------------------------------------------------
// Reading the green
// ---------------------------------------------------------------------------

export interface GreenRead {
  distanceFeet: number;
  /** What it plays as once the hill is taken into account. */
  playsLikeFeet: number;
  greenSpeed: number;
  /** Grade along the putt in percent; positive is downhill. */
  grade: number;
  /** Grade across the putt in percent; positive falls to the right. */
  sideGrade: number;
  /** Rise from ball to hole, in feet; negative is downhill. */
  riseFeet: number;
  /** How far the ball will curve, in feet; positive breaks right. */
  breakFeet: number;
  /** Unit vector from ball to hole, and the one 90° right of it. */
  line: Vec2;
  right: Vec2;
  /** 1–5. */
  difficulty: number;
  speedLabel: string;
  slopeLabel: string;
  breakLabel: string;
  gradeLabel: string;
  /** What the putt is worth, if the caller knows: 'birdie', 'par', … */
  summary: string;
}

function speedLabel(stimp: number): string {
  if (stimp >= 13) return 'Very fast';
  if (stimp >= 11.8) return 'Fast';
  if (stimp >= 10.2) return 'Medium';
  return 'Slow';
}

/** How much a putt turns, described by how far it actually moves. */
function describeBreak(breakFeet: number): string {
  const magnitude = Math.abs(breakFeet);
  const side = breakFeet > 0 ? 'left to right' : 'right to left';
  if (magnitude < 0.2) return 'Dead straight';
  if (magnitude < 0.75) return `Slight break ${side}`;
  if (magnitude < 1.8) return `Moderate break ${side}`;
  if (magnitude < 3.2) return `Big break ${side}`;
  return `Severe break ${side}`;
}

function slopeLabel(magnitude: number): string {
  if (magnitude >= 2.6) return 'Severe';
  if (magnitude >= 1.6) return 'Moderate';
  if (magnitude >= 0.7) return 'Slight';
  return 'Flat';
}

export function breakFor(distanceFeet: number, sideGrade: number, greenSpeed: number, grade = 0): number {
  const downhill = 1 + Math.max(0, grade) * PUTTING.breakPerDownhillPercent;
  return (
    PUTTING.breakCoefficient *
    sideGrade *
    Math.pow(Math.max(distanceFeet, 0.5), PUTTING.breakExponent) *
    (greenSpeed / 11) *
    downhill
  );
}

export function readGreen(ctx: ShotContext): GreenRead {
  const { hole, ball, conditions } = ctx;
  const toHole = sub(hole.pin, ball);
  const distanceYards = Math.max(0.06, dist(ball, hole.pin));
  const distanceFeet = distanceYards * FT;
  const line = norm(toHole.x === 0 && toHole.y === 0 ? { x: 0, y: 1 } : toHole);
  const right = perp(line);

  const slope = greenSlopeAt(hole, add(ball, scale(line, distanceYards / 2)));
  const grade = slope.x * line.x + slope.y * line.y;
  const sideGrade = slope.x * right.x + slope.y * right.y;
  const riseFeet = (-grade / 100) * distanceFeet;
  const greenSpeed = conditions.weather.greenSpeed;
  const breakFeet = breakFor(distanceFeet, sideGrade, greenSpeed, grade);
  const playsLikeFeet = Math.max(0.5, distanceFeet + riseFeet * PUTTING.uphillPlaysLike);

  // Difficulty, 1 to 5: length, then break, then pace, then the hill.
  const raw =
    Math.min(2.4, distanceFeet / 12) +
    Math.min(1.3, Math.abs(breakFeet) / 2.2) +
    Math.min(0.8, Math.max(0, greenSpeed - 10.8) / 2.2) +
    Math.min(0.9, Math.max(0, grade) / 2.6);
  const difficulty = clamp(Math.round(raw), 1, 5);

  return {
    distanceFeet,
    playsLikeFeet,
    greenSpeed,
    grade,
    sideGrade,
    riseFeet,
    breakFeet,
    line,
    right,
    difficulty,
    speedLabel: speedLabel(greenSpeed),
    slopeLabel: slopeLabel(Math.hypot(slope.x, slope.y)),
    breakLabel: describeBreak(breakFeet),
    gradeLabel:
      Math.abs(riseFeet) < 0.25
        ? 'Level'
        : `${slopeLabel(Math.abs(grade))} ${grade > 0 ? 'downhill' : 'uphill'}`,
    summary: '',
  };
}

// ---------------------------------------------------------------------------
// A golfer's dispersion on a particular putt
// ---------------------------------------------------------------------------

interface Dispersion {
  /** 1σ of start-line error at the hole, in feet. */
  lineSigma: number;
  /** 1σ of how far past the hole the ball finishes, in feet. */
  speedSigma: number;
  /** Systematic sideways offset, in feet: the break the golfer fails to allow for. */
  lineBias: number;
  /** How far past the hole this stroke is aimed. */
  hold: number;
}

/** Blended putting skill for the line, which leans on length and on reading. */
function lineSkill(golfer: Golfer, distanceFeet: number): number {
  const longShare = clamp((distanceFeet - 6) / 26, 0, 1);
  const length = lerp(effective(golfer, 'shortPutting'), effective(golfer, 'longPutting'), longShare);
  return effective(golfer, 'putting') * 0.45 + length * 0.35 + effective(golfer, 'greenReading') * 0.20;
}

/** Blended skill for pace, which is speed control and — when lagging — lag putting. */
function speedSkill(golfer: Golfer, distanceFeet: number, intent: PuttIntentId): number {
  const longShare = clamp((distanceFeet - 6) / 26, 0, 1);
  const length = lerp(effective(golfer, 'shortPutting'), effective(golfer, 'longPutting'), longShare);
  const base = effective(golfer, 'speedControl') * 0.55 + effective(golfer, 'putting') * 0.25 + length * 0.20;
  const lag = effective(golfer, 'lagPutting');
  const share = PUTT_INTENTS[intent].lagShare;
  return base * (1 - share) + lag * share;
}

/** Pressure exposure: nerve decides whether it is fuel or poison. */
function pressureFactor(golfer: Golfer, pressure: number): number {
  if (pressure <= 0) return 1;
  const nerve =
    effective(golfer, 'puttingPressure') * 0.6 +
    effective(golfer, 'composure') * 0.28 +
    effective(golfer, 'clutch') * 0.12;
  const exposure = clamp(1 - (nerve - 50) / 55, 0.05, 1.9);
  return 1 + pressure * exposure * PUTTING.pressureSigma;
}

function dispersionFor(ctx: ShotContext, read: GreenRead, intent: PuttIntentId): Dispersion {
  const { golfer, conditions } = ctx;
  const profile = PUTT_INTENTS[intent];
  const style = PUTTING_STYLES[golfer.puttingStyle];
  const touch = (ctx.touch ?? NEUTRAL_TOUCH).putting;
  const streak = 1 + (touch - 1) * style.streak;
  const nerves = pressureFactor(golfer, ctx.pressure);
  const fatigue = 1 + effectiveFatigue(golfer) / 100 * 0.09;
  const wet = 1 + conditions.weather.rain * 0.09;
  const fromFringe = (ctx.lie as LieType) === 'fringe' ? 1.3 : 1;

  // --- Line -------------------------------------------------------------
  const stroke =
    referenceLineSigma(read.distanceFeet) *
    puttSigmaFactor(lineSkill(golfer, read.distanceFeet)) *
    profile.lineSigma *
    streak * nerves * fatigue * wet * fromFringe;

  // Break the golfer has to read. Only the part beyond what the reference curve
  // already allows for costs anything, and green reading is what pays it.
  const reference = Math.abs(breakFor(read.distanceFeet, PUTTING.referenceSideSlope, 11));
  const excess = Math.max(0, Math.abs(read.breakFeet) - reference);
  const reading = clamp(1.35 - effective(golfer, 'greenReading') / 100, 0.3, 1.3);
  const readError = excess * PUTTING.readSensitivity * reading * profile.breakExposure;
  const lineSigma = Math.hypot(stroke, readError);

  // Under-reading is systematic, so a breaking putt misses low more often than
  // high. This is the asymmetry: the miss has a direction, not just a spread.
  const lineBias = Math.sign(read.breakFeet) * excess * PUTTING.underReadShare * reading * profile.breakExposure;

  // --- Pace -------------------------------------------------------------
  const downhill = Math.max(0, read.grade) * PUTTING.speedSigmaPerDownhill;
  const uphill = Math.max(0, -read.grade) * PUTTING.speedSigmaPerUphill;
  const fast = Math.max(0, read.greenSpeed - 11) * PUTTING.speedSigmaPerStimp;
  const speedSigma =
    referenceSpeedSigma(read.playsLikeFeet) *
    puttSpeedFactor(speedSkill(golfer, read.distanceFeet, intent)) *
    profile.speedSigma *
    (1 + downhill + uphill + fast) *
    streak * nerves * fatigue * wet * fromFringe *
    // A downhill putt needs less energy, so the same error runs it further past.
    clamp(read.distanceFeet / Math.max(read.playsLikeFeet, 0.5), 0.75, 1.55);

  return { lineSigma, speedSigma, lineBias, hold: holdFor(intent, read.distanceFeet) };
}

// ---------------------------------------------------------------------------
// What an option is worth
// ---------------------------------------------------------------------------

export interface PuttOption {
  intent: PuttIntentId;
  name: string;
  blurb: string;
  make: number;
  threePutt: number;
  /** Expected distance from the hole if it misses, in feet. */
  expectedLeaveFeet: number;
  within3: number;
  within5: number;
  within10: number;
  /** Expected number of putts to hole out from here. */
  expectedPutts: number;
}

/** Where a ball with this much pace and this much line error finishes, in feet. */
function leaveDistance(pace: number, lateral: number): number {
  const along = pace < 0 ? pace : pace * 0.92;
  const across = lateral * (pace < 0 ? 0.62 : 1);
  return Math.max(0.25, Math.hypot(along, across));
}

const LEAVE_NODES = strata(9);

/**
 * Make, three-putt and leave, computed rather than sampled: two normal
 * integrals for the hole-out, and a grid over the two error axes for the leave,
 * which is smooth enough to take one.
 */
function evaluate(ctx: ShotContext, read: GreenRead, intent: PuttIntentId): PuttOption {
  const profile = PUTT_INTENTS[intent];
  const d = dispersionFor(ctx, read, intent);
  const make = clamp(
    holeChance(d.hold, d.speedSigma, d.lineSigma, d.lineBias, read.distanceFeet),
    0.0003,
    0.999,
  );

  let leaveTotal = 0;
  let leaveWeight = 0;
  let within3 = 0;
  let within5 = 0;
  let within10 = 0;
  let secondMissed = 0;
  const secondSkill = lineSkill(ctx.golfer, 4) * 0.6 + speedSkill(ctx.golfer, 4, 'attack') * 0.4;

  for (const zi of LEAVE_NODES) {
    const pace = d.hold + zi * d.speedSigma;
    for (const zj of LEAVE_NODES) {
      const lateral = d.lineBias + zj * d.lineSigma;
      const weight = 1 / (LEAVE_NODES.length * LEAVE_NODES.length);
      if (Math.abs(lateral) <= captureWidth(pace)) continue;
      const leave = leaveDistance(pace, lateral);
      leaveTotal += leave * weight;
      leaveWeight += weight;
      if (leave <= 3) within3 += weight;
      if (leave <= 5) within5 += weight;
      if (leave <= 10) within10 += weight;
      secondMissed += weight * (1 - simpleMake(leave, secondSkill));
    }
  }

  const missShare = Math.max(leaveWeight, 1e-6);
  const expectedLeaveFeet = leaveTotal / missShare;
  // Scale the grid's outcomes onto the true miss probability.
  const missed = 1 - make;
  const scale_ = missed / missShare;
  const threePutt = clamp(secondMissed * scale_, 0, 1);
  const expectedPutts = 1 + missed + threePutt * 1.08;

  return {
    intent,
    name: profile.name,
    blurb: profile.blurb,
    make,
    threePutt,
    expectedLeaveFeet,
    within3: make + within3 * scale_,
    within5: make + within5 * scale_,
    within10: make + within10 * scale_,
    expectedPutts,
  };
}

/**
 * A straight putt's make probability, memoised.
 *
 * The leave grid asks for this once per cell per option per putt, and each call
 * integrates over twenty-five pace strata — which, across a season, is tens of
 * millions of normal CDFs for a handful of distinct answers. Rounding the key to
 * a quarter of a foot and a rating point costs nothing anyone can see.
 */
const simpleMakeCache = new Map<number, number>();

function simpleMake(distanceFeet: number, skill: number): number {
  const key = Math.round(distanceFeet * 4) * 128 + Math.round(clamp(skill, 1, 100));
  const cached = simpleMakeCache.get(key);
  if (cached !== undefined) return cached;
  const value = simpleMakeUncached(Math.round(distanceFeet * 4) / 4, Math.round(clamp(skill, 1, 100)));
  simpleMakeCache.set(key, value);
  return value;
}

function simpleMakeUncached(distanceFeet: number, skill: number): number {
  const hold = holdFor('attack', distanceFeet);
  const speedSigma = referenceSpeedSigma(distanceFeet) * puttSpeedFactor(skill) * PUTT_INTENTS.attack.speedSigma;
  const lineSigma = referenceLineSigma(distanceFeet) * puttSigmaFactor(skill) * PUTT_INTENTS.attack.lineSigma;
  return clamp(holeChance(hold, speedSigma, lineSigma, 0, distanceFeet), 0.0003, 0.999);
}

/**
 * Standalone make probability for a golfer of a given putting skill, on a
 * normal green. Used by the strokes-gained baseline and by anything that wants
 * a number without building a whole context.
 */
export function makeProbability(distanceFeet: number, skill: number): number {
  return simpleMake(distanceFeet, skill);
}

// ---------------------------------------------------------------------------
// The decision the player is offered
// ---------------------------------------------------------------------------

export interface PuttDecision {
  read: GreenRead;
  /** The headline number: what a normal, committed stroke holes. */
  estimatedMake: number;
  options: PuttOption[];
  /** What holing this putt would be worth, e.g. "for birdie". */
  forScore: string;
}

/**
 * Which strategies to offer. Two, normally — the safe lag only appears on the
 * putts where it is a real alternative rather than clutter.
 */
export function availableIntents(read: GreenRead, pressure: number): PuttIntentId[] {
  const brutal =
    read.distanceFeet >= 38 ||
    Math.abs(read.sideGrade) >= 2.4 ||
    (read.grade >= 1.8 && read.distanceFeet >= 18) ||
    (read.greenSpeed >= 12.6 && read.distanceFeet >= 25) ||
    (pressure >= 0.55 && read.distanceFeet >= 22);
  return brutal ? ['safe', 'lag', 'attack'] : ['lag', 'attack'];
}

export function puttDecision(ctx: ShotContext, strokesTaken = 0, par = 4): PuttDecision {
  const read = readGreen(ctx);
  const options = availableIntents(read, ctx.pressure).map((intent) => evaluate(ctx, read, intent));
  // The headline is a normal committed stroke — between lagging and attacking.
  const lag = options.find((o) => o.intent === 'lag');
  const attack = options.find((o) => o.intent === 'attack');
  const estimatedMake = lag && attack ? (lag.make + attack.make) / 2 : (options[0]?.make ?? 0);
  return { read, estimatedMake, options, forScore: scoreLabel(strokesTaken + 1, par) };
}

function scoreLabel(strokesAfter: number, par: number): string {
  const delta = strokesAfter - par;
  if (delta <= -3) return 'for albatross';
  if (delta === -2) return 'for eagle';
  if (delta === -1) return 'for birdie';
  if (delta === 0) return 'for par';
  if (delta === 1) return 'for bogey';
  return `for ${delta > 0 ? '+' + delta : delta}`;
}

// ---------------------------------------------------------------------------
// Rolling the ball
// ---------------------------------------------------------------------------

export interface PuttResult {
  intent: PuttIntentId;
  holed: boolean;
  final: Vec2;
  /** How far from the hole the ball finished, in feet. */
  leaveFeet: number;
  /** How far past (negative: short of) the hole it ran. */
  paceFeet: number;
  /** Sideways miss at the hole, in feet; positive is right. */
  lineFeet: number;
  path: Vec2[];
  /** One line of commentary. */
  note: string;
}

export function resolvePutt(ctx: ShotContext, intent: PuttIntentId, rng: Rng, read?: GreenRead): PuttResult {
  const green = read ?? readGreen(ctx);
  const d = dispersionFor(ctx, green, intent);

  const pace = d.hold + rng.normal() * d.speedSigma;
  const lateral = d.lineBias + rng.normal() * d.lineSigma;
  const onLine = Math.abs(lateral) <= captureWidth(pace);
  // Even a putt that deserved to drop can be knocked off at the last roll.
  const deflected = onLine && !rng.chance(deflectionChance(green.distanceFeet));
  const holed = onLine && !deflected;

  if (deflected) {
    const side = rng.chance(0.5) ? 1 : -1;
    const leaveFeet = Math.max(0.4, Math.min(2.6, 0.4 + Math.max(0, pace) * 0.55));
    const final = add(
      add(ctx.hole.pin, scale(green.line, (leaveFeet * 0.7) / FT)),
      scale(green.right, (side * leaveFeet * 0.6) / FT),
    );
    return {
      intent, holed: false, final, leaveFeet, paceFeet: pace, lineFeet: side * leaveFeet * 0.6,
      path: puttPath(ctx.ball, final, green, lateral, pace, false),
      note: 'Caught the edge and stayed out.',
    };
  }

  if (holed) {
    return {
      intent,
      holed: true,
      final: ctx.hole.pin,
      leaveFeet: 0,
      paceFeet: pace,
      lineFeet: lateral,
      path: puttPath(ctx.ball, ctx.hole.pin, green, lateral, pace, true),
      note: green.distanceFeet > 30 ? 'Holed it from long range!' : green.distanceFeet > 12 ? 'In the middle!' : 'Holed.',
    };
  }

  const along = pace < 0 ? pace : pace * 0.92;
  const across = lateral * (pace < 0 ? 0.62 : 1);
  const final = add(
    add(ctx.hole.pin, scale(green.line, along / FT)),
    scale(green.right, across / FT),
  );
  const leaveFeet = Math.max(0.25, Math.hypot(along, across));

  return {
    intent,
    holed: false,
    final,
    leaveFeet,
    paceFeet: pace,
    lineFeet: lateral,
    path: puttPath(ctx.ball, final, green, lateral, pace, false),
    note: describeMiss(pace, across, leaveFeet, green),
  };
}

function describeMiss(pace: number, across: number, leaveFeet: number, read: GreenRead): string {
  if (pace < -1.5) return `Left it ${leaveFeet.toFixed(1)} feet short.`;
  if (pace > 3.5) return `Ran it ${leaveFeet.toFixed(1)} feet past.`;
  if (leaveFeet < 1.2) return 'Burned the edge — tap-in.';
  const side = across > 0 ? 'right' : 'left';
  const low = Math.sign(across) === Math.sign(read.breakFeet) && Math.abs(read.breakFeet) > 0.4;
  return low
    ? `Missed on the low side — ${leaveFeet.toFixed(1)} feet.`
    : `Missed ${side}, ${leaveFeet.toFixed(1)} feet away.`;
}

/**
 * The line the ball takes: straight at the start, bending with the slope as it
 * loses speed, then dying. The bend is real — it is the break the stroke was
 * aimed to allow for, plus whatever the golfer misread.
 */
function puttPath(from: Vec2, to: Vec2, read: GreenRead, lateral: number, pace: number, holed: boolean): Vec2[] {
  const points: Vec2[] = [];
  const steps = 26;
  // The ball starts on the line the golfer aimed at, which is the break played
  // back the other way, and curves into the hole from there.
  const bend = (read.breakFeet - lateral * 0.35) / FT;
  const overrun = holed ? 0 : Math.max(0, pace) * 0.05;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const base = add(from, scale(sub(to, from), t));
    const curve = bend * (Math.pow(t, 1.75) - t);
    points.push(add(base, scale(read.right, curve + overrun * 0)));
  }
  return points;
}

// ---------------------------------------------------------------------------
// The same decision, made by the simulated field
// ---------------------------------------------------------------------------

export interface PuttSituation {
  /** 1–4; 0 for a practice round. */
  round: number;
  /** Strokes behind the lead; negative means leading. */
  behind: number;
  /** Holes left to play in the tournament. */
  holesRemaining: number;
  /** What holing it is worth, relative to par. −1 is a birdie putt. */
  toPar: number;
}

const NEUTRAL_SITUATION: PuttSituation = { round: 1, behind: 3, holesRemaining: 40, toPar: 0 };

/**
 * How aggressive a golfer is feeling. Personality sets the baseline; the
 * leaderboard moves it. Four behind with six to play, everybody attacks; one
 * ahead, nobody does.
 */
export function puttAggression(golfer: Golfer, situation: PuttSituation = NEUTRAL_SITUATION): number {
  const style = PUTTING_STYLES[golfer.puttingStyle];
  let aggression = style.aggression;
  aggression += (effective(golfer, 'clutch') - 50) * 0.004;
  aggression -= (effective(golfer, 'courseManagement') - 50) * 0.003;

  const late = situation.round >= 3 && situation.holesRemaining <= 18;
  if (late) {
    if (situation.behind > 0.5) aggression += clamp(situation.behind * 0.09, 0, 0.42);
    else if (situation.behind < -0.5) aggression -= clamp(-situation.behind * 0.11, 0, 0.34);
  }
  // A putt to save par is worth more than a putt for a third birdie.
  if (situation.toPar >= 0) aggression += 0.10;
  return clamp(aggression, -0.6, 0.7);
}

/**
 * The strategy the golfer picks, in expected strokes, nudged by how aggressive
 * they are feeling. This is the function the human player is replacing when they
 * press a button, and it is the same one the other forty-nine use.
 */
export function choosePuttIntent(
  ctx: ShotContext,
  situation: PuttSituation = NEUTRAL_SITUATION,
  decision?: PuttDecision,
): { intent: PuttIntentId; decision: PuttDecision } {
  const plan = decision ?? puttDecision(ctx, 0, 4);
  const aggression = puttAggression(ctx.golfer, situation);
  let best = plan.options[0];
  let bestScore = Infinity;
  // Aggression pulls on two different ropes, which is why it cannot be a single
  // multiplier. Wanting to hole it is an upside premium: two putts from twenty
  // feet is a fine outcome on Thursday and a useless one when you are two behind
  // with three to play. Not wanting to three-putt is a downside penalty, and it
  // is what a player protecting a lead actually feels. Neither goes negative —
  // holing the putt is never worse than not holing it, so the most cautious
  // golfer alive still holes out from six feet instead of lagging it.
  const holeValue = Math.max(0, 0.6 + aggression * 2.6);
  const riskAversion = Math.max(0, -aggression) * 1.6;

  for (const option of plan.options) {
    const score = option.expectedPutts - option.make * holeValue + option.threePutt * riskAversion;
    if (score < bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return { intent: best.intent, decision: plan };
}
