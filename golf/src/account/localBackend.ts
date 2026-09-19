/**
 * Accounts in the browser.
 *
 * This is the backend the game uses when no server is configured, which includes
 * the published build — and so it is the one most people will actually meet. It
 * is a real account system: usernames are unique, passwords are PBKDF2 verifiers
 * and never stored in the clear, sessions are opaque random tokens with an expiry,
 * and every state change goes through the same `/career` rulebook the server runs.
 *
 * What it is not is a *shared* account system. Storage is `localStorage`, so an
 * account exists on the browser that created it and nowhere else: two friends each
 * get their own accounts on their own machines, and neither can see the other's.
 * That is a real limitation and the UI says so rather than implying otherwise.
 *
 * The universe save lives under its own key per career rather than inside this
 * record, because a season of results is about a megabyte and `localStorage` gives
 * you five: keeping them separate means a full universe cannot take the account
 * table down with it when the quota is hit.
 */

import {
  applyEvent, applySeasonEnd, applySpend, careerProblems, closeOffseason, newCareer, validateCreation,
  type Career, type Session,
} from '../career';
import type { CreationRequest, RecordedEvent, SeasonReport, SpendRequest, XpLedger } from '../career';
import {
  hashPassword, needsRehash, normaliseUsername, randomToken, validateCredentials, verifyPassword,
} from './password';
import { problem, type AuthInput, type CareerBackend, type Reply } from './backend';
import type { Account } from '../career';

const KEY = 'golf-universe:accounts';
const UNIVERSE_KEY = (careerId: string) => `golf-universe:save:${careerId}`;
/** The universe played without an account, kept under the original save key. */
const GUEST_SAVE_KEY = 'golf-universe:save';
const STORE_VERSION = 1;

/** A session is good for a fortnight of not opening the game. */
const SESSION_DAYS = 14;

interface StoredAccount extends Account {
  /** A PBKDF2 verifier. Never a password. */
  verifier: string;
}

interface StoredSession {
  token: string;
  accountId: string;
  expiresAt: string;
}

interface Store {
  version: number;
  accounts: Record<string, StoredAccount>;
  /** Normalised username to account id, so a lookup cannot miss on case. */
  byUsername: Record<string, string>;
  careers: Record<string, Career>;
  sessions: Record<string, StoredSession>;
}

function emptyStore(): Store {
  return { version: STORE_VERSION, accounts: {}, byUsername: {}, careers: {}, sessions: {} };
}

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || parsed.version !== STORE_VERSION) return emptyStore();
    // Defensive: a hand-edited or truncated record should not take the game down.
    return {
      version: STORE_VERSION,
      accounts: parsed.accounts ?? {},
      byUsername: parsed.byUsername ?? {},
      careers: parsed.careers ?? {},
      sessions: parsed.sessions ?? {},
    };
  } catch {
    return emptyStore();
  }
}

function write(store: Store): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Sessions that have expired are not kept around. */
function prune(store: Store): void {
  const now = Date.now();
  for (const [token, session] of Object.entries(store.sessions)) {
    if (new Date(session.expiresAt).getTime() < now) delete store.sessions[token];
  }
}

function publicAccount(account: StoredAccount): Account {
  const { verifier, ...rest } = account;
  // `verifier` is destructured out and deliberately unused: it is the one field
  // that must never leave this module.
  void verifier;
  return rest;
}

function sessionFor(store: Store, token: string): { store: Store; session: StoredSession; account: StoredAccount } | null {
  const session = store.sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  const account = store.accounts[session.accountId];
  if (!account) return null;
  return { store, session, account };
}

function expiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
}

function sessionPayload(store: Store, token: string, account: StoredAccount): Session {
  const career = account.careerId ? store.careers[account.careerId] ?? null : null;
  return { token, account: publicAccount(account), career };
}

