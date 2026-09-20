/**
 * What the ball is sitting on, as physical material rather than as a penalty.
 *
 * This is the data file for the whole lie/contact/flight system. Nothing in
 * here computes anything: it is a table of measured-ish properties — how tall
 * the grass is, how dense, how firm the ground, how deep the sand — and the
 * engine derives everything else from them. Adding a surface means adding an
 * entry here, not touching the shot engine.
 *
 * Units are deliberately physical so the numbers can be argued with:
 *
 *   grassHeight   inches of grass above the ground
 *   sandDepth     inches of loose sand
 *   firmness      0 (a bog) → 1 (baked hardpan)
 *   moisture      0 (dust) → 1 (standing water), before weather
 *   friction      rolling friction coefficient, the thing that stops a ball
 *
 * Everything on a 0–1 scale is a share, not a multiplier, unless the comment
 * says otherwise. A golf ball is 1.68 inches across, so grass at 0.84 inches is
 * exactly up to the ball's equator — which is the height at which the clubface
 * stops being able to reach the back of the ball cleanly, and is why that
 * number turns up all over the contact model.
 */

import type { ClubFamily, LieType, RatingKey } from './types';

/** Diameter of a golf ball, in inches. */
export const BALL_DIAMETER_IN = 1.68;
export const BALL_RADIUS_IN = BALL_DIAMETER_IN / 2;

export type SurfaceKind = 'grass' | 'sand' | 'bare' | 'hazard';

export type SurfaceId =
  | 'teeGround'
  | 'fairway'
  | 'firstCut'
  | 'greenCollar'
  | 'greensideCut'
  | 'green'
  | 'lightRough'
  | 'heavyRough'
  | 'deepRough'
  | 'firmSand'
  | 'softSand'
  | 'deepSand'
  | 'pineStraw'
  | 'waste'
  | 'recovery'
  | 'water'
  | 'ob';

export interface SurfaceMaterial {
  id: SurfaceId;
  name: string;
  short: string;
  kind: SurfaceKind;

  // --- What it is made of -------------------------------------------------
  /** Inches of grass above the ground. */
  grassHeight: number;
  /** 0–1 blade density, where 1 is matted fescue. */
  grassDensity: number;
  /** 0–1: how much the blades stand up to the club instead of folding over. */
  grassStiffness: number;
  /** Inches of loose sand. */
  sandDepth: number;
  /** 0–1: how much of the ball settles below the surface, before lie quality. */
  burial: number;

  // --- Ground -------------------------------------------------------------
  /** 0 (bog) → 1 (hardpan), before weather. */
  firmness: number;
  /** 0 (dust) → 1 (saturated), before weather. */
  moisture: number;
  /**
   * Rolling friction, once the ball is down and turning over. Green ≈ 0.11,
   * heavy rough ≈ 0.85.
   */
  friction: number;
  /**
   * Shear friction during the impact itself, which is a different thing
   * entirely: a green is slick to roll on and grabby to land on, because the
   * ball is gouging turf rather than sliding over it. Without the two kept
   * apart, an approach landing on a green never stops.
   */
  shear: number;
  /** Coefficient of restitution for a ball dropping onto it. */
  bounce: number;
  /** 0–1 spread on that bounce: sand and straw are unpredictable, fairway is not. */
  bounceRandom: number;
  /** 0–1: how much the fall of the land pulls the ball and tilts the stance. */
  slopeInfluence: number;

