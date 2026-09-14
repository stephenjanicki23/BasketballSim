/** The three venues: identity, hole-by-hole card, difficulty and who they suit. */

import { useState } from 'react';
import { COURSES, COURSE_BY_ID } from '../data/courses';
import { COURSE_STYLES } from '../data/courseStyles';
import { courseFit, fitVerdict } from '../simulation/courseFit';
import { Bar, Panel, Stat, pct } from '../components/ui';
import { useStore } from '../state/store';

export function CoursesScreen(): JSX.Element {
  const { universe, revision, startPractice, openProfile } = useStore();
  const [selected, setSelected] = useState(COURSES[0].id);
  const [hole, setHole] = useState<number | null>(null);
  const course = COURSE_BY_ID[selected];
  const style = COURSE_STYLES[course.style];

  const suited = [...universe.golfers]
    .map((golfer) => ({ golfer, fit: courseFit(golfer, course) }))
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, 6);
  const mismatched = [...universe.golfers]
    .map((golfer) => ({ golfer, fit: courseFit(golfer, course) }))
    .sort((a, b) => a.fit.edge - b.fit.edge)
    .slice(0, 4);
  void revision;

  return (
    <div className="screen courses">
      <div className="chip-row">
        {COURSES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={option.id === selected ? 'chip-button chip-button--active' : 'chip-button'}
            onClick={() => {
              setSelected(option.id);
              setHole(null);
            }}
          >
            {option.name}
          </button>
        ))}
      </div>

      <Panel
        title={course.name}
        right={
          <div className="button-row button-row--tight">
            <button type="button" className="hit hit--small" onClick={() => startPractice(course.id, hole)}>
              {hole ? `Play hole ${hole}` : 'Play a practice round'}
            </button>
          </div>
        }
      >
        <p className="lede">{course.blurb}</p>
        <div className="stat-row">
          <Stat label="Par" value={course.par} />
          <Stat label="Length" value={`${course.yards.toLocaleString()} yd`} />
          <Stat label="Difficulty" value={`${course.difficulty}/100`} />
          <Stat label="Typical wind" value={`${style.baseWind} mph`} hint={`${style.baseTemp}°F`} />
          <Stat label="Green speed" value={style.greenSpeed.toFixed(1)} hint={`firmness ${style.greenFirmness}`} />
          <Stat label="Fairway roll" value={`${style.firmness.toFixed(2)}×`} hint={`rough severity ${style.roughSeverity.toFixed(2)}×`} />
        </div>
        <ul className="identity">
          {course.identity.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Panel>

      <div className="courses__split">
        <Panel title="Card">
          <table className="card-table">
            <thead>
              <tr>
                <th>Hole</th>
                <th>Name</th>
                <th>Par</th>
                <th>Yards</th>
                <th>SI</th>
                <th>Elev.</th>
                <th>Fairway</th>
                <th>Green</th>
                <th>Hazards</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {course.holes.map((spec) => (
                <tr key={spec.number} className={hole === spec.number ? 'highlight' : ''}>
                  <td>{spec.number}</td>
                  <td className="muted">{spec.name}</td>
                  <td>{spec.par}</td>
                  <td>{spec.yards}</td>
                  <td>{spec.index}</td>
                  <td>{spec.elevation.green >= 0 ? `+${spec.elevation.green}` : spec.elevation.green} ft</td>
                  <td>{Math.round(spec.fairwayWidth * 2)} yd</td>
                  <td>{Math.round(spec.greenSize * 2)} yd</td>
                  <td className="muted">
                    {spec.bunkers.length} bunker{spec.bunkers.length === 1 ? '' : 's'}
                    {spec.water.length > 0 && `, water`}
                    {spec.waste && spec.waste.length > 0 && `, waste`}
                    {spec.trees > 0.5 && `, trees`}
                  </td>
                  <td>
                    <button type="button" className="ghost ghost--small" onClick={() => setHole(spec.number)}>
                      Select
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hole && <p className="hint">{course.holes[hole - 1].strategy}</p>}
        </Panel>

        <div className="courses__side">
          <Panel title="What it asks for" className="panel--tight">
            {Object.entries(course.fit)
              .sort((a, b) => b[1] - a[1])
              .map(([key, weight]) => (
                <div className="fit-row" key={key}>
                  <span className="fit-row__name">{FIT_LABELS[key] ?? key}</span>
                  <Bar value={weight * 100} tone="#7ec7a0" />
                  <span className="fit-row__score">{pct(weight, 0)}</span>
                </div>
              ))}
          </Panel>

          <Panel title="Best suited" className="panel--tight">
            {suited.map(({ golfer, fit }) => (
              <button type="button" className="suited" key={golfer.id} onClick={() => openProfile(golfer.id)}>
                <span className="flag">{golfer.flag}</span>
                <span className="suited__name">{golfer.name}</span>
                <strong>{fit.score}</strong>
                <em>{fitVerdict(fit)}</em>
              </button>
            ))}
          </Panel>

          <Panel title="Wrong course for them" className="panel--tight">
            {mismatched.map(({ golfer, fit }) => (
              <button type="button" className="suited" key={golfer.id} onClick={() => openProfile(golfer.id)}>
                <span className="flag">{golfer.flag}</span>
                <span className="suited__name">{golfer.name}</span>
                <strong>{fit.score}</strong>
                <em>{fit.edge.toFixed(0)}</em>
              </button>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

const FIT_LABELS: Record<string, string> = {
  distance: 'Length off the tee',
  accuracy: 'Driving accuracy',
  rough: 'Play from the rough',
  wind: 'Wind play',
  greens: 'Putting and green play',
  water: 'Avoiding disaster',
  elevation: 'Judging elevation',
  strategy: 'Course management',
  heat: 'Heat endurance',
  rain: 'Wet conditions',
};