/**
 * Run something that needs a logged-in account, with the store loaded and saved
 * around it. Every authenticated method is one of these, which is how the token
 * check ends up in exactly one place.
 */
async function withSession<T>(
  token: string,
  work: (context: { store: Store; account: StoredAccount }) => Promise<Reply<T>> | Reply<T>,
): Promise<Reply<T>> {
  const store = read();
  prune(store);
  const found = sessionFor(store, token);
  if (!found) return problem('token', 'You are signed out. Sign in again to carry on.');
  const result = await work({ store, account: found.account });
  if (result.ok) {
    // Touch the session and the account on every successful call, so an active
    // player is never logged out mid-season.
    store.sessions[token].expiresAt = expiry();
    found.account.lastSeenAt = new Date().toISOString();
    if (!write(store)) return problem('storage', 'Browser storage is full or unavailable — nothing was saved.');
  }
  return result;
}

/** A career that needs one, or an explanation. */
function requireCareer(store: Store, account: StoredAccount): Reply<Career> {
  if (!account.careerId) return problem('career', 'Create a golfer first.');
  const career = store.careers[account.careerId];
  if (!career) return problem('career', 'That career could not be found.');
  const problems = careerProblems(career);
  if (problems.length) {
    return problem('career', `This career failed its own checks (${problems[0]}) and was not loaded.`);
  }
  return { ok: true, value: career };
}

