/* Data source: the hosted static demo.
 *
 * The Python engine cannot run on a published page, so a whole season is
 * simulated ahead of time and baked into the document as one gzipped payload.
 * Everything is already here -- squads, box scores, every event -- so the
 * "fetches" below are lookups.
 *
 * This is one of two implementations of the same contract; the other is
 * source-live.js, talking to the API. app.js does not know which it has.
 */

window.BBALL_SOURCE = {
  live: false,

  async load() {
    const packed = document.getElementById("payload").textContent.trim();
    if (typeof DecompressionStream !== "function") {
      throw new Error("this browser can't unpack the season data (needs DecompressionStream)");
    }
    const binary = atob(packed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const data = await new Response(stream).json();
    this._data = data;
    return data;
  },

  // Already in the payload, events and all -- the published page ships the
  // whole day, since it cannot fetch a game later.
  async gameDetail(gameId) {
    const games = (this._data.day && this._data.day.games) || [];
    return games.find((g) => g.id === gameId) || null;
  },

  async squad(teamId) {
    return this._data.teams.find((t) => t.id === teamId) || null;
  },

  /* A published page is a snapshot of one moment in one season, so it has no
   * summer to show. Returning an explicitly unavailable menu rather than null
   * is what keeps the OFFSEASON tab hidden on the demo instead of rendering an
   * empty one -- the same shape the API sends mid-season. */
  async offseason() {
    return this._data.offseason || { available: false };
  },

  /* Baked in if the export carried it. Null rather than an empty book, so the
   * screen can say "not in this export" instead of "no records exist" -- those
   * are different statements and only one of them is true. */
  async records() {
    return this._data.records || null;
  },

  /* The awards watch as it stood at export. */
  async awards() {
    return this._data.awards || null;
  },

  /* The All-Star vote as it stood when the demo was exported. Frozen, unlike
   * the live one -- a static export has no season still moving underneath it,
   * and the screen says so. */
  async allstar() {
    return this._data.allstar || null;
  },

  /* A published page is one frozen moment, so there is no market activity to
   * show and nothing to veto. Returning null keeps the screen honest about
   * that rather than rendering an empty board. */
  async market() {
    return this._data.market || null;
  },

  // A published page has no server to talk to; the league clock is fixed.
  async command() {
    return null;
  },
};
