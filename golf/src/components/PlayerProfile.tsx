/**
 * The full picture of one golfer: who they are, what they are good at, what the
 * courses make of them, and what their career says.
 */

import { ARCHETYPES, RATING_GROUPS, RATING_LABELS, formLabel, bagFor, scoringAverage } from '../simulation/golferEngine';
import { courseFit, fitVerdict } from '../simulation/courseFit';
import { COURSES } from '../data/courses';
import { RadarChart } from './RadarChart';
import { Bar, Panel, RatingChip, Stat, money, ordinal, pct } from './ui';
import { useStore } from '../state/store';
import type { Golfer } from '../simulation/types';

export function PlayerProfile({ golfer }: { golfer: Golfer }): JSX.Element {
  const { openProfile, userGolfer, chooseUserGolfer } = useStore();
  const career = golfer.career;
  const bag = bagFor(golfer);
  const rounds = Math.max(1, career.rounds);
  const isUser = userGolfer?.id === golfer.id;

  return (
    <div className="profile-overlay" role="dialog" aria-label={`${golfer.name} profile`}>
      <div className="profile">
        <header className="profile__head">
          <div>
            <span className="flag flag--large">{golfer.flag}</span>
            <div>
              <h2>{golfer.name}</h2>
              <p>
                {golfer.country} · {golfer.age} · turned pro {golfer.turnedPro} · {ARCHETYPES[golfer.archetype].name}
              </p>
            </div>
          </div>
          <div className="profile__head-right">
            {!isUser && (
              <button type="button" className="ghost" onClick={() => chooseUserGolfer(golfer.id)}>
                Play as {golfer.name.split(' ')[0]}
              </button>
            )}
            {isUser && <span className="badge">Your golfer</span>}
            <button type="button" className="ghost" onClick={() => openProfile(null)}>
              Close
            </button>
          </div>
        </header>

        <div className="profile__grid">
          <Panel title="Standing" className="panel--tight">
            <div className="stat-row">
              <Stat label="World rank" value={ordinal(golfer.worldRank)} hint={`${golfer.rankingPoints.toFixed(1)} pts`} />
              <Stat label="Current ability" value={golfer.hidden.currentAbility} />
              <Stat label="Potential" value={Math.round(golfer.hidden.potential)} hint={golfer.hidden.potential - golfer.hidden.currentAbility > 3 ? 'room to grow' : 'close to it'} />
              <Stat label="Form" value={formLabel(golfer.hidden.form)} hint={`${golfer.hidden.form >= 0 ? '+' : ''}${golfer.hidden.form.toFixed(1)}`} />
            </div>
            <div className="stat-row">
              <Stat label="Career wins" value={career.wins} hint={`${career.majors} major${career.majors === 1 ? '' : 's'}`} />
              <Stat label="Career earnings" value={money(career.earnings)} />
              <Stat label="Events" value={career.events} hint={`${pct(career.cutsMade / Math.max(1, career.events), 0)} cuts made`} />
              <Stat label="Best finish" value={career.bestFinishRank ? ordinal(career.bestFinishRank) : '—'} />
            </div>
          </Panel>

          <Panel title="Shape of his game" className="panel--tight">
            <div className="profile__radar">
              <RadarChart golfer={golfer} />
            </div>
          </Panel>

          <Panel title="The player" className="panel--tight">
            <dl className="described">
              <dt>Personality</dt>
              <dd>{golfer.personality}</dd>
              <dt>Playing style</dt>
              <dd>{golfer.playingStyle}</dd>
              <dt>Preferred conditions</dt>
              <dd>{golfer.preferredConditions}</dd>
              <dt>Weakness</dt>
              <dd>{golfer.weakness}</dd>
            </dl>
          </Panel>

          <Panel title="Career statistics" className="panel--tight">
            <div className="stat-grid">
              <Stat label="Scoring average" value={career.rounds ? scoringAverage(golfer).toFixed(2) : '—'} />
              <Stat label="Driving distance" value={career.drives ? `${(career.driveDistanceTotal / career.drives).toFixed(1)} yd` : '—'} />
              <Stat label="Driving accuracy" value={career.fairwayAttempts ? pct(career.fairwaysHit / career.fairwayAttempts) : '—'} />
              <Stat label="Greens in regulation" value={career.greenAttempts ? pct(career.greensHit / career.greenAttempts) : '—'} />
              <Stat label="Scrambling" value={career.scrambleAttempts ? pct(career.scrambleSaves / career.scrambleAttempts) : '—'} />
              <Stat label="Putts per round" value={career.puttHoles ? ((career.putts / career.puttHoles) * 18).toFixed(2) : '—'} />
              <Stat label="Birdie rate" value={career.holes ? pct(career.birdies / career.holes) : '—'} />
              <Stat label="Bogey rate" value={career.holes ? pct(career.bogeys / career.holes) : '—'} />
              <Stat label="Eagles" value={career.eagles} hint={`${career.doubles} doubles or worse`} />
              <Stat label="Rounds" value={rounds} />
            </div>
          </Panel>

          <Panel title="Course fit" className="panel--tight">
            {COURSES.map((course) => {
              const fit = courseFit(golfer, course);
              return (
                <div className="fit-row" key={course.id}>
                  <span className="fit-row__name">{course.name}</span>
                  <Bar value={fit.score} />
                  <span className="fit-row__score">{fit.score}</span>
                  <em className="fit-row__verdict">{fitVerdict(fit)}</em>
                </div>
              );
            })}
            <p className="hint">
              Course fit is a readout of the engine, not an input to it: a wind specialist scores better on the links
              because his dispersion really is tighter in a crosswind.
            </p>
          </Panel>

          <Panel title="Yardages" className="panel--tight">
            <div className="bag">
              {Object.values(bag)
                .filter((entry) => entry.club.id !== 'P')
                .map((entry) => (
                  <div className="bag__club" key={entry.club.id}>
                    <span>{entry.club.short}</span>
                    <strong>{Math.round(entry.total)}</strong>
                    <em>{Math.round(entry.carry)} carry</em>
                  </div>
                ))}
            </div>
          </Panel>

          <Panel title="Every rating" className="panel--wide panel--tight">
            <div className="ratings-groups">
              {RATING_GROUPS.map((group) => (
                <div key={group.id} className="ratings-groups__group">
                  <h4>{group.name}</h4>
                  {group.keys.map((key) => (
                    <div className="rating-line" key={key}>
                      <span>{RATING_LABELS[key]}</span>
                      <Bar value={golfer.ratings[key]} />
                      <RatingChip value={golfer.ratings[key]} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="ratings-groups__group">
                <h4>Hidden</h4>
                <div className="rating-line"><span>Current ability</span><Bar value={golfer.hidden.currentAbility} /><RatingChip value={golfer.hidden.currentAbility} /></div>
                <div className="rating-line"><span>Potential</span><Bar value={golfer.hidden.potential} /><RatingChip value={golfer.hidden.potential} /></div>
                <div className="rating-line"><span>Confidence</span><Bar value={golfer.hidden.confidence} /><RatingChip value={golfer.hidden.confidence} /></div>
                <div className="rating-line"><span>Adaptability</span><Bar value={golfer.hidden.adaptability} /><RatingChip value={golfer.hidden.adaptability} /></div>
                <div className="rating-line"><span>Injury risk</span><Bar value={golfer.hidden.injuryRisk} tone="#c9605a" /><RatingChip value={golfer.hidden.injuryRisk} /></div>
              </div>
            </div>
          </Panel>

          {golfer.history.length > 0 && (
            <Panel title="Season by season" className="panel--wide panel--tight">
              <table className="history">
                <thead>
                  <tr>
                    <th>Season</th><th>Events</th><th>Wins</th><th>Top 10s</th><th>Cuts</th><th>Avg</th><th>Points</th><th>Earnings</th><th>Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {golfer.history.map((record) => (
                    <tr key={record.season}>
                      <td>{record.season}</td>
                      <td>{record.events}</td>
                      <td>{record.wins}</td>
                      <td>{record.top10s}</td>
                      <td>{record.cutsMade}</td>
                      <td>{record.scoringAverage ? record.scoringAverage.toFixed(2) : '—'}</td>
                      <td>{Math.round(record.points)}</td>
                      <td>{money(record.earnings)}</td>
                      <td>{record.rank ? ordinal(record.rank) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
