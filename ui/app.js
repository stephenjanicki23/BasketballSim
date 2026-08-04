/* Basketball Manager — the user interface.
 *
 * One UI, two places to run: the live app, served by the Python API, and the
 * published static page, where a whole season is baked into the document. The
 * only difference is where data comes from, which is behind `state.source`
 * (see source-live.js and source-static.js). Everything below is shared.
 *
 * The box score is rebuilt from the event stream rather than read off a stored
 * total — demo/verify.mjs checks that rebuild against the engine's own box
 * score for every game in the published payload.
 */

const EV = {
  GAME_START: 0, PERIOD_START: 1, PERIOD_END: 2, JUMP_BALL: 3,
  SHOT_MADE: 4, SHOT_MISSED: 5, BLOCK: 6, ASSIST: 7, REBOUND: 8,
  TURNOVER: 9, STEAL: 10, FOUL: 11, FT_MADE: 12, FT_MISSED: 13,
  SUBSTITUTION: 14, TIMEOUT: 15, GAME_END: 16,
};

// Event tuple layout, matching tools/export_demo.py.
const E_PERIOD = 0, E_CLOCK = 1, E_SECONDS = 2, E_TYPE = 3, E_DESC = 4,
      E_HOME = 5, E_AWAY = 6, E_TEAM = 7, E_PLAYER = 8, E_SECOND = 9,
      E_POINTS = 10, E_FLAGS = 11;

const FLAG_OREB = 1, FLAG_THREE = 2, FLAG_AND_ONE = 4;

/* ------------------------------------------------------------------ *
 * Box score, rebuilt from events
 * ------------------------------------------------------------------ */

function emptyLine(playerId) {
  return {
    playerId, seconds: 0, points: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0,
    ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
  };
}

function newBoxState(game) {
  const side = (starters) => ({
    lines: new Map(),
    onCourt: new Set(starters),
  });
  return {
    home: side(game.homeStarters),
    away: side(game.awayStarters),
    homeId: game.home,
    awayId: game.away,
    clock: 0,
  };
}

function lineFor(state, playerId) {
  for (const key of ["home", "away"]) {
    const side = state[key];
    if (side.lines.has(playerId)) return side.lines.get(playerId);
  }
  return null;
}

/* A player only appears once we know which team he is on, which the event
 * tells us. Look him up by team first, then fall back to whichever side
 * already knows him. */
function line(state, teamId, playerId) {
  if (!playerId) return null;
  const key = teamId === state.homeId ? "home" : teamId === state.awayId ? "away" : null;
  if (key) {
    const side = state[key];
    if (!side.lines.has(playerId)) side.lines.set(playerId, emptyLine(playerId));
    return side.lines.get(playerId);
  }
  return lineFor(state, playerId);
}

function otherTeam(state, teamId) {
  return teamId === state.homeId ? state.awayId : state.homeId;
}

function accrueMinutes(state, seconds) {
  if (seconds <= 0) return;
  for (const key of ["home", "away"]) {
    const side = state[key];
    for (const playerId of side.onCourt) {
      if (!side.lines.has(playerId)) side.lines.set(playerId, emptyLine(playerId));
      side.lines.get(playerId).seconds += seconds;
    }
  }
}

function applyEvent(state, event) {
  accrueMinutes(state, event[E_SECONDS] - state.clock);
  state.clock = event[E_SECONDS];

  const type = event[E_TYPE];
  const teamId = event[E_TEAM];
  const playerId = event[E_PLAYER];
  const secondaryId = event[E_SECOND];
  const flags = event[E_FLAGS];
  const isThree = (flags & FLAG_THREE) !== 0;

  switch (type) {
    case EV.SHOT_MADE: {
      const shooter = line(state, teamId, playerId);
      shooter.fga += 1;
      shooter.fgm += 1;
      shooter.points += event[E_POINTS];
      if (isThree) { shooter.tpa += 1; shooter.tpm += 1; }
      if (secondaryId && (flags & FLAG_AND_ONE)) {
        // On an and-one the secondary player is the defender who fouled.
        const defender = line(state, otherTeam(state, teamId), secondaryId);
        if (defender) defender.pf += 1;
      } else if (secondaryId) {
        const assister = line(state, teamId, secondaryId);
        if (assister) assister.ast += 1;
      }
      break;
    }
    case EV.SHOT_MISSED: {
      const shooter = line(state, teamId, playerId);
      shooter.fga += 1;
      if (isThree) shooter.tpa += 1;
      break;
    }
    case EV.BLOCK: {
      // team is the defense: player blocked, secondary took the shot.
      const blocker = line(state, teamId, playerId);
      blocker.blk += 1;
      const shooter = line(state, otherTeam(state, teamId), secondaryId);
      if (shooter) {
        shooter.fga += 1;
        if (isThree) shooter.tpa += 1;
      }
      break;
    }
    case EV.REBOUND: {
      // A team rebound carries no player: the ball changed hands but nobody
      // is credited, exactly as in a real box score.
      const rebounder = line(state, teamId, playerId);
      if (!rebounder) break;
      if (flags & FLAG_OREB) rebounder.oreb += 1;
      else rebounder.dreb += 1;
      break;
    }
    case EV.TURNOVER: {
      line(state, teamId, playerId).tov += 1;
      break;
    }
    case EV.STEAL: {
      // team is the defense: player stole it, secondary lost it.
      line(state, teamId, playerId).stl += 1;
      const loser = line(state, otherTeam(state, teamId), secondaryId);
      if (loser) loser.tov += 1;
      break;
    }
    case EV.FOUL: {
      line(state, teamId, playerId).pf += 1;
      break;
    }
    case EV.FT_MADE: {
      const shooter = line(state, teamId, playerId);
      shooter.fta += 1;
      shooter.ftm += 1;
      shooter.points += 1;
      break;
    }
    case EV.FT_MISSED: {
      line(state, teamId, playerId).fta += 1;
      break;
    }
    case EV.SUBSTITUTION: {
      const key = teamId === state.homeId ? "home" : "away";
      const side = state[key];
      side.onCourt.delete(secondaryId);
      side.onCourt.add(playerId);
      if (!side.lines.has(playerId)) side.lines.set(playerId, emptyLine(playerId));
      break;
    }
    default:
      break;
  }
}

function sideTotals(side) {
  const totals = emptyLine("TEAM");
  for (const l of side.lines.values()) {
    for (const key of Object.keys(totals)) {
      if (key !== "playerId") totals[key] += l[key];
    }
  }
  return totals;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { EV, newBoxState, applyEvent, sideTotals, emptyLine };
}

/* ------------------------------------------------------------------ *
 * App state
 * ------------------------------------------------------------------ */

const state = {
  data: null,
  teams: new Map(),
  players: new Map(),
  view: "games",
  gameId: null,
  game: null,
  playhead: 0,
  cursor: 0,
  playing: false,
  speed: 1,
  box: null,
  tab: "pbp",
  teamId: null,
  playerId: null,
  posFilter: "",
  chartStat: "per",
  chartAxis: "season",
  standingsView: "league",
  powerTeam: null,
  statIndex: null,
  showHidden: false,
  displayScale: 20,
  statsScope: "players",
  statsSort: "points",
  statsDescending: true,
  lastTick: 0,
  frame: null,
  // Set at boot: where data comes from, and (live only) the poller watching a
  // game that is still being played.
  source: null,
  livePoll: null,
  leagueRefresh: null,
  // Which attribute sections are expanded. Kept on the app rather than the
  // DOM so it survives clicking down the roster.
  openGroups: new Set(),
};

const REDUCED_MOTION = typeof matchMedia === "function"
  && matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  const status = $("#boot-status");
  state.source = window.BBALL_SOURCE;
  if (!state.source) {
    status.textContent = "No data source loaded.";
    return;
  }

  try {
    state.data = await state.source.load();
  } catch (error) {
    status.textContent = `Couldn't load the season: ${error.message}`;
    return;
  }

  indexTeams(state.data.teams);
  state.teamId = state.data.teams[0].id;

  $("#boot").remove();
  $("#app").hidden = false;
  document.body.classList.toggle("is-live", Boolean(state.data.live));
  renderSeasonLabel();

  renderWire();
  renderBracket();
  renderHonours();
  renderPower();
  bindStandingsScope();
  renderSchedule();
  renderStandings();
  bindChartStat();
  renderTeams();
  buildStatTabs();
  renderStats();
  bindControls();
  if (state.data.live) startLeagueRefresh();

  // The Games tab opens on the day's schedule. Nothing is auto-selected: the
  // list is the screen, and a fixture is something you choose to open.
  showTracker(false);
}

/* Teams arrive with squads baked in on the static page and without them from
 * the API, where a squad is fetched per team. Either way they are indexed the
 * same, and `squadFor` is what the squad screen goes through. */
function dayGames() {
  return (state.data.day && state.data.day.games) || [];
}

function indexTeams(teams) {
  for (const team of teams) {
    const existing = state.teams.get(team.id);
    state.teams.set(team.id, Object.assign(existing || {}, team));
    for (const player of team.players || []) state.players.set(player.id, player);
  }
}

/* A squad is fetched once and kept. Ratings do not move during a season, but
 * the game log and the progression series do -- they are derived from finished
 * fixtures, and finished fixtures are exactly what a refresh brings. So a
 * refresh marks the cached squads stale rather than clearing them, and the next
 * visit to the Teams tab re-fetches the club being looked at. Without this, a
 * "Recent Games" table in the live app never gains a game. */
async function squadFor(teamId) {
  const team = state.teams.get(teamId);
  if (team && team.players && !team.stale) return team;
  const loaded = await state.source.squad(teamId);
  if (loaded) {
    indexTeams([loaded]);
    state.teams.get(teamId).stale = false;
  }
  return state.teams.get(teamId);
}

function renderSeasonLabel() {
  // Season-wide counts, not the day's -- the schedule shows one day, but the
  // masthead is about the season.
  const totals = state.data.season_totals || { fixtures: dayGames().length, played: 0 };
  const label = state.data.live
    ? `${state.data.league.season} · ${totals.played} of ${totals.fixtures} played`
    : `${state.data.league.season} · ${totals.fixtures} games`;
  $("#season-label").textContent = label;
}

/* ------------------------------------------------------------------ *
 * Schedule rail
 * ------------------------------------------------------------------ */

function gameDate(game) {
  return new Date(game.tipoff).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

/* Tip-offs are shown in Pacific, not the viewer's zone. The league's slates
 * are *defined* as 8am, 1pm and 7pm Pacific; rendering them locally turns that
 * into "3:00 PM, 8:00 PM, 2:00 AM" for anyone on UTC, which describes the same
 * moment and communicates nothing. */
const LEAGUE_TIME_ZONE = "America/Los_Angeles";

function tipoffTime(game) {
  const time = new Date(game.tipoff).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: LEAGUE_TIME_ZONE,
  });
  return `${time} PT`;
}


/* ------------------------------------------------------------------ *
 * Club crests
 *
 * One mark per nickname, drawn on a 64x64 box. Geometric rather than
 * illustrative on purpose: a crest here is 34px across in a schedule row,
 * where a detailed animal turns to mud and a bold silhouette still reads.
 *
 * `{{P}}` is the disc colour and `{{S}}` the mark colour, substituted when a
 * crest is built. `{{P}}` is what knocks a hole *out* of a shape -- an eye, a
 * slot in a shield -- by painting the disc colour back over it.
 *
 * `bballsim/logos.py` says which club wears which of these, and in what
 * colours. The strings below are our own constants, never user input, which
 * is what makes assembling them into markup safe.
 * ------------------------------------------------------------------ */

