#!/usr/bin/env node
/**
 * The account and career server.
 *
 * Stdlib only — `node:http`, `node:crypto` through WebCrypto, `node:sqlite` — and
 * it exists for one reason: to put the rulebook somewhere the player cannot reach.
 * Requirement 21 says the backend must validate everything and trust nothing from
 * the client, and the only way to mean that is for the validation to run on a
 * machine the client does not control. Every handler below calls the same
 * functions out of /src/career that the browser backend calls; the difference is
 * who is running them.
 *
 *   npm run server                  # http://localhost:8787
 *   GOLF_DATA_DIR=/var/data npm run server
 *
 * And in the client:
 *   VITE_GOLF_API=http://localhost:8787 npm run dev
 *
 * Without VITE_GOLF_API the game uses the browser backend and never calls this.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  applyEvent, applySeasonEnd, applySpend, careerProblems, closeOffseason, newCareer, validateCreation,
  type Account, type Career, type Session,
} from '../src/career';
import {
  hashPassword, needsRehash, normaliseUsername, randomToken, validateCredentials, verifyPassword,
} from '../src/account/password';
import { Store, type AccountRow } from './db';

const PORT = Number(process.env.GOLF_PORT ?? 8787);
const DATA_DIR = process.env.GOLF_DATA_DIR ?? '.data';
const SESSION_DAYS = 14;
/** A universe save is about a megabyte; this is a generous ceiling on one. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Where the browser app is served from, for CORS. A comma-separated list, or `*`
 * to allow any origin — which is fine for a game played among friends and not
 * fine if you ever put anything else behind this process.
 */
const ORIGINS = (process.env.GOLF_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((o) => o.trim());

const store = new Store(DATA_DIR);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * A fixed window per client address on the routes that check a password.
 *
 * PBKDF2 at 210,000 iterations is what makes a stolen database expensive to
 * attack; this is what makes the live endpoint expensive to attack, and it also
 * stops a login loop turning the server's own key derivation into a denial of
 * service against itself. In memory on purpose: it is a speed bump, and a restart
 * clearing it is not a security problem worth a table for.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const existing = attempts.get(key);
  if (!existing || existing.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  existing.count++;
  return existing.count > MAX_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

interface Problem {
  field: string;
  message: string;
}

function send(response: ServerResponse, status: number, body: unknown, origin: string | undefined): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
    // This API is JSON-only and never renders anything, but say so anyway.
    'x-content-type-options': 'nosniff',
  };
  const allowed = origin && (ORIGINS.includes('*') || ORIGINS.includes(origin));
  if (allowed) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
    headers.vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(payload);
}

const fail = (response: ServerResponse, status: number, origin: string | undefined, problems: Problem[]) =>
  send(response, status, { problems }, origin);

const one = (field: string, message: string): Problem[] => [{ field, message }];

async function readBody(request: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BODY_BYTES) return { ok: false };
    chunks.push(chunk as Buffer);
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

async function readJson(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const body = await readBody(request);
  if (!body.ok) return { ok: false, message: 'That request body is too large.' };
  if (!body.text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, message: 'That request body is not valid JSON.' };
  }
}

function bearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function expiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
}

function publicAccount(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    careerId: row.careerId,
  };
}

function sessionPayload(token: string, row: AccountRow): Session {
  return {
    token,
    account: publicAccount(row),
    career: row.careerId ? store.career(row.careerId) : null,
  };
}

/** The client's address, for rate limiting. Honours one proxy hop. */
function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Authenticated handlers
// ---------------------------------------------------------------------------

interface Authed {
  token: string;
  account: AccountRow;
}

function authenticate(request: IncomingMessage): Authed | null {
  const token = bearer(request);
  if (!token) return null;
  const account = store.sessionAccount(token);
  if (!account) return null;
  return { token, account };
}

