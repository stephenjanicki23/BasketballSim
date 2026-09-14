/**
 * The Ranch against its own overheads.
 *
 * Every hole's overhead prints three numbers: the card yardage, the distance
 * from the tee to the fairway marker, and the distance from the marker to the
 * green. Both legs are measured along the line of play, which is why they add up
 * to the card and why they carry no information about how far the hole moves
 * sideways. What they do carry, exactly, is *where* the hole turns — the marker
 * fraction — and that is a real constraint on the geometry, so this checks it:
 *
 *   1. the legs agree with the card,
 *   2. every corner sits at the printed marker fraction,
 *   3. no hole bends so hard that the card could not have been measured along it.
 *
 *   node tools/tsrun.mjs test/ranch.ts
 */
import { THE_RANCH, SPLITS } from '../src/data/courses/ranch';
import { buildHole } from '../src/simulation/courseEngine';
import { dist, polylineLength } from '../src/simulation/geometry';
import type { HoleSpec } from '../src/simulation/types';

/** The legs are printed to the yard and the corner is where they disagree most. */
const LEG_TOLERANCE = 35;
/** How close a corner has to sit to its printed fraction. */
const CORNER_TOLERANCE = 0.12;
/** A corner: anything that moves the corridor less than this is a plate, not a turn. */
const CORNER_SHIFT = 25;
/** The card is measured along the line of play, so the chord cannot be far short of it. */
const MIN_CHORD_RATIO = 0.9;

let failures = 0;
const fail = (what: string, got: unknown, want: unknown): void => {
  failures++;
  console.log(`      FAIL ${what}: ${got}, expected ${want}`);
};

/**
 * Where the corridor turns, as a fraction of the hole. A traced hole turns at
 * the vertex the trace put there — which is the marker itself, so checking it
 * against the printed fraction says whether the trace read the image right. An
 * authored hole turns at its largest bend.
 */
function corner(spec: HoleSpec): { at: number; shift: number } | null {
  const line = spec.centreline;
  if (line && line.length > 2) {
    const tee = line[0];
    const green = line[line.length - 1];
    const dx = green.x - tee.x;
    const dy = green.y - tee.y;
    // How far the corner stands off the tee-to-green line; positive is right of
    // it, the same convention a bend's shift uses.
    const offset = ((line[1].x - tee.x) * dy - (line[1].y - tee.y) * dx) / Math.hypot(dx, dy);
    return { at: polylineLength(line.slice(0, 2)) / polylineLength(line), shift: offset };
  }
  if (!spec.bends?.length) return null;
  const biggest = [...spec.bends].sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))[0];
  return Math.abs(biggest.shift) >= CORNER_SHIFT ? { at: biggest.at, shift: biggest.shift } : null;
}

console.log('The Ranch — geometry against the printed overheads\n');
console.log('  hole  par  card    printed legs   marker   corner   chord');

for (const spec of THE_RANCH.holes) {
  const legs = SPLITS[spec.number];
  const hole = buildHole(THE_RANCH, spec);
  const chord = dist(hole.tee, hole.greenCenter);
  const ratio = chord / spec.yards;
  const turn = corner(spec);
  const row = (printed: string, marker: string) =>
    console.log(
      `    ${String(spec.number).padStart(2)}    ${spec.par}   ${String(spec.yards).padStart(3)}` +
        `   ${printed.padEnd(14)} ${marker.padEnd(8)} ${(turn ? `${turn.at.toFixed(2)} ${turn.shift > 0 ? 'R' : 'L'}${Math.round(Math.abs(turn.shift))}` : '—').padEnd(9)} ` +
        `${(ratio * 100).toFixed(1)}%`,
    );

  if (!legs) {
    row('(no overhead)', '—');
    continue;
  }

  const walked = legs.reduce((sum, leg) => sum + leg, 0);
  if (Math.abs(walked - spec.yards) > LEG_TOLERANCE) {
    fail(`hole ${spec.number} legs against the card`, `${legs.join(' + ')} = ${walked} vs ${spec.yards}`, `within ${LEG_TOLERANCE} yd`);
  }

  if (legs.length === 1) {
    row(`${legs[0]}`, '—');
  } else {
    const fraction = legs[0] / walked;
    row(`${legs[0]} + ${legs[1]}`, fraction.toFixed(3));
    if (turn && Math.abs(turn.at - fraction) > CORNER_TOLERANCE) {
      fail(`hole ${spec.number} corner`, `at ${turn.at.toFixed(2)} of the hole`, `the marker at ${fraction.toFixed(2)} ± ${CORNER_TOLERANCE}`);
    }
  }

  if (ratio < MIN_CHORD_RATIO) {
    fail(`hole ${spec.number} bends too hard for its card`, `tee to green is ${(ratio * 100).toFixed(1)}% of the yardage`, `at least ${MIN_CHORD_RATIO * 100}%`);
  }
}

const traced = THE_RANCH.holes.filter((hole) => hole.centreline).length;
console.log(
  `\n  all ${THE_RANCH.holes.length} holes off the overheads, ${traced} of them traced from the image itself` +
    ` — ${failures} failure${failures === 1 ? '' : 's'}`,
);
if (failures > 0) process.exitCode = 1;
