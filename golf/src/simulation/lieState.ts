/**
 * Where the ball is actually sitting.
 *
 * A lie type says "light rough". It does not say whether the ball is perched on
 * top of the grass with the whole back of it showing, or nestled down at the
 * bottom of it. That difference is worth more than the difference between light
 * rough and the fairway, and it is the thing a player walks up to the ball to
 * find out.
 *
 * So `LieState` carries a continuous quality from 0 to 1 alongside the material,
 * and everything downstream reads the state rather than the lie type. The
 * quality is drawn from the ball's own position, not from the shot: walking up
 * to the same ball twice finds the same lie, and the dispersion overlay the
 * player is shown before the swing is computed from the same lie the swing gets.
 */

import { createRng, clamp, lerp } from './rng';
import {
  BALL_DIAMETER_IN,
  DEFAULT_SURFACE,
  PHYSICS,
  SURFACES,
  type SurfaceId,
  type SurfaceMaterial,
} from './surfaces';
import type { Vec2 } from './geometry';
import type { LieType, Weather } from './types';

export interface LieState {
  lie: LieType;
  surface: SurfaceMaterial;
  /** 0 (unplayable) → 1 (teed up). The single most useful number about a lie. */
  quality: number;
  /** 0–1 share of the ball below the top of the surface. */
  ballDepth: number;
  /** Inches of grass standing above the top of the ball. */
  grassAbove: number;
  /** 0–1 after weather. */
  moisture: number;
  /** 0–1 after weather. */
  firmness: number;
  /** True when the ball is perched up and the face can get right under it. */
  sittingUp: boolean;
  /** What a caddie would say about it. */
  note: string;
}

/** Deterministic per-ball roll, so the same ball always has the same lie. */
function lieSeed(ball: Vec2, lie: LieType): number {
  const rng = createRng(`lie:${lie}:${ball.x.toFixed(2)}:${ball.y.toFixed(2)}`);
  return rng.next();
}

/**
 * Which sand a bunker is offering today.
 *
 * Fairway bunkers are shallower and better packed than greenside ones, deep
 * bunkers are built to hold a ball at the bottom of a face, and a wet week
 * packs all of it down — which is why the same bunker is a nip-it lie on Sunday
 * after Saturday's rain and a fluff-fest on a dry Thursday.
 */
function sandFor(lie: LieType, deepBunker: boolean, wetness: number, roll: number): SurfaceId {
  if (deepBunker) return roll < 0.55 + wetness * 0.2 ? 'deepSand' : 'softSand';
  if (lie === 'fairwayBunker') {
    // A fairway bunker is usually firm, and rain makes it firmer still.
    return roll < 0.72 + wetness * 0.22 ? 'firmSand' : 'softSand';
  }
  // Greenside sand is built to be soft, but a soaked bunker plays like concrete.
  if (wetness > 0.55 && roll < wetness) return 'firmSand';
  return roll < 0.14 ? 'deepSand' : 'softSand';
}

export interface LieStateOptions {
  weather?: Weather;
  deepBunker?: boolean;
  /** Override the roll that picks the lie, for tests and for the debug panel. */
  quality?: number;
}

/**
 * The lie a ball at this position is in.
 *
 * Weather moves the material before the ball is placed in it: rain wets the
 * grass, softens the ground and packs the sand, and every one of those is a
 * property of the surface rather than a special case in the shot engine.
 */
