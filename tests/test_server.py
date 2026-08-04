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
from bballsim.league.calendar import PACIFIC, GameStatus
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
        for key in ("league", "teams", "day", "season_totals", "standings",
                    "playerStats", "teamStats", "statColumns", "attributeGroups",
                    "scale", "coachScale", "eventTypes"):
            self.assertIn(key, data, key)
        # Rosters and play-by-play are fetched as they are opened; carrying
        # them here is about four megabytes nobody asked for.
        for team in data["teams"]:
            self.assertNotIn("players", team)
        for game in data["day"]["games"]:
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

    def test_a_live_game_carries_the_names_of_everyone_playing(self):
        """The tracker rebuilds its box score from the event stream, and an
        event carries a player id and nothing else. Without this the live app
        printed "NCI-04" in the Player column while the play-by-play beside it
        said his name -- it was reading names off the squads, which the live app
        only fetches when the Teams tab is opened."""
        detail = views.game_detail(self.game, self.league)
        roster = detail["roster"]
        squads = [self.league.teams[self.game.home_team_id],
                  self.league.teams[self.game.away_team_id]]
        self.assertEqual(len(roster), sum(len(t.players) for t in squads))
        for team in squads:
            for player in team.players:
                self.assertEqual(roster[player.id],
                                 [player.name, player.position.value])

        # Every id the revealed play-by-play mentions can be named from it.
        mentioned = {row[8] for row in detail["events"] if row[8]}
        mentioned |= {row[9] for row in detail["events"] if row[9]}
        self.assertTrue(mentioned)
        self.assertFalse(mentioned - set(roster))

    def test_a_live_game_does_not_ship_the_finished_box_score(self):
        """The engine simulates a game in full at tip-off, so `result` holds the
        final box and the final line score from the first second. Handing either
        to a page showing the first quarter gives away the ending -- `events`
        was filtered but these two were sent whole."""
        detail = views.game_detail(self.game, self.league)
        for key in ("homeBox", "awayBox", "homeLine", "awayLine"):
            self.assertNotIn(key, detail)

    def test_a_finished_game_ships_its_box_score(self):
        """There is nothing left to spoil, and the demo's verifier checks its
        rebuilt box against this one."""
        self.league.clock.advance(timedelta(days=1))
        self.league.tick()
        detail = views.game_detail(self.game, self.league)
        for key in ("homeBox", "awayBox", "homeLine", "awayLine", "roster"):
            self.assertIn(key, detail)
        self.assertEqual(
            detail["homeBox"]["players"][0]["name"],
            detail["roster"][detail["homeBox"]["players"][0]["player_id"]][0])

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


