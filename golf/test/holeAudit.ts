/**
 * Does every hole look like a golf hole?
 *
 * The scorecard check says the card is right and test/ranch.ts says the traces
 * are where the printed distances put them. Neither notices sand drawn across a
 * putting surface or an oak standing in the middle of a forced carry — both of
 * which are authoring slips the engine used to carry through to the screen, and
 * both of which read to a player as the course being broken rather than hard.
 *
 *   node tools/tsrun.mjs test/holeAudit.ts [courseId]
 */
import { COURSES, COURSE_BY_ID } from '../src/data/courses';
import { buildHole, terrainAt } from '../src/simulation/courseEngine';
import { dist, pointAlongPolyline, type Vec2 } from '../src/simulation/geometry';
import type { Course, HoleGeometry } from '../src/simulation/types';

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

    // The tee itself has to be ground you would tee up on.
    const teeLie = terrainAt(hole, hole.tee).lie;
    if (teeLie === 'water' || teeLie === 'ob') fail(`hole ${spec.number} tees off from ${teeLie}`, 'the tee is inside a hazard');

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
