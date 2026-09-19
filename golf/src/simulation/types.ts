/** Shared domain types. Kept in one place so the engines never import each other in a circle. */

import type { Bounds, Shape, Vec2 } from './geometry';

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
  | 'lagPutting'
  | 'greenReading'
  | 'speedControl'
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

/**
 * How a golfer putts, as distinct from how well. Style biases the ratings at
 * generation and biases the strategic choice at the hole — an aggressor takes
 * on putts a conservative player lags.
 */
export type PuttingStyleId =
  | 'aggressor'
  | 'technician'
  | 'conservative'
  | 'clutch'
  | 'streaky'
  | 'poorReader'
  | 'steady';

export interface PuttingStyle {
  id: PuttingStyleId;
  name: string;
  blurb: string;
  /** Rating offsets applied on top of the golfer's putting ratings. */
  bias: Partial<Record<RatingKey, number>>;
  /** Shifts the strategic choice: positive attacks more. */
  aggression: number;
  /** Multiplier on day-to-day putting variance. */
  streak: number;
}

export interface PuttingStats {
  onePutts: number;
  twoPutts: number;
  threePutts: number;
  /** Holes where the ball reached the green and was putted. */
  greensPutted: number;
  /** First-putt distance, in feet, summed. */
  firstPuttFeet: number;
  /** Made and attempted, by distance band: 0-3, 3-6, 6-10, 10-20, 20-30, 30+ ft. */
  madeByBand: number[];
  attemptsByBand: number[];
  /** Putts from beyond 25 feet, and how far they finished from the hole. */
  lagAttempts: number;
  lagLeaveFeet: number;
  /** Putts attempted and made with real pressure on. */
  pressureAttempts: number;
  pressureMade: number;
  /** Strokes gained on the greens against the baseline. */
  strokesGained: number;
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
  putting: PuttingStats;
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
  puttingStyle: PuttingStyleId;
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
    top25s: number;
    cutsMade: number;
    rounds: number;
    strokes: number;
    parTotal: number;
    birdies: number;
    eagles: number;
    /** Best finishing position this season, or 0 if no cut has been made. */
    bestFinish: number;
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

/**
 * An outline traced off an aerial image, in the hole's own frame: x is yards
 * right of the tee-to-green line, y is yards from the tee toward the green.
 * `traceHole` in /data/courses/trace.ts turns pixels into these.
 */
export type TracedShape = Vec2[];

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
  /** Traced outline. When present it is the bunker, and along/lateral/size are ignored. */
  shape?: TracedShape;
}

export interface WaterSpec {
  along: number;
  lateral: number;
  size: number;
  stretch?: number;
  /** A strip runs along the hole rather than sitting as a pond. */
  strip?: { from: number; to: number; side: -1 | 1; offset: number; width: number };
  label?: string;
  /** Traced outline. When present it is the hazard. */
  shape?: TracedShape;
}

export interface WasteSpec {
  from: number;
  to: number;
  side: -1 | 1;
  offset: number;
  width: number;
  /** Traced outline. When present it is the waste area. */
  shape?: TracedShape;
}

/**
 * One turn in the line of play. `shift` is how many yards the corridor moves
 * sideways (positive right), spread over a stretch of the hole centred on `at`
 * as a fraction of its length. `turn` is how abruptly: 0.06 is an elbow you have
 * to lay up short of, 0.30 a long bow you can follow with a driver. A list of
 * these makes doglegs, S-curves and holes that bend twice out of one mechanism.
 */
export interface BendSpec {
  at: number;
  shift: number;
  turn?: number;
}

/** A stand of trees, placed where it changes the shot rather than as scenery. */
export interface GroveSpec {
  /** Yards along the centreline the stand covers. */
  from: number;
  to: number;
  /** -1 left of the line of play, 1 right, 0 straddling the centreline. */
  side: -1 | 0 | 1;
  /**
   * Yards from the edge of the fairway to the first trunks — or from the
   * centreline itself when `side` is 0, which is how a stand gets in front of a
   * dogleg corner you would otherwise cut.
   */
  offset: number;
  /** How far back the stand runs, in yards. */
  depth: number;
  /** 0..1. Above about 0.7 there is no gap to punch through. */
  density?: number;
  /** Canopy radius range in yards: big timber, scrub, gorse or cactus. */
  canopy?: [number, number];
}

