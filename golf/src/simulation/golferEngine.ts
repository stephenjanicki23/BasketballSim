/**
 * Golfers: archetypes, the numbers derived from their ratings, and how the day
 * they are having changes them.
 *
 * Nothing in here knows about a course or a shot. The shot engine asks this
 * module "how far does this player hit a 7 iron, and how straight" and gets an
 * answer that already accounts for form, weather, fatigue and confidence.
 */

import { type Rng, clamp, lerp } from './rng';
import { CLUB_BY_ID, CLUBS, TUNING } from './config';
import type {
  Archetype,
  ArchetypeId,
  ClubDefinition,
  ClubId,
  Golfer,
  PuttingStats,
  PuttingStyle,
  PuttingStyleId,
  RatingKey,
  Ratings,
  Weather,
} from './types';

// ---------------------------------------------------------------------------
// Rating groups — used by the radar chart, course fit and the players table
// ---------------------------------------------------------------------------

export const RATING_GROUPS: { id: string; name: string; keys: RatingKey[] }[] = [
  { id: 'driving',    name: 'Driving',    keys: ['driverDistance', 'driverAccuracy', 'launch', 'ballSpeed', 'drivingPressure'] },
  { id: 'approach',   name: 'Approach',   keys: ['longIron', 'midIron', 'shortIron', 'wedgeAccuracy', 'approachConsistency'] },
  { id: 'shortGame',  name: 'Short Game', keys: ['chipping', 'pitching', 'bunkerPlay', 'recovery'] },
  { id: 'putting',    name: 'Putting',    keys: ['putting', 'shortPutting', 'longPutting', 'lagPutting', 'greenReading', 'speedControl', 'puttingPressure'] },
  { id: 'mental',     name: 'Mental',     keys: ['composure', 'decisionMaking', 'courseManagement', 'clutch', 'consistency'] },
  { id: 'physical',   name: 'Physical',   keys: ['stamina', 'fatigueResistance'] },
  { id: 'conditions', name: 'Conditions', keys: ['wind', 'rain', 'coldWeather', 'hotWeather', 'difficultLies'] },
];