const GLYPHS = {
  // Ironworks — a steel I-beam.
  beam: '<path d="M13 16h38v9H37v14h14v9H13v-9h14V25H13z"/>',

  // Mariners — ship's wheel.
  wheel: '<path d="M32 10a22 22 0 1 0 0 44 22 22 0 0 0 0-44zm0 8a14 14 0 1 1 0 28 14 14 0 0 1 0-28z"/>'
       + '<path d="M29 8h6v48h-6zM8 29h48v6H8z"/>'
       + '<g transform="rotate(45 32 32)"><path d="M29 8h6v48h-6zM8 29h48v6H8z"/></g>'
       + '<circle cx="32" cy="32" r="7"/>',

  // Miners — crossed picks under a curved head.
  picks: '<g transform="rotate(45 32 32)"><rect x="29" y="12" width="6" height="40" rx="3"/></g>'
       + '<g transform="rotate(-45 32 32)"><rect x="29" y="12" width="6" height="40" rx="3"/></g>'
       + '<path d="M12 22a30 30 0 0 1 40 0l-4 6a23 23 0 0 0-32 0z"/>',

  // Rovers — compass star.
  compass: '<path d="M32 6l6 20 20 6-20 6-6 20-6-20-20-6 20-6z"/>'
         + '<circle cx="32" cy="32" r="26" fill="none" stroke-width="3"/>',

  // Current — a river running.
  current: '<g fill="none" stroke-width="5" stroke-linecap="round">'
         + '<path d="M11 23q7.5-9 15 0t15 0"/><path d="M11 34q7.5-9 15 0t15 0"/>'
         + '<path d="M11 45q7.5-9 15 0t15 0"/></g>',

  // Stags — antlers over a brow.
  antlers: '<g fill="none" stroke-width="4" stroke-linecap="round">'
         + '<path d="M32 54V32"/><path d="M32 34 21 23M21 23l-9 3M21 23l-1-10"/>'
         + '<path d="M32 34l11-11M43 23l9 3M43 23l1-10"/></g>',

  // Foundry — a ladle, and what comes out of it.
  ladle: '<path d="M11 15h29v7a14.5 14.5 0 0 1-29 0z"/><path d="M40 17h12v5H40z"/>'
       + '<path d="M25 41c0 0 8 8 8 12a8 8 0 0 1-16 0c0-4 8-12 8-12z"/>',

  // Skyline — three towers.
  towers: '<path d="M10 54V28h11v26zM25 54V12h14v42zM43 54V34h11v20z"/>',

  // Forge — an anvil.
  anvil: '<path d="M10 22h44v6c0 6-8 8-13 9v5h10v10H13V42h10v-5c-5-1-13-3-13-9z"/>',

  // Gulls — two wings, mid-flight.
  gull: '<g fill="none" stroke-width="6" stroke-linecap="round">'
      + '<path d="M8 36q12-16 24 0"/><path d="M32 36q12-16 24 0"/></g>',

  // Peaks — a ridge line with snow.
  peaks: '<path d="M4 50l16-26 9 14 10-18 21 30z"/>'
       + '<path d="M20 24l6 10-6 3-5-4zM39 20l6 10-7 3-5-5z" fill="{{P}}"/>',

  // Timber — a pine.
  pine: '<path d="M32 8l13 17h-7l11 14h-7l10 13H20l10-13h-7l11-14h-7z"/>'
      + '<path d="M28 52h8v6h-8z"/>',

  // Anchors.
  anchor: '<circle cx="32" cy="13" r="6" fill="none" stroke-width="4"/>'
        + '<path d="M29 19h6v33h-6z"/><path d="M19 25h26v6H19z"/>'
        + '<g fill="none" stroke-width="5" stroke-linecap="round">'
        + '<path d="M12 36c0 11 9 18 20 18s20-7 20-18"/></g>',

  // Comets — head and tail.
  comet: '<circle cx="42" cy="22" r="10"/>'
       + '<path d="M35 29 8 56l5-16 6 3 2-11z"/>',

  // Sentinels — a shield with a slot.
  shield: '<path d="M32 6l24 9v17c0 15-11 24-24 28C19 56 8 47 8 32V15z"/>'
        + '<path d="M32 18l12 12-5 5-7-7-7 7-5-5z" fill="{{P}}"/>',

  // Foxes — head, ears, eyes knocked out.
  fox: '<path d="M32 54 10 30l4-18 12 9h12l12-9 4 18z"/>'
     + '<path d="M22 31l6 5-5 4-5-5zM42 31l-6 5 5 4 5-5z" fill="{{P}}"/>',

  // Royals — a crown.
  crown: '<path d="M8 44h48l4-27-15 11-13-18-13 18-15-11z"/><path d="M10 47h44v8H10z"/>',

  // Monarchs — a monarch butterfly.
  butterfly: '<path d="M31 22c-6-11-23-13-25-2s7 21 15 23c-8 4-10 15-2 17s12-8 12-15z"/>'
           + '<path d="M33 22c6-11 23-13 25-2s-7 21-15 23c8 4 10 15 2 17s-12-8-12-15z"/>'
           + '<path d="M30 16h4v40h-4z"/>',

  // Coyotes — a paw print.
  paw: '<ellipse cx="17" cy="26" rx="6" ry="8"/><ellipse cx="29" cy="19" rx="6" ry="9"/>'
     + '<ellipse cx="42" cy="20" rx="6" ry="9"/><ellipse cx="52" cy="30" rx="6" ry="8"/>'
     + '<path d="M31 32c10 0 18 8 18 15 0 6-6 10-12 8-4-2-8-2-12 0-6 2-12-2-12-8 0-7 8-15 18-15z"/>',

  // Hawks — in flight.
  hawk: '<path d="M32 12a5 5 0 0 1 5 5c0 2-1 3-2 4 9-1 17-5 23-11-2 11-9 19-18 23l-8 19-8-19C15 29 8 21 6 10c6 6 14 10 23 11-1-1-2-2-2-4a5 5 0 0 1 5-5z"/>',

  // Storm — a bolt.
  bolt: '<path d="M36 4 12 36h14l-6 24 24-34H30z"/>',

  // Rangers — a five-point star in a ring.
  star: '<path d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2z"/>'
      + '<circle cx="32" cy="32" r="27" fill="none" stroke-width="3"/>',

  // Tides — a breaking wave.
  wave: '<path d="M6 40c10-22 26-28 40-20-10-2-16 2-20 8 8-3 15-1 20 4-12-2-20 4-24 12z"/>'
      + '<g fill="none" stroke-width="4" stroke-linecap="round"><path d="M10 52q11-8 22 0t22 0"/></g>',

  // Bruins — claw marks.
  claw: '<g transform="rotate(-8 32 32)">'
      + '<path d="M13 7c7 12 9 29 6 45l-9-8C8 31 8 19 13 7z"/>'
      + '<path d="M30 4c7 13 9 31 6 48l-9-8c-3-16-2-29 3-40z"/>'
      + '<path d="M47 7c7 12 9 29 6 45l-9-8c-3-15-2-27 3-37z"/></g>',

  // Guardians — a gate tower.
  helm: '<path d="M8 24h9v-8h9v8h12v-8h9v8h9v34H8z"/>'
      + '<path d="M32 32a11 11 0 0 1 11 11v15H21V43a11 11 0 0 1 11-11z" fill="{{P}}"/>',

  // Cyclones — a three-blade swirl.
  spiral: '<g><path d="M32 30c-2-12 4-22 16-26-7 9-8 18-5 25z"/>'
        + '<g transform="rotate(120 32 32)"><path d="M32 30c-2-12 4-22 16-26-7 9-8 18-5 25z"/></g>'
        + '<g transform="rotate(240 32 32)"><path d="M32 30c-2-12 4-22 16-26-7 9-8 18-5 25z"/></g></g>'
        + '<circle cx="32" cy="32" r="6"/>',

  // Owls — two eyes and a beak.
  owl: '<path d="M32 8c14 0 24 10 24 24S46 58 32 58 8 48 8 32 18 8 32 8z"/>'
     + '<circle cx="22" cy="27" r="9" fill="{{P}}"/><circle cx="42" cy="27" r="9" fill="{{P}}"/>'
     + '<circle cx="22" cy="27" r="4"/><circle cx="42" cy="27" r="4"/>'
     + '<path d="M32 34l6 10h-12z" fill="{{P}}"/>',

  // Surge — a pulse.
  pulse: '<g fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">'
       + '<path d="M6 34h10l7-18 10 34 7-16h18"/></g>',

  // Falcons — stooping, wings back.
  falcon: '<path d="M32 58 8 22l14 5 10-21 10 21 14-5z"/>'
        + '<path d="M32 20l5 12h-10z" fill="{{P}}"/>',

  // Pioneers — a covered wagon.
  wagon: '<path d="M10 38V26c0-8 10-13 22-13s22 5 22 13v12z"/>'
       + '<path d="M10 40h44v6H10z"/>'
       + '<circle cx="20" cy="52" r="6"/><circle cx="44" cy="52" r="6"/>'
       + '<circle cx="20" cy="52" r="2" fill="{{P}}"/><circle cx="44" cy="52" r="2" fill="{{P}}"/>',
};

/* Build a club's crest. The glyph strings are our own constants above, so
 * assembling them into markup introduces nothing a user supplied. */
function crestSVG(logo, title) {
  const glyph = (GLYPHS[logo.glyph] || GLYPHS.shield)
    .replaceAll("{{P}}", logo.primary)
    .replaceAll("{{S}}", logo.secondary);
  return `<svg viewBox="0 0 64 64" role="img" aria-label="${title}" focusable="false">`
    + `<circle cx="32" cy="32" r="32" fill="${logo.primary}"/>`
    + `<g fill="${logo.secondary}" stroke="${logo.secondary}" stroke-width="0">${glyph}</g>`
    + `</svg>`;
}

/* ------------------------------------------------------------------ *
 * Going somewhere
 *
 * A name on this site should take you to the thing it names. There is no
 * routing and no URL to point at, so these are `<button>`s rather than anchors:
 * an `<a href="#">` is a lie to a screen reader and a broken middle-click to
 * everybody else.
 *
 * Every one of them stops propagation. Several of the rows these sit inside own
 * a click of their own -- a fixture opens its tracker, a power-rankings row
 * opens its detail panel -- and a link that also fired the row's handler would
 * do two things for one press.
 * ------------------------------------------------------------------ */

/* Which club a player belongs to.
 *
 * Callers pass `teamId` whenever the surrounding context already knows it -- a
 * box score knows which side it is rendering -- because that is the only answer
 * that always exists. The lookups below cover the places that do not: the
 * season lines carry a team for everyone who has played, and a loaded squad
 * carries one for everyone on it, including the twelfth man a `min_games`
 * filter left out of the stats. */
function teamOfPlayer(playerId) {
  const line = statsByPlayer().get(playerId);
  if (line && line.team_id) return line.team_id;
  for (const team of state.teams.values()) {
    if ((team.players || []).some((p) => p.id === playerId)) return team.id;
  }
  return null;
}

function openTeam(teamId) {
  if (!teamId || !state.teams.has(teamId)) return;
  state.teamId = teamId;
  state.playerId = null;
  jumpToSquad();
}

function openPlayer(playerId, teamId) {
  const target = teamId || teamOfPlayer(playerId);
  if (!target || !state.teams.has(target)) return;
  state.teamId = target;
  state.playerId = playerId;
  jumpToSquad();
}

/* The squad page, showing whatever `state` was just pointed at.
 *
 * The position filter is cleared on the way in. It is a filter on the rail, and
 * `renderTeamDetail` falls back to the first player still showing -- so
 * arriving at a centre with the filter left on "Point Guard" would silently
 * open somebody else. */
function jumpToSquad() {
  state.posFilter = "";
  const filter = $("#pos-filter");
  if (filter) filter.value = "";
  const picker = $("#team-picker");
  if (picker) picker.value = state.teamId;
  setView("teams");
  renderTeamDetail();
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? "auto" : "smooth" });
}

function goLink(className, onClick, label) {
  const node = el("button", "golink" + (className ? " " + className : ""));
  node.type = "button";
  if (label) node.title = label;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    onClick();
  });
  return node;
}

/* A player's name, as a link to his page. `teamId` is optional and worth
 * passing when the caller knows it. `nameClass` is the class the name itself
 * wears -- null where the surrounding markup already styles it. */
function playerLink(name, playerId, teamId, className, nameClass = "player-name") {
  const node = goLink(className, () => openPlayer(playerId, teamId), name);
  node.appendChild(el("span", nameClass, name));
  return node;
}

