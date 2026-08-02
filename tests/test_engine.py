"""Sanity tests for the simulation shell.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import copy
import os
import subprocess
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.chemistry import evaluate as evaluate_chemistry
from bballsim.engine.events import EventType
from bballsim.engine.game import GameSimulator
from bballsim.league import GameStatus, League, build_round_robin
from bballsim.league.stats import STAT_COLUMNS, PlayerSeasonLine
from bballsim.models import Lineup
from bballsim.placeholder import make_teams
from bballsim.tactics import OffensiveScheme, Tactics


def sim(home, away, seed="test"):
    return GameSimulator("test-game", copy.deepcopy(home), copy.deepcopy(away), seed=seed).simulate()


class TestGameSimulation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.teams = make_teams(4)
        cls.result = sim(cls.teams[0], cls.teams[1])

    def test_game_finishes_with_a_winner(self):
        self.assertNotEqual(self.result.home_score, self.result.away_score)
        self.assertGreaterEqual(self.result.periods_played, 4)

    def test_events_are_ordered_and_bookended(self):
        events = self.result.events
        self.assertEqual(events[0].type, EventType.GAME_START)
        self.assertEqual(events[-1].type, EventType.GAME_END)
        sequences = [e.sequence for e in events]
        self.assertEqual(sequences, sorted(sequences))
        # game_seconds must be monotonic or the tracker reveals events out of order
        seconds = [e.game_seconds for e in events]
        self.assertEqual(seconds, sorted(seconds))

    def test_box_score_matches_final_score(self):
        self.assertEqual(self.result.home_box.points, self.result.home_score)
        self.assertEqual(self.result.away_box.points, self.result.away_score)

    def test_minutes_add_up_to_five_players_per_period(self):
        for box in (self.result.home_box, self.result.away_box):
            total = sum(line.seconds for line in box.players.values())
            expected = 5 * self.result.periods_played * 12 * 60
            # overtime periods are 5 minutes, so only assert on regulation games
            if self.result.periods_played == 4:
                self.assertAlmostEqual(total, expected, delta=1.0)

    def test_totals_are_internally_consistent(self):
        for box in (self.result.home_box, self.result.away_box):
            totals = box.to_dict()["totals"]
            self.assertLessEqual(totals["fgm"], totals["fga"])
            self.assertLessEqual(totals["tpm"], totals["tpa"])
            self.assertLessEqual(totals["tpa"], totals["fga"])
            self.assertLessEqual(totals["ftm"], totals["fta"])
            self.assertLessEqual(totals["ast"], totals["fgm"])
            self.assertEqual(
                box.points,
                2 * (totals["fgm"] - totals["tpm"]) + 3 * totals["tpm"] + totals["ftm"],
            )

    def test_same_seed_reproduces_the_game(self):
        a = sim(self.teams[0], self.teams[1], seed="repeat")
        b = sim(self.teams[0], self.teams[1], seed="repeat")
        self.assertEqual(a.home_score, b.home_score)
        self.assertEqual(a.away_score, b.away_score)
        self.assertEqual(
            [e.description for e in a.events], [e.description for e in b.events]
        )

    def test_the_same_seed_reproduces_the_game_in_a_fresh_process(self):
        """Reproducibility has to survive a restart, not just a loop.

        Python salts string hashing per process, so anything that seeds off
        `hash()` -- or iterates a set of attribute names while drawing from a
        seeded RNG -- replays a *different* game tomorrow. That is invisible
        in-process, which is why this shells out with two different hash seeds.
        """
        script = (
            "import copy;"
            "from bballsim.placeholder import make_teams;"
            "from bballsim.engine.game import GameSimulator;"
            "a, b = make_teams(2);"
            "r = GameSimulator('g', copy.deepcopy(a), copy.deepcopy(b), seed='g').simulate();"
            "print(r.home_score, r.away_score, len(r.events))"
        )
        root = Path(__file__).resolve().parents[1]
        runs = []
        for hash_seed in ("0", "1", "12345"):
            env = {**os.environ, "PYTHONHASHSEED": hash_seed, "PYTHONPATH": str(root)}
            runs.append(subprocess.run(
                [sys.executable, "-c", script],
                capture_output=True, text=True, cwd=root, env=env, check=True,
            ).stdout.strip())
        self.assertEqual(len(set(runs)), 1, f"seed 'g' replayed differently: {runs}")

    def test_different_seeds_diverge(self):
        a = sim(self.teams[0], self.teams[1], seed="one")
        b = sim(self.teams[0], self.teams[1], seed="two")
        self.assertNotEqual(
            [e.description for e in a.events], [e.description for e in b.events]
        )


# Attribute-driven outcomes are covered by tests/test_ratings.py, which uses
# paired seeds and asserts that every attribute it sets actually exists.


class TestTacticsDriveOutcomes(unittest.TestCase):
    def test_three_point_emphasis_raises_three_point_attempts(self):
        base, opponent = make_teams(2)

        low = copy.deepcopy(base)
        low.tactics = Tactics(three_point_emphasis=5, offensive_scheme=OffensiveScheme.INSIDE_OUT)
        high = copy.deepcopy(base)
        high.tactics = Tactics(three_point_emphasis=95, offensive_scheme=OffensiveScheme.PACE_AND_SPACE)

        low_attempts = sum(sim(low, opponent, seed=f"low-{i}").home_box.total("tpa") for i in range(10))
        high_attempts = sum(sim(high, opponent, seed=f"high-{i}").home_box.total("tpa") for i in range(10))
        self.assertGreater(high_attempts, low_attempts * 1.3)

    def test_pace_changes_possession_count(self):
        base, opponent = make_teams(2)
        slow = copy.deepcopy(base)
        slow.tactics = Tactics(pace=5)
        fast = copy.deepcopy(base)
        fast.tactics = Tactics(pace=95, offensive_scheme=OffensiveScheme.SEVEN_SECONDS)

        slow_poss = sum(sim(slow, opponent, seed=f"s-{i}").home_box.possessions for i in range(6))
        fast_poss = sum(sim(fast, opponent, seed=f"f-{i}").home_box.possessions for i in range(6))
        self.assertGreater(fast_poss, slow_poss)


class TestChemistry(unittest.TestCase):
    def test_chemistry_profile_responds_to_pair_ratings(self):
        team = make_teams(1)[0]
        lineup = Lineup(team.starters())

        neutral = evaluate_chemistry(team, lineup)
        ids = lineup.ids()
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                team.pair_chemistry[frozenset((ids[i], ids[j]))] = 95.0
        team.team_chemistry = 95.0
        strong = evaluate_chemistry(team, lineup)

        self.assertGreater(strong.relational, neutral.relational)
        self.assertGreater(strong.execution, neutral.execution)


class TestLeagueFlow(unittest.TestCase):
    def setUp(self):
        self.league = League(name="Test League", season="2026-27")
        for team in make_teams(4):
            self.league.add_team(team)
        self.league.set_schedule(
            build_round_robin(
                list(self.league.teams),
                start_date=(datetime.now(timezone.utc) + timedelta(days=1)).date(),
                times_played=1,
                days_between_rounds=1,
            )
        )

    def test_nothing_is_played_before_tipoff(self):
        self.league.tick()
        self.assertTrue(all(g.status == GameStatus.SCHEDULED for g in self.league.schedule))

    def test_games_go_live_then_final_as_the_clock_advances(self):
        self.league.clock.advance(timedelta(days=10))
        self.league.tick()
        self.assertTrue(all(g.status == GameStatus.FINAL for g in self.league.schedule))
        total_games = sum(row.games_played for row in self.league.standings.values())
        self.assertEqual(total_games, 2 * len(self.league.schedule))

    def test_feed_reveals_events_progressively(self):
        game = self.league.schedule[0]
        self.league.tracker_speed = 1.0
        self.league.clock.jump_to(game.tipoff_at + timedelta(seconds=30))
        self.league.tick()

        self.assertEqual(game.status, GameStatus.LIVE)
        early = self.league.feed(game)
        self.assertGreater(len(early["events"]), 0)
        self.assertFalse(early["complete"])
        self.assertTrue(all(e["game_seconds"] <= 31 for e in early["events"]))

        # A `since` cursor must not repeat events already delivered.
        cursor = early["last_sequence"]
        self.league.clock.advance(timedelta(seconds=120))
        later = self.league.feed(game, since_sequence=cursor)
        self.assertTrue(all(e["sequence"] > cursor for e in later["events"]))
        self.assertGreater(len(later["events"]), 0)

    def test_standings_only_count_finished_games(self):
        game = self.league.schedule[0]
        self.league.tracker_speed = 1.0
        self.league.clock.jump_to(game.tipoff_at + timedelta(seconds=10))
        self.league.tick()
        self.assertEqual(sum(r.games_played for r in self.league.standings.values()), 0)


if __name__ == "__main__":
    unittest.main()


class TestSeasonStats(unittest.TestCase):
    """Season aggregation: totals in, per-game rates out."""

    @classmethod
    def setUpClass(cls):
        cls.league = League(name="Stats League", season="2026-27")
        for team in make_teams(6):
            cls.league.add_team(team)
        cls.league.set_schedule(
            build_round_robin(
                list(cls.league.teams),
                start_date=(datetime.now(timezone.utc) + timedelta(days=1)).date(),
                times_played=1,
                days_between_rounds=1,
            )
        )
        cls.league.clock.advance(timedelta(days=60))
        cls.league.tick()

    def test_team_games_played_matches_the_schedule(self):
        played = len([g for g in self.league.schedule if g.status == GameStatus.FINAL])
        total = sum(line.games for line in self.league.stats.teams.values())
        self.assertEqual(total, played * 2)

    def test_team_wins_and_losses_agree_with_the_standings(self):
        for team_id, line in self.league.stats.teams.items():
            row = self.league.standings[team_id]
            self.assertEqual(line.wins, row.wins, team_id)
            self.assertEqual(line.losses, row.losses, team_id)
            self.assertEqual(line.games, row.games_played, team_id)

    def test_team_points_agree_with_the_standings(self):
        for team_id, line in self.league.stats.teams.items():
            self.assertEqual(line.points, self.league.standings[team_id].points_for)
            self.assertEqual(
                line.points_against, self.league.standings[team_id].points_against
            )

    def test_player_totals_sum_to_their_team_totals(self):
        for team_id, team_line in self.league.stats.teams.items():
            roster = [
                line for line in self.league.stats.players.values()
                if line.team_id == team_id
            ]
            self.assertEqual(sum(l.points for l in roster), team_line.points, team_id)
            self.assertEqual(sum(l.assists for l in roster), team_line.assists, team_id)
            self.assertEqual(sum(l.fga for l in roster), team_line.fga, team_id)

    def test_a_did_not_play_is_not_a_game_played(self):
        for line in self.league.stats.players.values():
            if line.games:
                self.assertGreater(line.seconds, 0, line.name)

    def test_per_game_rates_are_totals_over_games(self):
        line = max(self.league.stats.players.values(), key=lambda l: l.points)
        self.assertAlmostEqual(line.per_game("points"), line.points / line.games)
        row = line.to_dict()
        self.assertAlmostEqual(row["points"], round(line.points / line.games, 3))

    def test_percentages_are_rates_not_per_game_averages(self):
        line = max(self.league.stats.players.values(), key=lambda l: l.fga)
        self.assertAlmostEqual(line.fg_pct, line.fgm / line.fga)
        self.assertLessEqual(line.fg_pct, 1.0)
        self.assertGreaterEqual(line.fg_pct, 0.0)

    def test_percentages_survive_zero_attempts(self):
        blank = PlayerSeasonLine(player_id="x")
        self.assertEqual(blank.fg_pct, 0.0)
        self.assertEqual(blank.tp_pct, 0.0)
        self.assertEqual(blank.per_game("points"), 0.0)

    def test_minimum_games_filter(self):
        everyone = self.league.stats.player_table(minimum_games=1)
        regulars = self.league.stats.player_table(minimum_games=4)
        self.assertLessEqual(len(regulars), len(everyone))
        self.assertTrue(all(row["games"] >= 4 for row in regulars))

    def test_every_stat_column_is_present_on_both_tables(self):
        player_row = self.league.stats.player_table()[0]
        team_row = self.league.stats.team_table()[0]
        for key, _label, _per_game in STAT_COLUMNS:
            self.assertIn(key, player_row, key)
            if key != "minutes":  # a team always plays 240 minutes
                self.assertIn(key, team_row, key)

    def test_players_carry_a_position_and_a_team(self):
        for row in self.league.stats.player_table():
            self.assertIn(row["position"], {"PG", "SG", "SF", "PF", "C"})
            self.assertIn(row["team_id"], self.league.teams)
