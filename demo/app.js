/* Basketball Manager — hosted tracker demo.
 *
 * The Python engine cannot run on a static page, so the whole mini-season is
 * simulated ahead of time and shipped as one gzipped payload. Everything you
 * see here is replayed from those events: the play-by-play is the engine's
 * output verbatim, and the box score is rebuilt from the same event stream
 * rather than read off a stored total (demo/verify.mjs checks the rebuild
 * against the engine's own box score for every game).
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
      const rebounder = line(state, teamId, playerId);
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
  speed: 30,
  box: null,
  tab: "pbp",
  teamId: null,
  playerId: null,
  showHidden: false,
  displayScale: 20,
  statsScope: "players",
  statsSort: "points",
  statsDescending: true,
  lastTick: 0,
  frame: null,
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
  const packed = document.getElementById("payload").textContent.trim();
  const status = $("#boot-status");

  if (typeof DecompressionStream !== "function") {
    status.textContent = "This browser can't unpack the season data (needs DecompressionStream).";
    return;
  }

  try {
    const binary = atob(packed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    state.data = await new Response(stream).json();
  } catch (error) {
    status.textContent = `Couldn't unpack the season data: ${error.message}`;
    return;
  }

  for (const team of state.data.teams) {
    state.teams.set(team.id, team);
    for (const player of team.players) state.players.set(player.id, player);
  }
  state.teamId = state.data.teams[0].id;

  $("#boot").remove();
  $("#app").hidden = false;
  $("#season-label").textContent = `${state.data.league.season} · ${state.data.games.length} games`;

  renderSchedule();
  renderStandings();
  renderTeams();
  buildStatTabs();
  renderStats();
  bindControls();

  selectGame(state.data.games[state.data.games.length - 1].id);
}

/* ------------------------------------------------------------------ *
 * Schedule rail
 * ------------------------------------------------------------------ */

function gameDate(game) {
  return new Date(game.tipoff).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function renderSchedule() {
  const rail = $("#schedule");
  rail.textContent = "";
  let currentDate = null;

  for (const game of state.data.games) {
    const label = gameDate(game);
    if (label !== currentDate) {
      currentDate = label;
      rail.appendChild(el("li", "rail-date", label));
    }

    const home = state.teams.get(game.home);
    const away = state.teams.get(game.away);
    const homeWon = game.homeScore > game.awayScore;

    const row = el("li", "fixture");
    row.tabIndex = 0;
    row.dataset.gameId = game.id;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label",
      `${away.city} ${away.name} at ${home.city} ${home.name}, final ${game.awayScore} to ${game.homeScore}`);

    for (const [team, score, won] of [[away, game.awayScore, !homeWon], [home, game.homeScore, homeWon]]) {
      const side = el("span", `fixture-side${won ? " is-winner" : ""}`);
      side.appendChild(el("span", "fixture-abbr", team.abbr));
      side.appendChild(el("span", "fixture-team", team.name));
      side.appendChild(el("span", "fixture-score", String(score)));
      row.appendChild(side);
    }

    if (!game.detailed) row.classList.add("is-result-only");

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

function selectGame(gameId) {
  const game = state.data.games.find((g) => g.id === gameId);
  if (!game) return;

  stopPlayback();
  state.gameId = gameId;
  state.game = game;
  state.playhead = 0;
  state.cursor = 0;
  state.box = newBoxState(game);

  $$(".fixture").forEach((row) => {
    const selected = row.dataset.gameId === gameId;
    row.classList.toggle("is-selected", selected);
    if (selected) row.scrollIntoView({ block: "nearest" });
  });

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

  const detailed = Boolean(game.detailed);
  $("#tracker-body").hidden = !detailed;
  $("#no-detail").hidden = detailed;
  if (!detailed) {
    const home = state.teams.get(game.home);
    const away = state.teams.get(game.away);
    $("#away-score").textContent = String(game.awayScore);
    $("#home-score").textContent = String(game.homeScore);
    $("#period").textContent = "FT";
    $("#clock").textContent = "00.0";
    $("#game-state").textContent = "Final";
    $("#game-state").classList.remove("is-live");
    $("#away-abbr").parentElement.classList.toggle("is-leading", game.awayScore > game.homeScore);
    $("#home-abbr").parentElement.classList.toggle("is-leading", game.homeScore > game.awayScore);
    return;
  }

  renderTracker();
  startPlayback();
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

  const done = state.cursor >= game.events.length;
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
    heading.appendChild(el("span", "box-name", team.city + " " + team.name));
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
      const player = state.players.get(l.playerId);
      const row = el("tr");
      if (side.onCourt.has(l.playerId)) row.classList.add("is-on-court");
      const nameCell = el("td", "col-name");
      nameCell.appendChild(el("span", "player-pos", player ? player.pos : ""));
      nameCell.appendChild(el("span", "player-name", player ? player.name : l.playerId));
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

function formatStat(key, value) {
  if (value === undefined || value === null) return "—";
  if (PERCENT_KEYS.has(key)) return value.toFixed(3).replace(/^0/, "");
  if (WHOLE_KEYS.has(key)) return String(Math.round(value));
  return value.toFixed(1);
}

function statsRows() {
  return state.statsScope === "teams" ? state.data.teamStats : state.data.playerStats;
}

function statsColumns() {
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
        const cell = el("td", "col-name");
        cell.appendChild(el("span", "player-name", row.name));
        tr.appendChild(cell);
      } else if (col.key === "team_id" || col.key === "abbreviation") {
        const label = col.key === "team_id"
          ? (state.teams.get(row.team_id) || {}).abbr || row.team_id
          : row.abbreviation;
        const cell = el("td", "col-name");
        cell.appendChild(el("span", "player-pos", label));
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
      state.statsSort = "points";
      state.statsDescending = true;
      renderStats();
    };
  });
}

