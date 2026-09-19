/**
 * Building a golf course from a brief.
 *
 * Six venues are authored hole by hole, three of them traced off real
 * photographs. That is the right way to build a course somebody has walked, and
 * completely the wrong way to build fourteen more: 252 holes of hand-typed
 * geometry is 252 chances to leave sand on a green, and the interesting part of
 * a course — what it asks of you — is not in the coordinates anyway.
 *
 * So an invented venue is authored as a *brief*: its card, its character, and
 * eighteen hole names. Everything geometric is derived from that, deterministically
 * from the course id, and then held to exactly the same audit as the hand-built
 * ones — no sand on a green, no tree in the line of play, a green you can miss,
 * a fairway you can hit.
 *
 * The knobs in `Character` are the design language. A links course is wide, treeless
 * and pitted with sand; a parkland course is narrow, walled with timber and has
 * water where the architect wanted you to think. Two courses with the same card and
 * different characters come out as different golf courses, which is the whole point.
 */

import { clamp, createRng, type Rng } from '../../simulation/rng';
import type {
  BunkerSpec, Course, CourseStyleId, GroveSpec, HoleSpec, LandformSpec, WasteSpec, WaterSpec,
} from '../../simulation/types';

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface Character {
  /** Fairway half-width in yards at the landing area: [tightest hole, widest]. */
  width: [number, number];
  /** Green radius in yards: [smallest, largest]. */
  greens: [number, number];
  /**
   * How far a hole bends, in yards of lateral shift at the corner. A links can
   * be dead straight and still be hard; a parkland course that is straight is
   * just a driving range.
   */
  dogleg: [number, number];
  /** Elevation swing in feet across a hole. 0 is a flat site. */
  relief: number;
  /** Bunkers per hole, roughly: [fewest, most]. */
  sand: [number, number];
  /** Holes with water in play, 1-based. */
  water: number[];
  /** Green contour severity, roughly percent of fall. */
  slope: number;
  /**
   * Density of the tree line beside the corridor, 0..1. Zero is a links: no
   * trees at all, and the hole is defined by sand and ground contour instead.
   */
  grove: number;
  /** Scrub or hardpan outside the corridor, which is a desert thing. */
  waste?: boolean;
  /** Distance from the corridor edge to the first trunks, in yards. */
  treeLine?: number;
  /** Single trees standing in play, on the corners of doglegs. */
  specimens?: boolean;
}

