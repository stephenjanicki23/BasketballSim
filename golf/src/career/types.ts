/** The persistent shapes of the career system: accounts, careers and ledgers. */

import type { ArchetypeId, PuttingStyleId } from '../simulation/types';
import type { SkillLineId } from './config';
import type { SkillLines } from './archetypes';

/**
 * An account. What is stored is deliberately the minimum: a name to be known by,
 * a way to prove it is you, and a pointer to your career.
 *
 * There is no password anywhere in this type and there never will be. What is
 * stored is a PBKDF2 verifier — a salt, an iteration count and a derived hash —
 * from which the password cannot be recovered, only checked. See `password.ts`.
 */
export interface Account {
  id: string;
  /** Unique, case-insensitive, and how you log in. */
  username: string;
  /** What other people see. Free to change; need not be unique. */
  displayName: string;
  /** Optional. Only ever used to tell one account from another. */
  email: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** The career this account owns, if they have made a golfer yet. */
  careerId: string | null;
}

/** One line of the XP ledger: what happened, and what it was worth. */
export interface XpEntry {
  /** A stable key, so entries from many events can be summed by reason. */
  reason: string;
  /** How it is described on the offseason screen. */
  label: string;
  xp: number;
  /** How many times this happened, for "12 birdies — 72 XP". */
  count: number;
}

export interface XpLedger {
  total: number;
  entries: XpEntry[];
}

export function emptyLedger(): XpLedger {
  return { total: 0, entries: [] };
}

/** One rating point bought, kept so a career's decisions are a readable history. */
export interface ProgressionStep {
  season: number;
  line: SkillLineId;
  from: number;
  to: number;
  xp: number;
}

/** What a season did, from the career's point of view rather than the tour's. */
export interface CareerSeasonRecord {
  /** Calendar season, e.g. 2026. */
  season: number;
  /** Which season of this golfer's career it was, 1-based. */
  careerSeason: number;
  age: number;
  events: number;
  cutsMade: number;
  wins: number;
  top10s: number;
  top25s: number;
  earnings: number;
  /** Points-standings rank at the end of the season. */
  standingsRank: number;
  worldRank: number;
  scoringAverage: number;
  birdies: number;
  eagles: number;
  bestFinish: number;
  xpEarned: number;
  /** Ability before and after the offseason, so progress is visible. */
  abilityBefore: number;
  abilityAfter: number;
}

/**
 * A career: the authoritative record of a created golfer.
 *
 * `lines` is the source of truth for what the golfer can do. The `Golfer` the
 * simulation plays with is *derived* from it via `ratingsFromLines`, never the
 * other way round, which is what makes the archetype ceilings impossible to
 * exceed no matter what any other part of the program does.
 */
export interface Career {
  id: string;
  accountId: string;
  /** The golfer's id inside the universe. */
  golferId: string;

  firstName: string;
  lastName: string;
  displayName: string;
  country: string;
  flag: string;

  archetype: ArchetypeId;
  puttingStyle: PuttingStyleId;

  /** The starting build, kept for the record. */
  startingLines: SkillLines;
  /** The build as it is now. */
  lines: SkillLines;

  /** Everything ever earned. Only ever goes up. */
  experience: number;
  /** Earned and not yet spent. */
  availableXp: number;
  /** Spent on ratings. `experience === availableXp + spentXp` always. */
  spentXp: number;

  /** 1 in the rookie year. */
  careerSeason: number;
  age: number;

  /** This season's XP, itemised, waiting for the offseason. */
  pending: XpLedger;
  /** Every point ever bought. */
  history: ProgressionStep[];
  seasons: CareerSeasonRecord[];

  /** Set while the offseason screen is open, cleared when the player is done. */
  offseasonOpen: boolean;
  /**
   * How much each line has already gained this offseason, so the per-winter limit
   * survives a reload. Reset when a season ends and when the offseason closes.
   */
  gainedThisOffseason: Partial<Record<SkillLineId, number>>;

  /**
   * `season:tournamentId` for every event this career has been paid XP for.
   *
   * This is the replay guard, and it is the reason it is stored rather than
   * derived: an event that has already been counted has to stay counted across a
   * reload, or finishing a tournament and refreshing the page becomes a way to
   * earn it twice.
   */
  countedEvents: string[];
  /** The last calendar season closed out. Seasons must arrive in order, once each. */
  lastSeason: number;

  createdAt: string;
  updatedAt: string;
}

/** What the client is told about itself once logged in. */
export interface Session {
  token: string;
  account: Account;
  career: Career | null;
}