export function lieStateFor(lie: LieType, ball: Vec2, options: LieStateOptions = {}): LieState {
  const weather = options.weather;
  const wetness = weather ? clamp(weather.softness * 0.7 + weather.rain * 0.5, 0, 1) : 0;
  const roll = lieSeed(ball, lie);

  const surfaceId: SurfaceId =
    lie === 'fairwayBunker' || lie === 'greensideBunker'
      ? sandFor(lie, options.deepBunker ?? false, wetness, roll)
      : DEFAULT_SURFACE[lie];
  const base = SURFACES[surfaceId];

  const moisture = clamp(base.moisture + wetness * PHYSICS.rainMoisture, 0, 1);
  const firmness = clamp(
    base.firmness * lerp(1, 1 - PHYSICS.rainSoftening, wetness) + (base.kind === 'sand' ? wetness * 0.30 : 0),
    0.05,
    1,
  );

  // How the ball settled. A surface with tall, dense grass has a wide spread —
  // the same rough gives you a perched lie and a buried one twenty yards apart —
  // and a fairway has almost none.
  const spread = PHYSICS.lieSpread * (base.liePenalty + base.burial) * 0.5 + base.bounceRandom * 0.22;
  // A second, independent roll so depth and quality are not the same number
  // wearing two hats: a ball can sit down in a clean patch or perch in a dense one.
  const depthRoll = lieSeed({ x: ball.y, y: ball.x }, lie);
  const rawQuality = options.quality ?? clamp(1 - base.liePenalty + (roll - 0.5) * 2 * spread, 0, 1);
  const quality = clamp(rawQuality, 0, 1);

  const ballDepth = clamp(
    base.burial * lerp(1 + PHYSICS.burialSpread, 1 - PHYSICS.burialSpread, quality) +
      (depthRoll - 0.5) * 0.12 * base.bounceRandom,
    0,
    0.95,
  );
  // Grass standing above the top of the ball: the tall stuff that the face has
  // to get through before it reaches anything.
  const grassAbove = Math.max(0, base.grassHeight - BALL_DIAMETER_IN * (1 - ballDepth));
  const sittingUp = base.kind === 'grass' && ballDepth < base.burial * 0.55 && base.grassHeight > 0.8;

  return {
    lie,
    surface: base,
    quality,
    ballDepth,
    grassAbove,
    moisture,
    firmness,
    sittingUp,
    note: describeLie(base, quality, sittingUp, ballDepth),
  };
}

/** A neutral lie on a given surface, for calibration and for tests. */
export function neutralLie(surfaceId: SurfaceId, lie: LieType, quality = 1): LieState {
  const base = SURFACES[surfaceId];
  const ballDepth = clamp(base.burial * lerp(1 + PHYSICS.burialSpread, 1 - PHYSICS.burialSpread, quality), 0, 0.95);
  return {
    lie,
    surface: base,
    quality,
    ballDepth,
    grassAbove: Math.max(0, base.grassHeight - BALL_DIAMETER_IN * (1 - ballDepth)),
    moisture: base.moisture,
    firmness: base.firmness,
    sittingUp: base.kind === 'grass' && ballDepth < base.burial * 0.55 && base.grassHeight > 0.8,
    note: base.note,
  };
}

function describeLie(surface: SurfaceMaterial, quality: number, sittingUp: boolean, depth: number): string {
  if (surface.kind === 'hazard') return surface.note;
  if (surface.kind === 'sand') {
    if (depth > 0.5) return 'Plugged in the sand — just get it out.';
    if (quality > 0.75) return 'Sitting cleanly on the sand. It can be nipped.';
    return surface.note;
  }
  if (surface.grassHeight < 0.6) return surface.note;
  if (sittingUp) return 'Sitting up on top of the grass — watch for a flyer.';
  if (quality < 0.3) return 'Sitting right down in it. Getting a club on the ball is the job.';
  if (quality > 0.78) return 'A good lie for the rough — the ball is up.';
  return surface.note;
}

/** A short label for the UI: "Light Rough · sitting up". */
export function lieLabel(state: LieState): string {
  if (state.surface.kind === 'hazard') return state.surface.name;
  const quality = state.quality;
  const tail =
    state.sittingUp ? 'sitting up'
    : state.ballDepth > 0.55 ? 'buried'
    : quality > 0.8 ? 'clean'
    : quality < 0.32 ? 'sat down'
    : null;
  return tail ? `${state.surface.name} · ${tail}` : state.surface.name;
}
