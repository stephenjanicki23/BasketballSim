/**
 * The Ranch against its own overheads.
 *
 * Every hole's overhead prints three numbers: the card yardage, the distance
 * from the tee to the fairway marker, and the distance from the marker to the
 * green. What is checked depends on what the hole is built from.
 *
 * A **traced** hole is held to the legs themselves. The trace runs its play line
 * through the marker, so the two legs come back out of the geometry and can be
 * compared with the printed pair — scaled to the card, because the card is what
 * fixes the scale and the printed legs do not always add up to it. That is the
 * tightest check available: it catches a corner read off the image in the wrong
 * place, at the wrong distance, or on the wrong side.
 *
 * A **derived** hole has no shape of its own to check, so the legs only fix
 * where it turns, and a floor on the tee-to-green chord stops the authoring
 * inventing a dogleg the card could not have been measured along. That floor is
 * *not* applied to traced holes: the real 2nd turns 116 yards off the line and
 * its chord is 81% of the card, which is the hole rather than a mistake.
 *
 *   node tools/tsrun.mjs test/ranch.ts
 */
import { THE_RANCH, SPLITS } from '../src/data/courses/ranch';
import { buildHole } from '../src/simulation/courseEngine';
import { dist, polylineLength } from '../src/simulation/geometry';
import type { HoleGeometry, HoleSpec } from '../src/simulation/types';

/** The legs are printed to the yard and the corner is where they disagree most. */
const LEG_TOLERANCE = 35;
/** How close a traced leg has to come to its printed length, in yards. */
const TRACED_LEG_TOLERANCE = 6;
/** How close a derived corner has to sit to its printed fraction. */
const CORNER_TOLERANCE = 0.12;
/** A corner: anything that moves the corridor less than this is a plate, not a turn. */
const CORNER_SHIFT = 25;
/** A derived hole may not bend so hard that the card could not be measured along it. */
const MIN_CHORD_RATIO = 0.9;

let failures = 0;
const fail = (what: string, got: unknown, want: unknown): void => {
  failures++;
  console.log(`      FAIL ${what}: ${got}, expected ${want}`);
};

/**
 * Where the corridor turns, as a fraction of the hole, and how far off the
 * tee-to-green line it stands. A traced hole turns at the vertex the trace put
 * there — the marker itself — and an authored one at its largest bend.
 */
function corner(spec: HoleSpec, hole: HoleGeometry): { at: number; shift: number } | null {
  const line = hole.centerline;
  if (spec.centreline && line.length > 2) {
    const tee = line[0];
    const green = line[line.length - 1];
    const dx = green.x - tee.x;
    const dy = green.y - tee.y;
    // Positive is right of the line, the same convention a bend's shift uses.
    const offset = ((line[1].x - tee.x) * dy - (line[1].y - tee.y) * dx) / Math.hypot(dx, dy);
    return { at: polylineLength(line.slice(0, 2)) / polylineLength(line), shift: offset };
  }
  if (!spec.bends?.length) return null;
  const biggest = [...spec.bends].sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))[0];
  return Math.abs(biggest.shift) >= CORNER_SHIFT ? { at: biggest.at, shift: biggest.shift } : null;
}

console.log('The Ranch — geometry against the printed overheads\n');
console.log('  hole  par  card    printed legs   built legs      corner     chord   source');

for (const spec of THE_RANCH.holes) {
  const legs = SPLITS[spec.number];
  const hole = buildHole(THE_RANCH, spec);
  const traced = Boolean(spec.centreline);
  const chord = dist(hole.tee, hole.greenCenter);
  const ratio = chord / spec.yards;
  const turn = corner(spec, hole);

  const row = (printed: string, built: string) =>
    console.log(
      `    ${String(spec.number).padStart(2)}    ${spec.par}   ${String(spec.yards).padStart(3)}` +
        `   ${printed.padEnd(14)} ${built.padEnd(15)} ` +
        `${(turn ? `${turn.at.toFixed(2)} ${turn.shift > 0 ? 'R' : 'L'}${Math.round(Math.abs(turn.shift))}` : '—').padEnd(10)} ` +
        `${(ratio * 100).toFixed(1)}%   ${traced ? 'traced' : 'card'}`,
    );

  if (!legs) {
    row('(no overhead)', '—');
    continue;
  }

  const walked = legs.reduce((sum, leg) => sum + leg, 0);
  if (Math.abs(walked - spec.yards) > LEG_TOLERANCE) {
    fail(`hole ${spec.number} legs against the card`, `${legs.join(' + ')} = ${walked} vs ${spec.yards}`, `within ${LEG_TOLERANCE} yd`);
  }

  // The card sets the scale, so the legs a trace should reproduce are the
  // printed ones stretched onto it.
  const expected = legs.map((leg) => (leg * spec.yards) / walked);

  if (traced && legs.length > 1) {
    // Split the traced line where the overhead's markers sit. On a line traced
    // down the fairway rather than along the overlay's chords there are more
    // points than markers, so the hole says which ones are the corners.
    const line = hole.centerline;
    const corners = spec.centrelineCorners ?? line.slice(1, -1).map((_, index) => index + 1);
    const cuts = [0, ...corners, line.length - 1];
    const built = cuts.slice(0, -1).map((from, index) => polylineLength(line.slice(from, cuts[index + 1] + 1)));
    row(legs.join(' + '), built.map((value) => value.toFixed(0)).join(' + '));
    built.forEach((value, index) => {
      if (Math.abs(value - expected[index]) > TRACED_LEG_TOLERANCE) {
        fail(
          `hole ${spec.number} leg ${index + 1}`,
          `${value.toFixed(0)} yd`,
          `${expected[index].toFixed(0)} yd ± ${TRACED_LEG_TOLERANCE} (printed ${legs[index]}, scaled to the card)`,
        );
      }
    });
    continue;
  }

  if (legs.length === 1) {
    row(`${legs[0]}`, chord.toFixed(0));
    if (Math.abs(chord - spec.yards) > TRACED_LEG_TOLERANCE) {
      fail(`hole ${spec.number} tee to green`, `${chord.toFixed(0)} yd`, `${spec.yards} yd ± ${TRACED_LEG_TOLERANCE}`);
    }
    continue;
  }

  // Derived: the legs place the corner, and the chord keeps the invention honest.
  const fraction = legs[0] / walked;
  row(legs.join(' + '), `marker at ${fraction.toFixed(2)}`);
  if (turn && Math.abs(turn.at - fraction) > CORNER_TOLERANCE) {
    fail(`hole ${spec.number} corner`, `at ${turn.at.toFixed(2)} of the hole`, `the marker at ${fraction.toFixed(2)} ± ${CORNER_TOLERANCE}`);
  }
  if (ratio < MIN_CHORD_RATIO) {
    fail(`hole ${spec.number} bends too hard for its card`, `tee to green is ${(ratio * 100).toFixed(1)}%`, `at least ${MIN_CHORD_RATIO * 100}%`);
  }
}

const traced = THE_RANCH.holes.filter((hole) => hole.centreline).length;
console.log(
  `\n  all ${THE_RANCH.holes.length} holes off the overheads, ${traced} of them traced from the image itself` +
    ` — ${failures} failure${failures === 1 ? '' : 's'}`,
);
if (failures > 0) process.exitCode = 1;
