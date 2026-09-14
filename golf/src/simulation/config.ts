/**
 * Every tunable number in the game lives here.
 *
 * The shot engine reads these tables rather than embedding constants, so the
 * feel of the game — how much the rough costs you, how wide a driver goes, how
 * much pressure bites — can be retuned in one file.
 */

import type { ClubDefinition, ClubId, LieProfile, LieType } from './types';

// ---------------------------------------------------------------------------
// The bag
// ---------------------------------------------------------------------------

export const CLUBS: readonly ClubDefinition[] = [
  { id: 'D',  name: 'Driver',        short: 'Dr',  family: 'driver',     carryRatio: 1.000, rollRatio: 0.060, baseLongSigma: 10.0, baseLatSigma: 24.3, apex: 105, spin: 2500, descent: 38, accuracySkill: 'driverAccuracy' },
  { id: '3W', name: '3 Wood',        short: '3W',  family: 'wood',       carryRatio: 0.895, rollRatio: 0.053, baseLongSigma: 9.2, baseLatSigma: 21.0, apex: 100, spin: 3200, descent: 41, accuracySkill: 'driverAccuracy' },
  { id: '5W', name: '5 Wood',        short: '5W',  family: 'wood',       carryRatio: 0.845, rollRatio: 0.047, baseLongSigma: 8.6, baseLatSigma: 19.2, apex: 102, spin: 3700, descent: 43, accuracySkill: 'longIron' },
  { id: '3i', name: '3 Iron',        short: '3i',  family: 'longIron',   carryRatio: 0.775, rollRatio: 0.036, baseLongSigma: 8.2, baseLatSigma: 17.0, apex: 95,  spin: 4100, descent: 44, accuracySkill: 'longIron' },
  { id: '4i', name: '4 Iron',        short: '4i',  family: 'longIron',   carryRatio: 0.735, rollRatio: 0.032, baseLongSigma: 7.6, baseLatSigma: 15.6, apex: 97,  spin: 4500, descent: 45, accuracySkill: 'longIron' },
  { id: '5i', name: '5 Iron',        short: '5i',  family: 'longIron',   carryRatio: 0.695, rollRatio: 0.029, baseLongSigma: 7.3, baseLatSigma: 14.3, apex: 99,  spin: 5000, descent: 46, accuracySkill: 'longIron' },
  { id: '6i', name: '6 Iron',        short: '6i',  family: 'midIron',    carryRatio: 0.655, rollRatio: 0.025, baseLongSigma: 6.7, baseLatSigma: 12.9,  apex: 101, spin: 5600, descent: 47, accuracySkill: 'midIron' },
  { id: '7i', name: '7 Iron',        short: '7i',  family: 'midIron',    carryRatio: 0.615, rollRatio: 0.022, baseLongSigma: 6.3, baseLatSigma: 11.6,  apex: 103, spin: 6300, descent: 48, accuracySkill: 'midIron' },
  { id: '8i', name: '8 Iron',        short: '8i',  family: 'shortIron',  carryRatio: 0.570, rollRatio: 0.017, baseLongSigma: 5.8, baseLatSigma: 10.2,  apex: 104, spin: 7000, descent: 49, accuracySkill: 'shortIron' },
  { id: '9i', name: '9 Iron',        short: '9i',  family: 'shortIron',  carryRatio: 0.525, rollRatio: 0.014, baseLongSigma: 5.4, baseLatSigma: 9.2,  apex: 105, spin: 7800, descent: 50, accuracySkill: 'shortIron' },
  { id: 'PW', name: 'Pitching Wedge',short: 'PW',  family: 'shortIron',  carryRatio: 0.480, rollRatio: 0.010, baseLongSigma: 4.8, baseLatSigma: 8.1,  apex: 104, spin: 8600, descent: 51, accuracySkill: 'shortIron' },
  { id: 'GW', name: 'Gap Wedge',     short: 'GW',  family: 'wedge',      carryRatio: 0.425, rollRatio: 0.007, baseLongSigma: 4.5, baseLatSigma: 6.9,  apex: 100, spin: 9300, descent: 52, accuracySkill: 'wedgeAccuracy' },
  { id: 'SW', name: 'Sand Wedge',    short: 'SW',  family: 'wedge',      carryRatio: 0.365, rollRatio: 0.005, baseLongSigma: 3.9, baseLatSigma: 6.0,  apex: 96,  spin: 9800, descent: 54, accuracySkill: 'wedgeAccuracy' },
  { id: 'LW', name: 'Lob Wedge',     short: 'LW',  family: 'wedge',      carryRatio: 0.300, rollRatio: 0.003, baseLongSigma: 3.5, baseLatSigma: 5.1,  apex: 90,  spin: 10400, descent: 57, accuracySkill: 'wedgeAccuracy' },
  { id: 'P',  name: 'Putter',        short: 'Pt',  family: 'putter',     carryRatio: 0.0,   rollRatio: 0,     baseLongSigma: 0,   baseLatSigma: 0,    apex: 0,   spin: 0,    descent: 0,  accuracySkill: 'putting' },
];

