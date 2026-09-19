/**
 * What the tour actually looks like, rating by rating.
 *
 * Every balance number in the career system is derived from this and nothing
 * else. The authored 1–100 seed scale is *not* the scale the ratings end up on —
 * `compressLevel` squeezes fifty authored levels into a five-point band and then
 * `SKILL_VARIATION` and the archetype bias spread each player's own skills
 * across thirty points — so guessing what "78 driver distance" means is exactly
 * the mistake to avoid. This prints the distribution instead.
 */

import { createTour, GOLFER_SEEDS } from '../src/data/golfers';
import { ARCHETYPES, RATING_GROUPS, RATING_LABELS, currentAbility, groupScores } from '../src/simulation/golferEngine';
import type { ArchetypeId, Golfer, RatingKey } from '../src/simulation/types';

const tour = createTour();
const keys = Object.keys(RATING_LABELS) as RatingKey[];

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

function describe(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p10: quantile(sorted, 0.10),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.50),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.90),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

const n = (v: number, w = 5) => v.toFixed(1).padStart(w);

console.log(`The tour: ${tour.length} golfers (${GOLFER_SEEDS.length} authored, ${tour.length - GOLFER_SEEDS.length} generated)\n`);

// --- ability ---------------------------------------------------------------
const ability = describe(tour.map(currentAbility));
console.log('Current ability (the engine\'s own 1–100 summary)');
console.log(`  min ${n(ability.min)}  p10 ${n(ability.p10)}  median ${n(ability.median)}  p90 ${n(ability.p90)}  p99 ${n(ability.p99)}  max ${n(ability.max)}  mean ${n(ability.mean)}`);

const byAbility = [...tour].sort((a, b) => currentAbility(b) - currentAbility(a));
console.log('\n  top ten by ability:');
for (const g of byAbility.slice(0, 10)) {
  console.log(`    ${String(currentAbility(g)).padStart(3)}  ${g.name.padEnd(22)} ${ARCHETYPES[g.archetype].name}`);
}
console.log('  bottom five:');
for (const g of byAbility.slice(-5)) {
  console.log(`    ${String(currentAbility(g)).padStart(3)}  ${g.name.padEnd(22)} ${ARCHETYPES[g.archetype].name}`);
}

// --- every rating ----------------------------------------------------------
console.log('\nEvery rating across the field');
console.log(`  ${'rating'.padEnd(26)} ${'min'.padStart(5)} ${'p10'.padStart(5)} ${'p25'.padStart(5)} ${'med'.padStart(5)} ${'p75'.padStart(5)} ${'p90'.padStart(5)} ${'p99'.padStart(5)} ${'max'.padStart(5)}`);
for (const key of keys) {
  const d = describe(tour.map((g) => g.ratings[key]));
  console.log(`  ${RATING_LABELS[key].padEnd(26)} ${n(d.min)} ${n(d.p10)} ${n(d.p25)} ${n(d.median)} ${n(d.p75)} ${n(d.p90)} ${n(d.p99)} ${n(d.max)}`);
}

// --- groups ----------------------------------------------------------------
console.log('\nRating groups across the field');
for (const group of RATING_GROUPS) {
  const d = describe(tour.map((g) => groupScores(g)[group.id]));
  console.log(`  ${group.name.padEnd(12)} min ${n(d.min)}  p10 ${n(d.p10)}  med ${n(d.median)}  p90 ${n(d.p90)}  max ${n(d.max)}`);
}

// --- the single best at each rating, which is the benchmark that matters ----
console.log('\nBest in the field at each rating — the number a created golfer must not casually beat');
for (const key of keys) {
  const best = tour.reduce((a, b) => (b.ratings[key] > a.ratings[key] ? b : a));
  const second = [...tour].sort((a, b) => b.ratings[key] - a.ratings[key])[4];
  console.log(`  ${RATING_LABELS[key].padEnd(26)} ${String(best.ratings[key]).padStart(3)}  ${best.name.padEnd(22)} (5th best: ${second.ratings[key]})`);
}

// --- by archetype ----------------------------------------------------------
console.log('\nBy archetype: how many, their ability, and their own strongest/weakest groups');
const ids = Object.keys(ARCHETYPES) as ArchetypeId[];
for (const id of ids) {
  const members = tour.filter((g) => g.archetype === id);
  if (!members.length) { console.log(`  ${ARCHETYPES[id].name.padEnd(20)} none`); continue; }
  const a = describe(members.map(currentAbility));
  const groups = RATING_GROUPS.map((group) => ({
    name: group.name,
    value: members.reduce((acc, g) => acc + groupScores(g)[group.id], 0) / members.length,
  })).sort((x, y) => y.value - x.value);
  console.log(`  ${ARCHETYPES[id].name.padEnd(20)} n=${String(members.length).padStart(3)}  ability ${n(a.median)} (${n(a.min)}–${n(a.max)})  best ${groups[0].name} ${n(groups[0].value)}  worst ${groups[groups.length - 1].name} ${n(groups[groups.length - 1].value)}`);
}

// --- what an "average tour pro" and an "elite pro" look like, per rating ----
console.log('\nReference profiles (median and 90th percentile of the field, rating by rating)');
const median: Partial<Record<RatingKey, number>> = {};
const elite: Partial<Record<RatingKey, number>> = {};
for (const key of keys) {
  const d = describe(tour.map((g) => g.ratings[key]));
  median[key] = Math.round(d.median);
  elite[key] = Math.round(d.p90);
}
console.log('  median:', JSON.stringify(median));
console.log('  p90:   ', JSON.stringify(elite));
