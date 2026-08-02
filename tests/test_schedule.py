"""The season calendar: 82 games each, three a day, on real days at real times.

Every number the schedule is supposed to hit is asserted here rather than
eyeballed, because a fixture list is the one thing you cannot fix later without
invalidating everything played against it.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.league.calendar import (
    DAILY_TIPOFFS,
    PACIFIC,
    GameStatus,
    _pack_days,
    build_daily_schedule,
)
from bballsim.roster import load_teams
from bballsim.save import SEASON_PATH, read_season, season_exists

GAMES_PER_TEAM = 82
START = date(2026, 8, 3)


def team_ids(count: int = 30) -> list[str]:
    return [t.id for t in load_teams(count).teams]


class TestPackingDaysIntoSlates(unittest.TestCase):
    def test_82_games_is_26_threes_and_two_twos(self):
        """82 does not divide by three. The remainder becomes two days of two
        rather than a day with a single game."""
        self.assertEqual(_pack_days(82, 3), [3] * 26 + [2, 2])
        self.assertEqual(sum(_pack_days(82, 3)), 82)

    def test_an_exact_multiple_needs_no_remainder_day(self):
        self.assertEqual(_pack_days(81, 3), [3] * 27)

    def test_a_remainder_of_two_is_left_as_one_short_day(self):
        self.assertEqual(_pack_days(80, 3), [3] * 26 + [2])
        self.assertEqual(sum(_pack_days(80, 3)), 80)

    def test_no_day_is_ever_left_with_a_single_game(self):
        for rounds in range(2, 200):
            days = _pack_days(rounds, 3)
            self.assertEqual(sum(days), rounds, rounds)
            self.assertNotIn(1, days, f"{rounds} rounds left a one-game day")


class TestTheSeasonSchedule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ids = team_ids()
        cls.games = build_daily_schedule(
            cls.ids, START, games_per_team=GAMES_PER_TEAM, season="2026-27"
        )
        cls.by_day = defaultdict(Counter)
        for game in cls.games:
            day = game.tipoff_at.astimezone(PACIFIC).date()
            cls.by_day[day][game.home_team_id] += 1
            cls.by_day[day][game.away_team_id] += 1

    def test_every_team_plays_exactly_82(self):
        played = Counter()
        for game in self.games:
            played[game.home_team_id] += 1
            played[game.away_team_id] += 1
        self.assertEqual(len(played), 30)
        self.assertEqual(set(played.values()), {GAMES_PER_TEAM})

    def test_the_league_plays_1230_games(self):
        # 30 teams x 82, each game counted by two of them.
        self.assertEqual(len(self.games), 30 * GAMES_PER_TEAM // 2)

    def test_home_and_away_split_evenly(self):
        home = Counter(g.home_team_id for g in self.games)
        self.assertEqual(set(home.values()), {41},
                         "home games are not an even 41 apiece")

    def test_every_team_plays_three_games_a_day(self):
        sizes = Counter(tuple(sorted(set(c.values()))) for c in self.by_day.values())
        self.assertEqual(sizes, Counter({(3,): 26, (2,): 2}),
                         "some day is not three games for everybody")

    def test_the_season_runs_28_days(self):
        days = sorted(self.by_day)
        self.assertEqual(len(days), 28)
        self.assertEqual(days[0], START)
        # Consecutive real days, no gaps.
        self.assertEqual(days[-1], START + timedelta(days=27))
        for earlier, later in zip(days, days[1:]):
            self.assertEqual(later - earlier, timedelta(days=1))

    def test_tip_offs_are_8am_1pm_and_7pm_pacific(self):
        wanted = {t.strftime("%H:%M") for t in DAILY_TIPOFFS}
        seen = Counter(
            g.tipoff_at.astimezone(PACIFIC).strftime("%H:%M") for g in self.games
        )
        self.assertEqual(set(seen), wanted)
        # 26 full days at 45 games, plus the two short days on the first slots.
        self.assertEqual(seen["08:00"], 420)
        self.assertEqual(seen["13:00"], 420)
        self.assertEqual(seen["19:00"], 390)

    def test_a_team_is_never_double_booked_in_one_slot(self):
        per_slot = defaultdict(Counter)
        for game in self.games:
            per_slot[game.tipoff_at][game.home_team_id] += 1
            per_slot[game.tipoff_at][game.away_team_id] += 1
        self.assertEqual(
            max(max(c.values()) for c in per_slot.values()), 1
        )

    def test_every_slot_is_a_full_fifteen_game_slate(self):
        per_slot = Counter(g.tipoff_at for g in self.games)
        self.assertEqual(set(per_slot.values()), {15})

    def test_nobody_plays_themselves(self):
        for game in self.games:
            self.assertNotEqual(game.home_team_id, game.away_team_id)

    def test_fixture_ids_are_unique_and_stable(self):
        self.assertEqual(len({g.id for g in self.games}), len(self.games))
        again = build_daily_schedule(
            self.ids, START, games_per_team=GAMES_PER_TEAM, season="2026-27"
        )
        self.assertEqual([g.id for g in again], [g.id for g in self.games])

    def test_fixtures_are_in_chronological_order(self):
        tipoffs = [g.tipoff_at for g in self.games]
        self.assertEqual(tipoffs, sorted(tipoffs))

    def test_teams_meet_two_or_three_times(self):
        meetings = Counter(
            frozenset((g.home_team_id, g.away_team_id)) for g in self.games
        )
        self.assertTrue(set(meetings.values()) <= {2, 3}, set(meetings.values()))
        # Every pairing happens at least twice: nobody is skipped.
        self.assertEqual(len(meetings), 30 * 29 // 2)


class TestDaylightSaving(unittest.TestCase):
    """Pacific is UTC-7 for half the year and UTC-8 for the other half. Tip-offs
    are stored as UTC, so a season crossing the change has to shift with it or
    every game after November drifts by an hour."""

    def test_8am_pacific_stays_8am_across_the_clock_change(self):
        # The US falls back on 2026-11-01, so a 10-day season from 25 October
        # sits on both sides of it (30 games each = 10 days of three).
        games = build_daily_schedule(
            team_ids(), date(2026, 10, 25), games_per_team=30, season="dst"
        )
        local = {g.tipoff_at.astimezone(PACIFIC).strftime("%H:%M") for g in games}
        self.assertEqual(local, {"08:00", "13:00", "19:00"})

        offsets = {g.tipoff_at.astimezone(PACIFIC).utcoffset() for g in games}
        self.assertEqual(len(offsets), 2, "this window should straddle the change")


class TestTheCommittedSeasonIsUnplayed(unittest.TestCase):
    """The saved season ships with nothing simulated: no results, no standings,
    no stats."""

    @classmethod
    def setUpClass(cls):
        if not season_exists(SEASON_PATH):
            raise unittest.SkipTest(f"no season at {SEASON_PATH}")
        cls.saved = read_season(SEASON_PATH)

    def test_no_game_has_been_played(self):
        for game in self.saved.games:
            self.assertEqual(game.status, GameStatus.SCHEDULED, game.id)
            self.assertIsNone(game.result, game.id)

    def test_it_is_a_full_82_game_season(self):
        self.assertEqual(len(self.saved.games), 1230)
        played = Counter()
        for game in self.saved.games:
            played[game.home_team_id] += 1
            played[game.away_team_id] += 1
        self.assertEqual(set(played.values()), {82})

    def test_the_sim_clock_tracks_real_time(self):
        """No offset: a game tips off when its real 8am/1pm/7pm slot arrives."""
        self.assertEqual(self.saved.clock_offset_seconds, 0.0)

    def test_three_slates_a_day_at_the_right_times(self):
        seen = Counter(
            g.tipoff_at.astimezone(PACIFIC).strftime("%H:%M") for g in self.saved.games
        )
        self.assertEqual(set(seen), {"08:00", "13:00", "19:00"})


if __name__ == "__main__":
    unittest.main()
