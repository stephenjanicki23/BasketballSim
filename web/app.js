/* Basketball Manager shell -- schedule browser + live game tracker.
 *
 * The tracker polls /api/games/<id>/feed with a `since` cursor. The server
 * decides how much of the play-by-play has been revealed based on the league
 * clock and the tracker speed, so the client stays dumb on purpose. */

const state = {
  teams: {},
  games: [],
  selectedGameId: null,
  lastSequence: 0,
  feedTimer: null,
  scheduleTimer: null,
};

const $ = (id) => document.getElementById(id);

const SCORE_EVENTS = new Set(["shot_made", "free_throw_made"]);
const META_EVENTS = new Set([
  "game_start", "period_start", "period_end", "jump_ball", "substitution", "timeout", "game_end",
]);

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/* ---------------- league + schedule ---------------- */

async function refreshLeague() {
  const league = await api("/api/league");
  $("league-name").textContent = league.name;
  $("league-clock").textContent =
    `${formatTime(league.now)} · ${league.games_live} live · ${league.games_final} final of ${league.games_scheduled}`;
}

async function refreshSchedule() {
  const data = await api("/api/schedule");
  state.teams = data.teams;
  state.games = data.games;
  renderSchedule();
  $("schedule-summary").textContent = `${data.games.length} games`;

  // On first load, park the list on today's games rather than the archive,
  // and open a live game if one is already running.
  if (!state.bootstrapped) {
    state.bootstrapped = true;
    const live = state.games.find((g) => g.status === "live");
    const focus = live || state.games.find((g) => g.status !== "final");
    if (focus) {
      const rows = [...document.querySelectorAll(".game-row")];
      const index = state.games.indexOf(focus);
      if (rows[index]) rows[index].scrollIntoView({ block: "center" });
    }
    if (live) selectGame(live.id);
  }
}

function teamAbbr(id) {
  return state.teams[id] ? state.teams[id].abbreviation : id;
}

function teamName(id) {
  return state.teams[id] ? state.teams[id].full_name : id;
}

function renderSchedule() {
  const list = $("game-list");
  list.innerHTML = "";

  for (const game of state.games) {
    const row = document.createElement("li");
    row.className = "game-row" + (game.id === state.selectedGameId ? " selected" : "");
    row.onclick = () => selectGame(game.id);

    const hasScore = game.home_score !== undefined;
    const homeWin = hasScore && game.home_score > game.away_score;

    row.innerHTML = `
      <span class="game-time">${formatTime(game.tipoff_at)}</span>
      <span class="matchup">
        <span class="line">
          <span class="team">${teamName(game.away_team_id)}</span>
          <span class="pts ${hasScore && !homeWin ? "win" : ""}">${hasScore ? game.away_score : ""}</span>
        </span>
        <span class="line">
          <span class="team">${teamName(game.home_team_id)}</span>
          <span class="pts ${homeWin ? "win" : ""}">${hasScore ? game.home_score : ""}</span>
        </span>
      </span>
      <span class="badge ${game.status}">${game.status === "scheduled" ? "" : game.status}</span>
    `;
    list.appendChild(row);
  }
}

/* ---------------- tracker ---------------- */

function selectGame(gameId) {
  if (state.feedTimer) clearInterval(state.feedTimer);
  state.selectedGameId = gameId;
  state.lastSequence = 0;
  $("pbp").innerHTML = "";
  $("box-score").innerHTML = "";
  $("tracker-empty").classList.add("hidden");
  $("tracker").classList.remove("hidden");
  renderSchedule();
  pollFeed();
  state.feedTimer = setInterval(pollFeed, 1000);
}

