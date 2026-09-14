/** The clubhouse: this week, the leaderboard, the rankings and the wire. */

import { Leaderboard } from '../components/Leaderboard';
import { Empty, Panel, Stat, money, ordinal, toPar } from '../components/ui';
import { useCurrentTournament, useGolferIndex, useStore } from '../state/store';
import { COURSE_BY_ID } from '../data/courses';
import { describeWeather } from '../simulation/weatherEngine';
import { pointsStandings, seasonComplete, worldRanking } from '../simulation/seasonEngine';
import { courseFit, fitVerdict } from '../simulation/courseFit';
import { ROUNDS } from '../simulation/tournamentEngine';

export function HomeScreen(): JSX.Element {
  const store = useStore();
  const { universe, userGolfer, setScreen, openProfile, simulateRound, simulateEvent, simulateRestOfSeason, rollSeason, startTournamentRound } = store;
  const tournament = useCurrentTournament();
  const golfers = useGolferIndex();
  const finished = seasonComplete(universe);
  const points = pointsStandings(universe).slice(0, 10);
  const ranking = worldRanking(universe).slice(0, 10);
  const news = universe.news.slice(0, 5);

  return (
    <div className="screen home">
      <div className="home__main">
        {finished || !tournament ? (
          <Panel title={`${universe.season} season complete`}>
            <p>
              Every event has been played. {points[0] && <>The Player of the Year is <strong>{points[0].name}</strong>.</>} Roll the
              calendar on to develop the field, retire the ones who are done, and bring up next year&apos;s graduates.
            </p>
            <button type="button" className="hit" onClick={rollSeason}>
              Start the {universe.season + 1} season
            </button>
          </Panel>
        ) : (
          <Panel
            title={tournament.name}
            right={<span className="badge">{tournament.tier === 'major' ? 'Major' : tournament.tier === 'invitational' ? 'Invitational' : `Week ${tournament.week}`}</span>}
          >
            <p className="lede">{tournament.blurb}</p>
            <div className="stat-row">
              <Stat label="Course" value={COURSE_BY_ID[tournament.courseId].name} hint={`par ${COURSE_BY_ID[tournament.courseId].par} · ${COURSE_BY_ID[tournament.courseId].yards.toLocaleString()} yd`} />
              <Stat label="Purse" value={money(tournament.purse)} />
              <Stat label="Field" value={`${tournament.field.length} players`} hint="low 65 and ties make the cut" />
              <Stat
                label={tournament.roundsPlayed === 0 ? 'Round 1 forecast' : `Round ${Math.min(ROUNDS, tournament.roundsPlayed + 1)} forecast`}
                value={describeWeather(tournament.weather[Math.min(ROUNDS - 1, tournament.roundsPlayed)])}
              />
            </div>

            {userGolfer && (
              <div className="home__you">
                <span>
                  <strong>{userGolfer.flag} {userGolfer.name}</strong> — course fit{' '}
                  {courseFit(userGolfer, COURSE_BY_ID[tournament.courseId]).score}/100,{' '}
                  {fitVerdict(courseFit(userGolfer, COURSE_BY_ID[tournament.courseId])).toLowerCase()}
                </span>
                {tournament.roundsPlayed < ROUNDS && (
                  <button type="button" className="hit hit--small" onClick={startTournamentRound}>
                    Play round {tournament.roundsPlayed + 1}
                  </button>
                )}
              </div>
            )}

            <div className="button-row">
              <button type="button" onClick={simulateRound} disabled={tournament.roundsPlayed >= ROUNDS}>
                Simulate round {Math.min(ROUNDS, tournament.roundsPlayed + 1)}
              </button>
              <button type="button" onClick={simulateEvent}>Simulate the whole event</button>
              <button type="button" onClick={simulateRestOfSeason}>Simulate the rest of the season</button>
              <button type="button" className="ghost" onClick={() => setScreen('tournament')}>Open the tournament</button>
            </div>

            {tournament.recaps.filter(Boolean).length > 0 && (
              <ul className="recaps">
                {tournament.recaps.filter(Boolean).map((recap, index) => (
                  <li key={index}>{recap}</li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {tournament && tournament.leaderboard.length > 0 && (
          <Panel title="Leaderboard" right={<button type="button" className="ghost" onClick={() => setScreen('tournament')}>Full board</button>}>
            <Leaderboard tournament={tournament} golfers={golfers} highlightId={userGolfer?.id} onSelect={openProfile} limit={10} />
          </Panel>
        )}

        <Panel title="News" right={<button type="button" className="ghost" onClick={() => setScreen('news')}>All stories</button>}>
          {news.length === 0 ? (
            <Empty>Nothing on the wire yet. Play an event.</Empty>
          ) : (
            <ul className="news-list">
              {news.map((item) => (
                <li key={item.id}>
                  <h4>{item.headline}</h4>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <aside className="home__side">
        <Panel title="Points standings" className="panel--tight">
          <ol className="ranking">
            {points.map((golfer, index) => (
              <li key={golfer.id} className={golfer.id === userGolfer?.id ? 'highlight' : ''}>
                <span className="ranking__pos">{index + 1}</span>
                <button type="button" className="ranking__name" onClick={() => openProfile(golfer.id)}>
                  <span className="flag">{golfer.flag}</span> {golfer.name}
                </button>
                <span className="ranking__value">{Math.round(golfer.season.points)}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="World ranking" className="panel--tight">
          <ol className="ranking">
            {ranking.map((golfer) => (
              <li key={golfer.id} className={golfer.id === userGolfer?.id ? 'highlight' : ''}>
                <span className="ranking__pos">{ordinal(golfer.worldRank)}</span>
                <button type="button" className="ranking__name" onClick={() => openProfile(golfer.id)}>
                  <span className="flag">{golfer.flag}</span> {golfer.name}
                </button>
                <span className="ranking__value">{golfer.rankingPoints.toFixed(0)}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Schedule" className="panel--tight">
          <ul className="schedule">
            {universe.schedule.map((event, index) => (
              <li key={event.id} className={index === universe.eventIndex ? 'current' : event.status === 'complete' ? 'done' : ''}>
                <span className="schedule__week">W{event.week}</span>
                <span className="schedule__name">
                  {event.name}
                  {event.tier === 'major' && <em> · major</em>}
                </span>
                <span className="schedule__result">
                  {event.status === 'complete' && event.winnerId
                    ? `${golfers.get(event.winnerId)?.name ?? ''} ${toPar(event.leaderboard[0]?.toPar ?? 0)}`
                    : COURSE_BY_ID[event.courseId].name.split(' ')[0]}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  );
}
