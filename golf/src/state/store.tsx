/**
 * Application state.
 *
 * The universe is held in a ref rather than in React state, because the
 * simulation engines mutate golfers in place — writing a season's results means
 * updating fifty career records, and deep-cloning that on every round would be
 * both slow and pointless. A revision counter is what tells React to re-render,
 * and the same counter is what triggers a save.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from 'react';
import {
  type Universe, advanceSeason, createUniverse, currentTournament, golferMap,
  seasonComplete, simulateNextRound, simulateTournament,
} from '../simulation/seasonEngine';
import { ROUNDS, recordRound, type Tournament } from '../simulation/tournamentEngine';
import { clearSave, hasSave, loadUniverse, saveUniverse } from '../simulation/persistence';
import {
  type PlaySession, conditionsForSession, createSession, hit, nextHole, nudgeAim,
  nudgeDistance, puttWith, restoreSession, selectClub, selectShotType, setTarget, settle, standingFor,
  simulateRestOfRound, takeCaddieLine, toPlayerRound, toSavedSession,
} from '../game/session';
import { conditionsFor, generateWeather } from '../simulation/weatherEngine';
import { useCareerState, type CareerState } from './useCareer';
import { createRng } from '../simulation/rng';
import { COURSE_BY_ID } from '../data/courses';
import type { Vec2 } from '../simulation/geometry';
import type { ClubId, Golfer } from '../simulation/types';
import type { PuttIntentId, ShotTypeId } from '../simulation/config';

export type ScreenId = 'home' | 'play' | 'tournament' | 'players' | 'courses' | 'stats' | 'news' | 'career';

export interface DispersionSettings {
  fifty: boolean;
  seventyFive: boolean;
  ninety: boolean;
}

interface StoreValue {
  universe: Universe;
  revision: number;
  screen: ScreenId;
  setScreen: (screen: ScreenId) => void;
  session: PlaySession | null;
  profileId: string | null;
  openProfile: (id: string | null) => void;
  busy: string | null;
  message: string | null;
  dismissMessage: () => void;
  zones: DispersionSettings;
  setZones: (zones: DispersionSettings) => void;

  golfer: (id: string) => Golfer | undefined;
  userGolfer: Golfer | null;
  chooseUserGolfer: (id: string) => void;

  simulateRound: () => void;
  simulateEvent: () => void;
  simulateRestOfSeason: () => void;
  rollSeason: () => void;

  startPractice: (courseId: string, hole: number | null) => void;
  startTournamentRound: () => void;
  /** Step away from the round. It stays saved and resumes where it was. */
  leaveSession: () => void;
  /** Throw a practice round away. Refused for a tournament round. */
  abandonSession: () => void;
  /** Keep the holes already played and let the caddie finish the rest. */
  simulateRestOfSessionRound: () => void;
  finishSessionRound: () => void;

  aim: (point: Vec2) => void;
  pickClub: (club: ClubId) => void;
  pickShotType: (shotType: ShotTypeId) => void;
  nudge: (yards: number) => void;
  nudgeLength: (yards: number) => void;
  playShot: () => void;
  /** Take the caddie's club, aim and shot type. */
  caddieLine: () => void;
  playPutt: (intent: PuttIntentId) => void;
  completeAnimation: () => void;
  advanceHole: () => void;

  resetUniverse: () => void;
  saveNow: () => void;
  savedGameExists: boolean;

  /** Accounts, the created golfer, XP and the offseason. */
  career: CareerState;
  /**
   * True when the season has rolled over and the player has not been through the
   * offseason yet. Nothing that plays golf is allowed while it is set: spending the
   * XP is the gate between one season and the next.
   */
  offseasonDue: boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * A ref whose value is built once, on first render, and never again.
 *
 * `useRef(createUniverse())` looks equivalent and is not: the argument is an
 * ordinary expression, so it is evaluated on *every* render and the result thrown
 * away on all but the first. For a whole 156-player tour and a twenty-event
 * schedule that is ruinous, and because the value is discarded it is completely
 * invisible — the worst kind of bug to leave in.
 */