export const RATING_LABELS: Record<RatingKey, string> = {
  driverDistance: 'Driver Distance',
  driverAccuracy: 'Driver Accuracy',
  launch: 'Launch',
  ballSpeed: 'Ball Speed',
  drivingPressure: 'Driving Under Pressure',
  longIron: 'Long Iron',
  midIron: 'Mid Iron',
  shortIron: 'Short Iron',
  wedgeAccuracy: 'Wedge Accuracy',
  approachConsistency: 'Approach Consistency',
  chipping: 'Chipping',
  pitching: 'Pitching',
  bunkerPlay: 'Bunker Play',
  recovery: 'Recovery Shots',
  putting: 'Putting',
  shortPutting: 'Short Putting',
  longPutting: 'Long Putting',
  lagPutting: 'Lag Putting',
  greenReading: 'Green Reading',
  speedControl: 'Speed Control',
  puttingPressure: 'Putting Under Pressure',
  composure: 'Composure',
  decisionMaking: 'Decision Making',
  courseManagement: 'Course Management',
  clutch: 'Clutch',
  consistency: 'Consistency',
  stamina: 'Stamina',
  fatigueResistance: 'Fatigue Resistance',
  wind: 'Wind',
  rain: 'Rain',
  coldWeather: 'Cold Weather',
  hotWeather: 'Hot Weather',
  difficultLies: 'Difficult Lies',
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  power: {
    id: 'power', name: 'Power Player',
    blurb: 'Overpowers a golf course. Will find trouble, and does not much care.',
    bias: { driverDistance: 22, ballSpeed: 20, launch: 10, driverAccuracy: -14, courseManagement: -10, decisionMaking: -7, wedgeAccuracy: -4, stamina: 4 },
  },
  bomber: {
    id: 'bomber', name: 'Bomber',
    blurb: 'Length nobody can match, and a short game that has to bail him out.',
    bias: { driverDistance: 26, ballSpeed: 24, launch: 12, driverAccuracy: -18, longIron: 6, chipping: -8, putting: -6, difficultLies: 6 },
  },
  precision: {
    id: 'precision', name: 'Precision Player',
    blurb: 'Gives up thirty yards and takes it back by never leaving the fairway.',
    bias: { driverDistance: -16, ballSpeed: -14, driverAccuracy: 22, wedgeAccuracy: 12, approachConsistency: 12, courseManagement: 10, consistency: 8 },
  },
  ballStriker: {
    id: 'ballStriker', name: 'Ball Striker',
    blurb: 'Hits it flush all day and leaves the strokes on the green.',
    bias: { longIron: 18, midIron: 18, shortIron: 14, approachConsistency: 14, putting: -12, longPutting: -10, shortPutting: -8, greenReading: -8, speedControl: -9 },
  },
  shortGame: {
    id: 'shortGame', name: 'Short Game Wizard',
    blurb: 'Average off the tee, magic from forty yards and in.',
    bias: { chipping: 20, pitching: 20, bunkerPlay: 18, recovery: 16, driverDistance: -6, longIron: -8, difficultLies: 10 },
  },
  elitePutter: {
    id: 'elitePutter', name: 'Elite Putter',
    blurb: 'Can gain six strokes on the greens and merely survive everywhere else.',
    bias: { putting: 22, longPutting: 16, shortPutting: 20, lagPutting: 14, greenReading: 16, speedControl: 15, puttingPressure: 14, longIron: -8, driverAccuracy: -5, approachConsistency: -6 },
  },
  windSpecialist: {
    id: 'windSpecialist', name: 'Wind Specialist',
    blurb: 'Flights the ball under the weather. Loves an ugly forecast.',
    bias: { wind: 26, rain: 14, coldWeather: 12, launch: -12, driverDistance: -4, midIron: 8, composure: 6 },
  },
  courseManager: {
    id: 'courseManager', name: 'Course Manager',
    blurb: 'Never makes the wrong decision, never makes a double.',
    bias: { courseManagement: 22, decisionMaking: 20, composure: 12, consistency: 12, driverDistance: -8, clutch: -4 },
  },
  volatile: {
    id: 'volatile', name: 'Volatile Superstar',
    blurb: 'Shoots 62 on Thursday and 78 on Friday, sometimes at the same event.',
    bias: { driverDistance: 12, putting: 10, clutch: 12, consistency: -24, composure: -14, courseManagement: -12, decisionMaking: -10 },
  },
  veteran: {
    id: 'veteran', name: 'Veteran',
    blurb: 'The body is going. The head and the hands are not.',
    bias: { composure: 18, courseManagement: 18, decisionMaking: 14, chipping: 10, putting: 6, greenReading: 12, lagPutting: 8, driverDistance: -14, ballSpeed: -14, stamina: -16, fatigueResistance: -12 },
  },
  prospect: {
    id: 'prospect', name: 'Young Prospect',
    blurb: 'Enormous ceiling, no idea yet how to get out of his own way.',
    bias: { driverDistance: 12, ballSpeed: 12, stamina: 12, fatigueResistance: 10, composure: -16, courseManagement: -18, decisionMaking: -14, consistency: -14 },
  },
  allRounder: {
    id: 'allRounder', name: 'Complete Player',
    blurb: 'No weakness to attack. Wins on every kind of course.',
    bias: { driverAccuracy: 4, midIron: 4, putting: 4, composure: 6, consistency: 8 },
  },
  grinder: {
    id: 'grinder', name: 'Grinder',
    blurb: 'Nothing pretty, nothing wasted. Makes every cut.',
    bias: { consistency: 16, composure: 14, stamina: 14, fatigueResistance: 14, courseManagement: 10, driverDistance: -8, clutch: -8, launch: -4 },
  },
  scrambler: {
    id: 'scrambler', name: 'Scrambler',
    blurb: 'Misses greens and gets away with it, over and over.',
    bias: { recovery: 20, chipping: 16, bunkerPlay: 14, difficultLies: 16, approachConsistency: -12, driverAccuracy: -10 },
  },
};

/**
 * Putting personalities.
 *
 * These are not a separate system bolted on beside the ratings — a style biases
 * the ratings it describes, so "The Technician" really does have better speed
 * control and the engine needs to know nothing else about him. The one thing a
 * style adds on top is a standing preference in the strategic choice: given two
 * options that grade out nearly level, the aggressor takes on the putt.
 */
