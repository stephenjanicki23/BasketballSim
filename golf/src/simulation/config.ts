/**
 * Every tunable number in the game lives here.
 *
 * The shot engine reads these tables rather than embedding constants, so the
 * feel of the game — how much the rough costs you, how wide a driver goes, how
 * much pressure bites — can be retuned in one file.
 */

import type { ClubDefinition, ClubFamily, ClubId, LieProfile, LieType } from './types';

// ---------------------------------------------------------------------------
// The bag
// ---------------------------------------------------------------------------

export const CLUBS: readonly ClubDefinition[] = [
  { id: 'D',  name: 'Driver',        short: 'Dr',  family: 'driver',     carryRatio: 1.000, rollRatio: 0.060, baseLongSigma: 10.0, baseLatSigma: 24.3, launch: 10.9, ballSpeed: 167, spin: 2500, accuracySkill: 'driverAccuracy' },
  { id: '3W', name: '3 Wood',        short: '3W',  family: 'wood',       carryRatio: 0.895, rollRatio: 0.053, baseLongSigma: 9.2, baseLatSigma: 21.0, launch:  9.2, ballSpeed: 158, spin: 3200, accuracySkill: 'driverAccuracy' },
  { id: '5W', name: '5 Wood',        short: '5W',  family: 'wood',       carryRatio: 0.845, rollRatio: 0.047, baseLongSigma: 8.6, baseLatSigma: 19.2, launch:  9.4, ballSpeed: 152, spin: 3700, accuracySkill: 'longIron' },
  { id: '3i', name: '3 Iron',        short: '3i',  family: 'longIron',   carryRatio: 0.775, rollRatio: 0.036, baseLongSigma: 8.2, baseLatSigma: 17.0, launch: 10.3, ballSpeed: 142, spin: 4100, accuracySkill: 'longIron' },
  { id: '4i', name: '4 Iron',        short: '4i',  family: 'longIron',   carryRatio: 0.735, rollRatio: 0.032, baseLongSigma: 7.6, baseLatSigma: 15.6, launch: 11.0, ballSpeed: 137, spin: 4500, accuracySkill: 'longIron' },
  { id: '5i', name: '5 Iron',        short: '5i',  family: 'longIron',   carryRatio: 0.695, rollRatio: 0.029, baseLongSigma: 7.3, baseLatSigma: 14.3, launch: 12.1, ballSpeed: 132, spin: 5000, accuracySkill: 'longIron' },
  { id: '6i', name: '6 Iron',        short: '6i',  family: 'midIron',    carryRatio: 0.655, rollRatio: 0.025, baseLongSigma: 6.7, baseLatSigma: 12.9,  launch: 14.1, ballSpeed: 127, spin: 5600, accuracySkill: 'midIron' },
  { id: '7i', name: '7 Iron',        short: '7i',  family: 'midIron',    carryRatio: 0.615, rollRatio: 0.022, baseLongSigma: 6.3, baseLatSigma: 11.6,  launch: 16.3, ballSpeed: 120, spin: 6300, accuracySkill: 'midIron' },
  { id: '8i', name: '8 Iron',        short: '8i',  family: 'shortIron',  carryRatio: 0.570, rollRatio: 0.017, baseLongSigma: 5.8, baseLatSigma: 10.2,  launch: 18.1, ballSpeed: 115, spin: 7000, accuracySkill: 'shortIron' },
  { id: '9i', name: '9 Iron',        short: '9i',  family: 'shortIron',  carryRatio: 0.525, rollRatio: 0.014, baseLongSigma: 5.4, baseLatSigma: 9.2,  launch: 20.4, ballSpeed: 109, spin: 7800, accuracySkill: 'shortIron' },
  { id: 'PW', name: 'Pitching Wedge',short: 'PW',  family: 'shortIron',  carryRatio: 0.480, rollRatio: 0.010, baseLongSigma: 4.8, baseLatSigma: 8.1,  launch: 24.2, ballSpeed: 102, spin: 8600, accuracySkill: 'shortIron' },
  { id: 'GW', name: 'Gap Wedge',     short: 'GW',  family: 'wedge',      carryRatio: 0.425, rollRatio: 0.007, baseLongSigma: 4.5, baseLatSigma: 6.9,  launch: 26.5, ballSpeed:  95, spin: 9300, accuracySkill: 'wedgeAccuracy' },
  { id: 'SW', name: 'Sand Wedge',    short: 'SW',  family: 'wedge',      carryRatio: 0.365, rollRatio: 0.005, baseLongSigma: 3.9, baseLatSigma: 6.0,  launch: 29.0, ballSpeed:  86, spin: 9800, accuracySkill: 'wedgeAccuracy' },
  { id: 'LW', name: 'Lob Wedge',     short: 'LW',  family: 'wedge',      carryRatio: 0.300, rollRatio: 0.003, baseLongSigma: 3.5, baseLatSigma: 5.1,  launch: 32.0, ballSpeed:  75, spin: 10400, accuracySkill: 'wedgeAccuracy' },
  { id: 'P',  name: 'Putter',        short: 'Pt',  family: 'putter',     carryRatio: 0.0,   rollRatio: 0,     baseLongSigma: 0,   baseLatSigma: 0,    launch:  3.0, ballSpeed:   0, spin: 0,    accuracySkill: 'putting' },
];

