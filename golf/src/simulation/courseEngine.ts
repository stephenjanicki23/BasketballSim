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
  type Shape,
  type Vec2,
  add,
  boundsOf,
  dist,
  expandBounds,
  norm,
  perp,
  pointAlongPolyline,
  polylineLength,
  projectToPolyline,
  scale,
  shapeFromBlob,
  shapeFromPolygon,
  sub,
  unionBounds,
  vec,
} from './geometry';
import { createRng, clamp, lerp, smoothstep } from './rng';
import type { BendSpec, Course, CourseStyle, CourseStyleId, HoleGeometry, HoleSpec, LieType } from './types';
import { COURSE_STYLES } from '../data/courseStyles';

export function styleFor(id: CourseStyleId): CourseStyle {
  return COURSE_STYLES[id];
}

// ---------------------------------------------------------------------------
// Building a hole
// ---------------------------------------------------------------------------

/**
 * How far the line of play has moved sideways by fraction `t` of the way down the
 * hole. Each bend contributes its shift over its own stretch, so bends compose:
 * two opposite ones make an S, two the same way make a hole that keeps turning,
 * and one with a small `turn` makes an elbow you cannot see round.
 */
function lateralProfile(spec: HoleSpec): (t: number) => number {
  const bends: BendSpec[] = spec.bends?.length
    ? spec.bends
    : [{ at: spec.doglegAt, shift: spec.dogleg, turn: 0.28 }];
  return (t: number) => {
    let lateral = 0;
    for (const bend of bends) {
      const turn = clamp(bend.turn ?? 0.16, 0.04, 0.5);
      // The turn has to finish inside the hole, or the fairway arrives at the
      // green still moving sideways and the green sits off the end of it.
      const at = clamp(bend.at, turn, 1 - turn * 0.35);
      lateral += bend.shift * smoothstep(at - turn, at + turn, t);
    }
    return lateral;
  };
}

function centerlineFor(spec: HoleSpec): Vec2[] {
  const yards = spec.yards;
  // A traced line wins over a generated one: it is the hole, measured off the
  // photograph, and only its scale needs settling. Normalising its length to the
  // card yardage is what keeps the game world in real yards.
  if (spec.centreline && spec.centreline.length >= 2) {
    const traced = spec.centreline;
    const length = polylineLength(traced);
    const k = yards / length;
    const origin = traced[0];
    return traced.map((p) => vec((p.x - origin.x) * k, (p.y - origin.y) * k));
  }
  const lateral = lateralProfile(spec);
  const steps = Math.max(40, Math.round(yards / 7));
  const path: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push(vec(lateral(t), yards * t));
  }
  // The scorecard yardage is measured along the centreline, so normalise.
  const length = polylineLength(path);
  const k = yards / length;
  return path.map((p) => vec(p.x * k, p.y * k));
}

/** Half-width of the fairway at a fraction along the hole, before the shaping. */
function widthProfile(spec: HoleSpec, base: number): (t: number) => number {
  const points = spec.widths;
  if (!points || points.length === 0) return () => base;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  return (t: number) => {
    if (t <= sorted[0].at) return sorted[0].half;
    for (let i = 1; i < sorted.length; i++) {
      if (t <= sorted[i].at) {
        const span = sorted[i].at - sorted[i - 1].at;
        const k = span <= 1e-6 ? 1 : (t - sorted[i - 1].at) / span;
        return lerp(sorted[i - 1].half, sorted[i].half, k);
      }
    }
    return sorted[sorted.length - 1].half;
  };
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
  /** How much of each end narrows away, so the band is a shape and not a cut. */
  taper = 0.1,
): Vec2[] {
  const rng = createRng(seed);
  const phase = rng.range(0, Math.PI * 2);
  const inner: Vec2[] = [];
  const outer: Vec2[] = [];
  const steps = Math.max(6, Math.round((to - from) / 14));
  const length = polylineLength(centerline);
  for (let i = 0; i <= steps; i++) {
    const along = lerp(from, to, i / steps);
    const { point, tangent } = pointAlongPolyline(centerline, along);
    const right = perp(tangent);
    const wobble = Math.sin(along * 0.035 + phase) * 6 + Math.sin(along * 0.011 + phase * 2) * 9;
    const t = i / steps;
    const ease = taper <= 0 ? 1 : smoothstep(0, taper, t) * (1 - smoothstep(1 - taper, 1, t));
    const innerOffset = offset + wobble * 0.5 + (1 - ease) * 9;
    const cap = insideLimit(centerline, length, along, side);
    const a = Math.min(innerOffset, cap);
    const b = Math.min(innerOffset + (0.3 + 0.7 * ease) * (width + wobble * 0.3), cap);
    inner.push(add(point, scale(right, side * a)));
    outer.push(add(point, scale(right, side * b)));
  }
  return [...inner, ...outer.reverse()];
}

