/**
 * Does the career system balance?
 *
 * Requirement 27 asks for an internal utility that generates example golfers for
 * every archetype and proves the rules hold. This is it, and it does rather more
 * than check the arithmetic: the last section drops each generated build into the
 * real 156-player tour and simulates a season, because "is this build playable"
 * is a question about the shot engine, not about a spreadsheet.
 *
 *   node tools/tsrun.mjs test/careerBalance.ts [--quick]
 */

import {
  CAREER_ARCHETYPES, CREATION, PROGRESSION, SKILL_LINES, SKILL_LINE_IDS, XP,
  baseLines, buildCreatedGolfer, costToCap, effectiveLines, lineCaps, nextStepCost,
  ratingsFromLines, startingLineCost, startingSpend, startingStepCost, stepCost,
  validateCreation, validateSpend, type SkillLineId, type SkillLines,
} from '../src/career';
import type { Career } from '../src/career';
import { createTour } from '../src/data/golfers';
import { currentAbility, RATING_LABELS } from '../src/simulation/golferEngine';
import type { ArchetypeId, Golfer, RatingKey } from '../src/simulation/types';

let failures = 0;
function check(condition: boolean, message: string): void {
  if (!condition) {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

const tour = createTour();
const tourAbility = tour.map(currentAbility).sort((a, b) => a - b);
const abilityPercentile = (value: number): number =>
  (tourAbility.filter((a) => a < value).length / tourAbility.length) * 100;

const n = (v: number, w = 4) => String(Math.round(v)).padStart(w);

// ===========================================================================
console.log('=== 1. The ceilings each archetype gives you\n');
// ===========================================================================

const short = (id: SkillLineId) => id.slice(0, 6);
console.log(`  ${'archetype'.padEnd(19)}${SKILL_LINE_IDS.map((id) => short(id).padStart(7)).join('')}`);
for (const archetype of CAREER_ARCHETYPES) {
  const caps = archetype.caps;
  console.log(`  ${archetype.name.padEnd(19)}${SKILL_LINE_IDS.map((id) => String(caps[id]).padStart(7)).join('')}`);
}

console.log('\n  what each identity is and is not');
for (const archetype of CAREER_ARCHETYPES) {
  const caps = archetype.caps;
  const best = SKILL_LINE_IDS.map((id) => ({ id, cap: caps[id] })).sort((a, b) => b.cap - a.cap);
  const top = best.slice(0, 3).map((row) => `${short(row.id)} ${row.cap}`).join(', ');
  const bottom = best.slice(-3).reverse().map((row) => `${short(row.id)} ${row.cap}`).join(', ');
  console.log(`    ${archetype.name.padEnd(19)} ceiling: ${top}   floor: ${bottom}`);
  check(archetype.strengths.length > 0 || archetype.id === 'allRounder', `${archetype.name} has no named strength`);
  check(
    Math.max(...SKILL_LINE_IDS.map((id) => caps[id])) <= 97,
    `${archetype.name} has a ceiling above the global maximum`,
  );
  check(
    Math.min(...SKILL_LINE_IDS.map((id) => caps[id])) >= 62,
    `${archetype.name} has a ceiling below the global minimum`,
  );
}

// No archetype may be the best at everything, and none may be worst at everything.
for (const archetype of CAREER_ARCHETYPES) {
  const others = CAREER_ARCHETYPES.filter((a) => a.id !== archetype.id);
  const bestAtAll = SKILL_LINE_IDS.every((id) => others.every((other) => archetype.caps[id] >= other.caps[id]));
  check(!bestAtAll, `${archetype.name} has the best ceiling in every single line`);
  const meaningfulWeakness = SKILL_LINE_IDS.some((id) => archetype.caps[id] <= CREATION.maxStartingRating - 4);
  check(
    meaningfulWeakness || archetype.id === 'allRounder',
    `${archetype.name} has no line it is meaningfully capped in`,
  );
}

// ===========================================================================
console.log('\n=== 2. The cost curves\n');
// ===========================================================================

console.log('  creation: what a point of rating costs from here');
for (let at = CREATION.minRating; at <= CREATION.maxStartingRating; at += 3) {
  console.log(`    ${at} → ${at + 1}   ${startingStepCost(at)} point${startingStepCost(at) === 1 ? '' : 's'}`);
}
console.log(`  one line from ${CREATION.baseRating} to the starting maximum of ${CREATION.maxStartingRating}: ${startingLineCost(CREATION.maxStartingRating)} points of ${CREATION.startingSkillPoints}`);
console.log(`  every line to ${CREATION.maxStartingRating}: ${startingLineCost(CREATION.maxStartingRating) * SKILL_LINE_IDS.length} points — ${((startingLineCost(CREATION.maxStartingRating) * SKILL_LINE_IDS.length) / CREATION.startingSkillPoints).toFixed(1)}× the budget`);

console.log('\n  XP: the price of a rating point, with no soft cap and then against a near ceiling');
for (let at = 62; at <= 96; at += 4) {
  const listed = stepCost(at, at + 40);
  const nearCap = stepCost(at, at + 1);
  console.log(`    ${at} → ${at + 1}   ${n(listed, 6)} XP    ${n(nearCap, 6)} XP within one of the ceiling`);
}
check(stepCost(90, 130) > stepCost(70, 130) * 4, 'a point at 90 is not meaningfully harder than a point at 70');
check(stepCost(70, 130) > stepCost(62, 130) * 1.6, 'the early curve is too flat to feel like progress');

// ===========================================================================
console.log('\n=== 3. Four legal builds for every archetype\n');
// ===========================================================================

type BuildKind = 'low-end' | 'balanced' | 'specialised' | 'max-legal';

/**
 * Build to a shape, greedily, and never spend a point that is not available.
 * Every build here goes through `validateCreation` afterwards, so a bug in the
 * generator shows up as a failed example rather than as a quiet illegal golfer.
 */
function buildTo(archetype: ArchetypeId, kind: BuildKind): SkillLines {
  const lines = baseLines();
  const caps = lineCaps(archetype);
  const ceiling = (id: SkillLineId) => Math.min(CREATION.maxStartingRating, caps[id]);
  const budget = kind === 'low-end' ? Math.round(CREATION.startingSkillPoints * 0.55) : CREATION.startingSkillPoints;

  // The order points go in, which is what makes the four builds different.
  const ranked = [...SKILL_LINE_IDS];
  if (kind === 'specialised' || kind === 'max-legal') {
    ranked.sort((a, b) => caps[b] - caps[a]);
  }

  const spend = (id: SkillLineId, upTo: number): void => {
    while (lines[id] < upTo && startingSpend(lines) + startingStepCost(lines[id]) <= budget) lines[id]++;
  };

  if (kind === 'specialised' || kind === 'max-legal') {
    // Take the two lines this identity is really for as high as they go, then
    // spread whatever is left as evenly as it will go.
    for (const id of ranked.slice(0, 2)) spend(id, ceiling(id));
    if (kind === 'specialised') {
      // Pay for it by dropping the three lowest ceilings to the floor.
      for (const id of [...ranked].reverse().slice(0, 3)) lines[id] = CREATION.minRating;
      for (const id of ranked.slice(2)) spend(id, ceiling(id));
    }
    for (let target = CREATION.baseRating; target <= CREATION.maxStartingRating; target++) {
      for (const id of ranked) spend(id, Math.min(target, ceiling(id)));
    }
  } else {
    // Even as it will go, in rating terms rather than in points.
    for (let target = CREATION.baseRating; target <= CREATION.maxStartingRating; target++) {
      for (const id of ranked) spend(id, Math.min(target, ceiling(id)));
    }
  }
  return lines;
}

interface Example {
  archetype: ArchetypeId;
  kind: BuildKind;
  golfer: Golfer;
  lines: SkillLines;
  spent: number;
}

const examples: Example[] = [];
const kinds: BuildKind[] = ['low-end', 'balanced', 'specialised', 'max-legal'];

for (const archetype of CAREER_ARCHETYPES) {
  console.log(`  ${archetype.name} — ${archetype.tagline}`);
  for (const kind of kinds) {
    const lines = buildTo(archetype.id, kind);
    const result = validateCreation({
      firstName: 'Test', lastName: 'Build', country: 'United States',
      archetype: archetype.id, puttingStyle: 'steady', lines,
    });
    if (!result.ok) {
      failures++;
      console.log(`    FAIL  ${kind}: ${result.problems.map((p) => p.message).join('; ')}`);
      continue;
    }
    const golfer = buildCreatedGolfer(`example:${archetype.id}:${kind}`, result.value, 2026);
    const ability = currentAbility(golfer);
    examples.push({ archetype: archetype.id, kind, golfer, lines, spent: result.value.spent });

    const ranked = SKILL_LINE_IDS.map((id) => ({ id, value: lines[id] })).sort((a, b) => b.value - a.value);
    const shape = ranked.slice(0, 3).map((r) => `${short(r.id)} ${r.value}`).join(' ');
    console.log(
      `    ${kind.padEnd(12)} ${result.value.spent}/${CREATION.startingSkillPoints} pts   ability ${n(ability, 3)}` +
      `  (tour percentile ${n(abilityPercentile(ability), 3)})   top: ${shape}`,
    );

    // Every rule that must hold for every build.
    check(result.value.spent <= CREATION.startingSkillPoints, `${archetype.name}/${kind} is over budget`);
    for (const id of SKILL_LINE_IDS) {
      check(lines[id] >= CREATION.minRating, `${archetype.name}/${kind} put ${id} below the floor`);
      check(lines[id] <= CREATION.maxStartingRating, `${archetype.name}/${kind} started ${id} above the starting maximum`);
      check(lines[id] <= archetype.caps[id], `${archetype.name}/${kind} started ${id} above its career ceiling`);
    }
    for (const [key, value] of Object.entries(golfer.ratings) as [RatingKey, number][]) {
      check(value <= 97, `${archetype.name}/${kind} derived ${RATING_LABELS[key]} above 97`);
    }
    check(ability < Math.max(...tourAbility), `${archetype.name}/${kind} starts better than the best player on tour`);
  }
}

const abilities = examples.map((e) => currentAbility(e.golfer));
console.log(`\n  every generated build: ability ${Math.min(...abilities)}–${Math.max(...abilities)}`);
console.log(`  the tour: ${tourAbility[0]}–${tourAbility[tourAbility.length - 1]}, median ${tourAbility[Math.floor(tourAbility.length / 2)]}`);
check(Math.max(...abilities) <= tourAbility[tourAbility.length - 1] - 2, 'a starting golfer is within two of the best on tour');
check(Math.min(...abilities) >= tourAbility[0] - 6, 'the weakest legal build is far below the worst tour player');

// ===========================================================================
console.log('\n=== 4. What a whole career costs\n');
// ===========================================================================

function careerFor(archetype: ArchetypeId, lines: SkillLines, age = CREATION.startingAge): Career {
  const now = new Date().toISOString();
  return {
    id: 'c', accountId: 'a', golferId: 'g',
    firstName: 'Test', lastName: 'Build', displayName: 'Test Build',
    country: 'United States', flag: '🇺🇸',
    archetype, puttingStyle: 'steady',
    startingLines: { ...lines }, lines: { ...lines },
    experience: 0, availableXp: 0, spentXp: 0,
    careerSeason: 1, age,
    pending: { total: 0, entries: [] }, history: [], seasons: [],
    offseasonOpen: false, gainedThisOffseason: {}, countedEvents: [], lastSeason: 0,
    createdAt: now, updatedAt: now,
  };
}

for (const archetype of CAREER_ARCHETYPES) {
  const lines = buildTo(archetype.id, 'balanced');
  const career = careerFor(archetype.id, lines);
  const signature = archetype.signature;
  const toSignatureCap = costToCap(archetype.id, lines, signature);
  const everything = SKILL_LINE_IDS.reduce((acc, id) => acc + costToCap(archetype.id, lines, id), 0);
  console.log(
    `  ${archetype.name.padEnd(19)} ${short(signature)} ${lines[signature]}→${archetype.caps[signature]}: ` +
    `${toSignatureCap.toLocaleString().padStart(8)} XP    everything to its ceiling: ${everything.toLocaleString().padStart(9)} XP`,
  );
  // The Complete Player is exempt from the first of these by design: its whole
  // identity is that it has no specialism to save up for.
  if (archetype.id !== 'allRounder') {
    check(toSignatureCap > 12_000, `${archetype.name}'s signature specialism is too cheap to be an achievement`);
  }
  check(everything > 120_000, `${archetype.name} could reach every one of its ceilings cheaply`);
  // And the caps really are inescapable.
  const overCap = validateSpend(
    { ...career, availableXp: 10_000_000, lines: { ...lines, [signature]: archetype.caps[signature] } },
    { buy: { [signature]: 1 } },
  );
  check(!overCap.ok, `${archetype.name} could buy past its ${signature} ceiling`);
}

// ===========================================================================
console.log('\n=== 5. Exploits that must not work\n');
// ===========================================================================

const attempts: { what: string; request: unknown }[] = [
  { what: 'an archetype that is not offered', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'veteran', puttingStyle: 'steady', lines: {} } },
  { what: 'a made-up archetype', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: '__proto__', puttingStyle: 'steady', lines: {} } },
  { what: 'a line below the floor to fund the rest', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: { putting: 1, power: 82 } } },
  { what: 'a line above the starting maximum', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: { power: 95 } } },
  { what: 'a line above the archetype ceiling', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'precision', puttingStyle: 'steady', lines: { power: 82 } } },
  { what: 'a fractional rating', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: { power: 70.5 } } },
  { what: 'a skill that does not exist', request: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: { telepathy: 90 } } },
  { what: 'no name', request: { firstName: '', lastName: '', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: {} } },
  { what: 'a name made of control characters', request: { firstName: '\u0000\u0001', lastName: '\u0002\u0003', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: {} } },
  { what: 'a nationality that is not on the list', request: { firstName: 'A', lastName: 'B', country: 'Atlantis', archetype: 'power', puttingStyle: 'steady', lines: {} } },
  { what: 'nothing at all', request: undefined },
  { what: 'a string where the body should be', request: 'give me a golfer' },
];

