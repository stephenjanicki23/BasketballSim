/** The wire, plus the off-season development report. */

import { Empty, Panel } from '../components/ui';
import { useStore } from '../state/store';

export function NewsScreen(): JSX.Element {
  const { universe, openProfile, revision } = useStore();
  void revision;

  return (
    <div className="screen news">
      <Panel title="News">
        {universe.news.length === 0 ? (
          <Empty>Nothing on the wire yet. Play an event.</Empty>
        ) : (
          <ul className="news-list news-list--full">
            {universe.news.map((item) => (
              <li key={item.id}>
                <span className={`news-kind news-kind--${item.kind}`}>{item.kind}</span>
                <h4>{item.headline}</h4>
                <p>{item.body}</p>
                {item.golferIds.length > 0 && (
                  <div className="news-list__links">
                    {item.golferIds.map((id) => {
                      const golfer = universe.golfers.find((g) => g.id === id);
                      if (!golfer) return null;
                      return (
                        <button type="button" key={id} className="ghost ghost--small" onClick={() => openProfile(id)}>
                          {golfer.flag} {golfer.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {universe.developmentNotes.length > 0 && (
        <Panel title="Off-season development report">
          <ul className="development">
            {universe.developmentNotes.map((note) => (
              <li key={note.golferId} className={note.retired ? 'retired' : note.delta >= 0 ? 'up' : 'down'}>
                <span className="development__delta">{note.delta >= 0 ? `+${note.delta}` : note.delta}</span>
                <div>
                  <strong>{note.headline}</strong>
                  <p>{note.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {universe.pastSeasons.length > 0 && (
        <Panel title="Past seasons">
          <table className="history">
            <thead>
              <tr><th>Season</th><th>Player of the Year</th><th>Money leader</th><th>World number one</th><th>Majors</th></tr>
            </thead>
            <tbody>
              {universe.pastSeasons.map((season) => (
                <tr key={season.season}>
                  <td>{season.season}</td>
                  <td>{season.championName}</td>
                  <td>{universe.golfers.find((g) => g.id === season.moneyLeaderId)?.name ?? '—'}</td>
                  <td>{universe.golfers.find((g) => g.id === season.numberOneId)?.name ?? '—'}</td>
                  <td className="muted">{season.majorWinners.map((m) => `${m.name} (${m.tournament})`).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
