/**
 * Impact: what actually happens between the clubface and the ball.
 *
 * This is the one place a lie turns into numbers. It takes the material the
 * ball is sitting on, the state it is sitting in, the club, the shot the golfer
 * is trying to play and how well they struck it, and produces the launch
 * conditions — ball speed, launch angle, backspin, sidespin, spin axis — that
 * the flight model then flies.
 *
 * Nothing downstream knows what a lie type is. A seven iron out of heavy rough
 * is not "a seven iron minus eighteen per cent": it is a seven iron whose face
 * had two inches of wet fescue in front of it, which cost ball speed, killed
 * most of the backspin and let the ball out a degree high. The same arithmetic
 * with a wedge, which arrives steeply and carries far less grass into impact,
 * barely notices — and that difference is the whole point of doing it this way.
 *
 * ## Grass interference
 *
 * The single number the rest of the model hangs off. It is a *cover* — how much
 * material stands between the leading edge and the back of the ball, measured
 * in ball diameters — run through a saturating curve, then modulated by how
 * dense and how stiff that material is, how steeply the club arrives, and how
 * good the lie is. Sand contributes cover through its depth rather than its
 * height, so one formula covers grass and bunkers alike and a new surface needs
 * no new code.
 */

import { CLUB_SURFACE, PHYSICS, BALL_DIAMETER_IN } from './surfaces';
import { SHOT_TYPES, type ShotTypeId } from './config';
import { clamp } from './rng';
import type { LieState } from './lieState';
import type { ClubDefinition } from './types';

/** One line in the debug trail: what moved a number, and by how much. */
export type ModifierChannel =
  | 'ballSpeed' | 'spin' | 'launch' | 'contact' | 'dispersion' | 'control' | 'roll';

export interface PhysicsModifier {
  source: string;
  channel: ModifierChannel;
  /** A multiplier, or a delta in the channel's own units when `delta` is set. */
  value: number;
  delta?: boolean;
}

export interface ContactInputs {
  lie: LieState;
  club: ClubDefinition;
  shotType: ShotTypeId;
  /** Fraction of a full swing. */
  swingScale: number;
  /** 0–1: how close to the middle of the face it was struck. 1 is middled. */
  strike: number;
  /** The golfer's rating for getting a ball out of this lie, 0–100. */
  lieSkill: number;
  /** The golfer's spin control, 0–100. */
  spinSkill: number;
  /** Intended shape, yards of curve per 100 yards; positive bends right. */
  curve: number;
  /** 0–1 deterministic rolls, so a plan and the shot it plans agree. */
  roll: number;
  rollB: number;
}

export interface ContactResult {
  /** 0–1: how much material got between the face and the ball. */
  grassInterference: number;
  /** 0–1: how cleanly it came off. */
  contactQuality: number;
  /** 0–1: how much the club dug in behind the ball rather than through it. */
  digging: number;
  flyer: boolean;
  flyerChance: number;

  /** Multiplier on the ball speed a clean strike would have produced. */
  ballSpeedFactor: number;
  /** Degrees added to the club's own launch angle. */
  launchDelta: number;
  /** Dynamic loft at impact, degrees — what the ball actually saw. */
  dynamicLoft: number;
  /** Angle of attack at impact, degrees; negative is descending. */
  attackAngle: number;

  backspin: number;
  sidespin: number;
  totalSpin: number;
  /** Degrees the spin axis is tilted from vertical; positive tilts right. */
  spinAxis: number;

  /** Multipliers the shot engine applies to its dispersion. */
  dispersion: number;
  distanceControl: number;
  /** Degrees of extra launch scatter a poor lie adds. */
  launchScatter: number;
  /** Yards of sideways kick per 100 yards from a lie that grabs the hosel. */
  directionalBias: number;
  /** 0–1 chance of a genuinely poor strike, before pressure and fatigue. */
  mishitChance: number;

  modifiers: PhysicsModifier[];
}

/** A bell curve, for the things that are most likely somewhere in the middle. */
function bell(x: number, peak: number, width: number): number {
  const z = (x - peak) / width;
  return Math.exp(-z * z);
}

/**
 * How much material stands between the leading edge and the back of the ball,
 * in ball diameters. Grass contributes what is above the ball plus whatever the
 * ball has sunk below the canopy; sand contributes its depth.
 */
