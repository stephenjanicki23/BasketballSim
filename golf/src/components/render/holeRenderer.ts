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
import { type Vec2, blobOutline, pointAlongPolyline } from '../../simulation/geometry';
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

/** A coarse light-and-shade bitmap of the hole's height field. */
function elevationLayer(hole: HoleGeometry): ShadeLayer {
  const key = `${hole.course.id}:${hole.spec.number}`;
  const cached = shadeCache.get(key);
  if (cached) return cached;

  const cols = 96;
  const rows = 160;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const { minX, minY, maxX, maxY } = hole.bounds;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const image = ctx.createImageData(cols, rows);

  // Shade by the slope facing a light from the north-west, plus height.
  const sample = (cx: number, cy: number) =>
    hole.elevationAt({ x: minX + (cx / cols) * spanX, y: minY + (cy / rows) * spanY });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const here = sample(col, row);
      const dx = sample(col + 1, row) - here;
      const dy = sample(col, row + 1) - here;
      const light = -dx * 0.5 + dy * 0.5;
      const height = here * 0.9;
      const value = light * 16 + height * 1.1;
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
        image.data[index + 1] = 255;
        image.data[index + 2] = 236;
        image.data[index + 3] = Math.min(70, value * 3.2) * fade;
      } else {
        image.data[index] = 12;
        image.data[index + 1] = 24;
        image.data[index + 2] = 14;
        image.data[index + 3] = Math.min(80, -value * 3.4) * fade;
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
    path(ctx, camera, waste.polygon);
    ctx.fillStyle = palette.waste;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 92, 58, 0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // --- Elevation shading ---------------------------------------------------
  drawElevation(ctx, options);

  // --- Texture -------------------------------------------------------------
  if (camera.scale > 0.9) drawSpeckles(ctx, options);

  // --- Water ---------------------------------------------------------------
  for (const water of hole.water) {
    const outline = water.blob ? blobOutline(water.blob, 56) : water.polygon ?? [];
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
    ctx.strokeStyle = 'rgba(9, 44, 66, 0.75)';
    ctx.lineWidth = 1.5;
    path(ctx, camera, outline);
    ctx.stroke();
  }

  // --- Bunkers -------------------------------------------------------------
  for (const bunker of hole.bunkers) {
    const outline = blobOutline(bunker.blob, 44);
    path(ctx, camera, outline);
    ctx.fillStyle = palette.sand;
    ctx.fill();
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
  const greenOutline = blobOutline(hole.green, 72);
  const fringeOutline = greenOutline.map((p) => {
    const dx = p.x - hole.greenCenter.x;
    const dy = p.y - hole.greenCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 3.4, y: p.y + (dy / len) * 3.4 };
  });
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

  ctx.restore();
}

/**
 * A tree from above. What kind of tree matters: a stand of pines reads as dark
 * rosettes, hardwoods as lumpy clumps of two or three canopies, gorse as a low
 * olive cushion with flower on it, and a cactus as a pale column with arms. Same
 * circle in the simulation, three different places to be in trouble.
 */
function drawTree(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions,
  tree: { position: Vec2; radius: number; shade: number },
): void {
  const { camera, hole } = options;
  const palette = hole.style.palette;
  const centre = toScreen(camera, tree.position);
  const r = tree.radius * camera.scale;
  if (centre.x < -r * 2 || centre.x > camera.width + r * 2 || centre.y < -r * 2 || centre.y > camera.height + r * 2) return;

  // Everything is lit from the north-west, so every shadow falls the same way.
  ctx.beginPath();
  ctx.ellipse(centre.x + r * 0.28, centre.y + r * 0.34, r * 1.02, r * 0.88, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  ctx.fill();

  const dark = tree.shade > 0.5 ? palette.treeDark : palette.tree;
  const light = tree.shade > 0.5 ? palette.tree : palette.treeDark;

  const rosette = (radius: number, lobes: number, depth: number, fill: string) => {
    ctx.beginPath();
    const steps = lobes * 6;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rad = radius * (1 - depth + depth * Math.abs(Math.cos((a * lobes) / 2)));
      const x = centre.x + Math.cos(a) * rad;
      const y = centre.y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  if (hole.style.id === 'desert') {
    // Saguaro: a column with an arm or two, pale and spiny.
    ctx.fillStyle = tree.shade > 0.4 ? '#5e7a4e' : '#4d6742';
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y, r * 0.52, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centre.x - r * 0.62, centre.y + r * 0.1, r * 0.34, 0, Math.PI * 2);
    ctx.arc(centre.x + r * 0.58, centre.y - r * 0.24, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (r > 4) {
      ctx.strokeStyle = 'rgba(226, 240, 208, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(centre.x, centre.y - r * 0.5);
      ctx.lineTo(centre.x, centre.y + r * 0.5);
      ctx.stroke();
    }
    return;
  }

  if (hole.style.id === 'links') {
    // Gorse: a low cushion, and in flower it is unmistakable.
    rosette(r, 5, 0.3, dark);
    if (r > 3) {
      const rng = createRng(`gorse:${Math.round(tree.position.x)}:${Math.round(tree.position.y)}`);
      ctx.fillStyle = 'rgba(232, 197, 62, 0.75)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(centre.x + rng.range(-r * 0.6, r * 0.6), centre.y + rng.range(-r * 0.6, r * 0.6), Math.max(0.6, r * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  if (tree.radius >= 6.5) {
    // Conifer: layered whorls, almost black from above.
    rosette(r, 7, 0.26, light);
    rosette(r * 0.66, 7, 0.3, dark);
    if (r > 6) {
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, Math.max(0.8, r * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(58, 42, 28, 0.8)';
      ctx.fill();
    }
    return;
  }

  // Hardwood: two or three canopies bunched together.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
  ctx.arc(centre.x - r * 0.52, centre.y + r * 0.3, r * 0.62, 0, Math.PI * 2);
  ctx.arc(centre.x + r * 0.46, centre.y + r * 0.36, r * 0.54, 0, Math.PI * 2);
  ctx.fill();
  if (r > 4) {
    ctx.beginPath();
    ctx.arc(centre.x - r * 0.24, centre.y - r * 0.28, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();
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
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

function drawSpeckles(ctx: CanvasRenderingContext2D, options: RenderOptions): void {
  const { camera } = options;
  const layer = speckles(options.hole);
  ctx.save();
  for (const speck of layer.points) {
    const p = toScreen(camera, speck.p);
    if (p.x < 0 || p.x > camera.width || p.y < 0 || p.y > camera.height) continue;
    ctx.fillStyle = speck.shade > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(p.x, p.y, speck.r * camera.scale * 0.5, speck.r * camera.scale * 0.5);
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
  const r = hole.green.radius * 1.4;
  for (let dy = -r; dy <= r; dy += step) {
    for (let dx = -r; dx <= r; dx += step) {
      const p = { x: hole.greenCenter.x + dx, y: hole.greenCenter.y + dy };
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

  // Shadow on the ground.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(screen.x, screen.y, 3.4, 2.1, 0, 0, Math.PI * 2);
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
    path(ctx, camera, water.blob ? blobOutline(water.blob, 28) : water.polygon ?? []);
    ctx.fillStyle = hole.style.palette.water;
    ctx.fill();
  }
  for (const bunker of hole.bunkers) {
    path(ctx, camera, blobOutline(bunker.blob, 18));
    ctx.fillStyle = hole.style.palette.sand;
    ctx.fill();
  }
  path(ctx, camera, blobOutline(hole.green, 32));
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