export const PUTTING_STYLES: Record<PuttingStyleId, PuttingStyle> = {
  aggressor: {
    id: 'aggressor', name: 'The Aggressor',
    blurb: 'Takes on putts other players lag. Holes more of them, and three-putts more too.',
    bias: { putting: 4, shortPutting: 6, lagPutting: -10, speedControl: -6 },
    aggression: 0.30,
    streak: 1.1,
  },
  technician: {
    id: 'technician', name: 'The Technician',
    blurb: 'Speed control to a foot. Everything finishes where he meant it to.',
    bias: { speedControl: 14, lagPutting: 8, putting: 3 },
    aggression: 0.02,
    streak: 0.82,
  },
  conservative: {
    id: 'conservative', name: 'The Conservative',
    blurb: 'Almost never three-putts, and almost never holes one from distance either.',
    bias: { lagPutting: 15, speedControl: 9, longPutting: -6, shortPutting: 2 },
    aggression: -0.28,
    streak: 0.88,
  },
  clutch: {
    id: 'clutch', name: 'The Clutch Putter',
    blurb: 'The stroke does not change when it matters. Sometimes it gets better.',
    bias: { puttingPressure: 16, shortPutting: 6, greenReading: 3 },
    aggression: 0.12,
    streak: 0.95,
  },
  streaky: {
    id: 'streaky', name: 'The Streaky Putter',
    blurb: 'Holes everything for two days and nothing for two more.',
    bias: { putting: 6, speedControl: -7, puttingPressure: -5 },
    aggression: 0.15,
    streak: 1.75,
  },
  poorReader: {
    id: 'poorReader', name: 'The Poor Green Reader',
    blurb: 'A good stroke on the wrong line. Severe greens undo him.',
    bias: { greenReading: -17, putting: 3, speedControl: 4 },
    aggression: -0.05,
    streak: 1.05,
  },
  steady: {
    id: 'steady', name: 'Orthodox',
    blurb: 'No particular tendency. Reads it, hits it, moves on.',
    bias: {},
    aggression: 0,
    streak: 1,
  },
};

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

const ABILITY_WEIGHTS: Partial<Record<RatingKey, number>> = {
  driverDistance: 1.1, driverAccuracy: 1.2, ballSpeed: 0.5, launch: 0.25, drivingPressure: 0.5,
  longIron: 1.0, midIron: 1.3, shortIron: 1.3, wedgeAccuracy: 1.0, approachConsistency: 1.2,
  chipping: 0.9, pitching: 0.8, bunkerPlay: 0.6, recovery: 0.6,
  putting: 1.3, shortPutting: 0.9, longPutting: 0.6, lagPutting: 0.6, greenReading: 0.6,
  speedControl: 0.7, puttingPressure: 0.6,
  composure: 0.8, decisionMaking: 0.7, courseManagement: 0.9, clutch: 0.4, consistency: 1.1,
  stamina: 0.35, fatigueResistance: 0.3,
  wind: 0.35, rain: 0.2, coldWeather: 0.15, hotWeather: 0.15, difficultLies: 0.4,
};

/** 1–100 summary of how good the golfer is, derived from the ratings themselves. */
export function currentAbility(golfer: Golfer): number {
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(ABILITY_WEIGHTS) as [RatingKey, number][]) {
    sum += golfer.ratings[key] * w;
    weight += w;
  }
  return clamp(Math.round(sum / weight), 1, 100);
}

/** Group averages, for the radar chart and the players table. */
export function groupScores(golfer: Golfer): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of RATING_GROUPS) {
    const total = group.keys.reduce((acc, key) => acc + golfer.ratings[key], 0);
    out[group.id] = Math.round(total / group.keys.length);
  }
  return out;
}

/**
 * A rating as it plays today: the base number nudged by form and confidence.
 * Form is a ±10 swing that moves week to week, so a golfer in good touch really
 * is a better player for a while — but only by a few rating points.
 */
export function effective(golfer: Golfer, key: RatingKey): number {
  const base = golfer.ratings[key];
  const form = golfer.hidden.form * 0.55;
  const belief = (golfer.hidden.confidence - 50) * 0.06;
  return clamp(base + form + belief, 1, 100);
}

