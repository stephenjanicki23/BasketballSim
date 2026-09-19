/** Shell: navigation, the busy indicator, and the profile overlay. */

import { useEffect, useRef, useState } from 'react';

import { HomeScreen } from './screens/HomeScreen';
import { PlayScreen } from './screens/PlayScreen';
import { TournamentScreen } from './screens/TournamentScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { CoursesScreen } from './screens/CoursesScreen';
import { StatsScreen } from './screens/StatsScreen';
import { NewsScreen } from './screens/NewsScreen';
import { CareerScreen } from './screens/CareerScreen';
import { PlayerProfile } from './components/PlayerProfile';
import { useCurrentTournament, useStore, type ScreenId } from './state/store';
import { COURSE_BY_ID } from './data/courses';
import { ordinal } from './components/ui';
import { playSfx, setSoundOn, soundOn } from './audio/sfx';
import { storedToken } from './account';

const NAV: { id: ScreenId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'career', label: 'Career' },
  { id: 'play', label: 'Play' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'players', label: 'Players' },
  { id: 'courses', label: 'Courses' },
  { id: 'stats', label: 'Statistics' },
  { id: 'news', label: 'News' },
];

export function App(): JSX.Element {
  const store = useStore();
  const { screen, setScreen, universe, session, busy, message, dismissMessage, profileId, golfer, userGolfer, openProfile, resetUniverse, saveNow, career, offseasonDue } = store;
  const tournament = useCurrentTournament();
  const profile = profileId ? golfer(profileId) : null;
  const [sound, setSound] = useState(soundOn());

  // The offseason is a gate rather than a suggestion: until the XP is dealt with
  // there is no next season to look at, so the career screen takes over.
  useEffect(() => {
    if (offseasonDue && screen !== 'career') setScreen('career');
  }, [offseasonDue, screen, setScreen]);

  /**
   * On a reload with a signed-in account there is a moment before the career's own
   * universe has been fetched, and during it the store is holding the *guest*
   * universe — a different tour, with no created golfer in it. Showing that for a
   * second or two is worse than showing nothing, because it looks exactly like the
   * career has been lost. So cover it.
   */
  const restoring = career.starting && storedToken() !== null;

  // The play screen sizes the course to whatever the chrome leaves behind, and
  // the chrome is not a fixed height: the nav wraps on a phone, the banner comes
  // and goes. Measure it and publish it as a variable rather than guessing.
  const chromeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chromeRef.current;
    if (!element) return;
    const publish = () => document.documentElement.style.setProperty('--chrome-h', `${Math.round(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app">
      <div ref={chromeRef} className="app__chrome">
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
              {item.id === 'career' && (offseasonDue || (career.account && !career.career)) && <span className="dot" />}
            </button>
          ))}
        </nav>
        <div className="topbar__right">
          {userGolfer ? (
            <button type="button" className="topbar__you" onClick={() => openProfile(userGolfer.id)}>
              <span className="flag">{userGolfer.flag}</span>
              <span>
                <strong>{userGolfer.name}</strong>
                <small>
                  {ordinal(userGolfer.worldRank)} in the world
                  {career.career ? ` · ${career.career.availableXp.toLocaleString()} XP` : ''}
                </small>
              </span>
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => setScreen('career')}>
              Create a golfer
            </button>
          )}
          <button
            type="button"
            className="ghost ghost--small"
            aria-pressed={sound}
            title={sound ? 'Sound on — struck balls, splashes, the crowd' : 'Sound off'}
            onClick={() => {
              const next = !sound;
              setSoundOn(next);
              setSound(next);
              // Say so out loud, so the toggle confirms itself.
              if (next) playSfx('putt');
            }}
          >
            {sound ? '🔊' : '🔇'}
          </button>
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

      {offseasonDue && screen === 'career' && (
        <div className="banner banner--urgent">
          The season is over. Spend your XP and start the {universe.season} season.
        </div>
      )}

      {!userGolfer && screen !== 'career' && screen !== 'players' && (
        <div className="banner">
          Create your own golfer and play a career — an archetype, a ceiling, and XP earned a season at a time. Or
          take control of one of the tour&apos;s professionals and play their rounds.
          <button type="button" className="ghost ghost--small" onClick={() => setScreen('career')}>
            Create a golfer
          </button>
          <button type="button" className="ghost ghost--small" onClick={() => setScreen('players')}>
            Open the player list
          </button>
        </div>
      )}

      </div>

      <main className="content">
        {screen === 'home' && <HomeScreen />}
        {screen === 'play' && <PlayScreen />}
        {screen === 'tournament' && <TournamentScreen />}
        {screen === 'players' && <PlayersScreen />}
        {screen === 'courses' && <CoursesScreen />}
        {screen === 'stats' && <StatsScreen />}
        {screen === 'news' && <NewsScreen />}
        {screen === 'career' && <CareerScreen />}
      </main>

      {(busy || restoring) && (
        <div className="busy" role="status">
          <div className="busy__box">
            <div className="busy__spinner" />
            <p>{busy ?? 'Restoring your career…'}</p>
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