  // --- Club and ball ------------------------------------------------------
  /** 0–1: how much the surface grabs the hosel and turns the face through impact. */
  clubDrag: number;
  /**
   * Multiplier on how much the strike scatters, for reasons that are about the
   * ball's support rather than about anything getting in the way.
   *
   * This is 1.00 for every surface a ball can be *on*, and it exists for the
   * one case where that is not the whole story: a teed ball is not resting on
   * the ground at all, so the club never has to find the turf, and the strike
   * is a little more repeatable for it. It is the only per-surface multiplier
   * left in the system, it applies to exactly one surface, and it is here
   * rather than buried in the shot engine so it can be seen and argued with.
   */
  strikeScatter: number;
  /**
   * The most backspin a ball can leave this material with, as a share of what
   * a clean strike off a fairway would produce.
   *
   * For grass this is 1: grass takes spin off through interference, which is
   * already modelled, and a second multiplier here would charge for it twice.
   * Sand is different in kind — on a splash shot the clubface never touches the
   * ball at all, so there is a hard ceiling on what the grooves can do, and no
   * amount of loft or technique gets past it. That is a property of the
   * material, not a penalty on the lie.
   */
  spinCeiling: number;
  /**
   * Degrees the material itself adds to launch, scaled by how much the club
   * digs into it. Sand pushes a ball up on a cushion; hardpan and matted grass
   * send it out low. This is the one launch number a material owns — ball
   * speed, spin, carry and roll are all *derived* from the properties above,
   * because storing them would be the arbitrary per-cent penalty this whole
   * system exists to replace.
   */
  launchBias: number;
  /** 0–1: how readily the club digs in behind the ball rather than through it. */
  diggingTendency: number;
  /** 0–1: how readily grass gets between the face and the ball and kills friction. */
  flyerTendency: number;

  // --- Playing from it ----------------------------------------------------
  /** 0–1 loss of lie quality just from being here. */
  liePenalty: number;
  /**
   * Chance of a genuinely poor strike that this material contributes on its
   * own, before the lie's quality and the grass interference add theirs. These
   * are set so the *total* comes out where the field was already calibrated —
   * about 2% from a fairway, 5% from light rough, 10% from heavy — because a
   * fat one or a thin one is a large part of how much a shot actually varies,
   * and getting them wrong quietly halves or doubles the game's dispersion.
   */
  contactPenalty: number;
  /** Longest club that is realistic from here, by carry ratio. 1 means anything. */
  maxCarryRatio: number;
  /** Which rating helps most from here. */
  skill?: RatingKey;
  note: string;
}

/** Shorthand so the table below reads as a table. */
function surface(m: SurfaceMaterial): SurfaceMaterial {
  return m;
}

