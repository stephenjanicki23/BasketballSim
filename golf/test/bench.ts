import { COURSE_BY_ID } from '../src/data/courses';
import { holeGeometry, terrainAt } from '../src/simulation/courseEngine';
import { createRng } from '../src/simulation/rng';

const hole = holeGeometry(COURSE_BY_ID.coastal, 12);
const rng = createRng('bench');
const points = Array.from({ length: 200000 }, () => ({
  x: rng.range(hole.bounds.minX, hole.bounds.maxX),
  y: rng.range(hole.bounds.minY, hole.bounds.maxY),
}));
for (let i = 0; i < 20000; i++) terrainAt(hole, points[i]); // warm up
const start = performance.now();
let count = 0;
for (const p of points) if (terrainAt(hole, p).lie === 'fairway') count++;
const ms = performance.now() - start;
console.log(`terrainAt: ${(ms / points.length * 1000).toFixed(2)} µs/call, ${count} fairway`);
console.log(`centerline points: ${hole.centerline.length}, trees: ${hole.trees.length}`);
console.log(`bounds: ${(hole.bounds.maxX - hole.bounds.minX).toFixed(0)} x ${(hole.bounds.maxY - hole.bounds.minY).toFixed(0)} yards`);
