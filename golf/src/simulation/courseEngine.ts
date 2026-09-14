/**
 * Turning a hole *design* into a hole you can play.
 *
 * Holes are authored as specs — par, yardage, where the dogleg turns, where the
 * bunkers sit relative to the landing zone, how the green tilts. This module
 * realises that spec as geometry in yards and answers the only two questions
 * the rest of the game asks of a golf course:
 *
 *   what is the ball sitting on, and how high is it.
 *
 * The grass gradient (fairway → first cut → light → heavy → deep) is not stored
 * as five nested polygons. It falls out of the distance from the centreline
 * compared with the fairway's width at that point, which is both cheaper and
 * gives an organic edge for free.
 */

import {
  type Blob,
  type Bounds,
  type Vec2,
  add,
  blobContains,
  blobEdgeDistance,
  boundsOf,
  dist,
  expandBounds,
  inBounds,
  norm,
  perp,
  pointAlongPolyline,
  pointInPolygon,
  polylineLength,
  projectToPolyline,
  scale,
  smoothPath,
  sub,
  unionBounds,
  vec,
} from './geometry';
import { createRng, clamp, lerp, smoothstep } from './rng';
import type { Course, CourseStyle, CourseStyleId, HoleGeometry, HoleSpec, LieType } from './types';
import { COURSE_STYLES } from '../data/courseStyles';

export function styleFor(id: CourseStyleId): CourseStyle {
  return COURSE_STYLES[id];
}

// ---------------------------------------------------------------------------
// Building a hole
// ---------------------------------------------------------------------------

function centerlineFor(spec: HoleSpec): Vec2[] {
  const yards = spec.yards;
  const bendAt = clamp(spec.doglegAt, 0.3, 0.85);
  const controls: Vec2[] = [
    vec(0, 0),
    vec(spec.dogleg * 0.04, yards * bendAt * 0.45),
    vec(spec.dogleg * 0.42, yards * bendAt),
    vec(spec.dogleg * 0.92, yards * lerp(bendAt, 1, 0.62)),
    vec(spec.dogleg, yards),
  ];
  const path = smoothPath(controls, 10);
  // The scorecard yardage is measured along the centreline, so normalise.
  const length = polylineLength(path);
  const k = yards / length;
  return path.map((p) => vec(p.x * k, p.y * k));
}

function blobFrom(center: Vec2, radius: number, seed: string, stretch: number, axis: number, wobble = 0.16): Blob {
  const rng = createRng(seed);
  return {
    center,
    radius,
    stretch,
    axis,
    harmonics: [
      [wobble, 2, rng.range(0, Math.PI * 2)],
      [wobble * 0.6, 3, rng.range(0, Math.PI * 2)],
      [wobble * 0.35, 5, rng.range(0, Math.PI * 2)],
    ],
  };
}

/** A polygon hugging one side of the corridor, for coastal strips and waste. */
function stripPolygon(
  centerline: Vec2[],
  from: number,
  to: number,
  side: -1 | 1,
  offset: number,
  width: number,
  seed: string,
): Vec2[] {
  const rng = createRng(seed);
  const phase = rng.range(0, Math.PI * 2);
  const inner: Vec2[] = [];
  const outer: Vec2[] = [];
  const steps = Math.max(6, Math.round((to - from) / 14));
  for (let i = 0; i <= steps; i++) {
    const along = lerp(from, to, i / steps);
    const { point, tangent } = pointAlongPolyline(centerline, along);
    const right = perp(tangent);
    const wobble = Math.sin(along * 0.035 + phase) * 6 + Math.sin(along * 0.011 + phase * 2) * 9;
    const innerOffset = offset + wobble * 0.5;
    inner.push(add(point, scale(right, side * innerOffset)));
    outer.push(add(point, scale(right, side * (innerOffset + width + wobble * 0.3))));
  }
  return [...inner, ...outer.reverse()];
}

/** Offset outline of the mown corridor, used for rendering the grass bands. */
function corridorPolygon(
  centerline: Vec2[],
  length: number,
  halfWidth: (along: number) => number,
  extra: number,
): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const steps = Math.max(24, Math.round(length / 8));
  for (let i = 0; i <= steps; i++) {
    const along = (i / steps) * length;
    const { point, tangent } = pointAlongPolyline(centerline, along);
    const r = perp(tangent);
    const w = halfWidth(along) + extra;
    if (w <= 0.2) continue;
    right.push(add(point, scale(r, w)));
    left.push(add(point, scale(r, -w)));
  }
  return [...right, ...left.reverse()];
}

