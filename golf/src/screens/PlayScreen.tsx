/**
 * The playable screen: course in the middle, the golfer and the card on the
 * left, the shot on the right, and a running commentary underneath.
 */

import { useEffect, useMemo, useState } from 'react';
import { CourseView } from '../components/CourseView';
import { ShotControls } from '../components/ShotControls';
import { PuttPanel } from '../components/PuttPanel';
import { GolferCard, HoleCard, Scorecard } from '../components/GolferPanel';
import { WindDial } from '../components/WindDial';
import { Panel, Stat, toPar, toParClass, yards } from '../components/ui';
import { useStore } from '../state/store';
import { COURSE_BY_ID } from '../data/courses';
import { LIES } from '../simulation/config';
import { allShots, currentPlan, holesPlayed, ordinal, roundToPar, scoreName, sessionHole } from '../game/session';
import { choosePuttIntent } from '../simulation/puttingEngine';
import { sessionContext } from '../game/session';
import { describeWeather } from '../simulation/weatherEngine';
import { dist } from '../simulation/geometry';
import { benchmarkRound } from '../simulation/benchmark';
import { DebugPanel } from '../components/DebugPanel';
import { Hud } from '../components/Hud';
import type { DebugOptions } from '../components/render/holeRenderer';
import { roundTotal } from '../game/session';
import { useShotSounds } from '../audio/useShotSounds';