/* A club, as a link to its squad. `content` fills the button -- a crest, a
 * name, or both -- so this works in a table cell and in a heading. */
function teamLink(teamId, content, className) {
  const team = state.teams.get(teamId);
  const node = goLink(className, () => openTeam(teamId),
    team ? `${team.city} ${team.name}` : teamId);
  content(node);
  return node;
}

/* A club's crest, or its abbreviation on a disc if it has none. */
function teamMark(team) {
  const mark = el("span", "team-mark");
  if (team.logo) {
    mark.classList.add("has-crest");
    mark.innerHTML = crestSVG(team.logo, `${team.city} ${team.name}`);
    return mark;
  }
  let hash = 0;
  for (const ch of team.abbr) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  mark.textContent = team.abbr;
  mark.style.setProperty("--mark-hue", String(hash));
  return mark;
}

/* One side of a fixture: crest, nickname, record. */
function scheduleTeam(team, side, score, winner) {
  const row = el("div", "sched-team" + (winner ? " is-winner" : ""));
  row.appendChild(teamMark(team));
  row.appendChild(el("span", "sched-name", team.name));
  if (side) row.appendChild(el("span", "sched-record", `${side.wins}-${side.losses}`));
  if (score !== undefined) row.appendChild(el("span", "sched-score", String(score)));
  return row;
}

/* The line under the pair: who leads each side in points, assists and
 * rebounds. Subordinate to the fixture itself, the way the reference layout
 * treats its own meta line. */
function schedulePreview(preview, awayTeam, homeTeam) {
  const wrap = el("div", "sched-preview");
  const away = preview.away.leaders;
  const home = preview.home.leaders;
  const rows = Math.max(away.length, home.length);

  for (let i = 0; i < rows; i += 1) {
    const line = el("div", "sched-preview-row");
    const label = (away[i] || home[i]).label;
    line.appendChild(el("span", "sched-preview-label", label));
    for (const [leader, team] of [[away[i], awayTeam], [home[i], homeTeam]]) {
      const cell = el("span", "sched-preview-cell");
      if (leader) {
        // The layout spans stay and the links go *inside* them. These are flex
        // items sized by rules that already exist -- `.sched-preview-name`
        // ellipsises, `.sched-preview-abbr` refuses to shrink -- and swapping
        // the span for a button moved that sizing onto an element with
        // `overflow: hidden`, whose automatic minimum size is zero. The name
        // collapsed to nothing and was unclickable.
        const abbr = el("span", "sched-preview-abbr");
        abbr.appendChild(teamLink(team.id, (node) => { node.textContent = team.abbr; }));
        cell.appendChild(abbr);

        const name = el("span", "sched-preview-name");
        name.appendChild(leader.playerId
          ? playerLink(leader.name, leader.playerId, team.id, null, null)
          : el("span", null, leader.name));
        cell.appendChild(name);

        cell.appendChild(el("span", "sched-preview-value",
          leader.unit === "stars" ? `${leader.value}★` : leader.value.toFixed(1)));
      }
      line.appendChild(cell);
    }
    wrap.appendChild(line);
  }
  return wrap;
}

/* What goes on the right of a fixture. The scores sit beside the clubs on the
 * left, so this says what *state* the game is in -- repeating the score here
 * would print it twice on the same row. */
function scheduleStatus(game) {
  const wrap = el("div", "sched-status");
  if (game.status === "live") {
    wrap.appendChild(el("span", "sched-live", "LIVE"));
  } else if (game.homeScore !== undefined) {
    wrap.appendChild(el("span", "sched-final", "FINAL"));
    wrap.appendChild(el("span", "sched-sub", tipoffTime(game)));
  } else {
    wrap.appendChild(el("span", "sched-time", tipoffTime(game)));
  }
  return wrap;
}

/* The schedule is one day's slate, laid out as a full-width list: each fixture
 * is the two clubs stacked, the tip-off time on the right, and the preview
 * underneath. Clicking one opens the tracker. */
function renderSchedule() {
  const rail = $("#schedule");
  rail.textContent = "";
  const games = dayGames();

  const heading = $("#schedule-day");
  if (heading) heading.textContent = state.data.day ? state.data.day.label : "Today";
  const count = $("#schedule-count");
  if (count) {
    const played = games.filter((g) => g.homeScore !== undefined).length;
    count.textContent = `${games.length} games · ${played} played`;
  }

  if (!games.length) {
    rail.appendChild(el("li", "rail-empty", "No games scheduled today."));
    return;
  }

  let currentSlot = null;
  for (const game of games) {
    const label = tipoffTime(game);
    if (label !== currentSlot) {
      currentSlot = label;
      rail.appendChild(el("li", "rail-date", label));
    }

    const home = state.teams.get(game.home);
    const away = state.teams.get(game.away);
    const played = game.homeScore !== undefined;
    const homeWon = played && game.homeScore > game.awayScore;

    const row = el("li", "fixture");
    row.tabIndex = 0;
    row.dataset.gameId = game.id;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", played
      ? `${away.city} ${away.name} at ${home.city} ${home.name}, final ${game.awayScore} to ${game.homeScore}`
      : `${away.city} ${away.name} at ${home.city} ${home.name}, ${label}`);

    const main = el("div", "sched-main");
    const teams = el("div", "sched-teams");
    teams.appendChild(scheduleTeam(away, game.preview && game.preview.away,
                                   played ? game.awayScore : undefined, played && !homeWon));
    teams.appendChild(scheduleTeam(home, game.preview && game.preview.home,
                                   played ? game.homeScore : undefined, homeWon));
    main.appendChild(teams);
    main.appendChild(scheduleStatus(game));
    row.appendChild(main);

    if (game.preview) row.appendChild(schedulePreview(game.preview, away, home));

    if (game.status === "live") row.classList.add("is-live-fixture");
    else if (!played) row.classList.add("is-upcoming");

    const open = () => selectGame(game.id);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    rail.appendChild(row);
  }
}

/* ------------------------------------------------------------------ *
 * Tracker
 * ------------------------------------------------------------------ */

async function selectGame(gameId) {
  let game = dayGames().find((g) => g.id === gameId);
  if (!game) return;

  stopPlayback();
  stopLivePolling();
  state.gameId = gameId;

  // On the static page the events are already here. Live they are fetched per
  // game -- 870 fixtures' worth would be tens of megabytes, and a game
  // restored from a save has a box score but no play-by-play at all.
  if (!game.events && game.homeScore !== undefined) {
    const detail = await state.source.gameDetail(gameId);
    // A slower fetch must not overwrite a game the user has since clicked past.
    if (state.gameId !== gameId) return;
    if (detail) {
      game = Object.assign(game, detail);
      const index = dayGames().findIndex((g) => g.id === gameId);
      if (index >= 0) state.data.day.games[index] = game;
    }
  }

  state.game = game;
  state.playhead = 0;
  state.cursor = 0;
  state.box = newBoxState(game);

  markSelectedFixture(gameId);
  showTracker(true);

  const home = state.teams.get(game.home);
  const away = state.teams.get(game.away);
  $("#home-abbr").textContent = home.abbr;
  $("#away-abbr").textContent = away.abbr;
  $("#home-city").textContent = `${home.city} ${home.name}`;
  $("#away-city").textContent = `${away.city} ${away.name}`;
  $("#flow-home-name").textContent = `${home.abbr} leads`;
  $("#flow-away-name").textContent = `${away.abbr} leads`;
  $("#feed").textContent = "";
  $("#tipoff-label").textContent = `${gameDate(game)} · ${game.round}`;

  setView("games");

  const detailed = Boolean(game.detailed && game.events && game.events.length);
  $("#tracker-body").hidden = !detailed;
  $("#no-detail").hidden = detailed;
  if (!detailed) {
    showResultOnly(game);
    return;
  }

  /* Playback speed depends on what you are watching. A live game runs at real
   * time -- it is happening now, and the point is to follow it. A finished one
   * is a replay, and there is nothing to stay in sync with, so it opens fast
   * enough to actually watch. Either way the transport can override it. */
  state.speed = game.live ? 1 : 30;
  const speedPicker = $("#speed");
  if (speedPicker) speedPicker.value = String(state.speed);

  // Opening a game already in progress joins it *now*, not at tip-off. At
  // real-time speed a playhead started from zero would sit however long the
  // game has been running behind the live edge and never catch up.
  if (game.live && game.events.length) {
    advanceTo(game.events[game.events.length - 1][E_SECONDS]);
  }

  renderTracker();
  startPlayback();
  // A game in progress keeps arriving. Poll for the rest of it.
  if (game.live) startLivePolling(gameId);
}

/* No play-by-play to show: a fixture that has not tipped off, or a finished
 * game restored from a save, which keeps its box score but not its commentary. */
function showResultOnly(game) {
  const played = game.homeScore !== undefined;
  $("#away-score").textContent = played ? String(game.awayScore) : "–";
  $("#home-score").textContent = played ? String(game.homeScore) : "–";
  $("#period").textContent = played ? "FT" : "—";
  $("#clock").textContent = played ? "00.0" : "12:00";
  $("#game-state").textContent = played ? "Final" : "Scheduled";
  $("#game-state").classList.remove("is-live");
  $("#away-abbr").parentElement.classList.toggle("is-leading", played && game.awayScore > game.homeScore);
  $("#home-abbr").parentElement.classList.toggle("is-leading", played && game.homeScore > game.awayScore);

  const note = $("#no-detail-text");
  if (note) {
    note.textContent = played
      ? "This game finished before the app was last restarted. Box scores are saved; the play-by-play is not — a full season of it is about 90MB."
      : "This game has not tipped off yet. Advance the league clock to play it.";
  }
}

function revealedEvents() {
  return state.game.events.slice(0, state.cursor);
}

function advanceTo(seconds) {
  const events = state.game.events || [];
  if (!events.length) return;
  state.playhead = Math.max(0, seconds);
  const feed = $("#feed");
  let appended = 0;

  while (state.cursor < events.length && events[state.cursor][E_SECONDS] <= state.playhead) {
    const event = events[state.cursor];
    applyEvent(state.box, event);
    feed.prepend(feedRow(event, appended < 12 && !REDUCED_MOTION));
    state.cursor += 1;
    appended += 1;
  }

  // Keep the DOM bounded on fast-forward; the box score already has the totals.
  while (feed.childElementCount > 400) feed.lastElementChild.remove();

  if (state.cursor >= events.length) {
    state.playhead = events[events.length - 1][E_SECONDS];
    stopPlayback();
  }

  // The scrub bar tracks the playhead continuously; everything else only has
  // to redraw when a play actually landed.
  updateScrub();
  if (appended > 0 || !state.playing) renderTracker();
}

function updateScrub() {
  const duration = state.game.duration || 1;
  $("#scrub").value = String(Math.round(Math.min(1, state.playhead / duration) * 1000));
}

const META_TYPES = new Set([
  EV.GAME_START, EV.PERIOD_START, EV.PERIOD_END, EV.JUMP_BALL,
  EV.SUBSTITUTION, EV.TIMEOUT, EV.GAME_END,
]);

function feedRow(event, animate) {
  const row = el("li", "play");
  if (META_TYPES.has(event[E_TYPE])) row.classList.add("is-meta");
  if (event[E_TYPE] === EV.SHOT_MADE || event[E_TYPE] === EV.FT_MADE) row.classList.add("is-score");
  if (event[E_POINTS] === 3 || (event[E_FLAGS] & FLAG_AND_ONE)) row.classList.add("is-big");
  if (animate) row.classList.add("is-new");

  const teamId = event[E_TEAM];
  const side = teamId === state.game.home ? "home" : teamId === state.game.away ? "away" : null;
  if (side) row.classList.add(`side-${side}`);

  row.appendChild(el("span", "play-clock", `${periodLabel(event[E_PERIOD])} ${event[E_CLOCK]}`));
  row.appendChild(el("span", "play-score", `${event[E_AWAY]}–${event[E_HOME]}`));
  row.appendChild(el("span", "play-text", event[E_DESC]));
  return row;
}

function periodLabel(period) {
  return period <= 4 ? `Q${period}` : `OT${period - 4}`;
}

