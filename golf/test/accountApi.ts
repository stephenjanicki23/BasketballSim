/**
 * The account server, end to end over real HTTP.
 *
 * Starts the server on a throwaway database, registers, logs in, creates a
 * golfer, plays a season's worth of results through the API and then tries every
 * way of cheating it that requirement 21 names. Nothing here reaches inside the
 * server: it all goes over the wire, because the question being asked is what a
 * hostile client can actually get away with.
 *
 *   node tools/tsrun.mjs test/accountApi.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'golf-accounts-'));
process.env.GOLF_DATA_DIR = dataDir;
process.env.GOLF_NO_LISTEN = '1';
process.env.GOLF_PORT = '0';
process.env.GOLF_ORIGINS = '*';

const { start } = await import('../server/index');
const { CREATION, SKILL_LINE_IDS, baseLines, lineCaps, PROGRESSION } = await import('../src/career');
import type { SkillLines } from '../src/career';

const server = start(0);
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const root = `http://127.0.0.1:${port}`;

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

interface Result {
  status: number;
  body: any;
}

async function api(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Result> {
  const response = await fetch(`${root}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const message = (result: Result): string => result.body?.problems?.[0]?.message ?? '';

console.log(`server on ${root}, data in ${dataDir}\n`);

// ---------------------------------------------------------------------------
console.log('Registration and sessions');
// ---------------------------------------------------------------------------

const health = await api('GET', '/api/health');
check(health.status === 200 && health.body.ok === true, 'health check answers');

const weak = await api('POST', '/api/register', { body: { username: 'ab', password: 'short' } });
check(weak.status === 422, `a short username and password are refused (${message(weak)})`);

const registered = await api('POST', '/api/register', {
  body: { username: 'Stephen', password: 'a-long-enough-password', displayName: 'Stephen J', email: 'me@example.com' },
});
check(registered.status === 201 && typeof registered.body.token === 'string', 'registration returns a session token');
check(registered.body.career === null, 'a new account has no golfer yet');
check(
  !JSON.stringify(registered.body).includes('a-long-enough-password'),
  'the password does not appear anywhere in the response',
);
check(!JSON.stringify(registered.body).includes('verifier'), 'the stored verifier is not sent to the client');
const token: string = registered.body.token;

const duplicate = await api('POST', '/api/register', { body: { username: 'stephen', password: 'another-password' } });
check(duplicate.status === 409, 'a username cannot be taken twice, whatever the case');

const wrongPassword = await api('POST', '/api/login', { body: { username: 'Stephen', password: 'not-it' } });
check(wrongPassword.status === 401, 'a wrong password is refused');

const noSuchUser = await api('POST', '/api/login', { body: { username: 'nobody', password: 'not-it' } });
check(
  noSuchUser.status === 401 && message(noSuchUser) === message(wrongPassword),
  'a missing account and a wrong password give the same answer',
);

const loggedIn = await api('POST', '/api/login', { body: { username: 'stephen', password: 'a-long-enough-password' } });
check(loggedIn.status === 200 && loggedIn.body.token !== token, 'logging in again issues a fresh token');

const noToken = await api('GET', '/api/session');
check(noToken.status === 401, 'an unauthenticated request is refused');
const badToken = await api('GET', '/api/session', { token: 'not-a-real-token' });
check(badToken.status === 401, 'a made-up token is refused');

// ---------------------------------------------------------------------------
console.log('\nCreating a golfer');
// ---------------------------------------------------------------------------

function build(archetype: string, emphasis: string[]): SkillLines {
  const lines = baseLines();
  const caps = lineCaps(archetype as never);
  let spent = 0;
  const cost = (from: number) => CREATION.costBands.find((band) => from < band.upTo)!.cost;
  const raise = (id: keyof SkillLines, to: number) => {
    while (lines[id] < Math.min(to, caps[id], CREATION.maxStartingRating) && spent + cost(lines[id]) <= CREATION.startingSkillPoints) {
      spent += cost(lines[id]);
      lines[id]++;
    }
  };
  for (const id of emphasis) raise(id as keyof SkillLines, CREATION.maxStartingRating);
  for (let target = CREATION.baseRating; target <= CREATION.maxStartingRating; target++) {
    for (const id of SKILL_LINE_IDS) raise(id, target);
  }
  return lines;
}

const overBudget = await api('POST', '/api/golfer', {
  token,
  body: {
    firstName: 'Over', lastName: 'Budget', country: 'United States',
    archetype: 'power', puttingStyle: 'steady',
    lines: Object.fromEntries(SKILL_LINE_IDS.map((id) => [id, CREATION.maxStartingRating])),
  },
});
check(overBudget.status === 422, `every line at the maximum is over budget (${message(overBudget)})`);

const overCap = await api('POST', '/api/golfer', {
  token,
  body: {
    firstName: 'Over', lastName: 'Cap', country: 'United States',
    archetype: 'precision', puttingStyle: 'steady', lines: { power: 82 },
  },
});
check(overCap.status === 422, `a line above the archetype ceiling is refused (${message(overCap)})`);

const lockedArchetype = await api('POST', '/api/golfer', {
  token,
  body: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'veteran', puttingStyle: 'steady', lines: {} },
});
check(lockedArchetype.status === 422, 'an archetype players cannot choose is refused');

const created = await api('POST', '/api/golfer', {
  token,
  body: {
    firstName: 'Stephen', lastName: 'Janicki', displayName: 'Stephen Janicki',
    country: 'United States', archetype: 'elitePutter', puttingStyle: 'technician',
    lines: build('elitePutter', ['putting', 'greenReading']),
  },
});
check(created.status === 201, 'a legal golfer is created');
check(created.body.availableXp === 0 && created.body.experience === 0, 'a new career starts with no XP');
check(created.body.lines.putting === CREATION.maxStartingRating, 'the emphasised line started at the maximum');

const second = await api('POST', '/api/golfer', {
  token,
  body: { firstName: 'A', lastName: 'B', country: 'United States', archetype: 'power', puttingStyle: 'steady', lines: {} },
});
check(second.status === 409, 'an account cannot have two golfers');

// ---------------------------------------------------------------------------
console.log('\nEarning XP');
// ---------------------------------------------------------------------------

const win = {
  season: 2026,
  outcome: {
    tournamentId: 'coastalOpen', tournamentName: 'The Coastal Open', tier: 'major',
    position: 1, madeCut: true, worldRankBefore: 140, previousBestFinish: 0,
    rounds: [
      { toPar: -4, birdies: 6, eagles: 0, albatrosses: 0 },
      { toPar: -2, birdies: 4, eagles: 1, albatrosses: 0 },
      { toPar: -5, birdies: 7, eagles: 0, albatrosses: 0 },
      { toPar: -3, birdies: 5, eagles: 0, albatrosses: 0 },
    ],
  },
};
const won = await api('POST', '/api/events', { token, body: win });
check(won.status === 200 && won.body.awarded.total > 2000, `winning a major pays well (${won.body?.awarded?.total} XP)`);
check(won.body.career.availableXp === won.body.awarded.total, 'the XP landed in the career');

const replay = await api('POST', '/api/events', { token, body: win });
check(replay.status === 422, `the same event cannot be submitted twice (${message(replay)})`);

const absurd = await api('POST', '/api/events', {
  token,
  body: {
    season: 2026,
    outcome: {
      ...win.outcome, tournamentId: 'fake', position: 1,
      rounds: [{ toPar: -40, birdies: 900, eagles: 900, albatrosses: 900 }],
    },
  },
});
check(absurd.status === 422, `an impossible round is refused (${message(absurd)})`);

const cappedEvent = await api('POST', '/api/events', {
  token,
  body: {
    season: 2026,
    outcome: {
      ...win.outcome, tournamentId: 'anotherMajor', position: 1, worldRankBefore: 5000,
      rounds: Array.from({ length: 4 }, () => ({ toPar: -12, birdies: 15, eagles: 3, albatrosses: 2 })),
    },
  },
});
const { XP } = await import('../src/career');
check(
  cappedEvent.status === 200 && cappedEvent.body.awarded.total <= XP.maxPerEvent,
  `the best imaginable week is capped at ${XP.maxPerEvent} XP (paid ${cappedEvent.body?.awarded?.total})`,
);

// Filling a season, to check the event limit.
for (let index = 0; index < XP.maxEventsPerSeason; index++) {
  await api('POST', '/api/events', {
    token,
    body: {
      season: 2026,
      outcome: {
        tournamentId: `filler-${index}`, tournamentName: 'Filler', tier: 'regular',
        position: 30, madeCut: true, worldRankBefore: 120, previousBestFinish: 1,
        rounds: [{ toPar: 0, birdies: 3, eagles: 0, albatrosses: 0 }],
      },
    },
  });
}
const tooMany = await api('POST', '/api/events', {
  token,
  body: {
    season: 2026,
    outcome: {
      tournamentId: 'one-too-many', tournamentName: 'Filler', tier: 'regular',
      position: 30, madeCut: true, worldRankBefore: 120, previousBestFinish: 1,
      rounds: [{ toPar: 0, birdies: 3, eagles: 0, albatrosses: 0 }],
    },
  },
});
check(tooMany.status === 422, `a season cannot hold more than ${XP.maxEventsPerSeason} events (${message(tooMany)})`);

// ---------------------------------------------------------------------------
console.log('\nSpending it');
// ---------------------------------------------------------------------------

const earlySpend = await api('POST', '/api/spend', { token, body: { buy: { putting: 1 } } });
check(earlySpend.status === 422, `XP cannot be spent outside the offseason (${message(earlySpend)})`);

const seasonReport = {
  season: 2026,
  abilityBefore: 77,
  outcome: { cutsMade: 18, wins: 2, top10s: 6, standingsRank: 9, scoringAverage: 70.8, bestPreviousScoringAverage: 0 },
  record: {
    season: 2026, events: 20, cutsMade: 18, wins: 2, top10s: 6, top25s: 11, earnings: 4_200_000,
    standingsRank: 9, worldRank: 22, scoringAverage: 70.8, birdies: 240, eagles: 9, bestFinish: 1,
  },
};
const ended = await api('POST', '/api/seasons', { token, body: seasonReport });
check(ended.status === 200 && ended.body.career.offseasonOpen === true, 'ending the season opens the offseason');
check(ended.body.career.age === CREATION.startingAge + 1, 'the golfer had a birthday');
check(ended.body.career.careerSeason === 2, 'the career is into its second season');

const replaySeason = await api('POST', '/api/seasons', { token, body: seasonReport });
check(replaySeason.status === 422, `a season cannot be closed twice (${message(replaySeason)})`);

const banked: number = ended.body.career.availableXp;
console.log(`  (banked ${banked.toLocaleString()} XP after one strong season)`);

const spent = await api('POST', '/api/spend', { token, body: { buy: { putting: 2 } } });
check(spent.status === 200, 'a legal spend is accepted');
check(spent.body.career.lines.putting === CREATION.maxStartingRating + 2, 'the rating went up by two');
check(
  spent.body.career.availableXp + spent.body.career.spentXp === spent.body.career.experience,
  'XP balances: available + spent = earned',
);

const tooFast = await api('POST', '/api/spend', { token, body: { buy: { putting: PROGRESSION.maxGainPerLinePerOffseason } } });
check(tooFast.status === 422, `one winter cannot move a line more than ${PROGRESSION.maxGainPerLinePerOffseason} (${message(tooFast)})`);

// A season cannot be closed while an offseason is still open, which is what
// stops a player rolling the same winter over and over to bank the bonus twice.
const overlapping = await api('POST', '/api/seasons', { token, body: { ...seasonReport, season: 2027 } });
check(overlapping.status === 422, `a new season cannot start mid-offseason (${message(overlapping)})`);

const closed = await api('POST', '/api/offseason/close', { token, body: { abilityAfter: 79 } });
check(closed.status === 200 && closed.body.offseasonOpen === false, 'the offseason closes');
check(closed.body.pending.total === 0, 'and the season ledger is cleared, while the banked XP is not');
check(closed.body.availableXp > 0, 'unspent XP carries into next season');

// Now play out enough winters to take the putting line all the way to its ceiling,
// and then try to go one past it.
const putterCap = lineCaps('elitePutter').putting;
for (let season = 2027; season < 2040; season++) {
  const current = await api('GET', '/api/session', { token });
  const line = current.body.career.lines.putting;
  if (line >= putterCap) break;
  await api('POST', '/api/seasons', { token, body: { ...seasonReport, season } });
  await api('POST', '/api/spend', {
    token,
    body: { buy: { putting: Math.min(PROGRESSION.maxGainPerLinePerOffseason, putterCap - line) } },
  });
  await api('POST', '/api/offseason/close', { token, body: { abilityAfter: 80 } });
}
const atCeiling = await api('GET', '/api/session', { token });
check(atCeiling.body.career.lines.putting === putterCap, `the putting line reached its ceiling of ${putterCap}`);

// One more winter, with XP banked, purely to be told no.
await api('POST', '/api/seasons', { token, body: { ...seasonReport, season: 2041 } });
const pastCeiling = await api('POST', '/api/spend', { token, body: { buy: { putting: 1 } } });
check(pastCeiling.status === 422, `the archetype ceiling cannot be bought past (${message(pastCeiling)})`);
const rich = await api('GET', '/api/session', { token });
console.log(`  (banked ${rich.body.career.availableXp.toLocaleString()} XP with the line already maxed)`);
check(
  rich.body.career.availableXp > 5_000 && rich.body.career.lines.putting === putterCap,
  'and no amount of banked XP changes that',
);

// ---------------------------------------------------------------------------
console.log('\nThe XP guard, on an account that has earned almost nothing');
// ---------------------------------------------------------------------------

const poor = await api('POST', '/api/register', { body: { username: 'rookie', password: 'a-rookie-password' } });
const poorToken: string = poor.body.token;
await api('POST', '/api/golfer', {
  token: poorToken,
  body: {
    firstName: 'Skint', lastName: 'Rookie', country: 'Ireland',
    archetype: 'grinder', puttingStyle: 'steady', lines: build('grinder', ['consistency']),
  },
});
await api('POST', '/api/events', {
  token: poorToken,
  body: {
    season: 2026,
    outcome: {
      tournamentId: 'seasonOpener', tournamentName: 'Season Opener', tier: 'regular',
      position: 0, madeCut: false, worldRankBefore: 156, previousBestFinish: 0,
      rounds: [{ toPar: 3, birdies: 2, eagles: 0, albatrosses: 0 }, { toPar: 4, birdies: 1, eagles: 0, albatrosses: 0 }],
    },
  },
});
await api('POST', '/api/seasons', {
  token: poorToken,
  body: {
    season: 2026, abilityBefore: 76,
    outcome: { cutsMade: 1, wins: 0, top10s: 0, standingsRank: 150, scoringAverage: 73.9, bestPreviousScoringAverage: 0 },
    record: {
      season: 2026, events: 18, cutsMade: 1, wins: 0, top10s: 0, top25s: 0, earnings: 41_000,
      standingsRank: 150, worldRank: 154, scoringAverage: 73.9, birdies: 40, eagles: 0, bestFinish: 62,
    },
  },
});
const poorCareer = await api('GET', '/api/session', { token: poorToken });
const poorXp: number = poorCareer.body.career.availableXp;
console.log(`  (a season of missed cuts banked ${poorXp.toLocaleString()} XP — enough to move something, not much)`);
check(poorXp > 0, 'even a bad season pays something');

const cantAfford = await api('POST', '/api/spend', { token: poorToken, body: { buy: { consistency: 6, fitness: 6 } } });
check(
  cantAfford.status === 422 && message(cantAfford).includes('XP'),
  `spending more XP than is banked is refused (${message(cantAfford)})`,
);
const untouched = await api('GET', '/api/session', { token: poorToken });
check(
  untouched.body.career.availableXp === poorXp && untouched.body.career.spentXp === 0,
  'a refused spend changed nothing — no XP gone, no half-applied ratings',
);

// ---------------------------------------------------------------------------
console.log('\nPersistence');
// ---------------------------------------------------------------------------

const saved = await api('PUT', '/api/universe', { token, body: { payload: JSON.stringify({ hello: 'universe' }) } });
check(saved.status === 200 && saved.body.bytes > 0, 'a universe can be saved');
const loaded = await api('GET', '/api/universe', { token });
check(JSON.parse(loaded.body.payload).hello === 'universe', 'and read back');

const other = await api('POST', '/api/register', { body: { username: 'friend', password: 'a-different-password' } });
const theirs = await api('GET', '/api/universe', { token: other.body.token });
check(theirs.status === 409, 'another account cannot read this one\'s universe');
const theirCareer = await api('GET', '/api/session', { token: other.body.token });
check(theirCareer.body.career === null, 'and cannot see this one\'s career');

const resumed = await api('POST', '/api/login', { body: { username: 'stephen', password: 'a-long-enough-password' } });
check(
  resumed.body.career?.lines?.putting === putterCap,
  'logging back in resumes the career exactly where it was',
);
check(resumed.body.career?.seasons?.length > 0, 'and the season history came with it');

await api('POST', '/api/logout', { token });
const afterLogout = await api('GET', '/api/session', { token });
check(afterLogout.status === 401, 'the token stops working after logging out');
const stillThere = await api('POST', '/api/login', { body: { username: 'stephen', password: 'a-long-enough-password' } });
check(stillThere.status === 200 && stillThere.body.career !== null, 'and the career survives being logged out of');

// ---------------------------------------------------------------------------
console.log('\nThe client adapter, against the same server');
// ---------------------------------------------------------------------------

/**
 * `httpBackend` is what the browser actually talks to the server with, and it is
 * the one piece of the account system a browser test covers only incidentally. It
 * uses nothing browser-specific — `fetch` and `AbortController`, both of which
 * node has — so it can be driven directly, which is a great deal cheaper than
 * booting Chromium to find out that an error shape does not line up.
 */
