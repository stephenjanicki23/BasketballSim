/**
 * One skill line, as a bar with its ceiling marked on it.
 *
 * The ceiling is the whole point of the component, and the reason a plain
 * progress bar will not do. "Short Game 68" says very little; "Short Game 68, and
 * it can reach 91" says what this golfer is going to become, and putting the two
 * on one track is what makes the archetype choice mean something at a glance.
 *
 * Three regions, drawn back to front: the track, the headroom between here and the
 * ceiling, and the value itself. The ceiling gets a tick, because a shaded region
 * that fades out does not tell you where it stops.
 */

import { ratingColour } from './ui';

/** The scale the bars are drawn on. Nobody on tour is below 50, so neither is the axis. */
const FLOOR = 50;
const ROOF = 100;

const position = (value: number): number =>
  Math.max(0, Math.min(100, ((value - FLOOR) / (ROOF - FLOOR)) * 100));

export function SkillBar({
  name,
  value,
  cap,
  /** Where the line started, drawn as a faint mark so progress is visible. */
  from,
  /** A pending change, e.g. +2 being bought this offseason. */
  pending = 0,
  hint,
  onChange,
  min,
  max,
}: {
  name: string;
  value: number;
  cap: number;
  from?: number;
  pending?: number;
  hint?: string;
  /** Present when the bar is an input rather than a readout. */
  onChange?: (next: number) => void;
  min?: number;
  max?: number;
}): JSX.Element {
  const shown = value + pending;
  const atCap = shown >= cap;
  const interactive = onChange !== undefined && min !== undefined && max !== undefined;

  return (
    <div className={`skillbar${atCap ? ' skillbar--maxed' : ''}`}>
      <div className="skillbar__head">
        <span className="skillbar__name">{name}</span>
        <span className="skillbar__numbers">
          <strong style={{ color: ratingColour(shown) }}>{shown}</strong>
          {pending !== 0 && <em className="skillbar__pending">{pending > 0 ? `+${pending}` : pending}</em>}
          <span className="skillbar__cap">{atCap ? 'at ceiling' : `→ ${cap}`}</span>
        </span>
      </div>

      <div className="skillbar__track">
        {/* What is still available under the ceiling. */}
        <span
          className="skillbar__headroom"
          style={{ left: `${position(shown)}%`, width: `${Math.max(0, position(cap) - position(shown))}%` }}
        />
        <span
          className="skillbar__fill"
          style={{ width: `${position(shown)}%`, background: ratingColour(shown) }}
        />
        {pending !== 0 && (
          <span
            className="skillbar__delta"
            style={{
              left: `${position(Math.min(value, shown))}%`,
              width: `${Math.abs(position(shown) - position(value))}%`,
            }}
          />
        )}
        <span className="skillbar__ceiling" style={{ left: `${position(cap)}%` }} aria-hidden="true" />
        {from !== undefined && from !== shown && (
          <span className="skillbar__origin" style={{ left: `${position(from)}%` }} aria-hidden="true" />
        )}

        {interactive && (
          <input
            className="skillbar__input"
            type="range"
            min={min}
            max={max}
            value={value}
            aria-label={`${name}, ${value}, ceiling ${cap}`}
            onChange={(event) => onChange?.(Number(event.target.value))}
          />
        )}
      </div>

      {hint && <p className="skillbar__hint">{hint}</p>}
    </div>
  );
}

/**
 * A short verdict on a golfer's shape: what they are good at and what they are not,
 * measured against the tour rather than against the scale.
 *
 * The thresholds come from the field: the median rating on tour is 77 and the
 * tenth percentile is 60, so "strength" means top quartile and "development area"
 * means genuinely below the players they are competing with — not merely below 50,
 * which nobody on tour is.
 */
export const TOUR_MEDIAN = 77;
export const TOUR_UPPER_QUARTILE = 85;
export const TOUR_LOWER_DECILE = 66;

export function shapeOf(lines: Record<string, number>, names: Record<string, string>): {
  strengths: string[];
  development: string[];
  /** True when the lists are measured against the tour rather than against each other. */
  absolute: boolean;
} {
  const rows = Object.entries(lines)
    .map(([id, value]) => ({ name: names[id] ?? id, value }))
    .sort((a, b) => b.value - a.value);

  const strengths = rows.filter((row) => row.value >= TOUR_UPPER_QUARTILE);
  const development = [...rows].reverse().filter((row) => row.value <= TOUR_LOWER_DECILE);

  // A fresh golfer usually has neither — everything sits between the tour's
  // bottom tenth and its top quartile, which is exactly what "competitive but not
  // elite" looks like. Saying "nothing yet" twice is true and useless, so fall
  // back to their own best and worst, and let the caller say which it is showing.
  if (strengths.length === 0 && development.length === 0) {
    return {
      strengths: rows.slice(0, 3).map((row) => row.name),
      development: [...rows].reverse().slice(0, 3).map((row) => row.name),
      absolute: false,
    };
  }
  return {
    strengths: strengths.map((row) => row.name),
    development: development.map((row) => row.name),
    absolute: true,
  };
}