export interface CourseBrief {
  id: string;
  name: string;
  location: string;
  style: CourseStyleId;
  altitude: number;
  surroundWidth?: number;
  blurb: string;
  identity: string[];
  difficulty: number;
  fit: Course['fit'];
  /** The card, hole by hole. */
  pars: (3 | 4 | 5)[];
  /** Total yardage off the back markers. Hole yardages are fitted to it exactly. */
  yards: number;
  /** Eighteen hole names. This is where a course gets most of its character. */
  names: string[];
  character: Character;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/**
 * Hole yardages that add up to the card total exactly.
 *
 * Each hole is drawn from a band for its par, then the whole set is scaled and
 * the rounding error walked off one yard at a time — so the total is the number
 * on the brief rather than the number that happened to come out, and the
 * scorecard check passes for the same reason it does on the hand-built courses.
 */
function cardYardages(pars: (3 | 4 | 5)[], total: number, rng: Rng): number[] {
  const band: Record<3 | 4 | 5, [number, number]> = { 3: [155, 240], 4: [345, 495], 5: [505, 620] };
  const raw = pars.map((par) => rng.range(band[par][0], band[par][1]));
  const scale = total / raw.reduce((sum, value) => sum + value, 0);
  const yards = raw.map((value) => Math.round(value * scale));

  // Walk off the rounding error on the holes that can best absorb it — the
  // longest ones, where a yard either way is invisible.
  let drift = total - yards.reduce((sum, value) => sum + value, 0);
  const order = yards.map((_, index) => index).sort((a, b) => yards[b] - yards[a]);
  let at = 0;
  while (drift !== 0) {
    const index = order[at % order.length];
    yards[index] += drift > 0 ? 1 : -1;
    drift += drift > 0 ? -1 : 1;
    at++;
  }
  return yards;
}

/**
 * Stroke indexes, the way a real card assigns them.
 *
 * Holes are ranked by how hard they actually are — length against par first,
 * then the trouble on them — and then the odd numbers go to one nine and the
 * even numbers to the other, which is what stops a matchplay handicap being
 * settled before the turn. The harder nine gets the odds.
 */
function strokeIndexes(holes: { par: number; yards: number; hazards: number }[]): number[] {
  const difficulty = holes.map((hole) => {
    // Yards over what that par is normally worth, plus the hazards on it.
    const par = hole.par === 3 ? 185 : hole.par === 4 ? 420 : 555;
    return (hole.yards - par) / (hole.par === 3 ? 12 : 18) + hole.hazards * 1.6;
  });

  const nineTotal = (from: number) => difficulty.slice(from, from + 9).reduce((sum, value) => sum + value, 0);
  const oddNine = nineTotal(0) >= nineTotal(9) ? 0 : 9;

  const indexes = new Array<number>(18);
  for (const start of [0, 9]) {
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      .map((offset) => start + offset)
      .sort((a, b) => difficulty[b] - difficulty[a]);
    const first = start === oddNine ? 1 : 2;
    order.forEach((hole, rank) => {
      indexes[hole] = first + rank * 2;
    });
  }
  return indexes;
}

// ---------------------------------------------------------------------------
// The routing
// ---------------------------------------------------------------------------

/**
 * Compass bearings for eighteen holes.
 *
 * A real routing turns constantly, because the ground makes it and because
 * playing eighteen holes into the same wind would be unbearable. This walks a
 * loop: each hole turns from the last by a varying amount, with the two nines
 * ending back near where they started. What it buys is entirely about weather —
 * bearing is how the engine knows whether today's wind is helping — so the
 * measure of a good routing here is that no run of holes faces the same way.
 */
function bearings(rng: Rng): number[] {
  const out: number[] = [];
  let heading = rng.range(0, 360);
  for (let nine = 0; nine < 2; nine++) {
    // Nine holes turning by an average of 40 degrees comes back on itself.
    for (let hole = 0; hole < 9; hole++) {
      out.push((heading + 360) % 360);
      const turn = rng.range(25, 95) * (rng.chance(0.28) ? -1 : 1);
      heading += turn;
    }
    heading += rng.range(120, 200);
  }
  return out;
}

/**
 * A site's shape, as a height in feet at each hole.
 *
 * Neighbouring holes sit on neighbouring ground, so the elevation of the 8th
 * green and the 9th tee should have something to do with each other. A smooth
 * walk rather than eighteen independent draws is what makes a course feel like
 * one piece of land instead of eighteen unrelated ones.
 */
function terrain(rng: Rng, relief: number): number[] {
  const out: number[] = [];
  let height = 0;
  let slope = rng.range(-1, 1);
  for (let hole = 0; hole < 18; hole++) {
    out.push(height);
    slope = clamp(slope + rng.range(-0.8, 0.8), -1.4, 1.4);
    height = clamp(height + slope * relief * 0.55, -relief * 1.6, relief * 1.6);
  }
  return out;
}

// ---------------------------------------------------------------------------
// One hole
// ---------------------------------------------------------------------------

interface HoleContext {
  brief: CourseBrief;
  number: number;
  par: 3 | 4 | 5;
  yards: number;
  bearing: number;
  teeHeight: number;
  greenHeight: number;
  rng: Rng;
}

function buildBends(context: HoleContext, shift: number): { bends: HoleSpec['bends']; doglegAt: number } {
  const { par, rng } = context;
  if (par === 3) return { bends: undefined, doglegAt: 0.5 };

  const corner = par === 5 ? rng.range(0.32, 0.42) : rng.range(0.42, 0.58);
  // A par 5 gets a second turn, which is what makes the layup a decision rather
  // than an inevitability; a par 4 gets a small counter-bend into the green so
  // the approach is not down the same line as the drive.
  const bends =
    par === 5
      ? [
          { at: corner, shift, turn: rng.range(0.12, 0.17) },
          { at: rng.range(0.68, 0.8), shift: Math.round(-shift * rng.range(0.25, 0.5)), turn: rng.range(0.11, 0.16) },
        ]
      : [
          { at: corner, shift, turn: rng.range(0.12, 0.18) },
          { at: rng.range(0.78, 0.88), shift: Math.round(-shift * rng.range(0.15, 0.35)), turn: rng.range(0.1, 0.15) },
        ];
  return { bends, doglegAt: corner };
}

/**
 * The fairway's width down the hole: wide off the tee, pinched where the
 * architect wants the drive to finish, and opening again at the green.
 */
function widthProfile(context: HoleContext, half: number): { at: number; half: number }[] {
  const { par, rng } = context;
  if (par === 3) return [];
  const pinch = Math.round(half * rng.range(0.66, 0.82));
  const landing = par === 5 ? rng.range(0.48, 0.6) : rng.range(0.58, 0.72);
  return [
    { at: 0.08, half: half + 2 },
    { at: landing - 0.14, half },
    { at: landing, half: pinch },
    { at: 0.92, half: Math.round(half * 0.9) },
    { at: 1, half: Math.round(half * 0.86) },
  ];
}

function buildBunkers(context: HoleContext, half: number, shift: number): BunkerSpec[] {
  const { brief, par, yards, rng } = context;
  const [fewest, most] = brief.character.sand;
  const wanted = Math.round(rng.range(fewest, most));
  const out: BunkerSpec[] = [];

  // Greenside first, because a hole without one is unusual and a green with sand
  // on both sides and none short is the shape that makes a par 3 frightening.
  const greensideCount = clamp(Math.round(rng.range(1, Math.min(3, wanted))), 1, 3);
  const sides: number[] = greensideCount === 1 ? [rng.chance(0.5) ? 1 : -1] : [1, -1, rng.chance(0.5) ? 1 : -1];
  for (let i = 0; i < greensideCount; i++) {
    const side = sides[i];
    out.push({
      along: Math.round(yards - rng.range(4, 22)),
      lateral: Math.round(side * rng.range(17, 24)),
      size: Math.round(rng.range(6, 10)),
      kind: 'greenside',
      deep: rng.chance(0.35),
      stretch: Math.round(rng.range(1, 1.8) * 10) / 10,
    });
  }

  // Fairway sand goes where a good drive finishes, on the side the hole bends
  // away from — the inside of the dogleg, which is the shortcut you have to
  // decide whether to take on.
  if (par !== 3) {
    const carry = par === 5 ? rng.range(0.42, 0.56) : rng.range(0.6, 0.72);
    for (let i = 0; i < wanted - greensideCount; i++) {
      const inside = shift === 0 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(shift);
      const side = i === 0 ? inside : -inside;
      out.push({
        along: Math.round(yards * (carry + rng.range(-0.06, 0.06))),
        lateral: Math.round(side * (half + rng.range(1, 7))),
        size: Math.round(rng.range(7, 11)),
        kind: 'fairway',
        deep: rng.chance(0.2),
        stretch: Math.round(rng.range(1, 2.2) * 10) / 10,
      });
    }
  }
  return out;
}

/**
 * Water, on the holes the brief says have it.
 *
 * Two shapes, and the difference matters to how the hole is played: a strip runs
 * down one side and is a thing you keep away from all day, while a pond in front
 * of a green is a carry you either take on or lay up short of.
 */
function buildWater(context: HoleContext, half: number): WaterSpec[] {
  const { brief, number, par, yards, rng } = context;
  if (!brief.character.water.includes(number)) return [];
  const side: -1 | 1 = rng.chance(0.5) ? 1 : -1;

  if (par === 3 || rng.chance(0.45)) {
    // Short of the green, across the line: the carry.
    return [{
      along: Math.round(yards - rng.range(28, 52)),
      lateral: Math.round(side * rng.range(-6, 10)),
      size: Math.round(rng.range(16, 26)),
      stretch: Math.round(rng.range(1.4, 2.6) * 10) / 10,
      label: 'the carry',
    }];
  }
  // Down the side, tight to the green.
  const from = Math.round(yards * rng.range(0.45, 0.62));
  return [{
    along: 0, lateral: 0, size: 0,
    strip: {
      from,
      to: Math.round(yards + rng.range(6, 24)),
      side,
      offset: Math.round(half + rng.range(2, 8)),
      width: Math.round(rng.range(30, 60)),
    },
    label: 'the water',
  }];
}

function buildGroves(context: HoleContext, half: number): GroveSpec[] {
  const { brief, par, yards, rng } = context;
  const density = brief.character.grove;
  if (density <= 0) return [];

  // How far the first trunks stand from the edge of the fairway. The audit
  // refuses a tree standing on the line of play, and on a par 3 that means the
  // whole length of it — so the clearance is computed from the corridor, not
  // guessed, and the canopy radius is taken off it.
  const canopy: [number, number] = [2.6, 5.4];
  const line = brief.character.treeLine ?? 12;
  const offset = Math.max(line, canopy[1] + 4 - half + 8);

  const out: GroveSpec[] = [];
  const start = par === 3 ? 25 : 90;
  // How often a hole has timber down only one side. On a lightly wooded course
  // that is most of the character — trees on the right, open ground left, and a
  // decision about which way to miss. In a forest it never happens, and a hole
  // with one wall and one open side would not read as the place at all.
  const oneSided = clamp(0.3 - density * 0.35, 0, 0.3);
  for (const side of [-1, 1] as const) {
    if (par !== 3 && rng.chance(oneSided)) continue;
    out.push({
      from: Math.round(start + rng.range(0, 40)),
      to: Math.round(yards - rng.range(0, 40)),
      side,
      offset: Math.round(offset + rng.range(0, 8)),
      depth: Math.round(rng.range(18, 34)),
      density: Math.round(clamp(density + rng.range(-0.1, 0.1), 0.12, 0.85) * 100) / 100,
      canopy,
    });
  }
  return out;
}

function buildWaste(context: HoleContext, half: number): WasteSpec[] | undefined {
  const { brief, yards, rng } = context;
  if (!brief.character.waste) return undefined;
  return ([-1, 1] as const).map((side) => ({
    from: Math.round(rng.range(40, 80)),
    to: Math.round(yards - rng.range(0, 30)),
    side,
    offset: Math.round(half + rng.range(14, 24)),
    width: Math.round(rng.range(50, 80)),
  }));
}

function buildLandforms(context: HoleContext, relief: number): LandformSpec[] {
  const { yards, rng } = context;
  if (relief < 6) return [];
  const out: LandformSpec[] = [{
    at: Math.round(rng.range(0.35, 0.62) * 100) / 100,
    rise: Math.round(rng.range(-1, 1) * relief * 0.7),
    length: Math.round(yards * rng.range(0.25, 0.4)),
    lateral: Math.round(rng.range(-40, 40)),
    width: Math.round(rng.range(22, 40)),
  }];
  if (rng.chance(0.45)) {
    out.push({
      at: Math.round(rng.range(0.68, 0.88) * 100) / 100,
      rise: Math.round(rng.range(-1, 1) * relief * 0.45),
      length: Math.round(yards * rng.range(0.18, 0.28)),
    });
  }
  return out;
}

/** What the hole asks of you, written from what is actually on it. */
function strategyFor(spec: HoleSpec, context: HoleContext, half: number): string {
  const { par, yards } = context;
  const climb = spec.elevation.green;
  const parts: string[] = [];

  const shape = spec.dogleg > 14 ? 'bends right' : spec.dogleg < -14 ? 'bends left' : 'runs straight';
  const relief = climb > 14 ? 'uphill' : climb < -14 ? 'downhill' : 'level';
  const width = half >= 26 ? 'generous' : half >= 20 ? 'fair' : half >= 16 ? 'tight' : 'very tight';

  if (par === 3) {
    parts.push(`${yards} yards, ${relief === 'level' ? 'flat' : relief}`);
  } else {
    parts.push(`${shape}, ${relief}, and the corridor is ${width}`);
  }

  const fairwaySand = spec.bunkers.filter((b) => b.kind === 'fairway');
  if (fairwaySand.length) {
    const nearest = fairwaySand.reduce((a, b) => (a.along < b.along ? a : b));
    parts.push(`the sand at ${nearest.along} is the one that matters off the tee`);
  }
  if (spec.water.length) {
    const strip = spec.water[0].strip;
    parts.push(strip ? `water all the way down the ${strip.side > 0 ? 'right' : 'left'}` : 'water short of the green');
  }
  const greensideSand = spec.bunkers.filter((b) => b.kind === 'greenside');
  if (greensideSand.length >= 2) parts.push('sand both sides of the green');
  else if (greensideSand.length === 1) parts.push(`sand ${greensideSand[0].lateral > 0 ? 'right' : 'left'} of the green`);
  if (Math.abs(spec.greenSlope.y) > 2.2 || Math.abs(spec.greenSlope.x) > 2.2) parts.push('and the green has real movement in it');

  const sentence = parts.join(', ').replace(/,([^,]*)$/, spec.water.length || parts.length > 2 ? ',$1' : '$1');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function buildHoleSpec(context: HoleContext): HoleSpec {
  const { brief, number, par, yards, bearing, teeHeight, greenHeight, rng } = context;
  const { character } = brief;

  const half = Math.round(
    par === 3
      ? rng.range(character.width[0], character.width[1]) * 0.65
      : rng.range(character.width[0], character.width[1]),
  );

  const shift =
    par === 3 ? 0 : Math.round(rng.range(character.dogleg[0], character.dogleg[1]) * (rng.chance(0.5) ? 1 : -1));
  const { bends, doglegAt } = buildBends(context, shift);

  /**
   * The green's radius, clamped to what actually makes a putting surface.
   *
   * `buildHole` grows the green from this with `blobFrom(centre, greenSize, …,
   * stretch 1.05–1.45, axis, wobble 0.13)`, and the audit measures the *bounding
   * box* of the result. A blob of radius r stretched by s and wobbled by w has a
   * box no larger than `2·r·s·(1+w)` on its long side and no smaller than
   * `2·r·(1−w)` on its short one — so at the extremes, `3.28·r` and `1.74·r`.
   * Against the audit's limits of 60 and 14 that makes the whole legal range
   * 9 to 18, and a brief cannot ask for more.
   *
   * Worth deriving rather than guessing: the first draft allowed 24 and produced
   * greens 65 yards long that nobody could miss, and the second allowed 19 and
   * produced exactly one at 62 — because a blob stretched diagonally has a bigger
   * axis-aligned box than either of its own axes.
   */
  const greenSize = Math.round(
    clamp(
      rng.range(character.greens[0], character.greens[1]) - (par === 3 ? 1 : 0) + (yards > 560 ? 1 : 0),
      9,
      18,
    ),
  );

  // Elevation is the site's height at the green against the tee, plus a bit of
  // movement in between — not an independent draw, so the course walks.
  const fall = Math.round(greenHeight - teeHeight);
  const bunkers = buildBunkers(context, half, shift);
  const water = buildWater(context, half);

  const spec: HoleSpec = {
    number,
    name: brief.names[number - 1],
    par,
    yards,
    bearing: Math.round(bearing),
    index: 0, // assigned once every hole is known
    dogleg: par === 3 ? 0 : Math.round(shift * 0.35),
    doglegAt: Math.round(doglegAt * 100) / 100,
    fairwayWidth: half,
    bends,
    widths: widthProfile(context, half),
    groves: buildGroves(context, half),
    landforms: buildLandforms(context, character.relief),
    elevation: { landing: Math.round(fall * rng.range(0.2, 0.7)), green: fall },
    greenSize,
    pin: {
      x: Math.round(rng.range(-1, 1) * greenSize * 0.4),
      y: Math.round(rng.range(-1, 1) * greenSize * 0.4),
    },
    greenSlope: {
      x: Math.round(rng.range(-1, 1) * character.slope * 10) / 10,
      y: Math.round(rng.range(-1, 1) * character.slope * 10) / 10,
    },
    trees: Math.round(clamp(character.grove * rng.range(0.5, 1.1), 0, 0.6) * 100) / 100,
    bunkers,
    water,
    waste: buildWaste(context, half),
    strategy: '',
  };

  // A tree standing on a dogleg corner is architecture; one anywhere near the
  // line of play is a mistake the audit will not let through, so they only go
  // out wide and only on holes with a drive to shape.
  if (character.specimens && par !== 3 && shift !== 0 && rng.chance(0.4)) {
    spec.specimens = [{
      along: Math.round(yards * rng.range(0.45, 0.65)),
      lateral: Math.round(Math.sign(shift) * (half + rng.range(16, 30))),
      radius: Math.round(rng.range(3, 5.5) * 10) / 10,
    }];
  }

  spec.strategy = strategyFor(spec, context, half);
  return spec;
}

// ---------------------------------------------------------------------------
// The course
// ---------------------------------------------------------------------------

export function buildCourse(brief: CourseBrief): Course {
  if (brief.pars.length !== 18) throw new Error(`${brief.id}: needs 18 pars, has ${brief.pars.length}`);
  if (brief.names.length !== 18) throw new Error(`${brief.id}: needs 18 hole names, has ${brief.names.length}`);

  const rng = createRng(`course:${brief.id}`);
  const yards = cardYardages(brief.pars, brief.yards, rng.fork('card'));
  const compass = bearings(rng.fork('routing'));
  const heights = terrain(rng.fork('terrain'), brief.character.relief);

  const holes = brief.pars.map((par, index) =>
    buildHoleSpec({
      brief,
      number: index + 1,
      par,
      yards: yards[index],
      bearing: compass[index],
      teeHeight: heights[index],
      // The green sits on the next hole's tee ground, give or take, which is what
      // keeps a downhill hole followed by an uphill one rather than a cliff.
      greenHeight: heights[(index + 1) % 18] + (rng.fork(`green:${index}`).range(-1, 1) * brief.character.relief * 0.3),
      rng: rng.fork(`hole:${index + 1}`),
    }),
  );

  const indexes = strokeIndexes(
    holes.map((hole) => ({
      par: hole.par,
      yards: hole.yards,
      hazards: hole.bunkers.length * 0.3 + hole.water.length * 2 + (hole.fairwayWidth < 20 ? 1.5 : 0),
    })),
  );
  holes.forEach((hole, index) => {
    hole.index = indexes[index];
  });

  return {
    id: brief.id,
    name: brief.name,
    location: brief.location,
    style: brief.style,
    par: holes.reduce((sum, hole) => sum + hole.par, 0),
    yards: holes.reduce((sum, hole) => sum + hole.yards, 0),
    blurb: brief.blurb,
    identity: brief.identity,
    altitude: brief.altitude,
    surroundWidth: brief.surroundWidth,
    difficulty: brief.difficulty,
    fit: brief.fit,
    holes,
  };
}
