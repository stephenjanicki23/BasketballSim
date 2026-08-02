"""The HTTP layer, and the things a deployment depends on.

These start a real server on a real socket rather than calling handlers
directly, because what is being tested here is exactly the wiring a unit test
would stub out: that the health check answers, that concurrent requests do not
corrupt the league between them, and that the app saves without being asked.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.server import serve
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import BUNDLED_DATA_DIR, seed_data_dir


def a_league(team_count: int = 6) -> League:
    saved = load_teams(team_count)
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_round_robin(
        team_ids=list(league.teams), start_date=date(2026, 10, 20),
        times_played=1, days_between_rounds=1, season=league.season,
    ))
    # Park the sim clock just before opening night. Without this the fixtures
    # sit months in the future and advancing the clock plays nothing.
    league.clock.jump_to(league.schedule[0].tipoff_at - timedelta(minutes=1))
    return league


class RunningServer:
    """A server on an ephemeral port, stopped on the way out."""

    def __init__(self, league: League, **kwargs):
        self.league = league
        self.kwargs = kwargs
        self._server = None
        self._ready = threading.Event()

    def __enter__(self):
        def capture(server):
            self._server = server
            self._ready.set()

        self._thread = threading.Thread(
            target=serve,
            args=(self.league,),
            kwargs={"host": "127.0.0.1", "port": 0, "on_start": capture, **self.kwargs},
            daemon=True,
        )
        self._thread.start()
        if not self._ready.wait(10):
            raise RuntimeError("server did not start")
        self.port = self._server.server_address[1]
        return self

    def __exit__(self, *exc):
        self._server.shutdown()
        self._thread.join(timeout=10)

    def get(self, path: str):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=10) as r:
            return json.loads(r.read())

    def post(self, path: str, payload: dict):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as r:
            return json.loads(r.read())


class TestTheApi(unittest.TestCase):
    def test_health_answers_without_touching_the_league(self):
        """A platform health check must succeed before anything is played, and
        must not depend on the league being in any particular state."""
        with RunningServer(a_league()) as server:
            self.assertEqual(server.get("/api/health"), {"status": "ok"})

    def test_the_core_endpoints_respond(self):
        with RunningServer(a_league()) as server:
            self.assertEqual(server.get("/api/league")["team_count"], 6)
            self.assertEqual(len(server.get("/api/teams")), 6)
            self.assertEqual(len(server.get("/api/standings")), 6)
            self.assertIn("games", server.get("/api/schedule"))

    def test_an_unknown_endpoint_is_a_404_not_a_crash(self):
        with RunningServer(a_league()) as server:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                server.get("/api/nonsense")
            self.assertEqual(caught.exception.code, 404)


class TestConcurrentRequestsDoNotCorruptTheLeague(unittest.TestCase):
    """The server is threaded and the League is shared mutable state.

    Without a lock, two requests can tick simultaneously and finalise the same
    game twice -- which shows up as a standings table counting more games than
    were played. This hammers the clock from several threads at once and then
    checks the books balance.
    """

    def test_standings_agree_with_games_played_under_load(self):
        league = a_league()
        with RunningServer(league) as server:
            errors: list[Exception] = []

            def push():
                try:
                    for _ in range(4):
                        server.post("/api/clock/advance", {"days": 1})
                        server.get("/api/standings")
                except Exception as exc:  # noqa: BLE001 - reported below
                    errors.append(exc)

            threads = [threading.Thread(target=push) for _ in range(6)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=60)

            self.assertEqual(errors, [], f"requests failed: {errors[:3]}")

            rows = server.get("/api/standings")
            played = sum(1 for g in league.schedule if g.status == GameStatus.FINAL)
            # Every finished game contributes exactly one win and one loss.
            self.assertEqual(sum(r["wins"] for r in rows), played)
            self.assertEqual(sum(r["losses"] for r in rows), played)
            self.assertEqual(sum(r["games_played"] for r in rows), played * 2)
            self.assertGreater(played, 0, "no games played -- the test proved nothing")


class TestSavingWithoutBeingAsked(unittest.TestCase):
    def test_the_server_saves_on_shutdown(self):
        league = a_league()
        saved: list[int] = []
        with RunningServer(league, save=lambda lg: saved.append(len(lg.schedule))):
            pass
        self.assertEqual(len(saved), 1, "shutdown should have saved exactly once")

    def test_autosave_runs_while_the_server_is_up(self):
        """A host can stop a container without warning, so waiting for a clean
        shutdown to write anything is not good enough."""
        league = a_league()
        saves = threading.Semaphore(0)
        with RunningServer(
            league, save=lambda _lg: saves.release(), autosave_seconds=0.2
        ) as server:
            server.post("/api/clock/advance", {"days": 3})
            self.assertTrue(saves.acquire(timeout=10), "no autosave within 10s")

    def test_autosave_only_writes_when_something_was_played(self):
        league = a_league()
        count = []
        with RunningServer(
            league, save=lambda _lg: count.append(1), autosave_seconds=0.2
        ):
            threading.Event().wait(1.0)   # several autosave windows, no games
        # Only the shutdown save; the idle windows wrote nothing.
        self.assertEqual(len(count), 1, f"idle server wrote {len(count)} times")

    def test_a_failing_save_does_not_take_the_server_down(self):
        def explode(_league):
            raise OSError("disk full")

        league = a_league()
        with RunningServer(league, save=explode, autosave_seconds=0.2) as server:
            server.post("/api/clock/advance", {"days": 2})
            threading.Event().wait(0.6)
            self.assertEqual(server.get("/api/health"), {"status": "ok"})


class TestSeedingAMountedDisk(unittest.TestCase):
    """A deployment's disk starts empty and its checkout is replaced on every
    deploy, so the save files have to be copied across once and then left
    alone."""

    def test_an_empty_directory_is_seeded(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "var-data"
            copied = seed_data_dir(target)
            self.assertEqual(
                {p.name for p in copied}, {"league.json", "season.json"}
            )
            self.assertTrue((target / "league.json").is_file())
            self.assertTrue((target / "season.json").is_file())

    def test_seeding_twice_changes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "var-data"
            seed_data_dir(target)
            self.assertEqual(seed_data_dir(target), [])

    def test_a_played_season_is_never_overwritten_by_a_deploy(self):
        """The failure this guards against loses somebody's season."""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "var-data"
            seed_data_dir(target)
            (target / "season.json").write_text('{"version": 1, "games": []}')

            seed_data_dir(target)   # a redeploy
            self.assertEqual(
                json.loads((target / "season.json").read_text())["games"], []
            )

    def test_seeding_the_bundled_directory_itself_is_a_no_op(self):
        """Running locally, source and destination are the same place."""
        self.assertEqual(seed_data_dir(BUNDLED_DATA_DIR), [])


if __name__ == "__main__":
    unittest.main()