/** What a band of scenery is made of. */
export type SceneryKind = 'ocean' | 'beach' | 'woodland' | 'houses' | 'meadow';

/**
 * A band of scenery beside or beyond a hole.
 *
 * This is the view, not the golf course. Scenery is built strictly OUTSIDE the
 * out-of-bounds line — ground a ball cannot be played from however it got there
 * — and `terrainAt` never looks at it, the lie grid never contains it and no
 * shot can finish in it. Drawing the Pacific beside a cliff hole therefore adds
 * no water to that hole: its hazards are exactly what its spec says they are.
 */
export interface SceneryBand {
  kind: SceneryKind;
  /** Which side of the line of play: -1 left, 1 right, 0 across the far end. */
  side: -1 | 0 | 1;
  /** Yards from the tee along the line of play. Ignored when `side` is 0. */
  from: number;
  to: number;
  /** How deep the band is, in yards. */
  depth: number;
  /** Extra yards beyond the boundary before the band starts. */
  gap?: number;
}

/**
 * A ridge, hollow, plateau or mound laid over the tee-to-green slope. `rise` is
 * feet (negative digs a hollow), `length` how many yards of the hole it covers,
 * and `width` how far across the corridor it reaches — leave it out for a
 * landform that spans the whole hole, set it for a single mound.
 */
export interface LandformSpec {
  at: number;
  rise: number;
  length: number;
  lateral?: number;
  width?: number;
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
  /**
   * The shape of the hole. When present this defines the line of play entirely
   * and `dogleg`/`doglegAt` only mark where the landing area is; when absent the
   * hole is a single bend of `dogleg` yards around `doglegAt`.
   */
  bends?: BendSpec[];
  /** Fairway half-width in yards at fractions along the hole: pinches and widenings. */
  widths?: { at: number; half: number }[];
  /** Authored stands of trees, gorse or cactus. */
  groves?: GroveSpec[];
  /** Single trees in play, placed in yards along the centreline and across it. */
  specimens?: { along: number; lateral: number; radius?: number }[];
  /** Landforms over the tee-to-green slope. */
  landforms?: LandformSpec[];

  // --- Traced from an image, when there is one -------------------------------
  /**
   * The line of play, traced: points in the hole's frame, tee first, pin last.
   * When present it *is* the centreline and `bends` are ignored. Its length is
   * normalised to the card yardage, so the scale stays honest.
   */
  centreline?: TracedShape;
  /**
   * Which points on the traced centreline the overhead's printed markers sit on.
   * A line traced down the fairway can have more points than the overlay draws,
   * and this is how the leg check still knows where a leg ends.
   */
  centrelineCorners?: number[];
  /** The putting surface, traced. Replaces the generated blob. */
  greenShape?: TracedShape;
  /** Out of bounds: housing, a road, the property line. */
  obZones?: { shape: TracedShape }[];
  /**
   * Scenery: what you can see past the edge of the golf course. Purely
   * decorative — see `SceneryBand`.
   */
  scenery?: SceneryBand[];
  /**
   * Native grass — fescue, wild meadow, whatever the club calls it. Not rough
   * that has been left alone: a separate thing, traced where the photograph
   * shows it, played out of like deep grass and drawn in its own colour.
   */
  fescue?: { shape: TracedShape }[];
  /** Stands of trees, traced as an outline and filled at a density. */
  treeZones?: { shape: TracedShape; density?: number; canopy?: [number, number] }[];
  /** Cart paths, traced as their centre line, in yards wide. */
  cartPaths?: { line: TracedShape; width?: number }[];
  /**
   * The image this hole was traced from, and the transform that put it in the
   * hole's frame. With this the overlay lands exactly where the geometry does,
   * so any gap between the two is a mistake in the trace rather than in the
   * alignment.
   */
  reference?: {
    /** Served path, e.g. /holes/concord/18.jpg */
    image: string;
    /** Yards per pixel. */
    scale: number;
    /** Rotation applied to put the green up the y-axis, radians. */
    angle: number;
    /** The tee, in image pixels. */
    origin: Vec2;
    /** -1 when the image's y grows downward, which it usually does. */
    flip: 1 | -1;
  };
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
    /** Fescue: the wispy native grass a links or a New England hillside is cut out of. */
    fescue: string;
    fescueDark: string;
    tree: string;
    treeDark: string;
    background: string;
    ob: string;
    /** Deep water, for the sea beyond a cliff. Scenery only. */
    oceanDeep: string;
    /** Roofs, for the houses a course is routed between. Scenery only. */
    roof: string;
    roofDark: string;
  };
  /** What lies outside the corridor. */
  surround: 'deepRough' | 'waste' | 'recovery';
  /** How wide that surround is before the ball is out of bounds, in yards. */
  surroundWidth: number;
}

