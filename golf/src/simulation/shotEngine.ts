/**
 * The shot engine. Everything that puts a golf ball somewhere it did not used
 * to be goes through here — the player's shots and the whole field's alike.
 *
 * Two halves:
 *
 *   planShot()    deterministic. Given a golfer, a lie, a club, a shot type and
 *                 a target, work out where the ball is expected to finish and
 *                 how wide the distribution around that is. Nothing random
 *                 happens, which is why the dispersion overlay can show it.
 *
 *   resolveShot() one sample from that distribution, then physics: carry, wind
 *                 drift, bounce, roll, the lie it finishes in, penalties.
 *
 * The distribution is an ellipse, not a circle: a driver misses sideways far
 * more than it misses in distance, a lob wedge is the other way round.
 */

import {
  type Vec2,
  add,
  dist,
  len,
  norm,
  perp,
  scale,
  sub,
  vec,
  findCrossing,
} from './geometry';
import { type Rng, clamp, heavyNormal, lerp, normalCdf } from './rng';
import {
  CLUB_BY_ID,
  LANDING_ROLL,
  LIES,
  SHOT_TYPES,
  SMASH,
  SWING_CLUBS,
  TUNING,
  type ShotTypeId,
} from './config';
import {
  type DailyTouch,
  NEUTRAL_TOUCH,
  bagFor,
  effective,
  effectiveFatigue,
  fatigueEffect,
  pressureEffect,
  sigmaFactor,
  tailProbability,
  weatherEffect,
} from './golferEngine';
import { approximateLieAt, greenSlopeAt, terrainAt, dropPoint } from './courseEngine';
import { gustedWind, windComponents } from './weatherEngine';
import { abilityScaleFor, strokesToHoleOut } from './strokesBaseline';
import type {
  ClubDefinition,
  LieProfile,
  ClubId,
  Conditions,
  Golfer,
  HoleGeometry,
  LieType,
  RatingKey,
} from './types';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface ShotContext {
  hole: HoleGeometry;
  golfer: Golfer;
  ball: Vec2;
  lie: LieType;
  /** True for the opening shot of a hole. */
  onTee: boolean;
  conditions: Conditions;
  /** Increments every shot, so the gust is different each time. */
  shotIndex: number;
  /** 0 on a Thursday morning, 1 over a putt to win. */
  pressure: number;
  /** Deep bunkers cannot be advanced far. */
  deepBunker?: boolean;
  /** What the golfer has with them today. Defaults to neutral. */
  touch?: DailyTouch;
}

