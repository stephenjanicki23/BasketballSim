/**
 * Which backend the game is using, and the one place that decides.
 *
 * `VITE_GOLF_API` is the switch. Set it, and accounts live on the Node server in
 * /server, where the rulebook runs somewhere the player cannot reach. Leave it
 * unset — which is the case for the published build, since a static page has no
 * server to talk to — and accounts live in the browser, with the same rules
 * enforced on the player's own machine.
 *
 * Both are real account systems with hashed passwords and persistent careers. The
 * honest difference is the trust boundary, and `backend.label` carries it into the
 * UI so nobody has to guess which one they are in.
 */

import { createHttpBackend } from './httpBackend';
import { createLocalBackend } from './localBackend';
import type { CareerBackend } from './backend';

export * from './backend';
export * from './password';
export { createHttpBackend, createLocalBackend };

/** Where the session token is kept between visits. */
const TOKEN_KEY = 'golf-universe:token';

let cached: CareerBackend | null = null;

/**
 * Where the account server is, if there is one.
 *
 * `VITE_GOLF_API` is the build-time answer. `window.__GOLF_API__` is the run-time
 * one, and it exists because the useful case is a build that has already been made
 * — the published static page — being pointed at somebody's own server without
 * rebuilding it. Setting it is a deliberate act by whoever controls the page, the
 * same as setting the environment variable would be.
 */
function configuredApi(): string {
  const runtime = (globalThis as { __GOLF_API__?: unknown }).__GOLF_API__;
  if (typeof runtime === 'string' && runtime.trim()) return runtime.trim();
  return (import.meta.env?.VITE_GOLF_API ?? '').trim();
}

export function backend(): CareerBackend {
  if (cached) return cached;
  const configured = configuredApi();
  cached = configured ? createHttpBackend(configured) : createLocalBackend();
  return cached;
}

/** For the tests, which need to install a backend of their own. */
export function setBackend(replacement: CareerBackend | null): void {
  cached = replacement;
}

export function storedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A browser with storage switched off can still play a session; it just
    // cannot be resumed, which is the correct consequence rather than an error.
  }
}
