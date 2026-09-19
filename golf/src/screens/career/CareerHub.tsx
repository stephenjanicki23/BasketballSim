/**
 * The career dashboard: who you are now, and how far there is to go.
 *
 * The one thing this screen is for is making the *shape* of a career legible — not
 * just the numbers, but the distance between each number and its ceiling, and how
 * much of that distance has been covered. A golfer four seasons in should be able
 * to see at a glance that their putting is nearly done and their driving never
 * will be.
 */

import { Empty, Panel, RatingChip, Stat, money, ordinal } from '../../components/ui';
import { SkillBar, shapeOf, TOUR_LOWER_DECILE, TOUR_UPPER_QUARTILE } from '../../components/SkillBar';
import { RadarChart } from '../../components/RadarChart';
import {
  CREATION, SKILL_LINES, careerArchetype, costToCap, effectiveLines, lineCaps,
  type SkillLineId,
} from '../../career';
import { PUTTING_STYLES, currentAbility, scoringAverage } from '../../simulation/golferEngine';
import { useStore } from '../../state/store';

const SECTIONS = [...new Set(SKILL_LINES.map((line) => line.section))];
const LINE_NAMES = Object.fromEntries(SKILL_LINES.map((line) => [line.id, line.name]));

export function CareerHub(): JSX.Element {
  const { career: careerState, universe, setScreen } = useStore();
  const career = careerState.career!;
  const golfer = universe.golfers.find((entry) => entry.id === career.golferId);
  const archetype = careerArchetype(career.archetype);
  const caps = lineCaps(career.archetype);
  const effective = effectiveLines(career);
  const shape = shapeOf(effective, LINE_NAMES);

  /** How much of the archetype's available room this golfer has actually used. */
  const roomUsed = (() => {
    let bought = 0;
    let available = 0;
    for (const line of SKILL_LINES) {
      bought += career.lines[line.id] - career.startingLines[line.id];
      available += caps[line.id] - career.startingLines[line.id];
    }
    return available > 0 ? bought / available : 0;
  })();

  const arc = careerArc(career.careerSeason, roomUsed);

  return (
    <div className="screen career">
      <Panel
        title={career.displayName}
        right={<span className="badge">{arc}</span>}
      >
        <div className="career__identity">
          <span className="flag flag--large">{career.flag}</span>
          <div>
            <p className="lede">
              {archetype.name} · {PUTTING_STYLES[career.puttingStyle].name} · age {career.age} ·{' '}
              season {career.careerSeason} of the career
            </p>
            <p className="hint">{archetype.plan}</p>
          </div>
        </div>

        <div className="stat-row">
          <Stat label="Ability" value={golfer ? <RatingChip value={currentAbility(golfer)} /> : '—'} hint={`ceiling around ${golfer ? Math.round(golfer.hidden.potential) : '—'}`} />
          <Stat label="World ranking" value={golfer?.worldRank ? ordinal(golfer.worldRank) : '—'} />
          <Stat label="XP available" value={career.availableXp.toLocaleString()} hint={`${career.experience.toLocaleString()} earned in all`} />
          <Stat label="Career wins" value={golfer?.career.wins ?? 0} hint={`${golfer?.career.majors ?? 0} majors`} />
          <Stat label="Events" value={golfer?.career.events ?? 0} hint={`${golfer?.career.cutsMade ?? 0} cuts made`} />
          <Stat label="Earnings" value={money(golfer?.career.earnings ?? 0)} />
          <Stat label="Scoring average" value={golfer && golfer.career.rounds ? scoringAverage(golfer).toFixed(2) : '—'} />
          <Stat label="Potential used" value={`${Math.round(roomUsed * 100)}%`} hint="of the room this archetype allows" />
        </div>

        <dl className="review__shape">
          <dt>Strengths</dt>
          <dd>{shape.strengths.join(', ') || '—'}</dd>
          <dt>Development areas</dt>
          <dd>{shape.development.join(', ') || '—'}</dd>
          <dt>Measured</dt>
          <dd className="hint">
            {shape.absolute
              ? `Against the tour: a strength is top-quartile (${TOUR_UPPER_QUARTILE}+) and a development area is in its bottom tenth (${TOUR_LOWER_DECILE} or below).`
              : 'Against your own game — nothing is yet top-quartile on tour or below its bottom tenth, which is what a new professional looks like.'}
          </dd>
        </dl>
      </Panel>

      <div className="career__split">
        <div className="career__main">
          <Panel title="Your game, and how far it can go">
            <p className="lede">
              The solid bar is where you are. The faint bar beyond it is the room your archetype still allows, and
              the tick is where it stops for good.
            </p>
            {SECTIONS.map((section) => (
              <div key={section} className="skillgroup">
                <h3>{section}</h3>
                {SKILL_LINES.filter((line) => line.section === section).map((line) => (
                  <SkillBar
                    key={line.id}
                    name={line.name}
                    value={effective[line.id]}
                    cap={caps[line.id]}
                    from={career.startingLines[line.id]}
                    hint={
                      effective[line.id] >= caps[line.id]
                        ? 'At its ceiling. This is as good as it gets.'
                        : `${(costToCap(career.archetype, career.lines, line.id)).toLocaleString()} XP from here to the ceiling.`
                    }
                  />
                ))}
              </div>
            ))}
          </Panel>

          <Panel title="Season by season">
            {career.seasons.length === 0 ? (
              <Empty>Play a season and it will appear here.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Season</th><th>Age</th><th>Events</th><th>Cuts</th><th>Wins</th>
                    <th>Top 10</th><th>Scoring</th><th>Earnings</th><th>Standings</th><th>XP</th><th>Ability</th>
                  </tr>
                </thead>
                <tbody>
                  {career.seasons.map((season) => (
                    <tr key={season.season}>
                      <td>{season.season}</td>
                      <td>{season.age}</td>
                      <td>{season.events}</td>
                      <td>{season.cutsMade}</td>
                      <td>{season.wins}</td>
                      <td>{season.top10s}</td>
                      <td>{season.scoringAverage ? season.scoringAverage.toFixed(2) : '—'}</td>
                      <td>{money(season.earnings)}</td>
                      <td>{season.standingsRank ? ordinal(season.standingsRank) : '—'}</td>
                      <td>{season.xpEarned.toLocaleString()}</td>
                      <td>
                        {season.abilityBefore || '—'}
                        {season.abilityAfter ? ` → ${season.abilityAfter}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <aside className="career__side">
          <Panel title="Shape">
            {golfer && <RadarChart golfer={golfer} size={230} />}
            <div className="button-row button-row--tight">
              <button type="button" className="hit hit--wide" onClick={() => setScreen('home')}>Back to the clubhouse</button>
            </div>
          </Panel>

          <Panel title="Every point you have bought">
            {career.history.length === 0 ? (
              <p className="hint">Nothing yet. XP is spent in the offseason.</p>
            ) : (
              <ul className="progress-log">
                {[...career.history].reverse().slice(0, 40).map((step, index) => (
                  <li key={`${step.season}:${step.line}:${step.from}:${index}`}>
                    <span>{LINE_NAMES[step.line as SkillLineId]}</span>
                    <em>{step.from} → {step.to}</em>
                    <b>{step.xp.toLocaleString()} XP</b>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Account">
            <p className="hint">
              Signed in as <strong>{careerState.account?.displayName}</strong>. {careerState.backendLabel}.
            </p>
            <div className="button-row button-row--tight">
              <button type="button" className="ghost" onClick={() => void careerState.logOut()}>Sign out</button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (window.confirm(`Delete ${career.displayName} and everything they have done? This cannot be undone.`)) {
                    void careerState.startOver();
                  }
                }}
              >
                Delete this golfer
              </button>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/**
 * Where a career is, in words.
 *
 * Derived from two things rather than one: how many seasons have been played, and
 * how much of the archetype's room has been used. A golfer eight seasons in who has
 * bought almost nothing is not in their prime, and saying so is more useful than
 * counting birthdays.
 */
function careerArc(careerSeason: number, roomUsed: number): string {
  if (careerSeason <= 1) return 'Rookie';
  if (careerSeason <= 3) return roomUsed > 0.35 ? 'Early career, developing fast' : 'Early career';
  if (roomUsed >= 0.8) return 'Prime — very little left to buy';
  if (roomUsed >= 0.5) return careerSeason >= 9 ? 'Established veteran' : 'Prime';
  if (careerSeason >= 9) return 'Veteran, still plenty untapped';
  return 'Established player';
}

/** Exported for the hub's header on other screens. */
export const STARTING_AGE = CREATION.startingAge;
