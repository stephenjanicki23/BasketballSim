/**
 * The account and career half of the application state.
 *
 * Split out of the store because it is the one part of the game that is
 * asynchronous. Everything else — a shot, a round, a season — is a synchronous
 * call into an engine; signing in, awarding XP and spending it all go through a
 * backend that may be a server on the other side of a network. Keeping that in its
 * own file keeps the store readable and keeps the awaits in one place.
 *
 * Two invariants this hook exists to maintain:
 *
 *   1. The golfer on tour always matches the career. Any time the career changes —
 *      signing in, finishing an offseason — `syncGolfer` re-derives the ratings
 *      from the career's lines, which is the only way they are ever written.
 *   2. No finished event is ever lost or counted twice. The engines push events
 *      onto `universe.careerEvents`; this drains that queue, and an entry only
 *      leaves it once the store has accepted it. A failed submission stays queued
 *      and goes up on the next attempt; a duplicate is refused at the far end.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import {
  backend, storeToken, storedToken, type Problem,
} from '../account';
import {
  golferForCareer, syncGolfer,
  type Account, type Career, type CreationRequest, type SkillLineId,
} from '../career';
import { currentAbility } from '../simulation/golferEngine';
import { createUniverse, joinTour, leaveTour, type Universe } from '../simulation/seasonEngine';
import { parseUniverse, serializeUniverse } from '../simulation/persistence';

export interface CareerState {
  /** Which backend accounts live in, and a sentence saying where. */
  backendKind: 'local' | 'remote';
  backendLabel: string;

  account: Account | null;
  career: Career | null;
  /** True while a request is in flight; carries a label for the UI. */
  authBusy: string | null;
  /** Problems from the last attempt, cleared on the next one. */
  problems: Problem[];
  clearProblems: () => void;
  /** True until the stored token has been checked, so the UI does not flash. */
  starting: boolean;

  register: (input: { username: string; password: string; displayName?: string; email?: string }) => Promise<boolean>;
  logIn: (input: { username: string; password: string }) => Promise<boolean>;
  logOut: () => Promise<void>;

  createGolfer: (request: CreationRequest) => Promise<boolean>;
  spendXp: (buy: Partial<Record<SkillLineId, number>>) => Promise<boolean>;
  finishOffseason: () => Promise<boolean>;
  startOver: () => Promise<boolean>;

  /** Push any finished events and the season report up to the store. */
  syncCareer: () => Promise<void>;
  /** Save the universe against the career, when there is one. */
  saveCareerUniverse: () => Promise<void>;
}

