/**
 * The trajectory, integrated rather than assumed.
 *
 * A golf ball in the air is a drag force and a lift force. Drag takes speed off
 * it; lift, from the backspin, holds it up — which is why a wedge with ten
 * thousand rpm climbs to the same apex as a driver with two and a half, and why
 * a flyer that loses its spin comes down like a stone at the end even though it
 * went further. Both coefficients depend on the spin ratio S = ωr/v, so as the
 * ball slows and the spin decays, the flight shape changes along the way.
 *
 * This is the only place carry, apex, descent angle and landing speed are
 * worked out. Everything else asks it.
 *
 * ## Why the results are normalised
 *
 * The distance ladder — how far *this* golfer hits *this* club — is a separate,
 * already-calibrated system built from their ratings, and it stays that way.
 * What this model provides is the *shape*: how a trajectory responds when the
 * launch conditions change. So the engine runs the integration twice, once at
 * the club's neutral launch and once at the actual one, and uses the ratio. A
 * neutral strike from a clean fairway lie therefore returns exactly the
 * golfer's own yardage, and everything else moves away from it for a physical
 * reason.
 *
 * The neutral integrations are precomputed once per club at module load.
 *
 * ## What the constants were fitted to, and where the model falls short
 *
 * `AERO` was fitted against published tour launch-monitor averages — ball
 * speed, launch angle and backspin in, carry, apex and descent angle out — for
 * every club from a 3 wood to a pitching wedge. Carry lands within two yards
 * and apex within two, across the set.
 *
 * The driver is the one that does not fit: the model carries it about 255 yards
 * where the tour average is 275. A two-dimensional point mass with a single
 * lift-and-drag pair cannot reproduce the driver's real efficiency, which comes
 * partly from being struck on the way up with less spin loft than any other
 * club in the bag. Rather than bend the constants to it and put every iron
 * wrong instead, the residual is left where it is — and it never reaches the
 * game, because carry is normalised against each club's *own* neutral flight,
 * so the driver's denominator carries the same error as its numerator and the
 * two cancel. What survives normalisation is the shape of the response, which
 * is the part that was fitted well.
 */

import { CLUBS, CLUB_BY_ID } from './config';
import type { ClubDefinition, ClubId } from './types';

// --- Constants, in SI -------------------------------------------------------

const BALL_MASS = 0.04593;        // kg
const BALL_RADIUS = 0.021336;     // m
const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
const AIR_DENSITY = 1.225;        // kg/m³ at sea level
const GRAVITY = 9.80665;          // m/s²
const MPH_TO_MS = 0.44704;
const M_TO_YARDS = 1.0936133;
const M_TO_FEET = 3.2808399;
const RPM_TO_RADS = (2 * Math.PI) / 60;

/**
 * Aerodynamics. `AERO` is the tuning surface: these four numbers, fitted to
 * published tour launch-monitor numbers, set how every trajectory in the game
 * behaves. Nothing else in the engine touches them.
 *
 *   Cd = dragBase + dragPerSpin · S
 *   Cl = liftMax · (1 − e^(−liftRate · S))
 *
 * The saturating lift curve matters: doubling the spin on a wedge that already
 * has ten thousand rpm buys almost no extra height, which is why spin loft has
 * diminishing returns and why the flyer mechanic is about *losing* spin from a
 * regime where it was doing real work.
 */
export const AERO: {
  dragBase: number; dragPerSpin: number;
  liftMax: number; liftRate: number; spinDecaySeconds: number; step: number;
} = {
  dragBase: 0.2440,
  dragPerSpin: 0.2500,
  liftMax: 0.3425,
  liftRate: 8.000,
  /** Spin bleeds off in flight with this time constant, in seconds. */
  spinDecaySeconds: 24,
  /** Integration step, in seconds. Halved for the short, steep stuff. */
  step: 0.035,
};

export interface LaunchConditions {
  /** Ball speed in mph. */
  ballSpeed: number;
  /** Launch angle in degrees above horizontal. */
  launch: number;
  /** Backspin in rpm. */
  backspin: number;
  /** Air density multiplier: altitude, temperature. 1 is sea level on a mild day. */
  airDensity?: number;
  /** Head (+) or tail (−) wind in mph, along the line of flight. */
  headwind?: number;
}

