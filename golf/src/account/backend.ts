/**
 * The storage port.
 *
 * Everything the career system needs from the outside world is these fifteen
 * methods, and there are two implementations: `localBackend`, which keeps
 * accounts in the browser, and `httpBackend`, which talks to the Node server in
 * /server. The game only ever holds a `CareerBackend`, so which one is in use is
 * a configuration decision and not an architectural one.
 *
 * Both implementations run the same rulebook out of /career. The difference
 * between them is not what the rules are — it is where the trust boundary sits.
 * Against the server, validation happens somewhere the player cannot reach, which
 * is what requirement 21 is actually asking for. In the browser the same
 * functions run on the player's own machine, so they stop mistakes and casual
 * tampering but not a determined person with developer tools. `label` says which
 * of those two situations the player is in, and the UI shows it.
 */

import type { Career, Session } from '../career';
import type { CreationRequest, RecordedEvent, SeasonReport, SpendRequest, XpLedger } from '../career';

export interface Problem {
  field: string;
  message: string;
}

export type Reply<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

export const problem = (field: string, message: string): Reply<never> => ({ ok: false, problems: [{ field, message }] });

export interface AuthInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}

export interface CareerBackend {
  /** Where accounts live. */
  readonly kind: 'local' | 'remote';
  /** One line for the UI, so a player always knows where their career is stored. */
  readonly label: string;

  register(input: AuthInput): Promise<Reply<Session>>;
  login(input: AuthInput): Promise<Reply<Session>>;
  logout(token: string): Promise<void>;
  /** Pick a session back up from a stored token. */
  resume(token: string): Promise<Reply<Session>>;

  createGolfer(token: string, request: CreationRequest): Promise<Reply<Career>>;
  /** Award a finished tournament's XP. Refused if that event was already counted. */
  recordEvent(token: string, request: RecordedEvent): Promise<Reply<{ career: Career; awarded: XpLedger }>>;
  /** Close out a season: bonus XP, the season record, a birthday, offseason open. */
  endSeason(token: string, request: SeasonReport): Promise<Reply<{ career: Career; awarded: XpLedger }>>;
  spendXp(token: string, request: SpendRequest): Promise<Reply<{ career: Career; xpSpent: number }>>;
  finishOffseason(token: string, abilityAfter: number): Promise<Reply<Career>>;

  /** The universe save, opaque to the backend and stored against the career. */
  saveUniverse(token: string, payload: string): Promise<Reply<{ bytes: number }>>;
  loadUniverse(token: string): Promise<Reply<string | null>>;

  /** Start again with the same account. */
  deleteCareer(token: string): Promise<Reply<null>>;
}