function renderTracker() {
  const game = state.game;
  const last = state.cursor > 0 ? game.events[state.cursor - 1] : null;
  const homeScore = last ? last[E_HOME] : 0;
  const awayScore = last ? last[E_AWAY] : 0;

  setScore("#home-score", homeScore);
  setScore("#away-score", awayScore);
  $("#home-abbr").parentElement.classList.toggle("is-leading", homeScore > awayScore);
  $("#away-abbr").parentElement.classList.toggle("is-leading", awayScore > homeScore);

  $("#period").textContent = last ? periodLabel(last[E_PERIOD]) : "Q1";
  $("#clock").textContent = last ? last[E_CLOCK] : "12:00";

  // Caught up with the events we *have* is not the same as the game being
  // over: a live game is watched at the front of a stream that is still
  // arriving, so reaching the last revealed play means you are up to date.
  const caughtUp = state.cursor >= game.events.length;
  const done = caughtUp && !game.live;
  const pill = $("#game-state");
  pill.textContent = done ? "Final" : "Live";
  pill.classList.toggle("is-live", !done);

  updateScrub();
  drawFlow();
  if (state.tab === "box") renderBox();
}

function setScore(selector, value) {
  const node = $(selector);
  const text = String(value);
  if (node.textContent === text) return;
  node.textContent = text;
  if (REDUCED_MOTION) return;
  node.classList.remove("just-scored");
  void node.offsetWidth;
  node.classList.add("just-scored");
}

/* ------------------------------------------------------------------ *
 * Game flow chart — margin over game time, diverging around a tied game
 * ------------------------------------------------------------------ */

const FLOW = { width: 1000, height: 132, padTop: 10, padBottom: 18 };