export function coverParts(lie: LieState): { grass: number; sand: number } {
  const s = lie.surface;
  if (s.sandDepth > 0) {
    return {
      grass: 0,
      sand:
        lie.ballDepth +
        (s.sandDepth / BALL_DIAMETER_IN) * (PHYSICS.sandCoverBase + PHYSICS.sandCoverPerDepth * lie.ballDepth),
    };
  }
  return { grass: lie.ballDepth + lie.grassAbove / BALL_DIAMETER_IN, sand: 0 };
}

export function coverFor(lie: LieState): number {
  const parts = coverParts(lie);
  return parts.grass + parts.sand;
}

/**
 * The interference itself. Kept separate from `contactFor` so the planner can
 * warn about a flyer, and the debug panel can show the number, without
 * resolving a shot.
 */
export function interferenceFor(inputs: ContactInputs): { interference: number; attackAngle: number; cover: number } {
  const { lie, club, shotType } = inputs;
  const s = lie.surface;
  const profile = SHOT_TYPES[shotType];
  const clubProfile = CLUB_SURFACE[club.family];
  const attackAngle = clubProfile.attack + profile.attack;

  // A descending blow gets under the grass before it can reach the face; a
  // driver sweeping along the top of the turf brings every blade with it.
  //
  // Sand is the opposite, and the model has to say so: hitting down into a
  // bunker puts *more* sand between the club and the ball, not less, because
  // that is the shot — you are hitting behind it on purpose.
  const attackRelief = clamp(
    1 + (attackAngle - PHYSICS.attackReference) * PHYSICS.attackReliefPerDegree,
    0.42,
    1.35,
  );
  const { grass: grassCover, sand: sandCover } = coverParts(lie);
  const cover = grassCover * attackRelief * profile.grassRelief + sandCover;

  const wetStiffness = clamp(s.grassStiffness * (1 + PHYSICS.wetStiffness * (lie.moisture - 0.4)), 0, 1.2);
  const density = 0.55 + 0.75 * s.grassDensity + (s.sandDepth > 0 ? 0.45 : 0);
  const stiffness = 0.70 + 0.55 * wetStiffness + (s.sandDepth > 0 ? 0.28 : 0);

  // How much the club's own steepness helps. Against grass, a great deal: a
  // wedge arrives from above and most of the blades never reach the face.
  // Against sand, hardly at all — the club is swinging *through* the sand
  // whatever its loft, which is why every bunker shot comes out with low spin.
  // The same goes for a ball that has sunk into the grass: a steep club can get
  // over the top of a stand of rough, but not under a ball sitting below it.
  const sensitivity =
    s.sandDepth > 0
      ? clubProfile.grassSensitivity + (0.95 - clubProfile.grassSensitivity) * PHYSICS.sandLevelling
      : clubProfile.grassSensitivity +
        (1 - clubProfile.grassSensitivity) * lie.ballDepth * PHYSICS.burialLevelling;

  const raw = 1 - Math.exp(-PHYSICS.interferenceRate * cover);
  const noise = 1 + (inputs.roll - 0.5) * 2 * PHYSICS.interferenceNoise;
  const interference = clamp(raw * density * stiffness * sensitivity * noise, 0, 1);
  return { interference, attackAngle, cover };
}

/**
 * How likely a flyer is out of this lie, with this club, playing this shot.
 *
 * A flyer is not bad luck: it is grass trapped between the face and the ball
 * that stops the grooves gripping. That needs *some* grass but not a jungle —
 * too much and the ball never gets going — and it needs the grass to be damp
 * enough to slide rather than soaked. It is most of all a light-rough,
 * sitting-up, mid-iron-to-wedge event, which is exactly what the bells below
 * say. Nothing here is a coin toss: the coin toss comes afterwards, weighted by
 * this number.
 */
export function flyerChanceFor(inputs: ContactInputs, interference: number): number {
  const { lie, club, shotType } = inputs;
  const loft = CLUB_SURFACE[club.family].loft + SHOT_TYPES[shotType].loftDelta;
  return clamp(
    lie.surface.flyerTendency *
      bell(interference, PHYSICS.flyerPeak, PHYSICS.flyerWidth) *
      bell(lie.moisture, PHYSICS.flyerMoisturePeak, PHYSICS.flyerMoistureWidth) *
      bell(loft, PHYSICS.flyerLoftPeak, PHYSICS.flyerLoftWidth) *
      (1 + (lie.sittingUp ? PHYSICS.flyerSitUp : 0)) *
      (0.5 + 0.8 * lie.quality) *
      PHYSICS.flyerScale,
    0,
    0.85,
  );
}

