/**
 * Sampling the shot animation: where the ball is at this instant, how high it
 * is, and the arc it has already flown.
 *
 * The simulation hands the view a parabola and a roll-out. Everything about how
 * that reads as a golf shot — smooth motion between the parabola's 27 points,
 * the ball coming off the club faster than it lands, the hops before the ball
 * settles, a putt dying rather than sliding at a constant speed — lives here,
 * so the renderer only has to draw what it is given and a harness can check the
 * timing without a canvas.
 *
 * Heights are in feet, matching `FlightAnimation.path`.
 */

import type { FlightAnimation } from '../../game/session';
import type { Vec2 } from '../../simulation/geometry';

export interface FlightPoint {
  x: number;
  y: number;
  /** Height above the ground in feet. */
  h: number;
}

export interface FlightSample {
  /** Where the ball is now. */
  position: FlightPoint;
  /** The arc flown so far, ending at `position`. */
  trail: FlightPoint[];
  /** This shot's apex in feet, so the view can scale height to the shot. */
  apex: number;
  phase: 'flight' | 'bounce' | 'roll' | 'putt';
  /** Seconds since the ball first touched the ground, or null while airborne. */
  sinceLanding: number | null;
  /** The first pitch mark, once the ball has reached it. */
  landing: Vec2 | null;
  /** True once the whole animation has played out. */
  done: boolean;
}

/** Share of the animation spent in the air. The rest is the ground. */
const FLIGHT_SHARE = 0.74;
/** Spans of the ground phase given to the first and second hops. */
const FIRST_HOP = 0.3;
const SECOND_HOP = 0.22;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A point part-way along an evenly spaced path, interpolated rather than snapped. */
function along<T extends { x: number; y: number }>(points: T[], u: number): { x: number; y: number; index: number } {
  const last = points.length - 1;
  const f = Math.max(0, Math.min(last, u * last));
  const i = Math.min(last, Math.floor(f));
  const j = Math.min(last, i + 1);
  const k = f - i;
  return { x: lerp(points[i].x, points[j].x, k), y: lerp(points[i].y, points[j].y, k), index: i };
}

function heightAlong(points: FlightPoint[], u: number): number {
  const last = points.length - 1;
  const f = Math.max(0, Math.min(last, u * last));
  const i = Math.min(last, Math.floor(f));
  const j = Math.min(last, i + 1);
  return lerp(points[i].h, points[j].h, f - i);
}

/** A hop: a small parabola over its own span. */
function hop(u: number, peak: number): number {
  return peak * 4 * u * (1 - u);
}

function apexOf(points: FlightPoint[]): number {
  let max = 0;
  for (const point of points) if (point.h > max) max = point.h;
  return max;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * The sample for an animation `elapsed` seconds in.
 *
 * `elapsed` past the duration returns the settled ball with `done` set, so the
 * caller can draw one last frame and then tell the session to move on.
 */
export function sampleFlight(animation: FlightAnimation, elapsed: number): FlightSample {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(0.05, animation.duration)));
  const done = elapsed >= animation.duration;

  if (animation.putt) {
    const points = animation.putt;
    // A putt dies into the hole; it does not slide at a constant speed.
    const u = 1 - Math.pow(1 - t, 1.9);
    const head = along(points, u);
    const trail = points.slice(0, head.index + 1).map((p) => ({ x: p.x, y: p.y, h: 0 }));
    trail.push({ x: head.x, y: head.y, h: 0 });
    return {
      position: { x: head.x, y: head.y, h: 0 },
      trail,
      apex: 0,
      phase: 'putt',
      sinceLanding: null,
      landing: null,
      done,
    };
  }

  const path = animation.path;
  const apex = apexOf(path);

  if (t < FLIGHT_SHARE) {
    // Drag: the ball covers ground fastest straight off the club face.
    const ft = t / FLIGHT_SHARE;
    const u = Math.pow(ft, 0.88);
    const head = along(path, u);
    const h = heightAlong(path, u);
    const trail = path.slice(0, head.index + 1).map((p) => ({ ...p }));
    trail.push({ x: head.x, y: head.y, h });
    return {
      position: { x: head.x, y: head.y, h },
      trail,
      apex,
      phase: 'flight',
      sinceLanding: null,
      landing: null,
      done: false,
    };
  }

  // The ground: from the first pitch mark to where the ball comes to rest.
  const roll = animation.rollPath;
  const from = roll[0];
  const to = roll[roll.length - 1];
  const rollYards = distance(from, to);
  const rt = (t - FLIGHT_SHARE) / (1 - FLIGHT_SHARE);
  const eased = 1 - Math.pow(1 - rt, 2.2);

  // How hot the ball landed, read off how far it runs: a lob wedge stops on the
  // pitch mark, a low iron skips twice before it settles.
  const peak = Math.min(11, rollYards * 0.62);
  let h = 0;
  let phase: FlightSample['phase'] = 'roll';
  if (peak > 0.4) {
    if (rt < FIRST_HOP) {
      h = hop(rt / FIRST_HOP, peak);
      phase = 'bounce';
    } else if (rt < FIRST_HOP + SECOND_HOP) {
      h = hop((rt - FIRST_HOP) / SECOND_HOP, peak * 0.3);
      phase = 'bounce';
    }
  }

  const trail = path.map((p) => ({ ...p }));
  const position = { x: lerp(from.x, to.x, eased), y: lerp(from.y, to.y, eased), h };
  trail.push(position);
  return {
    position,
    trail,
    apex,
    phase,
    sinceLanding: (t - FLIGHT_SHARE) * animation.duration,
    landing: from,
    done,
  };
}

/** This shot's apex in feet, for anything that has to make room for the height. */
export function apexFeet(animation: FlightAnimation): number {
  return animation.putt ? 0 : apexOf(animation.path);
}