function drawFlow() {
  const game = state.game;
  const svg = $("#flow");
  const duration = game.duration || 1;

  // One point per scoring change is enough and keeps the path light.
  const points = [{ t: 0, margin: 0, home: 0, away: 0, clock: "12:00", period: 1 }];
  for (let i = 0; i < state.cursor; i += 1) {
    const e = game.events[i];
    const margin = e[E_HOME] - e[E_AWAY];
    const prev = points[points.length - 1];
    if (margin !== prev.margin || i === state.cursor - 1) {
      points.push({
        t: e[E_SECONDS], margin, home: e[E_HOME], away: e[E_AWAY],
        clock: e[E_CLOCK], period: e[E_PERIOD],
      });
    }
  }

  const peak = Math.max(8, ...game.events.map((e) => Math.abs(e[E_HOME] - e[E_AWAY])));
  const x = (t) => (t / duration) * FLOW.width;
  const plotHeight = FLOW.height - FLOW.padTop - FLOW.padBottom;
  const zeroY = FLOW.padTop + plotHeight / 2;
  const y = (margin) => zeroY - (margin / peak) * (plotHeight / 2);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.margin).toFixed(1)}`).join("");
  const lastX = x(points[points.length - 1].t).toFixed(1);

  $("#clip-above").firstElementChild.setAttribute("height", String(zeroY));
  const below = $("#clip-below").firstElementChild;
  below.setAttribute("y", String(zeroY));
  below.setAttribute("height", String(FLOW.height - zeroY));

  $("#flow-home-area").setAttribute("d", `${line}L${lastX},${zeroY}L0,${zeroY}Z`);
  $("#flow-away-area").setAttribute("d", `${line}L${lastX},${zeroY}L0,${zeroY}Z`);
  $("#flow-line").setAttribute("d", line);
  $("#flow-zero").setAttribute("d", `M0,${zeroY}L${FLOW.width},${zeroY}`);

  // Period dividers, so the shape of the game maps to quarters.
  const marks = $("#flow-periods");
  marks.textContent = "";
  const periodEnds = new Map();
  for (const e of game.events) {
    if (e[E_TYPE] === EV.PERIOD_END) periodEnds.set(e[E_PERIOD], e[E_SECONDS]);
  }
  for (const [period, t] of periodEnds) {
    if (period >= game.periods) continue;
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "line");
    mark.setAttribute("x1", x(t)); mark.setAttribute("x2", x(t));
    mark.setAttribute("y1", FLOW.padTop); mark.setAttribute("y2", FLOW.height - FLOW.padBottom);
    mark.setAttribute("class", "flow-period");
    marks.appendChild(mark);
  }

  const current = points[points.length - 1];
  const leaderId = current.margin > 0 ? game.home : current.margin < 0 ? game.away : null;
  const leader = leaderId ? state.teams.get(leaderId).abbr : null;
  $("#flow-label").textContent = leader
    ? `${leader} +${Math.abs(current.margin)}`
    : "Tied";
  $("#flow-peak").textContent = `peak margin ${peak}`;

  state.flowPoints = points;
  state.flowScale = { x, y, duration, zeroY };
}

function bindFlowHover() {
  const svg = $("#flow");
  const readout = $("#flow-readout");
  const cursor = $("#flow-cursor");

  const move = (event) => {
    if (!state.flowPoints || state.flowPoints.length < 2) return;
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const t = Math.max(0, Math.min(1, ratio)) * state.flowScale.duration;

    let point = state.flowPoints[0];
    for (const candidate of state.flowPoints) {
      if (candidate.t <= t) point = candidate; else break;
    }
    const game = state.game;
    const away = state.teams.get(game.away).abbr;
    const home = state.teams.get(game.home).abbr;
    cursor.setAttribute("x1", state.flowScale.x(point.t));
    cursor.setAttribute("x2", state.flowScale.x(point.t));
    cursor.setAttribute("y1", FLOW.padTop);
    cursor.setAttribute("y2", FLOW.height - FLOW.padBottom);
    cursor.style.opacity = "1";
    readout.textContent =
      `${periodLabel(point.period)} ${point.clock} · ${away} ${point.away}–${point.home} ${home}`;
  };

  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", () => {
    cursor.style.opacity = "0";
    readout.textContent = "";
  });
}

/* ------------------------------------------------------------------ *
 * Box score
 * ------------------------------------------------------------------ */

const BOX_COLUMNS = [
  ["min", "MIN"], ["points", "PTS"], ["reb", "REB"], ["ast", "AST"],
  ["fg", "FG"], ["tp", "3P"], ["ft", "FT"],
  ["stl", "STL"], ["blk", "BLK"], ["tov", "TO"], ["pf", "PF"],
];

function cellValue(line, key) {
  switch (key) {
    case "min": return formatMinutes(line.seconds);
    case "reb": return line.oreb + line.dreb;
    case "fg": return `${line.fgm}-${line.fga}`;
    case "tp": return `${line.tpm}-${line.tpa}`;
    case "ft": return `${line.ftm}-${line.fta}`;
    default: return line[key];
  }
}

function formatMinutes(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* Who a player id belongs to, for a screen that only has ids.
 *
 * The game's own `roster` first, then the squad index. The order matters: a
 * game carries the twenty-four men who played it, while `state.players` is
 * filled in only as squads are fetched -- which the live app does when you open
 * the Teams tab and not before. Reading the squad index alone is what printed
 * "NCI-04" in a live box score next to a play-by-play that knew his name.
 *
 * The id is the last resort rather than a blank, because a row with no label at
 * all is worse than one you can still tell apart. */
function playerLabel(playerId, game) {
  const entry = game && game.roster && game.roster[playerId];
  if (entry) return { name: entry[0], pos: entry[1] };
  const player = state.players.get(playerId);
  if (player) return { name: player.name, pos: player.pos };
  return { name: playerId, pos: "" };
}

function renderBox() {
  const container = $("#box");
  container.textContent = "";
  const game = state.game;

  for (const [key, teamId] of [["away", game.away], ["home", game.home]]) {
    const side = state.box[key];
    const team = state.teams.get(teamId);
    const lines = [...side.lines.values()]
      .filter((l) => l.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);

    const block = el("section", "box-team");
    const heading = el("h3", "box-heading");
    heading.appendChild(el("span", `box-dot side-${key}`));
    heading.appendChild(teamLink(teamId, (node) => {
      node.appendChild(el("span", "box-name", team.city + " " + team.name));
    }));
    heading.appendChild(el("span", "box-points", String(sideTotals(side).points)));
    block.appendChild(heading);

    const scroll = el("div", "table-scroll");
    const table = el("table", "stat-table");
    const thead = el("thead");
    const headRow = el("tr");
    headRow.appendChild(el("th", "col-name", "Player"));
    for (const [, label] of BOX_COLUMNS) headRow.appendChild(el("th", null, label));
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el("tbody");
    for (const l of lines) {
      const who = playerLabel(l.playerId, game);
      const row = el("tr");
      if (side.onCourt.has(l.playerId)) row.classList.add("is-on-court");
      const nameCell = el("td", "col-name");
      nameCell.appendChild(el("span", "player-pos", who.pos));
      nameCell.appendChild(playerLink(who.name, l.playerId, teamId));
      row.appendChild(nameCell);
      for (const [key2] of BOX_COLUMNS) row.appendChild(el("td", null, String(cellValue(l, key2))));
      tbody.appendChild(row);
    }
    table.appendChild(tbody);

    const totals = sideTotals(side);
    const tfoot = el("tfoot");
    const footRow = el("tr");
    footRow.appendChild(el("td", "col-name", "Team"));
    for (const [key2] of BOX_COLUMNS) {
      footRow.appendChild(el("td", null, key2 === "min" ? "" : String(cellValue(totals, key2))));
    }
    tfoot.appendChild(footRow);
    table.appendChild(tfoot);

    scroll.appendChild(table);
    block.appendChild(scroll);
    container.appendChild(block);
  }
}

/* ------------------------------------------------------------------ *
 * Stats: sortable per-game tables for players and teams
 * ------------------------------------------------------------------ */

/* The stat tabs. Each names the column it sorts by, so picking a tab is the
 * same action as sorting -- the table below stays fully sortable by header
 * click for anything not on the tab strip. */
const STAT_TABS = [
  ["points", "Points"],
  ["rebounds", "Rebounds"],
  ["assists", "Assists"],
  ["steals", "Steals"],
  ["blocks", "Blocks"],
  ["minutes", "Minutes"],
  ["fg_pct", "FG%"],
  ["tp_pct", "3P%"],
  ["ft_pct", "FT%"],
  ["turnovers", "Turnovers"],
];

const PERCENT_KEYS = new Set(["fg_pct", "tp_pct", "ft_pct", "win_pct"]);

// Counts that really are whole numbers; everything else is a per-game rate and
// reads wrong without a decimal ("8" beside "8.4").
const WHOLE_KEYS = new Set(["games", "wins", "losses"]);

// Win shares per 48 is the one advanced column that lives below 1 and needs
// the extra places to say anything.
const THREE_PLACE_KEYS = new Set(["ws48"]);

function formatStat(key, value) {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  if (THREE_PLACE_KEYS.has(key)) return value.toFixed(3).replace(/^0/, "");
  if (PERCENT_KEYS.has(key)) return value.toFixed(3).replace(/^0/, "");
  if (WHOLE_KEYS.has(key)) return String(Math.round(value));
  return value.toFixed(1);
}

function statsRows() {
  if (state.statsScope === "teams") return state.data.teamStats;
  if (state.statsScope === "advanced") return state.data.advancedStats || [];
  return state.data.playerStats;
}

function statsColumns() {
  // The advanced table is columns-from-the-payload: `bballsim/league/advanced.py`
  // owns which stats exist and what they are called, so adding one there puts
  // it on this page without touching the front end.
  if (state.statsScope === "advanced") {
    return [
      { key: "name", label: "Player", text: true },
      { key: "position", label: "POS", text: true },
      { key: "games", label: "GP" },
      { key: "minutes", label: "MIN" },
      ...(state.data.advancedColumns || []).map((c) => ({ key: c.key, label: c.label })),
    ];
  }
  const base = state.statsScope === "teams"
    ? [
        { key: "abbreviation", label: "Team", text: true },
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "win_pct", label: "PCT" },
        { key: "points_against", label: "OPP" },
        { key: "point_differential", label: "DIFF" },
      ]
    : [
        { key: "name", label: "Player", text: true },
        { key: "position", label: "POS", text: true },
        { key: "team_id", label: "Team", text: true },
        { key: "games", label: "GP" },
      ];
  return base.concat(
    state.data.statColumns
      .filter((c) => !(state.statsScope === "teams" && c.key === "minutes"))
      .map((c) => ({ key: c.key, label: c.label }))
  );
}

function renderStats() {
  const columns = statsColumns();
  const rows = [...statsRows()];
  const sortKey = state.statsSort;
  const descending = state.statsDescending;
  const column = columns.find((c) => c.key === sortKey);

  rows.sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    if (column && column.text) {
      return descending
        ? String(right).localeCompare(String(left))
        : String(left).localeCompare(String(right));
    }
    return descending ? right - left : left - right;
  });

  // Tabs reflect the active sort.
  $$("#stat-tabs .stat-tab").forEach((tab) => {
    const active = tab.dataset.stat === sortKey;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$("#stats-scope button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scope === state.statsScope);
  });

  const table = $("#stats-table");
  table.textContent = "";

  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", "col-rank", "#"));
  for (const col of columns) {
    const th = el("th", col.text ? "col-name" : null);
    const button = el("button", "sort-button", col.label);
    if (col.key === sortKey) {
      button.classList.add("is-sorted");
      button.appendChild(el("span", "sort-arrow", descending ? "▾" : "▴"));
    }
    button.onclick = () => {
      if (state.statsSort === col.key) state.statsDescending = !state.statsDescending;
      else { state.statsSort = col.key; state.statsDescending = !col.text; }
      renderStats();
    };
    th.appendChild(button);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  rows.forEach((row, index) => {
    const tr = el("tr");
    tr.appendChild(el("td", "col-rank", String(index + 1)));
    for (const col of columns) {
      if (col.key === "name") {
        // Only the player and advanced tables have this column; the team table
        // identifies a club by its abbreviation, handled just below.
        const cell = el("td", "col-name");
        cell.appendChild(playerLink(row.name, row.player_id, row.team_id));
        tr.appendChild(cell);
      } else if (col.key === "team_id" || col.key === "abbreviation") {
        const label = col.key === "team_id"
          ? (state.teams.get(row.team_id) || {}).abbr || row.team_id
          : row.abbreviation;
        const cell = el("td", "col-name");
        cell.appendChild(teamLink(row.team_id, (node) =>
          node.appendChild(el("span", "player-pos", label))));
        tr.appendChild(cell);
      } else if (col.text) {
        const cell = el("td", "col-name");
        cell.appendChild(el("span", "player-pos", String(row[col.key])));
        tr.appendChild(cell);
      } else {
        const cell = el("td", col.key === sortKey ? "is-sorted-cell" : null,
          formatStat(col.key, row[col.key]));
        tr.appendChild(cell);
      }
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  $("#stats-caption").textContent = state.statsScope === "teams"
    ? `${rows.length} teams · per game`
    : `${rows.length} players with 5+ games · per game`;
}

function buildStatTabs() {
  const strip = $("#stat-tabs");
  strip.textContent = "";
  for (const [key, label] of STAT_TABS) {
    const tab = el("button", "stat-tab", label);
    tab.dataset.stat = key;
    tab.setAttribute("role", "tab");
    tab.onclick = () => {
      state.statsSort = key;
      state.statsDescending = true;
      renderStats();
    };
    strip.appendChild(tab);
  }
  $$("#stats-scope button").forEach((button) => {
    button.onclick = () => {
      state.statsScope = button.dataset.scope;
      state.statsSort = state.statsScope === "advanced" ? "per" : "points";
      state.statsDescending = true;
      renderStats();
    };
  });
}

/* ------------------------------------------------------------------ *
 * Home: the wire
 *
 * The feed arrives already ranked and de-duplicated by `bballsim/news.py`.
 * All this does is lay it out: the lead story gets the top of the page, the
 * rest go into cards, and every card can be opened to read the article. Nothing
 * here composes a sentence -- if a number is on this page, Python put it there.
 * ------------------------------------------------------------------ */

/* Importance is 1-100. It drives the accent on a card, so a triple-double and
 * a routine recap do not look alike at a glance. */
function importanceClass(score) {
  if (score >= 85) return "is-major";
  if (score >= 70) return "is-notable";
  return "is-routine";
}

function storyDay(story) {
  if (!story.day) return "";
  // A bare ISO date is midnight UTC; parsed locally it can slip a day.
  const [y, m, d] = story.day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function storyBody(story) {
  const body = el("div", "story-body");
  story.article.split("\n\n").forEach((block) => {
    body.appendChild(el("p", null, block));
  });
  return body;
}

/* A story card. The headline and standfirst are always visible; the article
 * opens in place, because a home page that navigates away to read 180 words is
 * a home page nobody reads twice. */
function storyCard(story, lead) {
  const card = el("article", `story ${importanceClass(story.importance)}`);
  if (lead) card.classList.add("is-lead");

  const meta = el("div", "story-meta");
  meta.appendChild(el("span", "story-tag", story.category));
  const day = storyDay(story);
  if (day) meta.appendChild(el("span", "story-day", day));
  card.appendChild(meta);

  card.appendChild(el("h3", "story-headline", story.headline));
  card.appendChild(el("p", "story-standfirst", story.subheadline));

  // Crests for the clubs involved, so a fixture is recognisable before reading.
  const clubs = (story.teamIds || []).map((id) => state.teams.get(id)).filter(Boolean);
  // Whoever the story is about, named and linked. The article names them in
  // prose too, but prose is not a link -- and matching names back out of a
  // paragraph to make it one would mangle an article the first time somebody
  // was called Brooks and played for the Brooks.
  const cast = (story.playerIds || [])
    .map((id) => [id, statsByPlayer().get(id)])
    .filter(([, line]) => line);

  if (clubs.length || cast.length) {
    const marks = el("div", "story-clubs");
    clubs.forEach((team) => {
      marks.appendChild(teamLink(team.id, (node) => {
        node.appendChild(teamMark(team));
        node.appendChild(el("span", "story-club-abbr", team.abbr));
      }, "story-club"));
    });
    cast.forEach(([id, line]) => {
      marks.appendChild(playerLink(line.name, id, line.team_id, "story-club is-player"));
    });
    card.appendChild(marks);
  }

  const details = el("details", "story-full");
  const toggle = el("summary", null, "Read the full story");
  details.appendChild(toggle);
  details.appendChild(storyBody(story));
  if (lead) details.open = true;
  card.appendChild(details);

  if (story.gameId) {
    const link = el("button", "story-link", "Open the game");
    link.addEventListener("click", () => {
      setView("games");
      selectGame(story.gameId);
    });
    card.appendChild(link);
  }
  return card;
}

function renderWire() {
  const stories = state.data.news || [];
  const grid = $("#wire-grid");
  const lead = $("#wire-lead");
  const empty = $("#wire-empty");
  grid.textContent = "";
  lead.textContent = "";

  if (!stories.length) {
    lead.hidden = true;
    empty.hidden = false;
    $("#wire-day").textContent = "";
    return;
  }
  empty.hidden = true;
  lead.hidden = false;

  const [top, ...rest] = stories;
  lead.appendChild(storyCard(top, true));
  rest.forEach((story) => grid.appendChild(storyCard(story, false)));

  const day = storyDay(top);
  $("#wire-day").textContent = day
    ? `${stories.length} stories · latest ${day}`
    : `${stories.length} stories`;
}

/* ------------------------------------------------------------------ *
 * Standings & teams
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 * Playoffs
 *
 * The bracket arrives already assembled from `bballsim/league/playoffs.py`,
 * which derives it from the fixtures rather than storing it. All this does is
 * lay the rounds out left to right.
 * ------------------------------------------------------------------ */

function seriesRow(series) {
  const box = el("div", "series" + (series.complete ? " is-done" : ""));
  for (const side of ["high", "low"]) {
    const id = series[side + "Seed"];
    const team = state.teams.get(id);
    const wins = series[side + "Wins"];
    const won = series.winner === id;
    const line = el("div", "series-side" + (won ? " is-winner" : ""));
    line.appendChild(el("span", "series-seed", String(series[side + "Rank"] || "")));
    if (team) {
      line.appendChild(teamLink(id, (node) => {
        node.appendChild(teamMark(team));
        node.appendChild(el("span", "series-abbr", team.abbr));
      }, "series-club"));
    } else {
      line.appendChild(el("span", "series-abbr", id));
    }
    line.appendChild(el("span", "series-wins", String(wins)));
    box.appendChild(line);
  }
  const played = series.games.filter((g) => g.status === "final").length;
  box.appendChild(el("div", "series-meta",
    series.complete ? `${played} games` : (played ? `${played} played` : "to come")));
  return box;
}

/* Every season the league has finished, and who won it. Hidden until there is
 * one -- a roll of honour with nothing on it is not a roll of honour. */
function renderHonours() {
  const card = $("#honours-card");
  const table = $("#honours");
  if (!card || !table) return;
  const done = (state.data.seasons || []).filter((s) => s.complete && s.champion);
  if (!done.length) { card.hidden = true; return; }
  card.hidden = false;
  table.textContent = "";

  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["SEASON", "CHAMPION", "RUNNER-UP"]) {
    headRow.appendChild(el("th", label === "SEASON" ? "col-name" : null, label));
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el("tbody");
  for (const row of [...done].reverse()) {
    const tr = el("tr");
    tr.appendChild(el("td", "col-name", row.season));
    for (const id of [row.champion, row.runnerUp]) {
      const team = state.teams.get(id);
      const cell = el("td");
      if (team) {
        cell.appendChild(teamLink(id, (node) => {
          node.appendChild(teamMark(team));
          node.appendChild(el("span", null, ` ${team.city} ${team.name}`));
        }));
      } else {
        cell.textContent = "—";
      }
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
}

function renderBracket() {
  const holder = $("#bracket");
  const empty = $("#bracket-empty");
  const note = $("#bracket-note");
  const legend = $("#bracket-legend");
  if (!holder) return;
  holder.textContent = "";
  const data = state.data.playoffs || { started: false, rounds: [] };

  if (!data.started) {
    empty.hidden = false;
    if (note) note.textContent = "";
    if (legend) legend.textContent = "";
    return;
  }
  empty.hidden = true;

  for (const round of data.rounds) {
    const column = el("div", "bracket-round");
    column.appendChild(el("h3", "bracket-round-name", round.round));
    // Conference-by-conference inside a round, so the two halves of the
    // bracket read as two halves rather than one list of eight.
    const byConference = new Map();
    for (const series of round.series) {
      const key = series.conference || "";
      if (!byConference.has(key)) byConference.set(key, []);
      byConference.get(key).push(series);
    }
    for (const [conference, list] of byConference) {
      if (conference) column.appendChild(el("p", "bracket-conf", conference));
      list.forEach((series) => column.appendChild(seriesRow(series)));
    }
    holder.appendChild(column);
  }

  const champion = data.champion ? state.teams.get(data.champion) : null;
  if (note) {
    note.textContent = champion
      ? `${champion.city} ${champion.name} — Keystone Champions`
      : `${data.rounds.length} of 4 rounds`;
  }
  if (legend) {
    legend.textContent = "Eight clubs from each conference, seeded on regular-season "
      + "record. 1v8, 2v7, 3v6, 4v5, best of seven, home court 2-2-1-1-1 to the "
      + "higher seed. The two conference champions meet in the Keystone Finals.";
  }
}

/* ------------------------------------------------------------------ *
 * Power rankings
 *
 * Who is playing the best basketball right now, as opposed to who has won
 * the most games — which is the table next to it. The rating and its ten
 * components arrive already computed from `bballsim/league/power.py`; this
 * lays them out and shows the working when a row is opened.
 * ------------------------------------------------------------------ */

function movementCell(row) {
  const cell = el("td", "power-move");
  const move = row.movement;
  if (move === null || move === undefined) {
    cell.appendChild(el("span", "move-new", "NEW"));
  } else if (move > 0) {
    cell.appendChild(el("span", "move-up", `▲${move}`));
  } else if (move < 0) {
    cell.appendChild(el("span", "move-down", `▼${-move}`));
  } else {
    cell.appendChild(el("span", "move-flat", "—"));
  }
  return cell;
}

function tierClass(tier) {
  return "tier-" + tier.toLowerCase().replace(/[^a-z]+/g, "-");
}

function renderPower() {
  const power = state.data.power || { current: [] };
  const rows = power.current || [];
  const table = $("#power-table");
  const empty = $("#power-empty");
  const note = $("#power-note");
  table.textContent = "";

  if (!rows.length) {
    empty.hidden = false;
    note.textContent = "";
    $("#power-detail-card").hidden = true;
    return;
  }
  empty.hidden = true;

  const head = el("thead");
  const headRow = el("tr");
  for (const [label, cls] of [["#", "col-rank"], ["", null], ["Team", "col-name"],
                              ["W-L", null], ["L10", null], ["STRK", null],
                              ["RATING", null], ["TIER", "col-name"]]) {
    headRow.appendChild(el("th", cls, label));
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el("tbody");
  for (const row of rows) {
    const team = state.teams.get(row.teamId);
    const tr = el("tr", "power-row" + (row.teamId === state.powerTeam ? " is-selected" : ""));
    tr.appendChild(el("td", "col-rank", String(row.rank)));
    tr.appendChild(movementCell(row));

    const nameCell = el("td", "col-name power-team");
    if (team) nameCell.appendChild(teamMark(team));
    const label = el("span", "power-name", team ? `${team.city} ${team.name}` : row.teamId);
    nameCell.appendChild(label);
    // The two marks the brief asks for, and they only mean something once a
    // club has a season behind it to be the best or worst of.
    if (row.isSeasonBest) nameCell.appendChild(el("span", "power-flag", "SEASON BEST"));
    else if (row.isSeasonWorst) nameCell.appendChild(el("span", "power-flag is-worst", "SEASON WORST"));
    tr.appendChild(nameCell);

    tr.appendChild(el("td", null, `${row.wins}-${row.losses}`));
    tr.appendChild(el("td", null, row.lastTen));
    tr.appendChild(el("td", "power-streak" + (row.streakValue > 0 ? " is-hot" : row.streakValue < 0 ? " is-cold" : ""), row.streak));
    tr.appendChild(el("td", "power-rating", row.rating.toFixed(1)));
    tr.appendChild(el("td", "col-name " + tierClass(row.tier), row.tier));

    tr.addEventListener("click", () => {
      state.powerTeam = row.teamId;
      renderPower();
    });
    body.appendChild(tr);
  }
  table.appendChild(body);

  note.textContent = "Rated on ten weighted components — recent form carries the most, "
    + "and every game is weighted by how recently it was played. Click a club to see "
    + "which parts of the rating put it there.";

  renderPowerDetail(rows);
}

function statLine(list, term, value) {
  list.appendChild(el("dt", null, term));
  list.appendChild(el("dd", null, String(value)));
}

function renderPowerDetail(rows) {
  const card = $("#power-detail-card");
  const row = rows.find((r) => r.teamId === state.powerTeam);
  if (!row) { card.hidden = true; return; }
  card.hidden = false;
  const team = state.teams.get(row.teamId);
  // The name is the link here rather than the table row, because the row
  // already has a job -- clicking it is what opened this panel.
  const title = $("#power-detail-name");
  title.textContent = "";
  title.appendChild(teamLink(row.teamId, (node) =>
    node.appendChild(el("span", null, team ? `${team.city} ${team.name}` : row.teamId))));
  $("#power-detail-tier").textContent = `${row.tier} · rating ${row.rating.toFixed(1)}`;

  const holder = $("#power-detail");
  holder.textContent = "";

  const facts = el("dl", "power-facts");
  statLine(facts, "Current", `#${row.rank}`);
  statLine(facts, "Previous", row.previousRank ? `#${row.previousRank}` : "—");
  statLine(facts, "Best", `#${row.bestRank}`);
  statLine(facts, "Worst", `#${row.worstRank}`);
  statLine(facts, "Average", `#${row.averageRank}`);
  statLine(facts, "Net rating", row.netRating.toFixed(1));
  statLine(facts, "Offensive", row.offensiveRating.toFixed(1));
  statLine(facts, "Defensive", row.defensiveRating.toFixed(1));
  statLine(facts, "Home", row.homeRecord);
  statLine(facts, "Away", row.awayRecord);
  statLine(facts, "Last 10", row.lastTen);
  statLine(facts, "Streak", row.streak);
  statLine(facts, "Longest win run", row.bestWinStreak);
  statLine(facts, "Longest losing run", row.worstLossStreak);
  if (team && team.coach) statLine(facts, "Coach", team.coach.name);
  holder.appendChild(facts);

  // The working: which of the ten components carried the rating, weighted.
  const labels = (state.data.power || {}).componentLabels || {};
  const weights = (state.data.power || {}).weights || {};
  const bars = el("div", "power-components");
  bars.appendChild(el("p", "label", "What makes up the rating"));
  const ordered = Object.keys(weights).sort((a, b) => weights[b] - weights[a]);
  for (const key of ordered) {
    const value = row.components[key];
    if (value === undefined) continue;
    const line = el("div", "power-bar");
    line.appendChild(el("span", "power-bar-label",
      `${labels[key] || key} · ${Math.round(weights[key] * 100)}%`));
    const track = el("span", "power-bar-track");
    const fill = el("span", "power-bar-fill");
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    track.appendChild(fill);
    line.appendChild(track);
    line.appendChild(el("span", "power-bar-value", value.toFixed(0)));
    bars.appendChild(line);
  }
  holder.appendChild(bars);

  const notes = el("div", "power-notes");
  if (row.qualityWins && row.qualityWins.length) {
    notes.appendChild(el("p", "label", "Recent quality wins"));
    for (const win of row.qualityWins.slice().reverse()) {
      const other = state.teams.get(win.opponent);
      notes.appendChild(el("p", "power-note-line",
        `beat ${other ? other.name : win.opponent} by ${win.margin} — ${win.reasons.join(", ")}`));
    }
  }
  if (row.badLosses && row.badLosses.length) {
    notes.appendChild(el("p", "label", "Recent bad losses"));
    for (const loss of row.badLosses.slice().reverse()) {
      const other = state.teams.get(loss.opponent);
      notes.appendChild(el("p", "power-note-line is-bad",
        `lost to ${other ? other.name : loss.opponent} by ${-loss.margin} — ${loss.reasons.join(", ")}`));
    }
  }
  if (notes.childNodes.length) holder.appendChild(notes);
}