/* ------------------------------------------------------------------ *
 * Standings & teams
 * ------------------------------------------------------------------ */

function renderStandings() {
  const tbody = $("#standings-body");
  tbody.textContent = "";
  state.data.standings.forEach((row, index) => {
    const tr = el("tr");
    tr.appendChild(el("td", "col-rank", String(index + 1)));
    const nameCell = el("td", "col-name");
    nameCell.appendChild(el("span", "player-pos", row.abbreviation));
    nameCell.appendChild(el("span", "player-name", row.team_name));
    tr.appendChild(nameCell);
    tr.appendChild(el("td", null, String(row.wins)));
    tr.appendChild(el("td", null, String(row.losses)));
    tr.appendChild(el("td", null, row.win_pct.toFixed(3).replace(/^0/, "")));
    tr.appendChild(el("td", null, String(row.points_for)));
    tr.appendChild(el("td", null, String(row.points_against)));
    const diff = el("td", row.point_differential >= 0 ? "diff-positive" : "diff-negative",
      `${row.point_differential > 0 ? "+" : ""}${row.point_differential}`);
    tr.appendChild(diff);
    tbody.appendChild(tr);
  });
}

// Abbreviated the way a stat sheet would: full names live in the tooltip.
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

  $("#scout-toggle").addEventListener("change", (e) => {
    state.showHidden = e.target.checked;
    renderPlayer();
  });

  $("#scale-toggle").addEventListener("change", (e) => {
    state.displayScale = Number(e.target.value);
    renderTeamDetail();
  });

  renderTeamDetail();
}