/** How dispersion scales with a rating. 1.0 at 50, tighter above, looser below. */
export function sigmaFactor(rating: number): number {
  const delta = rating - 50;
  return delta >= 0
    ? Math.exp(-delta * TUNING.sigmaDecayAbove)
    : Math.exp(-delta * TUNING.sigmaGrowthBelow);
}

// ---------------------------------------------------------------------------
// The bag
// ---------------------------------------------------------------------------

export interface ClubYardage {
  club: ClubDefinition;
  /** Neutral-condition carry in yards. */
  carry: number;
  /** Neutral roll-out on a fairway of average firmness. */
  roll: number;
  total: number;
}

const bagCache = new WeakMap<Golfer, { key: string; bag: Record<ClubId, ClubYardage> }>();

/** Neutral driver carry, from distance and ball speed. */
export function driverCarry(golfer: Golfer): number {
  const distance = effective(golfer, 'driverDistance');
  const speed = effective(golfer, 'ballSpeed');
  return (
    TUNING.driverCarryBase +
    (distance - 50) * TUNING.driverCarryPerDistance +
    (speed - 50) * TUNING.driverCarryPerSpeed
  );
}

/**
 * Every golfer's yardages, scaled off their own driver carry. Strong iron
 * players squeeze a yard or two more out of the mid irons; nobody hits
 * identical numbers.
 */
export function bagFor(golfer: Golfer): Record<ClubId, ClubYardage> {
  const base = driverCarry(golfer);
  const key = `${base.toFixed(2)}:${golfer.ratings.longIron}:${golfer.ratings.midIron}:${golfer.ratings.shortIron}:${golfer.ratings.wedgeAccuracy}:${golfer.ratings.launch}`;
  const cached = bagCache.get(golfer);
  if (cached && cached.key === key) return cached.bag;

  const strikeBonus = (rating: number) => 1 + (rating - 50) * 0.0009;
  const bag = {} as Record<ClubId, ClubYardage>;
  for (const club of CLUBS) {
    if (club.id === 'P') {
      bag.P = { club, carry: 0, roll: 0, total: 0 };
      continue;
    }
    let strike = 1;
    if (club.family === 'longIron' || club.family === 'wood') strike = strikeBonus(golfer.ratings.longIron);
    else if (club.family === 'midIron') strike = strikeBonus(golfer.ratings.midIron);
    else if (club.family === 'shortIron') strike = strikeBonus(golfer.ratings.shortIron);
    else if (club.family === 'wedge') strike = strikeBonus(golfer.ratings.wedgeAccuracy);
    const carry = base * club.carryRatio * strike;
    // A high launch flies higher and lands steeper, so it runs out less.
    const launchRoll = 1 - (effective(golfer, 'launch') - 50) * 0.004;
    const roll = carry * club.rollRatio * launchRoll;
    bag[club.id] = { club, carry, roll, total: carry + roll };
  }
  bagCache.set(golfer, { key, bag });
  return bag;
}

