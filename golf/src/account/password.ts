/**
 * Passwords.
 *
 * One rule, and it is the one in the brief: a password is never stored. What is
 * stored is a PBKDF2-HMAC-SHA256 verifier — the algorithm, the iteration count,
 * a per-account random salt and the derived key — from which the password cannot
 * be recovered, only checked. Changing `ITERATIONS` here is safe at any time:
 * every stored verifier carries the count it was made with, so old ones keep
 * verifying and new ones get the new cost.
 *
 * This module runs unchanged on the server and in the browser. Node has had a
 * global WebCrypto since 18 and the browser has had one for a decade, so there is
 * one implementation of the only security-critical code in the project rather
 * than two that have to be kept in agreement.
 */

/**
 * OWASP's current floor for PBKDF2-HMAC-SHA256. It costs an honest user about a
 * fifth of a second once per login and costs an attacker with a stolen database
 * the same per guess, which is the entire point.
 */
const ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const subtle = (): SubtleCrypto => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('No WebCrypto available — accounts need crypto.subtle (a secure context in the browser).');
  }
  return cryptoApi.subtle;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Random bytes, from the platform's CSPRNG and nothing else. */
export function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('No secure random source available.');
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

/** A URL-safe opaque token. Used for session tokens and record ids. */
export function randomToken(bytes = 32): string {
  return toBase64(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Hash a password for storage. The result is self-describing, so a verifier made
 * by an older version of this file still verifies against a newer one.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$sha256$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time comparison, so a failure does not leak how nearly it matched. */
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/**
 * Check a password against a stored verifier. Returns false rather than throwing
 * for anything malformed: a corrupt row is a failed login, not a crash.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  try {
    const salt = fromBase64(parts[3]);
    const expected = fromBase64(parts[4]);
    const actual = await derive(password, salt, iterations);
    return equal(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Whether a stored verifier should be replaced next time the password is known
 * to be correct — i.e. it was made with fewer iterations than we now use.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 5) return true;
  return Number(parts[2]) < ITERATIONS;
}

// ---------------------------------------------------------------------------
// Rules about what a credential may be
// ---------------------------------------------------------------------------

export const CREDENTIALS = {
  usernameMinLength: 3,
  usernameMaxLength: 20,
  /** Letters, digits, underscore, hyphen and full stop. No spaces, no unicode games. */
  usernamePattern: /^[a-zA-Z0-9_.-]+$/,
  passwordMinLength: 8,
  /**
   * Long enough that nobody's key-derivation cost becomes a denial of service,
   * and far longer than anybody types.
   */
  passwordMaxLength: 200,
  displayNameMaxLength: 32,
} as const;

export interface CredentialProblem {
  field: string;
  message: string;
}

/**
 * Validate a registration. Runs on the server as well as in the form, because
 * the form is a convenience and the server is the rule.
 */
export function validateCredentials(input: {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  email?: unknown;
}): CredentialProblem[] {
  const problems: CredentialProblem[] = [];
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (username.length < CREDENTIALS.usernameMinLength || username.length > CREDENTIALS.usernameMaxLength) {
    problems.push({
      field: 'username',
      message: `A username is ${CREDENTIALS.usernameMinLength}–${CREDENTIALS.usernameMaxLength} characters.`,
    });
  } else if (!CREDENTIALS.usernamePattern.test(username)) {
    problems.push({ field: 'username', message: 'A username can use letters, numbers, and . _ - only.' });
  }

  if (password.length < CREDENTIALS.passwordMinLength) {
    problems.push({ field: 'password', message: `A password needs at least ${CREDENTIALS.passwordMinLength} characters.` });
  } else if (password.length > CREDENTIALS.passwordMaxLength) {
    problems.push({ field: 'password', message: 'That password is too long.' });
  }

  if (input.displayName !== undefined && input.displayName !== null && input.displayName !== '') {
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!displayName || displayName.length > CREDENTIALS.displayNameMaxLength) {
      problems.push({ field: 'displayName', message: `A display name is 1–${CREDENTIALS.displayNameMaxLength} characters.` });
    }
  }

  if (input.email !== undefined && input.email !== null && input.email !== '') {
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    // Deliberately loose. An address is only ever used to tell two accounts
    // apart here, so rejecting an unusual but valid one would be the worse error.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      problems.push({ field: 'email', message: 'That does not look like an email address.' });
    }
  }

  return problems;
}

/** The key an account is looked up by: case- and accent-insensitive. */
export function normaliseUsername(username: string): string {
  return username.trim().normalize('NFKC').toLowerCase();
}