/**
 * How far a band can be offset toward the inside of a bend before it folds back
 * through itself. Offset past the centre of the turn and the polygon crosses
 * over, which looks wrong and — for a water hazard — decides penalties wrongly
 * too, so anything beyond three-quarters of the turning radius is held back.
 */
function insideLimit(centerline: Vec2[], length: number, along: number, side: -1 | 1): number {
  const step = 10;
  const before = pointAlongPolyline(centerline, Math.max(0, along - step)).tangent;
  const after = pointAlongPolyline(centerline, Math.min(length, along + step)).tangent;
  const cross = before.x * after.y - before.y * after.x;
  const dot = clamp(before.x * after.x + before.y * after.y, -1, 1);
  const turn = Math.atan2(cross, dot);
  if (Math.abs(turn) < 1e-4) return Infinity;
  // perp() points right of travel, so the inside of a left turn is side -1.
  const inside = turn > 0 ? -1 : 1;
  if (side !== inside) return Infinity;
  return (Math.abs((2 * step) / turn)) * 0.75;
}

/** A polyline given width: the polygon a cart path or a creek occupies. */
function thickenLine(line: Vec2[], half: number): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < line.length; i++) {
    const before = line[Math.max(0, i - 1)];
    const after = line[Math.min(line.length - 1, i + 1)];
    const tangent = norm(sub(after, before));
    const side = perp(tangent);
    right.push(add(line[i], scale(side, half)));
    left.push(add(line[i], scale(side, -half)));
  }
  return [...right, ...left.reverse()];
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
    // Where the hole has no corridor at all — the carry on a desert par 3 — it
    // has no rough either. Grass grows on the bit they irrigate.
    const base = halfWidth(along);
    if (base <= 0.2) continue;
    const w = base + extra;
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
  // Two points back, so the tangent is the line the hole arrives on rather than
  // the last sampling step — but a traced straight line has only two points.
  const finalTangent = norm(sub(centerline[centerline.length - 1], centerline[Math.max(0, centerline.length - 3)]));
  const greenCenter = centerline[centerline.length - 1];
  const right = perp(finalTangent);

  // --- Fairway width -------------------------------------------------------
  const widthPhase = rng.range(0, Math.PI * 2);
  const teeRamp = spec.par === 3 ? 30 : 34;
  const fairwayStart = spec.par === 3 ? Math.min(70, spec.yards * 0.45) : 18;
  const fairwayEnd = length - spec.greenSize * 1.35;
  const landingAt = spec.par === 5 ? length * 0.38 : length * clamp(spec.doglegAt, 0.35, 0.8);
  const baseWidth = spec.fairwayWidth * (spec.par === 3 ? 0.72 : 1);
  const authored = widthProfile(spec, baseWidth);
  const shaped = spec.widths !== undefined && spec.widths.length > 0;
  const halfWidth = (along: number): number => {
    if (along <= fairwayStart || along >= fairwayEnd + spec.greenSize * 1.1) return 0;
    const open = smoothstep(fairwayStart, fairwayStart + teeRamp, along);
    const close = 1 - smoothstep(fairwayEnd, fairwayEnd + spec.greenSize * 1.05, along);
    // Widest through the landing zone, pinched where the architect wants you
    // thinking — unless the hole says where it is wide and where it is not.
    const landing = shaped ? 1 : 1 + 0.10 * Math.exp(-(((along - landingAt) / 90) ** 2));
    const texture = 1 + 0.11 * Math.sin(along * 0.042 + widthPhase) + 0.06 * Math.sin(along * 0.017 + widthPhase * 1.7);
    // Par 3s authored with a width profile are taken at their word: it is how a
    // desert hole says "there is no fairway, only the carry and the green".
    const width = authored(along / length);
    return width * open * close * landing * texture;
  };

  // --- Green ---------------------------------------------------------------
  // Traced, if the hole came off a photograph; otherwise grown from the spec.
  const greenAxis = Math.atan2(finalTangent.y, finalTangent.x) + rng.range(-0.5, 0.5);
  const green: Shape = spec.greenShape
    ? shapeFromPolygon(spec.greenShape)
    : shapeFromBlob(
        blobFrom(greenCenter, spec.greenSize, `${course.id}:${spec.number}:green`, rng.range(1.05, 1.45), greenAxis, 0.13),
      );
  const greenMiddle = green.centre;
  const pin = add(add(greenMiddle, scale(right, spec.pin.x)), scale(finalTangent, spec.pin.y));

  // --- Bunkers -------------------------------------------------------------
  const bunkers = spec.bunkers.map((b, i) => {
    const kind = b.kind;
    const deep = b.deep ?? b.kind === 'greenside';
    if (b.shape) return { shape: shapeFromPolygon(b.shape), kind, deep };
    const { point, tangent } = pointAlongPolyline(centerline, Math.min(b.along, length));
    const r = perp(tangent);
    let center = add(point, scale(r, b.lateral));
    const axis = Math.atan2(tangent.y, tangent.x) + (b.kind === 'fairway' ? 0 : rng.range(-0.7, 0.7));
    const stretch = b.stretch ?? (b.kind === 'fairway' ? 1.7 : 1.25);
    const blob = blobFrom(center, b.size, `${course.id}:${spec.number}:bunker:${i}`, stretch, axis, 0.22);
    // A bunker is beside a green, never on it. An `along`/`lateral` pair that
    // lands the blob on the putting surface is an authoring slip — the sand
    // draws over the green and the hole reads as a mistake — so slide it back
    // out until it clears the edge. A *traced* bunker is never moved: if the
    // photograph puts the sand there, that is where the sand is.
    const shape = clearOf(shapeFromBlob(blob, 44), green, greenMiddle, right);
    return { shape, kind, deep };
  });

  // --- Water ---------------------------------------------------------------
  const water = spec.water.map((w, i) => {
    if (w.shape) return { shape: shapeFromPolygon(w.shape) };
    if (w.strip) {
      const polygon = stripPolygon(centerline, w.strip.from, w.strip.to, w.strip.side, w.strip.offset, w.strip.width, `${course.id}:${spec.number}:strip:${i}`, 0.18);
      return { shape: shapeFromPolygon(polygon) };
    }
    const { point, tangent } = pointAlongPolyline(centerline, Math.min(w.along, length));
    const r = perp(tangent);
    let center = add(point, scale(r, w.lateral));
    const stretch = w.stretch ?? 1.3;
    // A generated pond that overlaps the putting surface is an authoring slip,
    // not a design: it turns every approach on that side into a penalty stroke.
    // Push it back out to a fair distance. A *traced* hazard is never moved —
    // if the photograph says the water is there, the water is there.
    const reach = w.size * stretch * 1.16;
    const need = green.radius + 7 + reach;
    const gap = dist(center, greenMiddle);
    if (gap < need && gap > 1e-6) center = add(greenMiddle, scale(norm(sub(center, greenMiddle)), need));
    const blob = blobFrom(center, w.size, `${course.id}:${spec.number}:water:${i}`, stretch, Math.atan2(tangent.y, tangent.x), 0.18);
    return { shape: shapeFromBlob(blob, 56) };
  });

  // --- Native grass --------------------------------------------------------
  // Fescue is traced, never generated: it is a thing a photograph shows, and
  // guessing where a course stopped mowing is how a hole ends up feeling
  // invented.
  const fescue = (spec.fescue ?? []).map((zone) => ({ shape: shapeFromPolygon(zone.shape) }));

  // --- Desert waste --------------------------------------------------------
  const waste = (spec.waste ?? []).map((w, i) => {
    if (w.shape) return { shape: shapeFromPolygon(w.shape) };
    const polygon = stripPolygon(centerline, w.from, w.to, w.side, w.offset, w.width, `${course.id}:${spec.number}:waste:${i}`, 0.26);
    return { shape: shapeFromPolygon(polygon) };
  });

  // --- Authored out of bounds and cart paths --------------------------------
  const ob = (spec.obZones ?? []).map((zone) => ({ shape: shapeFromPolygon(zone.shape) }));
  const paths = (spec.cartPaths ?? []).map((path) => ({
    shape: shapeFromPolygon(thickenLine(path.line, (path.width ?? 3) / 2)),
  }));

  // --- Elevation -----------------------------------------------------------
  // Cross slope in feet per yard of lateral offset. A fairway that tilts more
  // than about 7% is a ski run, so this stays small even on the desert course.
  const tilt = rng.range(-0.085, 0.085) * (style.id === 'desert' ? 2.1 : style.id === 'parkland' ? 1.3 : 0.9);
  const noisePhase = rng.range(0, Math.PI * 2);
  const bendAt = clamp(spec.doglegAt, 0.3, 0.85);
  // Authored landforms: a ridge you play blind over, a hollow the ball gathers
  // into, a plateau that leaves a hanging lie. These sit on top of the
  // tee-to-green slope rather than replacing it.
  const landforms = spec.landforms ?? [];
  const landformAt = (along: number, lateral: number): number => {
    let delta = 0;
    for (const form of landforms) {
      const half = Math.max(12, form.length / 2);
      const x = (along - form.at * length) / half;
      if (x <= -1.8 || x >= 1.8) continue;
      const across = form.width === undefined
        ? 1
        : Math.exp(-(((lateral - (form.lateral ?? 0)) / Math.max(6, form.width)) ** 2));
      delta += form.rise * Math.exp(-x * x * 1.7) * across;
    }
    return delta;
  };
  const elevationAt = (p: Vec2): number => {
    const proj = projectToPolyline(centerline, p);
    const t = clamp(proj.along / length, 0, 1);
    let base: number;
    if (t <= bendAt) base = lerp(0, spec.elevation.landing, t / bendAt);
    else base = lerp(spec.elevation.landing, spec.elevation.green, (t - bendAt) / (1 - bendAt));
    const lateral = proj.lateral * tilt;
    const roll = Math.sin(proj.along * 0.021 + noisePhase) * (style.id === 'links' ? 3.4 : 2.2)
      + Math.sin(proj.along * 0.0075 + noisePhase * 2.3) * 4.2 * (style.id === 'desert' ? 1.6 : 1);
    return base + lateral + roll + landformAt(proj.along, proj.lateral);
  };

  // --- Trees ---------------------------------------------------------------
  // Three kinds, and they do different jobs. The authored ones come first
  // because they are architecture: a stand across the inside of a dogleg is the
  // reason the dogleg is a dogleg, and a single oak forty yards short of a green
  // decides which side of the fairway you want to be on. The procedural ones
  // fill the corridor behind them so the hole reads as a hole.
  const trees: HoleGeometry['trees'] = [];
  const atLeast = (position: Vec2, gap: number): boolean =>
    trees.every((t) => dist(t.position, position) > gap);
  // Nothing grows out of a pond, and nothing grows in the fescue either — a
  // stand of native grass is open ground, and the whole reason the club mows it
  // that way is that there is nothing there. Worth saying because the tree
  // scatter does not know about hazards, and one trunk standing in the middle of
  // the water on a forced carry undoes the whole picture.
  const plantable = (position: Vec2): boolean =>
    !water.some((w) => w.shape.contains(position)) && !fescue.some((f) => f.shape.contains(position));

  const plant = (along: number, offset: number, radius: number, shade: number) => {
    const { point, tangent } = pointAlongPolyline(centerline, clamp(along, 0, length));
    const position = add(point, scale(perp(tangent), offset));
    if (plantable(position) && atLeast(position, radius * 0.75)) trees.push({ position, radius, shade });
  };

  // How far out the corridor reaches at a point on the hole. The fairway tapers
  // to nothing at the green, so a stand measured from the fairway edge alone
  // would close in around the putting surface and leave no way to approach it.
  const corridorEdge = (along: number): number => {
    const toGreen = Math.max(0, length - along);
    const nearGreen = toGreen < spec.greenSize * 3 ? spec.greenSize + 12 : 0;
    return Math.max(halfWidth(along), nearGreen, 12);
  };

  (spec.groves ?? []).forEach((grove, index) => {
    const g = createRng(`${course.id}:${spec.number}:grove:${index}`);
    const density = clamp(grove.density ?? 0.6, 0.1, 1);
    const spacing = lerp(17, 6.5, density);
    const [minCanopy, maxCanopy] = grove.canopy ?? (style.id === 'parkland' ? [5, 11] : [3, 6]);
    for (let along = grove.from; along <= grove.to; along += spacing * g.range(0.6, 1.4)) {
      const edgeOfFairway = grove.side === 0 ? 0 : corridorEdge(clamp(along, 0, length));
      for (let depth = 0; depth <= grove.depth; depth += spacing * g.range(0.7, 1.45)) {
        const jitter = g.range(-spacing * 0.45, spacing * 0.45);
        const from = grove.side === 0
          ? grove.offset - grove.depth / 2 + depth
          : grove.side * (edgeOfFairway + grove.offset + depth);
        plant(along + g.range(-spacing * 0.4, spacing * 0.4), from + jitter, g.range(minCanopy, maxCanopy), g.range(0, 1));
      }
    }
  });

  // Traced stands: the outline is the shape of the wood, and the trees inside it
  // are procedural. A photograph supports the boundary, not the trunk positions.
  (spec.treeZones ?? []).forEach((zone, index) => {
    const g = createRng(`${course.id}:${spec.number}:wood:${index}`);
    const shape = shapeFromPolygon(zone.shape);
    const density = clamp(zone.density ?? 0.55, 0.1, 1);
    const spacing = lerp(17, 7, density);
    const [minCanopy, maxCanopy] = zone.canopy ?? (style.id === 'parkland' ? [5, 11] : [2.5, 5]);
    const { minX, minY, maxX, maxY } = shape.bounds;
    for (let y = minY; y <= maxY; y += spacing) {
      for (let x = minX; x <= maxX; x += spacing) {
        const position = vec(x + g.range(-spacing * 0.45, spacing * 0.45), y + g.range(-spacing * 0.45, spacing * 0.45));
        if (!shape.contains(position) || !plantable(position)) continue;
        const radius = g.range(minCanopy, maxCanopy);
        if (atLeast(position, radius * 0.75)) trees.push({ position, radius, shade: g.range(0, 1) });
      }
    }
  });

  for (const tree of spec.specimens ?? []) {
    plant(tree.along, tree.lateral, tree.radius ?? (style.id === 'parkland' ? 9 : 5), rng.range(0.4, 1));
  }

  if (spec.trees > 0.02) {
    const bands = style.bands;
    const edge = bands.firstCut + bands.lightRough + bands.heavyRough + bands.deepRough;
    const spacing = lerp(34, 11, spec.trees);
    // Stands, not a hedge: the corridor opens up every so often, which is what
    // gives a tree-lined hole its windows and its blind spots.
    const gapPhase = rng.range(0, Math.PI * 2);
    for (let along = 12; along < length + 40; along += spacing * rng.range(0.65, 1.35)) {
      const thinning = 0.5 + 0.5 * Math.sin(along * 0.014 + gapPhase);
      for (const side of [-1, 1] as const) {
        if (!rng.chance((0.45 + spec.trees * 0.5) * (0.45 + thinning * 0.75))) continue;
        const depth = rng.range(2, 46);
        const w = halfWidth(Math.min(along, length));
        const canopy = style.id === 'desert' ? rng.range(2.2, 4.4) : rng.range(4.5, 10);
        plant(along, side * (Math.max(w, 12) + edge * 0.55 + depth), canopy, rng.range(0, 1));
      }
    }
    const specimens = Math.round(spec.trees * 7);
    for (let i = 0; i < specimens; i++) {
      const along = rng.range(length * 0.22, length * 0.95);
      const side = rng.chance(0.5) ? -1 : 1;
      // Off the corridor, not off the fairway: where the hole has no mown
      // ground at all — the carry on a par 3, a forced carry over water — the
      // fairway half-width is zero, and planting a tree three yards off that
      // put an oak in the middle of the flight path.
      plant(along, side * (Math.max(halfWidth(along), 12) + rng.range(3, 13)), rng.range(5, 11), rng.range(0, 1));
    }
  }

  // --- The teeing ground ---------------------------------------------------
  // Every hole is played from a mown pad, and on a par 3 the corridor does not
  // start for seventy yards, so without one the round opens with the ball
  // apparently teed up in the hay. The markers sit at its front edge, which is
  // the tee point itself: the pad runs back from there.
  const teeBox = teePad(tee, pointAlongPolyline(centerline, 0).tangent, spec.par === 3 ? 6.4 : 6.0, spec.par === 3 ? 16 : 14);

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
  bounds = unionBounds(bounds, expandBounds(teeBox.bounds, 10));
  bounds = unionBounds(bounds, expandBounds(green.bounds, green.radius * 1.6));
  for (const area of [...water, ...waste, ...ob, ...paths, ...fescue]) bounds = unionBounds(bounds, expandBounds(area.shape.bounds, 8));
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
    teeBox,
    fairwayHalfWidth: halfWidth,
    corridorHalfWidth: (along: number) => authored(along / length),
    green,
    bunkers,
    water,
    waste,
    ob,
    fescue,
    paths,
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