export function buildHole(course: Course, spec: HoleSpec): HoleGeometry {
  const style = styleFor(course.style);
  const rng = createRng(`${course.id}:${spec.number}:geometry`);
  const centerline = centerlineFor(spec);
  const length = polylineLength(centerline);
  const tee = centerline[0];
  const finalTangent = norm(sub(centerline[centerline.length - 1], centerline[centerline.length - 3]));
  const greenCenter = centerline[centerline.length - 1];
  const right = perp(finalTangent);

  // --- Fairway width -------------------------------------------------------
  const widthPhase = rng.range(0, Math.PI * 2);
  const teeRamp = spec.par === 3 ? 30 : 34;
  const fairwayStart = spec.par === 3 ? Math.min(70, spec.yards * 0.45) : 18;
  const fairwayEnd = length - spec.greenSize * 1.35;
  const landingAt = spec.par === 5 ? length * 0.38 : length * clamp(spec.doglegAt, 0.35, 0.8);
  const baseWidth = spec.fairwayWidth * (spec.par === 3 ? 0.72 : 1);
  const halfWidth = (along: number): number => {
    if (along <= fairwayStart || along >= fairwayEnd + spec.greenSize * 1.1) return 0;
    const open = smoothstep(fairwayStart, fairwayStart + teeRamp, along);
    const close = 1 - smoothstep(fairwayEnd, fairwayEnd + spec.greenSize * 1.05, along);
    // Widest through the landing zone, pinched where the architect wants you thinking.
    const landing = 1 + 0.10 * Math.exp(-(((along - landingAt) / 90) ** 2));
    const texture = 1 + 0.11 * Math.sin(along * 0.042 + widthPhase) + 0.06 * Math.sin(along * 0.017 + widthPhase * 1.7);
    return baseWidth * open * close * landing * texture;
  };

  // --- Green ---------------------------------------------------------------
  const greenAxis = Math.atan2(finalTangent.y, finalTangent.x) + rng.range(-0.5, 0.5);
  const green = blobFrom(
    greenCenter,
    spec.greenSize,
    `${course.id}:${spec.number}:green`,
    rng.range(1.05, 1.45),
    greenAxis,
    0.13,
  );
  const pin = add(add(greenCenter, scale(right, spec.pin.x)), scale(finalTangent, spec.pin.y));

  // --- Bunkers -------------------------------------------------------------
  const bunkers = spec.bunkers.map((b, i) => {
    const { point, tangent } = pointAlongPolyline(centerline, Math.min(b.along, length));
    const r = perp(tangent);
    const center = add(point, scale(r, b.lateral));
    const axis = Math.atan2(tangent.y, tangent.x) + (b.kind === 'fairway' ? 0 : rng.range(-0.7, 0.7));
    return {
      blob: blobFrom(center, b.size, `${course.id}:${spec.number}:bunker:${i}`, b.stretch ?? (b.kind === 'fairway' ? 1.7 : 1.25), axis, 0.22),
      kind: b.kind,
      deep: b.deep ?? b.kind === 'greenside',
    };
  });

  // --- Water ---------------------------------------------------------------
  const water = spec.water.map((w, i) => {
    if (w.strip) {
      const polygon = stripPolygon(centerline, w.strip.from, w.strip.to, w.strip.side, w.strip.offset, w.strip.width, `${course.id}:${spec.number}:strip:${i}`);
      return { polygon, bounds: boundsOf(polygon) };
    }
    const { point, tangent } = pointAlongPolyline(centerline, Math.min(w.along, length));
    const r = perp(tangent);
    const center = add(point, scale(r, w.lateral));
    const blob = blobFrom(center, w.size, `${course.id}:${spec.number}:water:${i}`, w.stretch ?? 1.3, Math.atan2(tangent.y, tangent.x), 0.18);
    return { blob, bounds: expandBounds(boundsOf([center]), w.size * (w.stretch ?? 1.3) * 1.6) };
  });

  // A pond that overlaps the putting surface is an authoring slip, not a design:
  // it turns every approach on that side into a penalty stroke. Push any water
  // that has crept into the green complex back out to a fair distance.
  for (const w of water) {
    if (!w.blob) continue;
    const reach = w.blob.radius * w.blob.stretch * 1.16;
    const need = spec.greenSize + 7 + reach;
    const gap = dist(w.blob.center, greenCenter);
    if (gap < need && gap > 1e-6) {
      const push = norm(sub(w.blob.center, greenCenter));
      w.blob.center = add(greenCenter, scale(push, need));
      w.bounds = expandBounds(boundsOf([w.blob.center]), reach);
    }
  }

  // --- Desert waste --------------------------------------------------------
  const waste = (spec.waste ?? []).map((w, i) => {
    const polygon = stripPolygon(centerline, w.from, w.to, w.side, w.offset, w.width, `${course.id}:${spec.number}:waste:${i}`);
    return { polygon, bounds: boundsOf(polygon) };
  });

  // --- Elevation -----------------------------------------------------------
  // Cross slope in feet per yard of lateral offset. A fairway that tilts more
  // than about 7% is a ski run, so this stays small even on the desert course.
  const tilt = rng.range(-0.085, 0.085) * (style.id === 'desert' ? 2.1 : style.id === 'parkland' ? 1.3 : 0.9);
  const noisePhase = rng.range(0, Math.PI * 2);
  const bendAt = clamp(spec.doglegAt, 0.3, 0.85);
  const elevationAt = (p: Vec2): number => {
    const proj = projectToPolyline(centerline, p);
    const t = clamp(proj.along / length, 0, 1);
    let base: number;
    if (t <= bendAt) base = lerp(0, spec.elevation.landing, t / bendAt);
    else base = lerp(spec.elevation.landing, spec.elevation.green, (t - bendAt) / (1 - bendAt));
    const lateral = proj.lateral * tilt;
    const roll = Math.sin(proj.along * 0.021 + noisePhase) * (style.id === 'links' ? 3.4 : 2.2)
      + Math.sin(proj.along * 0.0075 + noisePhase * 2.3) * 4.2 * (style.id === 'desert' ? 1.6 : 1);
    return base + lateral + roll;
  };

  // --- Trees ---------------------------------------------------------------
  const trees: HoleGeometry['trees'] = [];
  if (spec.trees > 0.02) {
    const bands = style.bands;
    const edge = bands.firstCut + bands.lightRough + bands.heavyRough + bands.deepRough;
    const spacing = lerp(34, 11, spec.trees);
    for (let along = 12; along < length + 40; along += spacing * rng.range(0.65, 1.35)) {
      for (const side of [-1, 1] as const) {
        if (!rng.chance(0.55 + spec.trees * 0.4)) continue;
        const { point, tangent } = pointAlongPolyline(centerline, Math.min(along, length));
        const r = perp(tangent);
        const depth = rng.range(2, 46);
        const w = halfWidth(Math.min(along, length));
        const canopy = style.id === 'desert' ? rng.range(2.2, 4.4) : rng.range(4.5, 10);
        const position = add(point, scale(r, side * (Math.max(w, 12) + edge * 0.55 + depth)));
        trees.push({ position, radius: canopy, shade: rng.range(0, 1) });
      }
    }
    // A handful of specimen trees close enough to matter.
    const specimens = Math.round(spec.trees * 7);
    for (let i = 0; i < specimens; i++) {
      const along = rng.range(length * 0.22, length * 0.95);
      const side = rng.chance(0.5) ? -1 : 1;
      const { point, tangent } = pointAlongPolyline(centerline, along);
      const r = perp(tangent);
      const w = halfWidth(along);
      const position = add(point, scale(r, side * (w + rng.range(3, 13))));
      trees.push({ position, radius: rng.range(5, 11), shade: rng.range(0, 1) });
    }
  }

  // --- Render bands and bounds --------------------------------------------
  const b = style.bands;
  const bands = {
    fairway: corridorPolygon(centerline, length, halfWidth, 0),
    firstCut: corridorPolygon(centerline, length, halfWidth, b.firstCut),
    lightRough: corridorPolygon(centerline, length, halfWidth, b.firstCut + b.lightRough),
    heavyRough: corridorPolygon(centerline, length, halfWidth, b.firstCut + b.lightRough + b.heavyRough),
    deepRough: corridorPolygon(centerline, length, halfWidth, b.firstCut + b.lightRough + b.heavyRough + b.deepRough),
  };

  let bounds = expandBounds(boundsOf(bands.deepRough), 22);
  bounds = unionBounds(bounds, expandBounds(boundsOf([greenCenter]), spec.greenSize * 2.4));
  for (const w of water) bounds = unionBounds(bounds, expandBounds(w.bounds, 8));
  for (const w of waste) bounds = unionBounds(bounds, expandBounds(w.bounds, 8));
  for (const t of trees) bounds = unionBounds(bounds, expandBounds(boundsOf([t.position]), t.radius + 4));

  const built: HoleGeometry = {
    spec,
    course,
    style,
    tee,
    greenCenter,
    pin,
    centerline,
    centerlineLength: length,
    fairwayHalfWidth: halfWidth,
    green,
    bunkers,
    water,
    waste,
    trees,
    exactElevationAt: elevationAt,
    elevationAt,
    bounds,
    bands,
  };
  // Once the grid exists, every caller gets the interpolated version; the grid
  // itself is built from the exact one, so this cannot become self-referential.
  built.elevationAt = (p: Vec2) => gridElevationAt(built, p);
  return built;
}

