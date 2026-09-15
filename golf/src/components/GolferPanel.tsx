/** Who is playing, how they are, and what is in front of them. */

import { RATING_GROUPS, effectiveFatigue, formLabel, groupScores } from '../simulation/golferEngine';
import { ARCHETYPES } from '../simulation/golferEngine';
import { courseFit, fitVerdict } from '../simulation/courseFit';
import { COURSE_BY_ID } from '../data/courses';
import { Bar, Panel, RatingChip, Stat, toPar, toParClass, ordinal } from './ui';
import { holesPlayed, roundToPar, type PlaySession } from '../game/session';
import type { Course, Golfer, HoleGeometry } from '../simulation/types';

export function GolferCard({
  golfer,
  course,
  onOpen,
}: {
  golfer: Golfer;
  course?: Course;
  onOpen?: () => void;
}): JSX.Element {
  const groups = groupScores(golfer);
  const fit = course ? courseFit(golfer, course) : null;
  const fatigue = effectiveFatigue(golfer);
  return (
    <Panel className="panel--tight">
      <div className="golfer-card">
        <button type="button" className="golfer-card__head" onClick={onOpen} disabled={!onOpen}>
          <span className="flag">{golfer.flag}</span>
          <span>
            <strong>{golfer.name}</strong>
            <small>
              {ARCHETYPES[golfer.archetype].name} · {golfer.age} · {ordinal(golfer.worldRank)} in the world
            </small>
          </span>
          <RatingChip value={golfer.hidden.currentAbility} />
        </button>
        <div className="stat-row stat-row--compact">
          <Stat label="Form" value={formLabel(golfer.hidden.form)} hint={`${golfer.hidden.form >= 0 ? '+' : ''}${golfer.hidden.form.toFixed(1)}`} />
          <Stat label="Confidence" value={Math.round(golfer.hidden.confidence)} />
          <Stat label="Fatigue" value={`${Math.round(fatigue)}%`} tone={fatigue > 60 ? 'warn' : undefined} />
        </div>
        {fit && (
          <div className="fit">
            <span className="label">Course fit</span>
            <strong>{fit.score}/100</strong>
            <em>{fitVerdict(fit)}</em>
          </div>
        )}
        <div className="group-bars">
          {RATING_GROUPS.filter((g) => g.id !== 'physical').map((group) => (
            <div key={group.id} className="group-bars__row">
              <span>{group.name}</span>
              <Bar value={groups[group.id]} />
              <em>{groups[group.id]}</em>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function HoleCard({ hole, session }: { hole: HoleGeometry; session: PlaySession }): JSX.Element {
  const course = COURSE_BY_ID[session.courseId];
  return (
    <Panel className="panel--tight">
      <div className="hole-card">
        <div className="hole-card__head">
          <span className="hole-card__number">{hole.spec.number}</span>
          <span>
            <strong>{hole.spec.name}</strong>
            <small>
              Par {hole.spec.par} · {hole.spec.yards} yards · stroke index {hole.spec.index}
            </small>
          </span>
        </div>
        <p className="hole-card__strategy">{hole.spec.strategy}</p>
        {/* Where this hole's shape came from. On a real course that is worth
            saying out loud: a hole traced off the club's own overhead is the
            hole, and a hole built from its card is the right length, the right
            par and the right corner, but its shape is somebody's reading. */}
        {course.real && (
          <p className={`hole-card__source ${hole.spec.centreline ? 'is-traced' : ''}`}>
            {hole.spec.centreline
              ? 'Traced from the club’s overhead'
              : 'Shaped from the card — not yet traced'}
          </p>
        )}
        <div className="stat-row stat-row--compact">
          <Stat label="Green" value={`${Math.round(hole.spec.greenSize * 2)} yd across`} hint={`slope ${Math.hypot(hole.spec.greenSlope.x, hole.spec.greenSlope.y).toFixed(1)}%`} />
          <Stat
            label="Tee to green"
            value={`${hole.spec.elevation.green >= 0 ? '+' : ''}${hole.spec.elevation.green} ft`}
          />
          <Stat label="Course" value={course.name} hint={session.mode === 'tournament' ? `Round ${session.round}` : 'Practice'} />
        </div>
      </div>
    </Panel>
  );
}

export function Scorecard({ session }: { session: PlaySession }): JSX.Element {
  const course = COURSE_BY_ID[session.courseId];
  const holes = course.holes;
  const front = holes.slice(0, 9);
  const back = holes.slice(9);
  const sum = (list: typeof holes) =>
    list.reduce((total, hole) => total + (session.holeScores[hole.number - 1] ?? 0), 0);

  const row = (list: typeof holes, label: string) => (
    <>
      <tr>
        <th>{label}</th>
        {list.map((hole) => (
          <td key={hole.number} className="scorecard__hole">
            {hole.number}
          </td>
        ))}
        <td className="scorecard__total">{label === 'Out' ? 'Out' : 'In'}</td>
      </tr>
      <tr className="scorecard__par">
        <th>Par</th>
        {list.map((hole) => (
          <td key={hole.number}>{hole.par}</td>
        ))}
        <td>{list.reduce((t, h) => t + h.par, 0)}</td>
      </tr>
      <tr>
        <th>Score</th>
        {list.map((hole) => {
          const score = session.holeScores[hole.number - 1];
          const delta = score === null || score === undefined ? null : score - hole.par;
          return (
            <td
              key={hole.number}
              className={
                delta === null
                  ? hole.number === session.holeNumber
                    ? 'scorecard__current'
                    : ''
                  : `scorecard__score ${delta < 0 ? 'under' : delta > 0 ? 'over' : 'level'}`
              }
            >
              {score ?? (hole.number === session.holeNumber ? '•' : '')}
            </td>
          );
        })}
        <td className="scorecard__total">{sum(list) || ''}</td>
      </tr>
    </>
  );

  const played = holesPlayed(session);
  const relative = roundToPar(session);

  return (
    <Panel
      title="Card"
      className="panel--tight"
      right={
        <span className={`card-total ${toParClass(relative)}`}>
          {toPar(relative)} thru {played}
        </span>
      }
    >
      <table className="scorecard">
        <tbody>
          {row(front, 'Out')}
          {row(back, 'In')}
        </tbody>
      </table>
    </Panel>
  );
}
