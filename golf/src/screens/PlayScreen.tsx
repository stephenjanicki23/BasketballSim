/**
 * The playable screen: course in the middle, the golfer and the card on the
 * left, the shot on the right, and a running commentary underneath.
 */

import { useEffect, useMemo } from 'react';
import { CourseView } from '../components/CourseView';
import { ShotControls } from '../components/ShotControls';
import { PuttPanel } from '../components/PuttPanel';
import { GolferCard, HoleCard, Scorecard } from '../components/GolferPanel';
import { WindDial } from '../components/WindDial';
import { Panel, Stat, toPar, toParClass, yards } from '../components/ui';
import { useStore } from '../state/store';
import { COURSE_BY_ID } from '../data/courses';
import { LIES } from '../simulation/config';
import { currentPlan, holesPlayed, roundToPar, scoreName, sessionHole } from '../game/session';
import { choosePuttIntent } from '../simulation/puttingEngine';
import { sessionContext } from '../game/session';
import { describeWeather } from '../simulation/weatherEngine';
import { dist } from '../simulation/geometry';

export function PlayScreen(): JSX.Element {
  const store = useStore();
  const {
    session, golfer: lookup, zones, playShot, playPutt, completeAnimation, advanceHole,
    finishSessionRound, abandonSession, aim, openProfile,
  } = store;

  const golfer = session ? lookup(session.golferId) : undefined;

  const plan = useMemo(() => (session && golfer ? currentPlan(session, golfer) : null), [session, golfer]);
  const hole = useMemo(() => (session ? sessionHole(session) : null), [session]);

  // Space plays the shot, arrows nudge the aim.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!session) return;
      if (event.target instanceof HTMLInputElement) return;
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
  const par = hole.spec.par;
  const holeToPar = session.strokesThisHole > 0 ? session.strokesThisHole - par : 0;

  return (
    <div className="play">
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
          shotLines={session.shots.map((shot) => ({ from: shot.from, to: shot.to }))}
          animation={session.animation}
          onAnimationDone={completeAnimation}
          onAim={aim}
          interactive={session.status === 'aiming' && plan.kind === 'swing'}
          puttingView={putting}
          windFrom={session.conditions.weather.windFrom}
          windSpeed={session.conditions.weather.windSpeed}
          showZones={zones}
          showDispersion={plan.kind === 'swing'}
        />

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

        {session.status === 'roundComplete' && (
          <div className="play__interstitial">
            <h3>Round complete — {toPar(roundToPar(session))}</h3>
            <p>
              {session.stats.birdies + session.stats.eagles} birdies or better, {session.stats.bogeys} bogeys,
              {' '}{session.stats.putts} putts, {session.stats.girHit}/{session.stats.girAttempts} greens.
            </p>
            <button type="button" className="hit" onClick={finishSessionRound}>
              {session.mode === 'tournament' ? 'Post the score and play the field' : 'Back to the clubhouse'}
            </button>
          </div>
        )}

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
        <button type="button" className="ghost ghost--wide" onClick={abandonSession}>
          Leave the round
        </button>
      </aside>
    </div>
  );
}

function ordinalStroke(n: number): string {
  const names = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return `${names[n] ?? `${n}th`} shot`;
}