/**
 * Slide a shape out of the green until it no longer touches it, along the line
 * from the green's middle. Measured rather than estimated: a blob's outline runs
 * well past its nominal radius, and a squashed one runs further still across its
 * axis than along it.
 */
function clearOf(shape: Shape, green: Shape, greenMiddle: Vec2, fallback: Vec2): Shape {
  let current = shape;
  for (let pass = 0; pass < 4; pass++) {
    let bite = 0;
    for (const p of current.outline) bite = Math.max(bite, -green.edgeDistance(p));
    // The other way round as well: a small green can sit inside a big bunker.
    for (const q of green.outline) if (current.contains(q)) bite = Math.max(bite, -current.edgeDistance(q));
    if (bite <= 0) return current;
    const away = sub(current.centre, greenMiddle);
    const direction = Math.hypot(away.x, away.y) > 1e-6 ? norm(away) : fallback;
    const step = scale(direction, bite + 1.2);
    current = shapeFromPolygon(current.outline.map((p) => add(p, step)));
  }
  return current;
}

/**
 * A teeing ground: a rounded rectangle whose front edge is the tee itself and
 * which runs back from there, square to the line the hole opens on.
 */
function teePad(tee: Vec2, forward: Vec2, halfWidth: number, depth: number): Shape {
  const across = perp(forward);
  const radius = Math.min(2.6, halfWidth * 0.5, depth * 0.3);
  const front = 3.2;
  const back = -depth;
  // Four quarter-circles, walked in order: up the right edge, across the back,
  // down the left, and home along the front.
  const corners = [
    { x: front - radius, y: halfWidth - radius, from: 0 },
    { x: back + radius, y: halfWidth - radius, from: Math.PI / 2 },
    { x: back + radius, y: -halfWidth + radius, from: Math.PI },
    { x: front - radius, y: -halfWidth + radius, from: Math.PI * 1.5 },
  ];
  const outline: Vec2[] = [];
  for (const corner of corners) {
    for (let i = 0; i <= 4; i++) {
      const angle = corner.from + (Math.PI / 2) * (i / 4);
      const along = corner.x + Math.cos(angle) * radius;
      const lateral = corner.y + Math.sin(angle) * radius;
      outline.push(add(add(tee, scale(forward, along)), scale(across, lateral)));
    }
  }
  return shapeFromPolygon(outline);
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

/**
 * Tree lookups by cell, because a wooded hole carries a few hundred of them and
 * every terrain query would otherwise walk the lot. Each trunk is registered in
 * every cell its canopy touches, so one cell lookup is the whole answer.
 */
const TREE_CELL = 24;
const treeIndexCache = new WeakMap<HoleGeometry, Map<number, number[]>>();

function treeIndexFor(hole: HoleGeometry): Map<number, number[]> {
  const cached = treeIndexCache.get(hole);
  if (cached) return cached;
  const index = new Map<number, number[]>();
  hole.trees.forEach((tree, i) => {
    const r = tree.radius;
    const x0 = Math.floor((tree.position.x - r) / TREE_CELL);
    const x1 = Math.floor((tree.position.x + r) / TREE_CELL);
    const y0 = Math.floor((tree.position.y - r) / TREE_CELL);
    const y1 = Math.floor((tree.position.y + r) / TREE_CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = x * 100003 + y;
        const list = index.get(key);
        if (list) list.push(i);
        else index.set(key, [i]);
      }
    }
  });
  treeIndexCache.set(hole, index);
  return index;
}