export function PlayScreen(): JSX.Element {
  const store = useStore();
  const {
    session, golfer: lookup, zones, playShot, playPutt, completeAnimation, advanceHole,
    finishSessionRound, leaveSession, abandonSession, simulateRestOfSessionRound,
    aim, openProfile, caddieLine, pickClub, pickShotType,
  } = store;

  // On a phone the panels are a drawer rather than a scroll: the course fills
  // the screen, the HUD carries the shot, and everything else slides in.
  const [drawer, setDrawer] = useState<'left' | 'right' | null>(null);

  const golfer = session ? lookup(session.golferId) : undefined;

  // Struck balls, splashes, rattles in the cup and the gallery.
  useShotSounds(session ?? null);

  const plan = useMemo(() => (session && golfer ? currentPlan(session, golfer) : null), [session, golfer]);
  const hole = useMemo(() => (session ? sessionHole(session) : null), [session]);

  // --- Trace check ---------------------------------------------------------
  // A development view, off by default and opened with D: the photograph a hole
  // was traced from, laid over the geometry the engine plays on.
  const [debug, setDebug] = useState<DebugOptions | null>(null);
  const reference = hole?.spec.reference?.image ?? null;
  useEffect(() => {
    if (!debug || !reference || debug.image) return;
    const image = new Image();
    image.src = reference;
    image.onload = () => setDebug((current) => (current ? { ...current, image } : current));
    // Reference images are local working files, not part of the build, so a
    // missing one is normal rather than broken. Say so instead of showing an
    // overlay slider that does nothing.
    image.onerror = () => setDebug((current) => (current ? { ...current, missing: true } : current));
  }, [debug, reference]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'd' && event.key !== 'D') return;
      if (event.target instanceof HTMLInputElement) return;
      setDebug((current) =>
        current
          ? null
          : {
              image: null,
              opacity: reference ? 0.5 : 0,
              offset: { x: 0, y: 0 },
              rotate: 0,
              zoom: 1,
              layers: {
                fairway: true, rough: false, bunkers: true, water: true, green: true,
                ob: true, paths: true, trees: false, centreline: true, grid: true,
              },
            },
      );
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [reference]);

  // A score means nothing on its own. When a practice round finishes, play a
  // slice of the tour over the same holes, the same pins and the same weather,
  // and say where the round would have stood. In a tournament the leaderboard
  // is already doing this job.
  const benchmark = useMemo(() => {
    if (!session || session.status !== 'roundComplete' || session.mode !== 'practice') return null;
    if (session.holesToPlay.length < 18) return null;
    return benchmarkRound(
      COURSE_BY_ID[session.courseId],
      session.conditions,
      session.round,
      store.universe.golfers,
      roundTotal(session),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.seed]);

  // Space plays the shot, arrows nudge the aim.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!session) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') setDrawer(null);
      if (event.code === 'Space') {
        event.preventDefault();
        if (session.status === 'holeComplete') advanceHole();
        else if (session.status === 'aiming' && session.lie !== 'green') playShot();
      }
      if (session.status !== 'aiming' || session.lie === 'green') return;
      if (event.key === 'ArrowLeft') store.nudge(event.shiftKey ? -10 : -3);
      if (event.key === 'ArrowRight') store.nudge(event.shiftKey ? 10 : 3);
      if (event.key === 'ArrowUp') store.nudgeLength(event.shiftKey ? 10 : 3);
      if (event.key === 'ArrowDown') store.nudgeLength(event.shiftKey ? -10 : -3);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [session, playShot, advanceHole, store]);

  if (!session || !golfer || !hole || !plan) {
    return (
      <div className="screen screen--empty">
        <Panel title="Nothing on the tee">
          <p>Start a practice round from the Courses screen, or play your golfer&apos;s round from the Tournament screen.</p>
        </Panel>
      </div>
    );
  }

  const course = COURSE_BY_ID[session.courseId];
  const toPinYards = dist(session.ball, hole.pin);
  const lie = LIES[session.lie];
  const putting = session.lie === 'green';
  const ledger = allShots(session);
  // `hit` records the stroke before the first frame of ball flight, so the shot
  // in the air is already in `session.shots`. Drawing its line would put a
  // dotted spoiler from the tee to the landing on screen before the ball gets
  // there, which is exactly what there is to watch.
  const shotLines = session.shots
    .slice(0, session.status === 'animating' ? -1 : undefined)
    .map((shot) => ({ from: shot.from, to: shot.to }));
  const par = hole.spec.par;
  const holeToPar = session.strokesThisHole > 0 ? session.strokesThisHole - par : 0;

  return (
    <div className={`play ${drawer ? `play--drawer play--drawer-${drawer}` : ''}`}>
      {drawer && <button type="button" className="play__scrim" aria-label="Close" onClick={() => setDrawer(null)} />}
      <aside className="play__left">
        <GolferCard golfer={golfer} course={course} onOpen={() => openProfile(golfer.id)} />
        <HoleCard hole={hole} session={session} />
        <Scorecard session={session} />
        <Panel title="Conditions" className="panel--tight">
          <WindDial weather={session.conditions.weather} bearing={plan.kind === 'swing' ? plan.plan.bearing : hole.spec.bearing} />
          <div className="stat-row stat-row--compact">
            <Stat label="Weather" value={session.conditions.weather.label} hint={describeWeather(session.conditions.weather)} />
            <Stat label="Greens" value={`${session.conditions.weather.greenSpeed.toFixed(1)} stimp`} hint={`firmness ${Math.round(session.conditions.weather.greenFirmness)}`} />
            <Stat label="Fairways" value={`${session.conditions.weather.firmness.toFixed(2)}× roll`} hint={session.conditions.weather.rain > 0.3 ? 'soft and slow' : 'running'} />
          </div>
        </Panel>
      </aside>

      <main className="play__centre">
        <div className="play__status">
          <div>
            <span className="play__hole">Hole {hole.spec.number}</span>
            <span className="play__par">Par {par}</span>
            <span className="play__stroke">
              {session.strokesThisHole === 0 ? 'On the tee' : `Playing ${ordinalStroke(session.strokesThisHole + 1)}`}
            </span>
          </div>
          <div className="play__lie">
            <strong>{lie.name}</strong>
            <span>{putting ? `${Math.round(toPinYards * 3)} ft to the hole` : `${yards(toPinYards)} to the pin`}</span>
          </div>
          <div className={`play__score ${toParClass(roundToPar(session))}`}>
            {toPar(roundToPar(session))} <small>thru {holesPlayed(session)}</small>
          </div>
        </div>

        <CourseView
          hole={hole}
          ball={session.ball}
          target={session.target}
          plan={plan.kind === 'swing' ? plan.plan : null}
          putt={plan.kind === 'putt' ? plan.decision.read : null}
          shotLines={shotLines}
          animation={session.animation}
          onAnimationDone={completeAnimation}
          onAim={aim}
          interactive={session.status === 'aiming' && plan.kind === 'swing'}
          puttingView={putting}
          debug={debug}
          windFrom={session.conditions.weather.windFrom}
          windSpeed={session.conditions.weather.windSpeed}
          showZones={zones}
          showDispersion={plan.kind === 'swing'}
        >
          {session.status !== 'roundComplete' && (
            <Hud
              session={session}
              golfer={golfer}
              hole={hole}
              putt={
                plan.kind === 'putt'
                  ? {
                      decision: plan.decision,
                      recommended: choosePuttIntent(sessionContext(session, golfer), session.situation, plan.decision).intent,
                      onChoose: playPutt,
                    }
                  : null
              }
              onSwing={playShot}
              onPickClub={pickClub}
              onPickShotType={pickShotType}
              onCaddie={caddieLine}
              onDrawer={(side) => setDrawer((current) => (current === side ? null : side))}
            />
          )}
        </CourseView>

        {session.status === 'holeComplete' && (
          <div className="play__interstitial">
            <h3>
              {scoreName(holeToPar)} at the {hole.spec.number}
            </h3>
            <p>
              {session.strokesThisHole} strokes, {session.puttsThisHole} putt{session.puttsThisHole === 1 ? '' : 's'}.
              {' '}Round: {toPar(roundToPar(session))} thru {holesPlayed(session)}.
            </p>
            <button type="button" className="hit" onClick={advanceHole}>
              Next hole <span className="hit__hint">space</span>
            </button>
          </div>
        )}

        {debug && hole && (
          <DebugPanel hole={hole} debug={debug} onChange={setDebug} onClose={() => setDebug(null)} />
        )}

        {session.status === 'roundComplete' && (
          <div className="play__interstitial">
            <h3>Round complete — {toPar(roundToPar(session))}</h3>
            <p>
              {session.stats.birdies + session.stats.eagles} birdies or better, {session.stats.bogeys} bogeys,
              {' '}{session.stats.putts} putts, {session.stats.girHit}/{session.stats.girAttempts} greens.
            </p>
            {benchmark && (
              <p className="hint">
                {benchmark.sample} of the tour played the same holes in the same weather today: they averaged{' '}
                <strong>{benchmark.average.toFixed(1)}</strong>, the best of them shot{' '}
                <strong>{benchmark.best}</strong>. Your round would have been{' '}
                <strong>{benchmark.position === 1 ? 'the low round' : `${ordinal(benchmark.position)} of ${benchmark.sample + 1}`}</strong>.
              </p>
            )}
            <button type="button" className="hit" onClick={finishSessionRound}>
              {session.mode === 'tournament' ? 'Post the score and play the field' : 'Back to the clubhouse'}
            </button>
          </div>
        )}

        {/*
          * The round's ledger. Every shot, in order, kept across holes and kept
          * across a reload — which is the whole point of it existing, so it is
          * worth being able to look at rather than only trusting.
          */}
        <details className="roundcard">
          <summary>
            Round card — {ledger.length} shot{ledger.length === 1 ? '' : 's'} played and saved
          </summary>
          <ol className="roundcard__list">
            {[...ledger].reverse().map((shot, index) => (
              <li key={`${shot.hole}-${shot.stroke}-${index}`}>
                <span className="roundcard__hole">{shot.hole}</span>
                <span className="roundcard__stroke">{shot.stroke}</span>
                <span className="roundcard__club">{shot.shotType === 'putt' ? 'Putter' : shot.club}</span>
                <span className="roundcard__result">{shot.quality}</span>
                <span className="roundcard__lie">{shot.holed ? 'in the hole' : LIES[shot.lieAfter].short}</span>
              </li>
            ))}
            {ledger.length === 0 && <li className="roundcard__empty">Nothing played yet.</li>}
          </ol>
        </details>

        <div className="play__log">
          {session.log.length === 0 ? (
            <p className="empty">
              {putting
                ? 'Read the green, pick a strategy, and let him putt it.'
                : 'Click the course to aim, pick a club, and hit it.'}
            </p>
          ) : (
            [...session.log].reverse().slice(0, 6).map((line, index) => (
              <p key={`${line}-${index}`} className={index === 0 ? 'latest' : ''}>
                {line}
              </p>
            ))
          )}
        </div>
      </main>

      <aside className="play__right">
        {plan.kind === 'putt' ? (
          <PuttPanel
            decision={plan.decision}
            golfer={golfer}
            holeNumber={hole.spec.number}
            recommended={
              choosePuttIntent(sessionContext(session, golfer), session.situation, plan.decision).intent
            }
            onChoose={playPutt}
            disabled={session.status !== 'aiming'}
          />
        ) : (
          <ShotControls session={session} golfer={golfer} plan={plan.plan} />
        )}
        {/*
          * Leaving is not quitting. Every shot is already in the save file, so
          * walking away and coming back puts the ball exactly where it finished —
          * and the wording says so, because a button labelled "leave" that
          * silently binned a 3-under round would be worse than the exploit it is
          * here to close.
          */}
        <button type="button" className="ghost ghost--wide" onClick={leaveSession}>
          Save and leave — the round resumes where it is
        </button>
        {session.mode === 'practice' ? (
          <button type="button" className="ghost ghost--wide" onClick={abandonSession}>
            Abandon this practice round
          </button>
        ) : (
          session.status !== 'roundComplete' && (
            <button
              type="button"
              className="ghost ghost--wide"
              onClick={() => {
                if (window.confirm('Let the caddie play the rest of the round? The holes you have played already stand.')) {
                  simulateRestOfSessionRound();
                }
              }}
            >
              Let the caddie finish the round
            </button>
          )
        )}
      </aside>
    </div>
  );
}

function ordinalStroke(n: number): string {
  const names = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return `${names[n] ?? `${n}th`} shot`;
}
