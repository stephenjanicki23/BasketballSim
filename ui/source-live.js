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

  /* The whole OFFSEASON menu in one fetch. Answers even when the season is
   * still running -- the UI has to be told the menu is unavailable, which is
   * a different thing from a request that failed. */
  async offseason() {
    try {
      return await getJSON("/api/offseason");
    } catch (error) {
      console.warn("offseason fetch failed", error);
      return null;
    }
  },

  /* The record book. Not in the bootstrap: it is a page most visits never
   * open, and its season half walks every archived season. */
  async records() {
    try {
      return await getJSON("/api/records");
    } catch (error) {
      console.warn("records fetch failed", error);
      return null;
    }
  },

  /* The Trade Block. Everything in it has already happened -- the market runs
   * itself inside the league tick. */
  async market() {
    try {
      return await getJSON("/api/trades/market");
    } catch (error) {
      console.warn("trade market fetch failed", error);
      return null;
    }
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