/** The tree the ball is under, if it is under one. */
function treeAt(hole: HoleGeometry, p: Vec2): boolean {
  const key = Math.floor(p.x / TREE_CELL) * 100003 + Math.floor(p.y / TREE_CELL);
  const list = treeIndexFor(hole).get(key);
  if (!list) return false;
  for (const i of list) {
    const tree = hole.trees[i];
    if (dist(tree.position, p) <= tree.radius * 0.95) return true;
  }
  return false;
}

export function terrainAt(hole: HoleGeometry, p: Vec2, options?: { onTee?: boolean }): TerrainInfo {
  const proj = projectToPolyline(hole.centerline, p);
  const halfWidth = hole.fairwayHalfWidth(proj.along);
  const greenEdge = hole.green.edgeDistance(p);
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
    if (w.shape.contains(p)) {
      info.lie = 'water';
      return info;
    }
  }

  // Authored boundaries beat everything below them: a ball in somebody's garden
  // is out of bounds whatever the grass gradient says about it.
  for (const zone of hole.ob) {
    if (zone.shape.contains(p)) {
      info.lie = 'ob';
      return info;
    }
  }

  // The teeing ground is cut as tight as a fairway.
  if (hole.teeBox.contains(p)) {
    info.lie = 'fairway';
    return info;
  }

  for (const bunker of hole.bunkers) {
    if (bunker.shape.contains(p)) {
      info.lie = bunker.kind === 'greenside' ? 'greensideBunker' : 'fairwayBunker';
      info.deepBunker = bunker.deep;
      return info;
    }
  }

  if (greenEdge <= FRINGE_WIDTH) {
    info.lie = 'fringe';
    return info;
  }

  for (const zone of hole.fescue) {
    if (zone.shape.contains(p)) {
      info.lie = 'deepRough';
      return info;
    }
  }

  for (const w of hole.waste) {
    if (w.shape.contains(p)) {
      info.lie = 'waste';
      return info;
    }
  }

  if (treeAt(hole, p)) {
    info.lie = 'recovery';
    return info;
  }

  const bands = hole.style.bands;
  const offLine = Math.abs(proj.lateral);
  if (halfWidth > 0.5 && offLine <= halfWidth) {
    info.lie = 'fairway';
    return info;
  }
  // Same again for the ball: where the hole has no corridor, the only thing
  // under it is whatever the course puts outside the mown grass. Before the
  // fairway starts and past the green the corridor still exists — it is the
  // ramp that has closed — so those keep their rough.
  const noCorridor = hole.corridorHalfWidth(proj.along) <= 0.2;
  const fromFairway = noCorridor ? 1e4 : offLine - Math.max(halfWidth, 0);
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

  const surroundWidth = hole.course.surroundWidth ?? hole.style.surroundWidth;
  const surround: LieType = hole.style.surround === 'recovery' ? 'pineStraw' : hole.style.surround;
  if (effective <= edges[0]) info.lie = 'firstCut';
  else if (effective <= edges[1]) info.lie = 'lightRough';
  else if (effective <= edges[2]) info.lie = 'heavyRough';
  else if (effective <= edges[3]) info.lie = 'deepRough';
  else if (effective <= edges[3] + surroundWidth) info.lie = surround;
  // Where the hole has no corridor, the carry is all surround — desert on a
  // desert course — and the boundary stays where it is on the rest of the hole.
  // Calling it out of bounds would put a stroke-and-distance penalty across the
  // middle of a par 3.
  else if (noCorridor && offLine <= edges[3] + surroundWidth) info.lie = surround;
  else info.lie = 'ob';
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