for (const attempt of attempts) {
  const result = validateCreation(attempt.request);
  console.log(`  ${result.ok ? 'ACCEPTED' : 'refused '}  ${attempt.what}`);
  check(!result.ok, `creation accepted ${attempt.what}`);
}

// A build that is exactly on budget must be accepted — the rules have to be
// permissive as well as strict, or the budget is a lie.
{
  const lines = buildTo('allRounder', 'balanced');
  const onBudget = validateCreation({
    firstName: 'On', lastName: 'Budget', country: 'England',
    archetype: 'allRounder', puttingStyle: 'steady', lines,
  });
  check(onBudget.ok, 'a legal on-budget build was refused');
}

const spendAttempts: { what: string; buy: unknown }[] = [
  { what: 'more XP than is banked', buy: { putting: 6 } },
  { what: 'a negative number of points', buy: { putting: -4 } },
  { what: 'a fractional number of points', buy: { putting: 1.5 } },
  { what: 'more than one offseason allows', buy: { putting: PROGRESSION.maxGainPerLinePerOffseason + 1 } },
  { what: 'a skill that does not exist', buy: { levitation: 1 } },
];
{
  const lines = buildTo('elitePutter', 'balanced');
  const career = careerFor('elitePutter', lines);
  career.availableXp = 100;
  for (const attempt of spendAttempts) {
    const result = validateSpend(career, { buy: attempt.buy });
    console.log(`  ${result.ok ? 'ACCEPTED' : 'refused '}  spending: ${attempt.what}`);
    check(!result.ok, `spending accepted ${attempt.what}`);
  }
  // XP can never go negative, and a legal spend must be accepted.
  career.availableXp = 50_000;
  const legal = validateSpend(career, { buy: { putting: 2, greenReading: 1 } });
  check(legal.ok, 'a legal, affordable spend was refused');
  if (legal.ok) {
    check(legal.value.xpSpent <= career.availableXp, 'a legal spend cost more than was available');
    check(legal.value.steps.length === 3, 'a legal spend bought the wrong number of points');
  }
}

// Age can never launder a rating past a ceiling.
for (const archetype of CAREER_ARCHETYPES) {
  const lines = baseLines();
  for (const id of SKILL_LINE_IDS) lines[id] = Math.min(archetype.caps[id], CREATION.maxStartingRating);
  const career = careerFor(archetype.id, lines, 23);
  for (let age = 23; age <= 50; age++) {
    const effective = effectiveLines({ ...career, age });
    for (const id of SKILL_LINE_IDS) {
      check(effective[id] <= archetype.caps[id], `${archetype.name} exceeded its ${id} ceiling at ${age} through age drift`);
    }
    const ratings = ratingsFromLines(archetype.id, effective);
    for (const [key, value] of Object.entries(ratings) as [RatingKey, number][]) {
      check(value <= 97, `${archetype.name} derived ${RATING_LABELS[key]} above 97 at ${age}`);
    }
  }
}

console.log(`\n${failures === 0 ? 'All career balance checks passed.' : `${failures} FAILURES`}`);
if (failures) process.exitCode = 1;
