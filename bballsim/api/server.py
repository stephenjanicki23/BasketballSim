"""Zero-dependency JSON API + static file server.

Endpoints
    GET  /api/league                        league summary and clock
    GET  /api/teams                         all teams
    GET  /api/teams/<id>                    one team with its roster
    GET  /api/schedule?date=YYYY-MM-DD      fixtures (all, or one day)
    GET  /api/stats/players?min_games=n     season per-game player stats
    GET  /api/stats/teams                   season per-game team stats
    GET  /api/games/<id>                    fixture + box score if available
    GET  /api/games/<id>/feed?since=<n>     play-by-play revealed so far
    POST /api/clock/advance {"minutes": n}  push the league clock forward
    POST /api/clock/speed   {"speed": n}    game seconds per real second

Swap this for FastAPI/Flask whenever you want; the League object is the only
thing it touches.
"""

from __future__ import annotations

import json
import mimetypes
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ..league.calendar import GameStatus
from ..league.league import League
from ..league.stats import STAT_COLUMNS

WEB_ROOT = Path(__file__).resolve().parents[2] / "web"


class ApiHandler(BaseHTTPRequestHandler):
    league: League = None  # type: ignore[assignment]

    # -- plumbing ------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:  # quieter console
        return

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.is_file():
            self._send_json({"error": "not found"}, 404)
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    # -- routing -------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.league.tick()
            try:
                self._route_api(path, query)
            except Exception as exc:  # keep the shell alive while iterating
                self._send_json({"error": str(exc), "type": type(exc).__name__}, 500)
            return

        if path in ("/", "/index.html"):
            self._send_file(WEB_ROOT / "index.html")
            return

        candidate = (WEB_ROOT / path.lstrip("/")).resolve()
        if WEB_ROOT.resolve() in candidate.parents or candidate == WEB_ROOT.resolve():
            self._send_file(candidate)
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self._send_json({"error": "not found"}, 404)
            return
        body = self._read_json_body()
        self.league.tick()
        try:
            self._route_post(parsed.path, body)
        except Exception as exc:
            self._send_json({"error": str(exc), "type": type(exc).__name__}, 500)

    # -- handlers ------------------------------------------------------
    def _route_api(self, path: str, query: dict) -> None:
        league = self.league
        parts = [p for p in path.split("/") if p][1:]  # drop "api"

        if parts == ["league"]:
            self._send_json(league.to_dict())

        elif parts == ["teams"]:
            self._send_json([t.to_dict() for t in league.teams.values()])

        elif len(parts) == 2 and parts[0] == "teams":
            team = league.teams.get(parts[1])
            if team is None:
                self._send_json({"error": "team not found"}, 404)
            else:
                self._send_json(team.to_dict(include_players=True))

        elif parts == ["schedule"]:
            games = league.schedule
            if "date" in query:
                day = date.fromisoformat(query["date"][0])
                games = league.games_on(day)
            if "team" in query:
                team_id = query["team"][0]
                games = [g for g in games if team_id in (g.home_team_id, g.away_team_id)]
            self._send_json({
                "now": league.clock.now().isoformat(),
                "games": [g.to_dict() for g in games],
                "teams": {t.id: t.to_dict() for t in league.teams.values()},
            })

        elif parts == ["stats", "players"]:
            minimum = int(query.get("min_games", ["1"])[0])
            self._send_json({
                "columns": [
                    {"key": key, "label": label, "per_game": per_game}
                    for key, label, per_game in STAT_COLUMNS
                ],
                "rows": league.stats.player_table(minimum_games=minimum),
            })

        elif parts == ["stats", "teams"]:
            self._send_json({
                "columns": [
                    {"key": key, "label": label, "per_game": per_game}
                    for key, label, per_game in STAT_COLUMNS
                ],
                "rows": league.stats.team_table(),
            })

        elif parts == ["standings"]:
            self._send_json(league.standings_table())

        elif len(parts) == 2 and parts[0] == "games":
            game = league.game(parts[1])
            if game is None:
                self._send_json({"error": "game not found"}, 404)
            else:
                include = game.status == GameStatus.FINAL
                self._send_json(game.to_dict(include_result=include))

        elif len(parts) == 3 and parts[0] == "games" and parts[2] == "feed":
            game = league.game(parts[1])
            if game is None:
                self._send_json({"error": "game not found"}, 404)
                return
            since = int(query.get("since", ["0"])[0])
            payload = league.feed(game, since_sequence=since)
            payload["teams"] = {
                t.id: t.to_dict() for t in league.teams.values()
                if t.id in (game.home_team_id, game.away_team_id)
            }
            if game.result is not None and game.status == GameStatus.FINAL:
                payload["home_box"] = game.result.home_box.to_dict()
                payload["away_box"] = game.result.away_box.to_dict()
            self._send_json(payload)

        else:
            self._send_json({"error": "unknown endpoint", "path": path}, 404)

    def _route_post(self, path: str, body: dict) -> None:
        league = self.league
        parts = [p for p in path.split("/") if p][1:]

        if parts == ["clock", "advance"]:
            minutes = float(body.get("minutes", 0))
            days = float(body.get("days", 0))
            league.clock.advance(timedelta(minutes=minutes, days=days))
            changed = league.tick()
            self._send_json({
                "now": league.clock.now().isoformat(),
                "changed": [g.to_dict() for g in changed],
            })

        elif parts == ["clock", "speed"]:
            league.tracker_speed = max(0.25, float(body.get("speed", 20.0)))
            self._send_json({"tracker_speed": league.tracker_speed})

        elif parts == ["clock", "skip-to-next"]:
            next_game = league.next_game_after(league.clock.now())
            if next_game is None:
                self._send_json({"error": "no games remaining"}, 404)
                return
            league.clock.jump_to(next_game.tipoff_at)
            league.tick()
            self._send_json({
                "now": league.clock.now().isoformat(),
                "game_id": next_game.id,
            })

        else:
            self._send_json({"error": "unknown endpoint", "path": path}, 404)


def serve(league: League, host: str = "127.0.0.1", port: int = 8000) -> None:
    ApiHandler.league = league
    server = ThreadingHTTPServer((host, port), ApiHandler)
    print(f"Basketball Manager shell running at http://{host}:{port}")
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()