export const CLUB_BY_ID: Record<ClubId, ClubDefinition> = Object.fromEntries(
  CLUBS.map((club) => [club.id, club]),
) as Record<ClubId, ClubDefinition>;

/** Everything except the putter, longest first. */
export const SWING_CLUBS: readonly ClubDefinition[] = CLUBS.filter((c) => c.id !== 'P');

// ---------------------------------------------------------------------------
// Lies
// ---------------------------------------------------------------------------

export const LIES: Record<LieType, LieProfile> = {
  tee: {
    id: 'tee', name: 'Teeing Ground', short: 'Tee',
    distance: 1.02, accuracy: 0.96, distanceControl: 0.95, rollAfter: 1, spin: 1,
    mishit: 0.010, maxCarryRatio: 1, directionalBias: 0,
    note: 'Perched on a peg. As good as it gets.',
  },
  fairway: {
    id: 'fairway', name: 'Fairway', short: 'Fwy',
    distance: 1.00, accuracy: 1.00, distanceControl: 1.00, rollAfter: 1, spin: 1,
    mishit: 0.016, maxCarryRatio: 1, directionalBias: 0,
    note: 'Clean lie. Full control of flight and spin.',
  },
  firstCut: {
    id: 'firstCut', name: 'First Cut', short: '1st',
    distance: 0.98, accuracy: 1.05, distanceControl: 1.06, rollAfter: 1.05, spin: 0.92,
    mishit: 0.022, maxCarryRatio: 1, directionalBias: 0,
    note: 'Barely off line. Slightly less spin than a fairway lie.',
  },
  lightRough: {
    id: 'lightRough', name: 'Light Rough', short: 'Lt Rgh',
    distance: 0.95, accuracy: 1.10, distanceControl: 1.16, rollAfter: 1.15, spin: 0.78,
    mishit: 0.035, maxCarryRatio: 1, directionalBias: 0,
    skill: 'difficultLies',
    note: 'Sitting up. Flyers are possible — the ball comes out hot.',
  },
  heavyRough: {
    id: 'heavyRough', name: 'Heavy Rough', short: 'Hvy Rgh',
    distance: 0.90, accuracy: 1.25, distanceControl: 1.35, rollAfter: 1.05, spin: 0.55,
    mishit: 0.075, maxCarryRatio: 0.90, directionalBias: 1.1,
    skill: 'difficultLies',
    note: 'Grass will grab the hosel. Advancing it is the goal.',
  },
  deepRough: {
    id: 'deepRough', name: 'Deep Grass', short: 'Deep',
    distance: 0.85, accuracy: 1.40, distanceControl: 1.55, rollAfter: 0.95, spin: 0.40,
    mishit: 0.130, maxCarryRatio: 0.74, directionalBias: 2.2,
    skill: 'difficultLies',
    note: 'Buried. Wedge it back to grass and take your medicine.',
  },
  fairwayBunker: {
    id: 'fairwayBunker', name: 'Fairway Bunker', short: 'Fwy Bkr',
    distance: 0.88, accuracy: 1.30, distanceControl: 1.30, rollAfter: 1.0, spin: 0.70,
    mishit: 0.090, maxCarryRatio: 0.82, directionalBias: 0.6,
    skill: 'bunkerPlay',
    note: 'Clean it off the sand or you lose thirty yards.',
  },
  greensideBunker: {
    id: 'greensideBunker', name: 'Greenside Bunker', short: 'Bunker',
    distance: 0.55, accuracy: 1.45, distanceControl: 1.50, rollAfter: 0.55, spin: 0.85,
    mishit: 0.070, maxCarryRatio: 0.44, directionalBias: 0,
    skill: 'bunkerPlay',
    note: 'Splash it out on a cushion of sand.',
  },
  pineStraw: {
    id: 'pineStraw', name: 'Pine Straw', short: 'Straw',
    distance: 0.96, accuracy: 1.22, distanceControl: 1.20, rollAfter: 1.20, spin: 0.62,
    mishit: 0.060, maxCarryRatio: 0.95, directionalBias: 2.6,
    skill: 'difficultLies',
    note: 'The ball can skid off the straw — the club wants to slide under it.',
  },
  waste: {
    id: 'waste', name: 'Desert Waste', short: 'Waste',
    distance: 0.92, accuracy: 1.32, distanceControl: 1.28, rollAfter: 1.25, spin: 0.65,
    mishit: 0.085, maxCarryRatio: 0.88, directionalBias: 1.4,
    skill: 'difficultLies',
    note: 'Hardpan, gravel and scrub. Playable, but nothing is guaranteed.',
  },
  recovery: {
    id: 'recovery', name: 'Recovery Lie', short: 'Trees',
    distance: 0.78, accuracy: 1.60, distanceControl: 1.45, rollAfter: 1.10, spin: 0.55,
    mishit: 0.150, maxCarryRatio: 0.68, directionalBias: 1.8,
    skill: 'recovery',
    note: 'Trees in the way. Find a gap, keep it low, get back in play.',
  },
  fringe: {
    id: 'fringe', name: 'Fringe', short: 'Fringe',
    distance: 0.97, accuracy: 1.03, distanceControl: 1.04, rollAfter: 1.0, spin: 0.90,
    mishit: 0.018, maxCarryRatio: 1, directionalBias: 0,
    skill: 'chipping',
    note: 'Collar of the green. Putt it or bump it.',
  },
  green: {
    id: 'green', name: 'Green', short: 'Green',
    distance: 1.00, accuracy: 1.00, distanceControl: 1.00, rollAfter: 1.0, spin: 1,
    mishit: 0.0, maxCarryRatio: 1, directionalBias: 0,
    skill: 'putting',
    note: 'On the dance floor.',
  },
  water: {
    id: 'water', name: 'Water Hazard', short: 'Water',
    distance: 0, accuracy: 1, distanceControl: 1, rollAfter: 0, spin: 1,
    mishit: 0, maxCarryRatio: 0, directionalBias: 0,
    note: 'One penalty stroke and a drop.',
  },
  ob: {
    id: 'ob', name: 'Out of Bounds', short: 'O.B.',
    distance: 0, accuracy: 1, distanceControl: 1, rollAfter: 0, spin: 1,
    mishit: 0, maxCarryRatio: 0, directionalBias: 0,
    note: 'Stroke and distance. Reload.',
  },
};

