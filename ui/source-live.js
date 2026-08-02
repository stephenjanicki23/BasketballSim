/* Data source: the running app.
 *
 * The same contract source-static.js implements, backed by the API instead of
 * a baked payload. The split matters for weight: a bootstrap is the schedule,
 * standings and stats, while a squad (12 players x 81 attributes) and a game's
 * play-by-play are fetched only when opened.
 */

async function getJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.json();
}

window.BBALL_SOURCE = {
  live: true,

  async load() {
    return getJSON("/api/bootstrap");
  },

  async gameDetail(gameId) {
    try {
      return await getJSON(`/api/games/${encodeURIComponent(gameId)}/detail`);
    } catch (error) {
      console.warn("game detail failed", error);
      return null;
    }
  },

  async squad(teamId) {
    return getJSON(`/api/teams/${encodeURIComponent(teamId)}/squad`);
  },

  /* Clock controls. Only the live app has these -- a published page cannot
   * advance anything -- so app.js hides the controls when `live` is false. */
  async command(path, body = {}) {
    const response = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${response.status} from ${path}`);
    return response.json();
  },
};
