/**
 * Registering and signing in.
 *
 * Two things this screen is careful about. It says out loud where the account is
 * being stored — `backendLabel` is either "this browser" or "the server at …" —
 * because a player who thinks their career is on a server when it is in their
 * browser has been misled by omission. And it never invents a reason a sign-in
 * failed: the problems shown are the ones the backend returned, which is the same
 * list whether the check ran locally or over the wire.
 */

import { useState } from 'react';

import { Panel } from '../../components/ui';
import { CREDENTIALS } from '../../account';
import { useStore } from '../../state/store';

export function AccountGate(): JSX.Element {
  const { career } = useStore();
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const busy = career.authBusy !== null;
  const problemFor = (field: string) => career.problems.find((entry) => entry.field === field)?.message;
  const general = career.problems.filter((entry) => !['username', 'password', 'displayName', 'email'].includes(entry.field));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'register') await career.register({ username, password, displayName, email });
    else await career.logIn({ username, password });
  };

  return (
    <div className="screen career">
      <div className="career__gate">
        <Panel title={mode === 'register' ? 'Start a career' : 'Sign back in'}>
          <p className="lede">
            {mode === 'register'
              ? 'Create an account, build a golfer, and play their career a season at a time. Your golfer, your statistics and your progression are kept against the account and are there when you come back.'
              : 'Pick your career back up exactly where you left it.'}
          </p>

          <form className="form" onSubmit={submit}>
            <label className="form__field">
              <span>Username</span>
              <input
                name="username"
                id="golf-username"
                value={username}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={CREDENTIALS.usernameMaxLength}
                onChange={(event) => setUsername(event.target.value)}
                aria-invalid={problemFor('username') !== undefined}
              />
              {problemFor('username') && <em className="form__error">{problemFor('username')}</em>}
            </label>

            <label className="form__field">
              <span>Password</span>
              <input
                name="password"
                id="golf-password"
                type="password"
                value={password}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                maxLength={CREDENTIALS.passwordMaxLength}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={problemFor('password') !== undefined}
              />
              {problemFor('password')
                ? <em className="form__error">{problemFor('password')}</em>
                : mode === 'register' && <em className="form__hint">At least {CREDENTIALS.passwordMinLength} characters. Stored as a PBKDF2 hash, never as text.</em>}
            </label>

            {mode === 'register' && (
              <>
                <label className="form__field">
                  <span>Display name <em>optional</em></span>
                  <input
                    name="displayName"
                    id="golf-display-name"
                    value={displayName}
                    maxLength={CREDENTIALS.displayNameMaxLength}
                    placeholder={username || 'What other people see'}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                  {problemFor('displayName') && <em className="form__error">{problemFor('displayName')}</em>}
                </label>
                <label className="form__field">
                  <span>Email <em>optional</em></span>
                  <input
                    name="email"
                    id="golf-email"
                    type="email"
                    value={email}
                    autoComplete="email"
                    placeholder="Only used to tell accounts apart"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  {problemFor('email') && <em className="form__error">{problemFor('email')}</em>}
                </label>
              </>
            )}

            {general.length > 0 && (
              <div className="form__errors" role="alert">
                {general.map((entry) => <p key={`${entry.field}:${entry.message}`}>{entry.message}</p>)}
              </div>
            )}

            <div className="button-row">
              <button type="submit" className="hit" disabled={busy}>
                {career.authBusy ?? (mode === 'register' ? 'Create the account' : 'Sign in')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'register' ? 'login' : 'register');
                  career.clearProblems();
                }}
              >
                {mode === 'register' ? 'I already have an account' : 'I need an account'}
              </button>
            </div>
          </form>

          <p className="career__storage">
            <strong>{career.backendLabel}.</strong>{' '}
            {career.backendKind === 'local'
              ? 'Accounts on this build live in this browser, so a career made here will not appear on another device — and a friend on their own machine gets their own accounts, not a shared one. Run the server in /server and set VITE_GOLF_API to share careers across devices and have every rule checked somewhere a player cannot reach.'
              : 'Every rule — the point budget, the archetype ceilings, the XP arithmetic — is enforced on the server, so what the browser sends is only ever a request.'}
          </p>
        </Panel>
      </div>
    </div>
  );
}
