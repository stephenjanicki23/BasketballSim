/**
 * The news wire.
 *
 * Every story is generated from something that actually happened in the
 * simulation — a winning margin, a 63 in a gale, a world number one missing a
 * cut, a 21-year-old's first win — rather than from a pool of generic lines. If
 * the wire says a veteran dominated in the wind, a veteran dominated in the wind.
 */

import { COURSE_BY_ID } from '../data/courses';
import { describeWeather } from './weatherEngine';
import { ARCHETYPES, formLabel } from './golferEngine';
import { toParLabel, type Tournament } from './tournamentEngine';
import type { Golfer } from './types';

export interface NewsItem {
  id: string;
  season: number;
  week: number;
  kind: 'result' | 'story' | 'ranking' | 'development' | 'season';
  headline: string;
  body: string;
  golferIds: string[];
}

const money = (value: number): string =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}m` : `$${Math.round(value / 1000)}k`;

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** The stories coming out of one tournament. */
export function tournamentNews(
  tournament: Tournament,
  golfers: Map<string, Golfer>,
  previousNumberOne: string | null,
): NewsItem[] {
  const items: NewsItem[] = [];
  const course = COURSE_BY_ID[tournament.courseId];
  const leaderboard = tournament.leaderboard;
  const winnerId = tournament.winnerId;
  const winner = winnerId ? golfers.get(winnerId) : null;
  const base = `${tournament.season}-${tournament.id}`;

  if (winner) {
    const row = leaderboard.find((r) => r.golferId === winnerId)!;
    const margin = tournament.margin;
    const archetype = ARCHETYPES[winner.archetype];
    const finalRound = tournament.results[winner.id]?.[3];
    const worstWeather = tournament.weather.reduce((a, b) => (b.windSpeed > a.windSpeed ? b : a));

    let headline: string;
    if (margin >= 6) headline = `${winner.name} runs away with the ${tournament.name}`;
    else if (margin === 0) headline = `${winner.name} wins the ${tournament.name} in a playoff`;
    else if (margin === 1) headline = `${winner.name} holds on by one at the ${tournament.name}`;
    else headline = `${winner.name} wins the ${tournament.name}`;

    if (winner.age <= 23 && winner.career.wins <= 1) {
      headline = `${winner.age}-year-old ${winner.name} shocks the field at ${course.name}`;
    } else if (winner.age >= 35 && worstWeather.windSpeed >= 18) {
      headline = `${winner.name}, ${winner.age}, masters the wind at ${course.name}`;
    } else if (tournament.tier === 'major' && winner.career.majors === 1) {
      headline = `${winner.name} breaks through for a first major`;
    }

    const parts: string[] = [];
    parts.push(
      `${winner.flag} ${winner.name} won the ${tournament.name} at ${course.name} on ${toParLabel(row.toPar)}, ` +
        `${margin === 0 ? 'after a playoff' : margin === 1 ? 'by a single stroke' : `by ${margin} strokes`}, ` +
        `collecting ${money(row.money)}.`,
    );
    if (finalRound) {
      parts.push(
        `A closing ${finalRound.strokes} (${toParLabel(finalRound.toPar)}) with ${finalRound.stats.birdies} birdies ` +
          `and ${finalRound.stats.bogeys} bogey${finalRound.stats.bogeys === 1 ? '' : 's'} settled it.`,
      );
    }
    parts.push(`Conditions: ${describeWeather(worstWeather)}.`);
    parts.push(`${archetype.name}: ${archetype.blurb}`);
    if (winner.career.wins > 1) {
      parts.push(`It is win number ${winner.career.wins} of his career${winner.career.majors ? ` and major number ${winner.career.majors}` : ''}.`);
    }

    items.push({
      id: `${base}-result`,
      season: tournament.season,
      week: tournament.week,
      kind: 'result',
      headline,
      body: parts.join(' '),
      golferIds: [winner.id],
    });
  }

  // The low round of the week.
  interface LowRound { golfer: Golfer; strokes: number; round: number }
  const lowRounds: LowRound[] = [];
  for (const [golferId, rounds] of Object.entries(tournament.results)) {
    const golfer = golfers.get(golferId);
    if (!golfer) continue;
    rounds.forEach((round, index) => {
      if (round) lowRounds.push({ golfer, strokes: round.strokes, round: index + 1 });
    });
  }
  lowRounds.sort((a, b) => a.strokes - b.strokes);
  const bestRound = lowRounds[0];
  if (bestRound && bestRound.strokes <= course.par - 6) {
    const { golfer, strokes, round } = bestRound;
    items.push({
      id: `${base}-lowround`,
      season: tournament.season,
      week: tournament.week,
      kind: 'story',
      headline: `${strokes} — ${golfer.name} goes low in round ${round}`,
      body:
        `${golfer.flag} ${golfer.name} signed for a ${strokes} (${toParLabel(strokes - course.par)}) in round ${round} at ` +
        `${course.name}, the lowest round of the week. ${describeWeather(tournament.weather[round - 1])}.`,
      golferIds: [golfer.id],
    });
  }

  // A big name missing the cut.
  const casualties = leaderboard
    .filter((r) => r.status === 'cut')
    .map((r) => golfers.get(r.golferId))
    .filter((g): g is Golfer => !!g && g.worldRank <= 8);
  if (casualties.length > 0) {
    const names = casualties.map((g) => `${g.name} (${ordinal(g.worldRank)})`).join(', ');
    items.push({
      id: `${base}-cut`,
      season: tournament.season,
      week: tournament.week,
      kind: 'story',
      headline: casualties.length === 1 ? `${casualties[0].name} misses the cut` : `Big names fall at the cut`,
      body:
        `The cut fell at ${toParLabel(tournament.cutLine ?? 0)}. ${names} will not be here for the weekend. ` +
        `${casualties[0].weakness}`,
      golferIds: casualties.map((g) => g.id),
    });
  }

  // A change at the top of the world ranking.
  const numberOne = [...golfers.values()].find((g) => g.worldRank === 1);
  if (numberOne && previousNumberOne && numberOne.id !== previousNumberOne) {
    const displaced = golfers.get(previousNumberOne);
    items.push({
      id: `${base}-ranking`,
      season: tournament.season,
      week: tournament.week,
      kind: 'ranking',
      headline: `${numberOne.name} is the new world number one`,
      body:
        `${numberOne.flag} ${numberOne.name} moves to the top of the world ranking${displaced ? `, displacing ${displaced.name}` : ''}. ` +
        `Form: ${formLabel(numberOne.hidden.form).toLowerCase()}. ${numberOne.career.wins} career wins, ${numberOne.career.majors} majors.`,
      golferIds: [numberOne.id, previousNumberOne],
    });
  }

  return items;
}

/** A look ahead to the next event, for the home screen. */
export function previewNews(tournament: Tournament, golfers: Map<string, Golfer>): NewsItem {
  const course = COURSE_BY_ID[tournament.courseId];
  const favourites = tournament.field
    .map((id) => golfers.get(id))
    .filter((g): g is Golfer => !!g)
    .sort((a, b) => b.hidden.currentAbility + b.hidden.form * 1.5 - (a.hidden.currentAbility + a.hidden.form * 1.5))
    .slice(0, 3);
  return {
    id: `${tournament.season}-${tournament.id}-preview`,
    season: tournament.season,
    week: tournament.week,
    kind: 'story',
    headline: `Next up: the ${tournament.name}`,
    body:
      `${tournament.blurb} ${course.name}, par ${course.par}, ${course.yards.toLocaleString()} yards. ` +
      `Purse ${money(tournament.purse)}${tournament.tier === 'major' ? ', and a major' : ''}. ` +
      `Watch: ${favourites.map((g) => `${g.flag} ${g.name}`).join(', ')}.`,
    golferIds: favourites.map((g) => g.id),
  };
}

/** End-of-season wrap. */
export function seasonNews(
  season: number,
  championId: string,
  golfers: Map<string, Golfer>,
  moneyLeaderId: string,
): NewsItem[] {
  const champion = golfers.get(championId);
  const moneyLeader = golfers.get(moneyLeaderId);
  const items: NewsItem[] = [];
  if (champion) {
    items.push({
      id: `${season}-poty`,
      season,
      week: 40,
      kind: 'season',
      headline: `${champion.name} is Player of the Year`,
      body:
        `${champion.flag} ${champion.name} finishes the season top of the points list with ${champion.season.wins} win${champion.season.wins === 1 ? '' : 's'} ` +
        `from ${champion.season.events} starts and ${money(champion.season.earnings)} in prize money. ` +
        `${moneyLeader && moneyLeader.id !== champion.id ? `${moneyLeader.name} led the money list with ${money(moneyLeader.season.earnings)}.` : ''}`,
      golferIds: [champion.id],
    });
  }
  return items;
}
