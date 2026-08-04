"""Advanced statistics.

These are derived columns, so the tests are mostly identities and bounds: a
rate that is a share of something has to sit between 0 and 100, a stat defined
to average 15 has to average 15, and the parts have to sum to the whole where
the formula says they do.

The bounds are checked against what a real season produces, because the failure
mode for a long formula is not a crash -- it is a number that looks like a
statistic and is off by a factor of five. Every one of the four calibration
bugs this file now guards was exactly that.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.payload import bootstrap
from bballsim.league.advanced import (
    ADVANCED_COLUMNS, PER_LEAGUE_AVERAGE, advanced_table, league_context,
    team_pace,
)
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_CACHE: dict[str, League] = {}


def played(games_per_team: int = 20) -> League:
    key = f"A{games_per_team}"
    if key in _CACHE:
        return _CACHE[key]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=2))
    league.tick()
    _CACHE[key] = league
    return league


class TestOpponentTotals(unittest.TestCase):
    """Half the table cannot be computed without them."""

    def test_a_team_records_what_was_done_to_it(self):
        stats = played().stats
        for team in stats.teams.values():
            self.assertGreater(team.opp_fga, 0, team.name)
            self.assertGreater(team.opp_possessions, 0, team.name)
            self.assertGreater(team.opp_rebounds, 0, team.name)

    def test_the_league_is_its_own_opponent(self):
        """Summed over thirty teams, what was done *to* everyone must equal
        what everyone did."""
        stats = played().stats
        teams = list(stats.teams.values())
        for own, against in (("fga", "opp_fga"), ("turnovers", "opp_turnovers"),
                             ("possessions", "opp_possessions"),
                             ("rebounds", "opp_rebounds")):
            mine = sum(getattr(t, own) for t in teams)
            theirs = sum(getattr(t, against) for t in teams)
            self.assertEqual(mine, theirs, own)


class TestTheTable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.rows = advanced_table(cls.league.stats, minimum_games=5)
        cls.qualified = [r for r in cls.rows if r["minutes"] >= 300]

    def test_it_produces_a_row_per_player(self):
        self.assertGreater(len(self.rows), 200)
        self.assertGreater(len(self.qualified), 80)

    def test_every_requested_column_is_present(self):
        wanted = {key for key, _label in ADVANCED_COLUMNS}
        self.assertEqual(len(wanted), 19, "nineteen advanced stats were asked for")
        for row in self.rows:
            for key in wanted:
                self.assertIn(key, row)
                self.assertIsInstance(row[key], float, key)

    def test_shares_stay_between_nought_and_a_hundred(self):
        for row in self.qualified:
            for key in ("orb_pct", "drb_pct", "trb_pct", "ast_pct", "stl_pct",
                        "blk_pct", "tov_pct", "usg_pct"):
                self.assertGreaterEqual(row[key], 0.0, f"{row['name']} {key}")
                self.assertLessEqual(row[key], 100.0, f"{row['name']} {key}")

    def test_total_rebound_pct_sits_between_its_halves(self):
        for row in self.qualified:
            low, high = sorted((row["orb_pct"], row["drb_pct"]))
            self.assertGreaterEqual(row["trb_pct"], low - 0.5, row["name"])
            self.assertLessEqual(row["trb_pct"], high + 0.5, row["name"])

    def test_win_shares_are_their_two_halves(self):
        for row in self.rows:
            self.assertAlmostEqual(row["ws"], row["ows"] + row["dws"], places=2)

    def test_box_plus_minus_is_its_two_halves(self):
        for row in self.rows:
            self.assertAlmostEqual(row["bpm"], row["obpm"] + row["dbpm"], places=2)

    def test_usage_across_a_lineup_comes_to_about_a_hundred(self):
        """Five players share every possession, so the minute-weighted usage of
        a whole squad has to land on 100."""
        stats = self.league.stats
        for team_id, team in stats.teams.items():
            rows = [r for r in self.rows if r["team_id"] == team_id]
            minutes = sum(r["minutes"] for r in rows)
            if minutes < team.minutes * 0.9:
                continue   # a squad the game-count filter has thinned
            weighted = sum(r["usg_pct"] * r["minutes"] for r in rows) / minutes
            self.assertAlmostEqual(weighted, 20.0, delta=2.0, msg=team.name)


class TestItAveragesWhereItShould(unittest.TestCase):
    """The definitions that pin themselves to a number."""

    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.rows = advanced_table(cls.league.stats, minimum_games=1)
        cls.minutes = sum(r["minutes"] for r in cls.rows)

    def weighted(self, key: str) -> float:
        return sum(r[key] * r["minutes"] for r in self.rows) / self.minutes

    def test_per_averages_fifteen_by_definition(self):
        self.assertAlmostEqual(self.weighted("per"), PER_LEAGUE_AVERAGE, places=1)

    def test_box_plus_minus_averages_zero(self):
        self.assertAlmostEqual(self.weighted("bpm"), 0.0, delta=0.6)

    def test_the_ratings_are_anchored_to_what_teams_actually_did(self):
        """An individual rating is an estimate; a team's is not. Without this
        anchor the league averaged an offensive rating of 122."""
        stats = self.league.stats
        for team_id, team in stats.teams.items():
            rows = [r for r in self.rows if r["team_id"] == team_id]
            minutes = sum(r["minutes"] for r in rows)
            if not minutes:
                continue
            actual = 100.0 * team.points / team.possessions
            got = sum(r["ortg"] * r["minutes"] for r in rows) / minutes
            self.assertAlmostEqual(got, actual, delta=1.5, msg=team.name)

    def test_the_two_league_ratings_agree(self):
        """Everything the league scores, the league also concedes."""
        self.assertAlmostEqual(self.weighted("ortg"), self.weighted("drtg"), delta=2.0)


class TestFullSeasonRanges(unittest.TestCase):
    """The check that catches a formula off by a factor.

    Each bound below is what a real season produces at the top. Three of them
    were failing when this file was written: defensive win shares peaked at
    23.7 against a real record near 5 (the wrong minutes denominator), win
    shares at 42 against 20, and VORP at 2.1 against about 10 (the *other*
    minutes denominator -- VORP and DWS genuinely use different ones).
    """

    @classmethod
    def setUpClass(cls):
        cls.rows = advanced_table(played(82).stats, minimum_games=20)

    def peak(self, key: str) -> float:
        return max(r[key] for r in self.rows)

    def test_per_tops_out_near_a_real_best_season(self):
        self.assertGreater(self.peak("per"), 24.0)
        self.assertLess(self.peak("per"), 40.0)

    def test_win_shares_top_out_near_twenty(self):
        self.assertGreater(self.peak("ws"), 12.0)
        self.assertLess(self.peak("ws"), 28.0)

    def test_defensive_win_shares_top_out_near_five(self):
        self.assertGreater(self.peak("dws"), 2.5)
        self.assertLess(self.peak("dws"), 9.0)

    def test_win_shares_per_48_top_out_near_a_third(self):
        self.assertGreater(self.peak("ws48"), 0.20)
        self.assertLess(self.peak("ws48"), 0.50)

    def test_box_plus_minus_tops_out_in_the_low_teens(self):
        self.assertGreater(self.peak("bpm"), 7.0)
        self.assertLess(self.peak("bpm"), 18.0)

    def test_vorp_tops_out_near_ten(self):
        self.assertGreater(self.peak("vorp"), 5.0)
        self.assertLess(self.peak("vorp"), 16.0)

    def test_offensive_ratings_stay_in_a_believable_band(self):
        ratings = [r["ortg"] for r in self.rows]
        self.assertLess(max(ratings), 145.0)
        self.assertGreater(min(ratings), 70.0)


class TestNothingToReport(unittest.TestCase):
    def test_an_unplayed_season_produces_no_rows(self):
        league = League(name="T", season="2026-27")
        for team in load_teams().teams[:6]:
            league.add_team(team)
        self.assertEqual(advanced_table(league.stats), [])

    def test_the_bootstrap_carries_the_table_and_its_columns(self):
        payload = bootstrap(played())
        self.assertGreater(len(payload["advancedStats"]), 100)
        self.assertEqual(len(payload["advancedColumns"]), 19)
        keys = {c["key"] for c in payload["advancedColumns"]}
        self.assertEqual(keys, {key for key, _ in ADVANCED_COLUMNS})
        for column in payload["advancedColumns"]:
            self.assertTrue(column["label"])

    def test_pace_is_possessions_per_forty_eight(self):
        stats = played().stats
        for team in stats.teams.values():
            self.assertGreater(team_pace(team), 80.0, team.name)
            self.assertLess(team_pace(team), 120.0, team.name)

    def test_the_league_context_sums_every_team(self):
        stats = played().stats
        ctx = league_context(list(stats.teams.values()))
        self.assertEqual(ctx.points, sum(t.points for t in stats.teams.values()))
        self.assertGreater(ctx.possessions, 0)
        self.assertGreater(ctx.value_of_possession, 0.5)
        self.assertLess(ctx.value_of_possession, 2.0)


if __name__ == "__main__":
    unittest.main()
