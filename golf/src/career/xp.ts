/**
 * Earning XP.
 *
 * Two rules shaped all of this. Requirement 11 says a round must not be a payday,
 * so turning up is worth a hundred and winning is worth eighteen hundred; and it
 * also says a slower player has to be able to progress, so there is a floor under
 * every week — birdies pay, a low round pays, and beating your own ranking pays
 * best of all to somebody ranked 140th.
 *
 * The module is pure and takes primitives. It never sees a `Universe`, a
 * `Tournament` or a `Golfer`, which is what lets `test/careerBalance.ts` price a
 * hypothetical season without simulating one.
 */

import { XP } from './config';
import type { XpEntry, XpLedger } from './types';

export type EventTier = 'regular' | 'invitational' | 'major';

/** One round, reduced to the things XP is paid for. */
export interface RoundOutcome {
  toPar: number;
  birdies: number;
  eagles: number;
  /** Three or better under par on a hole. Rare enough to be worth naming. */
  albatrosses: number;
}

export interface EventOutcome {
  tournamentId: string;
  tournamentName: string;
  tier: EventTier;
  /** Finishing position, or 0 for a missed cut. */
  position: number;
  madeCut: boolean;
  /** Where the golfer was ranked in the world going in. */
  worldRankBefore: number;
  /** Their best career finish before this week; 0 if they had never finished one. */
  previousBestFinish: number;
  rounds: RoundOutcome[];
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

function add(ledger: XpLedger, reason: string, label: string, xp: number, count = 1): void {
  if (xp <= 0) return;
  const rounded = Math.round(xp);
  if (rounded <= 0) return;
  const existing = ledger.entries.find((entry) => entry.reason === reason);
  if (existing) {
    existing.xp += rounded;
    existing.count += count;
  } else {
    ledger.entries.push({ reason, label, xp: rounded, count });
  }
  ledger.total += rounded;
}

/** Fold one ledger into another, so a season is the sum of its weeks. */
export function mergeLedger(into: XpLedger, from: XpLedger): XpLedger {
  for (const entry of from.entries) add(into, entry.reason, entry.label, entry.xp, entry.count);
  return into;
}

// ---------------------------------------------------------------------------
// A week
// ---------------------------------------------------------------------------

function finishXp(position: number): number {
  if (position <= 0) return 0;
  for (const band of XP.finish) if (position <= band.positionUpTo) return band.xp;
  return 0;
}

function finishLabel(position: number): string {
  if (position === 1) return 'Tournament win';
  if (position <= 3) return 'Top-three finish';
  if (position <= 5) return 'Top-five finish';
  if (position <= 10) return 'Top-ten finish';
  if (position <= 25) return 'Top-25 finish';
  return 'Finished the tournament';
}

/**
 * What one week was worth.
 *
 * Everything except the start fee is multiplied by the tier, so a major is worth
 * about 60% more than an ordinary week — the same shape the tour's own points and
 * ranking use, so a player's XP and their world ranking move together.
 */
export function xpForEvent(outcome: EventOutcome): XpLedger {
  const ledger: XpLedger = { total: 0, entries: [] };
  const tier = XP.tierMultiplier[outcome.tier] ?? 1;

  add(ledger, 'start', 'Tournament starts', XP.perStart);
  if (outcome.madeCut) add(ledger, 'cut', 'Cuts made', XP.madeCut * tier);
  if (outcome.position > 0) {
    add(ledger, `finish:${finishLabel(outcome.position)}`, finishLabel(outcome.position), finishXp(outcome.position) * tier);
  }

  let birdies = 0;
  let eagles = 0;
  let albatrosses = 0;
  let lowRounds = 0;
  let veryLowRounds = 0;
  for (const round of outcome.rounds) {
    birdies += round.birdies;
    eagles += round.eagles;
    albatrosses += round.albatrosses;
    if (round.toPar <= XP.veryLowRoundToPar) veryLowRounds++;
    else if (round.toPar <= XP.lowRoundToPar) lowRounds++;
  }
  if (birdies) add(ledger, 'birdies', 'Birdies', XP.perBirdie * birdies, birdies);
  if (eagles) add(ledger, 'eagles', 'Eagles', XP.perEagle * eagles, eagles);
  if (albatrosses) add(ledger, 'albatrosses', 'Albatrosses', XP.perAlbatross * albatrosses, albatrosses);
  if (lowRounds) add(ledger, 'lowRounds', `Rounds of ${XP.lowRoundToPar} or better`, XP.lowRoundXp * lowRounds * tier, lowRounds);
  if (veryLowRounds) add(ledger, 'veryLowRounds', `Rounds of ${XP.veryLowRoundToPar} or better`, XP.veryLowRoundXp * veryLowRounds * tier, veryLowRounds);

  // Beating expectations. A player ranked 130th who finishes 40th has done
  // something; the same finish from the world number two has not.
  if (outcome.position > 0 && outcome.worldRankBefore > outcome.position) {
    const places = outcome.worldRankBefore - outcome.position;
    add(
      ledger,
      'beatRank',
      'Finishing above your ranking',
      Math.min(XP.beatingRankCap, places * XP.perPlaceBeatingRank) * tier,
    );
  }

  if (outcome.position > 0 && (outcome.previousBestFinish === 0 || outcome.position < outcome.previousBestFinish)) {
    add(ledger, 'personalBest', 'A new career-best finish', XP.personalBest * tier);
  }

  return ledger;
}

// ---------------------------------------------------------------------------
// A season
// ---------------------------------------------------------------------------

export interface SeasonOutcome {
  cutsMade: number;
  wins: number;
  top10s: number;
  /** Final rank in the season points standings. */
  standingsRank: number;
  scoringAverage: number;
  /** The golfer's best previous season scoring average, or 0 if this is season one. */
  bestPreviousScoringAverage: number;
}

/** Paid once, on the season as a whole, on top of the weeks. */
export function xpForSeason(outcome: SeasonOutcome): XpLedger {
  const ledger: XpLedger = { total: 0, entries: [] };
  const season = XP.season;

  if (outcome.cutsMade) add(ledger, 'seasonCuts', 'Season cuts made', season.perCutMade * outcome.cutsMade, outcome.cutsMade);
  if (outcome.top10s) add(ledger, 'seasonTop10s', 'Season top-tens', season.perTop10 * outcome.top10s, outcome.top10s);
  if (outcome.wins) add(ledger, 'seasonWins', 'Season wins', season.perWin * outcome.wins, outcome.wins);

  for (const band of season.standingsBonuses) {
    if (outcome.standingsRank > 0 && outcome.standingsRank <= band.rankUpTo) {
      const label =
        band.rankUpTo === 1 ? 'Player of the Year'
        : band.rankUpTo === Infinity ? 'Finished the season' : `Top ${band.rankUpTo} in the standings`;
      add(ledger, `standings:${band.rankUpTo}`, label, band.xp);
      break;
    }
  }

  if (
    outcome.scoringAverage > 0 &&
    outcome.bestPreviousScoringAverage > 0 &&
    outcome.scoringAverage < outcome.bestPreviousScoringAverage
  ) {
    add(ledger, 'scoringAverage', 'A career-best scoring average', season.scoringAverageImproved);
  }

  return ledger;
}

/** Biggest first, which is the order the offseason screen wants. */
export function sortedEntries(ledger: XpLedger): XpEntry[] {
  return [...ledger.entries].sort((a, b) => b.xp - a.xp);
}