export function useCareerState(
  universeRef: MutableRefObject<Universe>,
  commit: () => void,
  notify: (message: string) => void,
): CareerState {
  const api = backend();
  const [account, setAccount] = useState<Account | null>(null);
  const [career, setCareer] = useState<Career | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [starting, setStarting] = useState(true);

  /** The token, for callbacks that must not close over a stale render. */
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  /** Guards the event queue, so two drains cannot run at once and double-submit. */
  const draining = useRef(false);

  const clearProblems = useCallback(() => setProblems([]), []);

  /**
   * Bring the universe into line with a career: load the career's own universe if
   * it has one, put the golfer on tour if not, and re-derive their ratings either
   * way.
   */
  const adopt = useCallback(
    async (next: Career, activeToken: string) => {
      const loaded = await api.loadUniverse(activeToken);
      if (loaded.ok && loaded.value) {
        const parsed = parseUniverse(loaded.value);
        if (parsed) universeRef.current = parsed;
      }

      let universe = universeRef.current;
      // A career with no stored universe — or one saved by an older build that no
      // longer parses — starts a fresh tour rather than joining somebody else's.
      if (!universe.createdGolferId || universe.createdGolferId !== next.golferId) {
        universe = createUniverse(`career:${next.id}`);
        universeRef.current = universe;
        joinTour(universe, golferForCareer(next, universe.season));
      }
      const golfer = universe.golfers.find((entry) => entry.id === next.golferId);
      if (golfer) syncGolfer(golfer, next);
      universe.userGolferId = next.golferId;
      commit();
    },
    [api, commit, universeRef],
  );

  /** Accept a session from register, log-in or resume. */
  const accept = useCallback(
    async (value: { token: string; account: Account; career: Career | null }) => {
      setToken(value.token);
      tokenRef.current = value.token;
      storeToken(value.token);
      setAccount(value.account);
      setCareer(value.career);
      if (value.career) await adopt(value.career, value.token);
    },
    [adopt],
  );

  /**
   * One request, with the busy label and the problem list handled once.
   *
   * Returns the reply rather than `T | null`, because some of these calls succeed
   * *with* null — deleting a career, for one — and a null return would be
   * indistinguishable from a failure. Reading `problems` to tell them apart would
   * be worse still: that is state from the previous render and has not been
   * updated yet.
   */
  const run = useCallback(
    async <T,>(
      label: string,
      work: () => Promise<{ ok: true; value: T } | { ok: false; problems: Problem[] }>,
    ): Promise<{ ok: true; value: T } | { ok: false }> => {
      setAuthBusy(label);
      setProblems([]);
      try {
        const result = await work();
        if (!result.ok) {
          setProblems(result.problems);
          return { ok: false };
        }
        return { ok: true, value: result.value };
      } finally {
        setAuthBusy(null);
      }
    },
    [],
  );

  // --- Sessions ------------------------------------------------------------

  useEffect(() => {
    const existing = storedToken();
    if (!existing) {
      setStarting(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await api.resume(existing);
      if (cancelled) return;
      if (result.ok) await accept(result.value);
      // A token that no longer works is not an error worth showing: it expired,
      // or the server's database was reset. Clear it and offer the sign-in form.
      else storeToken(null);
      if (!cancelled) setStarting(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = useCallback(
    async (input: { username: string; password: string; displayName?: string; email?: string }) => {
      const session = await run('Creating your account…', () => api.register(input));
      if (!session.ok) return false;
      await accept(session.value);
      return true;
    },
    [api, run, accept],
  );

  const logIn = useCallback(
    async (input: { username: string; password: string }) => {
      const session = await run('Signing in…', () => api.login(input));
      if (!session.ok) return false;
      await accept(session.value);
      return true;
    },
    [api, run, accept],
  );

  const logOut = useCallback(async () => {
    const active = tokenRef.current;
    if (active) {
      // Save before leaving, so a season is not lost to signing out.
      await api.saveUniverse(active, serializeUniverse(universeRef.current)).catch(() => undefined);
      await api.logout(active);
    }
    storeToken(null);
    setToken(null);
    tokenRef.current = null;
    setAccount(null);
    setCareer(null);
    leaveTour(universeRef.current);
    commit();
  }, [api, commit, universeRef]);

  // --- The career ----------------------------------------------------------

  const createGolfer = useCallback(
    async (request: CreationRequest) => {
      const active = tokenRef.current;
      if (!active) return false;
      const created = await run('Filing your card…', () => api.createGolfer(active, request));
      if (!created.ok) return false;
      setCareer(created.value);
      await adopt(created.value, active);
      await api.saveUniverse(active, serializeUniverse(universeRef.current));
      return true;
    },
    [api, run, adopt, universeRef],
  );

  const spendXp = useCallback(
    async (buy: Partial<Record<SkillLineId, number>>) => {
      const active = tokenRef.current;
      if (!active) return false;
      const result = await run('Putting in the work…', () => api.spendXp(active, { buy }));
      if (!result.ok) return false;
      setCareer(result.value.career);
      const golfer = universeRef.current.golfers.find((entry) => entry.id === result.value.career.golferId);
      if (golfer) syncGolfer(golfer, result.value.career);
      commit();
      return true;
    },
    [api, run, commit, universeRef],
  );

  const finishOffseason = useCallback(async () => {
    const active = tokenRef.current;
    if (!active || !career) return false;
    const golfer = universeRef.current.golfers.find((entry) => entry.id === career.golferId);
    // The ability *after* this offseason, which is what the season summary reports
    // as the year's progress. Computed here because it depends on the golfer the
    // simulation is holding, which the store never sees.
    const ability = golfer ? currentAbility(golfer) : 0;
    const closed = await run('Starting the new season…', () => api.finishOffseason(active, ability));
    if (!closed.ok) return false;
    setCareer(closed.value);
    if (golfer) syncGolfer(golfer, closed.value);
    await api.saveUniverse(active, serializeUniverse(universeRef.current));
    commit();
    return true;
  }, [api, run, career, commit, universeRef]);

  const startOver = useCallback(async () => {
    const active = tokenRef.current;
    if (!active) return false;
    const result = await run('Clearing your career…', () => api.deleteCareer(active));
    if (!result.ok) return false;
    setCareer(null);
    leaveTour(universeRef.current);
    universeRef.current = createUniverse(`fresh:${Date.now()}`);
    commit();
    return true;
  }, [api, run, commit, universeRef]);

  // --- Reporting results ---------------------------------------------------

  /**
   * Drain the event queue and the season report.
   *
   * Events go up one at a time and in order. An entry is dropped from the queue
   * when the store accepts it *or* tells us it has already been counted — those are
   * the two cases where keeping it would be wrong. Anything else (no network, a
   * server restarting) leaves it in place to try again.
   */
  const syncCareer = useCallback(async () => {
    const active = tokenRef.current;
    const universe = universeRef.current;
    if (!active || !universe.createdGolferId || draining.current) return;
    if (!universe.careerEvents.length && !universe.careerSeasonReport) return;

    draining.current = true;
    try {
      let latest: Career | null = null;
      while (universe.careerEvents.length) {
        const [next] = universe.careerEvents;
        const result = await api.recordEvent(active, next);
        if (result.ok) {
          latest = result.value.career;
          universe.careerEvents.shift();
        } else if (result.problems.some((entry) => entry.message.includes('already been counted'))) {
          universe.careerEvents.shift();
        } else {
          notify(result.problems[0]?.message ?? 'Could not record that tournament.');
          break;
        }
      }

      const report = universe.careerSeasonReport;
      if (report && !universe.careerEvents.length) {
        const result = await api.endSeason(active, report);
        if (result.ok) {
          latest = result.value.career;
          universe.careerSeasonReport = null;
        } else if (result.problems.some((entry) => entry.message.includes('already been recorded'))) {
          universe.careerSeasonReport = null;
        } else {
          notify(result.problems[0]?.message ?? 'Could not close out the season.');
        }
      }

      if (latest) {
        setCareer(latest);
        commit();
      }
    } finally {
      draining.current = false;
    }
  }, [api, commit, notify, universeRef]);

  const saveCareerUniverse = useCallback(async () => {
    const active = tokenRef.current;
    if (!active || !universeRef.current.createdGolferId) return;
    const result = await api.saveUniverse(active, serializeUniverse(universeRef.current));
    if (!result.ok) notify(result.problems[0]?.message ?? 'Could not save your career.');
  }, [api, notify, universeRef]);

  return {
    backendKind: api.kind,
    backendLabel: api.label,
    account,
    career,
    authBusy,
    problems,
    clearProblems,
    starting,
    register,
    logIn,
    logOut,
    createGolfer,
    spendXp,
    finishOffseason,
    startOver,
    syncCareer,
    saveCareerUniverse,
  };
}