// ---------------------------------------------------------------------------
// Terrain queries
// ---------------------------------------------------------------------------

export interface TerrainInfo {
  lie: LieType;
  /** Signed lateral offset from the centreline; positive is right. */
  lateral: number;
  /** Arc length from the tee, in yards. */
  along: number;
  /** Fairway half-width where the ball is. */
  fairwayHalfWidth: number;
  elevation: number;
  /** Distance from the edge of the green in yards; negative when on it. */
  greenEdge: number;
  /** Inside a bunker, how deep it is. */
  deepBunker: boolean;
}

const FRINGE_WIDTH = 3.6;

export function terrainAt(hole: HoleGeometry, p: Vec2, options?: { onTee?: boolean }): TerrainInfo {
  const proj = projectToPolyline(hole.centerline, p);
  const halfWidth = hole.fairwayHalfWidth(proj.along);
  const greenEdge = blobEdgeDistance(hole.green, p);
  const info: TerrainInfo = {
    lie: 'fairway',
    lateral: proj.lateral,
    along: proj.along,
    fairwayHalfWidth: halfWidth,
    elevation: hole.elevationAt(p),
    greenEdge,
    deepBunker: false,
  };

  if (options?.onTee) {
    info.lie = 'tee';
    return info;
  }

  // Green first: a green-side bunker's edge can overlap the collar.
  if (greenEdge <= 0) {
    info.lie = 'green';
    return info;
  }

  for (const w of hole.water) {
    if (w.blob) {
      if (blobContains(w.blob, p)) {
        info.lie = 'water';
        return info;
      }
    } else if (w.polygon && inBounds(w.bounds, p) && pointInPolygon(w.polygon, p)) {
      info.lie = 'water';
      return info;
    }
  }

  for (const bunker of hole.bunkers) {
    if (blobContains(bunker.blob, p)) {
      info.lie = bunker.kind === 'greenside' ? 'greensideBunker' : 'fairwayBunker';
      info.deepBunker = bunker.deep;
      return info;
    }
  }

  if (greenEdge <= FRINGE_WIDTH) {
    info.lie = 'fringe';
    return info;
  }

  for (const w of hole.waste) {
    if (inBounds(w.bounds, p) && pointInPolygon(w.polygon, p)) {
      info.lie = 'waste';
      return info;
    }
  }

  for (const tree of hole.trees) {
    if (dist(tree.position, p) <= tree.radius * 0.95) {
      info.lie = 'recovery';
      return info;
    }
  }

  const bands = hole.style.bands;
  const offLine = Math.abs(proj.lateral);
  if (halfWidth > 0.5 && offLine <= halfWidth) {
    info.lie = 'fairway';
    return info;
  }
  const fromFairway = offLine - Math.max(halfWidth, 0);
  const edges = [
    bands.firstCut,
    bands.firstCut + bands.lightRough,
    bands.firstCut + bands.lightRough + bands.heavyRough,
    bands.firstCut + bands.lightRough + bands.heavyRough + bands.deepRough,
  ];
  // Behind the tee or long past the green there is no mown grass to speak of.
  const outsidePlay = proj.along <= 1 || proj.along >= hole.centerlineLength - 1;
  const shift = outsidePlay ? Math.max(0, Math.min(24, Math.abs(proj.along <= 1 ? -proj.along : proj.along - hole.centerlineLength))) : 0;
  // A green complex has its own apron: collar, then greenside rough that gets
  // deeper the further you are from the putting surface. Without this, the
  // fairway has already tapered to nothing by the green and every missed green
  // is in deep grass, which is not how golf courses work.
  const fromGreen = Math.max(0, greenEdge - FRINGE_WIDTH) / 2.1;
  const effective = Math.min(fromFairway + shift, fromGreen);

  if (effective <= edges[0]) info.lie = 'firstCut';
  else if (effective <= edges[1]) info.lie = 'lightRough';
  else if (effective <= edges[2]) info.lie = 'heavyRough';
  else if (effective <= edges[3]) info.lie = 'deepRough';
  else if (effective <= edges[3] + hole.style.surroundWidth) {
    info.lie = hole.style.surround === 'recovery' ? 'pineStraw' : hole.style.surround;
  } else {
    info.lie = 'ob';
  }
  return info;
}