/**
 * How far the ball runs once it lands *on* each surface, relative to a fairway.
 * Distinct from `rollAfter`, which is about playing a shot *from* a lie.
 */
export const LANDING_ROLL: Record<LieType, number> = {
  tee: 1, fairway: 1, firstCut: 0.86, lightRough: 0.52, heavyRough: 0.30,
  deepRough: 0.17, fairwayBunker: 0.06, greensideBunker: 0.05, pineStraw: 1.15,
  waste: 1.12, recovery: 0.38, fringe: 0.82, green: 1, water: 0, ob: 0.8,
};

export const PLAYABLE_LIES: readonly LieType[] = [
  'tee', 'fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough',
  'fairwayBunker', 'greensideBunker', 'pineStraw', 'waste', 'recovery', 'fringe', 'green',
];

// ---------------------------------------------------------------------------
// Shot types
// ---------------------------------------------------------------------------

export type ShotTypeId = 'full' | 'punch' | 'high' | 'draw' | 'fade' | 'chip' | 'pitch' | 'flop' | 'explosion' | 'putt';

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
}

export const SHOT_TYPES: Record<ShotTypeId, ShotTypeProfile> = {
  full:      { id: 'full',      name: 'Standard',    blurb: 'Normal flight and normal spin.',                    distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 1.00, roll: 1.00, spin: 1.00, apex: 1.00, curve: 0 },
  punch:     { id: 'punch',     name: 'Punch',       blurb: 'Low and boring. Beats the wind, runs on landing.',   distance: 0.93, lateral: 0.90, longitudinal: 1.06, windExposure: 0.55, roll: 1.55, spin: 0.72, apex: 0.58, curve: 0 },
  high:      { id: 'high',      name: 'High',        blurb: 'Extra height to land soft. The wind gets a vote.',   distance: 0.96, lateral: 1.08, longitudinal: 1.10, windExposure: 1.40, roll: 0.45, spin: 1.18, apex: 1.35, curve: 0 },
  draw:      { id: 'draw',      name: 'Draw',        blurb: 'Curves right-to-left. Works a corner or a pin.',     distance: 1.01, lateral: 1.10, longitudinal: 1.04, windExposure: 1.00, roll: 1.10, spin: 0.95, apex: 0.95, curve: -3.4 },
  fade:      { id: 'fade',      name: 'Fade',        blurb: 'Curves left-to-right and lands softer.',             distance: 0.98, lateral: 1.10, longitudinal: 1.04, windExposure: 1.05, roll: 0.90, spin: 1.06, apex: 1.05, curve: 3.4 },
  chip:      { id: 'chip',      name: 'Chip',        blurb: 'Low runner from around the green.',                  distance: 1.00, lateral: 0.80, longitudinal: 0.82, windExposure: 0.20, roll: 2.30, spin: 0.70, apex: 0.25, curve: 0, skill: 'chipping' },
  pitch:     { id: 'pitch',     name: 'Pitch',       blurb: 'Carry most of the way, one hop and stop.',           distance: 1.00, lateral: 0.86, longitudinal: 0.90, windExposure: 0.45, roll: 0.70, spin: 1.10, apex: 0.85, curve: 0, skill: 'pitching' },
  flop:      { id: 'flop',      name: 'Flop',        blurb: 'Straight up, lands dead. High risk, high reward.',   distance: 1.00, lateral: 1.05, longitudinal: 1.35, windExposure: 0.70, roll: 0.18, spin: 1.25, apex: 1.60, curve: 0, skill: 'pitching' },
  explosion: { id: 'explosion', name: 'Splash',      blurb: 'Sand first, ball out on a cushion.',                 distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 0.40, roll: 0.35, spin: 1.00, apex: 1.10, curve: 0, skill: 'bunkerPlay' },
  putt:      { id: 'putt',      name: 'Putt',        blurb: 'Roll it.',                                           distance: 1.00, lateral: 1.00, longitudinal: 1.00, windExposure: 0.00, roll: 1.00, spin: 0,    apex: 0,    curve: 0 },
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
} as const;
