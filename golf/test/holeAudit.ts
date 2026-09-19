/**
 * Does every hole look like a golf hole?
 *
 * The scorecard check says the card is right and test/ranch.ts says the traces
 * are where the printed distances put them. Neither notices sand drawn across a
 * putting surface, an oak standing in the middle of a forced carry, or a green
 * traced so generously that nobody can miss it — all of them authoring slips the
 * engine used to carry through to the screen, and all of them reading to a player
 * as the course being broken rather than hard.
 *
 * The green check is the one that took a player of the course to find: outline a
 * green *complex* off a photograph rather than its putting surface and the hole
 * becomes a dartboard. The 9th at The Ranch came back 47 x 55 yards that way and
 * gave up greens in regulation at 94%.
 *
 *   node tools/tsrun.mjs test/holeAudit.ts [courseId]
 */
import { COURSES, COURSE_BY_ID } from '../src/data/courses';
import { buildHole, terrainAt } from '../src/simulation/courseEngine';
import { dist, pointAlongPolyline, type Vec2 } from '../src/simulation/geometry';
import { createRng } from '../src/simulation/rng';
import type { Course, HoleGeometry, LieType } from '../src/simulation/types';

let failures = 0;
const fail = (what: string, detail: string): void => {
  failures++;
  console.log(`      FAIL ${what}: ${detail}`);
};

/** Points spread over the putting surface, for asking what is on it. */
function greenSamples(hole: HoleGeometry): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    for (const r of [0.3, 0.7, 0.95]) {
      const p = {
        x: hole.greenCenter.x + Math.cos(angle) * hole.green.radius * r,
        y: hole.greenCenter.y + Math.sin(angle) * hole.green.radius * r,
      };
      if (hole.green.contains(p)) points.push(p);
    }
  }
  return points;
}

/** The first point of the line of play with a tree standing on it, if any. */
function blockedAt(hole: HoleGeometry, upTo: number): number | null {
  for (let along = 20; along < Math.min(upTo, hole.centerlineLength); along += 4) {
    const { point } = pointAlongPolyline(hole.centerline, along);
    if (hole.trees.some((tree) => dist(tree.position, point) < tree.radius)) return Math.round(along);
  }
  return null;
}

function audit(course: Course): void {
  console.log(`\n  ${course.name}`);
  let worstFairway = Infinity;
  for (const spec of course.holes) {
    const hole = buildHole(course, spec);
    const surface = greenSamples(hole);

    const sand = surface.filter((p) => hole.bunkers.some((b) => b.shape.contains(p))).length;
    if (sand > 0) fail(`hole ${spec.number} has sand on the green`, `${sand} of ${surface.length} sampled points`);

    const wet = surface.filter((p) => hole.water.some((w) => w.shape.contains(p))).length;
    if (wet > 0) fail(`hole ${spec.number} has water on the green`, `${wet} of ${surface.length} sampled points`);

    // Nobody plants a tree in front of a tee. Past the first stretch it is
    // architecture — a stand across a dogleg corner is the point of the hole —
    // so only the opening yards are held to this, and a par 3 all the way to
    // the green, because its whole length is the shot.
    const limit = spec.par === 3 ? hole.centerlineLength * 0.8 : 60;
    const blocked = blockedAt(hole, limit);
    if (blocked !== null) fail(`hole ${spec.number} has a tree in the line of play`, `${blocked} yards from the tee`);

    // Scenery is the view, not the course. It never reaches terrainAt, so it
    // cannot change a lie — but it must not be DRAWN over ground anyone plays
    // from either, or the sea beside a cliff hole looks like a hazard on it.
    // Everything beyond the corridor's last band is the surround or out of
    // bounds; nothing mown, and no hazard, may have scenery on it.
    // What counts as off the course: out of bounds, the surround beyond the last
    // mown band, and under a tree out there — which is the wood being drawn.
    // Everything else is ground somebody plays a shot from, and the view has no
    // business on it.
    const OFF_COURSE = new Set<LieType>([
      'ob', 'recovery', course.style === 'desert' ? 'waste' : 'deepRough',
    ]);
    for (const band of hole.scenery) {
      const { minX, minY, maxX, maxY } = band.shape.bounds;
      const inside: Vec2[] = [];
      const rng = createRng(`${course.id}:${spec.number}:scenery-audit`);
      for (let i = 0; i < 1200 && inside.length < 200; i++) {
        const p = { x: rng.range(minX, maxX), y: rng.range(minY, maxY) };
        if (band.shape.contains(p)) inside.push(p);
      }
      const onCourse = inside.filter((p) => !OFF_COURSE.has(terrainAt(hole, p).lie));
      if (onCourse.length > 0) {
        const worst = terrainAt(hole, onCourse[0]).lie;
        fail(
          `hole ${spec.number} has ${band.kind} scenery on ground you play from`,
          `${onCourse.length} of ${inside.length} sampled points are ${worst} — scenery belongs past the last band`,
        );
      }
    }

    // The tee itself has to be ground you would tee up on.
    const teeLie = terrainAt(hole, hole.tee).lie;
    if (teeLie === 'water' || teeLie === 'ob') fail(`hole ${spec.number} tees off from ${teeLie}`, 'the tee is inside a hazard');

    // A green is between twenty and forty-odd yards across. Tracing one off a
    // photograph is where that goes wrong: outline the green *complex* — apron,
    // collar and all — and the hole turns into a dartboard nobody can miss. The
    // 9th at The Ranch came back 47 x 55 yards that way, and played it.
    const { minX, minY, maxX, maxY } = hole.green.bounds;
    const long = Math.max(maxX - minX, maxY - minY);
    const short = Math.min(maxX - minX, maxY - minY);
    // A traced green is a measurement of a putting surface and is held to one; a
    // grown one comes from `greenSize` and only needs to be sane.
    const widest = spec.greenShape ? 46 : 60;
    if (long > widest) fail(`hole ${spec.number} green is too big`, `${short.toFixed(0)} x ${long.toFixed(0)} yd — an outlined green complex rather than a putting surface?`);
    if (short < 14) fail(`hole ${spec.number} green is too small`, `${short.toFixed(0)} x ${long.toFixed(0)} yd`);

    // The card yardage is measured to the middle of the green, so the far end of
    // the line of play has to land on the putting surface. When a traced green is
    // outlined in the wrong place the hole still measures correctly and still
    // passes every leg check — it just leaves the green floating off the end of
    // its own corridor, which is how the 9th at The Ranch went out a dozen yards
    // beyond where it sits.
    if (spec.greenShape) {
      const end = pointAlongPolyline(hole.centerline, hole.centerlineLength).point;
      const off = hole.green.edgeDistance(end);
      if (off > 0) {
        fail(
          `hole ${spec.number} green is not at the end of the hole`,
          `the line of play finishes ${off.toFixed(0)} yd off the putting surface — traced in the wrong place?`,
        );
      }
    }

    if (spec.par !== 3) {
      const landing = Math.min(290, hole.centerlineLength * 0.62);
      worstFairway = Math.min(worstFairway, hole.fairwayHalfWidth(landing) * 2);
    }
  }
  console.log(`    18 holes checked — narrowest driving corridor ${worstFairway.toFixed(0)} yd`);
}

const only = process.argv[2];
console.log('Hole audit');
for (const course of only ? [COURSE_BY_ID[only]] : COURSES) audit(course);
console.log(`\n${failures} problem${failures === 1 ? '' : 's'}`);
if (failures > 0) process.exitCode = 1;