class TestTheDaySchedule(unittest.TestCase):
    """The schedule shows one day, and every fixture on it carries a preview:
    both records, and each side's leader in points, assists and rebounds."""

    def setUp(self):
        self.league = a_league()

    def play(self, days: int) -> None:
        self.league.clock.advance(timedelta(days=days))
        self.league.tick()

    def test_only_todays_fixtures_are_listed(self):
        day = views.day_schedule(self.league)
        listed = {g["id"] for g in day["games"]}
        self.assertTrue(listed, "no games today")
        self.assertLess(len(listed), len(self.league.schedule),
                        "the whole season was returned, not a day")
        for game in self.league.schedule:
            on_day = game.tipoff_at.astimezone(PACIFIC).date().isoformat() == day["date"]
            self.assertEqual(game.id in listed, on_day, game.id)

    def test_the_day_is_the_sim_clock_s_day(self):
        expected = self.league.clock.now().astimezone(PACIFIC).date()
        self.assertEqual(views.day_schedule(self.league)["date"], expected.isoformat())

    def test_a_finished_season_falls_back_to_the_last_day_played(self):
        """The published demo's clock sits past the end of its season. An empty
        schedule would be a worse answer than the final day."""
        self.play(400)
        day = views.day_schedule(self.league)
        self.assertTrue(day["games"], "a finished season showed an empty schedule")
        last = max(g.tipoff_at.astimezone(PACIFIC).date() for g in self.league.schedule)
        self.assertEqual(day["date"], last.isoformat())

    def test_every_fixture_carries_both_records_and_three_leaders(self):
        self.play(3)
        for game in views.day_schedule(self.league)["games"]:
            for side in ("home", "away"):
                preview = game["preview"][side]
                self.assertIn("wins", preview)
                self.assertIn("losses", preview)
                if preview["basis"] == "played":
                    self.assertEqual(
                        [l["label"] for l in preview["leaders"]],
                        ["PTS", "AST", "REB"],
                    )

    def test_the_record_matches_the_standings(self):
        self.play(3)
        for game in views.day_schedule(self.league)["games"]:
            for side, key in (("home", "home"), ("away", "away")):
                team_id = game[key]
                row = self.league.standings[team_id]
                self.assertEqual(game["preview"][side]["wins"], row.wins, team_id)
                self.assertEqual(game["preview"][side]["losses"], row.losses, team_id)

    def test_the_leader_is_actually_the_leader(self):
        self.play(3)
        checked = 0
        for team_id in self.league.teams:
            preview = views.team_leaders(self.league, team_id)
            if preview["basis"] != "played":
                continue
            lines = [l for l in self.league.stats.players.values()
                     if l.team_id == team_id and l.games > 0]
            for leader, key in zip(preview["leaders"], ("points", "assists", "rebounds")):
                best = max(line.per_game(key) for line in lines)
                self.assertAlmostEqual(leader["value"], round(best, 1), places=1,
                                       msg=f"{team_id} {key}")
                checked += 1
        self.assertGreater(checked, 0, "nothing was played -- the test proved nothing")

    def test_a_leader_names_a_real_player(self):
        """A preview prints names, and a name on this site links to the man.
        The front end has only the string without an id to go with it."""
        self.play(3)
        checked = 0
        for team_id, team in self.league.teams.items():
            preview = views.team_leaders(self.league, team_id)
            squad = {p.id: p for p in team.players}
            for leader in preview["leaders"]:
                self.assertIn("playerId", leader)
                self.assertIn(leader["playerId"], squad, team_id)
                checked += 1
        self.assertGreater(checked, 0)

    def test_an_unplayed_team_s_fallback_names_a_real_player_too(self):
        """The rated fallback goes through a different branch, and it was the
        one that would have shipped a name with nothing behind it."""
        league = a_league()
        for team_id, team in league.teams.items():
            preview = views.team_leaders(league, team_id)
            self.assertEqual(preview["basis"], "rated")
            for leader in preview["leaders"]:
                self.assertIn(leader["playerId"], {p.id for p in team.players})

    def test_an_unplayed_team_falls_back_to_its_best_rated_player(self):
        """Three blank stat lines tell a manager nothing, and printing zeroes
        would be a lie. The fallback says what it is."""
        preview = views.team_leaders(self.league, next(iter(self.league.teams)))
        self.assertEqual(preview["basis"], "rated")
        self.assertEqual(preview["wins"], 0)
        self.assertEqual(len(preview["leaders"]), 1)
        leader = preview["leaders"][0]
        self.assertEqual(leader["unit"], "stars")
        self.assertLessEqual(leader["value"], 5.0)

    def test_a_rated_fallback_names_the_best_player_on_the_roster(self):
        team_id = next(iter(self.league.teams))
        team = self.league.teams[team_id]
        best = max(team.players, key=lambda p: p.current_ability)
        leader = views.team_leaders(self.league, team_id)["leaders"][0]
        self.assertEqual(leader["name"], best.short_name)

    def test_the_bootstrap_ships_a_day_not_a_season(self):
        payload = views.bootstrap(self.league)
        self.assertIn("day", payload)
        self.assertNotIn("games", payload)
        self.assertEqual(payload["season_totals"]["fixtures"], len(self.league.schedule))
        self.assertGreater(len(self.league.schedule), len(payload["day"]["games"]))

    def test_season_totals_count_the_whole_season(self):
        self.play(3)
        payload = views.bootstrap(self.league)
        played = sum(1 for g in self.league.schedule if g.status == GameStatus.FINAL)
        self.assertEqual(payload["season_totals"]["played"], played)
        self.assertGreater(played, len(payload["day"]["games"]),
                           "the day is not a proxy for the season")
