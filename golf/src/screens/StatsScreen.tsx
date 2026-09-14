/** League-wide statistics: the leaderboards nobody televises. */

import { useMemo, useState } from 'react';
import { scoringAverage } from '../simulation/golferEngine';
import { seasonScoringAverage } from '../simulation/seasonEngine';
import { Panel, money, pct } from '../components/ui';
import { useStore } from '../state/store';
import type { Golfer } from '../simulation/types';

interface Category {
  id: string;
  label: string;
  format: (value: number) => string;
  value: (golfer: Golfer) => number;
  /** Lower is better. */
  ascending?: boolean;
  /** Minimum career rounds to qualify. */
  qualify?: number;
}

const CATEGORIES: Category[] = [
  { id: 'scoring', label: 'Scoring average', value: (g) => scoringAverage(g), format: (v) => v.toFixed(2), ascending: true, qualify: 12 },
  { id: 'season', label: 'Season scoring average', value: (g) => seasonScoringAverage(g), format: (v) => v.toFixed(2), ascending: true, qualify: 0 },
  { id: 'distance', label: 'Driving distance', value: (g) => g.career.driveDistanceTotal / Math.max(1, g.career.drives), format: (v) => `${v.toFixed(1)} yd`, qualify: 8 },
  { id: 'accuracy', label: 'Driving accuracy', value: (g) => g.career.fairwaysHit / Math.max(1, g.career.fairwayAttempts), format: (v) => pct(v), qualify: 8 },
  { id: 'gir', label: 'Greens in regulation', value: (g) => g.career.greensHit / Math.max(1, g.career.greenAttempts), format: (v) => pct(v), qualify: 8 },
  { id: 'scrambling', label: 'Scrambling', value: (g) => g.career.scrambleSaves / Math.max(1, g.career.scrambleAttempts), format: (v) => pct(v), qualify: 8 },
  { id: 'putting', label: 'Putts per round', value: (g) => (g.career.putts / Math.max(1, g.career.puttHoles)) * 18, format: (v) => v.toFixed(2), ascending: true, qualify: 8 },
  { id: 'birdies', label: 'Birdie percentage', value: (g) => g.career.birdies / Math.max(1, g.career.holes), format: (v) => pct(v), qualify: 8 },
  { id: 'bogeys', label: 'Bogey avoidance', value: (g) => g.career.bogeys / Math.max(1, g.career.holes), format: (v) => pct(v), ascending: true, qualify: 8 },
  { id: 'earnings', label: 'Season earnings', value: (g) => g.season.earnings, format: money, qualify: 0 },
  { id: 'points', label: 'Season points', value: (g) => g.season.points, format: (v) => Math.round(v).toString(), qualify: 0 },
  { id: 'wins', label: 'Career wins', value: (g) => g.career.wins, format: (v) => v.toString(), qualify: 0 },
];

export function StatsScreen(): JSX.Element {
  const { universe, revision, openProfile } = useStore();
  const [rounds, setRounds] = useState(8);

  const tables = useMemo(() => {
    return CATEGORIES.map((category) => {
      const qualified = universe.golfers.filter(
        (golfer) => golfer.career.rounds >= Math.max(category.qualify ?? 0, category.qualify === 0 ? 0 : rounds),
      );
      const sorted = [...qualified].sort((a, b) =>
        category.ascending ? category.value(a) - category.value(b) : category.value(b) - category.value(a),
      );
      return { category, rows: sorted.slice(0, 8) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, revision, rounds]);

  const fieldAverage = useMemo(() => {
    const rows = universe.golfers.filter((g) => g.career.rounds > 0);
    if (rows.length === 0) return null;
    const sum = (pick: (g: Golfer) => number) => rows.reduce((total, g) => total + pick(g), 0);
    return {
      scoring: sum((g) => g.career.strokes) / sum((g) => g.career.rounds),
      distance: sum((g) => g.career.driveDistanceTotal) / Math.max(1, sum((g) => g.career.drives)),
      accuracy: sum((g) => g.career.fairwaysHit) / Math.max(1, sum((g) => g.career.fairwayAttempts)),
      gir: sum((g) => g.career.greensHit) / Math.max(1, sum((g) => g.career.greenAttempts)),
      scrambling: sum((g) => g.career.scrambleSaves) / Math.max(1, sum((g) => g.career.scrambleAttempts)),
      putts: (sum((g) => g.career.putts) / Math.max(1, sum((g) => g.career.puttHoles))) * 18,
      birdies: sum((g) => g.career.birdies) / Math.max(1, sum((g) => g.career.holes)),
      bogeys: sum((g) => g.career.bogeys) / Math.max(1, sum((g) => g.career.holes)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, revision]);

  return (
    <div className="screen">
      <Panel
        title="Tour averages"
        right={
          <label className="filters__age">
            Minimum {rounds} rounds
            <input type="range" min={0} max={40} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
          </label>
        }
      >
        {fieldAverage ? (
          <div className="stat-row">
            <div className="stat"><span className="stat__label">Scoring</span><span className="stat__value">{fieldAverage.scoring.toFixed(2)}</span></div>
            <div className="stat"><span className="stat__label">Driving distance</span><span className="stat__value">{fieldAverage.distance.toFixed(1)} yd</span></div>
            <div className="stat"><span className="stat__label">Fairways</span><span className="stat__value">{pct(fieldAverage.accuracy)}</span></div>
            <div className="stat"><span className="stat__label">Greens</span><span className="stat__value">{pct(fieldAverage.gir)}</span></div>
            <div className="stat"><span className="stat__label">Scrambling</span><span className="stat__value">{pct(fieldAverage.scrambling)}</span></div>
            <div className="stat"><span className="stat__label">Putts</span><span className="stat__value">{fieldAverage.putts.toFixed(2)}</span></div>
            <div className="stat"><span className="stat__label">Birdies</span><span className="stat__value">{pct(fieldAverage.birdies)}</span></div>
            <div className="stat"><span className="stat__label">Bogeys</span><span className="stat__value">{pct(fieldAverage.bogeys)}</span></div>
          </div>
        ) : (
          <p className="empty">No rounds played yet.</p>
        )}
      </Panel>

      <div className="stats-grid">
        {tables.map(({ category, rows }) => (
          <Panel key={category.id} title={category.label} className="panel--tight">
            <ol className="ranking">
              {rows.map((golfer, index) => (
                <li key={golfer.id}>
                  <span className="ranking__pos">{index + 1}</span>
                  <button type="button" className="ranking__name" onClick={() => openProfile(golfer.id)}>
                    <span className="flag">{golfer.flag}</span> {golfer.name}
                  </button>
                  <span className="ranking__value">{category.format(category.value(golfer))}</span>
                </li>
              ))}
            </ol>
            {rows.length === 0 && <p className="empty">Nobody qualifies yet.</p>}
          </Panel>
        ))}
      </div>
    </div>
  );
}
