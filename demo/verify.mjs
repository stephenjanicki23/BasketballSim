/* Prove the page's box score is not fiction.
 *
 * ui/app.js rebuilds each box score by replaying the event stream. This
 * checks that rebuild against the box score the Python engine actually
 * produced, for every player in every exported game.
 *
 *     node demo/verify.mjs
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { newBoxState, applyEvent } = require("../ui/app.js");

const packed = readFileSync(new URL("./data.b64", import.meta.url), "utf8").trim();
const data = JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString());

const FIELDS = [
  ["points", "points"], ["fgm", "fgm"], ["fga", "fga"], ["tpm", "tpm"], ["tpa", "tpa"],
  ["ftm", "ftm"], ["fta", "fta"], ["oreb", "oreb"], ["dreb", "dreb"], ["ast", "ast"],
  ["stl", "stl"], ["blk", "blk"], ["tov", "tov"], ["pf", "pf"],
];

let checked = 0;
const failures = [];

for (const game of data.day.games) {
  // Older games ship as results only, with no event stream to rebuild from.
  if (!game.detailed) continue;
  const box = newBoxState(game);
  for (const event of game.events) applyEvent(box, event);

  for (const [key, boxKey] of [["home", "homeBox"], ["away", "awayBox"]]) {
    const engineLines = new Map(game[boxKey].players.map((p) => [p.player_id, p]));
    const rebuilt = box[key].lines;

    for (const [playerId, engine] of engineLines) {
      const mine = rebuilt.get(playerId);
      if (!mine) {
        if (engine.seconds > 0) failures.push(`${game.id} ${playerId}: missing from rebuild`);
        continue;
      }
      for (const [minKey, engineKey] of FIELDS) {
        checked += 1;
        if (mine[minKey] !== engine[engineKey]) {
          failures.push(
            `${game.id} ${engine.name} ${minKey}: rebuilt ${mine[minKey]} vs engine ${engine[engineKey]}`
          );
        }
      }
      // Minutes are reconstructed from substitution events, so allow rounding drift.
      checked += 1;
      if (Math.abs(mine.seconds - engine.seconds) > 1.0) {
        failures.push(
          `${game.id} ${engine.name} seconds: rebuilt ${mine.seconds.toFixed(1)} vs engine ${engine.seconds}`
        );
      }
    }
  }
}

const detailed = data.day.games.filter((g) => g.detailed).length;
console.log(`games: ${data.day.games.length} (${detailed} with play-by-play)   assertions: ${checked}`);
if (failures.length) {
  console.error(`\nFAILURES (${failures.length}):`);
  for (const failure of failures.slice(0, 25)) console.error("  " + failure);
  process.exit(1);
}
console.log("box score rebuild matches the engine exactly");