export interface ShotRequest {
  club: ClubId;
  shotType: ShotTypeId;
  target: Vec2;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface OutcomeOdds {
  fairway: number;
  green: number;
  rough: number;
  sand: number;
  water: number;
  trees: number;
  ob: number;
  /** Expected strokes to hole out from wherever this shot finishes. */
  expectedStrokes: number;
  /** Expected distance from the pin in yards. */
  proximity: number;
  /** Chance of finishing inside 10 feet. */
  inside10ft: number;
}

export interface ShotPlan {
  request: ShotRequest;
  club: ClubDefinition;
  shotType: ShotTypeId;
  /** Unit vector from the ball toward the target. */
  aim: Vec2;
  /** Unit vector 90° right of the aim. */
  right: Vec2;
  /** Compass bearing the shot is played on. */
  bearing: number;
  distanceToTarget: number;
  /** Distance the shot should be played as, after wind and elevation. */
  playsLike: number;
  elevationDelta: number;
  expectedCarry: number;
  expectedRoll: number;
  expectedTotal: number;
  /** Where the ball is expected to finish, including wind drift and shape. */
  center: Vec2;
  /** 1σ in yards along the line of play. */
  sigmaLong: number;
  /** 1σ in yards across the line of play. */
  sigmaLat: number;
  /** Extra sideways spread from a lie that offers no control, in yards. */
  biasSpread: number;
  /** Fraction of a full swing; below 1 is a controlled shot. */
  swingScale: number;
  wind: { head: number; cross: number; speed: number; drift: number; carryDelta: number; label: string };
  apex: number;
  spin: number;
  descent: number;
  /** Strike quality this golfer can expect with this club. */
  smash: { ceiling: number; expected: number; sigma: number };
  shortGame: boolean;
  /** Notes for the UI: "cannot reach", "flyer likely", "club not playable from sand". */
  warnings: string[];
  odds: OutcomeOdds;
}

export interface ShotResult {
  /** How well it was struck: ball speed over club speed. */
  smash: number;
  /** Carry as a fraction of what a middled strike would have produced. */
  strikeShare: number;
  start: Vec2;
  landing: Vec2;
  final: Vec2;
  carry: number;
  roll: number;
  total: number;
  /** Signed sideways miss from the aim line, in yards. */
  deviation: number;
  apex: number;
  spin: number;
  landingLie: LieType;
  finalLie: LieType;
  penalty: number;
  penaltyKind: 'none' | 'water' | 'ob';
  holed: boolean;
  mishit: boolean;
  quality: string;
  /** Flight samples for the animation: position plus height in feet. */
  path: { x: number; y: number; h: number }[];
  /** Where the ball rolled, after it landed. */
  rollPath: Vec2[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHORT_GAME_TYPES: ShotTypeId[] = ['chip', 'pitch', 'flop', 'explosion'];

export function isShortGame(shotType: ShotTypeId): boolean {
  return SHORT_GAME_TYPES.includes(shotType);
}

/**
 * How well this golfer strikes this club: the ceiling they are aiming at, the
 * average they achieve, and how far a bad one falls off it.
 */
export function smashProfile(golfer: Golfer, club: ClubDefinition, lie: LieProfile, shotType: ShotTypeId): {
  ceiling: number;
  expected: number;
  sigma: number;
} {
  const tail = tailProbability(golfer);
  const ceiling = SMASH.ceiling[club.family];
  // Centring the clubface is its own skill: mostly ball-striking with the club
  // in hand, steadied by consistency and hurt by a lie you cannot control.
  const strike =
    effective(golfer, club.accuracySkill) * 0.42 +
    effective(golfer, 'consistency') * 0.28 +
    effective(golfer, 'ballSpeed') * 0.18 +
    effective(golfer, 'approachConsistency') * 0.12;
  const delta = strike - 72;
  const skill = delta >= 0 ? Math.exp(-delta * SMASH.skillDecayAbove) : Math.exp(-delta * SMASH.skillGrowthBelow);
  const sigma =
    SMASH.lossSigma[club.family] * skill * lie.distanceControl * SHOT_TYPES[shotType].longitudinal;
  // A half-normal's mean is σ√(2/π). The draw has fat tails, which widens it, and
  // getting this constant wrong would quietly make every golfer hit it shorter
  // than their own yardages say.
  const spread = Math.sqrt(1 + tail * (TUNING.tailScale * TUNING.tailScale - 1));
  return { ceiling, expected: ceiling - sigma * 0.7979 * spread, sigma };
}

/** Carry as a share of the golfer's own average, for a given strike. */
function strikeShare(smash: number, profile: { expected: number }): number {
  return Math.pow(Math.max(0.55, smash) / profile.expected, SMASH.carryExponent);
}

/**
 * Yards of carry a strike this far below the middle of the face gives away — the
 * number the shot panel shows, so the player knows what a bad one costs before
 * they hit it rather than afterwards.
 */
export function strikeCost(plan: ShotPlan, sigmas = 2.2): number {
  return plan.expectedCarry * (1 - strikeShare(plan.smash.ceiling - sigmas * plan.smash.sigma, plan.smash));
}

/** Minimum fraction of a full swing that is realistic with each club. */
function minSwingScale(club: ClubDefinition): number {
  switch (club.family) {
    case 'driver':
      return 0.90;
    case 'wood':
      return 0.82;
    case 'longIron':
      return 0.70;
    case 'midIron':
      return 0.64;
    case 'shortIron':
      return 0.56;
    default:
      return 0.42;
  }
}

/** Which rating governs distance control for a club. */
function distanceSkillKey(club: ClubDefinition): RatingKey {
  return club.family === 'driver' || club.family === 'wood' ? 'ballSpeed' : 'approachConsistency';
}

/** The rating a short-game shot leans on. */
function shortGameSkill(golfer: Golfer, shotType: ShotTypeId, lie: LieType): number {
  const profile = SHOT_TYPES[shotType];
  if (lie === 'greensideBunker' || lie === 'fairwayBunker') return effective(golfer, 'bunkerPlay');
  if (lie === 'recovery' || lie === 'pineStraw') return (effective(golfer, 'recovery') + effective(golfer, 'chipping')) / 2;
  if (profile.skill === 'chipping') return effective(golfer, 'chipping');
  if (profile.skill === 'pitching') return effective(golfer, 'pitching');
  if (profile.skill === 'bunkerPlay') return effective(golfer, 'bunkerPlay');
  if (profile.skill === 'recovery') return effective(golfer, 'recovery');
  return effective(golfer, 'wedgeAccuracy');
}

/** Carry-to-roll split intended on a short-game shot. */
function carryShare(shotType: ShotTypeId, club: ClubDefinition, greenFirmness: number): number {
  const base = shotType === 'chip' ? 0.42 : shotType === 'pitch' ? 0.78 : shotType === 'flop' ? 0.93 : 0.86;
  const loft = (club.descent - 52) * 0.012;
  const firm = (70 - greenFirmness) * 0.0012;
  return clamp(base + loft + firm, 0.25, 0.96);
}

/** Local downhill direction and gradient in feet per yard. */
function slopeAt(hole: HoleGeometry, p: Vec2): { downhill: Vec2; gradient: number } {
  const d = 3;
  const gx = (hole.elevationAt(vec(p.x + d, p.y)) - hole.elevationAt(vec(p.x - d, p.y))) / (2 * d);
  const gy = (hole.elevationAt(vec(p.x, p.y + d)) - hole.elevationAt(vec(p.x, p.y - d))) / (2 * d);
  const gradient = Math.hypot(gx, gy);
  return { downhill: gradient < 1e-6 ? vec(0, 0) : scale(vec(-gx, -gy), 1 / gradient), gradient };
}

/** Compass bearing a shot is played on, from the hole's bearing and the aim. */
export function shotBearing(hole: HoleGeometry, aim: Vec2): number {
  const offset = (Math.atan2(aim.x, aim.y) * 180) / Math.PI;
  return (hole.spec.bearing + offset + 360) % 360;
}

/** Clubs that can actually be used from the current lie. */
export function legalClubs(ctx: ShotContext): ClubDefinition[] {
  const profile = LIES[ctx.lie];
  const limit = ctx.deepBunker && ctx.lie === 'greensideBunker' ? 0.32 : profile.maxCarryRatio;
  return SWING_CLUBS.filter((club) => club.carryRatio <= limit + 1e-6);
}

/** Shot types that make sense right now. */
export function availableShotTypes(ctx: ShotContext, distanceToTarget: number): ShotTypeId[] {
  if (ctx.lie === 'green') return ['putt'];
  if (ctx.lie === 'greensideBunker') return ['explosion'];
  const types: ShotTypeId[] = [];
  if (distanceToTarget <= 45) types.push('chip');
  if (distanceToTarget <= 75) types.push('pitch');
  if (distanceToTarget <= 32) types.push('flop');
  types.push('full', 'punch', 'high', 'draw', 'fade');
  if (ctx.lie === 'fringe' && distanceToTarget <= 30) types.unshift('putt');
  return types;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export function planShot(
  ctx: ShotContext,
  request: ShotRequest,
  options?: { skipOdds?: boolean; fastOdds?: boolean },
): ShotPlan {
  const { hole, golfer, ball, conditions } = ctx;
  const club = CLUB_BY_ID[request.club];
  const profile = SHOT_TYPES[request.shotType];
  const lie = LIES[ctx.lie];
  const warnings: string[] = [];

  const toTarget = sub(request.target, ball);
  const distanceToTarget = Math.max(0.5, len(toTarget));
  const aim = norm(toTarget.x === 0 && toTarget.y === 0 ? vec(0, 1) : toTarget);
  const right = perp(aim);
  const bearing = shotBearing(hole, aim);

  // --- Conditions ----------------------------------------------------------
  const weather = conditions.weather;
  const windSpeed = gustedWind(conditions, ctx.shotIndex);
  const wind = windComponents(weather, bearing, windSpeed);
  const windSkill = 1 - (effective(golfer, 'wind') - 50) * 0.006;
  const weatherMods = weatherEffect(golfer, weather);
  const fatigueMods = fatigueEffect(golfer);
  const pressureKind = club.family === 'driver' ? 'drive' : isShortGame(request.shotType) ? 'short' : 'approach';
  const pressureMods = pressureEffect(golfer, ctx.pressure, pressureKind);

  const shortGame = isShortGame(request.shotType);
  const elevationDelta = hole.elevationAt(request.target) - hole.elevationAt(ball);
  const elevationYards =
    elevationDelta >= 0 ? elevationDelta * TUNING.yardsPerFootUp : elevationDelta * TUNING.yardsPerFootDown;

  const bag = bagFor(golfer);

  let expectedCarry: number;
  let expectedRoll: number;
  let sigmaLong: number;
  let sigmaLat: number;
  let swingScale = 1;
  let apex: number;
  let spin: number;

  const touch = ctx.touch ?? NEUTRAL_TOUCH;
  const touchFactor = shortGame
    ? touch.short
    : club.family === 'driver' || club.family === 'wood'
      ? touch.driving
      : touch.approach;
  const envSigma = weatherMods.sigma * fatigueMods.sigma * pressureMods.sigma * touchFactor;
  const windSigma = 1 + windSpeed * TUNING.windSigmaPerMph * windSkill * profile.windExposure;

  if (shortGame) {
    // --- Short game: the golfer plays to a distance, not to a club ---------
    const skill = shortGameSkill(golfer, request.shotType, ctx.lie);
    const share = carryShare(request.shotType, club, weather.greenFirmness);
    const intended = distanceToTarget + elevationYards * 0.5;
    expectedCarry = intended * share;
    expectedRoll = intended * (1 - share);
    const factor = sigmaFactor(skill);
    sigmaLong = (0.082 * intended + 1.05) * factor * lie.distanceControl * profile.longitudinal * envSigma;
    sigmaLat = (0.052 * intended + 0.75) * factor * lie.accuracy * profile.lateral * envSigma * (1 + (windSigma - 1) * 0.3);
    apex = Math.min(60, 5 + intended * 0.55) * profile.apex;
    spin = club.spin * profile.spin * lie.spin;
  } else {
    // --- Full swing -------------------------------------------------------
    const distanceMods = lie.distance * weatherMods.distance * fatigueMods.distance * pressureMods.distance * profile.distance;
    const fullCarry = bag[club.id].carry * distanceMods;
    const landingFirmness = weather.firmness;
    const fullRoll = bag[club.id].roll * profile.roll * landingFirmness * lie.rollAfter;

    // What one full swing would produce here, wind and hill included.
    const windCarryFull = windCarryDelta(wind, fullCarry, windSkill, profile.windExposure);
    const reach = fullCarry + windCarryFull - elevationYards + fullRoll;
    // You cannot swing harder than a full swing: a lie that costs 15% of your
    // distance costs you 15% of your distance, and you need more club.
    swingScale = clamp(distanceToTarget / Math.max(30, reach), minSwingScale(club), 1.0);

    expectedCarry = fullCarry * swingScale;
    const windCarry = windCarryDelta(wind, expectedCarry, windSkill, profile.windExposure);
    expectedCarry += windCarry - elevationYards;
    expectedRoll = fullRoll * swingScale;

    if (reach < distanceToTarget - 2) {
      warnings.push(`Cannot reach — ${Math.round(distanceToTarget - reach)} yards short of the target`);
    }
    if (swingScale <= minSwingScale(club) + 0.001 && distanceToTarget < reach - 8) {
      warnings.push('Too much club — it will fly the target');
    }

    const accuracyRating = effective(golfer, club.accuracySkill);
    const distanceRating = effective(golfer, distanceSkillKey(club));
    // A shorter swing is a smaller miss, but a very partial swing is its own skill.
    const scaleLat = 0.55 + 0.45 * swingScale;
    const scaleLong = 0.62 + 0.38 * swingScale + Math.max(0, 0.74 - swingScale) * 0.55;
    sigmaLat =
      club.baseLatSigma * sigmaFactor(accuracyRating) * lie.accuracy * profile.lateral * envSigma * windSigma * scaleLat;
    sigmaLong =
      club.baseLongSigma * sigmaFactor(distanceRating) * lie.distanceControl * profile.longitudinal * envSigma *
      (1 + (windSigma - 1) * 0.7) * scaleLong;

    apex = club.apex * profile.apex * (0.85 + effective(golfer, 'launch') / 100 * 0.3) * (1 - wind.head * 0.002);
    spin = club.spin * profile.spin * lie.spin;

    if (lie.id === 'lightRough' && club.family !== 'wedge' && spin < club.spin * 0.85) {
      warnings.push('Flyer lie — expect it to come out hot');
    }
  }

  if (club.carryRatio > lie.maxCarryRatio + 1e-6) {
    warnings.push(`${club.name} is not playable from ${lie.name.toLowerCase()}`);
    sigmaLat *= 1.6;
    sigmaLong *= 1.6;
    expectedCarry *= 0.72;
  }

  // --- Wind drift and intended shape --------------------------------------
  const driftFull = wind.cross * TUNING.crosswindPerMph * (Math.max(expectedCarry, 20) / 170) * profile.windExposure * windSkill;
  // A good wind player aims off for most of it without being told.
  const allowance = clamp(0.5 + (effective(golfer, 'wind') - 50) * 0.008 + (effective(golfer, 'courseManagement') - 50) * 0.002, 0.25, 0.95);
  const drift = driftFull * (1 - allowance);
  const shape = (profile.curve * Math.max(expectedCarry, 20)) / 100;

  const expectedTotal = expectedCarry + expectedRoll;
  const center = add(add(ball, scale(aim, expectedTotal)), scale(right, drift + shape));

  const plan: ShotPlan = {
    request,
    club,
    shotType: request.shotType,
    aim,
    right,
    bearing,
    distanceToTarget,
    playsLike: distanceToTarget + elevationYards + (shortGame ? 0 : -windCarryDelta(wind, Math.max(expectedCarry, 40), windSkill, profile.windExposure)),
    elevationDelta,
    expectedCarry,
    expectedRoll,
    expectedTotal,
    center,
    sigmaLong: Math.max(0.4, sigmaLong),
    sigmaLat: Math.max(0.3, sigmaLat),
    biasSpread: (lie.directionalBias * Math.max(expectedCarry, 20)) / 100 * 0.9,
    swingScale,
    wind: { head: wind.head, cross: wind.cross, speed: windSpeed, drift, carryDelta: windCarryDelta(wind, Math.max(expectedCarry, 20), windSkill, profile.windExposure), label: wind.label },
    apex,
    spin,
    descent: club.descent,
    smash: smashProfile(golfer, club, lie, request.shotType),
    shortGame,
    warnings,
    odds: EMPTY_ODDS,
  };

  if (!options?.skipOdds) plan.odds = evaluatePlan(ctx, plan, options?.fastOdds);
  return plan;
}

function windCarryDelta(
  wind: { head: number },
  carry: number,
  windSkill: number,
  exposure: number,
): number {
  const scale_ = (Math.max(carry, 20) / 170) * exposure * windSkill;
  return wind.head > 0 ? -wind.head * TUNING.headwindPerMph * scale_ : -wind.head * TUNING.tailwindPerMph * scale_;
}

/**
 * How far every club in the bag goes from here, at a full swing.
 *
 * The decision AI needs this for each candidate club, and calling planShot
 * fourteen times to find out was the single most expensive thing in a season
 * simulation. The modifiers are shared across clubs, so they are computed once.
 */
export function reachTable(ctx: ShotContext, direction: Vec2, shotType: ShotTypeId = 'full'): Map<ClubId, number> {
  const { golfer, hole, ball, conditions } = ctx;
  const lie = LIES[ctx.lie];
  const profile = SHOT_TYPES[shotType];
  const weather = conditions.weather;
  const windSpeed = gustedWind(conditions, ctx.shotIndex);
  const wind = windComponents(weather, shotBearing(hole, direction), windSpeed);
  const windSkill = 1 - (effective(golfer, 'wind') - 50) * 0.006;
  const distanceMods =
    lie.distance *
    weatherEffect(golfer, weather).distance *
    fatigueEffect(golfer).distance *
    pressureEffect(golfer, ctx.pressure, 'approach').distance *
    profile.distance;
  const bag = bagFor(golfer);
  const ballElevation = hole.elevationAt(ball);

  const table = new Map<ClubId, number>();
  for (const club of SWING_CLUBS) {
    const carry = bag[club.id].carry * distanceMods;
    const roll = bag[club.id].roll * profile.roll * weather.firmness * lie.rollAfter;
    const landing = add(ball, scale(direction, carry));
    const elevationYards = (() => {
      const delta = hole.elevationAt(landing) - ballElevation;
      return delta >= 0 ? delta * TUNING.yardsPerFootUp : delta * TUNING.yardsPerFootDown;
    })();
    table.set(club.id, carry + windCarryDelta(wind, carry, windSkill, profile.windExposure) - elevationYards + roll);
  }
  return table;
}

const EMPTY_ODDS: OutcomeOdds = {
  fairway: 0, green: 0, rough: 0, sand: 0, water: 0, trees: 0, ob: 0,
  expectedStrokes: 0, proximity: 0, inside10ft: 0,
};

// ---------------------------------------------------------------------------
// Evaluating a plan — the risk numbers, and the AI's decision function
// ---------------------------------------------------------------------------

/**
 * Equal-probability strata, each represented by its conditional mean.
 *
 * Gauss–Hermite is the textbook answer and it is the wrong one here: its nodes
 * are far apart, and what we are integrating is a step function — "is this point
 * in the water" — so a hazard that sits between two nodes is invisible. Equal
 * probability strata put a sample in every 1/n of the distribution, which is
 * exactly what an indicator function needs.
 */
function strataNodes(n: number): number[] {
  const nodes: number[] = [];
  const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const quantile = (p: number) => {
    let lo = -8;
    let hi = 8;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (normalCdf(mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? -Infinity : quantile(i / n);
    const b = i === n - 1 ? Infinity : quantile((i + 1) / n);
    const density = (Number.isFinite(a) ? phi(a) : 0) - (Number.isFinite(b) ? phi(b) : 0);
    nodes.push(density * n);
  }
  return nodes;
}

/** 9 strata for the player's own shot preview, 7 for the simulation AI. */
const STRATA_FINE = strataNodes(9);
const STRATA_FAST = strataNodes(6);

/**
 * Integrate the shot's distribution over the terrain: the odds of each outcome,
 * the expected strokes to hole out, and how close it finishes on average.
 *
 * This is both the number the player sees before pulling the trigger and the
 * function the simulated field uses to choose between two shots, which is what
 * keeps the played game and the simulated one honest with each other.
 */
export function evaluatePlan(ctx: ShotContext, plan: ShotPlan, fast = false): OutcomeOdds {
  const { hole } = ctx;
  const scaleAbility = abilityScaleFor(ctx.golfer.hidden.currentAbility);
  const odds = { fairway: 0, green: 0, rough: 0, sand: 0, water: 0, trees: 0, ob: 0 };
  const nodes = fast ? STRATA_FAST : STRATA_FINE;
  let expected = 0;
  let proximity = 0;
  let inside10 = 0;

  // The sampler draws from a mixture: mostly a tight normal, occasionally one
  // 2.4× as wide. Integrating only the tight one would quietly under-report
  // exactly the disasters the player is trying to avoid, so both are evaluated.
  const tail = tailProbability(ctx.golfer);
  const latSpread = Math.hypot(plan.sigmaLat, plan.biasSpread);
  const components: [number, number][] = [
    [1 - tail, 1],
    [tail, TUNING.tailScale],
  ];

  for (const [share, widen] of components) {
    const sigmaLong = plan.sigmaLong * widen;
    const sigmaLat = latSpread * widen;
    const weight = share / (nodes.length * nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const alongOffset = nodes[i] * sigmaLong;
      for (let j = 0; j < nodes.length; j++) {
        const lateralOffset = nodes[j] * sigmaLat;
        const point = {
          x: plan.center.x + plan.aim.x * alongOffset + plan.right.x * lateralOffset,
          y: plan.center.y + plan.aim.y * alongOffset + plan.right.y * lateralOffset,
        };
        const lie = approximateLieAt(hole, point);
        const pinDistance = dist(point, hole.pin);
        switch (lie) {
          case 'fairway':
          case 'firstCut':
          case 'tee':
            odds.fairway += weight;
            break;
          case 'green':
          case 'fringe':
            odds.green += weight;
            break;
          case 'lightRough':
          case 'heavyRough':
          case 'deepRough':
          case 'waste':
            odds.rough += weight;
            break;
          case 'fairwayBunker':
          case 'greensideBunker':
            odds.sand += weight;
            break;
          case 'water':
            odds.water += weight;
            break;
          case 'recovery':
          case 'pineStraw':
            odds.trees += weight;
            break;
          case 'ob':
            odds.ob += weight;
            break;
        }
        expected += weight * strokesToHoleOut(lie, pinDistance, scaleAbility);
        proximity += weight * pinDistance;
        if (lie === 'green' && pinDistance <= 10 / 3) inside10 += weight;
      }
    }
  }

  return { ...odds, expectedStrokes: expected, proximity, inside10ft: inside10 };
}

/** Points on the dispersion contour at a given number of standard deviations. */
export function dispersionContour(plan: ShotPlan, sigmas: number, steps = 40): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push(
      add(
        add(plan.center, scale(plan.aim, Math.cos(angle) * plan.sigmaLong * sigmas)),
        scale(plan.right, Math.sin(angle) * plan.sigmaLat * sigmas),
      ),
    );
  }
  return points;
}

/**
 * σ multiple containing a given share of shots for a 2D normal.
 * 50% → 1.177σ, 75% → 1.665σ, 90% → 2.146σ.
 */
export function sigmaForShare(share: number): number {
  return Math.sqrt(-2 * Math.log(1 - share));
}

/** Probability the shot finishes within `yards` of the target, along the line. */
export function chanceWithinDistance(plan: ShotPlan, yards: number): number {
  return 2 * normalCdf(yards / plan.sigmaLong) - 1;
}

// ---------------------------------------------------------------------------
// Resolving a shot
// ---------------------------------------------------------------------------

export function resolveShot(ctx: ShotContext, plan: ShotPlan, rng: Rng): ShotResult {
  const { hole, golfer, ball } = ctx;
  const lie = LIES[ctx.lie];
  const profile = SHOT_TYPES[plan.shotType];
  const notes: string[] = [];
  const tail = tailProbability(golfer);

  // --- Strike ---------------------------------------------------------------
  // You cannot beat the middle of the face, so the shortfall is half-normal and
  // the carry that follows is left-skewed: mostly full numbers, sometimes short.
  const smashLoss = Math.abs(heavyNormal(rng, tail, TUNING.tailScale)) * plan.smash.sigma;
  const smash = plan.smash.ceiling - smashLoss;
  const share = plan.shortGame ? 1 : strikeShare(smash, plan.smash);

  let carry = plan.expectedCarry * share + rng.normal() * plan.sigmaLong * SMASH.residualShare;
  // Gear effect: the face twists about its centre, so an off-centre strike that
  // cost distance also turned the ball. Toe or heel is a coin toss.
  const gearSide = rng.chance(0.5) ? 1 : -1;
  const gear = plan.shortGame
    ? 0
    : gearSide * (smashLoss * 100) * SMASH.gearEffect * (Math.max(plan.expectedCarry, 30) / 100);
  let lateral = heavyNormal(rng, tail, TUNING.tailScale) * plan.sigmaLat + gear;

  // Reduced-control lies push the ball unpredictably one way or the other.
  if (lie.directionalBias > 0) {
    const sign = rng.chance(0.5) ? 1 : -1;
    lateral += sign * lie.directionalBias * (Math.max(carry, 20) / 100) * rng.range(0.4, 1.4);
  }

  // --- Mishits -------------------------------------------------------------
  const skillForMishit = plan.shortGame
    ? shortGameSkill(golfer, plan.shotType, ctx.lie)
    : effective(golfer, plan.club.accuracySkill) * 0.5 + effective(golfer, 'consistency') * 0.5;
  const mishitChance = clamp(
    lie.mishit * (1.32 - (skillForMishit / 100) * 0.62) * (1 + ctx.pressure * 0.45) * (1 + effectiveFatigue(golfer) / 320),
    0.001,
    0.5,
  );
  let mishit = smash < plan.smash.ceiling * SMASH.mishitFloor;
  let quality = describeStrike(smash, plan.smash);
  if (rng.chance(mishitChance)) {
    mishit = true;
    const kind = rng.next();
    if (kind < 0.4) {
      carry *= rng.range(0.55, 0.78);
      lateral *= 1.5;
      quality = 'Heavy — caught it fat';
      notes.push('Caught it heavy.');
    } else if (kind < 0.7) {
      carry *= rng.range(0.80, 0.94);
      lateral += (rng.chance(0.5) ? 1 : -1) * plan.sigmaLat * rng.range(1.6, 3.0);
      quality = 'Thin — flew low and right of line';
      notes.push('Thinned it.');
    } else {
      carry *= rng.range(0.86, 1.0);
      lateral += (rng.chance(0.5) ? 1 : -1) * plan.sigmaLat * rng.range(2.2, 4.0);
      quality = 'Blocked — never on line';
      notes.push('Never on line.');
    }
  }

  carry = Math.max(2, carry);

  const landing = add(add(ball, scale(plan.aim, carry)), scale(plan.right, lateral));
  const landingInfo = terrainAt(hole, landing);

  // --- Bounce and roll -----------------------------------------------------
  let roll: number;
  const spinFactor = clamp((plan.spin / 11000) * profile.spin, 0, 0.92);
  if (plan.shortGame) {
    // A chip is *planned* as carry plus run-out, so the run-out is part of the
    // shot rather than something that happens to it. Landing short of the green
    // in the fringe or the rough is what takes the run away.
    const surface = landingInfo.lie === 'green' ? 1 : LANDING_ROLL[landingInfo.lie];
    roll = plan.expectedRoll * surface * rng.range(0.82, 1.18);
  } else if (landingInfo.lie === 'green' || landingInfo.lie === 'fringe') {
    const firm = ctx.conditions.weather.greenFirmness / 70;
    roll = carry * TUNING.greenRollBase * firm * (1 - spinFactor);
    // A high-spin wedge into a soft green can check and come back.
    if (spinFactor > 0.62 && ctx.conditions.weather.greenFirmness < 66) roll -= carry * 0.008;
    if (roll < 0) notes.push('Took the spin and checked back.');
  } else {
    const surface = LANDING_ROLL[landingInfo.lie];
    roll = plan.expectedRoll * surface * (1 - spinFactor * 0.35) * rng.range(0.75, 1.25);
  }

  const slope = slopeAt(hole, landing);
  const downhillAlong = slope.gradient > 0 ? Math.max(0, slope.downhill.x * plan.aim.x + slope.downhill.y * plan.aim.y) : 0;
  roll *= 1 + downhillAlong * slope.gradient * 0.9;
  roll = Math.max(-carry * 0.02, roll);

  // Roll runs along the line of flight, pulled toward the fall of the land.
  const rollDirection = norm(add(plan.aim, scale(slope.downhill, Math.min(0.55, slope.gradient * 0.9))));
  let final = add(landing, scale(rollDirection, roll));
  const rollPath = [landing, final];

  // --- Hazards -------------------------------------------------------------
  let penalty = 0;
  let penaltyKind: ShotResult['penaltyKind'] = 'none';
  let finalInfo = terrainAt(hole, final);

  // Only bisect for a water crossing when there is water anywhere near the line.
  if (finalInfo.lie !== 'water' && roll > 1 && nearWater(hole, landing, final)) {
    const crossing = findCrossing(landing, final, (p) => terrainAt(hole, p).lie === 'water', 24);
    if (crossing) {
      final = crossing;
      finalInfo = terrainAt(hole, final);
      rollPath[1] = final;
    }
  }

  if (finalInfo.lie === 'water') {
    penalty = 1;
    penaltyKind = 'water';
    const entry = findCrossing(ball, final, (p) => terrainAt(hole, p).lie === 'water', 60) ?? final;
    final = dropPoint(hole, ball, entry);
    finalInfo = terrainAt(hole, final);
    notes.push('In the water — penalty stroke and a drop.');
  } else if (finalInfo.lie === 'ob') {
    penalty = 1;
    penaltyKind = 'ob';
    final = ball;
    finalInfo = terrainAt(hole, final, { onTee: ctx.onTee });
    notes.push('Out of bounds — stroke and distance.');
  }

  // --- Did it go in? -------------------------------------------------------
  const holed = penalty === 0 && pathPassesHole(landing, final, hole.pin);
  if (holed) notes.push(plan.shortGame ? 'Holed it from off the green!' : 'In the hole!');

  return {
    smash,
    strikeShare: share,
    start: ball,
    landing,
    final,
    carry,
    roll,
    total: carry + Math.max(0, roll),
    deviation: lateral,
    apex: plan.apex,
    spin: plan.spin,
    landingLie: landingInfo.lie,
    finalLie: holed ? 'green' : finalInfo.lie,
    penalty,
    penaltyKind,
    holed,
    mishit,
    quality,
    path: flightPath(ball, landing, plan.apex),
    rollPath,
    notes,
  };
}

/** Is any water close enough to this segment to be worth checking properly? */
function nearWater(hole: HoleGeometry, from: Vec2, to: Vec2, pad = 6): boolean {
  if (hole.water.length === 0) return false;
  const minX = Math.min(from.x, to.x) - pad;
  const maxX = Math.max(from.x, to.x) + pad;
  const minY = Math.min(from.y, to.y) - pad;
  const maxY = Math.max(from.y, to.y) + pad;
  for (const w of hole.water) {
    if (w.bounds.maxX < minX || w.bounds.minX > maxX || w.bounds.maxY < minY || w.bounds.minY > maxY) continue;
    return true;
  }
  return false;
}

/** What that strike felt like. */
function describeStrike(smash: number, profile: { ceiling: number; expected: number }): string {
  const off = profile.ceiling - smash;
  const typical = profile.ceiling - profile.expected;
  if (off <= typical * 0.35) return 'Flushed';
  if (off <= typical * 0.9) return 'Middled';
  if (off <= typical * 1.7) return 'Slightly off the centre';
  if (off <= typical * 2.6) return 'Off the toe';
  return 'Nowhere near the middle';
}

/** A ball rolling over the hole drops in. The hole is 4.25 inches across. */
const HOLE_RADIUS_YARDS = 0.059;

function pathPassesHole(from: Vec2, to: Vec2, pin: Vec2): boolean {
  const segment = sub(to, from);
  const length2 = segment.x * segment.x + segment.y * segment.y;
  if (length2 < 1e-9) return dist(from, pin) <= HOLE_RADIUS_YARDS;
  const t = clamp(((pin.x - from.x) * segment.x + (pin.y - from.y) * segment.y) / length2, 0, 1);
  const closest = add(from, scale(segment, t));
  return dist(closest, pin) <= HOLE_RADIUS_YARDS;
}

/** Parabolic flight for the animation, with height in feet. */
function flightPath(from: Vec2, to: Vec2, apex: number, steps = 26): { x: number; y: number; h: number }[] {
  const out: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Slightly skewed parabola: the ball rises faster than it falls.
    const h = apex * 4 * Math.pow(t, 0.92) * (1 - t);
    out.push({ x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), h });
  }
  return out;
}

/** The lie the ball is in, for a context built from a position. */
export function contextLie(hole: HoleGeometry, ball: Vec2, onTee: boolean): { lie: LieType; deepBunker: boolean } {
  const info = terrainAt(hole, ball, { onTee });
  return { lie: info.lie, deepBunker: info.deepBunker };
}

/** Slope of the green under the ball, exposed for the putting UI. */
export { greenSlopeAt };