function renderTeamDetail() {
  const team = state.teams.get(state.teamId);

  // --- tactics ---------------------------------------------------------
  const tactics = $("#tactics");
  tactics.textContent = "";
  const schemeLabel = (key) => SCHEME_LABELS[key] || titleCase(key);
  const schemes = el("div", "scheme-row");
  schemes.appendChild(schemeChip("Offense", schemeLabel(team.tactics.offensive_scheme)));
  schemes.appendChild(schemeChip("Defense", schemeLabel(team.tactics.defensive_scheme)));
  schemes.appendChild(schemeChip("Chemistry", String(team.chemistry)));
  tactics.appendChild(schemes);

  const sliders = el("div", "sliders");
  for (const [key, label] of TACTIC_SLIDERS) {
    const value = team.tactics[key];
    const wrap = el("div", "slider");
    wrap.appendChild(el("span", "slider-label", label));
    const track = el("span", "slider-track");
    const fill = el("span", "slider-fill");
    fill.style.width = `${value}%`;
    track.appendChild(fill);
    wrap.appendChild(track);
    wrap.appendChild(el("span", "slider-value", String(Math.round(value))));
    sliders.appendChild(wrap);
  }
  tactics.appendChild(sliders);

  renderCoach(team);

  // --- roster list -----------------------------------------------------
  if (!state.playerId || !team.players.some((p) => p.id === state.playerId)) {
    state.playerId = team.players[0].id;
  }
  const list = $("#roster-list");
  list.textContent = "";
  team.players.forEach((player, index) => {
    const row = el("li", "roster-row" + (player.id === state.playerId ? " is-selected" : ""));
    if (index < 5) row.classList.add("is-starter");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.appendChild(el("span", "player-pos", player.pos));
    const nameWrap = el("span", "roster-name");
    nameWrap.appendChild(el("span", "player-name", player.name));
    nameWrap.appendChild(el("span", "roster-meta", `${player.age} · ${player.personality}`));
    row.appendChild(nameWrap);
    const ovrCell = starRow(player.stars, "is-compact");
    ovrCell.title = `${player.stars} stars — ${player.tier}`;
    row.appendChild(ovrCell);

    const open = () => { state.playerId = player.id; renderTeamDetail(); };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    list.appendChild(row);
  });

  renderPlayer();
}

/* The head coach: a name, what he is known for, and the seven ratings the
 * engine reads. Bars rather than a table -- there are only seven of them, and
 * what matters when you look at a coach is the shape, not the digits. */
function renderCoach(team) {
  const panel = $("#coach-panel");
  const tag = $("#coach-tag");
  panel.textContent = "";
  tag.textContent = "";

  const coach = team.coach;
  if (!coach) {
    panel.appendChild(el("p", "muted-line", "No head coach appointed."));
    return;
  }

  const scale = state.data.coachScale || {};
  const max = scale.max || 100;
  const labels = scale.labels || [];

  tag.textContent = `${coach.tier} · ${coach.specialism}`;

  const head = el("div", "coach-head");
  head.appendChild(el("span", "coach-name", coach.name));
  const tenure = coach.seasons_coached === 1 ? "1 season" : `${coach.seasons_coached} seasons`;
  head.appendChild(el("span", "coach-sub",
    `${coach.age} years · ${coach.nationality} · ${tenure} as a head coach`));
  panel.appendChild(head);

  const bars = el("div", "coach-ratings");
  for (const [key, label] of labels) {
    const value = coach.ratings[key];
    if (value === undefined) continue;
    const wrap = el("div", "slider" + (key === "reputation" ? " is-reputation" : ""));
    wrap.appendChild(el("span", "slider-label", label));
    const track = el("span", "slider-track");
    const fill = el("span", "slider-fill");
    fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
    track.appendChild(fill);
    wrap.appendChild(track);
    wrap.appendChild(el("span", "slider-value", String(Math.round(value))));
    bars.appendChild(wrap);
  }
  panel.appendChild(bars);
}

/* An 81-attribute roster will not fit in a table, so the profile follows the
 * Football Manager pattern: grouped columns of name + value for one player. */
