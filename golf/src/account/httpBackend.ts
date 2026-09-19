/**
 * Accounts on the server.
 *
 * A thin wrapper: every method is one request, and the server is the authority on
 * all of it. Notice what is *not* here — no cap checks, no XP arithmetic, no
 * budget validation. That is the point. The creation screen runs the rulebook to
 * show the player what their build costs, but when this backend is in use the
 * answer that counts comes back from a machine the player does not control.
 *
 * Errors are normalised to the same `{ problems }` shape the local backend
 * returns, including for a network failure, so nothing upstream has to know which
 * backend it is talking to.
 */

import type { Career, CreationRequest, RecordedEvent, SeasonReport, Session, SpendRequest, XpLedger } from '../career';
import { problem, type AuthInput, type CareerBackend, type Reply } from './backend';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  token?: string;
  body?: unknown;
}

/** How long to wait before deciding the server is not there. */
const TIMEOUT_MS = 15_000;

function normaliseBase(base: string): string {
  return base.replace(/\/+$/, '');
}

export function createHttpBackend(base: string): CareerBackend {
  const root = normaliseBase(base);

  async function call<T>(path: string, options: RequestOptions = {}): Promise<Reply<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${root}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          return problem('server', `The server sent something that was not JSON (${response.status}).`);
        }
      }

      if (!response.ok) {
        const problems = (parsed as { problems?: { field: string; message: string }[] })?.problems;
        if (Array.isArray(problems) && problems.length) return { ok: false, problems };
        return problem('server', `The server refused that (${response.status}).`);
      }
      return { ok: true, value: parsed as T };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return problem('server', 'The server did not answer in time.');
      }
      return problem('server', 'Could not reach the server. Check it is running.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    kind: 'remote',
    label: `Saved on the server at ${root}`,

    register: (input: AuthInput) => call<Session>('/api/register', { method: 'POST', body: input }),
    login: (input: AuthInput) => call<Session>('/api/login', { method: 'POST', body: input }),

    async logout(token: string): Promise<void> {
      await call('/api/logout', { method: 'POST', token, body: {} });
    },

    resume: (token: string) => call<Session>('/api/session', { token }),

    createGolfer: (token: string, request: CreationRequest) =>
      call<Career>('/api/golfer', { method: 'POST', token, body: request }),

    recordEvent: (token: string, request: RecordedEvent) =>
      call<{ career: Career; awarded: XpLedger }>('/api/events', { method: 'POST', token, body: request }),

    endSeason: (token: string, request: SeasonReport) =>
      call<{ career: Career; awarded: XpLedger }>('/api/seasons', { method: 'POST', token, body: request }),

    spendXp: (token: string, request: SpendRequest) =>
      call<{ career: Career; xpSpent: number }>('/api/spend', { method: 'POST', token, body: request }),

    finishOffseason: (token: string, abilityAfter: number) =>
      call<Career>('/api/offseason/close', { method: 'POST', token, body: { abilityAfter } }),

    saveUniverse: (token: string, payload: string) =>
      call<{ bytes: number }>('/api/universe', { method: 'PUT', token, body: { payload } }),

    async loadUniverse(token: string): Promise<Reply<string | null>> {
      const result = await call<{ payload: string | null }>('/api/universe', { token });
      return result.ok ? { ok: true, value: result.value.payload ?? null } : result;
    },

    async deleteCareer(token: string): Promise<Reply<null>> {
      const result = await call<{ ok: boolean }>('/api/career', { method: 'DELETE', token });
      return result.ok ? { ok: true, value: null } : result;
    },
  };
}