function renderStandings() {
  const tbody = $("#standings-body");
  tbody.textContent = "";
  const rows = state.data.standings || [];
  const conferences = state.data.conferences
    || [...new Set(rows.map((r) => r.conference).filter(Boolean))];

  /* Grouped by conference, because that is the unit that matters: seeding,
   * the bracket and who is playing in May are all decided inside fifteen
   * clubs, not thirty. A flat table of all thirty answers a question nobody
   * asks. */
  const groups = conferences.length
    ? conferences.map((name) => [name, rows.filter((r) => r.conference === name)])
    : [[null, rows]];

  for (const [name, group] of groups) {
    if (!group.length) continue;
    if (name) {
      const head = el("tr", "standings-group");
      const cell = el("th", null, name);
      cell.colSpan = 8;
      head.appendChild(cell);
      tbody.appendChild(head);
    }
    group.forEach((row, index) => {
      const rank = row.conference_rank || index + 1;
      const tr = el("tr");
      // The playoff cut-line. Eight of fifteen go through, and a table that
      // does not say where the line falls is missing the point of the table.
      if (row.in_playoff_places) tr.classList.add("is-seeded");
      if (rank === 8) tr.classList.add("is-cutline");
      tr.appendChild(el("td", "col-rank", String(rank)));
      const nameCell = el("td", "col-name");
      nameCell.appendChild(el("span", "player-pos", row.abbreviation));
      nameCell.appendChild(teamLink(row.team_id, (node) =>
        node.appendChild(el("span", "player-name", row.team_name))));
      tr.appendChild(nameCell);
      tr.appendChild(el("td", null, String(row.wins)));
      tr.appendChild(el("td", null, String(row.losses)));
      tr.appendChild(el("td", null, row.win_pct.toFixed(3).replace(/^0/, "")));
      tr.appendChild(el("td", null, String(row.points_for)));
      tr.appendChild(el("td", null, String(row.points_against)));
      const diff = row.point_differential;
      tr.appendChild(el("td", null, (diff > 0 ? "+" : "") + diff));
      tbody.appendChild(tr);
    });
  }
  const note = $("#standings-note");
  if (note) note.textContent = conferences.length ? conferences.join(" · ") : "";
}

const ATTRIBUTE_LABELS = {
  finishing: "FIN", mid_range: "MID", three_point: "3PT", post_game: "POST",
  free_throw: "FT", drawing_fouls: "DRAW",
  playmaking: "PLM", ball_handling: "HDL", off_ball: "OFF",
  perimeter_defense: "PER", interior_defense: "INT", steal: "STL", block: "BLK",
  def_rebounding: "DRB", off_rebounding: "ORB",
  speed: "SPD", strength: "STR", stamina: "STA", basketball_iq: "IQ", discipline: "DSC",
};

const TACTIC_SLIDERS = [
  ["pace", "Pace"],
  ["three_point_emphasis", "Three-point emphasis"],
  ["ball_movement", "Ball movement"],
  ["offensive_rebounding", "Crash the glass"],
  ["defensive_pressure", "Defensive pressure"],
  ["help_intensity", "Help intensity"],
  ["close_out_hard", "Close out hard"],
  ["foul_discipline", "Foul discipline"],
];

const SCHEME_LABELS = {
  motion: "Motion", pace_and_space: "Pace and space", inside_out: "Inside out",
  isolation: "Isolation", seven_seconds: "Seven seconds",
  man: "Man", switch: "Switch everything", drop: "Drop coverage",
  hedge: "Hedge", zone_2_3: "2-3 zone",
};

function titleCase(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


/* ------------------------------------------------------------------ *
 * Teams: a squad page, in the shape a stats site uses
 *
 * Tactics, the coach's ratings and the 81-attribute grid are all still in the
 * payload and still read by the engine -- they are just not on this screen.
 * What a squad page is for is who is on the roster and what they are doing,
 * and that is a stats table: name, position, and the per-game line.
 * ------------------------------------------------------------------ */

/* Season lines, keyed by player, so a roster row can find its own numbers. */
function statsByPlayer() {
  if (state.statIndex) return state.statIndex;
  const index = new Map();
  for (const row of state.data.playerStats || []) index.set(row.player_id, row);
  state.statIndex = index;
  return index;
}

const SQUAD_COLUMNS = [
  ["games", "GP", 0], ["minutes", "MIN", 1], ["fg_pct", "FG%", 1],
  ["tp_pct", "3P%", 1], ["ft_pct", "FT%", 1], ["rebounds", "REB", 1],
  ["assists", "AST", 1], ["blocks", "BLK", 1], ["steals", "STL", 1],
  ["fouls", "PF", 1], ["turnovers", "TOV", 1], ["points", "PTS", 1],
];

/* Percentages are stored 0-1 and read as percentages everywhere else on the
 * site, so they are scaled here rather than at the source. */
function statValue(row, key, places) {
  if (!row) return "—";
  let value = row[key];
  if (value === undefined || value === null) return "—";
  if (key.endsWith("_pct")) value *= 100;
  return value.toFixed(places);
}

function bindStandingsScope() {
  $$("#standings-scope button").forEach((button) => {
    button.onclick = () => {
      state.standingsView = button.dataset.standings;
      $$("#standings-scope button").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.standings === state.standingsView);
      });
      const power = state.standingsView === "power";
      $("#standings-league").hidden = power;
      $("#standings-power").hidden = !power;
      $("#power-detail-card").hidden = !power || !state.powerTeam;
      $("#standings-title").textContent = power ? "Power Rankings" : "Standings";
      $("#standings-note").textContent = power
        ? "Who is playing the best basketball right now"
        : "By conference";
    };
  });
}