export const SURFACES: Record<SurfaceId, SurfaceMaterial> = {
  teeGround: surface({
    id: 'teeGround', name: 'Teeing Ground', short: 'Tee', kind: 'grass',
    grassHeight: 0, grassDensity: 0.30, grassStiffness: 0.25, sandDepth: 0, burial: 0,
    firmness: 0.72, moisture: 0.30, friction: 0.26, shear: 0.50, bounce: 0.36, bounceRandom: 0.10, slopeInfluence: 0.15,
    clubDrag: 0.02, strikeScatter: 0.96, spinCeiling: 1.00, launchBias: 3.8,
    diggingTendency: 0.04, flyerTendency: 0.01,
    liePenalty: 0.00, contactPenalty: 0.016, maxCarryRatio: 1,
    // Nothing in front of the ball and room to hit up on it: the two or three
    // per cent a teed drive has over one off the deck is the higher launch,
    // which the flight model works out for itself.
    note: 'Perched on a peg. As good as it gets.',
  }),
  fairway: surface({
    id: 'fairway', name: 'Fairway', short: 'Fwy', kind: 'grass',
    grassHeight: 0.42, grassDensity: 0.34, grassStiffness: 0.28, sandDepth: 0, burial: 0.04,
    firmness: 0.70, moisture: 0.32, friction: 0.26, shear: 0.52, bounce: 0.35, bounceRandom: 0.12, slopeInfluence: 0.30,
    clubDrag: 0.04, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 0,
    diggingTendency: 0.08, flyerTendency: 0.02,
    liePenalty: 0.02, contactPenalty: 0.025, maxCarryRatio: 1,
    note: 'Clean lie. Full control of flight and spin.',
  }),
  firstCut: surface({
    id: 'firstCut', name: 'First Cut', short: '1st', kind: 'grass',
    grassHeight: 0.78, grassDensity: 0.44, grassStiffness: 0.34, sandDepth: 0, burial: 0.10,
    firmness: 0.66, moisture: 0.36, friction: 0.34, shear: 0.56, bounce: 0.32, bounceRandom: 0.16, slopeInfluence: 0.34,
    clubDrag: 0.10, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 0.3,
    diggingTendency: 0.10, flyerTendency: 0.10,
    liePenalty: 0.07, contactPenalty: 0.033, maxCarryRatio: 1,
    note: 'Barely off line. A blade or two gets in the way.',
  }),
  greenCollar: surface({
    id: 'greenCollar', name: 'Fringe', short: 'Fringe', kind: 'grass',
    grassHeight: 0.30, grassDensity: 0.40, grassStiffness: 0.30, sandDepth: 0, burial: 0.05,
    firmness: 0.70, moisture: 0.38, friction: 0.30, shear: 0.52, bounce: 0.30, bounceRandom: 0.12, slopeInfluence: 0.35,
    clubDrag: 0.06, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 0.2,
    diggingTendency: 0.08, flyerTendency: 0.04,
    liePenalty: 0.04, contactPenalty: 0.027, maxCarryRatio: 1, skill: 'chipping',
    note: 'Collar of the green. Putt it or bump it.',
  }),
  greensideCut: surface({
    id: 'greensideCut', name: 'Greenside Rough', short: 'Grn Rgh', kind: 'grass',
    grassHeight: 1.30, grassDensity: 0.55, grassStiffness: 0.44, sandDepth: 0, burial: 0.22,
    firmness: 0.62, moisture: 0.40, friction: 0.52, shear: 0.66, bounce: 0.26, bounceRandom: 0.24, slopeInfluence: 0.36,
    clubDrag: 0.22, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 1.0,
    diggingTendency: 0.18, flyerTendency: 0.22,
    liePenalty: 0.16, contactPenalty: 0.035, maxCarryRatio: 1, skill: 'chipping',
    note: 'Thicker than the collar. The ball can sit down or sit up.',
  }),
  green: surface({
    id: 'green', name: 'Green', short: 'Green', kind: 'grass',
    grassHeight: 0.12, grassDensity: 0.50, grassStiffness: 0.18, sandDepth: 0, burial: 0.01,
    firmness: 0.72, moisture: 0.40, friction: 0.15, shear: 0.50, bounce: 0.22, bounceRandom: 0.06, slopeInfluence: 1.00,
    clubDrag: 0.02, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 0,
    diggingTendency: 0.04, flyerTendency: 0.00,
    liePenalty: 0.00, contactPenalty: 0.000, maxCarryRatio: 1, skill: 'putting',
    // A green is watered, so it takes a pitch mark and kills a bounce, and it
    // is also cut tight, so a ball that is already down runs a long way. Those
    // are two different numbers — `bounce` and `friction` — and collapsing them
    // is what makes approach shots skate off the back of every green.
    note: 'On the dance floor.',
  }),
  lightRough: surface({
    id: 'lightRough', name: 'Light Rough', short: 'Lt Rgh', kind: 'grass',
    grassHeight: 1.90, grassDensity: 0.52, grassStiffness: 0.46, sandDepth: 0, burial: 0.30,
    firmness: 0.60, moisture: 0.42, friction: 0.62, shear: 0.74, bounce: 0.24, bounceRandom: 0.26, slopeInfluence: 0.38,
    clubDrag: 0.26, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 1.2,
    diggingTendency: 0.20, flyerTendency: 0.62,
    liePenalty: 0.20, contactPenalty: 0.028, maxCarryRatio: 1, skill: 'difficultLies',
    note: 'Sitting up in it. Flyers live here — the ball comes out hot.',
  }),
  heavyRough: surface({
    id: 'heavyRough', name: 'Heavy Rough', short: 'Hvy Rgh', kind: 'grass',
    grassHeight: 3.20, grassDensity: 0.74, grassStiffness: 0.62, sandDepth: 0, burial: 0.52,
    firmness: 0.54, moisture: 0.46, friction: 0.85, shear: 0.90, bounce: 0.17, bounceRandom: 0.32, slopeInfluence: 0.40,
    clubDrag: 0.52, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 1.0,
    diggingTendency: 0.40, flyerTendency: 0.30,
    liePenalty: 0.42, contactPenalty: 0.062, maxCarryRatio: 0.90, skill: 'difficultLies',
    note: 'Grass will grab the hosel. Advancing it is the goal.',
  }),
  deepRough: surface({
    id: 'deepRough', name: 'Deep Grass', short: 'Deep', kind: 'grass',
    grassHeight: 5.60, grassDensity: 0.92, grassStiffness: 0.78, sandDepth: 0, burial: 0.76,
    firmness: 0.50, moisture: 0.50, friction: 1.05, shear: 1.00, bounce: 0.10, bounceRandom: 0.36, slopeInfluence: 0.42,
    clubDrag: 0.80, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: -0.6,
    diggingTendency: 0.66, flyerTendency: 0.16,
    liePenalty: 0.66, contactPenalty: 0.087, maxCarryRatio: 0.74, skill: 'difficultLies',
    note: 'Buried. Wedge it back to grass and take your medicine.',
  }),

  // --- Sand ---------------------------------------------------------------
  // Three materials, not three places: which one a bunker offers depends on how
  // it is built, how deep it is and how much rain has been through it.
  firmSand: surface({
    id: 'firmSand', name: 'Packed Sand', short: 'Firm', kind: 'sand',
    grassHeight: 0, grassDensity: 0, grassStiffness: 0, sandDepth: 0.7, burial: 0.10,
    firmness: 0.80, moisture: 0.45, friction: 0.75, shear: 0.80, bounce: 0.26, bounceRandom: 0.30, slopeInfluence: 0.45,
    clubDrag: 0.16, strikeScatter: 1.00, spinCeiling: 0.62, launchBias: -0.8,
    diggingTendency: 0.22, flyerTendency: 0.04,
    liePenalty: 0.16, contactPenalty: 0.114, maxCarryRatio: 0.88, skill: 'bunkerPlay',
    note: 'Firm, wet or well-raked sand. Nip it and it flies almost normally.',
  }),
  softSand: surface({
    id: 'softSand', name: 'Soft Sand', short: 'Soft', kind: 'sand',
    grassHeight: 0, grassDensity: 0, grassStiffness: 0, sandDepth: 2.2, burial: 0.30,
    firmness: 0.44, moisture: 0.24, friction: 1.00, shear: 1.10, bounce: 0.12, bounceRandom: 0.34, slopeInfluence: 0.50,
    clubDrag: 0.40, strikeScatter: 1.00, spinCeiling: 0.46, launchBias: 3.4,
    diggingTendency: 0.56, flyerTendency: 0.02,
    liePenalty: 0.34, contactPenalty: 0.040, maxCarryRatio: 0.70, skill: 'bunkerPlay',
    note: 'Fluffy sand. The club goes under it and the ball rides out on a cushion.',
  }),
  deepSand: surface({
    id: 'deepSand', name: 'Deep Sand', short: 'Deep Sand', kind: 'sand',
    grassHeight: 0, grassDensity: 0, grassStiffness: 0, sandDepth: 4.0, burial: 0.58,
    firmness: 0.34, moisture: 0.20, friction: 1.15, shear: 1.30, bounce: 0.07, bounceRandom: 0.38, slopeInfluence: 0.55,
    clubDrag: 0.62, strikeScatter: 1.00, spinCeiling: 0.32, launchBias: 6.5,
    diggingTendency: 0.78, flyerTendency: 0.01,
    liePenalty: 0.55, contactPenalty: 0.100, maxCarryRatio: 0.44, skill: 'bunkerPlay',
    note: 'Plugged, or under a steep face. Getting out is the whole ambition.',
  }),

  // --- Bare ground --------------------------------------------------------
  pineStraw: surface({
    id: 'pineStraw', name: 'Pine Straw', short: 'Straw', kind: 'bare',
    grassHeight: 0.9, grassDensity: 0.26, grassStiffness: 0.70, sandDepth: 0, burial: 0.14,
    firmness: 0.78, moisture: 0.26, friction: 0.36, shear: 0.40, bounce: 0.38, bounceRandom: 0.44, slopeInfluence: 0.34,
    clubDrag: 0.18, strikeScatter: 1.00, spinCeiling: 0.85, launchBias: -1.2,
    diggingTendency: 0.10, flyerTendency: 0.24,
    liePenalty: 0.26, contactPenalty: 0.068, maxCarryRatio: 0.95, skill: 'difficultLies',
    note: 'The club wants to slide under it and the ball can skid off the needles.',
  }),
  waste: surface({
    id: 'waste', name: 'Desert Waste', short: 'Waste', kind: 'bare',
    grassHeight: 0.5, grassDensity: 0.18, grassStiffness: 0.55, sandDepth: 0.3, burial: 0.12,
    firmness: 0.86, moisture: 0.10, friction: 0.40, shear: 0.45, bounce: 0.40, bounceRandom: 0.46, slopeInfluence: 0.38,
    clubDrag: 0.20, strikeScatter: 1.00, spinCeiling: 0.82, launchBias: -1.0,
    diggingTendency: 0.24, flyerTendency: 0.12,
    liePenalty: 0.30, contactPenalty: 0.086, maxCarryRatio: 0.88, skill: 'difficultLies',
    note: 'Hardpan, gravel and scrub. Playable, but nothing is guaranteed.',
  }),
  recovery: surface({
    id: 'recovery', name: 'Recovery Lie', short: 'Trees', kind: 'grass',
    grassHeight: 1.6, grassDensity: 0.48, grassStiffness: 0.50, sandDepth: 0, burial: 0.26,
    firmness: 0.66, moisture: 0.40, friction: 0.60, shear: 0.70, bounce: 0.24, bounceRandom: 0.40, slopeInfluence: 0.40,
    clubDrag: 0.30, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: -2.0,
    diggingTendency: 0.26, flyerTendency: 0.18,
    liePenalty: 0.36, contactPenalty: 0.172, maxCarryRatio: 0.68, skill: 'recovery',
    note: 'Trees in the way. Find a gap, keep it low, get back in play.',
  }),

  // --- Not surfaces you play from -----------------------------------------
  water: surface({
    id: 'water', name: 'Water Hazard', short: 'Water', kind: 'hazard',
    grassHeight: 0, grassDensity: 0, grassStiffness: 0, sandDepth: 0, burial: 1,
    firmness: 0, moisture: 1, friction: 1.00, shear: 1.00, bounce: 0, bounceRandom: 0, slopeInfluence: 0,
    clubDrag: 1, strikeScatter: 1.00, spinCeiling: 0.00, launchBias: 0,
    diggingTendency: 1, flyerTendency: 0,
    liePenalty: 1, contactPenalty: 1.000, maxCarryRatio: 0,
    note: 'One penalty stroke and a drop.',
  }),
  ob: surface({
    id: 'ob', name: 'Out of Bounds', short: 'O.B.', kind: 'hazard',
    grassHeight: 0, grassDensity: 0, grassStiffness: 0, sandDepth: 0, burial: 0,
    firmness: 0.7, moisture: 0.3, friction: 0.50, shear: 0.50, bounce: 0.3, bounceRandom: 0.3, slopeInfluence: 0,
    clubDrag: 0, strikeScatter: 1.00, spinCeiling: 1.00, launchBias: 0,
    diggingTendency: 0, flyerTendency: 0,
    liePenalty: 1, contactPenalty: 1.000, maxCarryRatio: 0,
    note: 'Stroke and distance. Reload.',
  }),
};

