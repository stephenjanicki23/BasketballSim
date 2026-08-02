"""The HTTP layer, and the things a deployment depends on.

These start a real server on a real socket rather than calling handlers
directly, because what is being tested here is exactly the wiring a unit test
would stub out: that the health check answers, that concurrent requests do not
corrupt the league between them, and that the app saves without being asked.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
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

from bballsim.api import payload as views
from bballsim.api.server import serve
from bballsim.league import League, build_round_robin
from bballsim.league.calendar import GameStatus
from bballsim.roster import load_teams
from bballsim.save import BUNDLED_DATA_DIR, schedule_fingerprint, seed_data_dir


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

    # "A played season is never overwritten" used to be asserted here with a
    # season whose fixture list was empty. That is now exactly the case a
    # deploy *should* replace -- a save whose fixtures do not match the
    # committed calendar. The rule it was protecting, stated precisely, is
    # TestAStaleSeasonIsReplacedOnDeploy.test_a_season_on_the_current_calendar_is_kept.

    def test_seeding_the_bundled_directory_itself_is_a_no_op(self):
        """Running locally, source and destination are the same place."""
        self.assertEqual(seed_data_dir(BUNDLED_DATA_DIR), [])


class TestAStaleSeasonIsReplacedOnDeploy(unittest.TestCase):
    """Never overwriting a save is right until the calendar changes underneath
    it. Results are keyed by fixture id, so a season played on a schedule this
    build no longer has is not a season in progress -- its standings refer to
    games that do not exist. Those get replaced; anything else is kept."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.disk = Path(self.tmp.name) / "var-data"
        seed_data_dir(self.disk)
        self.season = self.disk / "season.json"
        os.environ.pop("BBALLSIM_RESET_SEASON", None)

    def tearDown(self):
        os.environ.pop("BBALLSIM_RESET_SEASON", None)
        self.tmp.cleanup()

    def write_season_file(self, games, schedule=None):
        data = json.loads(self.season.read_text())
        data["games"] = games
        if schedule is None:
            data.pop("schedule", None)
        else:
            data["schedule"] = schedule
        self.season.write_text(json.dumps(data))

    def test_the_committed_season_carries_a_schedule_stamp(self):
        self.assertTrue(json.loads(self.season.read_text()).get("schedule"))

    def test_a_season_on_the_current_calendar_is_kept(self):
        """The case that must not regress: games you have played survive."""
        data = json.loads(self.season.read_text())
        data["games"][0]["status"] = "final"   # pretend something was played
        self.season.write_text(json.dumps(data))

        self.assertEqual(seed_data_dir(self.disk), [])
        self.assertEqual(
            json.loads(self.season.read_text())["games"][0]["status"], "final"
        )

    def test_a_season_from_a_superseded_calendar_is_replaced(self):
        fresh = json.loads(self.season.read_text())
        self.write_season_file(fresh["games"][:40], schedule="a-different-calendar")

        written = seed_data_dir(self.disk)
        self.assertEqual([p.name for p in written], ["season.json"])
        restored = json.loads(self.season.read_text())
        self.assertEqual(len(restored["games"]), len(fresh["games"]))
        self.assertEqual(restored["schedule"], fresh["schedule"])

    def test_an_unstamped_season_is_judged_on_its_fixtures(self):
        """Files written before the stamp existed still have to be caught."""
        fresh = json.loads(self.season.read_text())
        self.write_season_file(fresh["games"][:40], schedule=None)
        self.assertEqual([p.name for p in seed_data_dir(self.disk)], ["season.json"])

        # ...and an unstamped file whose fixtures *do* match is left alone.
        self.write_season_file(fresh["games"], schedule=None)
        self.assertEqual(seed_data_dir(self.disk), [])

    def test_the_reset_switch_forces_a_wipe(self):
        for value in ("1", "true", "YES"):
            data = json.loads(self.season.read_text())
            data["games"][0]["status"] = "final"
            self.season.write_text(json.dumps(data))

            os.environ["BBALLSIM_RESET_SEASON"] = value
            self.assertEqual([p.name for p in seed_data_dir(self.disk)],
                             ["season.json"], value)
            self.assertEqual(
                json.loads(self.season.read_text())["games"][0]["status"],
                "scheduled", value,
            )
            os.environ.pop("BBALLSIM_RESET_SEASON")

    def test_the_roster_is_never_replaced(self):
        """Players and coaches have no calendar, and a deploy must not reset
        them -- development and chemistry live there."""
        league = self.disk / "league.json"
        data = json.loads(league.read_text())
        data["name"] = "edited in place"
        league.write_text(json.dumps(data))

        os.environ["BBALLSIM_RESET_SEASON"] = "1"
        seed_data_dir(self.disk)
        self.assertEqual(json.loads(league.read_text())["name"], "edited in place")

    def test_the_fingerprint_tracks_the_fixture_list(self):
        games = json.loads(self.season.read_text())["games"]
        self.assertEqual(schedule_fingerprint(games), schedule_fingerprint(games))
        self.assertNotEqual(
            schedule_fingerprint(games), schedule_fingerprint(games[:-1])
        )
        # Order must not matter; what was played must not either.
        shuffled = list(reversed(games))
        self.assertEqual(schedule_fingerprint(games), schedule_fingerprint(shuffled))


