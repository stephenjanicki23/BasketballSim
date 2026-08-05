"""Zero-dependency JSON API + static file server.

Endpoints
    GET  /api/health                        liveness, for a platform health check
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

    GET  /api/offseason                     the whole OFFSEASON menu
    GET  /api/offseason/payrolls            every club's payroll, richest first
    POST /api/offseason/open                tick contracts, build the expiring list
    POST /api/offseason/negotiate           {"id","years","salary"} -> a response
    POST /api/offseason/advance             run the summer and start the next season

Swap this for FastAPI/Flask whenever you want; the League object is the only
thing it touches.
"""

from __future__ import annotations

import gzip
import json
import mimetypes
import signal
import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ..league import franchise
from ..league.calendar import GameStatus
from ..league.league import DEFAULT_TRACKER_SPEED, League
from ..league.stats import STAT_COLUMNS
from . import payload as views

WEB_ROOT = Path(__file__).resolve().parents[2] / "ui"


class ApiHandler(BaseHTTPRequestHandler):
    league: League = None  # type: ignore[assignment]

    # One League, many request threads. Every endpoint either ticks the league
    # or reads tables the tick rebuilds, so requests are serialised here rather
    # than racing over shared mutable state -- two concurrent ticks could
    # finalise the same game twice and count it twice in the standings.
    lock: threading.RLock = threading.RLock()

    # -- plumbing ------------------------------------------------------
    def log_message(self, fmt: str, *args) -> None:  # quieter console
        return

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        # The bootstrap and a squad are hundreds of kilobytes of repetitive
        # JSON; over a real network that is the difference between instant and
        # sluggish. Compressed only when it is worth it and only when asked.
        if len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, 6)
            headers["Content-Encoding"] = "gzip"
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
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

        # Deliberately outside the lock and without a tick: a health check has
        # to answer even while a slow request holds the league.
        if path == "/api/health":
            self._send_json({"status": "ok"})
            return

        if path.startswith("/api/"):
            try:
                with self.lock:
                    self.league.tick()
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
        try:
            with self.lock:
                self.league.tick()
                self._route_post(parsed.path, body)
        except Exception as exc:
            self._send_json({"error": str(exc), "type": type(exc).__name__}, 500)

    # -- handlers ------------------------------------------------------
    def _route_api(self, path: str, query: dict) -> None:
        league = self.league
        parts = [p for p in path.split("/") if p][1:]  # drop "api"

        if parts == ["bootstrap"]:
            # Everything every screen needs, in one round trip. Rosters and
            # play-by-play are deliberately not in here; they are fetched as
            # they are opened.
            minimum = int(query.get("min_games", ["1"])[0])
            self._send_json(views.bootstrap(league, minimum_games=minimum))

        elif parts == ["league"]:
            self._send_json(league.to_dict())

        elif parts == ["teams"]:
            self._send_json([t.to_dict() for t in league.teams.values()])

        elif len(parts) == 3 and parts[0] == "teams" and parts[2] == "squad":
            team = league.teams.get(parts[1])
            if team is None:
                self._send_json({"error": "team not found"}, 404)
            else:
                self._send_json(views.team_squad(team, league))

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

        elif len(parts) == 3 and parts[0] == "games" and parts[2] == "detail":
            game = league.game(parts[1])
            if game is None:
                self._send_json({"error": "game not found"}, 404)
            else:
                self._send_json(views.game_detail(game, league))

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

        elif parts == ["offseason"]:
            # The whole menu in one fetch. Gated on the Finals having concluded,
            # but the endpoint answers either way -- the UI needs to be told the
            # menu is unavailable, which is different from a 404.
            self._send_json(views.offseason_view(league))

        elif parts == ["offseason", "payrolls"]:
            self._send_json(franchise.payroll_table(league))

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

        elif len(parts) == 3 and parts[0] == "teams" and parts[2] == "rest":
            # The manager's lever. An instruction, not a team sheet: it holds
            # until it is taken back, and it outranks the head coach's own
            # judgement -- including in the postseason, where the coach rests
            # nobody.
            team = league.teams.get(parts[1])
            if team is None:
                self._send_json({"error": "team not found"}, 404)
                return
            player_id = str(body.get("player_id", ""))
            if team.player(player_id) is None:
                self._send_json({"error": "player not on this team"}, 404)
                return
            resting = bool(body.get("resting"))
            if resting and player_id not in team.rested:
                team.rested.append(player_id)
            elif not resting and player_id in team.rested:
                team.rested.remove(player_id)
            self._send_json({"team_id": team.id, "rested": list(team.rested)})

        elif parts == ["clock", "speed"]:
            league.tracker_speed = max(0.25, float(body.get("speed", DEFAULT_TRACKER_SPEED)))
            self._send_json({"tracker_speed": league.tracker_speed})

        elif parts == ["offseason", "open"]:
            # Opens the summer: ticks every contract down a year and builds the
            # expiring list. Idempotent -- `franchise.begin` refuses a second
            # call for the same season, which is what stops a double-click
            # ageing every contract twice.
            if not franchise.is_available(league):
                self._send_json({"error": "the season is not over"}, 409)
                return
            franchise.begin(league)
            self._send_json(views.offseason_view(league))

        elif parts == ["offseason", "negotiate"]:
            # One offer to one player or coach. Goes through exactly the
            # negotiation service the AI uses.
            if not franchise.is_available(league):
                self._send_json({"error": "the season is not over"}, 409)
                return
            franchise.begin(league)
            result = franchise.negotiate(
                league,
                str(body.get("id", "")),
                int(body.get("years", 1)),
                int(body.get("salary", 0)),
            )
            self._send_json(result, 404 if result.get("error") else 200)

        elif parts == ["offseason", "advance"]:
            # The whole pipeline, in the order `franchise.advance` documents.
            # Anything the manager did not settle by hand is auto-resolved on
            # the way through.
            result = franchise.advance(league)
            if result.get("error"):
                self._send_json(result, 409)
                return
            self._send_json({"report": result, "offseason": views.offseason_view(league)})

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