export const CLUB_BY_ID: Record<ClubId, ClubDefinition> = Object.fromEntries(
  CLUBS.map((club) => [club.id, club]),
) as Record<ClubId, ClubDefinition>;

/** Everything except the putter, longest first. */
export const SWING_CLUBS: readonly ClubDefinition[] = CLUBS.filter((c) => c.id !== 'P');

// ---------------------------------------------------------------------------
// Lies
//
// Names and flavour only. What a lie *does* to a golf ball is worked out from
// the material in `surfaces.ts` — grass height, density, firmness, sand depth —
// by `impact.ts`, so there is nothing to tune here.
// ---------------------------------------------------------------------------

export const LIES: Record<LieType, LieProfile> = {
  tee: {
    id: 'tee', name: 'Teeing Ground', short: 'Tee', note: 'Perched on a peg. As good as it gets.',
  },
  fairway: {
    id: 'fairway', name: 'Fairway', short: 'Fwy', note: 'Clean lie. Full control of flight and spin.',
  },
  firstCut: {
    id: 'firstCut', name: 'First Cut', short: '1st', note: 'Barely off line. Slightly less spin than a fairway lie.',
  },
  lightRough: {
    id: 'lightRough', name: 'Light Rough', short: 'Lt Rgh', skill: 'difficultLies',
    note: 'Sitting up. Flyers are possible — the ball comes out hot.',
  },
  heavyRough: {
    id: 'heavyRough', name: 'Heavy Rough', short: 'Hvy Rgh', skill: 'difficultLies',
    note: 'Grass will grab the hosel. Advancing it is the goal.',
  },
  deepRough: {
    id: 'deepRough', name: 'Deep Grass', short: 'Deep', skill: 'difficultLies',
    note: 'Buried. Wedge it back to grass and take your medicine.',
  },
  fairwayBunker: {
    id: 'fairwayBunker', name: 'Fairway Bunker', short: 'Fwy Bkr', skill: 'bunkerPlay',
    note: 'Clean it off the sand or you lose thirty yards.',
  },
  greensideBunker: {
    id: 'greensideBunker', name: 'Greenside Bunker', short: 'Bunker', skill: 'bunkerPlay',
    note: 'Splash it out on a cushion of sand.',
  },
  pineStraw: {
    id: 'pineStraw', name: 'Pine Straw', short: 'Straw', skill: 'difficultLies',
    note: 'The ball can skid off the straw — the club wants to slide under it.',
  },
  waste: {
    id: 'waste', name: 'Desert Waste', short: 'Waste', skill: 'difficultLies',
    note: 'Hardpan, gravel and scrub. Playable, but nothing is guaranteed.',
  },
  recovery: {
    id: 'recovery', name: 'Recovery Lie', short: 'Trees', skill: 'recovery',
    note: 'Trees in the way. Find a gap, keep it low, get back in play.',
  },
  fringe: {
    id: 'fringe', name: 'Fringe', short: 'Fringe', skill: 'chipping',
    note: 'Collar of the green. Putt it or bump it.',
  },
  green: {
    id: 'green', name: 'Green', short: 'Green', skill: 'putting',
    note: 'On the dance floor.',
  },
  water: {
    id: 'water', name: 'Water Hazard', short: 'Water', note: 'One penalty stroke and a drop.',
  },
  ob: {
    id: 'ob', name: 'Out of Bounds', short: 'O.B.', note: 'Stroke and distance. Reload.',
  },
};

