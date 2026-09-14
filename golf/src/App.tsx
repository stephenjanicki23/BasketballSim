/** Shell: navigation, the busy indicator, and the profile overlay. */

import { HomeScreen } from './screens/HomeScreen';
import { PlayScreen } from './screens/PlayScreen';
import { TournamentScreen } from './screens/TournamentScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { CoursesScreen } from './screens/CoursesScreen';
import { StatsScreen } from './screens/StatsScreen';
import { NewsScreen } from './screens/NewsScreen';
import { PlayerProfile } from './components/PlayerProfile';
import { useCurrentTournament, useStore, type ScreenId } from './state/store';
import { COURSE_BY_ID } from './data/courses';
import { ordinal } from './components/ui';

const NAV: { id: ScreenId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'players', label: 'Players' },
  { id: 'courses', label: 'Courses' },
  { id: 'stats', label: 'Statistics' },
  { id: 'news', label: 'News' },
];

export function App(): JSX.Element {
  const store = useStore();
  const { screen, setScreen, universe, session, busy, message, dismissMessage, profileId, golfer, userGolfer, openProfile, resetUniverse, saveNow } = store;
  const tournament = useCurrentTournament();
  const profile = profileId ? golfer(profileId) : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark">⛳</span>
          <div>
            <strong>Golf Universe</strong>
            <small>
              {universe.season} season · {tournament ? `${tournament.name}, ${COURSE_BY_ID[tournament.courseId].name}` : 'season complete'}
            </small>
          </div>
        </div>
        <nav className="topbar__nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={screen === item.id ? 'active' : ''}
              onClick={() => setScreen(item.id)}
            >
              {item.label}
              {item.id === 'play' && session && <span className="dot" />}
            </button>
          ))}
        </nav>
        <div className="topbar__right">
          {userGolfer ? (
            <button type="button" className="topbar__you" onClick={() => openProfile(userGolfer.id)}>
              <span className="flag">{userGolfer.flag}</span>
              <span>
                <strong>{userGolfer.name}</strong>
                <small>{ordinal(userGolfer.worldRank)} in the world</small>
              </span>
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => setScreen('players')}>
              Choose a golfer
            </button>
          )}
          <button type="button" className="ghost ghost--small" onClick={saveNow} title="Save to browser storage">Save</button>
          <button
            type="button"
            className="ghost ghost--small"
            onClick={() => {
              if (window.confirm('Start a brand new universe? The current save will be lost.')) resetUniverse();
            }}
          >
            New
          </button>
        </div>
      </header>

      {!userGolfer && screen !== 'players' && (
        <div className="banner">
          Pick a golfer to control and you can play their tournament rounds shot by shot. Until then, everything simulates.
          <button type="button" className="ghost ghost--small" onClick={() => setScreen('players')}>
            Open the player list
          </button>
        </div>
      )}

      <main className="content">
        {screen === 'home' && <HomeScreen />}
        {screen === 'play' && <PlayScreen />}
        {screen === 'tournament' && <TournamentScreen />}
        {screen === 'players' && <PlayersScreen />}
        {screen === 'courses' && <CoursesScreen />}
        {screen === 'stats' && <StatsScreen />}
        {screen === 'news' && <NewsScreen />}
      </main>

      {busy && (
        <div className="busy" role="status">
          <div className="busy__box">
            <div className="busy__spinner" />
            <p>{busy}</p>
          </div>
        </div>
      )}

      {message && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button type="button" onClick={dismissMessage}>Dismiss</button>
        </div>
      )}

      {profile && <PlayerProfile golfer={profile} />}
    </div>
  );
}
