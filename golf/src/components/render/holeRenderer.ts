/**
 * Drawing a golf hole.
 *
 * Everything is drawn from the same geometry the simulation plays on, so what
 * you see is what the shot engine will resolve against: if the bunker looks like
 * it is in the way, it is in the way.
 *
 * The elevation shading is the one thing that is cached. It is a coarse
 * per-hole bitmap of high-and-low painted once and then scaled, because sampling
 * a height field every frame is the fastest way to make a 2D golf game stutter.
 */

import { type Camera, toScreen } from './camera';
import { type Vec2, pointAlongPolyline } from '../../simulation/geometry';
import { createRng } from '../../simulation/rng';
import { dispersionContour, sigmaForShare, type ShotPlan } from '../../simulation/shotEngine';
import type { GreenRead } from '../../simulation/puttingEngine';
import { greenSlopeAt } from '../../simulation/courseEngine';
import type { HoleGeometry } from '../../simulation/types';

export interface RenderOptions {
  hole: HoleGeometry;
  camera: Camera;
  ball: Vec2;
  target: Vec2 | null;
  plan: ShotPlan | null;
  putt: GreenRead | null;
  /** Ball position during an animation, with height in feet. */
  flight: { x: number; y: number; h: number } | null;
  /** The traced path so far. */
  trail: { x: number; y: number; h: number }[] | null;
  /** Previous shots on this hole. */
  shotLines: { from: Vec2; to: Vec2 }[];
  showDispersion: boolean;
  showZones: { fifty: boolean; seventyFive: boolean; ninety: boolean };
  /** Animated flag flutter, in seconds. */
  time: number;
  windFrom: number;
  windSpeed: number;
  /** Putting view draws slope arrows and the read. */
  puttingView: boolean;
  hoverTarget: Vec2 | null;
  /** Developer view: the source photograph and the geometry traced from it. */
  debug?: DebugOptions | null;
}

/**
 * What the reconstruction looks like against what it was reconstructed from.
 * The overlay is placed by the transform the trace recorded, so it lands where
 * the geometry lands and any daylight between them is a fault in the trace.
 */
export interface DebugOptions {
  image: HTMLImageElement | null;
  /** The hole names a reference image, but it is not on disk. */
  missing?: boolean;
  opacity: number;
  /** Manual nudge on top of the recorded alignment, in yards and radians. */
  offset: Vec2;
  rotate: number;
  zoom: number;
  layers: {
    fairway: boolean;
    rough: boolean;
    bunkers: boolean;
    water: boolean;
    green: boolean;
    ob: boolean;
    paths: boolean;
    trees: boolean;
    centreline: boolean;
    grid: boolean;
  };
}