export interface FlightProfile {
  /** Carry in yards. */
  carry: number;
  /** Apex above the launch point in feet. */
  apexFeet: number;
  /** Descent angle at landing, degrees below horizontal. */
  descent: number;
  /** Speed at landing in mph. */
  landingSpeed: number;
  /** Backspin left at landing, rpm. */
  landingSpin: number;
  /** Seconds in the air. */
  hangTime: number;
  /**
   * The shape of the flight, normalised: `x` is the share of the carry and `h`
   * the height in feet at a carry of 1 yard, so the caller scales both by the
   * carry it actually wants. 33 samples, evenly spaced in time.
   */
  shape: { x: number; h: number }[];
}

const SHAPE_SAMPLES = 32;

/**
 * Integrate one trajectory.
 *
 * Midpoint (RK2) rather than Euler: a golf ball turns over enough near the apex
 * that Euler visibly under-flies it, and RK2 costs one extra force evaluation
 * for an error that stops mattering.
 */
export function simulateFlight(launch: LaunchConditions): FlightProfile {
  const v0 = Math.max(4, launch.ballSpeed) * MPH_TO_MS;
  const angle = (launch.launch * Math.PI) / 180;
  const rho = AIR_DENSITY * (launch.airDensity ?? 1);
  const k = (rho * BALL_AREA) / (2 * BALL_MASS);
  const wind = (launch.headwind ?? 0) * MPH_TO_MS;
  let spin = Math.max(0, launch.backspin) * RPM_TO_RADS;

  let x = 0;
  let y = 0;
  let vx = v0 * Math.cos(angle);
  let vy = v0 * Math.sin(angle);

  // A steep, slow wedge needs a finer step than a driver to land where it should.
  const dt = launch.launch > 26 || launch.ballSpeed < 70 ? AERO.step * 0.5 : AERO.step;

  const accel = (vxa: number, vya: number, omega: number): { ax: number; ay: number } => {
    // Aerodynamic forces act on the ball's speed *through the air*, which is
    // why a headwind is worth more than the ground speed it takes away.
    const ax0 = vxa + wind;
    const speed = Math.hypot(ax0, vya);
    if (speed < 1e-6) return { ax: 0, ay: -GRAVITY };
    const s = (omega * BALL_RADIUS) / speed;
    const cd = AERO.dragBase + AERO.dragPerSpin * s;
    const cl = AERO.liftMax * (1 - Math.exp(-AERO.liftRate * s));
    const q = k * speed;
    // Drag opposes the airflow; lift is perpendicular to it, spun up-and-left of travel.
    const ax = -q * cd * ax0 - q * cl * vya;
    const ay = -q * cd * vya + q * cl * ax0 - GRAVITY;
    return { ax, ay };
  };

  const trace: { t: number; x: number; y: number }[] = [{ t: 0, x: 0, y: 0 }];
  let t = 0;
  let apex = 0;
  let guard = 0;
  let prev = { x: 0, y: 0, vx, vy };

  while (guard++ < 4000) {
    prev = { x, y, vx, vy };
    const a1 = accel(vx, vy, spin);
    const mvx = vx + a1.ax * dt * 0.5;
    const mvy = vy + a1.ay * dt * 0.5;
    const a2 = accel(mvx, mvy, spin);
    x += mvx * dt;
    y += mvy * dt;
    vx += a2.ax * dt;
    vy += a2.ay * dt;
    t += dt;
    spin *= Math.exp(-dt / AERO.spinDecaySeconds);
    if (y > apex) apex = y;
    trace.push({ t, x, y });
    if (y <= 0 && vy < 0) break;
  }

  // Land exactly on the ground rather than one step below it.
  const drop = prev.y - y;
  const share = drop > 1e-9 ? prev.y / drop : 0;
  const landX = prev.x + (x - prev.x) * share;
  const landVx = prev.vx + (vx - prev.vx) * share;
  const landVy = prev.vy + (vy - prev.vy) * share;
  const hangTime = t - dt * (1 - share);
  trace[trace.length - 1] = { t: hangTime, x: landX, y: 0 };

  const carry = Math.max(0.5, landX * M_TO_YARDS);
  const descent = (Math.atan2(-landVy, Math.max(0.01, landVx)) * 180) / Math.PI;

  return {
    carry,
    apexFeet: apex * M_TO_FEET,
    descent: Math.max(1, descent),
    landingSpeed: Math.hypot(landVx, landVy) / MPH_TO_MS,
    landingSpin: spin / RPM_TO_RADS,
    hangTime,
    shape: sampleShape(trace, landX, carry),
  };
}

