/**
 * The wind, drawn relative to the shot rather than to north.
 *
 * A compass rose is no use over a golf ball: what matters is whether it is into
 * you and which way it is pushing the ball. The needle points the way the wind
 * blows, with the line of play always up.
 */

import { compassName, windComponents } from '../simulation/weatherEngine';
import type { Weather } from '../simulation/types';

export function WindDial({ weather, bearing, size = 96 }: { weather: Weather; bearing: number; size?: number }): JSX.Element {
  const wind = windComponents(weather, bearing);
  // Angle of the wind relative to the line of play, with the line of play up.
  const relative = ((wind.toward - bearing) * Math.PI) / 180;
  const radius = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const tipX = cx + Math.sin(relative) * radius;
  const tipY = cy - Math.cos(relative) * -radius;
  const strength = Math.min(1, weather.windSpeed / 30);

  return (
    <div className="wind-dial">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Wind ${wind.label}`}>
        <circle cx={cx} cy={cy} r={radius} className="wind-dial__ring" />
        <line x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} className="wind-dial__axis" />
        <polygon points={`${cx},${cy - radius - 5} ${cx - 4},${cy - radius + 3} ${cx + 4},${cy - radius + 3}`} className="wind-dial__play" />
        <line
          x1={cx - Math.sin(relative) * radius * 0.85}
          y1={cy + Math.cos(relative) * -radius * -0.85}
          x2={tipX}
          y2={tipY}
          className="wind-dial__needle"
          style={{ strokeWidth: 2 + strength * 3 }}
        />
        <circle cx={tipX} cy={tipY} r={3.5 + strength * 2} className="wind-dial__tip" />
        <text x={cx} y={cy + 4} className="wind-dial__speed">
          {Math.round(weather.windSpeed)}
        </text>
      </svg>
      <div className="wind-dial__readout">
        <strong>{wind.label}</strong>
        <span>
          from {compassName(weather.windFrom)} · gusting {Math.round(weather.windSpeed + weather.gust)} mph
        </span>
      </div>
    </div>
  );
}
