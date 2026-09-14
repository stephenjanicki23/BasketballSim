/** This week's event in full: board, tee sheet, round recaps and the weather. */

import { useState } from 'react';
import { Leaderboard, TeeSheet } from '../components/Leaderboard';
import { Empty, Panel, Stat, money, toPar } from '../components/ui';
import { WindDial } from '../components/WindDial';
import { useCurrentTournament, useGolferIndex, useStore } from '../state/store';
import { COURSE_BY_ID } from '../data/courses';
import { describeWeather } from '../simulation/weatherEngine';
import { ROUNDS } from '../simulation/tournamentEngine';
import { seasonComplete } from '../simulation/seasonEngine';

export function TournamentScreen(): JSX.Element {
  const store = useStore();
  const { universe, userGolfer, openProfile, simulateRound, simulateEvent, startTournamentRound, rollSeason } = store;
  const tournament = useCurrentTournament();
  const golfers = useGolferIndex();
  const [tab, setTab] = useState<'board' | 'tee' | 'past'>('board');
  const [pastId, setPastId] = useState<string | null>(null);

  if (!tournament || seasonComplete(universe)) {
    const completed = universe.schedule.filter((t) => t.status === 'complete');
    const selected = completed.find((t) => t.id === pastId) ?? completed[completed.length - 1];
    return (
      <div className="screen">
        <Panel title={`${universe.season} season complete`} right={<button type="button" className="hit hit--small" onClick={rollSeason}>Start {universe.season + 1}</button>}>
          <p>Every event has been played. Look back at any of them below.</p>
          <div className="chip-row">
            {completed.map((event) => (
              <button
                key={event.id}
                type="button"
                className={event.id === selected?.id ? 'chip-button chip-button--active' : 'chip-button'}
                onClick={() => setPastId(event.id)}
              >
                {event.name}
              </button>
            ))}
          </div>
        </Panel>
        {selected && (
          <Panel title={`${selected.name} — final`}>
            <Leaderboard tournament={selected} golfers={golfers} highlightId={userGolfer?.id} onSelect={openProfile} />
          </Panel>
        )}
      </div>
    );
  }

  const course = COURSE_BY_ID[tournament.courseId];
  const round = Math.min(ROUNDS, tournament.roundsPlayed + 1);
  const userRow = userGolfer ? tournament.leaderboard.find((r) => r.golferId === userGolfer.id) : null;
  const userMissedCut = userGolfer ? tournament.cutLine !== null && !tournament.madeCut.includes(userGolfer.id) : false;

  return (
    <div className="screen tournament">
      <Panel
        title={tournament.name}
        right={
          <span className="badge">
            {tournament.status === 'complete' ? 'Final' : tournament.roundsPlayed === 0 ? 'Not started' : `After round ${tournament.roundsPlayed}`}
          </span>
        }
      >
        <div className="stat-row">
          <Stat label="Course" value={course.name} hint={`${course.location} · par ${course.par}`} />
          <Stat label="Purse" value={money(tournament.purse)} hint={tournament.tier === 'major' ? 'Major — double points' : tournament.tier === 'invitational' ? 'Invitational' : 'Full field'} />
          <Stat label="Cut" value={tournament.cutLine === null ? 'After round 2' : toPar(tournament.cutLine)} hint={tournament.cutLine === null ? 'low 65 and ties' : `${tournament.madeCut.length} made it`} />
          <Stat label="Round" value={`${tournament.roundsPlayed} of ${ROUNDS} played`} />
        </div>
        <div className="button-row">
          {userGolfer && tournament.roundsPlayed < ROUNDS && !userMissedCut && (
            <button type="button" className="hit hit--small" onClick={startTournamentRound}>
              Play round {round} as {userGolfer.name.split(' ')[0]}
            </button>
          )}
          <button type="button" onClick={simulateRound} disabled={tournament.roundsPlayed >= ROUNDS}>
            Simulate round {round}
          </button>
          <button type="button" onClick={simulateEvent} disabled={tournament.status === 'complete'}>
            Simulate to the finish
          </button>
        </div>
        {userMissedCut && <p className="hint">You missed the cut. Simulate the weekend to move on to the next event.</p>}
        {userRow && (
          <p className="hint">
            You are {userRow.status === 'cut' ? 'cut' : `${userRow.label}`} on {toPar(userRow.toPar)}
            {userRow.rounds.filter(Boolean).length > 0 && ` (${userRow.rounds.filter(Boolean).join(', ')})`}.
          </p>
        )}
      </Panel>

      <div className="tabs">
        <button type="button" className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')}>Leaderboard</button>
        <button type="button" className={tab === 'tee' ? 'active' : ''} onClick={() => setTab('tee')}>Tee times</button>
        <button type="button" className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>Rounds & weather</button>
      </div>

      {tab === 'board' && (
        <Panel>
          <Leaderboard tournament={tournament} golfers={golfers} highlightId={userGolfer?.id} onSelect={openProfile} />
        </Panel>
      )}

      {tab === 'tee' && (
        <Panel title={`Round ${Math.max(1, tournament.roundsPlayed)} tee sheet`}>
          <TeeSheet tournament={tournament} golfers={golfers} round={Math.max(1, tournament.roundsPlayed)} />
        </Panel>
      )}

      {tab === 'past' && (
        <>
          <Panel title="Round by round">
            {tournament.recaps.filter(Boolean).length === 0 ? (
              <Empty>No rounds played yet.</Empty>
            ) : (
              <ul className="recaps">
                {tournament.recaps.filter(Boolean).map((recap, index) => (
                  <li key={index}>{recap}</li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Forecast">
            <div className="weather-grid">
              {tournament.weather.map((weather, index) => (
                <div className="weather-grid__day" key={index}>
                  <h4>Round {index + 1}</h4>
                  <WindDial weather={weather} bearing={course.holes[0].bearing} size={84} />
                  <p>{describeWeather(weather)}</p>
                  <small>
                    Greens {weather.greenSpeed.toFixed(1)} · firmness {Math.round(weather.greenFirmness)} · roll {weather.firmness.toFixed(2)}×
                  </small>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