function useLazyRef<T>(create: () => T): MutableRefObject<T> {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = create();
  return ref as MutableRefObject<T>;
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const universeRef = useLazyRef<Universe>(() => loadUniverse() ?? createUniverse());
  const [revision, setRevision] = useState(0);
  const [screen, setScreen] = useState<ScreenId>('home');
  const [session, setSession] = useState<PlaySession | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [zones, setZones] = useState<DispersionSettings>({ fifty: true, seventyFive: true, ninety: false });
  const [savedGameExists, setSavedGameExists] = useState(hasSave());
  const saveTimer = useRef<number | null>(null);

  /**
   * The career state, held in a ref as well as returned.
   *
   * `commit` is created before the career hook and used by it, so it cannot close
   * over the hook's return value directly. The ref is how the debounced save knows
   * whether a career is active and therefore where the universe belongs.
   */
  const careerRef = useRef<CareerState | null>(null);

  /**
   * Write the universe out now, rather than in six hundred milliseconds.
   *
   * The debounce below is right for the fifty saves a simulated season
   * generates and wrong for a shot: between resolving a drive and drawing it,
   * the outcome is known to the program and not yet on disk, and a reload in
   * that window is a free re-try. `localStorage.setItem` is synchronous, so
   * calling this before the ball is drawn moving closes the window entirely.
   *
   * Against the account server the write is a request rather than an
   * assignment, so a player who kills the tab inside the round trip can still
   * lose the shot. Saving locally is not an option there — the career's universe
   * lives on the server — so the honest position is that the remote window is
   * one request long, and the local one does not exist.
   */
  const commitNow = useCallback(() => {
    setRevision((value) => value + 1);
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (careerRef.current?.career) {
      void careerRef.current.saveCareerUniverse();
      setSavedGameExists(true);
      return;
    }
    const result = saveUniverse(universeRef.current);
    setSavedGameExists(result.ok);
    if (!result.ok) setMessage('Could not save — browser storage is unavailable or full.');
  }, []);

  const commit = useCallback(() => {
    setRevision((value) => value + 1);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // A career's universe belongs to the account, not to the browser: it goes
      // wherever the career does, which may be a server. Without one, the game
      // saves to localStorage exactly as it always has.
      if (careerRef.current?.career) {
        void careerRef.current.saveCareerUniverse();
        setSavedGameExists(true);
        return;
      }
      const result = saveUniverse(universeRef.current);
      setSavedGameExists(result.ok);
      if (!result.ok) setMessage('Could not save — browser storage is unavailable or full.');
    }, 600);
  }, []);

  const career = useCareerState(universeRef, commit, setMessage);
  careerRef.current = career;
  const offseasonDue = career.career?.offseasonOpen ?? false;

  /**
   * Report finished events and closed seasons whenever the universe moves.
   *
   * Driven off the revision counter rather than called from each action, because
   * every path that can finish a tournament — simulating a round, simulating an
   * event, playing one by hand, running the rest of the season — ends in a commit.
   * One effect here covers all of them and cannot be forgotten in a new one.
   */
  useEffect(() => {
    void career.syncCareer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, career.career?.id]);

  /** Run something slow without freezing the first paint of the busy indicator. */
  /**
   * A tournament round you started has to be finished before the tour moves on.
   *
   * Without this the whole exercise is decorative: leave a round three over
   * after five holes, simulate the event, and the simulation plays those five
   * holes again for you. That is a do-over with a button on it — worse than the
   * reload, because it looks sanctioned.
   */
  const roundInHand = (): boolean => {
    const saved = sessionRef.current ?? universeRef.current.session;
    if (!saved || saved.mode !== 'tournament') return false;
    setMessage(
      'You have a tournament round in progress. Finish it, or let the caddie play the rest of it — the holes you played stand either way.',
    );
    return true;
  };

  const runBusy = useCallback(
    (label: string, work: () => void) => {
      if (careerRef.current?.career?.offseasonOpen) {
        setMessage('Spend your XP in the offseason before the new season starts.');
        return;
      }
      if (roundInHand()) return;
      setBusy(label);
      window.setTimeout(() => {
        try {
          work();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(null);
          commit();
        }
      }, 30);
    },
    [commit],
  );

  const golfer = useCallback((id: string) => universeRef.current.golfers.find((g) => g.id === id), []);
  const userGolfer = useMemo(() => {
    const id = universeRef.current.userGolferId;
    return id ? universeRef.current.golfers.find((g) => g.id === id) ?? null : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const chooseUserGolfer = useCallback(
    (id: string) => {
      universeRef.current.userGolferId = id;
      commit();
    },
    [commit],
  );

  // --- Simulation ----------------------------------------------------------

  const simulateRound = useCallback(() => {
    const tournament = currentTournament(universeRef.current);
    if (!tournament) return;
    runBusy(`Playing round ${tournament.roundsPlayed + 1} of the ${tournament.name}…`, () => {
      simulateNextRound(universeRef.current);
    });
  }, [runBusy]);

  const simulateEvent = useCallback(() => {
    const tournament = currentTournament(universeRef.current);
    if (!tournament) return;
    runBusy(`Simulating the ${tournament.name}…`, () => {
      simulateTournament(universeRef.current, { fast: true });
    });
  }, [runBusy]);

  /**
   * A hundred and fifty-six players over four rounds is real work, and twenty of
   * them in a row is a minute of it — so the season is simulated one event at a
   * time, handing the browser back between each so the label, the leaderboard and
   * the news wire move while it runs instead of the window going grey.
   */
  const simulateRestOfSeason = useCallback(() => {
    if (roundInHand()) return;
    const step = () => {
      const universe = universeRef.current;
      if (seasonComplete(universe)) {
        setBusy(null);
        commit();
        return;
      }
      const event = currentTournament(universe);
      const index = universe.schedule.filter((t) => t.status === 'complete').length + 1;
      setBusy(`Simulating the season — event ${index} of ${universe.schedule.length}: ${event?.name ?? ''}…`);
      window.setTimeout(() => {
        try {
          simulateTournament(universe, { fast: true });
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
          setBusy(null);
          commit();
          return;
        }
        commit();
        step();
      }, 30);
    };
    step();
  }, [commit]);

  const rollSeason = useCallback(() => {
    runBusy('Off-season: development, retirements and next year’s schedule…', () => {
      advanceSeason(universeRef.current);
    });
  }, [runBusy]);

  // --- Playing -------------------------------------------------------------

  /**
   * The live session, mirrored into a ref.
   *
   * The updater form of `setSession` cannot be used for anything that has to
   * touch the universe as well, because React is free to call an updater twice
   * and a save is not a pure function. Reading the current round from here
   * instead keeps the two writes — React state and the save file — in one place
   * and in one order.
   */
  const sessionRef = useRef<PlaySession | null>(null);
  sessionRef.current = session;

  /**
   * Move the round on, and put it in the save file.
   *
   * `flush` is the whole anti-reload mechanism, and it is deliberately not on by
   * default: nudging the aim a yard left does not need a megabyte written to
   * disk, and resolving a shot does — before the ball is drawn moving, so the
   * outcome is never knowable and unrecorded at the same time.
   */
  const applySession = useCallback(
    (next: PlaySession | null, flush = false) => {
      sessionRef.current = next;
      setSession(next);
      universeRef.current.session = next ? toSavedSession(next) : null;
      if (flush) commitNow();
    },
    [commitNow],
  );

  const withGolfer = useCallback(
    (update: (session: PlaySession, player: Golfer) => PlaySession, flush = false) => {
      const current = sessionRef.current;
      if (!current) return;
      const player = universeRef.current.golfers.find((g) => g.id === current.golferId);
      if (!player) return;
      applySession(update(current, player), flush);
    },
    [applySession],
  );

  // Aiming changes nothing that can be gamed by reloading, so they update the
  // snapshot in memory and leave the write to the ordinary debounce.

  /**
   * Pick a saved round back up.
   *
   * Restoring is not simply reading the object back: a round saved while the ball
   * was in the air comes back as a shot that has already happened, and
   * `restoreSession` settles it rather than offering it again.
   */
  const resumeSavedRound = useCallback(
    (navigate = true): boolean => {
      const universe = universeRef.current;
      const saved = universe.session;
      if (!saved) return false;
      const player = universe.golfers.find((g) => g.id === saved.golferId);
      if (!player || !COURSE_BY_ID[saved.courseId]) {
        // The golfer retired, or the venue is gone. Nothing to resume into.
        universe.session = null;
        commitNow();
        return false;
      }
      applySession(restoreSession(saved, player), true);
      if (navigate) setScreen('play');
      return true;
    },
    [applySession, commitNow],
  );

  /**
   * Put a saved round back in hand when the game opens.
   *
   * Without navigating: being dropped onto the course the instant the page loads
   * is startling, and the round announcing itself on the home screen and in the
   * Play tab says the same thing more politely. What matters is that the round is
   * *live* again rather than waiting to be re-started — the shots are already
   * played either way.
   *
   * It runs again when a career signs in, because that swaps the whole universe
   * for the account's own, and its round is a different round.
   */
  useEffect(() => {
    if (universeRef.current.session && !sessionRef.current) resumeSavedRound(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [career.career?.id, career.starting]);

  const startPractice = useCallback(
    (courseId: string, hole: number | null) => {
      const universe = universeRef.current;
      // A tournament round has to be dealt with before anything else is played.
      if (roundInHand()) return;
      if (universe.session) {
        resumeSavedRound();
        return;
      }
      const chosen = universe.userGolferId ?? universe.golfers[0].id;
      const player = universe.golfers.find((g) => g.id === chosen)!;
      const course = COURSE_BY_ID[courseId];
      // A real day, not a windless one. Practising in a vacuum is the fastest
      // way to think the game is easy: the tour plays in whatever turns up.
      const seed = `practice:${Date.now()}`;
      const conditions = conditionsFor(generateWeather(course, createRng(seed)), seed);
      // Saved from the first tee, not from the first shot: a round that only
      // becomes real once you have hit one is a round you can restart for free.
      applySession(
        createSession({
          mode: 'practice',
          golfer: player,
          courseId,
          round: 1,
          holes: hole ? [hole] : undefined,
          conditions,
          seed: `practice:${player.id}:${courseId}:${hole ?? 'all'}:${Date.now()}`,
        }),
        true,
      );
      setScreen('play');
    },
    [applySession, resumeSavedRound],
  );

  const startTournamentRound = useCallback(() => {
    if (careerRef.current?.career?.offseasonOpen) {
      setMessage('Spend your XP in the offseason before the new season starts.');
      return;
    }
    const universe = universeRef.current;
    // A tournament round already under way is picked up where it was, never
    // started again. This is the other half of saving every shot: persisting the
    // round is no use if the player can ask for a fresh one off the first tee.
    //
    // A saved *practice* round is a different matter — there is nothing at stake
    // in it and nothing to gain by dropping it — so it gives way rather than
    // standing in the way of a tournament.
    if (universe.session?.mode === 'tournament') {
      resumeSavedRound();
      return;
    }
    const tournament = currentTournament(universe);
    const id = universe.userGolferId;
    if (!tournament || !id) return;
    const player = universe.golfers.find((g) => g.id === id);
    if (!player) return;
    const round = tournament.roundsPlayed + 1;
    if (round > ROUNDS) return;
    if (round > 2 && !tournament.madeCut.includes(id)) {
      setMessage('You missed the cut — simulate the weekend to move on.');
      return;
    }
    const conditions = conditionsForSession(tournament, round);
    player.fatigue = Math.max(0, player.fatigue - 26);
    applySession(
      createSession({
        mode: 'tournament',
        golfer: player,
        courseId: tournament.courseId,
        round,
        conditions,
        seed: `${tournament.id}:${round}:${player.id}`,
        standing: standingFor(tournament, id, tournament.field.length),
      }),
      true,
    );
    setScreen('play');
  }, [applySession, resumeSavedRound]);

  /**
   * Step away from the round without ending it. It stays in the save file and
   * comes back exactly as it was, which is the point.
   */
  const leaveSession = useCallback(() => {
    commitNow();
    setSession(null);
    sessionRef.current = null;
    setScreen('home');
  }, [commitNow]);

  /**
   * Throw the round away.
   *
   * Allowed for practice, where there is nothing at stake and a half-finished
   * round is just clutter. Refused for a tournament round, because "abandon" and
   * "start again" would be the same button and the whole exercise would be
   * pointless.
   */
  const abandonSession = useCallback(() => {
    const current = sessionRef.current ?? universeRef.current.session;
    if (current && current.mode === 'tournament') {
      setMessage('A tournament round cannot be abandoned — it is saved shot by shot. Finish it, or leave and come back to it.');
      return;
    }
    applySession(null, true);
    setScreen('home');
  }, [applySession]);

  /**
   * Let the caddie finish the round.
   *
   * The counterpart to refusing to simulate past a round in progress: the holes
   * already played stand shot for shot, and the rest are played by the engine
   * that plays everybody else. Nothing about it is an advantage, which is what
   * makes it a safe way out rather than a loophole.
   */
  const simulateRestOfSessionRound = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.status === 'roundComplete') return;
    const player = universeRef.current.golfers.find((g) => g.id === current.golferId);
    if (!player) return;
    applySession(simulateRestOfRound(current, player), true);
  }, [applySession]);

  /** Write the played round into the tournament and simulate the rest of the field. */
  const finishSessionRound = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (current.mode !== 'tournament') {
      applySession(null, true);
      setScreen('home');
      return;
    }
    const universe = universeRef.current;
    const tournament = currentTournament(universe);
    if (!tournament) {
      applySession(null, true);
      return;
    }
    runBusy(`Scoring round ${current.round} of the ${tournament.name}…`, () => {
      recordRound(tournament, current.golferId, current.round, toPlayerRound(current));
      simulateNextRound(universe, { skipGolferId: current.golferId, fast: true });
    });
    // The round is on the card now, so the saved copy has done its job.
    applySession(null, true);
    setScreen('tournament');
  }, [runBusy, applySession]);

  // --- Session actions -----------------------------------------------------

  const aim = useCallback((point: Vec2) => withGolfer((s, g) => setTarget(s, g, point)), [withGolfer]);
  const pickClub = useCallback((club: ClubId) => withGolfer((s, g) => selectClub(s, g, club)), [withGolfer]);
  const pickShotType = useCallback((type: ShotTypeId) => withGolfer((s) => selectShotType(s, type)), [withGolfer]);
  const nudge = useCallback((yards: number) => withGolfer((s) => nudgeAim(s, yards)), [withGolfer]);
  const nudgeLength = useCallback((yards: number) => withGolfer((s) => nudgeDistance(s, yards)), [withGolfer]);
  const caddieLine = useCallback(() => withGolfer((s, g) => takeCaddieLine(s, g)), [withGolfer]);

  /**
   * Play the shot, and write it down before anybody sees where it went.
   *
   * `hit` resolves the whole thing — the ball has moved, the lie is set and the
   * stroke is on the card — and only then hands back a session marked
   * `animating` for the UI to draw. So the save that follows it here happens
   * before the first frame of ball flight, which is the property that makes
   * reloading useless as a way of un-hitting a drive.
   */
  const playShot = useCallback(() => {
    withGolfer((s, g) => (s.status === 'aiming' ? hit(s, g).session : s), true);
  }, [withGolfer]);

  const playPutt = useCallback(
    (intent: PuttIntentId) => {
      withGolfer((s, g) => (s.status === 'aiming' ? puttWith(s, g, intent).session : s), true);
    },
    [withGolfer],
  );

  const completeAnimation = useCallback(() => {
    withGolfer((s, g) => (s.status === 'animating' ? settle(s, g) : s), true);
  }, [withGolfer]);

  const advanceHole = useCallback(() => {
    withGolfer((s, g) => {
      if (s.status !== 'holeComplete') return s;
      const tournament = currentTournament(universeRef.current);
      const standing =
        s.mode === 'tournament' && tournament
          ? standingFor(tournament, s.golferId, tournament.field.length)
          : undefined;
      return nextHole(s, g, standing);
    }, true);
  }, [withGolfer]);

  // --- Housekeeping --------------------------------------------------------

  const resetUniverse = useCallback(() => {
    clearSave();
    universeRef.current = createUniverse(`golf-universe:${Date.now()}`);
    setSession(null);
    setProfileId(null);
    setScreen('home');
    commit();
  }, [commit]);

  const saveNow = useCallback(() => {
    const result = saveUniverse(universeRef.current);
    setSavedGameExists(result.ok);
    setMessage(result.ok ? `Saved (${Math.round(result.bytes / 1024)} KB).` : 'Save failed.');
  }, []);

  useEffect(() => {
    // First run: make sure a universe exists on disk. Skipped once an account is
    // signed in, because then the account owns the save and the shared
    // localStorage slot is somebody else's business.
    if (!hasSave() && !careerRef.current?.account) saveUniverse(universeRef.current);
  }, []);

  const value: StoreValue = {
    universe: universeRef.current,
    revision,
    screen,
    setScreen,
    session,
    profileId,
    openProfile: setProfileId,
    busy,
    message,
    dismissMessage: () => setMessage(null),
    zones,
    setZones,
    golfer,
    userGolfer,
    chooseUserGolfer,
    simulateRound,
    simulateEvent,
    simulateRestOfSeason,
    rollSeason,
    startPractice,
    startTournamentRound,
    leaveSession,
    abandonSession,
    simulateRestOfSessionRound,
    finishSessionRound,
    aim,
    pickClub,
    pickShotType,
    nudge,
    nudgeLength,
    playShot,
    caddieLine,
    playPutt,
    completeAnimation,
    advanceHole,
    resetUniverse,
    saveNow,
    savedGameExists,
    career,
    offseasonDue,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside a StoreProvider');
  return value;
}

/** Convenience: the event currently being played, if any. */
export function useCurrentTournament(): Tournament | null {
  const { universe, revision } = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => currentTournament(universe), [universe, revision]);
}

export function useGolferIndex(): Map<string, Golfer> {
  const { universe, revision } = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => golferMap(universe), [universe, revision]);
}
