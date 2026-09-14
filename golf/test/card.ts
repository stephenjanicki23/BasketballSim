/** Print a course card: the quickest way to check a venue is complete. */
import { COURSE_BY_ID } from '../src/data/courses';
const course = COURSE_BY_ID[process.argv[2] ?? 'concord'];
console.log(`${course.name} — par ${course.par}, ${course.yards} yards, ${course.holes.length} holes`);
console.log('   #  name                 par  yards  SI  bearing  green elev');
for (const h of course.holes) {
  console.log(
    `  ${String(h.number).padStart(2)}  ${h.name.padEnd(20)} ${h.par}   ${String(h.yards).padStart(4)}   ${String(h.index).padStart(2)}    ${String(h.bearing).padStart(3)}°   ${String(h.elevation.green).padStart(4)} ft`,
  );
}
const out = course.holes.slice(0, 9);
const inn = course.holes.slice(9);
console.log(`  OUT par ${out.reduce((s, h) => s + h.par, 0)}, ${out.reduce((s, h) => s + h.yards, 0)} yd     IN par ${inn.reduce((s, h) => s + h.par, 0)}, ${inn.reduce((s, h) => s + h.yards, 0)} yd`);
