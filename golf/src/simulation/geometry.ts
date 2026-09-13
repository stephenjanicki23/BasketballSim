/**
 * Plane geometry in yards.
 *
 * Every hole is built in its own space: the tee sits near the origin and +y
 * runs down the hole, so "long" is +y and "right" is +x from the tee. The
 * course's compass bearing lives on the hole spec, which is how one global wind
 * direction ends up playing differently on all eighteen holes.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rotate counter-clockwise by radians. */
export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** The unit vector 90° clockwise from `a` — "right of the line of play". */
export const perp = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: readonly Vec2[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function expandBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function inBounds(b: Bounds, p: Vec2): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** Even-odd ray cast. Polygons here are small (tens of points) and static. */
export function pointInPolygon(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export interface Projection {
  /** Arc length along the polyline, in yards. */
  along: number;
  /** Signed lateral offset; positive is right of the line of play. */
  lateral: number;
  /** Closest point on the polyline. */
  point: Vec2;
  /** Unit tangent at that point. */
  tangent: Vec2;
  /** 0..1 position along the whole polyline. */
  t: number;
}

/** Total length of a polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/**
 * Project a point onto a polyline. This is the workhorse of the terrain model:
 * "how far down the hole am I and how far off line" answers fairway-vs-rough,
 * corridor width and elevation all at once, so it runs millions of times in a
 * season simulation and is written to allocate exactly one object.
 */
export function projectToPolyline(points: readonly Vec2[], p: Vec2): Projection {
  let bestDistance2 = Infinity;
  let bestAlong = 0;
  let bestLateral = 0;
  let bestX = points[0].x;
  let bestY = points[0].y;
  let bestTx = 0;
  let bestTy = 1;
  let travelled = 0;
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const segLength = Math.sqrt(sx * sx + sy * sy);
    if (segLength < 1e-9) continue;
    const tx = sx / segLength;
    const ty = sy / segLength;
    const rx = p.x - a.x;
    const ry = p.y - a.y;
    let along = rx * tx + ry * ty;
    if (along < 0) along = 0;
    else if (along > segLength) along = segLength;
    const cx = a.x + tx * along;
    const cy = a.y + ty * along;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDistance2) {
      bestDistance2 = d2;
      bestAlong = travelled + along;
      // Right of the line of play is the tangent turned 90° clockwise.
      bestLateral = dx * ty + dy * -tx;
      bestX = cx;
      bestY = cy;
      bestTx = tx;
      bestTy = ty;
    }
    travelled += segLength;
  }
  total = travelled || 1;
  return {
    along: bestAlong,
    lateral: bestLateral,
    point: { x: bestX, y: bestY },
    tangent: { x: bestTx, y: bestTy },
    t: bestAlong / total,
  };
}

/** Point at a given arc length along a polyline, plus the tangent there. */
export function pointAlongPolyline(points: readonly Vec2[], distance: number): { point: Vec2; tangent: Vec2 } {
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segment = sub(b, a);
    const segLength = len(segment);
    if (travelled + segLength >= distance || i === points.length - 1) {
      const tangent = norm(segment);
      const local = Math.max(0, Math.min(segLength, distance - travelled));
      return { point: add(a, scale(tangent, local)), tangent };
    }
    travelled += segLength;
  }
  const last = points[points.length - 1];
  return { point: last, tangent: vec(0, 1) };
}

/** Catmull-Rom through the control points, for centrelines and green edges. */
export function smoothPath(controls: readonly Vec2[], segments = 8): Vec2[] {
  if (controls.length < 3) return [...controls];
  const out: Vec2[] = [];
  const pointAt = (i: number) => controls[Math.max(0, Math.min(controls.length - 1, i))];
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = pointAt(i - 1);
    const p1 = pointAt(i);
    const p2 = pointAt(i + 1);
    const p3 = pointAt(i + 2);
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(controls[controls.length - 1]);
  return out;
}

/**
 * A closed organic shape: a centre, a base radius and a handful of harmonics.
 * Greens, bunkers and lakes are all blobs — containment is O(1) and the outline
 * is smooth, which beats hand-listing forty vertices per bunker.
 */
export interface Blob {
  center: Vec2;
  radius: number;
  /** [amplitude (fraction of radius), frequency, phase] triples. */
  harmonics: readonly [number, number, number][];
  /** Stretch along `axis`; 1 is round. */
  stretch: number;
  /** Direction of the stretch, radians. */
  axis: number;
}

export function blobRadiusAt(blob: Blob, angle: number): number {
  let r = 1;
  for (const [amp, freq, phase] of blob.harmonics) r += amp * Math.sin(freq * angle + phase);
  // Elliptical stretch along `axis`.
  const local = angle - blob.axis;
  const c = Math.cos(local) / blob.stretch;
  const s = Math.sin(local);
  const ellipse = 1 / Math.hypot(c, s);
  return blob.radius * Math.max(0.25, r) * ellipse;
}

export function blobContains(blob: Blob, p: Vec2, grow = 0): boolean {
  const dx = p.x - blob.center.x;
  const dy = p.y - blob.center.y;
  const d2 = dx * dx + dy * dy;
  const outer = blob.radius * blob.stretch * 1.7 + grow;
  if (d2 > outer * outer) return false;
  const angle = Math.atan2(dy, dx);
  const r = blobRadiusAt(blob, angle) + grow;
  return d2 <= r * r;
}

/** Signed-ish distance from a blob edge: negative inside, positive outside. */
export function blobEdgeDistance(blob: Blob, p: Vec2): number {
  const dx = p.x - blob.center.x;
  const dy = p.y - blob.center.y;
  const d = Math.hypot(dx, dy);
  return d - blobRadiusAt(blob, Math.atan2(dy, dx));
}

export function blobOutline(blob: Blob, steps = 48): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const r = blobRadiusAt(blob, angle);
    points.push({ x: blob.center.x + Math.cos(angle) * r, y: blob.center.y + Math.sin(angle) * r });
  }
  return points;
}

export function blobBounds(blob: Blob): Bounds {
  return boundsOf(blobOutline(blob, 24));
}

/** Where a segment first crosses into a region, by bisection. Used for hazard entry points. */
export function findCrossing(
  from: Vec2,
  to: Vec2,
  inside: (p: Vec2) => boolean,
  steps = 48,
): Vec2 | null {
  let previous = from;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (inside(point)) {
      // Walk back toward the last known-good point.
      let lo = previous;
      let hi = point;
      for (let k = 0; k < 12; k++) {
        const mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
        if (inside(mid)) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    previous = point;
  }
  return null;
}

export const YARDS_PER_FOOT = 1 / 3;
export const FEET_PER_YARD = 3;