/** One set of markers on the card: its yardages, and its rating if it has one. */
export interface TeeSet {
  id: string;
  name: string;
  /** Yardage for each of the eighteen holes, in order. */
  yards: number[];
  /** Stroke indexes, when a tee set has its own. */
  index?: number[];
  rating?: number;
  slope?: number;
}

export interface Course {
  id: string;
  /** The course this is a tee set of; equal to `id` for a course with one card. */
  baseId?: string;
  /** Which set of markers this Course object plays from. */
  teeId?: string;
  /** Every set on the card. The authored holes are the default one. */
  tees?: TeeSet[];
  name: string;
  location: string;
  /**
   * True where the venue is a reconstruction of a real course rather than an
   * invented one. It changes nothing in the simulation; it is what lets the game
   * say, hole by hole, whether the shape being played was traced from the club's
   * own overhead or built from its card.
   */
  real?: boolean;
  style: CourseStyleId;
  par: number;
  yards: number;
  blurb: string;
  /** Free text shown on the course screen. */
  identity: string[];
  /**
   * Height of the property above sea level, in feet. Thin air is worth real
   * yards — about two per cent of carry per thousand feet — which is why a
   * Las Vegas course plays shorter than its card and a links at sea level does
   * not.
   */
  altitude: number;
  /**
   * How far the scrub outside the corridor runs before the ball is out of
   * bounds, overriding the style. A course cut through housing has boundaries
   * much closer in than open desert.
   */
  surroundWidth?: number;
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
  /**
   * The mown corridor before the tee ramp and the green apron are applied.
   * Zero means the architect put no turf here at all — the carry on a desert
   * par 3 — which is a different thing from the fairway not having started yet.
   */
  corridorHalfWidth: (along: number) => number;
  green: Shape;
  bunkers: { shape: Shape; kind: 'fairway' | 'greenside'; deep: boolean }[];
  water: { shape: Shape }[];
  waste: { shape: Shape }[];
  /** Authored out of bounds — housing, a road — beyond the corridor's own boundary. */
  ob: { shape: Shape }[];
  /** Native grass, traced. Plays as deep grass and is drawn as itself. */
  fescue: { shape: Shape }[];
  /** Cart paths, as thin polygons. Firm, fast and legal to play from. */
  paths: { shape: Shape }[];
  /**
   * The view past the edges of the hole. Decoration: built outside the
   * out-of-bounds line, never consulted by terrainAt, never in the lie grid.
   */
  scenery: { kind: SceneryKind; shape: Shape }[];
  trees: { position: Vec2; radius: number; shade: number }[];
  /** Elevation in feet, relative to the tee — interpolated, and what callers use. */
  elevationAt: (p: Vec2) => number;
  /** The exact height field, used to build the interpolation grid. */
  exactElevationAt: (p: Vec2) => number;
  bounds: Bounds;
  /**
   * The teeing ground: a mown pad square to the opening line, with the markers
   * at its front edge. Real ground, not decoration — a ball that finishes on it
   * sits on cut grass.
   */
  teeBox: Shape;
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