const { createHttpBackend } = await import('../src/account/httpBackend');
const client = createHttpBackend(root);

const clientRegister = await client.register({ username: 'adapter', password: 'an-adapter-password' });
check(clientRegister.ok, 'the adapter can register');
if (clientRegister.ok) {
  const clientToken = clientRegister.value.token;
  check(clientRegister.value.career === null, 'and gets a session with no career yet');

  const refused = await client.createGolfer(clientToken, {
    firstName: 'Too', lastName: 'Rich', country: 'United States',
    archetype: 'power', puttingStyle: 'steady',
    lines: Object.fromEntries(SKILL_LINE_IDS.map((id) => [id, CREATION.maxStartingRating])) as never,
  });
  check(
    !refused.ok && refused.problems.length > 0,
    `a refusal comes back as problems, not as an exception (${!refused.ok ? refused.problems[0].message : ''})`,
  );

  const made = await client.createGolfer(clientToken, {
    firstName: 'Adapter', lastName: 'Test', country: 'Sweden',
    archetype: 'ballStriker', puttingStyle: 'poorReader', lines: build('ballStriker', ['ironPlay', 'longGame']),
  });
  check(made.ok, 'and can create a legal golfer');

  const saved = await client.saveUniverse(clientToken, JSON.stringify({ via: 'adapter' }));
  check(saved.ok, 'the adapter can save a universe');
  const read = await client.loadUniverse(clientToken);
  check(read.ok && read.value !== null && JSON.parse(read.value).via === 'adapter', 'and read it back');

  await client.logout(clientToken);
  const afterAdapterLogout = await client.resume(clientToken);
  check(!afterAdapterLogout.ok, 'and log out');
}

const unreachable = createHttpBackend('http://127.0.0.1:1');
const noServer = await unreachable.login({ username: 'anyone', password: 'anything' });
check(
  !noServer.ok && noServer.problems[0]?.message.includes('Could not reach'),
  'an unreachable server is a problem, not a crash',
);

// ---------------------------------------------------------------------------
server.close();
rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All account API checks passed.' : `${failures} FAILURES`}`);
if (failures) process.exitCode = 1;