/**
 * A surface that is part one thing and part another.
 *
 * A ball does not do its running on the patch it landed on. A chip pitches on
 * the collar and is on the green a yard later; a drive lands in the first cut
 * and trickles back onto the fairway. Only the properties that govern the
 * run-out are blended — what the ball is finally *sitting* in is decided by the
 * terrain where it stops, as it always was.
 */
export function blendSurfaces(a: SurfaceMaterial, b: SurfaceMaterial, share: number): SurfaceMaterial {
  if (a === b || share <= 0) return a;
  const mix = (x: number, y: number) => x + (y - x) * share;
  return {
    ...a,
    id: share > 0.5 ? b.id : a.id,
    name: share > 0.5 ? b.name : a.name,
    friction: mix(a.friction, b.friction),
    shear: mix(a.shear, b.shear),
    bounce: mix(a.bounce, b.bounce),
    bounceRandom: mix(a.bounceRandom, b.bounceRandom),
    firmness: mix(a.firmness, b.firmness),
    moisture: mix(a.moisture, b.moisture),
  };
}

/**
 * The surface a lie offers by default. Sand is the interesting case: the same
 * bunker is packed sand after a night of rain and fluff in a dry week, so the
 * lie only says *which bunker* and `lieStateFor` picks the material.
 */