export function lieAt(hole: HoleGeometry, p: Vec2): LieType {
  return terrainAt(hole, p).lie;
}

/** Distance to the pin in yards. */
export function toPin(hole: HoleGeometry, p: Vec2): number {
  return dist(p, hole.pin);
}

/**
 * Green surface slope at a point, in percent. The hole's authored tilt plus a
 * couple of contours, so a green has spots where a putt is genuinely awkward.
 */
export function greenSlopeAt(hole: HoleGeometry, p: Vec2): Vec2 {
  const rel = sub(p, hole.greenCenter);
  const spec = hole.spec.greenSlope;
  const contour = 0.6 * Math.sin(rel.x * 0.22 + hole.spec.number) + 0.6 * Math.cos(rel.y * 0.19 - hole.spec.number * 0.7);
  const base = add(
    scale(vec(1, 0), spec.x + contour * 0.35),
    scale(vec(0, 1), spec.y - contour * 0.3),
  );
  return base;
}

/** True when a point is inside the green blob. */
export function onGreen(hole: HoleGeometry, p: Vec2): boolean {
  return blobEdgeDistance(hole.green, p) <= 0;
}

/** Nearest point that is not in a hazard, walking back along a line. */
export function dropPoint(hole: HoleGeometry, from: Vec2, to: Vec2): Vec2 {
  const direction = norm(sub(from, to));
  let candidate = to;
  for (let step = 2; step <= 90; step += 2) {
    candidate = add(to, scale(direction, step));
    const lie = terrainAt(hole, candidate).lie;
    if (lie !== 'water' && lie !== 'ob') return candidate;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// A coarse lie grid, for integrating probabilities
// ---------------------------------------------------------------------------

/**
 * Working out "what are the odds this shot finds the water" means sampling the
 * terrain eighty times per candidate shot, and the tournament AI does that for
 * every shot of every round of every event. Baking each hole's lies into a
 * 2.5-yard grid once turns those lookups into an array index.
 *
 * The exact `terrainAt` is still what decides where a struck ball actually ends
 * up — the grid is only ever used for expectations.
 */
const LIE_ORDER: LieType[] = [
  'tee', 'fairway', 'firstCut', 'lightRough', 'heavyRough', 'deepRough',
  'fairwayBunker', 'greensideBunker', 'pineStraw', 'waste', 'recovery',
  'fringe', 'green', 'water', 'ob',
];

const GRID_CELL = 2.5;

interface LieGrid {
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  data: Uint8Array;
  /** Height in feet at the same cell centres, for interpolation. */
  elevation: Float32Array;
}

const gridCache = new Map<string, LieGrid>();

function gridFor(hole: HoleGeometry): LieGrid {
  const key = `${hole.course.id}:${hole.spec.number}`;
  const cached = gridCache.get(key);
  if (cached) return cached;
  const { bounds } = hole;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / GRID_CELL) + 1;
  const rows = Math.ceil((bounds.maxY - bounds.minY) / GRID_CELL) + 1;
  const data = new Uint8Array(cols * rows);
  const elevation = new Float32Array(cols * rows);
  const point = { x: 0, y: 0 };
  // terrainAt reports the height under the ball, and the grid is what makes that
  // cheap — so while the grid is being built it has to read the exact field, or
  // it would be asking itself for the answer it is in the middle of computing.
  const exact: HoleGeometry = { ...hole, elevationAt: hole.exactElevationAt };
  for (let row = 0; row < rows; row++) {
    point.y = bounds.minY + row * GRID_CELL;
    for (let col = 0; col < cols; col++) {
      point.x = bounds.minX + col * GRID_CELL;
      const index = row * cols + col;
      data[index] = LIE_ORDER.indexOf(terrainAt(exact, point).lie);
      elevation[index] = hole.exactElevationAt(point);
    }
  }
  const grid = { minX: bounds.minX, minY: bounds.minY, cols, rows, data, elevation };
  gridCache.set(key, grid);
  return grid;
}

/**
 * Height above the tee, bilinearly interpolated from the same grid.
 *
 * The exact version projects onto the centreline, and the shot engine asks for
 * elevation about twenty times per shot — once for every club it is considering,
 * twice per candidate target, four more to find the slope under the ball. Across
 * a season that was the single most expensive thing in the simulation, for a
 * height field that is smooth enough to interpolate without anybody noticing.
 */
export function gridElevationAt(hole: HoleGeometry, p: Vec2): number {
  const grid = gridFor(hole);
  const fx = (p.x - grid.minX) / GRID_CELL;
  const fy = (p.y - grid.minY) / GRID_CELL;
  const col = Math.floor(fx);
  const row = Math.floor(fy);
  if (col < 0 || row < 0 || col >= grid.cols - 1 || row >= grid.rows - 1) {
    return hole.exactElevationAt(p);
  }
  const tx = fx - col;
  const ty = fy - row;
  const base = row * grid.cols + col;
  const a = grid.elevation[base];
  const b = grid.elevation[base + 1];
  const c = grid.elevation[base + grid.cols];
  const d = grid.elevation[base + grid.cols + 1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Approximate lie, from the grid. Off the edge of the world is out of bounds. */
export function approximateLieAt(hole: HoleGeometry, p: Vec2): LieType {
  const grid = gridFor(hole);
  const col = Math.round((p.x - grid.minX) / GRID_CELL);
  const row = Math.round((p.y - grid.minY) / GRID_CELL);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 'ob';
  return LIE_ORDER[grid.data[row * grid.cols + col]];
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const holeCache = new Map<string, HoleGeometry>();

/** Holes are deterministic, so build each one once per session. */
export function holeGeometry(course: Course, holeNumber: number): HoleGeometry {
  const key = `${course.id}:${holeNumber}`;
  const cached = holeCache.get(key);
  if (cached) return cached;
  const spec = course.holes.find((h) => h.number === holeNumber);
  if (!spec) throw new Error(`No hole ${holeNumber} on ${course.name}`);
  const built = buildHole(course, spec);
  holeCache.set(key, built);
  return built;
}

/**
 * The same hole with the flag somewhere else. Pin positions move day to day, so
 * a tournament is four different examinations of the same eighteen holes; the
 * geometry and the lie grid are unchanged, so this is a shallow copy.
 */
export function withPin(hole: HoleGeometry, pin: Vec2): HoleGeometry {
  // The elevation grid is keyed by course and hole number, so the copy shares it.
  return { ...hole, pin };
}

/**
 * Where the flag is cut on a given day. Four rounds get four quadrants of the
 * green, and Sunday's is tucked closest to an edge.
 */
export function pinForRound(hole: HoleGeometry, round: number): Vec2 {
  const rng = createRng(`${hole.course.id}:${hole.spec.number}:pin:${round}`);
  const quadrant = ((round - 1) % 4) * (Math.PI / 2) + rng.range(-0.5, 0.5);
  const tuck = round >= 4 ? 0.62 : round === 3 ? 0.54 : 0.42;
  const reach = hole.green.radius * tuck * rng.range(0.85, 1.1);
  const candidate = add(hole.greenCenter, vec(Math.cos(quadrant) * reach, Math.sin(quadrant) * reach));
  // Never cut a pin off the putting surface.
  return blobEdgeDistance(hole.green, candidate) < -2.5 ? candidate : hole.pin;
}

export function courseBounds(course: Course): Bounds {
  let bounds = holeGeometry(course, 1).bounds;
  for (let i = 2; i <= course.holes.length; i++) bounds = unionBounds(bounds, holeGeometry(course, i).bounds);
  return bounds;
}
