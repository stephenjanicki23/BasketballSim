/** All fifty golfers, sortable and filterable. */

import { useMemo, useState } from 'react';
import { ARCHETYPES, RATING_GROUPS, formLabel, groupScores, scoringAverage } from '../simulation/golferEngine';
import { Panel, RatingChip, money, ordinal, pct } from '../components/ui';
import { useStore } from '../state/store';
import type { Golfer } from '../simulation/types';

type SortKey = 'rank' | 'ability' | 'potential' | 'age' | 'form' | 'driving' | 'approach' | 'shortGame' | 'putting' | 'points' | 'earnings' | 'scoring';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rank', label: 'World rank' },
  { key: 'ability', label: 'Ability' },
  { key: 'potential', label: 'Potential' },
  { key: 'form', label: 'Form' },
  { key: 'age', label: 'Age' },
  { key: 'driving', label: 'Driving' },
  { key: 'approach', label: 'Approach' },
  { key: 'shortGame', label: 'Short game' },
  { key: 'putting', label: 'Putting' },
  { key: 'points', label: 'Season points' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'scoring', label: 'Scoring average' },
];

export function PlayersScreen(): JSX.Element {
  const { universe, revision, openProfile, userGolfer, chooseUserGolfer } = useStore();
  const [sort, setSort] = useState<SortKey>('rank');
  const [query, setQuery] = useState('');
  const [archetype, setArchetype] = useState<string>('all');
  const [maxAge, setMaxAge] = useState(50);

  const rows = useMemo(() => {
    const value = (golfer: Golfer): number => {
      const groups = groupScores(golfer);
      switch (sort) {
        case 'rank': return -golfer.worldRank;
        case 'ability': return golfer.hidden.currentAbility;
        case 'potential': return golfer.hidden.potential;
        case 'form': return golfer.hidden.form;
        case 'age': return -golfer.age;
        case 'driving': return groups.driving;
        case 'approach': return groups.approach;
        case 'shortGame': return groups.shortGame;
        case 'putting': return groups.putting;
        case 'points': return golfer.season.points;
        case 'earnings': return golfer.season.earnings;
        case 'scoring': return golfer.career.rounds ? -scoringAverage(golfer) : -999;
        default: return 0;
      }
    };
    return universe.golfers
      .filter((golfer) => (archetype === 'all' || golfer.archetype === archetype))
      .filter((golfer) => golfer.age <= maxAge)
      .filter((golfer) =>
        query.trim() === '' ||
        golfer.name.toLowerCase().includes(query.toLowerCase()) ||
        golfer.country.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => value(b) - value(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, revision, sort, query, archetype, maxAge]);

  return (
    <div className="screen">
      <Panel
        title={`Tour players (${rows.length})`}
        right={
          <div className="filters">
            <input type="search" placeholder="Search name or country" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
              <option value="all">All archetypes</option>
              {Object.values(ARCHETYPES).map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
            <label className="filters__age">
              Age ≤ {maxAge}
              <input type="range" min={20} max={50} value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))} />
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>Sort: {option.label}</option>
              ))}
            </select>
          </div>
        }
      >
        <table className="players">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Age</th>
              <th>Archetype</th>
              {RATING_GROUPS.filter((g) => g.id !== 'physical').map((group) => (
                <th key={group.id}>{group.name}</th>
              ))}
              <th>Ability</th>
              <th>Pot.</th>
              <th>Form</th>
              <th>Pts</th>
              <th>Earnings</th>
              <th>Avg</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((golfer) => {
              const groups = groupScores(golfer);
              return (
                <tr key={golfer.id} className={golfer.id === userGolfer?.id ? 'highlight' : ''}>
                  <td>{ordinal(golfer.worldRank)}</td>
                  <td className="player">
                    <button type="button" onClick={() => openProfile(golfer.id)}>
                      <span className="flag">{golfer.flag}</span> {golfer.name}
                    </button>
                  </td>
                  <td>{golfer.age}</td>
                  <td className="muted">{ARCHETYPES[golfer.archetype].name}</td>
                  {RATING_GROUPS.filter((g) => g.id !== 'physical').map((group) => (
                    <td key={group.id}><RatingChip value={groups[group.id]} /></td>
                  ))}
                  <td><RatingChip value={golfer.hidden.currentAbility} /></td>
                  <td className="muted">{Math.round(golfer.hidden.potential)}</td>
                  <td className={golfer.hidden.form >= 1 ? 'under' : golfer.hidden.form <= -1 ? 'over' : ''}>{formLabel(golfer.hidden.form)}</td>
                  <td>{golfer.season.points ? Math.round(golfer.season.points) : '—'}</td>
                  <td>{golfer.season.earnings ? money(golfer.season.earnings) : '—'}</td>
                  <td>{golfer.career.rounds ? scoringAverage(golfer).toFixed(2) : '—'}</td>
                  <td>
                    {golfer.id === userGolfer?.id ? (
                      <span className="badge badge--small">You</span>
                    ) : (
                      <button type="button" className="ghost ghost--small" onClick={() => chooseUserGolfer(golfer.id)}>
                        Play as
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint">
          Cuts made across the field: {pct(
            universe.golfers.reduce((sum, g) => sum + g.career.cutsMade, 0) /
              Math.max(1, universe.golfers.reduce((sum, g) => sum + g.career.events, 0)),
            0,
          )}
        </p>
      </Panel>
    </div>
  );
}