/** The career this account owns, already re-validated by the store. */
function careerFor(account: AccountRow): { ok: true; career: Career } | { ok: false; problems: Problem[] } {
  if (!account.careerId) return { ok: false, problems: one('career', 'Create a golfer first.') };
  const career = store.career(account.careerId);
  if (!career) return { ok: false, problems: one('career', 'That career could not be loaded.') };
  return { ok: true, career };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

type Route = (context: {
  request: IncomingMessage;
  response: ServerResponse;
  origin: string | undefined;
  body: unknown;
  authed: Authed | null;
}) => Promise<void> | void;

const ROUTES: Record<string, { auth: boolean; handler: Route }> = {
  'GET /api/health': {
    auth: false,
    handler: ({ response, origin }) => send(response, 200, { ok: true, ...store.counts() }, origin),
  },

  'POST /api/register': {
    auth: false,
    handler: async ({ request, response, origin, body }) => {
      if (rateLimited(`register:${clientKey(request)}`)) {
        return fail(response, 429, origin, one('username', 'Too many attempts. Try again in a few minutes.'));
      }
      const input = (body ?? {}) as Record<string, unknown>;
      const problems = validateCredentials(input);
      if (problems.length) return fail(response, 422, origin, problems);

      const username = String(input.username).trim();
      const key = normaliseUsername(username);
      if (store.accountByUsernameKey(key)) {
        return fail(response, 409, origin, one('username', 'That username is taken.'));
      }
      const now = new Date().toISOString();
      const account: AccountRow = {
        id: `account:${randomToken(12)}`,
        username,
        usernameKey: key,
        displayName: String(input.displayName ?? '').trim() || username,
        email: String(input.email ?? '').trim() || null,
        verifier: await hashPassword(String(input.password)),
        createdAt: now,
        lastSeenAt: now,
        careerId: null,
      };
      store.insertAccount(account);
      const token = randomToken();
      store.insertSession(token, account.id, expiry());
      send(response, 201, sessionPayload(token, account), origin);
    },
  },

  'POST /api/login': {
    auth: false,
    handler: async ({ request, response, origin, body }) => {
      if (rateLimited(`login:${clientKey(request)}`)) {
        return fail(response, 429, origin, one('password', 'Too many attempts. Try again in a few minutes.'));
      }
      const input = (body ?? {}) as Record<string, unknown>;
      const account = store.accountByUsernameKey(normaliseUsername(String(input.username ?? '')));
      // Always derive a key, even when there is no such account, so a wrong
      // username and a wrong password take the same time and the response cannot
      // be used to enumerate who has registered.
      const verifier = account?.verifier ?? 'pbkdf2$sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const matched = await verifyPassword(String(input.password ?? ''), verifier);
      if (!account || !matched) {
        return fail(response, 401, origin, one('password', 'That username and password do not match.'));
      }
      if (needsRehash(account.verifier)) store.setVerifier(account.id, await hashPassword(String(input.password)));
      const token = randomToken();
      store.insertSession(token, account.id, expiry());
      store.touchAccount(account.id, new Date().toISOString());
      send(response, 200, sessionPayload(token, account), origin);
    },
  },

  'POST /api/logout': {
    auth: true,
    handler: ({ response, origin, authed }) => {
      store.deleteSession(authed!.token);
      send(response, 200, { ok: true }, origin);
    },
  },

  'GET /api/session': {
    auth: true,
    handler: ({ response, origin, authed }) => {
      store.extendSession(authed!.token, expiry());
      send(response, 200, sessionPayload(authed!.token, authed!.account), origin);
    },
  },

  'POST /api/golfer': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const account = authed!.account;
      if (account.careerId && store.career(account.careerId)) {
        return fail(response, 409, origin, one('career', 'This account already has a golfer.'));
      }
      const validated = validateCreation(body);
      if (!validated.ok) return fail(response, 422, origin, validated.problems);

      const career = newCareer({
        id: `career:${randomToken(12)}`,
        accountId: account.id,
        golferId: `you:${randomToken(8)}`,
        created: validated.value,
      });
      store.saveCareer(career);
      store.setCareerId(account.id, career.id);
      send(response, 201, career, origin);
    },
  },

  'POST /api/events': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      const result = applyEvent(existing.career, body);
      if (!result.ok) return fail(response, 422, origin, result.problems);
      store.saveCareer(result.value.career);
      send(response, 200, result.value, origin);
    },
  },

  'POST /api/seasons': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      const result = applySeasonEnd(existing.career, body);
      if (!result.ok) return fail(response, 422, origin, result.problems);
      store.saveCareer(result.value.career);
      send(response, 200, result.value, origin);
    },
  },

  'POST /api/spend': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      const result = applySpend(existing.career, body);
      if (!result.ok) return fail(response, 422, origin, result.problems);
      // Belt and braces: never write a career that fails its own invariants, even
      // though `applySpend` is the thing that enforces them.
      const problems = careerProblems(result.value.career);
      if (problems.length) return fail(response, 500, origin, one('career', `Refused: ${problems[0]}`));
      store.saveCareer(result.value.career);
      send(response, 200, result.value, origin);
    },
  },

  'POST /api/offseason/close': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      const ability = Number((body as { abilityAfter?: unknown })?.abilityAfter ?? 0);
      const result = closeOffseason(existing.career, Number.isFinite(ability) ? ability : 0);
      if (!result.ok) return fail(response, 422, origin, result.problems);
      store.saveCareer(result.value);
      send(response, 200, result.value, origin);
    },
  },

  'GET /api/universe': {
    auth: true,
    handler: ({ response, origin, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      send(response, 200, { payload: store.universe(existing.career.id) }, origin);
    },
  },

  'PUT /api/universe': {
    auth: true,
    handler: ({ response, origin, body, authed }) => {
      const existing = careerFor(authed!.account);
      if (!existing.ok) return fail(response, 409, origin, existing.problems);
      const payload = (body as { payload?: unknown })?.payload;
      if (typeof payload !== 'string' || !payload) {
        return fail(response, 422, origin, one('payload', 'A universe payload is required.'));
      }
      store.saveUniverse(existing.career.id, payload);
      send(response, 200, { bytes: payload.length }, origin);
    },
  },

  'DELETE /api/career': {
    auth: true,
    handler: ({ response, origin, authed }) => {
      const account = authed!.account;
      if (account.careerId) {
        store.deleteCareer(account.careerId);
        store.setCareerId(account.id, null);
      }
      send(response, 200, { ok: true }, origin);
    },
  },
};

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export function start(port = PORT): ReturnType<typeof createServer> {
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? '/', 'http://localhost');
    const key = `${request.method} ${url.pathname}`;

    if (request.method === 'OPTIONS') {
      const allowed = origin && (ORIGINS.includes('*') || ORIGINS.includes(origin));
      response.writeHead(allowed ? 204 : 403, allowed
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'access-control-allow-headers': 'authorization,content-type',
            'access-control-max-age': '86400',
            vary: 'Origin',
          }
        : {});
      response.end();
      return;
    }

    const route = ROUTES[key];
    if (!route) return fail(response, 404, origin, one('path', `No route for ${key}.`));

    try {
      const authed = route.auth ? authenticate(request) : null;
      if (route.auth && !authed) {
        return fail(response, 401, origin, one('token', 'Sign in again to carry on.'));
      }
      let body: unknown = {};
      if (request.method !== 'GET' && request.method !== 'DELETE') {
        const parsed = await readJson(request);
        if (!parsed.ok) return fail(response, 400, origin, one('body', parsed.message));
        body = parsed.value;
      }
      await route.handler({ request, response, origin, body, authed });
    } catch (error) {
      // Log the detail, return none of it: an internal message is not the
      // client's business and is exactly the sort of thing that leaks a path.
      console.error(`${key} failed:`, error);
      if (!response.headersSent) fail(response, 500, origin, one('server', 'Something went wrong on the server.'));
    }
  });

  server.listen(port, () => {
    const counts = store.counts();
    console.log(`Golf careers API on http://localhost:${port}`);
    console.log(`  data: ${DATA_DIR}  accounts: ${counts.accounts}  careers: ${counts.careers}`);
    console.log(`  origins allowed: ${ORIGINS.join(', ')}`);
  });

  // Expired sessions are swept hourly rather than on every request.
  const sweep = setInterval(() => store.pruneSessions(), 3_600_000);
  sweep.unref();
  return server;
}

// Started directly rather than imported by a test.
if (process.env.GOLF_NO_LISTEN !== '1') start();
