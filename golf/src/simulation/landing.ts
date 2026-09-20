/**
 * What happens when the ball arrives.
 *
 * Roll is not a property of the club. It is what is left of the ball's forward
 * speed after the ground has had its say, and the ground's say depends on how
 * steeply the ball came in, how fast, how much backspin it still had, and what
 * it landed on. That is why a wedge that carries 120 yards stops dead and a
 * flyer that carries the same 120 runs another twenty-five: same carry, very
 * different arrival.
 *
 * ## Normalised, like the flight
 *
 * The same trick as `ballFlight`: the model computes a *run*, and the engine
 * uses the ratio between the run it computed and the run the same club's
 * neutral flight would produce on a fairway. So a stock shot onto a fairway
 * rolls exactly the distance the golfer's own yardages say it should, and
 * everything else moves away from that for a reason you can point at.
 */

import { PHYSICS, SURFACES, type SurfaceMaterial } from './surfaces';
import { NEUTRAL_FLIGHT, type FlightProfile } from './ballFlight';
import { clamp } from './rng';
import type { ClubId } from './types';

export interface LandingConditions {
  /** Speed at landing, mph. */
  speed: number;
  /** Descent angle, degrees below horizontal. */
  descent: number;
  /** Backspin still on the ball at landing, rpm. */
  backspin: number;
  /** What it landed on. */
  surface: SurfaceMaterial;
  /** 0–1 after weather. */
  firmness: number;
  moisture: number;
  /** Downhill gradient along the line of run, feet per yard; negative is uphill. */
  slope?: number;
}

export interface LandingResult {
  /** Yards the ball runs after it first touches down. Can be negative — it checked. */
  run: number;
  /** Yards of that first bounce. */
  bounce: number;
  /** How many times it bounced before it settled. */
  bounces: number;
  /** Forward speed retained through the first impact, as a share. */
  retained: number;
  /** True when the backspin dragged it back toward where it pitched. */
  checked: boolean;
}

const MPH_TO_YDS = 0.4889;   // yards per second, per mph
const G_YDS = 10.7247;       // gravity, yards per second squared
/** Contact-patch surface speed in yards per second, per rpm of backspin. */
const RPM_TO_SURFACE = ((2 * Math.PI) / 60) * 0.021336 * 1.0936133;

/**
 * One arrival, in yards of run.
 *
 * The bounce chain is explicit rather than a single fudge: the normal component
 * of the ball's velocity is what digs in, the tangential component is what runs
 * on, and backspin at the contact patch takes the tangential component away.
 * Four bounces are enough — by the fifth the ball is rolling.
 */
