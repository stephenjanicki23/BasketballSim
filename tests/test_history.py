"""Per-player game logs and the advanced progression series.

Both views are derived from the fixture list, so the tests are about agreement
rather than about the formulas -- those are `test_advanced.py`'s job. Two claims
carry the file:

  * a full game log, with the postseason filtered out, adds back up to exactly
    the season line the Stats page shows; and
  * the last point of a progression series is exactly the row the Advanced tab
    shows for that player.

If either drifts, two screens are telling a manager different things about the
same player, which is worse than one of them being missing.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.payload import bootstrap, team_squad
from bballsim.league import history, playoffs
from bballsim.league.advanced import ADVANCED_COLUMNS, advanced_table
from bballsim.league.calendar import GameStatus, build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_CACHE: dict[int, League] = {}

ADVANCED_KEYS = [key for key, _label in ADVANCED_COLUMNS]


def played(games_per_team: int = 12) -> League:
    """A season run to the end, postseason and all."""
    if games_per_team in _CACHE:
        return _CACHE[games_per_team]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=120))
    league.tick()
    _CACHE[games_per_team] = league
    return league


def any_team(league: League) -> str:
    return next(iter(league.teams))


class TestGameLog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.team_id = any_team(cls.league)
        cls.log = history.game_log(cls.league, cls.team_id)

    def test_every_player_who_played_has_a_log(self):
        self.assertTrue(self.log)
        for rows in self.log.values():
            self.assertTrue(rows)

    def test_newest_first(self):
        for player_id, rows in self.log.items():
            dates = [row["date"] for row in rows]
            self.assertEqual(dates, sorted(dates, reverse=True), player_id)

    def test_it_stops_at_the_limit(self):
        short = history.game_log(self.league, self.team_id, limit=4)
        for player_id, rows in short.items():
            self.assertLessEqual(len(rows), 4, player_id)
        self.assertTrue(any(len(rows) == 4 for rows in short.values()))

    def test_a_row_carries_what_the_table_shows(self):
        row = next(iter(self.log.values()))[0]
        for key in ("gameId", "date", "label", "home", "opponent", "result",
                    "score", "round", "minutes", "points", "rebounds",
                    "assists", "steals", "blocks", "turnovers", "fouls",
                    "fgm", "fga", "tpm", "tpa", "ftm", "fta"):
            self.assertIn(key, row)

    def test_there_is_no_plus_minus_column(self):
        """The engine does not track on/off, so `PlayerLine.plus_minus` is zero
        for every player in every game. A per-game table is exactly where
        someone would read that column and believe it."""
        row = next(iter(self.log.values()))[0]
        self.assertNotIn("plus_minus", row)

    def test_a_dnp_is_not_a_game_played(self):
        for rows in self.log.values():
            for row in rows:
                self.assertGreater(row["seconds"], 0.0)

    def test_the_whole_log_adds_up_to_the_season_line(self):
        """The claim the feature rests on: these are the same games the Stats
        page counted, so with the postseason taken out they sum to it."""
        full = history.game_log(self.league, self.team_id, limit=10_000)
        counted = 0
        for player_id, rows in full.items():
            season = self.league.stats.players.get(player_id)
            regular = [r for r in rows if not r["round"]]
            if season is None or not regular:
                continue
            counted += 1
            self.assertEqual(len(regular), season.games, player_id)
            for key in ("points", "assists", "steals", "blocks", "turnovers",
                        "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"):
                self.assertEqual(
                    sum(r[key] for r in regular), getattr(season, key),
                    f"{player_id} {key}")
            self.assertEqual(
                sum(r["rebounds"] for r in regular), season.rebounds, player_id)
        self.assertGreater(counted, 5, "nobody's log was checked")

    def test_a_postseason_game_says_which_round_it_was(self):
        """A playoff box score is still a recent game, but it is not the same
        kind of game, and the table has to be able to say so."""
        rounds = set()
        for team_id in self.league.teams:
            for rows in history.game_log(self.league, team_id).values():
                rounds.update(row["round"] for row in rows if row["round"])
        self.assertTrue(rounds, "no postseason reached the logs")
        self.assertTrue(rounds <= set(playoffs.ROUNDS), rounds)

    def test_the_opponent_and_the_result_match_the_fixture(self):
        by_id = {g.id: g for g in self.league.schedule}
        for rows in self.log.values():
            for row in rows:
                game = by_id[row["gameId"]]
                home = game.home_team_id == self.team_id
                self.assertEqual(row["home"], home)
                other = game.away_team_id if home else game.home_team_id
                self.assertEqual(row["opponent"],
                                 self.league.teams[other].abbreviation)
                scored, conceded = (
                    (game.result.home_score, game.result.away_score) if home
                    else (game.result.away_score, game.result.home_score))
                self.assertEqual(row["score"], f"{scored}-{conceded}")
                self.assertEqual(row["result"], "W" if scored > conceded else "L")

    def test_an_unplayed_season_logs_nothing(self):
        league = League(name="T", season="2026-27")
        for team in load_teams().teams[:4]:
            league.add_team(team)
        self.assertEqual(history.game_log(league, any_team(league)), {})


class TestCheckpoints(unittest.TestCase):
    def test_nothing_to_read_yet(self):
        self.assertEqual(history.checkpoints(0), [])

    def test_a_short_season_is_read_every_game(self):
        self.assertEqual(history.checkpoints(5, most=16), [1, 2, 3, 4, 5])

    def test_a_long_season_is_sampled(self):
        marks = history.checkpoints(1230, most=16)
        self.assertLessEqual(len(marks), 17)
        self.assertEqual(marks, sorted(set(marks)))
        self.assertGreaterEqual(marks[0], 1)

    def test_the_last_game_is_always_a_checkpoint(self):
        """The end of the chart has to be the season the table shows."""
        for count in (1, 7, 16, 17, 82, 615, 1230):
            self.assertEqual(history.checkpoints(count)[-1], count, count)


class TestAdvancedSeries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.series = history.advanced_series(cls.league)

    def test_everyone_who_played_has_a_series(self):
        played_ids = {p for p, line in self.league.stats.players.items() if line.games}
        self.assertEqual(set(self.series), played_ids)

    def test_a_point_carries_every_advanced_column(self):
        for entry in self.series.values():
            for point in entry["points"]:
                for key in ADVANCED_KEYS:
                    self.assertIn(key, point)
                self.assertIn("games", point)
                self.assertIn("date", point)

    def test_games_played_only_goes_up(self):
        for player_id, entry in self.series.items():
            counts = [p["games"] for p in entry["points"]]
            self.assertEqual(counts, sorted(counts), player_id)

    def test_it_ends_on_the_advanced_table(self):
        """The invariant: the last point of the line is the row the Advanced
        tab shows. Two screens, one number.

        Exact equality against the table rounded to the chart's two places --
        not a tolerance. A tolerance would pass a series that had drifted by
        less than it and still put a different number on each screen.
        """
        table = {row["player_id"]: row for row in advanced_table(self.league.stats)}
        checked = 0
        for player_id, entry in self.series.items():
            row = table.get(player_id)
            if row is None:
                continue
            checked += 1
            last = entry["points"][-1]
            self.assertEqual(last["games"], row["games"], player_id)
            for key in ADVANCED_KEYS:
                self.assertEqual(last[key], round(row[key], 2),
                                 f"{player_id} {key}")
        self.assertGreater(checked, 50, "nobody's series was checked")

    def test_the_postseason_is_left_out(self):
        """Season totals exclude playoff games, so a chart that included them
        would not land on the table it is meant to end at."""
        regular = [g for g in self.league.schedule
                   if g.status == GameStatus.FINAL and not playoffs.is_playoff(g)]
        self.assertLess(len(regular), len(
            [g for g in self.league.schedule if g.status == GameStatus.FINAL]),
            "this season never reached the postseason")
        for entry in self.series.values():
            self.assertLessEqual(entry["points"][-1]["games"], len(regular))

    def test_it_carries_the_season_it_belongs_to(self):
        for entry in self.series.values():
            self.assertEqual(entry["season"], self.league.season)

    def test_the_answer_is_not_recomputed_per_squad(self):
        """A squad request is not the place to replay a season from October."""
        self.assertIs(history.advanced_series(self.league), self.series)

    def test_a_reloaded_season_charts_identically(self):
        from bballsim.save import apply_season, dump_season, load_season

        rebuilt = League(name=self.league.name, season=self.league.season)
        for team in load_teams().teams:
            rebuilt.add_team(team)
        apply_season(rebuilt, load_season(dump_season(
            self.league.schedule, name=self.league.name, season=self.league.season)))
        self.assertEqual(history.advanced_series(rebuilt), self.series)

    def test_a_club_gets_its_own_players_and_no_others(self):
        team_id = any_team(self.league)
        roster = {p.id for p in self.league.teams[team_id].players}
        narrowed = history.team_advanced_series(self.league, team_id)
        self.assertTrue(narrowed)
        self.assertTrue(set(narrowed) <= roster)

    def test_an_unplayed_season_charts_nothing(self):
        league = League(name="T", season="2026-27")
        for team in load_teams().teams[:4]:
            league.add_team(team)
        self.assertEqual(history.advanced_series(league), {})


class TestTheSquadPayload(unittest.TestCase):
    def test_a_squad_carries_all_three_views(self):
        """The game log, the within-season line, and the career by season.
        All three are per-club, so all three ride on the squad rather than the
        bootstrap -- the same split that keeps 81 attributes a head off the
        first paint."""
        league = played()
        team = league.teams[any_team(league)]
        squad = team_squad(team, league)
        roster = {p["id"] for p in squad["players"]}
        for key in ("gameLog", "advancedSeries", "advancedSeasons"):
            self.assertTrue(squad[key], key)
            self.assertTrue(set(squad[key]) <= roster, key)

    def test_the_career_view_has_a_point_for_the_season_being_played(self):
        """One season played means one point, which is the honest answer and
        the reason the chart offers the other axis instead of drawing it."""
        league = played()
        team = league.teams[any_team(league)]
        squad = team_squad(team, league)
        for points in squad["advancedSeasons"].values():
            self.assertEqual([p["season"] for p in points], [league.season])

    def test_the_league_ships_the_seasons_it_has_played(self):
        rows = bootstrap(played())["seasons"]
        self.assertEqual([r["season"] for r in rows], [played().season])

    def test_a_squad_without_a_league_is_unchanged(self):
        """The roster view is still answerable on its own -- the history is an
        addition, not a requirement."""
        team = load_teams().teams[0]
        squad = team_squad(team)
        for key in ("gameLog", "advancedSeries", "advancedSeasons"):
            self.assertNotIn(key, squad)
        self.assertTrue(squad["players"])


if __name__ == "__main__":
    unittest.main()