export const PLAYABLE_LIES: readonly LieType[] = [
  'tee', 'fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough',
  'fairwayBunker', 'greensideBunker', 'pineStraw', 'waste', 'recovery', 'fringe', 'green',
];

// ---------------------------------------------------------------------------
// Shot types
// ---------------------------------------------------------------------------

export type ShotTypeId =
  | 'full' | 'knockdown' | 'punch' | 'high' | 'draw' | 'fade'
  | 'chip' | 'bumpRun' | 'pitch' | 'flop' | 'explosion' | 'recovery' | 'putt';

export interface ShotTypeProfile {
  id: ShotTypeId;
  name: string;
  blurb: string;
  distance: number;
  /** Multiplier on lateral sigma. */
  lateral: number;
  /** Multiplier on carry sigma. */
  longitudinal: number;
  /** Multiplier on how much the wind moves the ball. */
  windExposure: number;
  /** Multiplier on roll-out after landing. */
  roll: number;
  spin: number;
  apex: number;
  /** Yards of intentional curve per 100 yards of carry; positive bends right. */
  curve: number;
  /** Which rating carries the shot, if it isn't the club's usual one. */
  skill?: 'chipping' | 'pitching' | 'bunkerPlay' | 'recovery';

  // --- How the technique meets the surface --------------------------------
  // These three are what make a punch out of rough behave differently from a
  // full swing out of the same rough, rather than being the same shot scaled.
  /** Degrees added to the club's angle of attack; negative is steeper. */
  attack: number;
  /** Multiplier on how much grass ends up between the face and the ball. */
  grassRelief: number;
  /** Degrees of dynamic loft added or taken off at impact. */
  loftDelta: number;
}