export const DEFAULT_SURFACE: Record<LieType, SurfaceId> = {
  tee: 'teeGround',
  fairway: 'fairway',
  firstCut: 'firstCut',
  lightRough: 'lightRough',
  heavyRough: 'heavyRough',
  deepRough: 'deepRough',
  fairwayBunker: 'firmSand',
  greensideBunker: 'softSand',
  pineStraw: 'pineStraw',
  waste: 'waste',
  recovery: 'recovery',
  fringe: 'greenCollar',
  green: 'green',
  water: 'water',
  ob: 'ob',
};

// ---------------------------------------------------------------------------
// Clubs, as tools for getting a ball off a surface
// ---------------------------------------------------------------------------

/**
 * A club is not just a yardage. What decides how much a lie costs is the angle
 * it arrives at and how much grass the leading edge has to get through first: a
 * driver sweeps along the top of the turf, so every blade in front of the ball
 * is in the way, while a wedge arrives steeply from above and most of the grass
 * never touches the face.
 */
export interface ClubSurfaceProfile {
  /** Dynamic loft at impact, degrees. */
  loft: number;
  /** Angle of attack, degrees; negative is a descending blow. */
  attack: number;
  /** 0–1: how much grass between the face and the ball costs this club. */
  grassSensitivity: number;
  /** 0–1: how well it cuts through the stuff and still compresses the ball. */
  escape: number;
  /** 0–1: how much of its spin survives when grass gets involved. 1 keeps it all. */
  spinResilience: number;
  /** Multiplier on how much a poor lie scatters the launch angle. */
  launchVariance: number;
  /** Multiplier on how much a poor lie scatters direction. */
  dispersionSensitivity: number;
}