def serve(
    league: League,
    host: str = "127.0.0.1",
    port: int = 8000,
    save: "callable | None" = None,
    autosave_seconds: float = 120.0,
    on_start: "callable | None" = None,
) -> None:
    """Run the app until it is asked to stop.

    `save`, if given, is called periodically and once on the way out. Saving
    only at shutdown is fine at a terminal, where you press Ctrl-C; it is not
    fine on a host that can stop a container without warning, so games are
    checkpointed while the server runs as well.

    `on_start` is handed the running server, which is how a caller that did not
    create it -- a test, or an embedder -- gets hold of `shutdown()`.
    """
    ApiHandler.league = league
    server = ThreadingHTTPServer((host, port), ApiHandler)
    stopping = threading.Event()

    def checkpoint() -> None:
        if save is None:
            return
        try:
            with ApiHandler.lock:
                save(league)
        except Exception as exc:  # a failed save must not take the server down
            print(f"autosave failed: {type(exc).__name__}: {exc}")

    def autosave_loop() -> None:
        played = _finalised(league)
        while not stopping.wait(autosave_seconds):
            now_played = _finalised(league)
            if now_played != played:      # nothing new, nothing to write
                played = now_played
                checkpoint()

    if save is not None and autosave_seconds > 0:
        threading.Thread(target=autosave_loop, daemon=True).start()

    def request_stop(signum, _frame) -> None:
        # SIGTERM is how a container is asked to stop. Without this the process
        # is killed outright and the `finally` below never runs, taking every
        # game played since the last checkpoint with it.
        print(f"\nReceived {signal.Signals(signum).name}, shutting down.")
        stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, request_stop)
        except ValueError:
            pass  # not the main thread (tests, embedded use) -- Ctrl-C still works

    print(f"Basketball Manager shell running at http://{host}:{port}")
    print("Ctrl-C to stop.")
    if on_start is not None:
        on_start(server)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        stopping.set()
        server.server_close()
        checkpoint()


def _finalised(league: League) -> int:
    return sum(1 for g in league.schedule if g.status == GameStatus.FINAL)