export const SHOT_TYPES: Record<ShotTypeId, ShotTypeProfile> = {
  full:      { id: 'full',      name: 'Standard',    blurb: 'Normal flight and normal spin.',                    distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 1.00, roll: 1.00, spin: 1.00, apex: 1.00, curve: 0,    attack:  0.0, grassRelief: 1.00, loftDelta:  0.0 },
  knockdown: { id: 'knockdown', name: 'Knockdown',   blurb: 'Three-quarter swing, flighted down. Control first.', distance: 0.88, lateral: 0.84, longitudinal: 0.88, windExposure: 0.72, roll: 1.20, spin: 0.92, apex: 0.74, curve: 0,    attack: -1.2, grassRelief: 0.92, loftDelta: -3.5 },
  punch:     { id: 'punch',     name: 'Punch',       blurb: 'Low and boring. Beats the wind, runs on landing.',   distance: 0.93, lateral: 0.90, longitudinal: 1.06, windExposure: 0.55, roll: 1.55, spin: 0.72, apex: 0.58, curve: 0,    attack: -2.4, grassRelief: 0.86, loftDelta: -7.5 },
  high:      { id: 'high',      name: 'High',        blurb: 'Extra height to land soft. The wind gets a vote.',   distance: 0.96, lateral: 1.08, longitudinal: 1.10, windExposure: 1.40, roll: 0.45, spin: 1.18, apex: 1.35, curve: 0,    attack: +1.6, grassRelief: 1.22, loftDelta: +5.0 },
  draw:      { id: 'draw',      name: 'Draw',        blurb: 'Curves right-to-left. Works a corner or a pin.',     distance: 1.01, lateral: 1.10, longitudinal: 1.04, windExposure: 1.00, roll: 1.10, spin: 0.95, apex: 0.95, curve: -3.4, attack: -0.3, grassRelief: 1.00, loftDelta: -1.2 },
  fade:      { id: 'fade',      name: 'Fade',        blurb: 'Curves left-to-right and lands softer.',             distance: 0.98, lateral: 1.10, longitudinal: 1.04, windExposure: 1.05, roll: 0.90, spin: 1.06, apex: 1.05, curve: 3.4,  attack: +0.3, grassRelief: 1.02, loftDelta: +1.2 },
  chip:      { id: 'chip',      name: 'Chip',        blurb: 'Low runner from around the green.',                  distance: 1.00, lateral: 0.80, longitudinal: 0.82, windExposure: 0.20, roll: 2.30, spin: 0.70, apex: 0.25, curve: 0,    attack: -2.0, grassRelief: 0.78, loftDelta: -6.0, skill: 'chipping' },
  bumpRun:   { id: 'bumpRun',   name: 'Bump & Run',  blurb: 'Land it early and let the ground do the work.',      distance: 1.00, lateral: 0.74, longitudinal: 0.80, windExposure: 0.12, roll: 3.10, spin: 0.52, apex: 0.16, curve: 0,    attack: -1.4, grassRelief: 0.72, loftDelta: -11.0, skill: 'chipping' },
  pitch:     { id: 'pitch',     name: 'Pitch',       blurb: 'Carry most of the way, one hop and stop.',           distance: 1.00, lateral: 0.86, longitudinal: 0.90, windExposure: 0.45, roll: 0.70, spin: 1.10, apex: 0.85, curve: 0,    attack: -2.6, grassRelief: 0.80, loftDelta: +2.0, skill: 'pitching' },
  flop:      { id: 'flop',      name: 'Flop',        blurb: 'Straight up, lands dead. High risk, high reward.',   distance: 1.00, lateral: 1.05, longitudinal: 1.35, windExposure: 0.70, roll: 0.18, spin: 1.25, apex: 1.60, curve: 0,    attack: +1.0, grassRelief: 1.45, loftDelta: +14.0, skill: 'pitching' },
  explosion: { id: 'explosion', name: 'Splash',      blurb: 'Sand first, ball out on a cushion.',                 distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 0.40, roll: 0.35, spin: 1.00, apex: 1.10, curve: 0,    attack: -1.0, grassRelief: 1.00, loftDelta: +6.0, skill: 'bunkerPlay' },
  recovery:  { id: 'recovery',  name: 'Recovery',    blurb: 'Under the branches and back into play.',             distance: 0.86, lateral: 1.15, longitudinal: 1.10, windExposure: 0.35, roll: 1.70, spin: 0.68, apex: 0.34, curve: 0,    attack: -2.0, grassRelief: 0.88, loftDelta: -10.0, skill: 'recovery' },
  putt:      { id: 'putt',      name: 'Putt',        blurb: 'Roll it.',                                           distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 0.00, roll: 1.00, spin: 0,    apex: 0,    curve: 0,    attack:  0.0, grassRelief: 0.00, loftDelta:  0.0 },
};

// ---------------------------------------------------------------------------
// Engine tuning
// ---------------------------------------------------------------------------