function renderTeams() {
  const picker = $("#team-picker");
  picker.textContent = "";
  for (const team of state.data.teams) {
    const option = el("option", null, `${team.city} ${team.name}`);
    option.value = team.id;
    picker.appendChild(option);
  }
  picker.value = state.teamId;
  picker.addEventListener("change", () => {
    state.teamId = picker.value;
    state.playerId = null;
    renderTeamDetail();
  });

  const positions = $("#pos-filter");
  if (positions) {
    positions.addEventListener("change", (e) => {
      state.posFilter = e.target.value;
      state.playerId = null;
      renderTeamDetail();
    });
  }
  renderTeamDetail();
}

function squadFilter(players) {
  return state.posFilter
    ? players.filter((p) => p.pos === state.posFilter)
    : players;
}

async function renderTeamDetail() {
  const team = await squadFor(state.teamId);
  if (!team || state.teamId !== team.id) return;

  const shown = squadFilter(team.players);
  if (!shown.length) {
    $("#roster-list").textContent = "";
    return;
  }
  if (!state.playerId || !shown.some((p) => p.id === state.playerId)) {
    state.playerId = shown[0].id;
  }

  // --- left rail -------------------------------------------------------
  const list = $("#roster-list");
  list.textContent = "";
  shown.forEach((player) => {
    const row = el("li", "roster-row" + (player.id === state.playerId ? " is-selected" : ""));
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.appendChild(teamMark(team));
    const nameWrap = el("span", "roster-name");
    nameWrap.appendChild(el("span", "player-name", player.name));
    nameWrap.appendChild(el("span", "roster-meta",
      `#${player.jersey} · ${player.pos}`));
    row.appendChild(nameWrap);
    const open = () => { state.playerId = player.id; renderTeamDetail(); };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    list.appendChild(row);
  });

  renderPlayer(team);
}

function fact(list, term, value) {
  if (!value) return;
  list.appendChild(el("dt", null, term));
  list.appendChild(el("dd", null, value));
}

function renderPlayer(team) {
  const player = (team.players || []).find((p) => p.id === state.playerId);
  if (!player) return;
  const line = statsByPlayer().get(player.id);

  const mark = $("#profile-mark");
  mark.textContent = "";
  mark.appendChild(teamMark(team));

  $("#profile-name").textContent = player.name;
  $("#profile-club").textContent =
    `${team.city} ${team.name} · #${player.jersey} · ${player.pos}`;

  // Biography, in the order a stats site leads with.
  const facts = $("#profile-facts");
  facts.textContent = "";
  fact(facts, "HT/WT", `${player.height}, ${player.weight} lbs`);
  fact(facts, "AGE", String(player.age));
  const bio = player.bio || {};
  // An undrafted player still has a draft *class* -- year is set, round and
  // pick are not -- so testing the year alone printed "Rd null, Pk null".
  if (bio.draft && bio.draft.year && !bio.draft.undrafted) {
    fact(facts, "DRAFT INFO",
      `${bio.draft.year}: Rd ${bio.draft.round}, Pk ${bio.draft.pick}`);
  } else if (bio.draft && bio.draft.year) {
    fact(facts, "DRAFT INFO", `${bio.draft.year}: Undrafted`);
  } else {
    fact(facts, "DRAFT INFO", "Undrafted");
  }
  fact(facts, "FROM", bio.background || bio.nationality);
  fact(facts, "EXPERIENCE", line && line.games ? `${line.games} games` : "—");

  // The four headline averages.
  const headline = $("#profile-headline");
  headline.textContent = "";
  for (const [key, label, places] of [
    ["points", "PTS", 1], ["rebounds", "REB", 1],
    ["assists", "AST", 1], ["fg_pct", "FG%", 1],
  ]) {
    const cell = el("div", "head-stat");
    cell.appendChild(el("span", "head-stat-label", label));
    cell.appendChild(el("span", "head-stat-value", statValue(line, key, places)));
    headline.appendChild(cell);
  }
  const seasonLabel = $("#profile-season-label");
  if (seasonLabel) {
    seasonLabel.textContent = line && line.games
      ? `${state.data.league.season} season averages`
      : "No games played yet";
  }

  // Season line as its own table, the way a profile page carries it.
  const table = $("#profile-stats");
  table.textContent = "";
  const head = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", "col-name", "SPLIT"));
  for (const [, label] of SQUAD_COLUMNS) headRow.appendChild(el("th", null, label));
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el("tbody");
  const row = el("tr");
  row.appendChild(el("td", "col-name", "Regular Season"));
  for (const [key, , places] of SQUAD_COLUMNS) {
    row.appendChild(el("td", null, statValue(line, key, places)));
  }
  body.appendChild(row);
  table.appendChild(body);

  renderPlayerGames(player, team);
  renderPlayerChart(player, team);
}

/* The player's last box scores.
 *
 * These come off the squad payload (`gameLog`), not off the day's fixtures.
 * Reading them from the loaded day meant only the games that ship play-by-play
 * could supply one, which on a page showing the Finals was one fixture in the
 * whole league -- so the card hid itself for twenty-eight clubs out of thirty.
 * The server derives the log from every finished fixture's box score instead,
 * which every save keeps.
 */
const GAME_LOG_COLUMNS = [
  ["minutes", "MIN"], ["points", "PTS"], ["rebounds", "REB"], ["assists", "AST"],
  ["steals", "STL"], ["blocks", "BLK"], ["turnovers", "TO"], ["fouls", "PF"],
];

function shooting(made, attempted) {
  return `${made}-${attempted}`;
}

function renderPlayerGames(player, team) {
  const table = $("#profile-games");
  const count = $("#profile-games-count");
  table.textContent = "";
  count.textContent = "";

  const rows = ((team.gameLog || {})[player.id]) || [];
  const card = table.closest(".card");
  if (!rows.length) {
    // Nothing to apologise for and nothing to show: a player with no finished
    // games has no log, and an empty table with a caption is worse than none.
    if (card) card.hidden = true;
    return;
  }
  if (card) card.hidden = false;
  count.textContent = `Last ${rows.length}`;

  const head = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", "col-name", "DATE"));
  for (const label of ["OPP", "RESULT"]) headRow.appendChild(el("th", null, label));
  for (const [, label] of GAME_LOG_COLUMNS) headRow.appendChild(el("th", null, label));
  // No +/- column: the engine does not track on/off, so every value would be
  // a zero dressed up as a stat.
  for (const label of ["FG", "3P", "FT"]) headRow.appendChild(el("th", null, label));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    const when = el("td", "col-name");
    when.appendChild(el("span", null, row.label));
    // A postseason line is still a recent game, but it is not the same kind of
    // game, so it says which round it was.
    if (row.round) when.appendChild(el("span", "log-round", row.round));
    tr.appendChild(when);
    tr.appendChild(el("td", null, `${row.home ? "vs" : "@"} ${row.opponent}`));
    tr.appendChild(el("td", row.result === "W" ? "log-win" : "log-loss",
      `${row.result} ${row.score}`));
    for (const [key] of GAME_LOG_COLUMNS) {
      tr.appendChild(el("td", null, String(row[key] ?? "—")));
    }
    tr.appendChild(el("td", null, shooting(row.fgm, row.fga)));
    tr.appendChild(el("td", null, shooting(row.tpm, row.tpa)));
    tr.appendChild(el("td", null, shooting(row.ftm, row.fta)));
    body.appendChild(tr);
  }
  table.appendChild(body);
}

/* ------------------------------------------------------------------ *
 * Advanced progression chart
 *
 * One line, one player, one of the nineteen advanced stats -- chosen from a
 * dropdown built out of `advancedColumns`, so the chart offers exactly what
 * the Advanced tab shows and cannot drift from it.
 *
 * Each point is the player's season *to that date*, not that night's game: a
 * single game's win shares are noise, and a running figure ends on precisely
 * the number the Advanced tab has for the season. The final point tying out is
 * the property that makes the line worth reading.
 *
 * Two axes, because they answer different questions and both are real:
 *
 *   By season -- one point a year, the career. This is the chart the league
 *     could not draw before the offseason loop existed, because there was one
 *     season and a year axis would have had a single point on it.
 *   This season -- the checkpoint line within the current year.
 *
 * A past season's point is *derived on read*, exactly like the live one: the
 * archive stores the totals those games produced and the advanced table is
 * computed from them now, by the same code. Change a formula and every season
 * on the chart moves with it, which is what keeps a career comparable to
 * itself.
 * ------------------------------------------------------------------ */

const CHART = { width: 720, height: 260, left: 52, right: 16, top: 16, bottom: 30 };

function svg(tag, attrs, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Round numbers for the axis, whatever the stat's scale: DRB% runs to 30,
 * WS/48 to 0.25, and both should get labels a reader recognises. */
function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (magnitude * factor >= raw) return magnitude * factor;
  }
  return magnitude * 10;
}

function axisLabel(value, step) {
  const places = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return value.toFixed(places);
}

function chartStatKey() {
  const columns = state.data.advancedColumns || [];
  if (!columns.length) return null;
  if (columns.some((c) => c.key === state.chartStat)) return state.chartStat;
  return columns[0].key;
}