function path(ctx: CanvasRenderingContext2D, camera: Camera, points: readonly Vec2[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  const first = toScreen(camera, points[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const p = toScreen(camera, points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function openPath(ctx: CanvasRenderingContext2D, camera: Camera, points: readonly Vec2[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  const first = toScreen(camera, points[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const p = toScreen(camera, points[i]);
    ctx.lineTo(p.x, p.y);
  }
}

// ---------------------------------------------------------------------------
// Cached per-hole layers
// ---------------------------------------------------------------------------

interface ShadeLayer {
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
}

const shadeCache = new Map<string, ShadeLayer>();

/**
 * Where shadows fall, in screen pixels, for something `yards` of ground away
 * from what casts it. The sun sits in the north-west of the *course*, not the
 * top-left of the screen, so the offset turns with the camera — which is what
 * keeps the hillshade, the green pad, the bunker lips and the trees all agreeing
 * about the time of day once the view rotates to put the hole up the screen.
 */
/** The same offset, but never more than a few pixels once zoomed right in. */
function clampOffset(offset: { x: number; y: number }, limit: number): { x: number; y: number } {
  const length = Math.hypot(offset.x, offset.y);
  if (length <= limit || length === 0) return offset;
  const k = limit / length;
  return { x: offset.x * k, y: offset.y * k };
}

function shadowOffset(camera: Camera, yards: number): { x: number; y: number } {
  const wx = 0.62;
  const wy = -0.55;
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  const rx = wx * c - wy * s;
  const ry = wx * s + wy * c;
  const px = yards * camera.scale;
  return { x: rx * px, y: -ry * px };
}

/**
 * Smooth value noise, for shading only. Ground is not a mathematical surface —
 * it has grain, and a hillshade of a perfectly smooth field reads as a smear of
 * airbrush rather than as ground. This never reaches the simulation: the ball
 * still rolls on the height field the engine authored.
 */
function groundGrain(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number): number => {
    let h = ix * 374761393 + iy * 668265263 + seed * 1274126177;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5;
  };
  const octave = (scale: number): number => {
    const px = x / scale;
    const py = y / scale;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
  return octave(31) * 1.05 + octave(14) * 0.5 + octave(6.5) * 0.24;
}

/** Separable box blur over a scalar field, used to split coarse from fine. */
function blur(field: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const pass = new Float32Array(cols * rows);
  const out = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const x = Math.min(cols - 1, Math.max(0, col + k));
        sum += field[row * cols + x];
        count++;
      }
      pass[row * cols + col] = sum / count;
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const y = Math.min(rows - 1, Math.max(0, row + k));
        sum += pass[y * cols + col];
        count++;
      }
      out[row * cols + col] = sum / count;
    }
  }
  return out;
}

/**
 * Hillshade. The height field is sampled onto a grid, smoothed once (the lie
 * grid underneath is piecewise flat, and differentiating that gives facets), and
 * then lit: a surface normal per cell against a sun low in the north-west, plus
 * a curvature term that darkens hollows and brightens the crowns of ridges the
 * way ambient light actually behaves, plus a faint height tint.
 *
 * Vertical exaggeration is deliberate. Real golf contour — six feet over forty
 * yards — is almost invisible under a physically honest light, and the whole
 * point of the shading is that you can see which way a slope runs.
 */
function elevationLayer(hole: HoleGeometry): ShadeLayer {
  const key = `${hole.course.id}:${hole.spec.number}`;
  const cached = shadeCache.get(key);
  if (cached) return cached;

  const { minX, minY, maxX, maxY } = hole.bounds;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const step = 3; // yards per cell
  const cols = Math.max(48, Math.min(240, Math.round(spanX / step)));
  const rows = Math.max(48, Math.min(320, Math.round(spanY / step)));
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(cols, rows);

  const raw = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = minX + ((col + 0.5) / cols) * spanX;
      const y = minY + ((row + 0.5) / rows) * spanY;
      raw[row * cols + col] = hole.elevationAt({ x, y }) + groundGrain(x, y, hole.spec.number * 17 + 3);
    }
  }

  // One box pass, so the lie grid's flat cells stop showing up as facets.
  const height = new Float32Array(cols * rows);
  const at = (col: number, row: number) =>
    raw[Math.min(rows - 1, Math.max(0, row)) * cols + Math.min(cols - 1, Math.max(0, col))];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      height[row * cols + col] =
        (at(col, row) * 4 +
          at(col - 1, row) + at(col + 1, row) + at(col, row - 1) + at(col, row + 1) +
          (at(col - 1, row - 1) + at(col + 1, row - 1) + at(col - 1, row + 1) + at(col + 1, row + 1)) * 0.5) / 10;
    }
  }

  // Split the ground into the broad fall of the hole and the local shapes on
  // top of it. Lighting the raw field shades half the hole black because it
  // climbs twenty feet from tee to green; lighting the detail picks out the
  // dunes, hollows and plateaus, which is what you actually want to see.
  const base = blur(height, cols, rows, 8);
  const detail = new Float32Array(cols * rows);
  for (let i = 0; i < detail.length; i++) detail[i] = height[i] - base[i];

  let low = Infinity;
  let high = -Infinity;
  for (const value of height) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const mid = (low + high) / 2;
  const halfRange = Math.max(8, (high - low) / 2);

  const dx = spanX / cols;
  const dy = spanY / rows;
  // A sun low in the north-west. Everything else on the hole — trees, bunker
  // lips, the green pad — throws its shadow the same way.
  const lightX = -0.55;
  const lightY = 0.62;
  const lightZ = 0.56;

  const sampler = (field: Float32Array) => (col: number, row: number) =>
    field[Math.min(rows - 1, Math.max(0, row)) * cols + Math.min(cols - 1, Math.max(0, col))];
  const fine = sampler(detail);
  const broad = sampler(base);

  const shade = (
    sample: (col: number, row: number) => number,
    col: number,
    row: number,
    exaggeration: number,
  ): number => {
    const gx = ((sample(col + 1, row) - sample(col - 1, row)) / (2 * dx)) * exaggeration;
    const gy = ((sample(col, row + 1) - sample(col, row - 1)) / (2 * dy)) * exaggeration;
    const norm = Math.sqrt(gx * gx + gy * gy + 1);
    return (-gx * lightX + -gy * lightY + lightZ) / norm - lightZ;
  };

  // Light and shade first, then take the mean out of it. A hillshade is meant to
  // model which way the ground faces, not to dim the course: if the average cell
  // comes out dark, every hole is drawn darker than its own palette.
  const values = new Float32Array(cols * rows);
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Concave ground sits in its own shade; a crown catches the light.
      const here = fine(col, row);
      const around = (fine(col - 2, row) + fine(col + 2, row) + fine(col, row - 2) + fine(col, row + 2)) / 4;
      const value =
        shade(fine, col, row, 2.2) * 1.0 +
        shade(broad, col, row, 0.9) * 0.16 +
        (here - around) * 0.045 +
        ((height[row * cols + col] - mid) / halfRange) * 0.025;
      values[row * cols + col] = value;
      total += value;
    }
  }
  const mean = total / values.length;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = values[row * cols + col] - mean;
      const index = ((rows - 1 - row) * cols + col) * 4;
      // Fade the bitmap out at its own edges. Without this the hole sits inside
      // a visible rectangle of shading, which is the one thing that gives away
      // that the ground is a texture rather than ground.
      const edge = Math.min(
        1,
        Math.min(col, cols - 1 - col) / (cols * 0.16),
        Math.min(row, rows - 1 - row) / (rows * 0.12),
      );
      const fade = edge * edge * (3 - 2 * edge);
      if (value >= 0) {
        image.data[index] = 255;
        image.data[index + 1] = 250;
        image.data[index + 2] = 226;
        image.data[index + 3] = Math.min(180, value * 340) * fade;
      } else {
        image.data[index] = 10;
        image.data[index + 1] = 26;
        image.data[index + 2] = 18;
        image.data[index + 3] = Math.min(165, -value * 320) * fade;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const layer = { canvas, minX, minY, spanX, spanY };
  shadeCache.set(key, layer);
  return layer;
}