/**
 * Resolve the impact.
 *
 * Reads as a list because that is what it is: each factor is a physically
 * meaningful range, they multiply, and every one of them is written into
 * `modifiers` so the debug panel can show its working.
 */
export function contactFor(inputs: ContactInputs): ContactResult {
  const { lie, club, shotType, swingScale, strike } = inputs;
  const s = lie.surface;
  const profile = SHOT_TYPES[shotType];
  const clubProfile = CLUB_SURFACE[club.family];
  const modifiers: PhysicsModifier[] = [];

  const { interference, attackAngle } = interferenceFor(inputs);

  // A good player gets a club on it. Skill scales the *penalties* a lie
  // imposes — it never applies to a lie that has no penalty to buy back, which
  // is the property that keeps a clean fairway shot exactly neutral however
  // good or bad the golfer is at digging balls out of trouble.
  //
  // The range is deliberately narrow. This factor sits on ball speed, spin,
  // contact, dispersion and mishit odds at once, and it is paid on every shot
  // from every lie all season; at ±22% the gap between the tour's best and
  // worst scoring averages came out at nine strokes, which is a different sport.
  // ±16% leaves it worth having without compounding into a two-tier field.
  const skill = clamp(1.16 - (inputs.lieSkill / 100) * 0.32, 0.84, 1.16);

  // --- Digging -------------------------------------------------------------
  // The club catching the ground behind the ball rather than the ball itself.
  const digging = clamp(
    s.diggingTendency * (1.25 - lie.quality * 0.5) * (1 - clubProfile.escape * 0.45) * skill,
    0,
    1,
  );

  // --- Flyer ---------------------------------------------------------------
  const flyerChance = flyerChanceFor(inputs, interference);
  const flyer = inputs.rollB < flyerChance;

  // --- Contact quality -----------------------------------------------------
  const contactQuality = clamp(
    1 -
      PHYSICS.contactFromLie * (1 - lie.quality) * skill -
      PHYSICS.contactFromInterference * interference * (1 - clubProfile.escape) * skill -
      PHYSICS.contactFromDigging * digging * skill +
      (strike - 1) * 0.5,
    0.08,
    1,
  );
  if (s.id !== 'fairway' && s.id !== 'teeGround') {
    modifiers.push({ source: s.name, channel: 'contact', value: contactQuality });
  }

  // --- Ball speed ----------------------------------------------------------
  const speedFromGrass = PHYSICS.interferenceBallSpeed * interference * (1 - clubProfile.escape * 0.6);
  const speedFromBurial = PHYSICS.burialBallSpeed * lie.ballDepth * (1 - clubProfile.escape * 0.5);
  const speedFromContact = PHYSICS.contactBallSpeed * (1 - contactQuality);
  let ballSpeedFactor = 1 - speedFromGrass - speedFromBurial - speedFromContact;
  if (flyer) ballSpeedFactor *= 1 + PHYSICS.flyerBallSpeed;
  ballSpeedFactor = clamp(ballSpeedFactor, 0.30, 1.08);
  if (speedFromGrass > 0.004) {
    modifiers.push({ source: `${s.name} interference`, channel: 'ballSpeed', value: 1 - speedFromGrass });
  }
  if (speedFromBurial > 0.004) {
    modifiers.push({ source: 'Ball sat down', channel: 'ballSpeed', value: 1 - speedFromBurial });
  }
  if (flyer) modifiers.push({ source: 'Flyer', channel: 'ballSpeed', value: 1 + PHYSICS.flyerBallSpeed });

  // --- Launch --------------------------------------------------------------
  // Three things move it: the material's own bias scaled by how far the club
  // gets into it, grass squeezing under a ball that is sitting up, and the club
  // getting caught and coming out low.
  const grassKind = s.sandDepth > 0 ? 0 : 1;
  const materialLaunch = s.launchBias * (0.35 + 0.65 * digging);
  const perchLift = PHYSICS.interferenceLaunchDeg * interference * (1 - lie.ballDepth) * grassKind;
  const caught = PHYSICS.diggingLaunchDeg * digging * grassKind;
  const loftLaunch = PHYSICS.loftToLaunch * profile.loftDelta;
  let launchDelta = materialLaunch + perchLift - caught + loftLaunch;
  if (flyer) launchDelta += PHYSICS.flyerLaunchDeg;
  if (Math.abs(materialLaunch) > 0.15) {
    modifiers.push({ source: s.name, channel: 'launch', value: materialLaunch, delta: true });
  }
  if (perchLift - caught !== 0 && Math.abs(perchLift - caught) > 0.15) {
    modifiers.push({ source: perchLift > caught ? 'Grass under the ball' : 'Club caught in the grass', channel: 'launch', value: perchLift - caught, delta: true });
  }
  if (flyer) modifiers.push({ source: 'Flyer', channel: 'launch', value: PHYSICS.flyerLaunchDeg, delta: true });

  // --- Spin ----------------------------------------------------------------
  // Grooves only work on a ball the face can reach. A wedge keeps its spin
  // through a light lie and loses that advantage as the material builds up.
  const resilience = clubProfile.spinResilience * (1 - interference * PHYSICS.resilienceDecay);
  const spinFromGrass = 1 - PHYSICS.interferenceSpin * interference * (1 - resilience);
  const spinFromWet = 1 - PHYSICS.spinMoistureLoss * Math.max(0, lie.moisture - 0.40) / 0.60;
  const spinFromStrike = 1 - PHYSICS.spinFromContact * (1 - contactQuality);
  const spinFromSwing = Math.pow(clamp(swingScale, 0.3, 1), PHYSICS.spinSwingExponent);
  const spinSkill = 1 + (inputs.spinSkill - 50) * 0.0014;
  let backspin =
    club.spin * profile.spin * s.spinCeiling *
    spinFromGrass * spinFromWet * spinFromStrike * spinFromSwing * spinSkill;
  if (flyer) backspin *= PHYSICS.flyerSpin;
  backspin = Math.max(200, backspin);

  if (s.spinCeiling < 0.995) modifiers.push({ source: `${s.name}`, channel: 'spin', value: s.spinCeiling });
  if (spinFromGrass < 0.995) modifiers.push({ source: `${s.name} interference`, channel: 'spin', value: spinFromGrass });
  if (spinFromWet < 0.995) modifiers.push({ source: 'Wet grass', channel: 'spin', value: spinFromWet });
  if (flyer) modifiers.push({ source: 'Flyer', channel: 'spin', value: PHYSICS.flyerSpin });

  // --- Sidespin and the spin axis -----------------------------------------
  // The intended shape, expressed as spin rather than as a sideways nudge: a
  // draw is a tilted axis, and a shot whose backspin has been killed by the
  // rough cannot curve much however hard it is worked.
  const axisFromShape = inputs.curve * 1.35;
  const axisFromLie = (inputs.roll - 0.5) * 2 * s.clubDrag * 6;
  const spinAxis = clamp(axisFromShape + axisFromLie, -45, 45);
  const sidespin = backspin * Math.tan((spinAxis * Math.PI) / 180);
  const totalSpin = Math.hypot(backspin, sidespin);

  // --- What a poor lie does to the miss ------------------------------------
  const dispersion =
    (1 +
      (PHYSICS.dispersionFromInterference * interference * clubProfile.dispersionSensitivity +
        PHYSICS.dispersionFromLie * (1 - lie.quality)) *
        skill) *
    s.strikeScatter;
  const distanceControl =
    (1 +
      (PHYSICS.distanceControlFromInterference * interference * clubProfile.dispersionSensitivity +
        PHYSICS.distanceControlFromLie * (1 - lie.quality)) *
        skill) *
    s.strikeScatter;
  const launchScatter = PHYSICS.launchScatterDeg * interference * clubProfile.launchVariance * skill;
  const wetDrag = s.clubDrag * (1 + PHYSICS.wetDrag * Math.max(0, lie.moisture - 0.4));
  const directionalBias = PHYSICS.directionalBiasPerDrag * wetDrag * (1.3 - lie.quality * 0.6);
  const mishitChance = clamp(
    (s.contactPenalty + (1 - lie.quality) * 0.06 + interference * 0.05) * skill,
    0,
    0.5,
  );

  if (dispersion > 1.02) modifiers.push({ source: `${s.name} lie`, channel: 'dispersion', value: dispersion });
  if (distanceControl > 1.02) modifiers.push({ source: `${s.name} lie`, channel: 'control', value: distanceControl });

  return {
    grassInterference: interference,
    contactQuality,
    digging,
    flyer,
    flyerChance,
    ballSpeedFactor,
    launchDelta,
    dynamicLoft: clubProfile.loft + profile.loftDelta,
    attackAngle,
    backspin,
    sidespin,
    totalSpin,
    spinAxis,
    dispersion,
    distanceControl,
    launchScatter,
    directionalBias,
    mishitChance,
    modifiers,
  };
}
