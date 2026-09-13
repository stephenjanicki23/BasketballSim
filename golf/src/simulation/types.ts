/** Shared domain types. Kept in one place so the engines never import each other in a circle. */

import type { Blob, Bounds, Vec2 } from './geometry';

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

export type ClubId =
  | 'D'
  | '3W'
  | '5W'
  | '3i'
  | '4i'
  | '5i'
  | '6i'
  | '7i'
  | '8i'
  | '9i'
  | 'PW'
  | 'GW'
  | 'SW'
  | 'LW'
  | 'P';

export type ClubFamily = 'driver' | 'wood' | 'longIron' | 'midIron' | 'shortIron' | 'wedge' | 'putter';

export interface ClubDefinition {
  id: ClubId;
  name: string;
  short: string;
  family: ClubFamily;
  /** Carry as a fraction of the golfer's driver carry. */
  carryRatio: number;
  /** Roll as a fraction of carry, on a neutral firm fairway. */
  rollRatio: number;
  /** 1σ carry error in yards for a rating-50 golfer. */
  baseLongSigma: number;
  /** 1σ lateral error in yards for a rating-50 golfer. */
  baseLatSigma: number;
  /** Apex height in feet at neutral launch — drives wind exposure and stopping power. */
  apex: number;
  /** Backspin in rpm at neutral strike — drives how the ball reacts on the green. */
  spin: number;
  /** Descent angle in degrees; steep clubs stop, shallow clubs run. */
  descent: number;
  /** Which rating governs the club's direction. */
  accuracySkill: RatingKey;
}

// ---------------------------------------------------------------------------
// Lies
// ---------------------------------------------------------------------------

export type LieType =
  | 'tee'
  | 'fairway'
  | 'firstCut'
  | 'lightRough'
  | 'heavyRough'
  | 'deepRough'
  | 'fairwayBunker'
  | 'greensideBunker'
  | 'pineStraw'
  | 'waste'
  | 'recovery'
  | 'fringe'
  | 'green'
  | 'water'
  | 'ob';

export interface LieProfile {
  id: LieType;
  name: string;
  short: string;
  /** Multiplier on carry distance. */
  distance: number;
  /** Multiplier on lateral dispersion — above 1 means a wider miss. */
  accuracy: number;
  /** Multiplier on carry dispersion. */
  distanceControl: number;
  /** Multiplier on how far the ball runs after landing from here (flyers, no spin). */
  rollAfter: number;
  /** Multiplier on backspin, so a rough lie can't stop the ball on a firm green. */
  spin: number;
  /** Chance of a genuinely poor strike before skill is applied. */
  mishit: number;
  /** Longest club that can realistically be used, by carry ratio; 1 means anything. */
  maxCarryRatio: number;
  /** Systematic push/pull in yards per 100 yards of shot, e.g. a ball above your feet. */
  directionalBias: number;
  /** Which rating helps most out of this lie. */
  skill?: RatingKey;
  /** Flavour text for the UI. */
  note: string;
}

// ---------------------------------------------------------------------------
// Golfers
// ---------------------------------------------------------------------------

export type RatingKey =
  // Driving
  | 'driverDistance'
  | 'driverAccuracy'
  | 'launch'
  | 'ballSpeed'
  | 'drivingPressure'
  // Approach
  | 'longIron'
  | 'midIron'
  | 'shortIron'
  | 'wedgeAccuracy'
  | 'approachConsistency'
  // Short game
  | 'chipping'
  | 'pitching'
  | 'bunkerPlay'
  | 'recovery'
  // Putting
  | 'putting'
  | 'longPutting'
  | 'shortPutting'
  | 'puttingPressure'
  // Mental
  | 'composure'
  | 'decisionMaking'
  | 'courseManagement'
  | 'clutch'
  | 'consistency'
  // Physical
  | 'stamina'
  | 'fatigueResistance'
  // Conditions
  | 'wind'
  | 'rain'
  | 'coldWeather'
  | 'hotWeather'
  | 'difficultLies';

export type Ratings = Record<RatingKey, number>;

