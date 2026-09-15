/**
 * Turning a photograph into a golf hole.
 *
 * You trace a hole in the coordinates you actually have: pixels on the image,
 * y growing downward, north wherever the image put it. This turns that into the
 * game's frame — yards, the tee at the origin, the green straight up the y-axis
 * — and the conversion is fixed by one number that is not a guess: the card
 * yardage. The played line from the tee, round the corner, to the pin *is* the
 * hole's length, so pixels-per-yard falls out of it and every other traced
 * feature inherits the same scale. Nothing is stretched to look right.
 *
 *   const hole = traceHole({
 *     tee: [812, 1604], pin: [655, 372],
 *     playLine: [[812, 1604], [520, 980], [655, 372]],
 *     green: [[640, 330], [690, 350], ...],
 *     bunkers: [{ shape: [...], kind: 'greenside' }],
 *   }, { number: 18, par: 5, yards: 548, index: 7, bearing: 15 });
 *
 * What comes back is a HoleSpec the existing engine plays: same shot model,
 * same lies, same dispersion, same everything.
 */

import type { BunkerSpec, HoleSpec, TracedShape } from '../../simulation/types';
import { polylineLength, type Vec2 } from '../../simulation/geometry';

/** A point as traced: [x, y] in image pixels. Terser than {x, y} by the hundred. */
export type Pixel = [number, number];

export interface TracedHole {
  /** Where the tee marker sits on the image. */
  tee: Pixel;
  /** Where the pin sits on the image. */
  pin: Pixel;
  /**
   * The line of play. Usually this is the tour's own overlay — tee, each corner,
   * pin — and then every intermediate point is a printed marker. Where the
   * overlay's straight chords cut across ground the hole does not use, the line
   * can instead be traced down the fairway itself, with more points than the
   * overlay has; `corners` then says which of them the markers sit on.
   * Its length is the card yardage, and that sets the scale for everything else.
   */
  playLine: Pixel[];
  /**
   * Indices into `playLine` of the points the overlay's printed markers sit on.
   * Defaults to every intermediate point, which is what an overlay-shaped line
   * means.
   */
  corners?: number[];
  /** The putting surface. */
  green?: Pixel[];
  bunkers?: { shape: Pixel[]; kind?: BunkerSpec['kind']; deep?: boolean }[];
  water?: Pixel[][];
  waste?: Pixel[][];
  /** Out of bounds: housing, roads, the property line. */
  ob?: Pixel[][];
  /**
   * Native grass — fescue, the wispy stuff a New England hillside is cut out
   * of. Traced where the photograph shows it, never guessed.
   */
  fescue?: Pixel[][];
  /** Wooded areas, as boundaries. The trees inside them are procedural. */
  trees?: { shape: Pixel[]; density?: number; canopy?: [number, number] }[];
  /** Cart paths, traced down their middle. */
  paths?: { line: Pixel[]; width?: number }[];
  /**
   * Fairway width at points along the hole, as fractions of its length. Trace
   * the fairway edges at a few stations and measure across: half-widths here.
   */
  widths?: { at: number; half: number }[];
  /** True when the image's y grows downward, which it does for every screenshot. */
  yDown?: boolean;
}

export interface CardEntry {
  number: number;
  name: string;
  par: 3 | 4 | 5;
  /** From the scorecard. This is what sets the scale. */
  yards: number;
  index: number;
  /** Compass bearing of the line of play, measured off the north-up image. */
  bearing: number;
  /** Served path of the image this was traced from, for the overlay. */
  image?: string;
  elevation?: { landing: number; green: number };
  greenSize?: number;
  pin?: Vec2;
  greenSlope?: Vec2;
  strategy?: string;
}

interface Frame {
  scale: number;
  cos: number;
  sin: number;
  origin: Pixel;
  flip: number;
}

/**
 * The transform from image pixels to hole yards: scale from the card, rotation
 * that puts the green straight up the y-axis (which is what the wind model and
 * the camera both assume), origin at the tee.
 */
function frameFor(traced: TracedHole, yards: number): Frame {
  const flip = traced.yDown === false ? 1 : -1;
  const pixels = polylineLength(traced.playLine.map(([x, y]) => ({ x, y: y * flip })));
  const scale = yards / pixels;
  const dx = traced.pin[0] - traced.tee[0];
  const dy = (traced.pin[1] - traced.tee[1]) * flip;
  // The turn that puts the tee-to-pin vector on +y: its angle from +x is
  // atan2(dy, dx), and it needs to end at 90°.
  const angle = Math.PI / 2 - Math.atan2(dy, dx);
  return { scale, cos: Math.cos(angle), sin: Math.sin(angle), origin: traced.tee, flip };
}

function place(frame: Frame, [px, py]: Pixel): Vec2 {
  const x = (px - frame.origin[0]) * frame.scale;
  const y = (py - frame.origin[1]) * frame.flip * frame.scale;
  // Rotation by -angle, where the angle was measured from +y.
  return { x: x * frame.cos - y * frame.sin, y: x * frame.sin + y * frame.cos };
}