interface StripeLayer {
  stripes: Vec2[][];
}
const stripeCache = new Map<string, StripeLayer>();

/**
 * Mowing lines. A fairway is cut in passes up and down the hole, and the grass
 * lies with the mower, so alternate passes catch the light differently. They
 * follow the corridor rather than running straight, which is most of why a
 * curving hole reads as curving from above.
 */
function fairwayStripes(hole: HoleGeometry): StripeLayer {
  const key = `${hole.course.id}:${hole.spec.number}`;
  const cached = stripeCache.get(key);
  if (cached) return cached;
  const stripes: Vec2[][] = [];
  const passes = 6;
  const samples = Math.max(28, Math.round(hole.centerlineLength / 10));
  for (let pass = 0; pass < passes; pass += 2) {
    const inner: Vec2[] = [];
    const outer: Vec2[] = [];
    for (let i = 0; i <= samples; i++) {
      const along = (i / samples) * hole.centerlineLength;
      const { point, tangent } = pointAlongPolyline(hole.centerline, along);
      const width = hole.fairwayHalfWidth(along);
      if (width <= 0.4) continue;
      const right = { x: -tangent.y, y: tangent.x };
      const a = -width + ((2 * width) / passes) * pass;
      const b = a + (2 * width) / passes;
      inner.push({ x: point.x + right.x * a, y: point.y + right.y * a });
      outer.push({ x: point.x + right.x * b, y: point.y + right.y * b });
    }
    if (inner.length > 2) stripes.push([...inner, ...outer.reverse()]);
  }
  const layer = { stripes };
  stripeCache.set(key, layer);
  return layer;
}

interface SpeckleLayer {
  points: { p: Vec2; r: number; shade: number }[];
}
const speckleCache = new Map<string, SpeckleLayer>();

/** Static grass and sand texture, so the course does not look like flat vector art. */
function speckles(hole: HoleGeometry): SpeckleLayer {
  const key = `${hole.course.id}:${hole.spec.number}`;
  const cached = speckleCache.get(key);
  if (cached) return cached;
  const rng = createRng(`${key}:speckle`);
  const points: SpeckleLayer['points'] = [];
  const { minX, minY, maxX, maxY } = hole.bounds;
  const count = Math.min(2600, Math.round(((maxX - minX) * (maxY - minY)) / 34));
  for (let i = 0; i < count; i++) {
    points.push({
      p: { x: rng.range(minX, maxX), y: rng.range(minY, maxY) },
      r: rng.range(0.5, 1.9),
      shade: rng.next(),
    });
  }
  const layer = { points };
  speckleCache.set(key, layer);
  return layer;
}

// ---------------------------------------------------------------------------
// Main draw
// ---------------------------------------------------------------------------