export const TUNING = {
  /** Driver carry in yards for a golfer with 50 distance and 50 ball speed. */
  driverCarryBase: 258,
  driverCarryPerDistance: 0.52,
  driverCarryPerSpeed: 0.22,

  /** Dispersion falls off this fast with skill above 50, and grows this fast below it. */
  sigmaDecayAbove: 0.0075,
  sigmaGrowthBelow: 0.0098,

  /** Fraction of shots drawn from the fat tail, at consistency 50. */
  tailBase: 0.075,
  tailPerConsistency: 0.055,
  tailScale: 2.4,

  /** Pressure: sigma grows by up to this fraction for a golfer with no composure. */
  pressureSigma: 0.30,
  pressureDistance: 0.02,

  /** Fatigue is deliberately mild — a tired golfer is a bit worse, not a different player. */
  fatigueSigma: 0.14,
  fatigueDistance: 0.028,
  /** Fatigue added per hole walked, before stamina. */
  fatiguePerHole: 1.05,
  fatigueRecoveryOvernight: 26,

  /** Wind: yards of drift per mph of crosswind on a 170-yard carry. */
  crosswindPerMph: 1.30,
  headwindPerMph: 1.05,
  tailwindPerMph: 0.72,
  /** Extra dispersion per mph of wind, before the golfer's wind rating. */
  windSigmaPerMph: 0.016,

  /** Elevation: yards of playing distance added per foot of climb. */
  yardsPerFootUp: 0.32,
  yardsPerFootDown: 0.27,

  /** Rain and cold. */
  rainDistanceLoss: 0.035,
  rainSigma: 0.10,
  coldDistanceLossPerDegree: 0.0016,
  coldReference: 70,
  heatDistanceGainPerDegree: 0.0010,

  /** Putting: 1σ of the lateral error in feet is max(floor, coef · L^exp). */
  puttSigmaFloor: 0.090,
  puttSigmaCoef: 0.0110,
  puttSigmaExp: 1.5,
  /** 1σ of distance control, as a fraction of putt length plus a constant, in feet. */
  puttDistanceCoef: 0.050,
  puttDistanceBase: 0.30,
  /** Effective capture width of the hole in feet (the hole is 0.354 ft across). */
  holeCapture: 0.210,
  /** How badly a misread costs you, as a fraction of the true break. */
  readErrorShare: 0.24,

  /** Green: how firm a green has to be before an approach bounces through it. */
  greenRollBase: 0.055,
  /**
   * Carry gained per thousand feet of altitude. Thin air both reduces drag and
   * costs the ball a little spin, and the usual working number on tour is about
   * two per cent a thousand — the reason a 7,000-yard course in Las Vegas plays
   * like 6,650 at sea level.
   */
  carryPerThousandFeet: 0.020,
} as const;

// ---------------------------------------------------------------------------
// Strike quality
// ---------------------------------------------------------------------------

/**
 * Smash factor: ball speed divided by club head speed, which is really a
 * measure of how close to the middle of the face the ball was struck.
 *
 * The important property is that it is **one-sided**. You cannot beat the centre
 * of the clubface, so every strike is the ceiling minus something, and the
 * distribution of carry that falls out is left-skewed: most shots cluster near
 * the golfer's full number and the misses are all short, occasionally very
 * short. That is what a bag of drives actually looks like — 290, 292, 287, 288,
 * 264 — and a symmetric normal never produces it.
 *
 * An off-centre strike also turns the ball, because the club twists about its
 * centre of gravity and the ball comes off with sidespin. So the same miss that
 * costs distance costs direction, which is why a thin one out of the toe is bad
 * twice.
 */
