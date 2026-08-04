"""Power rankings.

The claim the whole feature rests on is that this is *not* the standings: a
club playing well now should outrank a club with a better record that has
stopped playing well. `TestItIsNotJustTheStandings` is the test that holds
that line, and it does it by finding a real pair in a simulated season rather
than by asserting the formula against itself.

Everything else is the discipline: rankings are derived by replay, so the same
league on the same day must produce the same table, yesterday's table must be
reproducible today, and movement must be the difference between the two.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.payload import bootstrap
from bballsim.league import power
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.news import POWER_RANKINGS, write_stories
from bballsim.roster import load_teams

_CACHE: dict[int, League] = {}


def played(games_per_team: int = 20) -> League:
    if games_per_team in _CACHE:
        return _CACHE[games_per_team]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=2))
    league.tick()
    _CACHE[games_per_team] = league
    return league


class TestTheFormula(unittest.TestCase):
    def test_the_weights_are_the_brief_and_sum_to_one(self):
        self.assertAlmostEqual(sum(power.WEIGHTS.values()), 1.0, places=6)
        self.assertEqual(power.WEIGHTS["form"], 0.25)
        self.assertEqual(power.WEIGHTS["record"], 0.20)
        self.assertEqual(len(power.WEIGHTS), 10)

    def test_every_component_has_a_label(self):
        self.assertEqual(set(power.WEIGHTS), set(power.COMPONENT_LABELS))

    def test_recent_games_count_for_more_than_old_ones(self):
        self.assertEqual(power.decay(1), 1.0)
        self.assertAlmostEqual(power.decay(2), 0.95, places=6)
        self.assertAlmostEqual(power.decay(3), 0.90, places=6)
        self.assertGreater(power.decay(5), power.decay(15))
        self.assertGreater(power.decay(15), 0.0)

    def test_nothing_ever_decays_to_nothing(self):
        """A game from November still happened."""
        self.assertGreaterEqual(power.decay(365), power.DECAY_FLOOR)

    def test_ratings_stay_on_the_hundred_point_scale(self):
        rows = power.rate(played(), max(power.ranking_days(played())))
        for row in rows:
            self.assertGreaterEqual(row["rating"], 0.0)
            self.assertLessEqual(row["rating"], 100.0)
            for key, value in row["components"].items():
                self.assertGreaterEqual(value, 0.0, key)
                self.assertLessEqual(value, 100.0, key)


class TestTheTable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.day = max(power.ranking_days(cls.league))
        cls.rows = power.rate(cls.league, cls.day)

    def test_every_club_that_has_played_is_ranked(self):
        self.assertEqual(len(self.rows), 30)
        self.assertEqual([r["rank"] for r in self.rows], list(range(1, 31)))

    def test_it_is_sorted_by_rating(self):
        ratings = [r["rating"] for r in self.rows]
        self.assertEqual(ratings, sorted(ratings, reverse=True))

    def test_every_tier_is_used(self):
        """Six tiers that collapse into two tell a reader nothing, which is
        what round-number floors produced before they were set from the
        distribution the formula actually makes."""
        found = {r["tier"] for r in self.rows}
        self.assertEqual(len(found), len(power.TIERS), sorted(found))

    def test_a_row_carries_what_the_page_shows(self):
        for row in self.rows:
            for key in ("teamId", "rank", "rating", "tier", "wins", "losses",
                        "lastTen", "streak", "netRating", "offensiveRating",
                        "defensiveRating", "homeRecord", "awayRecord",
                        "bestWinStreak", "worstLossStreak", "components"):
                self.assertIn(key, row)

    def test_the_record_matches_the_standings(self):
        """The rankings reorder the league; they do not reinvent its results."""
        for row in self.rows:
            standing = self.league.standings[row["teamId"]]
            self.assertEqual(row["wins"], standing.wins)
            self.assertEqual(row["losses"], standing.losses)

    def test_home_and_away_records_add_up(self):
        for row in self.rows:
            home = [int(x) for x in row["homeRecord"].split("-")]
            away = [int(x) for x in row["awayRecord"].split("-")]
            self.assertEqual(home[0] + away[0], row["wins"], row["teamId"])
            self.assertEqual(home[1] + away[1], row["losses"], row["teamId"])

    def test_last_ten_never_counts_more_than_ten(self):
        for row in self.rows:
            won, lost = (int(x) for x in row["lastTen"].split("-"))
            self.assertLessEqual(won + lost, power.FORM_WINDOW)


class TestItIsNotJustTheStandings(unittest.TestCase):
    """The point of the feature, stated as a test."""

    def test_form_can_outrank_a_better_record(self):
        league = played(30)
        rows = power.rate(league, max(power.ranking_days(league)))
        by_rank = {r["teamId"]: r for r in rows}

        found = None
        for above in rows:
            for below in rows:
                if above["rank"] >= below["rank"]:
                    continue
                if above["wins"] >= below["wins"]:
                    continue
                # A club ranked higher on fewer wins. Its recent form should be
                # what put it there.
                above_form = int(above["lastTen"].split("-")[0])
                below_form = int(below["lastTen"].split("-")[0])
                if above_form > below_form:
                    found = (above, below)
                    break
            if found:
                break

        self.assertIsNotNone(
            found,
            "no club outranked a better record on form -- the table is behaving "
            "like the standings")
        above, below = found
        self.assertGreater(above["components"]["form"], below["components"]["form"])

    def test_a_losing_streak_costs_a_club(self):
        league = played(30)
        rows = power.rate(league, max(power.ranking_days(league)))
        cold = [r for r in rows if r["streakValue"] <= -3]
        hot = [r for r in rows if r["streakValue"] >= 3]
        if not cold or not hot:
            self.skipTest("no clubs on a run either way in this season")
        self.assertGreater(
            sum(r["components"]["momentum"] for r in hot) / len(hot),
            sum(r["components"]["momentum"] for r in cold) / len(cold))


class TestHistoryAndMovement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.history = power.rank_history(cls.league)

    def test_there_is_a_ranking_for_every_day_that_had_games(self):
        self.assertEqual(len(self.history["days"]), len(power.ranking_days(self.league)))
        self.assertTrue(self.history["days"])

    def test_yesterday_is_reproducible_today(self):
        """History is derived, so asking for an old day must give the old
        answer -- that is the whole reason nothing is stored."""
        days = power.ranking_days(self.league)
        first = power.rate(self.league, days[1])
        again = power.rate(self.league, days[1])
        self.assertEqual(first, again)
        self.assertNotEqual(
            [r["teamId"] for r in first],
            [r["teamId"] for r in power.rate(self.league, days[-1])],
            "the table never changed all season")

    def test_movement_is_the_difference_between_two_days(self):
        days = power.ranking_days(self.league)
        yesterday = {r["teamId"]: r["rank"] for r in power.rate(self.league, days[-2])}
        for row in self.history["current"]:
            if row["previousRank"] is None:
                continue
            self.assertEqual(row["previousRank"], yesterday[row["teamId"]])
            self.assertEqual(row["movement"], row["previousRank"] - row["rank"])

    def test_season_extremes_bracket_the_current_rank(self):
        for row in self.history["current"]:
            self.assertLessEqual(row["bestRank"], row["worstRank"])
            self.assertGreaterEqual(row["averageRank"], row["bestRank"])
            self.assertLessEqual(row["averageRank"], row["worstRank"])

    def test_days_at_number_one_add_up_to_the_season(self):
        total = sum(self.history["daysAtOne"].values())
        self.assertEqual(total, len(self.history["days"]))

    def test_a_club_is_ranked_on_every_day_it_had_played(self):
        ranks = self.history["seasonRanks"]
        self.assertEqual(len(ranks), 30)
        for team_id, marks in ranks.items():
            self.assertTrue(all(1 <= r <= 30 for r in marks), team_id)


class TestDeterminism(unittest.TestCase):
    def test_the_same_league_produces_the_same_table(self):
        league = played()
        day = max(power.ranking_days(league))
        self.assertEqual(power.rate(league, day), power.rate(league, day))

    def test_a_reloaded_season_ranks_identically(self):
        from bballsim.save import apply_season, dump_season, load_season

        league = played()
        day = max(power.ranking_days(league))
        before = power.rate(league, day)

        rebuilt = League(name=league.name, season=league.season)
        for team in load_teams().teams:
            rebuilt.add_team(team)
        apply_season(rebuilt, load_season(dump_season(
            league.schedule, name=league.name, season=league.season)))
        self.assertEqual(power.rate(rebuilt, day), before)


class TestNothingToRank(unittest.TestCase):
    def test_an_unplayed_season_ranks_nobody(self):
        league = League(name="T", season="2026-27")
        for team in load_teams().teams[:6]:
            league.add_team(team)
        self.assertEqual(power.ranking_days(league), [])
        self.assertEqual(power.rate(league, date(2026, 10, 20)), [])
        empty = power.rank_history(league)
        self.assertEqual(empty["current"], [])

    def test_the_bootstrap_carries_the_rankings(self):
        payload = bootstrap(played())
        self.assertEqual(len(payload["power"]["current"]), 30)
        self.assertEqual(len(payload["power"]["weights"]), 10)
        self.assertTrue(payload["power"]["componentLabels"])
        self.assertEqual(len(payload["power"]["tiers"]), len(power.TIERS))


class TestNewsIntegration(unittest.TestCase):
    def test_a_power_ranking_story_is_written_and_is_well_formed(self):
        stories = [s for s in write_stories(played(8), limit=14)
                   if s.category == POWER_RANKINGS]
        self.assertTrue(stories, "the rankings never made the wire")
        for story in stories:
            self.assertGreaterEqual(len(story.headline.split()), 5)
            self.assertLessEqual(len(story.headline.split()), 12)
            words = len(story.article.split())
            self.assertGreaterEqual(words, 150, story.headline)
            self.assertLessEqual(words, 300, story.headline)
            self.assertEqual(len(story.article.split("\n\n")), 3)

    def test_no_story_is_printed_twice(self):
        """`take` guarded on category, game and player but not on the story
        itself, so the reserved-slot pass could re-take one the ranked pass had
        already used. Categories capped at one hid it."""
        for games in (8, 20):
            ids = [s.id for s in write_stories(played(games), limit=14)]
            self.assertEqual(len(ids), len(set(ids)), f"{games} games")

    def test_a_climb_story_belongs_to_a_club_that_is_winning(self):
        for games in (8, 20):
            for story in write_stories(played(games), limit=14):
                if story.category != POWER_RANKINGS or "climb" not in story.subheadline:
                    continue
                won, lost = (int(x) for x in
                             story.subheadline.split("after a ")[1].split(" ")[0].split("-"))
                self.assertGreater(won, lost, story.subheadline)


if __name__ == "__main__":
    unittest.main()
