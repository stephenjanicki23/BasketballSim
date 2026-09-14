/**
 * The camera maps yards to pixels. World +y runs down the hole and is drawn
 * upward on the screen, so the player is always looking from the ball toward the
 * green, whichever way the hole actually points on the compass.
 */

import type { Bounds, Vec2 } from '../../simulation/geometry';

export interface Camera {
  center: Vec2;
  /** Pixels per yard. */
  scale: number;
  width: number;
  height: number;
  /** Rotation in radians: the direction of play is turned to point up the screen. */
  rotation: number;
}

export function toScreen(camera: Camera, p: Vec2): { x: number; y: number } {
  const dx = p.x - camera.center.x;
  const dy = p.y - camera.center.y;
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return { x: camera.width / 2 + rx * camera.scale, y: camera.height / 2 - ry * camera.scale };
}

export function toWorld(camera: Camera, screen: { x: number; y: number }): Vec2 {
  const rx = (screen.x - camera.width / 2) / camera.scale;
  const ry = (camera.height / 2 - screen.y) / camera.scale;
  const c = Math.cos(-camera.rotation);
  const s = Math.sin(-camera.rotation);
  return {
    x: camera.center.x + (rx * c - ry * s),
    y: camera.center.y + (rx * s + ry * c),
  };
}

/** Fit a camera to a set of points plus a margin in yards. */
export function fitCamera(
  points: Vec2[],
  width: number,
  height: number,
  options: { rotation: number; margin?: number; maxScale?: number; minScale?: number },
): Camera {
  const margin = options.margin ?? 25;
  const c = Math.cos(options.rotation);
  const s = Math.sin(options.rotation);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const rx = p.x * c - p.y * s;
    const ry = p.x * s + p.y * c;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  const spanX = maxX - minX + margin * 2;
  const spanY = maxY - minY + margin * 2;
  const scale = Math.min(width / Math.max(spanX, 1), height / Math.max(spanY, 1));
  const midRx = (minX + maxX) / 2;
  const midRy = (minY + maxY) / 2;
  // Rotate the midpoint back into world space.
  const ic = Math.cos(-options.rotation);
  const is = Math.sin(-options.rotation);
  return {
    center: { x: midRx * ic - midRy * is, y: midRx * is + midRy * ic },
    scale: Math.max(options.minScale ?? 0.25, Math.min(options.maxScale ?? 14, scale)),
    width,
    height,
    rotation: options.rotation,
  };
}

export function boundsPoints(bounds: Bounds): Vec2[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ];
}