export const SMASH = {
  /** Best smash factor available with each club family. */
  ceiling: {
    driver: 1.50, wood: 1.48, longIron: 1.42, midIron: 1.38, shortIron: 1.33, wedge: 1.24, putter: 1,
  } as Record<ClubFamily, number>,
  /** 1σ of the shortfall from that ceiling, for a reference golfer. */
  lossSigma: {
    driver: 0.0420, wood: 0.0385, longIron: 0.0335, midIron: 0.0290, shortIron: 0.0240, wedge: 0.0190, putter: 0,
  } as Record<ClubFamily, number>,
  /** Carry responds to smash a little more than proportionally. */
  carryExponent: 1.25,
  /** Strike quality tightens this fast above a rating of 72, and loosens this fast below. */
  skillDecayAbove: 0.0135,
  skillGrowthBelow: 0.0165,
  /** Yards of sideways push per 0.01 of smash lost, per 100 yards of carry. */
  gearEffect: 0.95,
  /** Below this fraction of the ceiling, a strike is bad enough to be called one. */
  mishitFloor: 0.955,
  /** How much of the old symmetric carry error survives alongside the smash model. */
  residualShare: 0.84,
} as const;

// ---------------------------------------------------------------------------
// Putting
// ---------------------------------------------------------------------------

export type PuttIntentId = 'safe' | 'lag' | 'attack';

export interface PuttIntentProfile {
  id: PuttIntentId;
  name: string;
  verb: string;
  blurb: string;
  /**
   * How far past the hole the golfer is trying to carry the ball, in feet, as
   * a constant plus a share of the putt's length. This is the whole difference
   * between the intents: a ball dying at the hole cannot fall in as often, and
   * a ball hit to go four feet by does not stop next to it when it misses.
   */
  holdBase: number;
  holdPerFoot: number;
  /** Multiplier on speed-control error. Lagging is a speed-control exercise. */
  speedSigma: number;
  /** Multiplier on start-line error. A firmer stroke is a slightly looser one. */
  lineSigma: number;
  /** How much of the golfer's lag-putting rating applies to speed control. */
  lagShare: number;
  /** A firm putt takes less of the break, so a misread costs less sideways. */
  breakExposure: number;
}

/**
 * The two strategies the player chooses between, plus a third for the putts
 * where the only sane goal is two of them.
 */
export const PUTT_INTENTS: Record<PuttIntentId, PuttIntentProfile> = {
  safe: {
    id: 'safe', name: 'Safe lag', verb: 'dies it up',
    blurb: 'Forget the hole. Get it inside three feet and walk off with two putts.',
    holdBase: 0.25, holdPerFoot: 0.004, speedSigma: 0.74, lineSigma: 0.96, lagShare: 0.55, breakExposure: 1.18,
  },
  lag: {
    id: 'lag', name: 'Lag putt', verb: 'lags it',
    blurb: 'Roll it at the hole with the pace to stop beside it. Takes the easy two.',
    holdBase: 0.75, holdPerFoot: 0.012, speedSigma: 0.86, lineSigma: 1.00, lagShare: 0.40, breakExposure: 1.08,
  },
  attack: {
    id: 'attack', name: 'Go for it', verb: 'goes at it',
    blurb: 'Firm enough to take the break out of it. Holes more, and misses further.',
    holdBase: 1.85, holdPerFoot: 0.030, speedSigma: 1.14, lineSigma: 1.03, lagShare: 0.12, breakExposure: 0.68,
  },
};

/**
 * Everything about how a putt behaves.
 *
 * `makeCurve` is the one table to change if putting feels wrong. It is the make
 * probability for a reference tour putter — rating 72, an average-paced green,
 * a modest break, a normal stroke — and the engine works backwards from it to
 * the start-line error that would produce it. Skill, speed, slope, break,
 * pressure and the chosen strategy then move that dispersion, and the make
 * probability falls back out of it rather than being multiplied.
 */