/** The club whose neutral total is closest to a target distance. */
export function clubForDistance(golfer: Golfer, yards: number): ClubDefinition {
  const bag = bagFor(golfer);
  let best = CLUB_BY_ID.LW;
  let bestError = Infinity;
  for (const club of CLUBS) {
    if (club.id === 'P') continue;
    const error = Math.abs(bag[club.id].total - yards);
    if (error < bestError) {
      bestError = error;
      best = club;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Conditions and state
// ---------------------------------------------------------------------------

export interface ConditionEffect {
  /** Multiplier on carry distance. */
  distance: number;
  /** Multiplier on both dispersion axes. */
  sigma: number;
}

/**
 * What today's weather does to this golfer. The ratings matter twice: a poor
 * wind player both loses more distance control and gets pushed around more.
 */
/** Carry multiplier for thin air. Flat ground at altitude is still altitude. */
export function altitudeFactor(feet: number): number {
  return 1 + (feet / 1000) * TUNING.carryPerThousandFeet;
}

export function weatherEffect(golfer: Golfer, weather: Weather): ConditionEffect {
  let distance = 1;
  let sigma = 1;

  // Cold air is dense and the ball does not compress; heat is the reverse.
  const temp = weather.temperature;
  if (temp < TUNING.coldReference) {
    const cold = TUNING.coldReference - temp;
    const skill = 1 - (effective(golfer, 'coldWeather') - 50) * 0.006;
    distance -= cold * TUNING.coldDistanceLossPerDegree * skill;
    sigma += cold * 0.0022 * skill;
  } else {
    const heat = temp - TUNING.coldReference;
    const skill = 1 - (effective(golfer, 'hotWeather') - 50) * 0.008;
    distance += heat * TUNING.heatDistanceGainPerDegree;
    // Heat is an endurance problem, not a ball-flight one.
    sigma += heat * 0.0020 * skill;
  }

  if (weather.rain > 0) {
    const skill = 1 - (effective(golfer, 'rain') - 50) * 0.008;
    distance -= weather.rain * TUNING.rainDistanceLoss * skill;
    sigma += weather.rain * TUNING.rainSigma * skill;
  }

  return { distance, sigma };
}

/** Fatigue as it actually bites, after stamina and fatigue resistance. */
export function effectiveFatigue(golfer: Golfer): number {
  const resistance = (effective(golfer, 'fatigueResistance') + effective(golfer, 'stamina')) / 2;
  return clamp(golfer.fatigue * (1 - (resistance - 50) * 0.006), 0, 100);
}

export function fatigueEffect(golfer: Golfer): ConditionEffect {
  const f = effectiveFatigue(golfer) / 100;
  return {
    distance: 1 - f * TUNING.fatigueDistance,
    sigma: 1 + f * TUNING.fatigueSigma,
  };
}

/** Heat and rain make walking harder; a long course wears you down faster. */
export function fatigueForHole(golfer: Golfer, weather: Weather, holeYards: number): number {
  const walk = TUNING.fatiguePerHole * (0.75 + holeYards / 1600);
  const heat = weather.temperature > 84 ? 1 + (weather.temperature - 84) * 0.018 : 1;
  const wet = 1 + weather.rain * 0.22;
  const stamina = 1 - (effective(golfer, 'stamina') - 50) * 0.007;
  return walk * heat * wet * Math.max(0.4, stamina);
}

/**
 * Pressure: 0 on a Thursday morning, 1 standing over a putt to win.
 * Composure and clutch decide whether that is fuel or poison.
 */
export function pressureEffect(golfer: Golfer, pressure: number, kind: 'drive' | 'approach' | 'putt' | 'short'): ConditionEffect {
  if (pressure <= 0) return { distance: 1, sigma: 1 };
  const specific =
    kind === 'drive' ? effective(golfer, 'drivingPressure')
    : kind === 'putt' ? effective(golfer, 'puttingPressure')
    : effective(golfer, 'composure');
  const nerve = (specific * 0.6 + effective(golfer, 'composure') * 0.25 + effective(golfer, 'clutch') * 0.15);
  // At nerve 50 a golfer takes the full hit; at 95 they barely notice; below 35
  // pressure actively makes them worse than their ratings.
  const exposure = clamp(1 - (nerve - 50) / 55, 0.08, 1.9);
  return {
    distance: 1 - pressure * exposure * TUNING.pressureDistance,
    sigma: 1 + pressure * exposure * TUNING.pressureSigma,
  };
}

/**
 * What a golfer has on a given day.
 *
 * Ratings describe a player's standard; they do not describe Thursday. Real
 * golfers turn up without their driver, or hole everything for one round and
 * nothing the next, and that day-to-day wobble is most of the reason a tour of
 * fifty players produces fifteen different winners rather than one. Consistent
 * players wobble less, which is exactly what the Consistency rating should mean.
 *
 * Values multiply dispersion, so above 1 is a bad day.
 */
export interface DailyTouch {
  driving: number;
  approach: number;
  short: number;
  putting: number;
}

export const NEUTRAL_TOUCH: DailyTouch = { driving: 1, approach: 1, short: 1, putting: 1 };

export function dailyTouch(golfer: Golfer, rng: Rng): DailyTouch {
  // Kept deliberately small through the bag. Dispersion costs strokes faster
  // than it saves them, so a large day-to-day wobble does not just add variance
  // — it pushes the whole field's scoring up, and punishes the already-wide
  // players twice.
  const spread = 0.055 + (100 - effective(golfer, 'consistency')) * 0.0010;
  const draw = (scale = 1) => Math.exp(rng.normal() * spread * scale);
  // Putting is the exception, and everyone who has played knows why: a player's
  // driving is roughly the same every week and their putter is not. It is by
  // some distance the streakiest part of tour golf, and if it is not modelled
  // that way the best putter in the field wins far too often.
  return { driving: draw(), approach: draw(), short: draw(), putting: draw(2.1) };
}

/** Fat-tail probability for this golfer: inconsistent players blow up more often. */
export function tailProbability(golfer: Golfer): number {
  const consistency = effective(golfer, 'consistency');
  return clamp(TUNING.tailBase + ((50 - consistency) / 50) * TUNING.tailPerConsistency, 0.030, 0.24);
}

/** Rounded display helper: 1–100 into a letter-ish band used by the UI. */
export function ratingBand(rating: number): 'elite' | 'strong' | 'good' | 'average' | 'weak' | 'poor' {
  if (rating >= 90) return 'elite';
  if (rating >= 80) return 'strong';
  if (rating >= 70) return 'good';
  if (rating >= 58) return 'average';
  if (rating >= 45) return 'weak';
  return 'poor';
}

/** Scoring average from the rolling counters. */
export function scoringAverage(golfer: Golfer): number {
  if (golfer.career.rounds === 0) return 0;
  return golfer.career.strokes / golfer.career.rounds;
}

export function formLabel(form: number): string {
  if (form >= 6) return 'Red hot';
  if (form >= 3) return 'In form';
  if (form >= 1) return 'Steady';
  if (form >= -1.5) return 'Level';
  if (form >= -4) return 'Off the boil';
  return 'Struggling';
}

export function blankRatings(value = 50): Ratings {
  const keys = Object.keys(RATING_LABELS) as RatingKey[];
  return Object.fromEntries(keys.map((k) => [k, value])) as Ratings;
}

export function emptyPuttingStats(): PuttingStats {
  return {
    onePutts: 0, twoPutts: 0, threePutts: 0, greensPutted: 0, firstPuttFeet: 0,
    madeByBand: [0, 0, 0, 0, 0, 0], attemptsByBand: [0, 0, 0, 0, 0, 0],
    lagAttempts: 0, lagLeaveFeet: 0, pressureAttempts: 0, pressureMade: 0, strokesGained: 0,
  };
}

export function addPuttingStats(into: PuttingStats, from: PuttingStats): void {
  into.onePutts += from.onePutts;
  into.twoPutts += from.twoPutts;
  into.threePutts += from.threePutts;
  into.greensPutted += from.greensPutted;
  into.firstPuttFeet += from.firstPuttFeet;
  into.lagAttempts += from.lagAttempts;
  into.lagLeaveFeet += from.lagLeaveFeet;
  into.pressureAttempts += from.pressureAttempts;
  into.pressureMade += from.pressureMade;
  into.strokesGained += from.strokesGained;
  for (let i = 0; i < into.madeByBand.length; i++) {
    into.madeByBand[i] += from.madeByBand[i];
    into.attemptsByBand[i] += from.attemptsByBand[i];
  }
}

export function emptyCareer(): Golfer['career'] {
  return {
    seasons: 0, events: 0, wins: 0, majors: 0, top10s: 0, cutsMade: 0, earnings: 0,
    rounds: 0, strokes: 0, parTotal: 0, drives: 0, driveDistanceTotal: 0,
    fairwaysHit: 0, fairwayAttempts: 0, greensHit: 0, greenAttempts: 0,
    scrambleSaves: 0, scrambleAttempts: 0, putts: 0, puttHoles: 0,
    birdies: 0, eagles: 0, pars: 0, bogeys: 0, doubles: 0, holes: 0, bestFinishRank: 0,
    putting: emptyPuttingStats(),
  };
}

export function emptySeason(): Golfer['season'] {
  return { points: 0, earnings: 0, events: 0, wins: 0, top10s: 0, cutsMade: 0, rounds: 0, strokes: 0, parTotal: 0 };
}

/** Blend two ratings, used by development and by course fit. */
export const mix = lerp;