export interface HiddenRatings {
  /** 1–100 summary of how good the golfer is right now. */
  currentAbility: number;
  /** Ceiling. Young players move toward it; nobody is guaranteed to arrive. */
  potential: number;
  /** −10..+10 swing on top of ability, moves week to week. */
  form: number;
  /** 1–100, nudged by results; feeds pressure handling. */
  confidence: number;
  /** 1–100 chance of picking up a niggle. */
  injuryRisk: number;
  /** 1–100 ability to handle an unfamiliar test. */
  adaptability: number;
}

export type ArchetypeId =
  | 'power'
  | 'precision'
  | 'ballStriker'
  | 'shortGame'
  | 'elitePutter'
  | 'windSpecialist'
  | 'courseManager'
  | 'volatile'
  | 'veteran'
  | 'prospect'
  | 'allRounder'
  | 'grinder'
  | 'scrambler'
  | 'bomber';

export interface Archetype {
  id: ArchetypeId;
  name: string;
  blurb: string;
  /** Rating offsets applied on top of the golfer's base level. */
  bias: Partial<Record<RatingKey, number>>;
}

export interface CareerStats {
  seasons: number;
  events: number;
  wins: number;
  majors: number;
  top10s: number;
  cutsMade: number;
  earnings: number;
  /** Rolling counters, from which every displayed average is derived. */
  rounds: number;
  strokes: number;
  parTotal: number;
  drives: number;
  driveDistanceTotal: number;
  fairwaysHit: number;
  fairwayAttempts: number;
  greensHit: number;
  greenAttempts: number;
  scrambleSaves: number;
  scrambleAttempts: number;
  putts: number;
  puttHoles: number;
  birdies: number;
  eagles: number;
  pars: number;
  bogeys: number;
  doubles: number;
  holes: number;
  bestFinishRank: number;
}

export interface SeasonRecord {
  season: number;
  events: number;
  wins: number;
  top10s: number;
  cutsMade: number;
  earnings: number;
  points: number;
  scoringAverage: number;
  rank: number;
}