export function drawHole(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { hole, camera } = options;
  const palette = hole.style.palette;

  ctx.save();
  ctx.clearRect(0, 0, camera.width, camera.height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, camera.width, camera.height);

  // --- Grass bands, widest first ------------------------------------------
  const bands: [readonly Vec2[], string][] = [
    [hole.bands.deepRough, palette.deepRough],
    [hole.bands.heavyRough, palette.heavyRough],
    [hole.bands.lightRough, palette.lightRough],
    [hole.bands.firstCut, palette.firstCut],
    [hole.bands.fairway, palette.fairway],
  ];
  for (const [points, colour] of bands) {
    path(ctx, camera, points);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // --- The mown edges ------------------------------------------------------
  // Each cut of grass stands taller than the one inside it, so every boundary is
  // a step rather than a colour change: the taller band throws a thread of shade
  // across the shorter one, on the side the sun is coming from.
  if (camera.scale > 0.35) {
    const step = clampOffset(shadowOffset(camera, 1.2), 9);
    const edges = [hole.bands.fairway, hole.bands.firstCut, hole.bands.lightRough, hole.bands.heavyRough];
    for (const band of edges) {
      ctx.save();
      path(ctx, camera, band);
      ctx.clip();
      ctx.translate(step.x, step.y);
      ctx.strokeStyle = 'rgba(12, 28, 12, 0.19)';
      ctx.lineWidth = Math.min(12, Math.max(1.4, 2.6 * camera.scale));
      path(ctx, camera, band);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Mowing lines on the fairway ----------------------------------------
  if (camera.scale > 0.55) {
    ctx.save();
    path(ctx, camera, hole.bands.fairway);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (const stripe of fairwayStripes(hole).stripes) {
      path(ctx, camera, stripe);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Desert waste --------------------------------------------------------
  for (const waste of hole.waste) {
    path(ctx, camera, waste.shape.outline);
    ctx.fillStyle = palette.waste;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 92, 58, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // --- Elevation shading ---------------------------------------------------
  drawElevation(ctx, options);

  // --- Texture -------------------------------------------------------------
  if (camera.scale > 0.4) drawSpeckles(ctx, options);

  // --- Water ---------------------------------------------------------------
  for (const water of hole.water) {
    const outline = water.shape.outline;
    path(ctx, camera, outline);
    ctx.fillStyle = palette.water;
    ctx.fill();
    // Ripples.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    const step = Math.max(6, 14 * camera.scale * 0.35);
    for (let y = 0; y < camera.height; y += step) {
      ctx.beginPath();
      for (let x = 0; x <= camera.width; x += 8) {
        const wave = Math.sin(x * 0.05 + y * 0.09 + options.time * 1.1) * 2.2;
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Inner shadow: the bank stands above the surface all the way round.
    ctx.save();
    path(ctx, camera, outline);
    ctx.clip();
    ctx.shadowColor = 'rgba(6, 30, 46, 0.85)';
    ctx.shadowBlur = Math.min(14, Math.max(3, 5 * camera.scale));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(6, 30, 46, 0.9)';
    ctx.lineWidth = Math.min(10, Math.max(2, 3 * camera.scale));
    path(ctx, camera, outline);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(9, 44, 66, 0.75)';
    ctx.lineWidth = 1.5;
    path(ctx, camera, outline);
    ctx.stroke();
  }

  // --- Bunkers -------------------------------------------------------------
  const sandShadow = clampOffset(shadowOffset(camera, 1.5), 10);
  for (const bunker of hole.bunkers) {
    const outline = bunker.shape.outline;
    // Sand sits below the ground it is cut into, so the high side throws a
    // shadow across it and the low lip catches the light.
    ctx.save();
    ctx.shadowColor = bunker.deep ? 'rgba(24, 18, 6, 0.65)' : 'rgba(30, 24, 10, 0.45)';
    ctx.shadowBlur = Math.min(14, Math.max(2, (bunker.deep ? 5 : 3) * camera.scale));
    ctx.shadowOffsetX = sandShadow.x;
    ctx.shadowOffsetY = sandShadow.y;
    path(ctx, camera, outline);
    ctx.fillStyle = palette.sand;
    ctx.fill();
    ctx.restore();
    path(ctx, camera, outline);
    ctx.fillStyle = palette.sand;
    ctx.fill();
    if (camera.scale > 0.8) {
      ctx.save();
      ctx.clip();
      ctx.translate(-sandShadow.x * 1.6, -sandShadow.y * 1.6);
      ctx.strokeStyle = 'rgba(255, 246, 214, 0.5)';
      ctx.lineWidth = Math.min(6, Math.max(1, 1.6 * camera.scale));
      path(ctx, camera, outline);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = bunker.deep ? 'rgba(120, 96, 52, 0.85)' : 'rgba(150, 128, 84, 0.6)';
    ctx.lineWidth = bunker.deep ? 2 : 1.2;
    ctx.stroke();
    if (bunker.deep && camera.scale > 1.2) {
      // A revetted face reads as a darker lip on the green side.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(110, 88, 48, 0.35)';
      ctx.lineWidth = 3;
      openPath(ctx, camera, outline.slice(0, Math.floor(outline.length / 2)));
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Green ---------------------------------------------------------------
  const greenOutline = hole.green.outline;
  const fringeOutline = greenOutline.map((p) => {
    const dx = p.x - hole.greenCenter.x;
    const dy = p.y - hole.greenCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 3.4, y: p.y + (dy / len) * 3.4 };
  });
  // A green is built up, and the pad it sits on is most of what tells you so.
  const padShadow = clampOffset(shadowOffset(camera, 2.6), 14);
  ctx.save();
  ctx.shadowColor = 'rgba(12, 26, 12, 0.55)';
  ctx.shadowBlur = Math.min(16, Math.max(3, 6 * camera.scale));
  ctx.shadowOffsetX = padShadow.x;
  ctx.shadowOffsetY = padShadow.y;
  path(ctx, camera, fringeOutline);
  ctx.fillStyle = palette.fringe;
  ctx.fill();
  ctx.restore();
  path(ctx, camera, fringeOutline);
  ctx.fillStyle = palette.fringe;
  ctx.fill();
  path(ctx, camera, greenOutline);
  ctx.fillStyle = palette.green;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (options.puttingView) drawGreenContours(ctx, options, greenOutline);

  // --- Trees ---------------------------------------------------------------
  for (const tree of hole.trees) {
    drawTree(ctx, options, tree);
  }

  // --- Yardage arcs from the ball -----------------------------------------
  if (!options.puttingView) drawYardageArcs(ctx, options);

  // --- Previous shots ------------------------------------------------------
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.2;
  for (const line of options.shotLines) {
    const a = toScreen(camera, line.from);
    const b = toScreen(camera, line.to);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // --- Dispersion and aim --------------------------------------------------
  if (options.plan && options.showDispersion) drawDispersion(ctx, options, options.plan);
  if (options.putt) drawPuttRead(ctx, options, options.putt);
  if (options.target && !options.putt) drawAimLine(ctx, options);

  // --- Pin -----------------------------------------------------------------
  drawPin(ctx, options);

  // --- Ball and flight -----------------------------------------------------
  drawBallAndFlight(ctx, options);

  // --- Developer overlay ---------------------------------------------------
  if (options.debug) drawDebug(ctx, options, options.debug);

  // --- Vignette ------------------------------------------------------------
  // The eye reads a frame that falls off at the corners as depth. It is the
  // cheapest dimension in the whole renderer.
  const vignette = ctx.createRadialGradient(
    camera.width / 2,
    camera.height / 2,
    Math.min(camera.width, camera.height) * 0.36,
    camera.width / 2,
    camera.height / 2,
    Math.max(camera.width, camera.height) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(4, 12, 6, 0.30)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, camera.width, camera.height);

  ctx.restore();
}

/**
 * Trees are drawn from sprites, not painted one by one. There are a few hundred
 * on a wooded hole and they never change, so each kind is painted once into a
 * small canvas — canopy, highlight and all — and stamped from there. That buys
 * the soft shadow underneath: blurring three hundred shapes a frame would cost
 * the frame rate, blurring four sprites once costs nothing.
 */
type TreeKind = 'conifer' | 'hardwood' | 'gorse' | 'saguaro';

/** Mix a hex colour toward daylight, for the side of a thing the sun is on. */
function lighten(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const mix = (channel: number, target: number) => Math.round(channel + (target - channel) * amount);
  return `rgb(${mix(r, 214)}, ${mix(g, 232)}, ${mix(b, 158)})`;
}

const SPRITE = 96;
const SPRITE_RADIUS = 32;
const spriteCache = new Map<string, HTMLCanvasElement>();
let shadowSprite: HTMLCanvasElement | null = null;

function treeKind(hole: HoleGeometry, radius: number): TreeKind {
  if (hole.style.id === 'desert') return 'saguaro';
  if (hole.style.id === 'links') return 'gorse';
  return radius >= 6.5 ? 'conifer' : 'hardwood';
}

/** A soft round shadow, stamped under everything that stands up off the ground. */
function groundShadow(): HTMLCanvasElement {
  if (shadowSprite) return shadowSprite;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.46)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  shadowSprite = canvas;
  return canvas;
}

function treeSprite(hole: HoleGeometry, kind: TreeKind, variant: number): HTMLCanvasElement {
  const key = `${hole.style.id}:${kind}:${variant}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE;
  canvas.height = SPRITE;
  const ctx = canvas.getContext('2d')!;
  const palette = hole.style.palette;
  const flip = variant % 2 === 0;
  const dark = flip ? palette.treeDark : palette.tree;
  // Sunlit foliage is not the same green as the shaded side of the same tree —
  // it is warmer and much lighter, and without that a wood reads as a stain.
  const light = lighten(flip ? palette.tree : palette.treeDark, 0.16);
  const rng = createRng(`sprite:${key}`);
  const cx = SPRITE / 2;
  const cy = SPRITE / 2;
  const r = SPRITE_RADIUS;

  const rosette = (radius: number, lobes: number, depth: number, fill: string, phase: number) => {
    ctx.beginPath();
    const steps = lobes * 8;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2 + phase;
      const rad = radius * (1 - depth + depth * Math.abs(Math.cos(((a - phase) * lobes) / 2)));
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (kind === 'saguaro') {
    // A column with an arm or two, pale and spiny.
    ctx.fillStyle = flip ? '#5e7a4e' : '#4d6742';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.5, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - r * 0.6, cy + rng.range(-0.1, 0.25) * r, r * 0.33, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.58, cy - rng.range(0.05, 0.35) * r, r * 0.29, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 244, 214, 0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 2, cy - r * 0.46);
    ctx.lineTo(cx - 2, cy + r * 0.46);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(18, 30, 14, 0.35)';
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - r * 0.4);
    ctx.lineTo(cx + 5, cy + r * 0.42);
    ctx.stroke();
  } else if (kind === 'gorse') {
    // A low cushion, and in flower it is unmistakable.
    rosette(r, 5, 0.32, dark, rng.range(0, Math.PI));
    rosette(r * 0.6, 5, 0.3, light, rng.range(0, Math.PI));
    ctx.fillStyle = 'rgba(236, 201, 66, 0.8)';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(cx + rng.range(-r * 0.62, r * 0.62), cy + rng.range(-r * 0.62, r * 0.62), r * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'conifer') {
    // Layered whorls, almost black from above, with the crown catching the sun.
    const phase = rng.range(0, Math.PI);
    rosette(r, 11, 0.13, dark, phase);
    rosette(r * 0.68, 9, 0.12, light, phase + 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52, 38, 24, 0.7)';
    ctx.fill();
  } else {
    // Hardwood: two or three canopies bunched together.
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    ctx.arc(cx - r * 0.44, cy + r * 0.3, r * 0.5, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.4, cy + r * 0.34, r * 0.44, 0, Math.PI * 2);
    ctx.arc(cx + rng.range(-0.2, 0.2) * r, cy - r * 0.46, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - r * 0.24, cy - r * 0.26, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 240, 0.13)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + r * 0.3, cy + r * 0.34, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fill();
  }

  spriteCache.set(key, canvas);
  return canvas;
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  tree: { position: Vec2; radius: number; shade: number },
): void {
  const { camera, hole } = options;
  const centre = toScreen(camera, tree.position);
  const r = tree.radius * camera.scale;
  if (centre.x < -r * 3 || centre.x > camera.width + r * 3 || centre.y < -r * 3 || centre.y > camera.height + r * 3) return;

  // Taller things throw longer shadows, and they all fall the same way.
  const offset = shadowOffset(camera, tree.radius * 0.75);
  const shadowScale = r * 1.5;
  ctx.drawImage(groundShadow(), centre.x + offset.x - shadowScale, centre.y + offset.y - shadowScale * 0.86, shadowScale * 2, shadowScale * 1.72);

  const kind = treeKind(hole, tree.radius);
  const variant = Math.min(2, Math.floor(tree.shade * 3));
  const sprite = treeSprite(hole, kind, variant);
  const size = r * (SPRITE / SPRITE_RADIUS);
  ctx.drawImage(sprite, centre.x - size / 2, centre.y - size / 2, size, size);
}

/**
 * The source image over the reconstruction, and the reconstruction's own
 * boundaries over that. Everything here is a development tool: it draws last,
 * it draws nothing the player sees, and it is off unless asked for.
 */
function drawDebug(ctx: CanvasRenderingContext2D, options: RenderOptions, debug: DebugOptions): void {
  const { camera, hole } = options;
  const reference = hole.spec.reference;

  if (debug.image && reference && debug.opacity > 0.01) {
    // Place the photograph by the transform the trace recorded: pixels to yards,
    // rotate the green onto the y-axis, tee to the origin — then the camera.
    const origin = toScreen(camera, { x: debug.offset.x, y: debug.offset.y });
    const yardsToPixels = camera.scale * reference.scale * debug.zoom;
    const angle = -camera.rotation - reference.angle + debug.rotate;
    ctx.save();
    ctx.globalAlpha = debug.opacity;
    ctx.translate(origin.x, origin.y);
    ctx.rotate(angle);
    // The screen's y points down and the image's y points down too, so the
    // vertical flip the world needs is applied to the world, not to the image.
    ctx.scale(yardsToPixels, yardsToPixels * (reference.flip === -1 ? 1 : -1));
    ctx.drawImage(debug.image, -reference.origin.x, -reference.origin.y);
    ctx.restore();
  }

  const outline = (points: readonly Vec2[], colour: string, width = 1.6) => {
    if (points.length < 2) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    path(ctx, camera, points);
    ctx.stroke();
  };

  const { layers } = debug;
  if (layers.grid) {
    // Fifty-yard rings from the tee: the scale, made visible.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '11px ui-monospace, monospace';
    for (let yards = 50; yards <= hole.centerlineLength + 50; yards += 50) {
      const centre = toScreen(camera, hole.tee);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, yards * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      const label = toScreen(camera, { x: hole.tee.x, y: hole.tee.y + yards });
      ctx.fillText(`${yards}`, label.x + 3, label.y);
    }
  }
  if (layers.rough) {
    outline(hole.bands.deepRough, 'rgba(120, 220, 120, 0.5)');
    outline(hole.bands.lightRough, 'rgba(160, 240, 160, 0.4)');
  }
  if (layers.fairway) outline(hole.bands.fairway, 'rgba(255, 255, 120, 0.9)', 2);
  if (layers.bunkers) for (const bunker of hole.bunkers) outline(bunker.shape.outline, 'rgba(255, 210, 120, 0.95)');
  if (layers.water) for (const water of hole.water) outline(water.shape.outline, 'rgba(120, 200, 255, 0.95)', 2);
  if (layers.ob) for (const zone of hole.ob) outline(zone.shape.outline, 'rgba(255, 110, 110, 0.9)', 2);
  if (layers.paths) for (const cart of hole.paths) outline(cart.shape.outline, 'rgba(230, 230, 230, 0.8)');
  if (layers.green) outline(hole.green.outline, 'rgba(255, 255, 255, 0.95)', 2);
  if (layers.trees) {
    ctx.strokeStyle = 'rgba(80, 255, 160, 0.5)';
    ctx.lineWidth = 1;
    for (const tree of hole.trees) {
      const centre = toScreen(camera, tree.position);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, tree.radius * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (layers.centreline) {
    ctx.strokeStyle = 'rgba(255, 80, 200, 0.95)';
    ctx.lineWidth = 2;
    openPath(ctx, camera, hole.centerline);
    ctx.stroke();
    for (const point of [hole.tee, hole.pin]) {
      const screen = toScreen(camera, point);
      ctx.fillStyle = 'rgba(255, 80, 200, 0.95)';
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawElevation(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { hole, camera } = options;
  const layer = elevationLayer(hole);
  const corners = [
    { x: layer.minX, y: layer.minY + layer.spanY },
    { x: layer.minX + layer.spanX, y: layer.minY + layer.spanY },
    { x: layer.minX + layer.spanX, y: layer.minY },
  ].map((p) => toScreen(camera, p));
  ctx.save();
  // Map the bitmap's top-left, top-right and bottom-right onto the screen.
  const ux = (corners[1].x - corners[0].x) / layer.canvas.width;
  const uy = (corners[1].y - corners[0].y) / layer.canvas.width;
  const vx = (corners[2].x - corners[1].x) / layer.canvas.height;
  const vy = (corners[2].y - corners[1].y) / layer.canvas.height;
  ctx.setTransform(ux, uy, vx, vy, corners[0].x, corners[0].y);
  ctx.imageSmoothingEnabled = true;
  // Soft light, not a grey wash over the top: the lit side of a slope comes up
  // and the shaded side goes down, and the grass keeps its own colour.
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.18;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSpeckles(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera } = options;
  const layer = speckles(options.hole);
  ctx.save();
  for (const speck of layer.points) {
    const p = toScreen(camera, speck.p);
    if (p.x < 0 || p.x > camera.width || p.y < 0 || p.y > camera.height) continue;
    // Never smaller than a pixel: zoomed out to the whole hole, sub-pixel
    // texture rounds away to nothing and the ground goes back to being flat.
    const size = Math.min(3, Math.max(1, speck.r * camera.scale * 0.55));
    ctx.fillStyle = speck.shade > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(p.x, p.y, size, size);
  }
  ctx.restore();
}

function drawYardageArcs(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera, ball, hole } = options;
  const centre = toScreen(camera, ball);
  const toPin = Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (const yards of [50, 100, 150, 200, 250, 300]) {
    if (yards > toPin + 60) continue;
    const r = yards * camera.scale;
    if (r < 30 || r > Math.hypot(camera.width, camera.height)) continue;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${yards}`, centre.x + 3, centre.y - r - 3);
  }
  ctx.restore();
}

function drawDispersion(ctx: CanvasRenderingContext2D, options: RenderOptions, plan: ShotPlan): void {
  const { camera } = options;
  const zones: [number, string, string][] = [];
  if (options.showZones.ninety) zones.push([sigmaForShare(0.9), 'rgba(255, 214, 102, 0.10)', 'rgba(255, 214, 102, 0.40)']);
  if (options.showZones.seventyFive) zones.push([sigmaForShare(0.75), 'rgba(255, 196, 84, 0.13)', 'rgba(255, 196, 84, 0.55)']);
  if (options.showZones.fifty) zones.push([sigmaForShare(0.5), 'rgba(255, 168, 60, 0.20)', 'rgba(255, 176, 66, 0.85)']);

  ctx.save();
  for (const [sigmas, fill, stroke] of zones) {
    const contour = dispersionContour(plan, sigmas, 64);
    path(ctx, camera, contour);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // The expected finish.
  const centre = toScreen(camera, plan.center);
  ctx.strokeStyle = 'rgba(255, 226, 150, 0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(centre.x - 6, centre.y);
  ctx.lineTo(centre.x + 6, centre.y);
  ctx.moveTo(centre.x, centre.y - 6);
  ctx.lineTo(centre.x, centre.y + 6);
  ctx.stroke();
  ctx.restore();
}

function drawAimLine(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera, ball, target } = options;
  if (!target) return;
  const a = toScreen(camera, ball);
  const b = toScreen(camera, target);
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Target crosshair.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
  ctx.moveTo(b.x - 11, b.y);
  ctx.lineTo(b.x - 4, b.y);
  ctx.moveTo(b.x + 4, b.y);
  ctx.lineTo(b.x + 11, b.y);
  ctx.moveTo(b.x, b.y - 11);
  ctx.lineTo(b.x, b.y - 4);
  ctx.moveTo(b.x, b.y + 4);
  ctx.lineTo(b.x, b.y + 11);
  ctx.stroke();
  if (options.hoverTarget) {
    const h = toScreen(camera, options.hoverTarget);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGreenContours(ctx: CanvasRenderingContext2D, options: RenderOptions, greenOutline: Vec2[]): void {
  const { camera, hole } = options;
  ctx.save();
  path(ctx, camera, greenOutline);
  ctx.clip();
  // Slope arrows on a grid across the green.
  const step = 3.2;
  const r = hole.green.radius * 1.5;
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const p = { x: hole.green.centre.x + dx, y: hole.green.centre.y + dy };
      const slope = greenSlopeAt(hole, p);
      const magnitude = Math.hypot(slope.x, slope.y);
      if (magnitude < 0.15) continue;
      const a = toScreen(camera, p);
      const b = toScreen(camera, { x: p.x + (slope.x / magnitude) * 1.5, y: p.y + (slope.y / magnitude) * 1.5 });
      const alpha = Math.min(0.55, 0.12 + magnitude * 0.12);
      ctx.strokeStyle = `rgba(20, 60, 30, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // Arrow head pointing downhill.
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(angle - 0.45) * 4, b.y - Math.sin(angle - 0.45) * 4);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(angle + 0.45) * 4, b.y - Math.sin(angle + 0.45) * 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * The read, drawn but not interactive: the line the ball will take if it is
 * struck properly, and the slope it is fighting. The player chooses a strategy,
 * not a line, so there is nothing here to grab.
 */
function drawPuttRead(ctx: CanvasRenderingContext2D, options: RenderOptions, read: GreenRead): void {
  const { camera, ball, hole } = options;
  const a = toScreen(camera, ball);
  const pin = toScreen(camera, hole.pin);
  ctx.save();

  // Straight line to the hole, for reference.
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(pin.x, pin.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // The curving path a well-struck putt takes.
  const steps = 28;
  const bend = read.breakFeet / 3;
  ctx.strokeStyle = 'rgba(255, 226, 150, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const base = {
      x: ball.x + (hole.pin.x - ball.x) * t,
      y: ball.y + (hole.pin.y - ball.y) * t,
    };
    const curve = bend * (Math.pow(t, 1.75) - t);
    const screen = toScreen(camera, { x: base.x + read.right.x * curve, y: base.y + read.right.y * curve });
    if (i === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  }
  ctx.stroke();

  // Where the ball has to start to get there.
  const startCurve = bend * -1;
  const start = toScreen(camera, {
    x: ball.x + read.line.x * 0.6 + read.right.x * startCurve * 0.14,
    y: ball.y + read.line.y * 0.6 + read.right.y * startCurve * 0.14,
  });
  ctx.strokeStyle = 'rgba(120, 230, 160, 0.8)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(start.x, start.y);
  ctx.stroke();
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera, hole, time, windFrom, windSpeed } = options;
  const base = toScreen(camera, hole.pin);
  const height = Math.max(14, Math.min(34, camera.scale * 7));
  ctx.save();
  // Hole.
  ctx.fillStyle = 'rgba(20, 30, 20, 0.85)';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, Math.max(2, camera.scale * 0.12), Math.max(1.4, camera.scale * 0.08), 0, 0, Math.PI * 2);
  ctx.fill();
  // Pole.
  ctx.strokeStyle = '#f4f4ef';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, base.y - height);
  ctx.stroke();
  // Flag, blown downwind and fluttering.
  const toward = ((windFrom + 180) % 360) * (Math.PI / 180);
  const screenAngle = toward - camera.rotation;
  const direction = Math.sin(screenAngle) >= 0 ? 1 : -1;
  const strength = Math.min(1, windSpeed / 24);
  const flutter = Math.sin(time * 7) * 1.6 * strength;
  const flagLength = (8 + strength * 9) * direction;
  ctx.fillStyle = '#e8523c';
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - height);
  ctx.lineTo(base.x + flagLength, base.y - height + 3 + flutter);
  ctx.lineTo(base.x, base.y - height + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBallAndFlight(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera, ball, flight, trail } = options;
  ctx.save();

  if (trail && trail.length > 1) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    trail.forEach((point, index) => {
      const screen = toScreen(camera, point);
      const lift = point.h * camera.scale * 0.055;
      if (index === 0) ctx.moveTo(screen.x, screen.y - lift);
      else ctx.lineTo(screen.x, screen.y - lift);
    });
    ctx.stroke();
  }

  const position = flight ?? { x: ball.x, y: ball.y, h: 0 };
  const screen = toScreen(camera, position);
  const lift = position.h * camera.scale * 0.055;

  // Shadow on the ground, thrown by the same sun as everything else: it runs
  // away from the ball as the shot climbs and comes back to meet it on landing,
  // which is most of what tells you how high the ball is.
  const heightYards = position.h / 3;
  const cast = shadowOffset(camera, heightYards * 0.8);
  const spread = 1 + Math.min(1.4, heightYards * 0.05);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.36 / spread})`;
  ctx.beginPath();
  ctx.ellipse(screen.x + cast.x, screen.y + cast.y, 3.4 * spread, 2.1 * spread, 0, 0, Math.PI * 2);
  ctx.fill();

  // The ball itself.
  const radius = 3.6 + Math.min(3, position.h * 0.012);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(screen.x, screen.y - lift, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 50, 40, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** A small inset map of the whole hole, for orientation. */
export function drawHoleMap(
  ctx: CanvasRenderingContext2D,
  hole: HoleGeometry,
  ball: Vec2,
  target: Vec2 | null,
  width: number,
  height: number,
  rotation: number,
): void {
  const camera: Camera = {
    center: { x: 0, y: 0 },
    scale: 1,
    width,
    height,
    rotation,
  };
  const points = [
    { x: hole.bounds.minX, y: hole.bounds.minY },
    { x: hole.bounds.maxX, y: hole.bounds.maxY },
    { x: hole.bounds.minX, y: hole.bounds.maxY },
    { x: hole.bounds.maxX, y: hole.bounds.minY },
  ];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const rx = p.x * c - p.y * s;
    const ry = p.x * s + p.y * c;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
  }
  const scale = Math.min(width / (maxX - minX + 20), height / (maxY - minY + 20));
  camera.scale = scale;
  const ic = Math.cos(-rotation);
  const is = Math.sin(-rotation);
  const midRx = (minX + maxX) / 2;
  const midRy = (minY + maxY) / 2;
  camera.center = { x: midRx * ic - midRy * is, y: midRx * is + midRy * ic };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(12, 22, 16, 0.72)';
  ctx.fillRect(0, 0, width, height);
  path(ctx, camera, hole.bands.deepRough);
  ctx.fillStyle = hole.style.palette.deepRough;
  ctx.fill();
  path(ctx, camera, hole.bands.fairway);
  ctx.fillStyle = hole.style.palette.fairway;
  ctx.fill();
  for (const water of hole.water) {
    path(ctx, camera, water.shape.outline);
    ctx.fillStyle = hole.style.palette.water;
    ctx.fill();
  }
  for (const bunker of hole.bunkers) {
    path(ctx, camera, bunker.shape.outline);
    ctx.fillStyle = hole.style.palette.sand;
    ctx.fill();
  }
  path(ctx, camera, hole.green.outline);
  ctx.fillStyle = hole.style.palette.green;
  ctx.fill();

  if (target) {
    const t = toScreen(camera, target);
    ctx.strokeStyle = 'rgba(255, 226, 150, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const b = toScreen(camera, ball);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(b.x, b.y, 2.6, 0, Math.PI * 2);
  ctx.fill();
}
