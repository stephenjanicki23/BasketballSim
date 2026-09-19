/**
 * Does a created golfer actually hold up on tour?
 *
 * `careerBalance.ts` proves the rules are consistent. This one answers the question
 * the rules cannot: whether a build is *playable* — which is a question about the
 * shot engine, the weather and 156 other golfers, and can only be settled by
 * playing. Each build is dropped into a real universe and made to play real
 * tournaments against the real field, and what comes back is where they finished
 * and what the season paid them in XP.
 *
 *   node tools/tsrun.mjs test/careerSeasons.ts                  # the default sweep
 *   node tools/tsrun.mjs test/careerSeasons.ts --events 4       # faster, noisier
 *   node tools/tsrun.mjs test/careerSeasons.ts --arc 12         # one long career
 *   node tools/tsrun.mjs test/careerSeasons.ts --only elitePutter
 */

import {
  CAREER_ARCHETYPES, CREATION, PROGRESSION, SKILL_LINE_IDS, XP,
  applyEvent, applySeasonEnd, applySpend, baseLines, closeOffseason, effectiveLines,
  golferForCareer, lineCaps, newCareer, nextStepCost, seasonReportFor, startingSpend,
  startingStepCost, syncGolfer, validateCreation, xpForSeason,
  type Career, type SkillLineId, type SkillLines,
} from '../src/career';
import {
  advanceSeason, createUniverse, currentTournament, joinTour, pointsStandings,
  seasonComplete, simulateTournament, type Universe,
} from '../src/simulation/seasonEngine';
import { currentAbility } from '../src/simulation/golferEngine';
import { createTour } from '../src/data/golfers';
import type { ArchetypeId, Golfer } from '../src/simulation/types';

// --- arguments --------------------------------------------------------------

/**
 * A full calendar by default.
 *
 * A short sample is worse than useless here: at six events two builds of the same
 * archetype came out at 1/5 and 4/5 on cuts made, which is entirely noise and
 * would have been read as a balance difference. Twenty events is one real season
 * and still only one — the checks below are deliberately loose because of it.
 */
const SEASON_EVENTS_DEFAULT = 20;
/** The calendar a real season has, which a shorter sample is projected onto. */
const SEASON_EVENTS = 20;

const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? Number(argv[at + 1]) : fallback;
};
const only = (() => {
  const at = argv.indexOf('--only');
  return at >= 0 ? argv[at + 1] : null;
})();
const EVENTS = flag('events', SEASON_EVENTS_DEFAULT);
const ARC_SEASONS = flag('arc', 0);