export const PUTTING = {
  /** [distance in feet, make probability for the reference putter]. */
  makeCurve: [
    [1, 0.995], [2, 0.975], [3, 0.930], [4, 0.850], [5, 0.750], [6, 0.640],
    [7, 0.540], [8, 0.450], [9, 0.405], [10, 0.370], [12, 0.280], [15, 0.175],
    [18, 0.135], [20, 0.115], [25, 0.075], [30, 0.045], [35, 0.031],
    [40, 0.022], [50, 0.012], [60, 0.008], [80, 0.004], [110, 0.002],
  ] as [number, number][],
  /** The rating the curve describes. */
  referenceRating: 72,
  /** Start-line error falls off this fast above the reference rating, and grows this fast below it. */
  sigmaDecayAbove: 0.0072,
  sigmaGrowthBelow: 0.0075,
  /**
   * Speed control spreads much harder than the line does, and it is meant to.
   * Beyond about twenty feet nobody holes many putts whatever their stroke, so
   * the difference between a good putter and a poor one at range is not how many
   * drop — it is whether the next one is two feet or six. Tie that to the same
   * gentle curve as the line and a player with no touch is barely punished,
   * which lets an elite ball-striker with a poor putter lead the scoring average.
   */
  speedDecayAbove: 0.0130,
  speedGrowthBelow: 0.0145,
  /**
   * How far that growth is allowed to run. Tour golf has no truly bad putters in
   * it — the worst stroke on the money list still three-putts under once a round
   * — so the penalty for a poor rating saturates rather than compounding. Without
   * a ceiling a player rated in the forties putts like an amateur and gives away
   * four strokes a round, which no professional does.
   */
  sigmaCeiling: 1.12,
  speedCeiling: 1.20,

  /** Effective capture width of a 4.25-inch hole, in feet, at the best pace. */
  holeCapture: 0.210,
  /**
   * Pace, in feet past the hole, that holes the most putts. A ball dying at the
   * hole wobbles off at the last roll and any misjudgement leaves it short; a
   * ball travelling fast has less of the hole to fall into. Somewhere around a
   * foot and a half past is the optimum, which is why "never up, never in" and
   * "you'll never make it from there" are both true.
   */
  paceOptimum: 1.4,
  /** How fast the capture width opens up below the optimum. */
  paceRiseExponent: 0.45,
  /** How much capture is lost between the optimum and the ceiling. */
  paceCaptureLoss: 0.42,
  /** Past this much pace, the ball is going too fast to drop however good the line. */
  paceCeiling: 5.5,

  /**
   * Long putts are not missed because tour players cannot aim; they are missed
   * because over forty feet of grass something always intervenes — a spike
   * mark, a grain change, a foot of break misjudged three feet from the hole.
   * This is that, lumped: the chance a putt that deserved to drop does not.
   * Without it, working backwards from the make curve gives a forty-footer six
   * feet of sideways error, which is not a thing that happens.
   */
  deflectionOnset: 6,
  deflectionLength: 30,

  /** 1σ of speed control, in feet: a constant plus a share of the putt's length. */
  speedSigmaBase: 0.30,
  speedSigmaPerFoot: 0.050,

  /** Break, in feet: this × side slope in percent × length^exponent × (stimp / 11). */
  breakCoefficient: 0.0075,
  breakExponent: 1.6,
  /** A downhill putt is struck softer and takes more of the slope. */
  breakPerDownhillPercent: 0.06,

  /** Side slope the reference make curve already allows for, in percent. */
  referenceSideSlope: 1.2,
  /** Feet of extra start-line error per foot of break a golfer cannot read. */
  readSensitivity: 0.30,
  /** Share of the break a golfer systematically under-reads, before green reading. */
  underReadShare: 0.22,

  /** How much an uphill putt plays longer, in feet per foot of rise. */
  uphillPlaysLike: 7,
  /** Extra speed-control error per percent of downhill and uphill grade. */
  speedSigmaPerDownhill: 0.085,
  speedSigmaPerUphill: 0.030,
  /** Extra speed-control error per stimp above 11. */
  speedSigmaPerStimp: 0.055,

  /** Pressure inflates both errors by up to this much for a golfer with no nerve. */
  pressureSigma: 0.26,

  /** Distance bands used by the statistics, in feet. */
  statBands: [3, 6, 10, 20, 30] as number[],
} as const;
