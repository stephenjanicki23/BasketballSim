/**
 * A radar of the seven rating groups.
 *
 * Drawn as an SVG rather than a canvas so it scales with the page and can be
 * read by a screen reader through its title. The shape is the point: a spike on
 * Putting and a dent on Driving says more about a golfer than an overall rating.
 */

import { RATING_GROUPS, groupScores } from '../simulation/golferEngine';
import type { Golfer } from '../simulation/types';

export function RadarChart({ golfer, size = 260 }: { golfer: Golfer; size?: number }): JSX.Element {
  const groups = groupScores(golfer);
  const axes = RATING_GROUPS;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 34;
  const min = 35;

  const point = (index: number, value: number) => {
    const angle = (index / axes.length) * Math.PI * 2 - Math.PI / 2;
    const scaled = Math.max(0, (value - min) / (100 - min));
    return {
      x: cx + Math.cos(angle) * radius * scaled,
      y: cy + Math.sin(angle) * radius * scaled,
    };
  };

  const outline = axes.map((axis, index) => point(index, groups[axis.id]));
  const polygon = outline.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg className="radar" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={axes.map((a) => `${a.name} ${groups[a.id]}`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          className="radar__ring"
          points={axes
            .map((_, index) => {
              const angle = (index / axes.length) * Math.PI * 2 - Math.PI / 2;
              return `${(cx + Math.cos(angle) * radius * ring).toFixed(1)},${(cy + Math.sin(angle) * radius * ring).toFixed(1)}`;
            })
            .join(' ')}
        />
      ))}
      {axes.map((axis, index) => {
        const angle = (index / axes.length) * Math.PI * 2 - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (radius + 18);
        const ly = cy + Math.sin(angle) * (radius + 18);
        return (
          <g key={axis.id}>
            <line x1={cx} y1={cy} x2={cx + Math.cos(angle) * radius} y2={cy + Math.sin(angle) * radius} className="radar__axis" />
            <text x={lx} y={ly} className="radar__label" textAnchor={Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end'}>
              {axis.name}
            </text>
            <text x={lx} y={ly + 11} className="radar__value" textAnchor={Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end'}>
              {groups[axis.id]}
            </text>
          </g>
        );
      })}
      <polygon className="radar__shape" points={polygon} />
      {outline.map((p, index) => (
        <circle key={index} cx={p.x} cy={p.y} r={3} className="radar__point" />
      ))}
    </svg>
  );
}