function renderPlayer() {
  const team = state.teams.get(state.teamId);
  const player = team.players.find((p) => p.id === state.playerId);
  if (!player) return;

  $("#profile-name").textContent = player.name;
  const bio = player.bio || {};
  $("#profile-meta").textContent =
    `${player.pos} · ${player.age} years · ${player.height} · ${player.weight} lb · #${player.jersey}`;

  const bioLine = $("#profile-bio");
  bioLine.textContent = "";
  const facts = [
    ["Nationality", bio.nationality],
    [bio.background_type || "Background", bio.background],
    ["Draft", bio.draft ? bio.draft.label : null],
  ];
  for (const [label, value] of facts) {
    if (!value) continue;
    const item = el("span", "bio-fact");
    item.appendChild(el("span", "bio-label", label));
    item.appendChild(el("span", "bio-value", value));
    bioLine.appendChild(item);
  }

  const starBox = $("#profile-stars");
  starBox.textContent = "";
  starBox.appendChild(starRow(player.stars));
  $("#profile-tier").textContent = player.tier;
  $("#profile-archetype").textContent = player.archetype || "—";
  $("#profile-personality").textContent = player.personality;

  const groups = $("#attribute-groups");
  groups.textContent = "";
  for (const [group, keys] of Object.entries(state.data.attributeGroups)) {
    groups.appendChild(attributeColumn(group, keys, player.ratings, state.data.attributeNames));
  }

  const scouting = $("#scouting");
  scouting.hidden = !state.showHidden;
  if (state.showHidden) {
    scouting.textContent = "";
    const keys = Object.keys(state.data.hiddenNames);
    scouting.appendChild(
      attributeColumn("Scouted", keys, player.hidden, state.data.hiddenNames, "scouted")
    );
    scouting.appendChild(abilityPanel(player));

    const composites = el("div", "attr-group composite-group");
    composites.appendChild(el("h4", "attr-heading", "Engine composites"));
    const listEl = el("ul", "attr-list");
    for (const key of state.data.compositeOrder) {
      listEl.appendChild(attributeRow(key, player.composites[key], key));
    }
    composites.appendChild(listEl);
    scouting.appendChild(composites);
  }
}

/* CA/PA: the two hidden numbers everything else is generated from. Shown as a
 * bar so headroom -- the gap a scout is actually trying to estimate -- reads at
 * a glance, with the scout's own (deliberately imprecise) range beneath it. */
function abilityPanel(player) {
  const { current, potential, headroom, tier, potential_tier } = player.ability;
  const max = state.data.abilityScale.max;
  const report = player.scouting;

  const wrap = el("div", "attr-group ability-group");
  wrap.appendChild(el("h4", "attr-heading", "Ability (0\u2013200)"));

  const potentialRow = el("div", "potential-stars");
  potentialRow.appendChild(el("span", "bio-label", "Potential"));
  potentialRow.appendChild(starRow(player.potentialStars));
  wrap.appendChild(potentialRow);

  const bar = el("div", "ability-bar");
  const fill = el("span", "ability-current");
  fill.style.width = `${(current / max) * 100}%`;
  const ceiling = el("span", "ability-potential");
  ceiling.style.width = `${(potential / max) * 100}%`;
  bar.appendChild(ceiling);
  bar.appendChild(fill);
  wrap.appendChild(bar);

  const rows = el("ul", "attr-list");
  const add = (label, value, extra) => {
    const row = el("li", "attr-row");
    row.appendChild(el("span", "attr-name", label));
    const chip = el("span", "attr-value ability-value", String(Math.round(value)));
    row.appendChild(chip);
    if (extra) row.title = extra;
    rows.appendChild(row);
  };
  add("Current (CA)", current, tier);
  add("Potential (PA)", potential, potential_tier);
  add("Headroom", headroom);
  wrap.appendChild(rows);

  wrap.appendChild(el("p", "scout-note",
    `Scout: CA ${report.current_range[0]}–${report.current_range[1]}, ` +
    `PA ${report.potential_range[0]}–${report.potential_range[1]} — ${report.verdict}`));
  return wrap;
}

/* Half-star glyphs. The ten CA tiers are exactly ten half-star steps, so a
 * star rating is the tier table rendered rather than a second scale. */
function starRow(value, className) {
  const wrap = el("span", `stars ${className || ""}`.trim());
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", `${value} out of 5 stars`);
  for (let i = 1; i <= 5; i += 1) {
    let glyph = "\u2606";
    let state = "empty";
    if (value >= i) { glyph = "\u2605"; state = "full"; }
    else if (value >= i - 0.5) { glyph = "\u2605"; state = "half"; }
    wrap.appendChild(el("span", `star is-${state}`, glyph));
  }
  return wrap;
}

function attributeColumn(title, keys, values, names, extraClass) {
  const wrap = el("div", "attr-group" + (extraClass ? ` ${extraClass}` : ""));
  wrap.appendChild(el("h4", "attr-heading", title));
  const listEl = el("ul", "attr-list");
  for (const key of keys) {
    listEl.appendChild(attributeRow(names[key] || titleCase(key), values[key], key));
  }
  wrap.appendChild(listEl);
  return wrap;
}

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
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

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
