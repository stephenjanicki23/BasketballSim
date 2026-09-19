/**
 * Storage for the account server: SQLite, through Node's own built-in driver.
 *
 * No dependencies, which is the same rule the rest of this repository follows.
 * The database is a single file; point `GOLF_DATA_DIR` at a mounted disk in
 * production, because a filesystem next to the code does not survive a deploy.
 *
 * A note on the schema, since requirement 20 suggests a column per attribute. The
 * career is stored as one validated JSON document plus the handful of columns the
 * server actually queries on. The reason is that `Career` in
 * /src/career/types.ts is the definition of a career — it is what the rulebook
 * validates, what the browser backend stores and what the client receives — and
 * spreading it across forty columns would create a second, silently divergent
 * definition that every future field would have to be added to twice. The
 * document is never trusted on the way out: `careerProblems` re-checks it against
 * the archetype ceilings before it is handed to anybody.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { careerProblems, type Career } from '../src/career';

export interface AccountRow {
  id: string;
  username: string;
  usernameKey: string;
  displayName: string;
  email: string | null;
  verifier: string;
  createdAt: string;
  lastSeenAt: string;
  careerId: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  username_key  TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  email         TEXT,
  verifier      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  career_id     TEXT
);

CREATE TABLE IF NOT EXISTS careers (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  golfer_id      TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  archetype      TEXT NOT NULL,
  career_season  INTEGER NOT NULL,
  age            INTEGER NOT NULL,
  experience     INTEGER NOT NULL,
  available_xp   INTEGER NOT NULL,
  document       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS universes (
  career_id   TEXT PRIMARY KEY REFERENCES careers(id) ON DELETE CASCADE,
  payload     TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`;

export class Store {
  private readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'golf-careers.db'));
    // WAL keeps a reader from blocking the writer, which matters the moment two
    // friends are playing at once.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // --- accounts ------------------------------------------------------------

  accountByUsernameKey(key: string): AccountRow | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE username_key = ?').get(key) as Record<string, unknown> | undefined;
    return row ? toAccount(row) : null;
  }

  accountById(id: string): AccountRow | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toAccount(row) : null;
  }

  insertAccount(account: AccountRow): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, username, username_key, display_name, email, verifier, created_at, last_seen_at, career_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id, account.username, account.usernameKey, account.displayName,
        account.email, account.verifier, account.createdAt, account.lastSeenAt, account.careerId,
      );
  }

  touchAccount(id: string, at: string): void {
    this.db.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').run(at, id);
  }

  setVerifier(id: string, verifier: string): void {
    this.db.prepare('UPDATE accounts SET verifier = ? WHERE id = ?').run(verifier, id);
  }

  setCareerId(accountId: string, careerId: string | null): void {
    this.db.prepare('UPDATE accounts SET career_id = ? WHERE id = ?').run(careerId, accountId);
  }

  // --- sessions ------------------------------------------------------------

  insertSession(token: string, accountId: string, expiresAt: string): void {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, accountId, now, expiresAt);
  }

  sessionAccount(token: string): AccountRow | null {
    const row = this.db
      .prepare(
        `SELECT accounts.* FROM sessions
         JOIN accounts ON accounts.id = sessions.account_id
         WHERE sessions.token = ? AND sessions.expires_at > ?`,
      )
      .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
    return row ? toAccount(row) : null;
  }

  extendSession(token: string, expiresAt: string): void {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(expiresAt, token);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  pruneSessions(): number {
    const result = this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    return Number(result.changes ?? 0);
  }

  // --- careers -------------------------------------------------------------

  /**
   * A career, re-validated on the way out.
   *
   * A row is not a trusted input: it may have been written by an older build of
   * this program, or edited in the database by hand. Returning null for one that
   * fails its own invariants is a much better failure than handing the simulation
   * a golfer whose ratings are above their ceiling.
   */
  career(id: string): Career | null {
    const row = this.db.prepare('SELECT document FROM careers WHERE id = ?').get(id) as { document?: string } | undefined;
    if (!row?.document) return null;
    try {
      const career = JSON.parse(row.document) as Career;
      const problems = careerProblems(career);
      if (problems.length) {
        console.error(`career ${id} failed its invariants and was not served: ${problems.join('; ')}`);
        return null;
      }
      return career;
    } catch {
      return null;
    }
  }

  saveCareer(career: Career): void {
    this.db
      .prepare(
        `INSERT INTO careers (id, account_id, golfer_id, display_name, archetype, career_season, age, experience, available_xp, document, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           career_season = excluded.career_season,
           age = excluded.age,
           experience = excluded.experience,
           available_xp = excluded.available_xp,
           document = excluded.document,
           updated_at = excluded.updated_at`,
      )
      .run(
        career.id, career.accountId, career.golferId, career.displayName, career.archetype,
        career.careerSeason, career.age, career.experience, career.availableXp,
        JSON.stringify(career), career.createdAt, career.updatedAt,
      );
  }

  deleteCareer(id: string): void {
    this.db.prepare('DELETE FROM universes WHERE career_id = ?').run(id);
    this.db.prepare('DELETE FROM careers WHERE id = ?').run(id);
  }

  // --- universes -----------------------------------------------------------

  universe(careerId: string): string | null {
    const row = this.db.prepare('SELECT payload FROM universes WHERE career_id = ?').get(careerId) as { payload?: string } | undefined;
    return row?.payload ?? null;
  }

  saveUniverse(careerId: string, payload: string): void {
    this.db
      .prepare(
        `INSERT INTO universes (career_id, payload, bytes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(career_id) DO UPDATE SET payload = excluded.payload, bytes = excluded.bytes, updated_at = excluded.updated_at`,
      )
      .run(careerId, payload, payload.length, new Date().toISOString());
  }

  /** For the operator: how many accounts, careers and saved universes there are. */
  counts(): { accounts: number; careers: number; universes: number; sessions: number } {
    const one = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      accounts: one('SELECT COUNT(*) AS n FROM accounts'),
      careers: one('SELECT COUNT(*) AS n FROM careers'),
      universes: one('SELECT COUNT(*) AS n FROM universes'),
      sessions: one('SELECT COUNT(*) AS n FROM sessions'),
    };
  }
}

function toAccount(row: Record<string, unknown>): AccountRow {
  return {
    id: String(row.id),
    username: String(row.username),
    usernameKey: String(row.username_key),
    displayName: String(row.display_name),
    email: row.email === null || row.email === undefined ? null : String(row.email),
    verifier: String(row.verifier),
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
    careerId: row.career_id === null || row.career_id === undefined ? null : String(row.career_id),
  };
}