if __name__ == "__main__":
    unittest.main()


class TestPayloadShapes(unittest.TestCase):
    """The API and the published demo read the same shapes from the same
    module. These check the contract the front end depends on."""

    @classmethod
    def setUpClass(cls):
        cls.league = a_league()

    def test_bootstrap_carries_every_screen_but_no_rosters(self):
        data = views.bootstrap(self.league)
        for key in ("league", "teams", "games", "standings", "playerStats",
                    "teamStats", "statColumns", "attributeGroups", "scale",
                    "coachScale", "eventTypes"):
            self.assertIn(key, data, key)
        # Rosters and play-by-play are fetched as they are opened; carrying
        # them here is about four megabytes nobody asked for.
        for team in data["teams"]:
            self.assertNotIn("players", team)
        for game in data["games"]:
            self.assertNotIn("events", game)
        self.assertTrue(data["live"])

    def test_a_squad_carries_ratings_composites_and_a_coach(self):
        team = next(iter(self.league.teams.values()))
        squad = views.team_squad(team)
        self.assertEqual(len(squad["players"]), len(team.players))
        player = squad["players"][0]
        for key in ("ratings", "tendencies", "hidden", "composites", "ability",
                    "bio", "stars", "tier", "archetype"):
            self.assertIn(key, player, key)
        self.assertEqual(len(player["ratings"]), 81)
        self.assertIsNotNone(squad["coach"])

    def test_a_summary_never_claims_to_carry_play_by_play(self):
        """`detailed` means "events are in this object", not "events exist"."""
        game = self.league.schedule[0]
        self.assertFalse(views.game_summary(game, self.league)["detailed"])


class TestALiveGameDoesNotLeakItsEnding(unittest.TestCase):
    """The engine simulates a game in full at tip-off, so the final score is
    known from the first second. Reporting it would put the result in the
    schedule rail while the tracker is still in the first quarter."""

    def setUp(self):
        self.league = a_league()
        first = self.league.schedule[0]
        self.league.clock.jump_to(first.tipoff_at + timedelta(seconds=20))
        self.league.tick()
        self.game = first
        self.assertEqual(self.game.status, GameStatus.LIVE)

    def test_the_schedule_score_matches_the_revealed_play_by_play(self):
        summary = views.game_summary(self.game, self.league)
        detail = views.game_detail(self.game, self.league)
        events = detail["events"]
        self.assertGreater(len(events), 0, "nothing revealed -- the test proved nothing")
        self.assertLess(len(events), len(self.game.result.events),
                        "the whole game was revealed; this cannot detect a leak")
        # Event row: [period, clock, seconds, type, desc, home, away, ...]
        self.assertEqual(summary["homeScore"], events[-1][5])
        self.assertEqual(summary["awayScore"], events[-1][6])

    def test_the_final_score_is_not_reported_early(self):
        summary = views.game_summary(self.game, self.league)
        final = (self.game.result.home_score, self.game.result.away_score)
        self.assertNotEqual((summary["homeScore"], summary["awayScore"]), final)

    def test_a_finished_game_reports_its_final_score(self):
        self.league.clock.advance(timedelta(days=1))
        self.league.tick()
        self.assertEqual(self.game.status, GameStatus.FINAL)
        summary = views.game_summary(self.game, self.league)
        self.assertEqual(summary["homeScore"], self.game.result.home_score)
        self.assertEqual(summary["awayScore"], self.game.result.away_score)


class TestTheAppServesTheWholeSite(unittest.TestCase):
    def test_the_page_and_its_assets_are_served(self):
        with RunningServer(a_league()) as server:
            for path in ("/", "/app.js", "/styles.css", "/source-live.js", "/favicon.svg"):
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{server.port}{path}", timeout=10
                ) as response:
                    self.assertEqual(response.status, 200, path)

    def test_the_page_loads_the_live_source_not_the_static_one(self):
        with RunningServer(a_league()) as server:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.port}/", timeout=10) as r:
                html = r.read().decode()
            self.assertIn("source-live.js", html)
            self.assertNotIn("source-static.js", html)

    def test_large_json_is_compressed_when_asked(self):
        with RunningServer(a_league()) as server:
            url = f"http://127.0.0.1:{server.port}/api/bootstrap"
            request = urllib.request.Request(url, headers={"Accept-Encoding": "gzip"})
            with urllib.request.urlopen(request, timeout=10) as response:
                self.assertEqual(response.headers.get("Content-Encoding"), "gzip")
                packed = len(response.read())
            with urllib.request.urlopen(url, timeout=10) as response:
                plain = len(response.read())
            self.assertLess(packed, plain / 2, "compression is not earning its keep")
