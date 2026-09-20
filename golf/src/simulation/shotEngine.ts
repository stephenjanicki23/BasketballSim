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
  SHOT_TYPES,
  SMASH,
  SWING_CLUBS,
  TUNING,
  type ShotTypeId,
} from './config';
import { CLUB_SURFACE, DEFAULT_SURFACE, PHYSICS, SURFACES, blendSurfaces, type SurfaceMaterial } from './surfaces';
import { lieStateFor, type LieState } from './lieState';
import { contactFor, type ContactInputs, type ContactResult } from './impact';
import { flightFor, type FlightProfile } from './ballFlight';
import { landingFor, stockRun, type LandingResult } from './landing';
import {
  type DailyTouch,
  NEUTRAL_TOUCH,
  altitudeFactor,
  bagFor,
  effective,
  effectiveFatigue,
  fatigueEffect,
  pressureEffect,
  sigmaFactor,
  tailProbability,
  weatherEffect,
} from './golferEngine';
import { approximateLieAt, greenSlopeAt, terrainAt, dropPoint, pathRelief } from './courseEngine';
import { gustedWind, windComponents } from './weatherEngine';
import { abilityScaleFor, strokesToHoleOut } from './strokesBaseline';
import type {
  ClubDefinition,
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
  /** The material the ball is on and the state it is in. */
  lieState: LieState;
  /** What the face is expected to do to it. */
  contact: ContactResult;
  /** The trajectory those launch conditions fly. */
  flight: FlightProfile;
  /**
   * Carry as a share of what a neutral lie would have produced — the number the
   * physics contributes to the distance. The resolve divides its own factor by
   * this one, so the two have to be measured the same way: both at a full swing,
   * because the swing scale is the ladder's business, not the lie's.
   */
  carryFactor: number;
  /** Speed the ball is expected to arrive at, in mph. */
  landingSpeed: number;
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
  /** Sidespin in rpm; positive bends the ball right. */
  sidespin: number;
  /** Degrees the spin axis was tilted from vertical. */
  spinAxis: number;
  /** Ball speed off the face, mph. */
  ballSpeed: number;
  /** Launch angle, degrees. */
  launchAngle: number;
  /** Descent angle at landing, degrees. */
  descent: number;
  /** Speed at landing, mph. */
  landingSpeed: number;
  /** True when grass got between the face and the ball and killed the spin. */
  flyer: boolean;
  /** 0–1 of how cleanly it came off the face. */
  contactQuality: number;
  /** 0–1 of how much material was in the way. */
  grassInterference: number;
  /** What the ground did with it. */
  groundResult: LandingResult;
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
export function smashProfile(
  golfer: Golfer,
  club: ClubDefinition,
  distanceControl: number,
  shotType: ShotTypeId,
): { ceiling: number; expected: number; sigma: number } {
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
    SMASH.lossSigma[club.family] * skill * distanceControl * SHOT_TYPES[shotType].longitudinal;
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
function carryShare(
  shotType: ShotTypeId,
  club: ClubDefinition,
  greenFirmness: number,
  contact: ContactResult,
): number {
  const base =
    shotType === 'bumpRun' ? 0.30
    : shotType === 'chip' ? 0.42
    : shotType === 'pitch' ? 0.78
    : shotType === 'flop' ? 0.93
    : 0.86;
  const loft = (CLUB_SURFACE[club.family].loft - 41) * 0.006;
  const firm = (70 - greenFirmness) * 0.0012;
  // A lie that has taken the spin off the ball cannot be landed on the flag and
  // stopped, so the golfer plans to land it shorter and let it run.
  const spinLoss = (1 - contact.backspin / Math.max(1, club.spin)) * 0.22;
  return clamp(base + loft + firm - spinLoss, 0.20, 0.96);
}

// ---------------------------------------------------------------------------
// From golfer and contact to launch conditions
// ---------------------------------------------------------------------------

/** The rating that gets a ball out of the lie it is in. */
function lieSkillFor(golfer: Golfer, state: LieState, shotType: ShotTypeId): number {
  const key = state.surface.skill;
  const base = key && key !== 'putting' ? effective(golfer, key) : effective(golfer, 'consistency');
  const short = isShortGame(shotType) ? shortGameSkill(golfer, shotType, state.lie) : base;
  return (base + short) / 2;
}

/**
 * How much backspin a golfer generates, on the game's own 0–100 scale. There is
 * no spin rating: the players who spin it are the ones who control the strike,
 * which is what these two measure.
 */
function spinSkillFor(golfer: Golfer): number {
  return effective(golfer, 'approachConsistency') * 0.6 + effective(golfer, 'wedgeAccuracy') * 0.4;
}

/**
 * Altitude stays on the distance ladder rather than in the flight model.
 *
 * It is tempting to pass thin air into the integrator, where it belongs
 * physically — but carry is normalised against the *same club's* neutral flight,
 * and if both runs use the course's air density the altitude cancels exactly
 * and the game silently loses it. Splitting the two (sea level for the
 * reference, course air for the actual) would work, but it would also quietly
 * replace `TUNING.carryPerThousandFeet` — a calibrated number with a tour
 * rule of thumb behind it — with whatever the integrator happens to produce.
 * So the ladder keeps altitude, and both flights are flown at sea level.
 */
const SEA_LEVEL = 1;

/** What a middled strike from a perfect lie would launch, with this shot type. */
function neutralLaunch(club: ClubDefinition, shotType: ShotTypeId, swing: number, altitude: number) {
  void altitude;
  const profile = SHOT_TYPES[shotType];
  return {
    ballSpeed: club.ballSpeed * swingSpeed(swing),
    launch: club.launch + PHYSICS.loftToLaunch * profile.loftDelta,
    backspin: club.spin * profile.spin,
    airDensity: SEA_LEVEL,
  };
}

/** What this contact actually launches. */
function launchFor(club: ClubDefinition, contact: ContactResult, swing: number, altitude: number) {
  void altitude;
  return {
    ballSpeed: club.ballSpeed * contact.ballSpeedFactor * swingSpeed(swing),
    launch: club.launch + contact.launchDelta,
    backspin: contact.backspin,
    airDensity: SEA_LEVEL,
  };
}

/**
 * Yards of curve, from the spin axis. Sidespin bends the ball in proportion to
 * how much of the total spin is tilted sideways and how long it is in the air,
 * so a shot whose backspin has been killed cannot curve much whatever the
 * golfer meant to do with it.
 */
function curveFromSpin(contact: ContactResult, carry: number): number {
  const tilt = contact.totalSpin > 0 ? contact.sidespin / contact.totalSpin : 0;
  return tilt * (contact.totalSpin / 6000) * (carry / 100) * 14.5;
}

/** Ball speed as a share of full, for a partial swing. */
function swingSpeed(swing: number): number {
  return Math.pow(clamp(swing, 0.2, 1), 0.55);
}

/**
 * How far this arrival runs compared with the same club's stock arrival on a
 * fairway — the number that replaces a per-surface roll multiplier.
 */
function runFactor(
  club: ClubDefinition,
  contact: ContactResult,
  actual: FlightProfile,
  reference: FlightProfile,
  lieState: LieState,
  ctx: ShotContext,
): number {
  const ground = groundAt(ctx, SURFACES.fairway);
  const mine = landingFor({
    speed: actual.landingSpeed,
    descent: actual.descent,
    backspin: actual.landingSpin,
    surface: ground.surface,
    firmness: ground.firmness,
    moisture: ground.moisture,
  });
  void club;
  void contact;
  void lieState;
  return clamp(mine.run / stockRun(reference), 0, 4);
}

/**
 * The week's green firmness, on the scale the landing model works in. See
 * `PHYSICS.greenFirmnessFloor`: a maintained putting surface sits inside a
 * narrow band whatever the weather does.
 */
export function greenFirmness(scorecardFirmness: number): number {
  return clamp(
    PHYSICS.greenFirmnessFloor + (scorecardFirmness / 100) * PHYSICS.greenFirmnessSpan,
    0.12,
    0.95,
  );
}

/**
 * A landing surface with the week's weather in it. Rain softens the ground and
 * wets the grass, and both change what the ball does when it arrives — which is
 * the whole of "the course is playing soft this week".
 */
export function groundAt(
  ctx: ShotContext,
  surface: SurfaceMaterial,
): { surface: SurfaceMaterial; firmness: number; moisture: number } {
  const weather = ctx.conditions.weather;
  const wetness = clamp(weather.softness * 0.7 + weather.rain * 0.5, 0, 1);
  // `weather.firmness` is a course-style multiplier around 1; the material's
  // firmness is a 0–1 property. This is the one place the two scales meet.
  // `weather.firmness` is a course-style multiplier around 1 — 0.92 for a soft
  // parkland, 1.5 for baked desert — and the material's firmness is a 0–1
  // property. This is the one place the two scales meet, and the coefficient is
  // set so the field's average run-out comes out where it was before.
  // Two coefficients, not one, because the run-out the landing model produces
  // is convex in firmness: the same step up from a normal week to a baked one
  // buys far more run than the step down to a wet one costs. A single linear
  // map gets the tour's *average* driving distance right by cancellation while
  // over-rolling every desert week and under-rolling every soaked one.
  const drier = weather.firmness - 1;
  const firmness = clamp(
    surface.firmness + drier * (drier >= 0 ? 0.17 : 0.34) - wetness * 0.12,
    0.10,
    0.98,
  );
  return {
    surface,
    firmness,
    moisture: clamp(surface.moisture + wetness * PHYSICS.rainMoisture, 0, 1),
  };
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
  // The material decides, not the lie type: a fairway bunker that has packed
  // down after rain will take a 3 wood, and the same bunker dry will not.
  const state = lieFor(ctx);
  // A good lie on a surface imposes no limit of its own beyond the material's;
  // only a poor one takes club out of your hands. The clamp matters: a fairway
  // lie is drawn a hair under perfect, and without it the driver would be
  // illegal from the tee.
  const limit = state.surface.maxCarryRatio * clamp(0.70 + 0.42 * state.quality, 0.70, 1);
  return SWING_CLUBS.filter((club) => club.carryRatio <= limit + 1e-6);
}

/**
 * The lie the ball is actually in, cached per context so the planner, the odds
 * and the resolve all read the same one.
 */
const lieCache = new WeakMap<ShotContext, LieState>();

export function lieFor(ctx: ShotContext): LieState {
  const hit = lieCache.get(ctx);
  if (hit) return hit;
  const state = lieStateFor(ctx.lie, ctx.ball, {
    weather: ctx.conditions.weather,
    deepBunker: ctx.deepBunker,
  });
  lieCache.set(ctx, state);
  return state;
}

/** Shot types that make sense right now. */
export function availableShotTypes(ctx: ShotContext, distanceToTarget: number): ShotTypeId[] {
  if (ctx.lie === 'green') return ['putt'];
  if (ctx.lie === 'greensideBunker') return ['explosion'];
  const types: ShotTypeId[] = [];
  if (distanceToTarget <= 45) types.push('chip');
  if (distanceToTarget <= 40) types.push('bumpRun');
  if (distanceToTarget <= 75) types.push('pitch');
  if (distanceToTarget <= 32) types.push('flop');
  types.push('full', 'knockdown', 'punch', 'high', 'draw', 'fade');
  if (ctx.lie === 'recovery' || ctx.lie === 'pineStraw') types.splice(types.indexOf('full') + 1, 0, 'recovery');
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

  // --- The lie, and what the face is going to do to the ball ---------------
  // Everything the surface does to this shot comes out of these two calls, and
  // nothing below reaches for a per-lie multiplier.
  const lieState = lieFor(ctx);
  const contactInputs: ContactInputs = {
    lie: lieState,
    club,
    shotType: request.shotType,
    swingScale: 1,
    strike: 1,
    lieSkill: lieSkillFor(golfer, lieState, request.shotType),
    spinSkill: spinSkillFor(golfer),
    curve: profile.curve,
    // The plan is the expectation, so it is drawn at the middle of the spread
    // and told not to flyer; the resolve rolls for both.
    roll: 0.5,
    rollB: 1,
  };
  const contact = contactFor(contactInputs);

  let expectedCarry: number;
  let expectedRoll: number;
  let sigmaLong: number;
  let sigmaLat: number;
  let swingScale = 1;
  let apex: number;
  let spin: number;
  let flight: FlightProfile;
  let landingSpeed: number;
  let descent: number;
  let carryFactor = 1;

  const touch = ctx.touch ?? NEUTRAL_TOUCH;
  const touchFactor = shortGame
    ? touch.short
    : club.family === 'driver' || club.family === 'wood'
      ? touch.driving
      : touch.approach;
  const envSigma = weatherMods.sigma * fatigueMods.sigma * pressureMods.sigma * touchFactor;
  const windSigma = 1 + windSpeed * TUNING.windSigmaPerMph * windSkill * profile.windExposure;
  const air = altitudeFactor(hole.course.altitude);

  if (shortGame) {
    // --- Short game: the golfer plays to a distance, not to a club ---------
    const skill = shortGameSkill(golfer, request.shotType, ctx.lie);
    const share = carryShare(request.shotType, club, weather.greenFirmness, contact);
    const intended = distanceToTarget + elevationYards * 0.5;
    expectedCarry = intended * share;
    expectedRoll = intended * (1 - share);
    // A chip is a small swing, and the physics has to be told so: at a full
    // swing's ball speed and spin the flight model hands the bounce model three
    // times more backspin than forward speed, and every chip stops dead on
    // landing.
    swingScale = clamp(intended / Math.max(12, bag[club.id].carry), 0.2, 1);
    const factor = sigmaFactor(skill);
    sigmaLong = (0.082 * intended + 1.05) * factor * contact.distanceControl * profile.longitudinal * envSigma;
    sigmaLat = (0.052 * intended + 0.75) * factor * contact.dispersion * profile.lateral * envSigma * (1 + (windSigma - 1) * 0.3);
    // A short shot is flown at the launch the contact model produced, scaled to
    // the distance it is being played: same physics, smaller swing.
    flight = flightFor(launchFor(club, contactFor({ ...contactInputs, swingScale }), swingScale, air));
    apex = Math.min(70, flight.apexFeet * (Math.max(4, expectedCarry) / flight.carry)) * profile.apex;
    spin = contact.backspin;
    descent = flight.descent;
    landingSpeed = flight.landingSpeed * Math.sqrt(Math.max(4, expectedCarry) / flight.carry);
  } else {
    // --- Full swing -------------------------------------------------------
    // The ladder — how far this golfer hits this club — is unchanged. What the
    // physics supplies is the *response*: the same swing out of a different lie
    // launches differently, spins differently and therefore carries differently.
    const distanceMods =
      weatherMods.distance * fatigueMods.distance * pressureMods.distance * profile.distance *
      altitudeFactor(hole.course.altitude);
    const stockFull = bag[club.id].carry * distanceMods;

    const reference = flightFor(neutralLaunch(club, request.shotType, 1, air));
    const actual = flightFor(launchFor(club, contact, 1, air));

    // A flyer is a discrete event, so the honest plan is the mixture: the
    // expected carry moves toward the hot one in proportion to the odds, and
    // the spread widens by the variance of a two-point distribution. Without
    // this the dispersion overlay tells the player one thing and the shot does
    // another, and the AI evaluates a rough approach as if flyers did not exist.
    const flyerOdds = clamp(contact.flyerChance, 0, 1);
    let flyerFactor = actual.carry / reference.carry;
    if (flyerOdds > 0.01) {
      const hot = contactFor({ ...contactInputs, rollB: 0 });
      flyerFactor = flightFor(launchFor(club, hot, 1, air)).carry / reference.carry;
    }
    const plainFactor = actual.carry / reference.carry;
    carryFactor = plainFactor + flyerOdds * (flyerFactor - plainFactor);
    const flyerSpread = Math.sqrt(flyerOdds * (1 - flyerOdds)) * Math.abs(flyerFactor - plainFactor);

    const fullCarry = stockFull * carryFactor;
    const fullRoll = bag[club.id].roll * profile.roll * runFactor(club, contact, actual, reference, lieState, ctx);

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
      club.baseLatSigma * sigmaFactor(accuracyRating) * contact.dispersion * profile.lateral * envSigma * windSigma * scaleLat;
    sigmaLong = Math.hypot(
      club.baseLongSigma * sigmaFactor(distanceRating) * contact.distanceControl * profile.longitudinal * envSigma *
        (1 + (windSigma - 1) * 0.7) * scaleLong,
      flyerSpread * expectedCarry,
    );

    flight = actual;
    const launchRating = 0.88 + (effective(golfer, 'launch') / 100) * 0.24;
    apex = actual.apexFeet * (Math.max(6, expectedCarry) / actual.carry) * launchRating * (1 - wind.head * 0.002);
    spin = contact.backspin;
    descent = actual.descent;
    landingSpeed = actual.landingSpeed * Math.sqrt(Math.max(6, expectedCarry) / actual.carry);

    if (contact.flyerChance > 0.18) {
      warnings.push(`Flyer lie — ${Math.round(contact.flyerChance * 100)}% chance it comes out hot`);
    }
    if (contact.grassInterference > 0.55) {
      warnings.push(`${lieState.surface.name} — the face will barely reach the ball`);
    }
  }

  if (club.carryRatio > lieState.surface.maxCarryRatio + 1e-6) {
    warnings.push(`${club.name} is not playable from ${lieState.surface.name.toLowerCase()}`);
    sigmaLat *= 1.6;
    sigmaLong *= 1.6;
    expectedCarry *= 0.72;
  }

  // --- Wind drift and intended shape --------------------------------------
  const driftFull = wind.cross * TUNING.crosswindPerMph * (Math.max(expectedCarry, 20) / 170) * profile.windExposure * windSkill;
  // A good wind player aims off for most of it without being told.
  const allowance = clamp(0.5 + (effective(golfer, 'wind') - 50) * 0.008 + (effective(golfer, 'courseManagement') - 50) * 0.002, 0.25, 0.95);
  const drift = driftFull * (1 - allowance);
  // The shape is the spin axis, not a sideways nudge: a shot the rough has
  // taken the spin off cannot be worked, however hard the golfer tries.
  const shape = curveFromSpin(contact, Math.max(expectedCarry, 20));

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
    biasSpread: (contact.directionalBias * Math.max(expectedCarry, 20)) / 100 * 0.9,
    swingScale,
    wind: { head: wind.head, cross: wind.cross, speed: windSpeed, drift, carryDelta: windCarryDelta(wind, Math.max(expectedCarry, 20), windSkill, profile.windExposure), label: wind.label },
    apex,
    spin,
    descent,
    lieState,
    contact,
    flight,
    carryFactor,
    landingSpeed,
    smash: smashProfile(golfer, club, contact.distanceControl, request.shotType),
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
  const profile = SHOT_TYPES[shotType];
  const weather = conditions.weather;
  const windSpeed = gustedWind(conditions, ctx.shotIndex);
  const wind = windComponents(weather, shotBearing(hole, direction), windSpeed);
  const windSkill = 1 - (effective(golfer, 'wind') - 50) * 0.006;
  const distanceMods =
    weatherEffect(golfer, weather).distance *
    fatigueEffect(golfer).distance *
    pressureEffect(golfer, ctx.pressure, 'approach').distance *
    profile.distance *
    altitudeFactor(ctx.hole.course.altitude);
  const bag = bagFor(golfer);
  const ballElevation = hole.elevationAt(ball);
  const lieState = lieFor(ctx);
  const air = altitudeFactor(ctx.hole.course.altitude);
  const lieSkill = lieSkillFor(golfer, lieState, shotType);
  const spinSkill = spinSkillFor(golfer);

  const table = new Map<ClubId, number>();
  for (const club of SWING_CLUBS) {
    // Every club meets the lie differently, so the carry each one gets out of
    // it has to be asked for separately. This is the expensive part of a season
    // simulation, which is why the flight model caches on a quantised grid.
    const contact = contactFor({
      lie: lieState, club, shotType, swingScale: 1, strike: 1,
      lieSkill, spinSkill, curve: profile.curve, roll: 0.5, rollB: 1,
    });
    const reference = flightFor(neutralLaunch(club, shotType, 1, air));
    const actual = flightFor(launchFor(club, contact, 1, air));
    const carry = bag[club.id].carry * distanceMods * (actual.carry / reference.carry);
    const roll = bag[club.id].roll * profile.roll * runFactor(club, contact, actual, reference, lieState, ctx);
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
  const profile = SHOT_TYPES[plan.shotType];
  const notes: string[] = [];
  const tail = tailProbability(golfer);

  // --- Strike ---------------------------------------------------------------
  // You cannot beat the middle of the face, so the shortfall is half-normal and
  // the carry that follows is left-skewed: mostly full numbers, sometimes short.
  const smashLoss = Math.abs(heavyNormal(rng, tail, TUNING.tailScale)) * plan.smash.sigma;
  const smash = plan.smash.ceiling - smashLoss;
  const share = plan.shortGame ? 1 : strikeShare(smash, plan.smash);

  // --- Impact, for real ----------------------------------------------------
  // This is the swing that actually happened: this strike, and a roll against
  // the flyer odds the lie was already carrying.
  //
  // The blade-level roll stays at the middle of the spread, deliberately. A lie
  // that is hard to control makes the shot vary, but that variation is *already*
  // in `sigmaLong` and `sigmaLat` through `contact.distanceControl` — rolling it
  // again here would charge for it twice, and it did: from light rough the
  // realised spread came out at twice what the plan told the player to expect,
  // which makes the dispersion overlay a lie and the AI's risk model wrong.
  // What is left to roll for is the flyer, because that is a discrete event the
  // plan can only quote as a probability.
  const contact = contactFor({
    lie: plan.lieState,
    club: plan.club,
    shotType: plan.shotType,
    swingScale: plan.swingScale,
    strike: clamp(smash / plan.smash.ceiling, 0.55, 1),
    lieSkill: lieSkillFor(golfer, plan.lieState, plan.shotType),
    spinSkill: spinSkillFor(golfer),
    curve: profile.curve,
    roll: 0.5,
    rollB: rng.next(),
  });
  const air = altitudeFactor(hole.course.altitude);
  const reference = flightFor(neutralLaunch(plan.club, plan.shotType, 1, air));
  // Launch scatter: a lie you cannot control does not just move the ball
  // sideways, it changes how high it comes out.
  const launchNoise = rng.normal() * contact.launchScatter;
  const flight = flightFor({
    ...launchFor(plan.club, contact, 1, air),
    launch: Math.max(2, plan.club.launch + contact.launchDelta + launchNoise),
  });
  // Both factors are measured at a full swing against the same reference, so
  // the ratio is purely what this swing's lie and strike did differently from
  // the lie and strike the plan assumed.
  const carryFactor = plan.shortGame ? 1 : flight.carry / Math.max(1, reference.carry);
  let carry =
    plan.expectedCarry * (carryFactor / Math.max(0.2, plan.carryFactor)) * share +
    rng.normal() * plan.sigmaLong * SMASH.residualShare;
  if (contact.flyer) notes.push('Flyer out of the rough — that came out hot.');
  // Gear effect: the face twists about its centre, so an off-centre strike that
  // cost distance also turned the ball. Toe or heel is a coin toss.
  const gearSide = rng.chance(0.5) ? 1 : -1;
  const gear = plan.shortGame
    ? 0
    : gearSide * (smashLoss * 100) * SMASH.gearEffect * (Math.max(plan.expectedCarry, 30) / 100);
  let lateral = heavyNormal(rng, tail, TUNING.tailScale) * plan.sigmaLat + gear;

  // A lie that grabs the hosel pushes the ball unpredictably one way or the other.
  if (contact.directionalBias > 0.01) {
    const sign = rng.chance(0.5) ? 1 : -1;
    lateral += sign * contact.directionalBias * (Math.max(carry, 20) / 100) * rng.range(0.4, 1.4);
  }

  // --- Mishits -------------------------------------------------------------
  const skillForMishit = plan.shortGame
    ? shortGameSkill(golfer, plan.shotType, ctx.lie)
    : effective(golfer, plan.club.accuracySkill) * 0.5 + effective(golfer, 'consistency') * 0.5;
  const mishitChance = clamp(
    contact.mishitChance * (1.32 - (skillForMishit / 100) * 0.62) * (1 + ctx.pressure * 0.45) *
      (1 + effectiveFatigue(golfer) / 320),
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
  // The ball arrives with a speed, an angle and whatever spin is left on it,
  // and the ground it arrives on decides the rest. There is no per-surface roll
  // multiplier anywhere in here.
  const slope = slopeAt(hole, landing);
  const downhillAlong =
    slope.gradient > 0 ? Math.max(0, slope.downhill.x * plan.aim.x + slope.downhill.y * plan.aim.y) : 0;
  const landingSurface = SURFACES[DEFAULT_SURFACE[landingInfo.lie]];
  const ground = groundAt(ctx, landingSurface);
  // A green is maintained to its own firmness, which the week's weather moves
  // and the scorecard reports; it is not the fairway's.
  const greenish = landingInfo.lie === 'green' || landingInfo.lie === 'fringe';
  const firmness = greenish ? greenFirmness(ctx.conditions.weather.greenFirmness) : ground.firmness;

  // The trajectory is scaled to the carry the shot actually produced. Under a
  // uniform scaling of the flight, speeds go as the square root of the length —
  // and so must the spin, or the contact patch arrives turning faster than the
  // ball is travelling and the bounce model stops it dead.
  const carryScale = Math.max(4, carry) / Math.max(1, flight.carry);
  const arrivalScale = Math.sqrt(carryScale);
  const arrivalSpeed = flight.landingSpeed * arrivalScale;
  const runDirection = norm(add(plan.aim, scale(slope.downhill, Math.min(0.55, slope.gradient * 0.9))));
  const conditions = {
    speed: arrivalSpeed,
    descent: flight.descent,
    backspin: flight.landingSpin * arrivalScale,
    surface: landingSurface,
    firmness,
    moisture: ground.moisture,
    slope: downhillAlong * slope.gradient,
  };
  // A ball does not do its running on the patch it landed on. Run it once to
  // find out how far it is going, look at what it crosses on the way, and run it
  // again over the mixture — which is the difference between a chip that
  // pitches on the collar and scoots onto the green and one that stops dead on
  // the collar's own friction.
  let arrival = landingFor(conditions);
  if (arrival.run > 1.5) {
    const midway = add(landing, scale(runDirection, arrival.run * 0.55));
    const crossed = terrainAt(hole, midway);
    if (crossed.lie !== landingInfo.lie) {
      const other = SURFACES[DEFAULT_SURFACE[crossed.lie]];
      const otherGreen = crossed.lie === 'green' || crossed.lie === 'fringe';
      const blended = blendSurfaces(landingSurface, other, 0.55);
      arrival = landingFor({
        ...conditions,
        surface: blended,
        firmness: firmness + ((otherGreen ? greenFirmness(ctx.conditions.weather.greenFirmness) : groundAt(ctx, other).firmness) - firmness) * 0.55,
      });
    }
  }
  const scatter = 1 + (rng.next() - 0.5) * 2 * landingSurface.bounceRandom * 0.55;

  let roll: number;
  if (plan.shortGame) {
    // A chip is *planned* as carry plus run-out, so the run-out is part of the
    // shot. What the ground does is still the ground's decision: the same chip
    // landing in the fringe rather than on the green runs a lot less.
    // The chip was planned to land on the green and run out to the flag, so
    // that is the denominator — the same arrival, on the surface it was aimed
    // at, in the same weather. Anything the ball actually landed on that is not
    // a green then shows up as the shot running less than it was meant to.
    const stock = landingFor({
      ...conditions,
      surface: SURFACES.green,
      firmness: greenFirmness(ctx.conditions.weather.greenFirmness),
      moisture: groundAt(ctx, SURFACES.green).moisture,
      slope: 0,
    });
    roll = plan.expectedRoll * clamp(arrival.run / Math.max(0.2, stock.run), 0, 3) * scatter;
  } else {
    roll = plan.expectedRoll * clamp(arrival.run / stockRun(reference), -0.6, 4) * scatter;
  }
  if (arrival.checked) notes.push('Took the spin and checked back.');

  roll = Math.max(-carry * 0.04, roll);

  // Roll runs along the line of flight, pulled toward the fall of the land.
  let final = add(landing, scale(runDirection, roll));
  const rollPath = [landing, final];

  // A ball at rest on a cart path gets free relief, which is what the rules say
  // and what every player does: step off it and drop. The path is a bounce, not
  // a lie you play from.
  if (hole.paths.length > 0) {
    const relieved = pathRelief(hole, final);
    if (relieved !== final) {
      final = relieved;
      rollPath[1] = final;
    }
  }

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
    apex: plan.apex * (contact.flyer ? 1.06 : 1),
    spin: contact.backspin,
    sidespin: contact.sidespin,
    spinAxis: contact.spinAxis,
    ballSpeed: plan.club.ballSpeed * contact.ballSpeedFactor * Math.pow(clamp(plan.swingScale, 0.2, 1), 0.55),
    launchAngle: plan.club.launch + contact.launchDelta + launchNoise,
    descent: flight.descent,
    landingSpeed: arrivalSpeed,
    flyer: contact.flyer,
    contactQuality: contact.contactQuality,
    grassInterference: contact.grassInterference,
    groundResult: arrival,
    landingLie: landingInfo.lie,
    finalLie: holed ? 'green' : finalInfo.lie,
    penalty,
    penaltyKind,
    holed,
    mishit,
    quality,
    path: flightPath(ball, landing, flight, plan.apex * (contact.flyer ? 1.06 : 1)),
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
    const b = w.shape.bounds;
    if (b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY) continue;
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

/**
 * The flight path for the animation, taken from the trajectory that was
 * actually integrated rather than from a parabola drawn to fit.
 *
 * This is what makes two shots with the same carry look different: a wedge and
 * a flyer that both finish 140 yards away have different shapes, and the shape
 * is the physics, uniformly scaled to the carry the shot ended up with.
 */
function flightPath(
  from: Vec2,
  to: Vec2,
  flight: FlightProfile,
  apexFeet: number,
): { x: number; y: number; h: number }[] {
  const scale_ = flight.apexFeet > 0.01 ? apexFeet / flight.apexFeet : 1;
  const span = dist(from, to);
  return flight.shape.map((point) => ({
    x: lerp(from.x, to.x, point.x),
    y: lerp(from.y, to.y, point.x),
    h: point.h * span * scale_,
  }));
}

/** The lie the ball is in, for a context built from a position. */
export function contextLie(hole: HoleGeometry, ball: Vec2, onTee: boolean): { lie: LieType; deepBunker: boolean } {
  const info = terrainAt(hole, ball, { onTee });
  return { lie: info.lie, deepBunker: info.deepBunker };
}

/** Slope of the green under the ball, exposed for the putting UI. */
export { greenSlopeAt };