export function landingFor(conditions: LandingConditions): LandingResult {
  const { surface, firmness, moisture } = conditions;
  const angle = (Math.max(1, conditions.descent) * Math.PI) / 180;
  const speed = Math.max(0, conditions.speed) * MPH_TO_YDS;

  let vt = speed * Math.cos(angle);
  let vn = speed * Math.sin(angle);
  // Backspin makes the bottom of the ball run *forward* faster than the ball
  // itself, so it is slip, and friction spends itself killing it. That is the
  // whole mechanism behind a shot checking.
  let spinSurface = (conditions.backspin * RPM_TO_SURFACE);

  // How much of the arrival the ground gives back.
  const restitution = clamp(
    surface.bounce *
      (0.55 + 0.45 * firmness) *
      (1 - PHYSICS.descentBiteShare * Math.sin(angle)) *
      (1 - PHYSICS.moistureBounceLoss * moisture),
    0.01,
    0.75,
  );
  // The pitch mark: a steep arrival into a soft surface digs a hole the ball
  // then has to climb out of, and that is pure loss.
  const plow = clamp(
    PHYSICS.plowShare * Math.sin(angle) * (1 - firmness) * (1 + PHYSICS.plowMoisture * moisture),
    0,
    0.70,
  );
  const shear = surface.shear * (0.7 + 0.3 * firmness);

  let run = 0;
  let firstBounce = 0;
  let bounces = 0;

  for (let i = 0; i < 4 && vt > 0.05; i++) {
    // Oblique impact with friction. Either the friction available over the
    // normal impulse runs out first — the ball skids on — or it is enough to
    // bring the contact patch to rest, and the ball leaves rolling.
    const slip = vt + spinSurface;
    const normalImpulse = vn * (1 + restitution);
    const frictionLoss = shear * normalImpulse;
    const rollingLoss = (2 / 7) * slip;
    const loss = Math.min(frictionLoss, rollingLoss);

    vt = Math.max(0, vt * (1 - plow) - loss);
    vn *= restitution;
    // Whatever the ball leaves with, it leaves near enough rolling; the spin
    // that checked it is spent.
    spinSurface = Math.min(spinSurface * 0.30, vt * 0.5);
    bounces++;

    if (vn < 0.25 || vt <= 0.05) break;

    const hop = (2 * vt * vn) / G_YDS;
    run += hop;
    if (i === 0) firstBounce = hop;
  }

  // What is left is a roll, against rolling friction and the fall of the land.
  const slope = conditions.slope ?? 0;
  const rollFriction = Math.max(
    0.035,
    surface.friction *
      (1 - PHYSICS.firmnessRollGain * (firmness - 0.5)) *
      (1 + moisture * 0.35) *
      (1 - clamp(slope, -0.5, 0.5) * PHYSICS.slopeRollShare),
  );
  const rolled = (vt * vt) / (2 * G_YDS * rollFriction);
  run += rolled;
  if (bounces <= 1) firstBounce = Math.max(firstBounce, rolled);

  // A shot that arrives with real spin onto a soft, smooth surface pulls back
  // toward its pitch mark. On anything grabbier than a green the spin is gone
  // in the first impact and there is nothing left to pull with.
  let checked = false;
  if (conditions.backspin > 4500 && firmness < 0.66 && surface.friction < 0.40) {
    const back = ((conditions.backspin - 4500) / 1000) * PHYSICS.spinBackPerThousand * (0.66 - firmness) * 22;
    run -= back;
    checked = run < 0.6;
  }

  return {
    run,
    bounce: firstBounce,
    bounces,
    retained: speed > 0 ? vt / speed : 0,
    checked,
  };
}

/**
 * The run a stock arrival produces on a neutral fairway — the denominator that
 * keeps the yardage ladder intact.
 *
 * `flightFor` hands back the same profile object for the same launch
 * conditions, so keying the memo on the object itself is both correct and free:
 * a season's worth of stock arrivals resolve to a handful of entries.
 */
const stockRuns = new WeakMap<FlightProfile, number>();

export function stockRun(reference: FlightProfile): number {
  const hit = stockRuns.get(reference);
  if (hit !== undefined) return hit;
  const fairway = SURFACES.fairway;
  const value = Math.max(
    0.2,
    landingFor({
      speed: reference.landingSpeed,
      descent: reference.descent,
      backspin: reference.landingSpin,
      surface: fairway,
      firmness: fairway.firmness,
      moisture: fairway.moisture,
    }).run,
  );
  stockRuns.set(reference, value);
  return value;
}

/**
 * The run a stock shot with this club produces on a neutral fairway — the
 * denominator that keeps the yardage ladder intact.
 */
const NEUTRAL_RUN: Partial<Record<ClubId, number>> = {};

export function neutralRun(clubId: ClubId): number {
  const cached = NEUTRAL_RUN[clubId];
  if (cached !== undefined) return cached;
  const flight = NEUTRAL_FLIGHT[clubId];
  const fairway = SURFACES.fairway;
  const result = landingFor({
    speed: flight.landingSpeed,
    descent: flight.descent,
    backspin: flight.landingSpin,
    surface: fairway,
    firmness: fairway.firmness,
    moisture: fairway.moisture,
  });
  const value = Math.max(0.5, result.run);
  NEUTRAL_RUN[clubId] = value;
  return value;
}

/** How far this arrival runs, relative to the club's own stock arrival. */
export function runRatio(clubId: ClubId, result: LandingResult): number {
  return result.run / neutralRun(clubId);
}