async function pollFeed() {
  if (!state.selectedGameId) return;
  const data = await api(`/api/games/${state.selectedGameId}/feed?since=${state.lastSequence}`);

  Object.assign(state.teams, data.teams || {});
  const game = data.game;

  $("away-abbr").textContent = teamAbbr(game.away_team_id);
  $("home-abbr").textContent = teamAbbr(game.home_team_id);
  $("away-score").textContent = data.away_score ?? 0;
  $("home-score").textContent = data.home_score ?? 0;
  $("period").textContent = periodLabel(data.period || 1);
  $("game-clock").textContent = data.clock || "12:00";

  const pill = $("status-pill");
  pill.textContent = game.status === "scheduled"
    ? `Tips ${formatTime(game.tipoff_at)}`
    : game.status.toUpperCase();
  pill.classList.toggle("live", game.status === "live");

  for (const event of data.events || []) {
    appendEvent(event);
    state.lastSequence = Math.max(state.lastSequence, event.sequence);
  }

  if (data.home_box && data.away_box) {
    renderBoxScore(data.away_box, data.home_box);
  }
  if (data.complete && state.feedTimer) {
    clearInterval(state.feedTimer);
    state.feedTimer = null;
  }
}

function periodLabel(period) {
  return period <= 4 ? `Q${period}` : `OT${period - 4}`;
}

function appendEvent(event) {
  const li = document.createElement("li");
  const classes = [];
  if (SCORE_EVENTS.has(event.type)) classes.push("score-play");
  if (META_EVENTS.has(event.type)) classes.push("meta");
  if (event.detail && (event.detail.points === 3 || event.detail.and_one)) classes.push("big");
  li.className = classes.join(" ");

  li.innerHTML = `
    <span class="t">${periodLabel(event.period)} ${event.clock}</span>
    <span class="sc">${event.away_score}-${event.home_score}</span>
    <span class="desc">${event.description}</span>
  `;
  // The list is column-reverse, so prepending puts the newest play at the
  // bottom and keeps the view pinned there as the game runs.
  $("pbp").prepend(li);
}

/* ---------------- box score ---------------- */

const BOX_COLUMNS = [
  ["minutes", "MIN"], ["points", "PTS"], ["reb", "REB"], ["ast", "AST"],
  ["fgm", "FGM"], ["fga", "FGA"], ["tpm", "3PM"], ["tpa", "3PA"],
  ["ftm", "FTM"], ["fta", "FTA"], ["stl", "STL"], ["blk", "BLK"],
  ["tov", "TO"], ["pf", "PF"],
];

function renderBoxScore(awayBox, homeBox) {
  $("box-score").innerHTML = [awayBox, homeBox].map(teamTable).join("");
}

function teamTable(box) {
  const header = BOX_COLUMNS.map(([, label]) => `<th>${label}</th>`).join("");
  const rows = box.players
    .filter((p) => p.seconds > 0)
    .map((p) => `<tr><td>${p.name}</td>${BOX_COLUMNS.map(([key]) => `<td>${p[key]}</td>`).join("")}</tr>`)
    .join("");
  const totals = BOX_COLUMNS.map(([key]) =>
    `<td>${key === "minutes" ? "" : key === "points" ? box.points : (box.totals[key] ?? "")}</td>`
  ).join("");

  return `
    <div class="box-team">
      <h3>${box.name} — ${box.points}</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Player</th>${header}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Team</td>${totals}</tr></tfoot>
        </table>
      </div>
    </div>
  `;
}

/* ---------------- controls ---------------- */

document.querySelectorAll("[data-advance]").forEach((button) => {
  button.onclick = async () => {
    await post("/api/clock/advance", { minutes: Number(button.dataset.advance) });
    await refreshAll();
  };
});

$("skip-next").onclick = async () => {
  await post("/api/clock/skip-to-next", {});
  await refreshAll();
};

$("speed-select").onchange = async (event) => {
  await post("/api/clock/speed", { speed: Number(event.target.value) });
};

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    $("tab-pbp").classList.toggle("hidden", tab.dataset.tab !== "pbp");
    $("tab-box").classList.toggle("hidden", tab.dataset.tab !== "box");
  };
});

async function refreshAll() {
  await Promise.all([refreshLeague(), refreshSchedule()]);
}

refreshAll();
state.scheduleTimer = setInterval(refreshAll, 5000);