export interface Golfer {
  id: string;
  name: string;
  country: string;
  flag: string;
  age: number;
  turnedPro: number;
  archetype: ArchetypeId;
  personality: string;
  playingStyle: string;
  preferredConditions: string;
  weakness: string;
  ratings: Ratings;
  hidden: HiddenRatings;
  career: CareerStats;
  /** Current-season counters; reset each January. */
  season: {
    points: number;
    earnings: number;
    events: number;
    wins: number;
    top10s: number;
    cutsMade: number;
    rounds: number;
    strokes: number;
    parTotal: number;
  };
  history: SeasonRecord[];
  /** Ranking points, decayed each event — the basis of the world ranking. */
  rankingPoints: number;
  worldRank: number;
  /** Finishing positions in the most recent events, newest first. */
  recentFinishes: number[];
  /** 0–100. Accumulates across a round, recovers overnight. */
  fatigue: number;
  injuredWeeks: number;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export type CourseStyleId = 'links' | 'desert' | 'parkland';

export interface BunkerSpec {
  /** Yards from the tee along the centreline. */
  along: number;
  /** Lateral offset in yards; positive is right of the line of play. */
  lateral: number;
  /** Radius in yards. */
  size: number;
  kind: 'fairway' | 'greenside';
  /** 1 is round; above 1 stretches along the line of play. */
  stretch?: number;
  /** Deep enough that you cannot advance it far. */
  deep?: boolean;
}

export interface WaterSpec {
  along: number;
  lateral: number;
  size: number;
  stretch?: number;
  /** A strip runs along the hole rather than sitting as a pond. */
  strip?: { from: number; to: number; side: -1 | 1; offset: number; width: number };
  label?: string;
}

export interface WasteSpec {
  from: number;
  to: number;
  side: -1 | 1;
  offset: number;
  width: number;
}

export interface HoleSpec {
  number: number;
  name: string;
  par: 3 | 4 | 5;
  yards: number;
  /** Compass bearing of the line of play, degrees, 0 = north. */
  bearing: number;
  /** Stroke index, 1 = hardest. */
  index: number;
  /** Lateral shift of the landing area in yards; negative doglegs left. */
  dogleg: number;
  /** Where along the hole the bend happens, 0..1. */
  doglegAt: number;
  /** Fairway half-width in yards at the landing zone. */
  fairwayWidth: number;
  /** Elevation in feet relative to the tee. */
  elevation: { landing: number; green: number };
  /** Green radius in yards. */
  greenSize: number;
  /** Pin position within the green: x is right, y is long, in yards. */
  pin: Vec2;
  /** Green surface tilt, percent; x positive falls to the right, y positive falls away. */
  greenSlope: Vec2;
  bunkers: BunkerSpec[];
  water: WaterSpec[];
  waste?: WasteSpec[];
  /** Density of trees along the corridor, 0..1. */
  trees: number;
  /** Strategic note shown to the player on the tee. */
  strategy: string;
}

export interface CourseStyle {
  id: CourseStyleId;
  /** Multiplier on roll-out — links and desert run, parkland does not. */
  firmness: number;
  /** Stimp. */
  greenSpeed: number;
  /** 0–100; how much a green holds an approach. */
  greenFirmness: number;
  /** Rough severity 0–1, scaling the rough band penalties. */
  roughSeverity: number;
  /** Width of the mown bands outside the fairway, in yards. */
  bands: { firstCut: number; lightRough: number; heavyRough: number; deepRough: number };
  /** Average wind speed in mph. */
  baseWind: number;
  /** Typical high temperature, °F. */
  baseTemp: number;
  /** Palette for the renderer. */
  palette: {
    fairway: string;
    firstCut: string;
    lightRough: string;
    heavyRough: string;
    deepRough: string;
    green: string;
    fringe: string;
    sand: string;
    water: string;
    waste: string;
    tree: string;
    treeDark: string;
    background: string;
    ob: string;
  };
  /** What lies outside the corridor. */
  surround: 'deepRough' | 'waste' | 'recovery';
  /** How wide that surround is before the ball is out of bounds, in yards. */
  surroundWidth: number;
}

export interface Course {
  id: string;
  name: string;
  location: string;
  style: CourseStyleId;
  par: number;
  yards: number;
  blurb: string;
  /** Free text shown on the course screen. */
  identity: string[];
  holes: HoleSpec[];
  /** 60–90ish scratch scoring difficulty, used for display and course fit. */
  difficulty: number;
  /** Weights used to score how well a golfer's game fits, 0..1 each. */
  fit: {
    distance: number;
    accuracy: number;
    rough: number;
    wind: number;
    greens: number;
    water: number;
    elevation: number;
    strategy: number;
    heat: number;
    rain: number;
  };
}

/** A hole with its geometry realised in yards. */
export interface HoleGeometry {
  spec: HoleSpec;
  course: Course;
  style: CourseStyle;
  tee: Vec2;
  greenCenter: Vec2;
  pin: Vec2;
  centerline: Vec2[];
  centerlineLength: number;
  /** Fairway half-width as a function of arc length. */
  fairwayHalfWidth: (along: number) => number;
  green: Blob;
  bunkers: { blob: Blob; kind: 'fairway' | 'greenside'; deep: boolean }[];
  water: { blob?: Blob; polygon?: Vec2[]; bounds: Bounds }[];
  waste: { polygon: Vec2[]; bounds: Bounds }[];
  trees: { position: Vec2; radius: number; shade: number }[];
  /** Elevation in feet, relative to the tee. */
  elevationAt: (p: Vec2) => number;
  bounds: Bounds;
  /** Outline of the mown corridor, for rendering. */
  bands: { fairway: Vec2[]; firstCut: Vec2[]; lightRough: Vec2[]; heavyRough: Vec2[]; deepRough: Vec2[] };
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type SkyId = 'clear' | 'cloudy' | 'windy' | 'rain' | 'heavyRain' | 'hot' | 'cold';

export interface Weather {
  sky: SkyId;
  label: string;
  /** Sustained wind, mph. */
  windSpeed: number;
  /** Compass direction the wind blows *from*, degrees. */
  windFrom: number;
  /** Extra mph available in a gust. */
  gust: number;
  temperature: number;
  /** 0–1. */
  rain: number;
  /** 0–1; a wet course is soft and slow. */
  softness: number;
  greenSpeed: number;
  greenFirmness: number;
  /** Multiplier on fairway roll-out. */
  firmness: number;
}

export interface Conditions {
  weather: Weather;
  /** Hole-by-hole gust offset so no two shots are identical. */
  gustPhase: number;
}