export const CLUB_SURFACE: Record<ClubFamily, ClubSurfaceProfile> = {
  driver:    { loft: 10.5, attack:  +2.5, grassSensitivity: 1.00, escape: 0.18, spinResilience: 0.35, launchVariance: 1.45, dispersionSensitivity: 1.35 },
  wood:      { loft: 15.5, attack:  -1.0, grassSensitivity: 0.92, escape: 0.30, spinResilience: 0.44, launchVariance: 1.30, dispersionSensitivity: 1.25 },
  longIron:  { loft: 24.0, attack:  -3.2, grassSensitivity: 0.80, escape: 0.44, spinResilience: 0.42, launchVariance: 1.18, dispersionSensitivity: 1.12 },
  midIron:   { loft: 32.0, attack:  -4.1, grassSensitivity: 0.66, escape: 0.58, spinResilience: 0.56, launchVariance: 1.05, dispersionSensitivity: 1.00 },
  shortIron: { loft: 41.0, attack:  -4.8, grassSensitivity: 0.52, escape: 0.72, spinResilience: 0.76, launchVariance: 0.92, dispersionSensitivity: 0.90 },
  wedge:     { loft: 54.0, attack:  -5.6, grassSensitivity: 0.40, escape: 0.86, spinResilience: 0.88, launchVariance: 0.82, dispersionSensitivity: 0.80 },
  putter:    { loft:  3.0, attack:  +0.5, grassSensitivity: 0.00, escape: 1.00, spinResilience: 1.00, launchVariance: 0.00, dispersionSensitivity: 0.00 },
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * The constants that turn the material table into behaviour. These are the
 * dials: change them and every surface moves together, which is the point.
 */
export const PHYSICS = {
  // --- How much material gets between the face and the ball ---------------
  /** Cover is turned into interference by 1 − e^(−rate · cover). */
  interferenceRate: 0.80,
  /** How much a descending blow cuts the cover the face has to get through. */
  attackReliefPerDegree: 0.055,
  /** Attack angle the relief is measured from: a driver's upward strike. */
  attackReference: 2.5,
  /** Random share of the interference that is down to the individual blade. */
  interferenceNoise: 0.17,
  /** How much of the ball's own burial counts as cover on a sand lie. */
  sandCoverBase: 0.35,
  sandCoverPerDepth: 0.80,
  /**
   * How far being buried flattens the difference between clubs.
   *
   * A wedge beats grass by arriving steeply over the top of it. That stops
   * working once the ball is down *in* it: the leading edge meets grass first
   * whatever the loft, which is why a plugged lie is a plugged lie for
   * everybody. Without this a lob wedge buried in five inches of fescue keeps
   * eight thousand rpm, which it does not.
   */
  burialLevelling: 0.80,
  /**
   * How fast a club's grooves stop mattering as material gets in the way. At
   * 0.9 a wedge keeps almost all of its spin advantage through light rough and
   * almost none of it out of a buried one.
   */
  resilienceDecay: 0.90,
  /**
   * How far sand flattens the difference between clubs. A steep wedge beats
   * grass; it does not beat sand, because the club is moving through the sand
   * either way. 0 would leave sand behaving like tall grass, 1 would make every
   * club identical in it.
   */
  sandLevelling: 0.75,

  // --- Flyers -------------------------------------------------------------
  /** Flyers peak at this much interference, and fall away this fast either side. */
  flyerPeak: 0.34,
  flyerWidth: 0.26,
  /** And at this much moisture: dew and damp grass lubricate, a soaking does not. */
  flyerMoisturePeak: 0.52,
  flyerMoistureWidth: 0.30,
  /** Loft the flyer window is centred on, in degrees, and how wide it is. */
  flyerLoftPeak: 38,
  flyerLoftWidth: 26,
  /** How much a ball sitting up on the grass raises the odds. */
  flyerSitUp: 0.55,
  /**
   * Overall scale, so the whole mechanic can be turned up or down at once.
   * Tuned against greens in regulation: a flyer both flies further and runs a
   * long way, so it is a powerful way to miss a green, and at 0.9 the field
   * was losing seven points of GIR to them. 0.6 puts a mid-iron from a good
   * light-rough lie at about one flyer in five, which is where it belongs.
   */
  flyerScale: 0.60,
  /** What a flyer does: spin is killed, launch climbs, the ball comes out hot. */
  // A flyer is hot mostly because it lost its spin, not because it was struck
  // harder; the real damage is done on the ground, where a ball with no spin
  // left runs through everything.
  flyerSpin: 0.40,
  flyerLaunchDeg: 1.9,
  flyerBallSpeed: 0.012,

  // --- Ball speed ---------------------------------------------------------
  /** Ball speed lost per unit of interference, before the club's own escape. */
  interferenceBallSpeed: 0.16,
  /** Ball speed lost to digging the ball out from under the surface. */
  burialBallSpeed: 0.06,
  /** Ball speed lost to a strike that missed the middle of the face. */
  contactBallSpeed: 0.09,

  // --- Launch -------------------------------------------------------------
  /** Degrees of launch added per unit of interference under a ball sitting up. */
  interferenceLaunchDeg: 4.2,
  /** Degrees of launch lost per unit of digging on a grass lie. */
  diggingLaunchDeg: 5.5,
  /** Degrees of launch added per degree of dynamic loft above the club's own. */
  loftToLaunch: 0.52,

  // --- Spin ---------------------------------------------------------------
  /** Backspin lost per unit of interference, before the club's spin resilience. */
  interferenceSpin: 0.95,
  /** Wet grass lubricates the face; this is the loss at fully saturated. */
  spinMoistureLoss: 0.34,
  /** How much of the spin a clean strike is worth. */
  spinFromContact: 0.42,
  /** A partial swing spins less, as this power of the swing scale. */
  spinSwingExponent: 0.30,

  // --- Contact ------------------------------------------------------------
  contactFromLie: 0.38,
  contactFromInterference: 0.30,
  contactFromDigging: 0.26,

  // --- Dispersion ---------------------------------------------------------
  // Solved rather than guessed: these four are the pair of numbers that make
  // the model reproduce the dispersion the tour was already calibrated to —
  // about 1.12x from light rough and 1.28x from heavy — given the interference
  // and lie quality those surfaces actually produce. The lie-quality term is
  // deliberately the smaller of the two, because a ball sitting down already
  // shows up once in the interference through its own depth.
  dispersionFromInterference: 0.55,
  dispersionFromLie: 0.18,
  distanceControlFromInterference: 0.62,
  distanceControlFromLie: 0.30,
  /** Yards of sideways kick per 100 yards, per unit of club drag. */
  directionalBiasPerDrag: 3.0,
  /**
   * Degrees of launch scatter per unit of interference, before the club.
   *
   * Small on purpose. A lie you cannot control really does scatter how high the
   * ball comes out, and this is that mechanism — but the *distance* cost of it
   * is already priced into `distanceControlFromInterference`, so this number is
   * set where it adds visible launch variation without charging twice for the
   * carry it moves.
   */
  launchScatterDeg: 2.2,

  // --- Landing and roll ---------------------------------------------------
  /**
   * The pitch mark. A ball arriving steeply has to climb out of the hole it
   * just made, and a soft, wet surface makes a bigger hole. This is the term
   * that separates a wedge stopping on its mark from a driver running on.
   */
  plowShare: 0.62,
  plowMoisture: 0.55,
  /** How much a steep descent digs in instead of bouncing on. */
  descentBiteShare: 0.55,
  /** How much a wet surface kills the bounce. */
  moistureBounceLoss: 0.40,
  /** How much backspin takes off the forward speed of the first bounce. */
  spinCheckPerThousand: 0.052,
  /** A ball landing on a soft green with real spin can come back. */
  spinBackPerThousand: 0.020,
  /** Rolling friction is scaled by this for a fully firm surface. */
  firmnessRollGain: 0.55,
  /** How much the fall of the land adds to or takes off the run. */
  slopeRollShare: 0.90,
  /**
   * A putting surface is *maintained*, which means it lives inside a narrow
   * band of firmness however the week has gone: watered enough to take a pitch
   * mark, rolled enough to be quick. The scorecard's 25–100 green firmness is
   * an index within that band, not an absolute soil property, and mapping it
   * straight onto the 0–1 scale the landing model uses has a seven iron running
   * twenty-two yards across a baked green, which does not happen.
   */
  greenFirmnessFloor: 0.30,
  greenFirmnessSpan: 0.35,

  // --- Weather ------------------------------------------------------------
  /** How far rain moves a surface's own moisture and firmness. */
  rainMoisture: 0.62,
  rainSoftening: 0.46,
  /** Wet grass is heavier and grabs the hosel more. */
  wetStiffness: 0.30,
  wetDrag: 0.45,

  // --- Lie quality --------------------------------------------------------
  /** The spread a surface's own variability gives its lie quality. */
  lieSpread: 0.42,
  /** How much of the ball a surface's burial hides, at neutral lie quality. */
  burialSpread: 0.55,
} as const;
