/**
 * Sanity check on the 54 authored holes: does each one build, is the pin on the
 * green, is there a fairway to hit, and is the mix of terrain plausible.
 */

import { COURSES } from '../src/data/courses';
import { holeGeometry, terrainAt } from '../src/simulation/courseEngine';
import { dist } from '../src/simulation/geometry';
import { onGreen } from '../src/simulation/courseEngine';
import type { LieType } from '../src/simulation/types';

let failures = 0;
const fail = (message: string) => {
  console.error('  FAIL ' + message);
  failures++;
};

for (const course of COURSES) {
  const counts: Partial<Record<LieType, number>> = {};
  let fairwayTotal = 0;
  console.log(`\n${course.name} — par ${course.par}, ${course.yards} yards`);
  if (course.holes.length !== 18) fail(`${course.name} has ${course.holes.length} holes`);
  const indexes = new Set(course.holes.map((h) => h.index));
  if (indexes.size !== 18) fail(`${course.name} has duplicate stroke indexes`);
  const pars = course.holes.reduce<Record<number, number>>((acc, h) => ({ ...acc, [h.par]: (acc[h.par] ?? 0) + 1 }), {});
  console.log(`  par 3s: ${pars[3] ?? 0}  par 4s: ${pars[4] ?? 0}  par 5s: ${pars[5] ?? 0}`);
  if (!pars[3] || !pars[4] || !pars[5]) fail(`${course.name} lacks hole variety`);

  for (const spec of course.holes) {
    const hole = holeGeometry(course, spec.number);
    if (!onGreen(hole, hole.pin)) fail(`${course.name} #${spec.number}: pin is off the green`);
    const teeLie = terrainAt(hole, hole.tee, { onTee: true }).lie;
    if (teeLie !== 'tee') fail(`${course.name} #${spec.number}: tee lie is ${teeLie}`);
    const measured = dist(hole.tee, hole.greenCenter);
    if (measured > spec.yards + 2) fail(`${course.name} #${spec.number}: straight-line ${measured.toFixed(0)} exceeds card ${spec.yards}`);

    // Sample a grid over the hole and tally the terrain.
    let localFairway = 0;
    let samples = 0;
    for (let y = hole.bounds.minY; y < hole.bounds.maxY; y += 4) {
      for (let x = hole.bounds.minX; x < hole.bounds.maxX; x += 4) {
        const info = terrainAt(hole, { x, y });
        counts[info.lie] = (counts[info.lie] ?? 0) + 1;
        if (info.lie === 'fairway') localFairway++;
        samples++;
      }
    }
    fairwayTotal += localFairway / samples;
    if (spec.par !== 3 && localFairway / samples < 0.04) {
      fail(`${course.name} #${spec.number}: only ${((localFairway / samples) * 100).toFixed(1)}% fairway`);
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const share = (lie: LieType) => (((counts[lie] ?? 0) / total) * 100).toFixed(1) + '%';
  console.log(
    `  terrain — fairway ${share('fairway')}, rough ${share('lightRough')}/${share('heavyRough')}/${share('deepRough')}, ` +
      `sand ${share('fairwayBunker')}+${share('greensideBunker')}, water ${share('water')}, green ${share('green')}, ` +
      `${course.style === 'desert' ? 'waste ' + share('waste') : course.style === 'parkland' ? 'trees ' + share('recovery') + '/straw ' + share('pineStraw') : 'ob ' + share('ob')}`,
  );
  console.log(`  average fairway share per hole: ${((fairwayTotal / 18) * 100).toFixed(1)}%`);
}

console.log(failures === 0 ? '\nAll course checks passed.' : `\n${failures} failures.`);
process.exit(failures === 0 ? 0 : 1);
