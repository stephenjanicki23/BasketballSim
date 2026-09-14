/** The leaderboard, and the tee sheet that goes with it. */

import { COURSE_BY_ID } from '../data/courses';
import { teeTimeLabel, type Tournament } from '../simulation/tournamentEngine';
import { money, toPar, toParClass } from './ui';
import type { Golfer } from '../simulation/types';

export function Leaderboard({
  tournament,
  golfers,
  highlightId,
  onSelect,
  limit,
}: {
  tournament: Tournament;
  golfers: Map<string, Golfer>;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
  limit?: number;
}): JSX.Element {
  const course = COURSE_BY_ID[tournament.courseId];
  const rows = limit ? tournament.leaderboard.slice(0, limit) : tournament.leaderboard;
  const complete = tournament.status === 'complete';

  if (rows.length === 0) {
    return <p className="empty">No scores yet — this event has not started.</p>;
  }

  return (
    <table className="leaderboard">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Player</th>
          <th>R1</th>
          <th>R2</th>
          <th>R3</th>
          <th>R4</th>
          <th>Total</th>
          <th>Score</th>
          {complete && <th>Money</th>}
          {complete && <th>Pts</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const golfer = golfers.get(row.golferId);
          if (!golfer) return null;
          return (
            <tr
              key={row.golferId}
              className={[
                row.golferId === highlightId ? 'highlight' : '',
                row.status === 'cut' ? 'cut' : '',
              ].join(' ').trim()}
              onClick={onSelect ? () => onSelect(row.golferId) : undefined}
            >
              <td className="pos">{row.label}</td>
              <td className="player">
                <span className="flag">{golfer.flag}</span> {golfer.name}
              </td>
              {row.rounds.map((score, index) => (
                <td key={index} className="round">
                  {score ?? '—'}
                </td>
              ))}
              <td className="total">{row.total || '—'}</td>
              <td className={`score ${toParClass(row.toPar)}`}>{row.thru > 0 ? toPar(row.toPar) : '—'}</td>
              {complete && <td className="money">{row.money > 0 ? money(row.money) : '—'}</td>}
              {complete && <td className="points">{row.points > 0 ? Math.round(row.points) : '—'}</td>}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={complete ? 10 : 8}>
            {course.name} · par {course.par} · {course.yards.toLocaleString()} yards
            {tournament.cutLine !== null ? ` · cut ${toPar(tournament.cutLine)} (${tournament.madeCut.length} players)` : ''}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

export function TeeSheet({ tournament, golfers, round }: { tournament: Tournament; golfers: Map<string, Golfer>; round: number }): JSX.Element {
  const sheet = tournament.teeTimes[round - 1];
  if (!sheet || sheet.groups.length === 0) {
    return <p className="empty">Tee times for round {round} are not out yet.</p>;
  }
  return (
    <div className="tee-sheet">
      {sheet.groups.map((group, index) => (
        <div className="tee-sheet__group" key={index}>
          <span className="tee-sheet__time">{teeTimeLabel(index, round)}</span>
          <span className="tee-sheet__players">
            {group
              .map((id) => golfers.get(id))
              .filter((g): g is Golfer => !!g)
              .map((g) => `${g.flag} ${g.name}`)
              .join(' · ')}
          </span>
        </div>
      ))}
    </div>
  );
}