let failures = 0;
function check(condition: boolean, message: string): void {
  if (!condition) {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

// --- the benchmark the field sets ------------------------------------------

const tour = createTour();
const tourAbility = [...tour.map(currentAbility)].sort((a, b) => a - b);
const eliteAbility = tourAbility[Math.floor(tourAbility.length * 0.97)];

// --- builds -----------------------------------------------------------------

/**
 * Two shapes per archetype, both exactly on budget.
 *
 * `balanced` spreads the points evenly; `specialised` takes the identity's own
 * three highest ceilings as far as they will start and pays for it everywhere else.
 * Those are the two ends of what a player will actually do.
 */
function buildFor(archetype: ArchetypeId, shape: 'balanced' | 'specialised'): SkillLines {
  const lines = baseLines();
  const caps = lineCaps(archetype);
  const ceiling = (id: SkillLineId) => Math.min(CREATION.maxStartingRating, caps[id]);
  const afford = (id: SkillLineId) =>
    startingSpend(lines) + startingStepCost(lines[id]) <= CREATION.startingSkillPoints;
  const raise = (id: SkillLineId, to: number) => {
    while (lines[id] < Math.min(to, ceiling(id)) && afford(id)) lines[id]++;
  };

  if (shape === 'specialised') {
    const ranked = [...SKILL_LINE_IDS].sort((a, b) => caps[b] - caps[a]);
    for (const id of ranked.slice(0, 3)) raise(id, ceiling(id));
  }
  for (let target = CREATION.baseRating; target <= CREATION.maxStartingRating; target++) {
    for (const id of SKILL_LINE_IDS) raise(id, target);
  }
  return lines;
}

function careerFor(archetype: ArchetypeId, lines: SkillLines, name: string): Career {
  const validated = validateCreation({
    firstName: name.split(' ')[0], lastName: name.split(' ')[1] ?? 'Test',
    displayName: name, country: 'United States',
    archetype, puttingStyle: 'steady', lines,
  });
  if (!validated.ok) throw new Error(`illegal build: ${validated.problems.map((p) => p.message).join('; ')}`);
  return newCareer({ id: `career:${archetype}`, accountId: 'harness', golferId: `you:${archetype}`, created: validated.value });
}

// --- playing a season -------------------------------------------------------

interface SeasonResult {
  events: number;
  cutsMade: number;
  wins: number;
  top10s: number;
  top25s: number;
  bestFinish: number;
  scoringAverage: number;
  standingsRank: number;
  /**
   * What a full twenty-event calendar would have paid.
   *
   * The two halves are projected differently on purpose. Week-by-week XP scales
   * with the number of weeks played, so it is multiplied up; the end-of-season
   * bonus is paid once however many events there were, so multiplying *it* up
   * would count a standings bonus three times over. Instead the season's counters
   * are projected first and the bonus priced on the projection.
   */
  xpEarned: number;
  xpPerEvent: number;
  ability: number;
}

function playSeason(universe: Universe, career: Career, events: number): { result: SeasonResult; career: Career } {
  let working = career;
  const golfer = universe.golfers.find((entry) => entry.id === career.golferId)!;
  syncGolfer(golfer, working);

  let played = 0;
  while (played < events && !seasonComplete(universe) && currentTournament(universe)) {
    simulateTournament(universe, { fast: true });
    played++;
    // Price every queued event through the rulebook, exactly as the store does.
    while (universe.careerEvents.length) {
      const [next] = universe.careerEvents;
      const applied = applyEvent(working, next);
      if (!applied.ok) {
        check(false, `${career.archetype}: event refused — ${applied.problems[0]?.message}`);
        universe.careerEvents.shift();
        continue;
      }
      working = applied.value.career;
      universe.careerEvents.shift();
    }
  }

  const standings = pointsStandings(universe);
  const standingsRank = standings.findIndex((entry) => entry.id === golfer.id) + 1;
  // Everything in the pending ledger at this point came from the weeks played.
  const eventXp = working.pending.total;

  const report = seasonReportFor({
    season: universe.season,
    golfer,
    standingsRank,
    top25s: golfer.season.top25s,
    bestPreviousScoringAverage: 0,
  });
  const ended = applySeasonEnd(working, report);
  if (!ended.ok) {
    check(false, `${career.archetype}: season refused — ${ended.problems[0]?.message}`);
  } else {
    working = ended.value.career;
  }

  const scale = played > 0 ? SEASON_EVENTS / played : 1;
  const projectedBonus = xpForSeason({
    cutsMade: Math.round(golfer.season.cutsMade * scale),
    wins: Math.round(golfer.season.wins * scale),
    top10s: Math.round(golfer.season.top10s * scale),
    standingsRank,
    scoringAverage: golfer.season.rounds ? golfer.season.strokes / golfer.season.rounds : 0,
    bestPreviousScoringAverage: 0,
  }).total;

  return {
    career: working,
    result: {
      events: golfer.season.events,
      cutsMade: golfer.season.cutsMade,
      wins: golfer.season.wins,
      top10s: golfer.season.top10s,
      top25s: golfer.season.top25s,
      bestFinish: golfer.season.bestFinish,
      scoringAverage: golfer.season.rounds ? golfer.season.strokes / golfer.season.rounds : 0,
      standingsRank,
      xpEarned: Math.round(eventXp * scale + Math.min(projectedBonus, XP.maxPerSeasonBonus)),
      xpPerEvent: played ? Math.round(eventXp / played) : 0,
      ability: currentAbility(golfer),
    },
  };
}

function freshUniverse(career: Career, seed: string): { universe: Universe; golfer: Golfer } {
  const universe = createUniverse(seed);
  const golfer = golferForCareer(career, universe.season);
  joinTour(universe, golfer);
  return { universe, golfer };
}

// ===========================================================================
console.log(`A season on tour for every archetype — ${EVENTS} events each, extrapolated to twenty\n`);
// ===========================================================================
console.log(`  the field: ability ${tourAbility[0]}–${tourAbility[tourAbility.length - 1]}, elite (97th pct) ${eliteAbility}\n`);

const header = `  ${'archetype'.padEnd(19)} ${'shape'.padEnd(12)} ${'abil'.padStart(4)} ${'cuts'.padStart(7)} ${'top10'.padStart(6)} ${'wins'.padStart(5)} ${'best'.padStart(5)} ${'scoring'.padStart(8)} ${'rank'.padStart(5)} ${'XP/event'.padStart(9)} ${'XP/season'.padStart(10)}`;
console.log(header);

const seasons: { archetype: ArchetypeId; shape: string; result: SeasonResult }[] = [];
const chosen = only ? CAREER_ARCHETYPES.filter((a) => a.id === only) : CAREER_ARCHETYPES;

for (const archetype of chosen) {
  for (const shape of ['balanced', 'specialised'] as const) {
    const lines = buildFor(archetype.id, shape);
    const career = careerFor(archetype.id, lines, `${archetype.name} ${shape}`);
    const { universe } = freshUniverse(career, `balance:${archetype.id}:${shape}`);
    const { result } = playSeason(universe, career, EVENTS);
    seasons.push({ archetype: archetype.id, shape, result });
    console.log(
      `  ${archetype.name.padEnd(19)} ${shape.padEnd(12)} ${String(result.ability).padStart(4)}` +
      ` ${`${result.cutsMade}/${result.events}`.padStart(7)} ${String(result.top10s).padStart(6)} ${String(result.wins).padStart(5)}` +
      ` ${(result.bestFinish || '—').toString().padStart(5)} ${result.scoringAverage.toFixed(2).padStart(8)}` +
      ` ${String(result.standingsRank).padStart(5)} ${result.xpPerEvent.toLocaleString().padStart(9)}` +
      ` ${result.xpEarned.toLocaleString().padStart(10)}`,
    );
  }
}

// --- what the sweep has to show -------------------------------------------
console.log('');

const cutRate = (entry: { result: SeasonResult }) =>
  entry.result.events ? entry.result.cutsMade / entry.result.events : 0;

/**
 * Viability is a property of the archetype, not of one season of one build.
 *
 * One twenty-event season carries enormous variance — the same even-spread recipe
 * produced 21% of cuts for one archetype and 79% for another, which is the shot
 * engine's day-to-day wobble and not a balance difference. So the identity has to
 * clear a real bar on its *better* shape, and every individual build has only to
 * clear a floor low enough that it catches a genuinely broken one rather than an
 * unlucky one. Run with `--events 20` repeatedly, or read the range at the bottom,
 * before concluding anything from a single row.
 */
const VIABLE_CUT_RATE = 0.3;
const BROKEN_CUT_RATE = 0.1;

for (const entry of seasons) {
  const rate = cutRate(entry);
  check(
    rate >= BROKEN_CUT_RATE,
    `${entry.archetype}/${entry.shape} made only ${Math.round(rate * 100)}% of cuts — that build looks broken, not unlucky`,
  );
  check(
    entry.result.ability < eliteAbility,
    `${entry.archetype}/${entry.shape} starts at elite ability (${entry.result.ability} vs ${eliteAbility})`,
  );
  check(entry.result.xpEarned > 1500, `${entry.archetype}/${entry.shape} earned only ${entry.result.xpEarned} XP in a season — too slow to feel like progress`);
  check(entry.result.xpEarned < 60_000, `${entry.archetype}/${entry.shape} earned ${entry.result.xpEarned} XP in a season — too fast`);
  // Nobody wins in their rookie season. The whole premise is that the tour's best
  // players stay better until the XP has been earned.
  check(entry.result.wins === 0, `${entry.archetype}/${entry.shape} won ${entry.result.wins} times as a rookie`);
}

for (const archetype of chosen) {
  const shapes = seasons.filter((entry) => entry.archetype === archetype.id);
  if (!shapes.length) continue;
  const best = Math.max(...shapes.map(cutRate));
  check(
    best >= VIABLE_CUT_RATE,
    `${archetype.name} made at most ${Math.round(best * 100)}% of cuts with any build — is that identity viable?`,
  );
  const bestXp = Math.max(...shapes.map((entry) => entry.result.xpEarned));
  check(bestXp > 4000, `${archetype.name} earned at most ${bestXp} XP in a season with any build`);
}

console.log('  by archetype, on its better shape:');
for (const archetype of chosen) {
  const shapes = seasons.filter((entry) => entry.archetype === archetype.id);
  if (!shapes.length) continue;
  const best = shapes.reduce((a, b) => (cutRate(b) > cutRate(a) ? b : a));
  console.log(
    `    ${archetype.name.padEnd(19)} ${best.shape.padEnd(12)} ${Math.round(cutRate(best) * 100).toString().padStart(3)}% of cuts` +
    `   best finish ${(best.result.bestFinish || '—').toString().padStart(3)}   ${best.result.xpEarned.toLocaleString().padStart(7)} XP`,
  );
}

const cutRates = seasons.map((entry) => (entry.result.events ? entry.result.cutsMade / entry.result.events : 0));
const xps = seasons.map((entry) => entry.result.xpEarned);
console.log(`  cut rates ${Math.round(Math.min(...cutRates) * 100)}–${Math.round(Math.max(...cutRates) * 100)}%`);
console.log(`  season XP ${Math.min(...xps).toLocaleString()}–${Math.max(...xps).toLocaleString()}`);
console.log(`  a rating point at 70 costs ${PROGRESSION.costBase} XP, at 85 about ${Math.round(PROGRESSION.costBase * Math.pow(PROGRESSION.costGrowth, 15))}`);

// ===========================================================================
if (ARC_SEASONS > 0) {
  console.log(`\nA ${ARC_SEASONS}-season career, spending every winter on the biggest available gain\n`);
  // ===========================================================================
  const archetype = (only as ArchetypeId) ?? 'elitePutter';
  let career = careerFor(archetype, buildFor(archetype, 'specialised'), 'Arc Test');
  const { universe } = freshUniverse(career, `arc:${archetype}`);
  const golfer = universe.golfers.find((entry) => entry.id === career.golferId)!;
  const caps = lineCaps(archetype);

  console.log(`  ${'season'.padStart(6)} ${'age'.padStart(4)} ${'abil'.padStart(5)} ${'cuts'.padStart(7)} ${'top10'.padStart(6)} ${'wins'.padStart(5)} ${'rank'.padStart(5)} ${'XP'.padStart(9)} ${'spent on'.padEnd(34)} ${'used'.padStart(5)}`);

  for (let season = 1; season <= ARC_SEASONS; season++) {
    const played = playSeason(universe, career, EVENTS);
    career = played.career;

    /**
     * Spend like a sensible player: buy the cheapest point available on whichever
     * line is furthest from its ceiling, so the golfer grows into their archetype
     * rather than into a single number. Repeat until the XP runs out.
     */
    const bought: Partial<Record<SkillLineId, number>> = {};
    let guard = 0;
    while (guard++ < 200) {
      const options = SKILL_LINE_IDS
        .map((line) => ({
          line,
          headroom: caps[line] - (career.lines[line] + (bought[line] ?? 0)),
          cost: nextStepCost(archetype, { ...career.lines, ...applyBought(career.lines, bought) }, line),
          alreadyThisWinter: (bought[line] ?? 0) + (career.gainedThisOffseason[line] ?? 0),
        }))
        .filter((option) => option.headroom > 0 && option.cost !== null && option.alreadyThisWinter < PROGRESSION.maxGainPerLinePerOffseason)
        .sort((a, b) => b.headroom - a.headroom || (a.cost ?? 0) - (b.cost ?? 0));
      if (!options.length) break;
      const candidate = { ...bought, [options[0].line]: (bought[options[0].line] ?? 0) + 1 };
      const priced = applySpend({ ...career, gainedThisOffseason: career.gainedThisOffseason }, { buy: candidate });
      if (!priced.ok) break;
      bought[options[0].line] = candidate[options[0].line];
    }

    const spend = applySpend(career, { buy: bought });
    if (spend.ok) career = spend.value.career;
    const closed = closeOffseason(career, 0);
    if (closed.ok) career = closed.value;
    syncGolfer(golfer, career);
    const afterAbility = currentAbility(golfer);
    if (closed.ok) career = { ...career, seasons: career.seasons.map((s, i) => (i === 0 ? { ...s, abilityAfter: afterAbility } : s)) };

    const used = usedShare(career, caps);
    const spentOn = (Object.entries(bought) as [SkillLineId, number][])
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([line, count]) => `${line} +${count}`)
      .join(', ');

    console.log(
      `  ${String(universe.season - 1).padStart(6)} ${String(career.age).padStart(4)} ${String(afterAbility).padStart(5)}` +
      ` ${`${played.result.cutsMade}/${played.result.events}`.padStart(7)} ${String(played.result.top10s).padStart(6)}` +
      ` ${String(played.result.wins).padStart(5)} ${String(played.result.standingsRank).padStart(5)}` +
      ` ${played.result.xpEarned.toLocaleString().padStart(9)} ${(spentOn || '—').padEnd(34)} ${`${Math.round(used * 100)}%`.padStart(5)}`,
    );

    // Advance the universe to the next season, then keep going.
    while (!seasonComplete(universe) && currentTournament(universe)) simulateTournament(universe, { fast: true });
    // A created golfer is never developed by the AI engine; assert it.
    const before = { ...golfer.ratings };
    advanceSeason(universe);
    universe.careerSeasonReport = null;
    universe.careerEvents = [];
    const changed = Object.keys(before).filter((key) => golfer.ratings[key as keyof typeof before] !== before[key as keyof typeof before]);
    check(changed.length === 0, `the offseason engine changed the created golfer's ${changed.join(', ')} without XP`);
    syncGolfer(golfer, career);

    for (const line of SKILL_LINE_IDS) {
      check(career.lines[line] <= caps[line], `${line} exceeded its ceiling in season ${season}`);
      check(effectiveLines(career)[line] <= caps[line], `${line} exceeded its ceiling once age was applied, season ${season}`);
    }
  }

  const finalAbility = currentAbility(golfer);
  console.log(`\n  finished at ability ${finalAbility} against an elite benchmark of ${eliteAbility}`);
  console.log(`  ${Math.round(usedShare(career, caps) * 100)}% of the archetype's room used after ${ARC_SEASONS} seasons`);
  check(finalAbility > 76, `after ${ARC_SEASONS} seasons the golfer is still only ability ${finalAbility} — progression is too slow`);
  check(usedShare(career, caps) < 0.98, 'the whole archetype was maxed out — there was nothing left to aim at');
}

function applyBought(lines: SkillLines, bought: Partial<Record<SkillLineId, number>>): SkillLines {
  const out = { ...lines };
  for (const [line, count] of Object.entries(bought) as [SkillLineId, number][]) out[line] += count;
  return out;
}

function usedShare(career: Career, caps: Record<SkillLineId, number>): number {
  let bought = 0;
  let available = 0;
  for (const line of SKILL_LINE_IDS) {
    bought += career.lines[line] - career.startingLines[line];
    available += caps[line] - career.startingLines[line];
  }
  return available > 0 ? bought / available : 0;
}

console.log(`\n${failures === 0 ? 'All career season checks passed.' : `${failures} FAILURES`}`);
if (failures) process.exitCode = 1;