/** True when a point is on the putting surface. */
export function onGreen(hole: HoleGeometry, p: Vec2): boolean {
  return hole.green.edgeDistance(p) <= 0;
}

/**
 * Free relief from a cart path: the nearest point off it, no nearer the hole.
 * A path is a thing the ball bounces off, not a lie anybody plays from.
 */
export function pathRelief(hole: HoleGeometry, p: Vec2): Vec2 {
  const on = hole.paths.find((path) => path.shape.contains(p));
  if (!on) return p;
  for (let radius = 2; radius <= 10; radius += 2) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2;
      const candidate = add(p, vec(Math.cos(angle) * radius, Math.sin(angle) * radius));
      if (hole.paths.every((path) => !path.shape.contains(candidate)) && terrainAt(hole, candidate).lie !== 'water') {
        return candidate;
      }
    }
  }
  return p;
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
  // Nothing playable on the way back — a hazard that runs the length of the
  // hole, or a boundary tight against it. Take the relief the centreline gives:
  // a drop has to leave the ball somewhere it can be played from.
  const proj = projectToPolyline(hole.centerline, to);
  const along = clamp(proj.along, 12, hole.centerlineLength - 12);
  const line = pointAlongPolyline(hole.centerline, along).point;
  return terrainAt(hole, line).lie === 'water' ? candidate : line;
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
  const candidate = add(hole.green.centre, vec(Math.cos(quadrant) * reach, Math.sin(quadrant) * reach));
  // Never cut a pin off the putting surface.
  return hole.green.edgeDistance(candidate) < -2.5 ? candidate : hole.pin;
}

export function courseBounds(course: Course): Bounds {
  let bounds = holeGeometry(course, 1).bounds;
  for (let i = 2; i <= course.holes.length; i++) bounds = unionBounds(bounds, holeGeometry(course, i).bounds);
  return bounds;
}
