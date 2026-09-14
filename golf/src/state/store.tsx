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
  type ReactNode,
} from 'react';
import {
  type Universe, advanceSeason, createUniverse, currentTournament, golferMap,
  seasonComplete, simulateNextRound, simulateTournament,
} from '../simulation/seasonEngine';
import { ROUNDS, recordRound, type Tournament } from '../simulation/tournamentEngine';
import { clearSave, hasSave, loadUniverse, saveUniverse } from '../simulation/persistence';
import {
  type PlaySession, conditionsForSession, createSession, hit, nextHole, nudgeAim,
  nudgeDistance, selectClub, selectShotType, setTarget, settle, standingFor, toPlayerRound,
} from '../game/session';
import { calmWeather, conditionsFor } from '../simulation/weatherEngine';
import { COURSE_BY_ID } from '../data/courses';
import type { Vec2 } from '../simulation/geometry';
import type { ClubId, Golfer } from '../simulation/types';
import type { ShotTypeId } from '../simulation/config';

export type ScreenId = 'home' | 'play' | 'tournament' | 'players' | 'courses' | 'stats' | 'news';

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
  abandonSession: () => void;
  finishSessionRound: () => void;

  aim: (point: Vec2) => void;
  pickClub: (club: ClubId) => void;
  pickShotType: (shotType: ShotTypeId) => void;
  nudge: (yards: number) => void;
  nudgeLength: (yards: number) => void;
  playShot: () => void;
  completeAnimation: () => void;
  advanceHole: () => void;

  resetUniverse: () => void;
  saveNow: () => void;
  savedGameExists: boolean;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const universeRef = useRef<Universe>(loadUniverse() ?? createUniverse());
  const [revision, setRevision] = useState(0);
  const [screen, setScreen] = useState<ScreenId>('home');
  const [session, setSession] = useState<PlaySession | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [zones, setZones] = useState<DispersionSettings>({ fifty: true, seventyFive: true, ninety: false });
  const [savedGameExists, setSavedGameExists] = useState(hasSave());
  const saveTimer = useRef<number | null>(null);

  const commit = useCallback(() => {
    setRevision((value) => value + 1);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const result = saveUniverse(universeRef.current);
      setSavedGameExists(result.ok);
      if (!result.ok) setMessage('Could not save — browser storage is unavailable or full.');
    }, 600);
  }, []);

  /** Run something slow without freezing the first paint of the busy indicator. */
  const runBusy = useCallback(
    (label: string, work: () => void) => {
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

  const simulateRestOfSeason = useCallback(() => {
    runBusy('Simulating the rest of the season…', () => {
      while (!seasonComplete(universeRef.current)) {
        simulateTournament(universeRef.current, { fast: true });
      }
    });
  }, [runBusy]);

  const rollSeason = useCallback(() => {
    runBusy('Off-season: development, retirements and next year’s schedule…', () => {
      advanceSeason(universeRef.current);
    });
  }, [runBusy]);

  // --- Playing -------------------------------------------------------------

  const startPractice = useCallback(
    (courseId: string, hole: number | null) => {
      const universe = universeRef.current;
      const chosen = universe.userGolferId ?? universe.golfers[0].id;
      const player = universe.golfers.find((g) => g.id === chosen)!;
      const course = COURSE_BY_ID[courseId];
      const conditions = conditionsFor(calmWeather(course), `practice:${Date.now()}`);
      setSession(
        createSession({
          mode: 'practice',
          golfer: player,
          courseId,
          round: 1,
          holes: hole ? [hole] : undefined,
          conditions,
          seed: `practice:${player.id}:${courseId}:${hole ?? 'all'}:${Date.now()}`,
        }),
      );
      setScreen('play');
    },
    [],
  );

  const startTournamentRound = useCallback(() => {
    const universe = universeRef.current;
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
    setSession(
      createSession({
        mode: 'tournament',
        golfer: player,
        courseId: tournament.courseId,
        round,
        conditions,
        seed: `${tournament.id}:${round}:${player.id}`,
        standing: standingFor(tournament, id, tournament.field.length),
      }),
    );
    setScreen('play');
  }, []);

  const abandonSession = useCallback(() => {
    setSession(null);
    setScreen('home');
  }, []);

  /** Write the played round into the tournament and simulate the rest of the field. */
  const finishSessionRound = useCallback(() => {
    const current = session;
    if (!current) return;
    if (current.mode !== 'tournament') {
      setSession(null);
      setScreen('home');
      return;
    }
    const universe = universeRef.current;
    const tournament = currentTournament(universe);
    if (!tournament) {
      setSession(null);
      return;
    }
    runBusy(`Scoring round ${current.round} of the ${tournament.name}…`, () => {
      recordRound(tournament, current.golferId, current.round, toPlayerRound(current));
      simulateNextRound(universe, { skipGolferId: current.golferId, fast: true });
    });
    setSession(null);
    setScreen('tournament');
  }, [session, runBusy]);

  // --- Session actions -----------------------------------------------------

  const withGolfer = useCallback(
    (update: (session: PlaySession, player: Golfer) => PlaySession) => {
      setSession((current) => {
        if (!current) return current;
        const player = universeRef.current.golfers.find((g) => g.id === current.golferId);
        if (!player) return current;
        return update(current, player);
      });
    },
    [],
  );

  const aim = useCallback((point: Vec2) => withGolfer((s, g) => setTarget(s, g, point)), [withGolfer]);
  const pickClub = useCallback((club: ClubId) => withGolfer((s, g) => selectClub(s, g, club)), [withGolfer]);
  const pickShotType = useCallback((type: ShotTypeId) => withGolfer((s) => selectShotType(s, type)), [withGolfer]);
  const nudge = useCallback((yards: number) => withGolfer((s) => nudgeAim(s, yards)), [withGolfer]);
  const nudgeLength = useCallback((yards: number) => withGolfer((s) => nudgeDistance(s, yards)), [withGolfer]);

  const playShot = useCallback(() => {
    withGolfer((s, g) => {
      if (s.status !== 'aiming') return s;
      return hit(s, g).session;
    });
  }, [withGolfer]);

  const completeAnimation = useCallback(() => {
    withGolfer((s, g) => (s.status === 'animating' ? settle(s, g) : s));
    commit();
  }, [withGolfer, commit]);

  const advanceHole = useCallback(() => {
    withGolfer((s, g) => {
      if (s.status !== 'holeComplete') return s;
      const tournament = currentTournament(universeRef.current);
      const standing =
        s.mode === 'tournament' && tournament
          ? standingFor(tournament, s.golferId, tournament.field.length)
          : undefined;
      return nextHole(s, g, standing);
    });
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
    // First run: make sure a universe exists on disk.
    if (!hasSave()) saveUniverse(universeRef.current);
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
    abandonSession,
    finishSessionRound,
    aim,
    pickClub,
    pickShotType,
    nudge,
    nudgeLength,
    playShot,
    completeAnimation,
    advanceHole,
    resetUniverse,
    saveNow,
    savedGameExists,
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
