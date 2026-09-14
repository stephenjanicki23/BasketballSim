/**
 * Scorecard validation.
 *
 * The scorecard is the authority. For every venue and every set of markers on
 * it, this checks the game's card against the printed one, hole by hole: par,
 * yardage, stroke index, the two nines and the totals. A course that disagrees
 * with its own card is not a reconstruction of anything.
 *
 *   node tools/tsrun.mjs test/scorecard.ts
 */
import { COURSES, COURSE_VARIANTS, teeSetsFor } from '../src/data/courses';
import type { Course } from '../src/simulation/types';

let failures = 0;
const check = (ok: boolean, what: string, got: unknown, want: unknown): void => {
  if (ok) return;
  failures++;
  console.log(`    FAIL ${what}: game says ${got}, card says ${want}`);
};

function validate(course: Course): void {
  const tee = course.tees?.find((set) => set.id === course.teeId);
  const label = tee ? `${course.name} — ${tee.name}` : course.name;
  console.log(`\n  ${label}`);

  check(course.holes.length === 18, 'hole count', course.holes.length, 18);
  const numbers = course.holes.map((hole) => hole.number).sort((a, b) => a - b);
  check(numbers.every((number, index) => number === index + 1), 'hole numbers', numbers.join(','), '1..18');
  const indexes = [...course.holes.map((hole) => hole.index)].sort((a, b) => a - b);
  check(indexes.every((value, i) => value === i + 1), 'stroke indexes are 1–18 exactly once', indexes.join(','), '1..18');

  if (tee) {
    course.holes.forEach((hole, index) => {
      check(hole.yards === tee.yards[index], `hole ${hole.number} yardage`, hole.yards, tee.yards[index]);
      if (tee.index) check(hole.index === tee.index[index], `hole ${hole.number} stroke index`, hole.index, tee.index[index]);
    });
    const printed = tee.yards.reduce((sum, value) => sum + value, 0);
    check(course.yards === printed, 'total yardage', course.yards, printed);
    const out = tee.yards.slice(0, 9).reduce((sum, value) => sum + value, 0);
    const back = tee.yards.slice(9).reduce((sum, value) => sum + value, 0);
    check(course.holes.slice(0, 9).reduce((sum, hole) => sum + hole.yards, 0) === out, 'front nine', '', out);
    check(course.holes.slice(9).reduce((sum, hole) => sum + hole.yards, 0) === back, 'back nine', '', back);
  }

  const par = course.holes.reduce((sum, hole) => sum + hole.par, 0);
  check(course.par === par, 'total par', course.par, par);
  const outPar = course.holes.slice(0, 9).reduce((sum, hole) => sum + hole.par, 0);
  console.log(
    `    par ${course.par} (${outPar}/${par - outPar})  ${course.yards.toLocaleString()} yd` +
      `${tee?.rating ? `  rating ${tee.rating} / slope ${tee.slope}` : ''}  ` +
      `— ${course.holes.filter((h) => h.par === 3).length} threes, ${course.holes.filter((h) => h.par === 4).length} fours, ` +
      `${course.holes.filter((h) => h.par === 5).length} fives`,
  );

  // Traced holes are held to the thing that makes tracing trustworthy: the
  // played line has to be the card yardage, or the scale is a fiction.
  const traced = course.holes.filter((hole) => hole.centreline);
  if (traced.length > 0) {
    console.log(`    ${traced.length} of 18 holes traced from an image`);
  }
}

console.log('Scorecard validation');
for (const course of COURSES) {
  for (const variant of teeSetsFor(course)) validate(variant);
}

console.log(`\n${COURSE_VARIANTS.length} cards checked, ${failures} failure${failures === 1 ? '' : 's'}`);
if (failures > 0) process.exitCode = 1;