const shapeOf = (frame: Frame, points: Pixel[]): TracedShape => points.map((point) => place(frame, point));

/** How far along the hole a point sits, in yards, for the features that want it. */
function alongOf(centreline: Vec2[], point: Vec2): number {
  let best = Infinity;
  let travelled = 0;
  let at = 0;
  for (let i = 1; i < centreline.length; i++) {
    const a = centreline[i - 1];
    const b = centreline[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const length = Math.hypot(abx, aby);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / (length * length)));
    const distance = Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
    if (distance < best) {
      best = distance;
      at = travelled + t * length;
    }
    travelled += length;
  }
  return at;
}

/**
 * Trace plus card in, HoleSpec out. Everything the image supports is traced;
 * everything it does not is left to the spec's own defaults, so a hole with
 * nothing but a play line still plays.
 */
export function traceHole(traced: TracedHole, card: CardEntry): HoleSpec {
  const frame = frameFor(traced, card.yards);
  const centreline = shapeOf(frame, traced.playLine);
  const green = traced.green ? shapeOf(frame, traced.green) : undefined;
  const greenCentre = green
    ? green.reduce((sum, p) => ({ x: sum.x + p.x / green.length, y: sum.y + p.y / green.length }), { x: 0, y: 0 })
    : centreline[centreline.length - 1];
  const greenSize =
    card.greenSize ??
    (green ? green.reduce((sum, p) => sum + Math.hypot(p.x - greenCentre.x, p.y - greenCentre.y), 0) / green.length : 14);

  const bunkers: BunkerSpec[] = (traced.bunkers ?? []).map((bunker) => {
    const shape = shapeOf(frame, bunker.shape);
    const centre = shape.reduce((sum, p) => ({ x: sum.x + p.x / shape.length, y: sum.y + p.y / shape.length }), { x: 0, y: 0 });
    const toGreen = Math.hypot(centre.x - greenCentre.x, centre.y - greenCentre.y);
    return {
      along: Math.round(alongOf(centreline, centre)),
      lateral: 0,
      size: Math.round(shape.reduce((sum, p) => sum + Math.hypot(p.x - centre.x, p.y - centre.y), 0) / shape.length),
      kind: bunker.kind ?? (toGreen < greenSize * 3 ? 'greenside' : 'fairway'),
      deep: bunker.deep,
      shape,
    };
  });

  return {
    number: card.number,
    name: card.name,
    par: card.par,
    yards: card.yards,
    bearing: card.bearing,
    index: card.index,
    // The traced line carries the shape; these stay for the landing-zone and
    // elevation models, which want a single number for where the hole turns.
    dogleg: 0,
    doglegAt: 0.55,
    fairwayWidth: traced.widths?.length
      ? traced.widths.reduce((sum, w) => sum + w.half, 0) / traced.widths.length
      : 18,
    widths: traced.widths,
    centreline,
    greenShape: green,
    elevation: card.elevation ?? { landing: 0, green: 0 },
    greenSize: Math.round(greenSize),
    pin: card.pin ?? { x: 0, y: 0 },
    greenSlope: card.greenSlope ?? { x: -1.2, y: -1.4 },
    trees: 0,
    bunkers,
    water: (traced.water ?? []).map((shape) => ({ along: 0, lateral: 0, size: 0, shape: shapeOf(frame, shape) })),
    waste: (traced.waste ?? []).map((shape) => ({ from: 0, to: 0, side: 1 as const, offset: 0, width: 0, shape: shapeOf(frame, shape) })),
    obZones: (traced.ob ?? []).map((shape) => ({ shape: shapeOf(frame, shape) })),
    fescue: (traced.fescue ?? []).map((shape) => ({ shape: shapeOf(frame, shape) })),
    centrelineCorners: traced.corners ?? traced.playLine.slice(1, -1).map((_, i) => i + 1),
    treeZones: (traced.trees ?? []).map((zone) => ({
      shape: shapeOf(frame, zone.shape),
      density: zone.density,
      canopy: zone.canopy,
    })),
    cartPaths: (traced.paths ?? []).map((path) => ({ line: shapeOf(frame, path.line), width: path.width })),
    strategy: card.strategy ?? '',
    reference: card.image
      ? {
          image: card.image,
          scale: frame.scale,
          angle: Math.atan2(frame.sin, frame.cos),
          origin: { x: traced.tee[0], y: traced.tee[1] },
          flip: frame.flip as 1 | -1,
        }
      : undefined,
  };
}

/** Yards between two traced points — for checking a trace against the card. */
export function tracedDistance(traced: TracedHole, yards: number, from: Pixel, to: Pixel): number {
  const frame = frameFor(traced, yards);
  const a = place(frame, from);
  const b = place(frame, to);
  return Math.hypot(a.x - b.x, a.y - b.y);
}