/** Evenly spaced in time, so the samples bunch where the ball is slow — near the apex. */
function sampleShape(
  trace: { t: number; x: number; y: number }[],
  landX: number,
  carry: number,
): { x: number; h: number }[] {
  const total = trace[trace.length - 1].t;
  const out: { x: number; h: number }[] = [];
  let index = 0;
  for (let i = 0; i <= SHAPE_SAMPLES; i++) {
    const want = (i / SHAPE_SAMPLES) * total;
    while (index < trace.length - 2 && trace[index + 1].t < want) index++;
    const a = trace[index];
    const b = trace[Math.min(trace.length - 1, index + 1)];
    const span = b.t - a.t;
    const f = span > 1e-9 ? (want - a.t) / span : 0;
    const px = a.x + (b.x - a.x) * f;
    const py = a.y + (b.y - a.y) * f;
    out.push({ x: landX > 1e-6 ? px / landX : 0, h: (py * M_TO_FEET) / carry });
  }
  out[out.length - 1] = { x: 1, h: 0 };
  return out;
}

// ---------------------------------------------------------------------------
// The neutral reference, one per club
// ---------------------------------------------------------------------------

/** What a middled strike from a perfect lie looks like with each club. */
export const NEUTRAL_FLIGHT: Record<ClubId, FlightProfile> = (() => {
  const out = {} as Record<ClubId, FlightProfile>;
  for (const club of CLUBS) {
    out[club.id] =
      club.id === 'P'
        ? { carry: 1, apexFeet: 0, descent: 1, landingSpeed: 0, landingSpin: 0, hangTime: 0, shape: [{ x: 0, h: 0 }, { x: 1, h: 0 }] }
        : simulateFlight({ ballSpeed: club.ballSpeed, launch: club.launch, backspin: club.spin });
  }
  return out;
})();

export function neutralLaunchFor(club: ClubDefinition): LaunchConditions {
  return { ballSpeed: club.ballSpeed, launch: club.launch, backspin: club.spin };
}

/** Descent angle for a stock shot, which is what the short game plans against. */
export function neutralDescent(clubId: ClubId): number {
  return NEUTRAL_FLIGHT[clubId].descent;
}

/**
 * Results quantised onto a grid and cached: the season simulation plays close to
 * a million shots, most of them near-neutral, and rounding ball speed to a
 * quarter of a per cent is far below anything the game can tell apart.
 */
const cache = new Map<string, FlightProfile>();

export function flightFor(launch: LaunchConditions): FlightProfile {
  const speed = Math.round(launch.ballSpeed * 2) / 2;
  const angle = Math.round(launch.launch * 2) / 2;
  const spin = Math.round(launch.backspin / 250) * 250;
  const air = Math.round((launch.airDensity ?? 1) * 100) / 100;
  const head = Math.round(launch.headwind ?? 0);
  const key = `${speed}|${angle}|${spin}|${air}|${head}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const profile = simulateFlight({ ballSpeed: speed, launch: angle, backspin: spin, airDensity: air, headwind: head });
  // The cache is unbounded in principle but bounded in practice by the grid; a
  // ceiling keeps a pathological season from growing it without limit.
  if (cache.size > 40000) cache.clear();
  cache.set(key, profile);
  return profile;
}

/**
 * The carry this trajectory produces as a share of what the club's neutral one
 * does. This is the number that turns physics into yards without disturbing the
 * yardage ladder.
 */
export function carryRatio(clubId: ClubId, profile: FlightProfile): number {
  return profile.carry / NEUTRAL_FLIGHT[clubId].carry;
}

export { CLUB_BY_ID };