function bindChartStat() {
  const picker = $("#chart-stat");
  if (!picker) return;
  picker.textContent = "";
  for (const column of state.data.advancedColumns || []) {
    const option = el("option", null, column.label);
    option.value = column.key;
    picker.appendChild(option);
  }
  picker.value = chartStatKey() || "";
  picker.addEventListener("change", () => {
    state.chartStat = picker.value;
    renderTeamDetail();
  });

  // One season in the league means the by-season axis is a single point, so it
  // opens on the within-season line instead. It is still offered -- the toggle
  // is how you find out the league has only played one year.
  const seasons = state.data.seasons || [];
  if (seasons.length < 2) state.chartAxis = "games";

  $$("#chart-axis button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.axis === state.chartAxis);
    button.onclick = () => {
      state.chartAxis = button.dataset.axis;
      $$("#chart-axis button").forEach((b) => {
        const on = b.dataset.axis === state.chartAxis;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      renderTeamDetail();
    };
  });
}

/* The two series, reduced to the one shape the renderer draws: a list of
 * points, an x value per point, and a label for each end of the axis. */
function chartPoints(player, team) {
  if (state.chartAxis === "season") {
    const points = ((team.advancedSeasons || {})[player.id]) || [];
    return {
      points,
      // Spaced by year, not by index. A player who took no minutes at all in a
      // season has no line for it, and evenly spacing the points he does have
      // would draw 2028-29 next to 2030-31 as though nothing were missing.
      x: points.map((p) => parseInt(p.season, 10) || 0),
      tick: (i) => (points[i] ? points[i].season : ""),
      caption: (last) =>
        `by season — ${last.season}${last.complete ? "" : " so far"}, `
        + `${last.games} games. One point a year, each derived from that `
        + `season's stored totals by the same code the Advanced tab uses.`,
      note: (point) => `${point.season}: ${point.games} games`,
    };
  }
  const series = (team.advancedSeries || {})[player.id];
  const points = (series && series.points) || [];
  return {
    points,
    x: points.map((p) => p.games),
    tick: (i) => `${points[i].games} GP`,
    caption: (last) =>
      `through the ${series ? series.season : ""} season, cumulative — `
      + `${last.games} games. One point per checkpoint; the last one is the `
      + `figure on the Advanced tab.`,
    note: (point) => `after ${point.games} games`,
  };
}

function renderPlayerChart(player, team) {
  const figure = $("#profile-chart");
  const note = $("#profile-chart-note");
  if (!figure) return;
  figure.textContent = "";
  note.textContent = "";

  const card = figure.closest(".card");
  const key = chartStatKey();
  const column = (state.data.advancedColumns || []).find((c) => c.key === key);
  const axis = chartPoints(player, team);
  const points = axis.points;
  if (!column || points.length < 2) {
    // A rookie has one season and a chart cannot draw a line through one point.
    // Rather than inventing the years either side of it, the card says which
    // axis has nothing on it and offers the other one.
    if (card) card.hidden = false;
    figure.textContent = "";
    note.textContent = points.length === 1 && state.chartAxis === "season"
      ? `${player.name} has played one season. A career line needs two — `
        + `switch to "This season" for his progression within it.`
      : "";
    if (!column || !points.length) { if (card) card.hidden = true; }
    return;
  }
  if (card) card.hidden = false;
  $("#chart-stat").value = key;

  const values = points.map((p) => p[key]);
  const games = axis.x;
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 1e-9) { low -= 1; high += 1; }   // a flat line still needs a band
  const step = niceStep(high - low, 4);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;

  const firstGame = games[0];
  const lastGame = games[games.length - 1];
  const spanX = Math.max(1, lastGame - firstGame);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (g) => CHART.left + ((g - firstGame) / spanX) * plotWidth;
  const y = (v) => CHART.top + (1 - (v - low) / (high - low)) * plotHeight;

  const chart = svg("svg", {
    viewBox: `0 0 ${CHART.width} ${CHART.height}`,
    role: "img",
    "aria-label": `${player.name}, ${column.label} ${
      state.chartAxis === "season" ? "season by season" : "through the season"}`,
  });

  // Horizontal gridlines and their labels.
  for (let value = low; value <= high + step / 2; value += step) {
    const at = y(value);
    chart.appendChild(svg("line", {
      class: "chart-grid", x1: CHART.left, x2: CHART.width - CHART.right, y1: at, y2: at,
    }));
    chart.appendChild(svg("text", {
      class: "chart-tick", x: CHART.left - 8, y: at + 4, "text-anchor": "end",
    }, axisLabel(value, step)));
  }

  // Zero matters for the stats that go negative -- BPM, VORP, the win shares.
  if (low < 0 && high > 0) {
    chart.appendChild(svg("line", {
      class: "chart-zero", x1: CHART.left, x2: CHART.width - CHART.right,
      y1: y(0), y2: y(0),
    }));
  }

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(games[i])} ${y(p[key])}`).join(" ");
  chart.appendChild(svg("path", {
    class: "chart-area",
    d: `${line} L${x(lastGame)} ${CHART.top + plotHeight} L${x(firstGame)} ${CHART.top + plotHeight} Z`,
  }));
  chart.appendChild(svg("path", { class: "chart-line", d: line }));

  points.forEach((point, index) => {
    const dot = svg("circle", {
      class: "chart-dot", cx: x(games[index]), cy: y(point[key]), r: 3.5,
    });
    dot.appendChild(svg("title", {},
      `${column.label} ${point[key]} ${axis.note(point)}`));
    chart.appendChild(dot);
  });

  // Only the ends get an x label; sixteen of them would be a smear.
  for (const [index, anchor] of [[0, "start"], [points.length - 1, "end"]]) {
    chart.appendChild(svg("text", {
      class: "chart-tick", x: x(games[index]), y: CHART.height - 10,
      "text-anchor": anchor,
    }, axis.tick(index)));
  }

  figure.appendChild(chart);
  const last = points[points.length - 1];
  note.textContent = `${column.label} ${axis.caption(last)}`;
}

/* A collapsible section: heading and star rating always visible, the
 * attributes behind a disclosure. `<details>` rather than a click handler, so
 * keyboard, screen readers and browser find-in-page all work without help.
 *
 * `summary` is optional -- the scouted and composite panels have no star
 * rating, and open with just their heading. */
/* Storage is always 1-20. `displayScale` only changes presentation. */
function displayValue(value) {
  const { max } = state.data.scale;
  return state.displayScale === 100 ? Math.round((value / max) * 100) : Math.round(value);
}

function tierLabel(value) {
  for (const [floor, label] of state.data.scale.tiers) {
    if (value >= floor) return label;
  }
  return state.data.scale.tiers[state.data.scale.tiers.length - 1][1];
}

function attributeRow(label, value, key) {
  const { min, max } = state.data.scale;
  const row = el("li", "attr-row");
  row.appendChild(el("span", "attr-name", label));
  const chip = el("span", "attr-value", String(displayValue(value)));
  // One hue, light to dark: magnitude reads down the column at a glance.
  const heat = (value - min) / (max - min);
  chip.style.setProperty("--heat", String(Math.max(0, Math.min(1, heat))));
  if (value >= 16) chip.classList.add("is-elite");
  row.appendChild(chip);
  row.title = `${label}: ${value.toFixed(1)} / ${max} — ${tierLabel(value)}`;
  return row;
}

function schemeChip(label, value) {
  const chip = el("div", "chip");
  chip.appendChild(el("span", "chip-label", label));
  chip.appendChild(el("span", "chip-value", value));
  return chip;
}

/* ------------------------------------------------------------------ *
 * Playback transport
 * ------------------------------------------------------------------ */

function startPlayback() {
  if (state.playing) return;
  if (state.cursor >= state.game.events.length) return;
  state.playing = true;
  state.lastTick = performance.now();
  $("#play").setAttribute("aria-pressed", "true");
  $("#play-icon").textContent = "❙❙";
  $("#play-text").textContent = "Pause";
  const step = (now) => {
    if (!state.playing) return;
    const delta = (now - state.lastTick) / 1000;
    state.lastTick = now;
    advanceTo(state.playhead + delta * state.speed);
    if (state.playing) state.frame = requestAnimationFrame(step);
  };
  state.frame = requestAnimationFrame(step);
}

function stopPlayback() {
  state.playing = false;
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = null;
  const play = $("#play");
  if (play) {
    play.setAttribute("aria-pressed", "false");
    $("#play-icon").textContent = "▶";
    $("#play-text").textContent = "Play";
  }
}

function rewindTo(seconds) {
  stopPlayback();
  state.cursor = 0;
  state.playhead = 0;
  state.box = newBoxState(state.game);
  $("#feed").textContent = "";
  advanceTo(seconds);
}

function setView(view) {
  state.view = view;
  $$(".nav-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".view").forEach((panel) => { panel.hidden = panel.dataset.view !== view; });
}

function bindControls() {
  $$(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // Coming back to Games lands on the schedule rather than whichever
      // fixture happened to be open when you left.
      if (tab.dataset.view === "games") showTracker(false);
      setView(tab.dataset.view);
    });
  });

  const back = $("#back-to-schedule");
  if (back) back.addEventListener("click", () => showTracker(false));

  $$(".tracker-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      $$(".tracker-tab").forEach((t) => {
        const active = t.dataset.tab === state.tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      $("#pane-pbp").hidden = state.tab !== "pbp";
      $("#pane-box").hidden = state.tab !== "box";
      if (state.tab === "box") renderBox();
    });
  });

  $("#play").addEventListener("click", () => {
    if (state.playing) stopPlayback();
    else if (state.cursor >= state.game.events.length) rewindTo(0), startPlayback();
    else startPlayback();
  });

  $("#restart").addEventListener("click", () => { rewindTo(0); startPlayback(); });
  $("#to-final").addEventListener("click", () => {
    rewindTo(state.game.events[state.game.events.length - 1][E_SECONDS]);
  });

  $("#speed").addEventListener("change", (e) => { state.speed = Number(e.target.value); });

  $("#scrub").addEventListener("input", (e) => {
    const ratio = Number(e.target.value) / 1000;
    rewindTo(ratio * (state.game.duration || 0));
  });

  bindFlowHover();
}

// Guarded so demo/verify.mjs can require this file in Node and exercise the
// box-score rebuild without a DOM.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", boot);
}

/* ------------------------------------------------------------------ *
 * Live app only: the league clock, and games that are still arriving.
 *
 * None of this exists on the published page -- there is no server to ask, and
 * the season there is already over. `state.data.live` gates all of it.
 * ------------------------------------------------------------------ */

function stopLivePolling() {
  if (state.livePoll) {
    clearInterval(state.livePoll);
    state.livePoll = null;
  }
}

function startLivePolling(gameId) {
  stopLivePolling();
  state.livePoll = setInterval(async () => {
    if (state.gameId !== gameId) { stopLivePolling(); return; }
    const detail = await state.source.gameDetail(gameId);
    if (!detail || state.gameId !== gameId) return;

    const known = (state.game.events || []).length;
    const arrived = (detail.events || []).length;
    if (arrived > known) {
      // Whether the viewer was at the live edge before this batch landed. If
      // he was, keep him there; if he had scrubbed back to look at something,
      // leave him where he is.
      const wasCaughtUp = state.cursor >= known;

      // Appending rather than replacing keeps the playhead and the rebuilt box
      // score intact -- restarting the game every three seconds would be
      // unwatchable.
      state.game.events = detail.events;
      state.game.duration = detail.duration;
      state.game.homeScore = detail.homeScore;
      state.game.awayScore = detail.awayScore;

      if (wasCaughtUp) {
        // Playback stops when it runs out of events, which at real-time speed
        // is every few seconds. Following the stream forward is what keeps a
        // live game live rather than frozen one possession behind.
        advanceTo(detail.events[arrived - 1][E_SECONDS]);
      } else if (!state.playing) {
        advanceTo(state.playhead);
      }
    }
    if (!detail.live) {
      stopLivePolling();
      state.game.live = false;
      refreshLeague({ quiet: true });
    }
  }, 3000);
}

/* Pull the league back down after the clock moves: new results, new standings,
 * new stats. The schedule rail is rebuilt, the open game is left alone. */
async function refreshLeague({ quiet = false } = {}) {
  const data = await state.source.load();
  const openId = state.gameId;
  // Carry across any play-by-play already fetched, so switching back to a game
  // does not re-download it.
  const cached = new Map(dayGames().filter((g) => g.events).map((g) => [g.id, g]));
  state.data = data;
  state.data.day.games = (data.day.games || []).map((g) => {
    const previous = cached.get(g.id);
    return previous && !previous.live ? Object.assign(previous, g) : g;
  });

  // Season lines and squad histories were derived from a schedule that has
  // since moved. Drop the index and mark the squads stale so the screens that
  // read them ask again rather than showing last minute's numbers.
  state.statIndex = null;
  for (const team of state.teams.values()) team.stale = true;

  indexTeams(data.teams);
  renderSeasonLabel();
  // Games finishing is exactly what makes new news, so the wire refreshes with
  // the standings rather than waiting for a reload.
  renderWire();
  renderBracket();
  renderHonours();
  renderPower();
  renderSchedule();
  renderStandings();
  renderStats();
  // Only when it is the screen being looked at: re-rendering the squad page
  // re-fetches a squad, and that is not worth doing for a tab nobody is on.
  if (state.view === "teams") renderTeamDetail();
  if (openId && !quiet) selectGame(openId);
  else if (openId) markSelectedFixture(openId);
}

function markSelectedFixture(gameId) {
  $$(".fixture").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.gameId === gameId);
  });
}

/* The Games tab is a full-width schedule; opening a fixture swaps the tracker
 * in over it, and "All games" swaps back. One at a time, because a day is 45
 * fixtures and a tracker is a whole screen -- side by side, neither fits. */
function showTracker(on) {
  const schedule = $("#schedule-card");
  const tracker = $("#tracker-card");
  if (!schedule || !tracker) return;
  schedule.hidden = on;
  tracker.hidden = !on;
  if (!on) {
    stopPlayback();
    stopLivePolling();
  }
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? "auto" : "smooth" });
}

/* The league runs on real time: games tip off at their real 8am, 1pm and 7pm
 * Pacific slots and reveal at real speed. There are no clock controls, so
 * nothing user-driven would ever pull fresh results down -- this does, on a
 * quiet timer. A minute is far below the gap between slates and costs one
 * bootstrap.
 *
 * Deliberately not faster: a live game already polls its own play-by-play
 * every three seconds, which is what makes a game in progress feel live. This
 * is only here to notice that a *new* game has started or finished. */
const LEAGUE_REFRESH_MS = 60000;

function startLeagueRefresh() {
  if (state.leagueRefresh) clearInterval(state.leagueRefresh);
  state.leagueRefresh = setInterval(() => {
    // The open game owns the screen while it is being watched; refreshing
    // around it keeps the schedule and standings current without interrupting.
    refreshLeague({ quiet: true }).catch((error) =>
      console.warn("league refresh failed", error));
  }, LEAGUE_REFRESH_MS);
}