export function createLocalBackend(): CareerBackend {
  return {
    kind: 'local',
    label: 'Saved in this browser',

    async register(input: AuthInput): Promise<Reply<Session>> {
      const problems = validateCredentials(input);
      if (problems.length) return { ok: false, problems };

      const store = read();
      prune(store);
      const key = normaliseUsername(input.username);
      if (store.byUsername[key]) return problem('username', 'That username is taken on this browser.');

      const now = new Date().toISOString();
      const id = `account:${randomToken(12)}`;
      const account: StoredAccount = {
        id,
        username: input.username.trim(),
        displayName: (input.displayName ?? '').trim() || input.username.trim(),
        email: (input.email ?? '').trim() || null,
        createdAt: now,
        lastSeenAt: now,
        careerId: null,
        verifier: await hashPassword(input.password),
      };
      const token = randomToken();
      store.accounts[id] = account;
      store.byUsername[key] = id;
      store.sessions[token] = { token, accountId: id, expiresAt: expiry() };
      if (!write(store)) return problem('storage', 'Browser storage is unavailable, so the account could not be saved.');
      return { ok: true, value: sessionPayload(store, token, account) };
    },

    async login(input: AuthInput): Promise<Reply<Session>> {
      const store = read();
      prune(store);
      const id = store.byUsername[normaliseUsername(String(input.username ?? ''))];
      const account = id ? store.accounts[id] : undefined;
      // Verify against a throwaway hash when the account does not exist, so a
      // wrong username and a wrong password take the same time to fail.
      const verifier = account?.verifier ?? 'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const matched = await verifyPassword(String(input.password ?? ''), verifier);
      if (!account || !matched) return problem('password', 'That username and password do not match.');

      if (needsRehash(account.verifier)) account.verifier = await hashPassword(input.password);
      const token = randomToken();
      store.sessions[token] = { token, accountId: account.id, expiresAt: expiry() };
      account.lastSeenAt = new Date().toISOString();
      if (!write(store)) return problem('storage', 'Browser storage is unavailable.');
      return { ok: true, value: sessionPayload(store, token, account) };
    },

    async logout(token: string): Promise<void> {
      const store = read();
      delete store.sessions[token];
      write(store);
    },

    async resume(token: string): Promise<Reply<Session>> {
      return withSession(token, ({ store, account }) => ({
        ok: true,
        value: sessionPayload(store, token, account),
      }));
    },

    async createGolfer(token: string, request: CreationRequest): Promise<Reply<Career>> {
      return withSession(token, ({ store, account }) => {
        if (account.careerId && store.careers[account.careerId]) {
          return problem('career', 'This account already has a golfer.');
        }
        const validated = validateCreation(request);
        if (!validated.ok) return { ok: false, problems: validated.problems };

        const careerId = `career:${randomToken(12)}`;
        // The golfer's id inside the universe. Prefixed so nothing can collide
        // with a generated tour player, whose ids are `tour-n` and `rookie-…`.
        const golferId = `you:${randomToken(8)}`;
        const career = newCareer({ id: careerId, accountId: account.id, golferId, created: validated.value });
        store.careers[careerId] = career;
        account.careerId = careerId;
        return { ok: true, value: career };
      });
    },

    async recordEvent(token: string, request: RecordedEvent): Promise<Reply<{ career: Career; awarded: XpLedger }>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        const result = applyEvent(existing.value, request);
        if (!result.ok) return { ok: false, problems: result.problems };
        store.careers[result.value.career.id] = result.value.career;
        return { ok: true, value: result.value };
      });
    },

    async endSeason(token: string, request: SeasonReport): Promise<Reply<{ career: Career; awarded: XpLedger }>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        const result = applySeasonEnd(existing.value, request);
        if (!result.ok) return { ok: false, problems: result.problems };
        store.careers[result.value.career.id] = result.value.career;
        return { ok: true, value: result.value };
      });
    },

    async spendXp(token: string, request: SpendRequest): Promise<Reply<{ career: Career; xpSpent: number }>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        const result = applySpend(existing.value, request);
        if (!result.ok) return { ok: false, problems: result.problems };
        store.careers[result.value.career.id] = result.value.career;
        return { ok: true, value: result.value };
      });
    },

    async finishOffseason(token: string, abilityAfter: number): Promise<Reply<Career>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        const result = closeOffseason(existing.value, abilityAfter);
        if (!result.ok) return { ok: false, problems: result.problems };
        store.careers[result.value.id] = result.value;
        return { ok: true, value: result.value };
      });
    },

    async saveUniverse(token: string, payload: string): Promise<Reply<{ bytes: number }>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        try {
          window.localStorage.setItem(UNIVERSE_KEY(existing.value.id), payload);
          return { ok: true, value: { bytes: payload.length } };
        } catch {
          /**
           * Out of room. A season of results is about a megabyte and a browser
           * gives the whole origin five, so this is reachable — and losing a
           * season to it would be miserable.
           *
           * The guest universe is the one thing here that is certainly expendable:
           * it is the tour somebody was watching before they made an account, and
           * once they have a career it is not the game they are playing. Drop it
           * and try once more.
           */
          try {
            window.localStorage.removeItem(GUEST_SAVE_KEY);
            window.localStorage.setItem(UNIVERSE_KEY(existing.value.id), payload);
            return { ok: true, value: { bytes: payload.length } };
          } catch {
            return problem(
              'storage',
              'Could not save — this browser is out of storage. Sign out of an unused account to free some up.',
            );
          }
        }
      });
    },

    async loadUniverse(token: string): Promise<Reply<string | null>> {
      return withSession(token, ({ store, account }) => {
        const existing = requireCareer(store, account);
        if (!existing.ok) return existing;
        try {
          return { ok: true, value: window.localStorage.getItem(UNIVERSE_KEY(existing.value.id)) };
        } catch {
          return { ok: true, value: null };
        }
      });
    },

    async deleteCareer(token: string): Promise<Reply<null>> {
      return withSession(token, ({ store, account }) => {
        if (account.careerId) {
          try {
            window.localStorage.removeItem(UNIVERSE_KEY(account.careerId));
          } catch {
            // A universe we cannot remove is not a reason to refuse the reset.
          }
          delete store.careers[account.careerId];
          account.careerId = null;
        }
        return { ok: true, value: null };
      });
    },
  };
}

/** Exported for the account-system test harness, which needs to start from nothing. */
export const LOCAL_STORE_KEY = KEY;
