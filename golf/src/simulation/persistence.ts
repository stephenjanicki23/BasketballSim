/**
 * Saving the universe.
 *
 * A season of full results — a full field, four rounds, eighteen hole scores
 * and a stat line each — is about a megabyte of JSON, and localStorage gives you
 * five. So completed events are pruned down to what the game actually reads back:
 * the finished leaderboard, the cut line, the recaps and the winner. Live events
 * keep everything, because the leaderboard is still being rebuilt from it.
 */

import { UNIVERSE_VERSION, type Universe } from './seasonEngine';
import type { Tournament } from './tournamentEngine';

const KEY = 'golf-universe:save';

function pruneTournament(tournament: Tournament, keepGolferId: string | null): Tournament {
  if (tournament.status !== 'complete') return tournament;
  const results: Tournament['results'] = {};
  if (keepGolferId && tournament.results[keepGolferId]) {
    results[keepGolferId] = tournament.results[keepGolferId];
  }
  return { ...tournament, results, teeTimes: [] };
}

export function serializeUniverse(universe: Universe): string {
  const compact: Universe = {
    ...universe,
    schedule: universe.schedule.map((t) => pruneTournament(t, universe.userGolferId)),
    news: universe.news.slice(0, 60),
  };
  return JSON.stringify(compact);
}

export function saveUniverse(universe: Universe): { ok: boolean; bytes: number; error?: string } {
  try {
    const payload = serializeUniverse(universe);
    window.localStorage.setItem(KEY, payload);
    return { ok: true, bytes: payload.length };
  } catch (error) {
    return { ok: false, bytes: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export function loadUniverse(): Universe | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return parseUniverse(raw);
  } catch {
    return null;
  }
}

/**
 * Read a universe out of a serialised one, wherever it came from.
 *
 * Split out from `loadUniverse` because a career's universe arrives from the
 * account store — possibly over the network — rather than from `localStorage`, and
 * both paths need exactly the same suspicion of what they are handed.
 */
export function parseUniverse(raw: string): Universe | null {
  try {
    const parsed = JSON.parse(raw) as Universe;
    if (!parsed || parsed.version !== UNIVERSE_VERSION) return null;
    // A save from an older shape would break the engines in confusing ways; a
    // fresh universe is a much better failure than a subtly corrupt one.
    if (!Array.isArray(parsed.golfers) || parsed.golfers.length === 0) return null;
    if (!Array.isArray(parsed.schedule) || parsed.schedule.length === 0) return null;
    for (const tournament of parsed.schedule) {
      if (!tournament.results) tournament.results = {};
      if (!tournament.teeTimes) tournament.teeTimes = [];
      if (!tournament.recaps) tournament.recaps = [];
    }
    // Fields the career system added. Defaulted rather than version-gated on
    // purpose: a save from before careers existed is a perfectly good universe and
    // throwing somebody's season away to add three empty fields would be rude.
    if (parsed.createdGolferId === undefined) parsed.createdGolferId = null;
    if (!Array.isArray(parsed.careerEvents)) parsed.careerEvents = [];
    if (parsed.careerSeasonReport === undefined) parsed.careerSeasonReport = null;
    if (parsed.session === undefined) parsed.session = null;
    // A saved round is only meaningful on a course that still exists. One saved
    // against a venue that has since left the schedule is dropped rather than
    // restored into a course lookup that will return undefined.
    if (parsed.session && !parsed.session.courseId) parsed.session = null;
    // Season counters added at the same time. An older save has no value for
    // these, and `undefined++` is NaN, which would quietly poison a scoring
    // average rather than fail — so fill them in rather than trusting the shape.
    for (const golfer of parsed.golfers) {
      if (typeof golfer.season?.top25s !== 'number') golfer.season.top25s = 0;
      if (typeof golfer.season?.birdies !== 'number') golfer.season.birdies = 0;
      if (typeof golfer.season?.eagles !== 'number') golfer.season.eagles = 0;
      if (typeof golfer.season?.bestFinish !== 'number') golfer.season.bestFinish = 0;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — a private window with no storage is not an error worth surfacing.
  }
}

export function hasSave(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
