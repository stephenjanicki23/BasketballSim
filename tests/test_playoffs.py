"""Conferences and the postseason.

The bracket keeps no state of its own -- every series is rebuilt from the
fixtures on the schedule, the same way the standings are rebuilt from results.
So most of what is below is really one question asked several ways: does the
schedule still say what happened?

The rest is the structure: fifteen clubs a side, eight seeds, 1v8 through 4v5,
2-2-1-1-1 home court, four rounds down to one champion, and a bracket that does
not move under its own feet once it has started.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.conferences import (
    CHAMPION_TITLE, CONFERENCES, CONFERENCE_OF, FALLBACK_CONFERENCE,
    FINALS_NAME, IRONRIDGE, TIDEWATER, TROPHY_NAME, conference_for, split,
)
from bballsim.league import playoffs
from bballsim.league.calendar import GameStatus, build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_CACHE: dict[str, League] = {}


def finished_league(games_per_team: int = 12) -> League:
    """A league played to a champion. Cached -- it is not cheap."""
    key = f"L{games_per_team}"
    if key in _CACHE:
        return _CACHE[key]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=3))
    league.tick()
    for _ in range(90):
        league.clock.advance(timedelta(days=2))
        league.tick()
        if playoffs.champion(league):
            break
    _CACHE[key] = league
    return league


class TestConferences(unittest.TestCase):
    def test_thirty_clubs_split_fifteen_and_fifteen(self):
        teams = load_teams().teams
        counts = Counter(conference_for(t.abbreviation) for t in teams)
        self.assertEqual(counts[IRONRIDGE], 15)
        self.assertEqual(counts[TIDEWATER], 15)

    def test_every_club_in_the_table_is_in_the_league(self):
        known = {t.abbreviation for t in load_teams().teams}
        for abbreviation in CONFERENCE_OF:
            self.assertIn(abbreviation, known, abbreviation)

    def test_an_unknown_club_still_lands_somewhere(self):
        """An expansion side must not vanish out of the standings."""
        self.assertEqual(conference_for("ZZZ"), FALLBACK_CONFERENCE)
        self.assertIn(FALLBACK_CONFERENCE, CONFERENCES)

    def test_the_conference_is_stamped_onto_the_roster(self):
        """`Team.conference` stays the field everything reads, and it has to
        hold this file's answer rather than whatever a stale save carried --
        the shipped roster had a 17/13 coin flip in it."""
        for team in load_teams().teams:
            self.assertEqual(team.conference, conference_for(team.abbreviation))

    def test_split_groups_every_team(self):
        teams = load_teams().teams
        grouped = split(teams)
        self.assertEqual(sum(len(v) for v in grouped.values()), len(teams))

    def test_the_championship_has_a_name(self):
        self.assertEqual(FINALS_NAME, "Keystone Finals")
        self.assertTrue(TROPHY_NAME and CHAMPION_TITLE)


class TestSeeding(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = finished_league()

    def test_eight_seeds_a_conference(self):
        for conference in CONFERENCES:
            seeds = playoffs.seed_conference(self.league, conference)
            self.assertEqual(len(seeds), playoffs.SEEDS)
            self.assertEqual(len(set(seeds)), playoffs.SEEDS)

    def test_seeds_come_from_the_right_conference(self):
        for conference in CONFERENCES:
            for team_id in playoffs.seed_conference(self.league, conference):
                team = self.league.teams[team_id]
                self.assertEqual(conference_for(team.abbreviation), conference)

    def test_seeds_are_in_record_order(self):
        for conference in CONFERENCES:
            seeds = playoffs.seed_conference(self.league, conference)
            keys = [
                (self.league.standings[t].wins,
                 self.league.standings[t].point_differential)
                for t in seeds
            ]
            self.assertEqual(keys, sorted(keys, reverse=True))

    def test_seeding_does_not_move_once_the_playoffs_start(self):
        """The bug this exists to catch: playoff results were being folded
        into the standings, so a club that won two rounds climbed the table,
        its seed changed, and a series it had already played was relabelled.
        An 82-game season was producing records like 56-53."""
        for team_id, row in self.league.standings.items():
            self.assertEqual(row.games_played, 12, self.league.teams[team_id].name)

    def test_playoff_games_are_not_in_the_season_stats(self):
        played = sum(1 for g in self.league.schedule
                     if not playoffs.is_playoff(g) and g.status == GameStatus.FINAL)
        counted = sum(row.games for row in self.league.stats.teams.values())
        self.assertEqual(counted, played * 2)


class TestTheBracket(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = finished_league()

    def test_the_first_round_is_one_v_eight_through_four_v_five(self):
        first = playoffs.series_in(self.league, playoffs.FIRST_ROUND)
        self.assertEqual(len(first), 8, "two conferences of four series")
        for conference in CONFERENCES:
            pairs = sorted(
                (s.high_rank, s.low_rank)
                for s in first if s.conference == conference
            )
            self.assertEqual(pairs, [(1, 8), (2, 7), (3, 6), (4, 5)])

    def test_all_four_rounds_are_played(self):
        for label in playoffs.ROUNDS:
            self.assertTrue(playoffs.series_in(self.league, label), label)

    def test_each_round_halves_the_field(self):
        counts = [len(playoffs.series_in(self.league, r)) for r in playoffs.ROUNDS]
        self.assertEqual(counts, [8, 4, 2, 1])

    def test_a_series_is_won_with_four(self):
        for label in playoffs.ROUNDS:
            for s in playoffs.series_in(self.league, label):
                self.assertTrue(s.complete, f"{label} unfinished")
                self.assertEqual(max(s.high_wins, s.low_wins), playoffs.WINS_NEEDED)
                self.assertLess(min(s.high_wins, s.low_wins), playoffs.WINS_NEEDED)
                self.assertLessEqual(s.played, playoffs.MAX_GAMES)
                self.assertGreaterEqual(s.played, playoffs.WINS_NEEDED)

    def test_no_game_is_played_after_a_series_is_decided(self):
        """Fixtures are created as they are earned, so a sweep must not leave
        three dead games on the calendar."""
        for label in playoffs.ROUNDS:
            for s in playoffs.series_in(self.league, label):
                self.assertEqual(s.played, len(s.games), f"{label} has extra games")
                self.assertEqual(s.played, s.high_wins + s.low_wins)

    def test_home_court_follows_two_two_one_one_one(self):
        for label in playoffs.ROUNDS:
            for s in playoffs.series_in(self.league, label):
                for index, game in enumerate(s.games):
                    expected = s.high_seed if playoffs.HOME_PATTERN[index] else s.low_seed
                    self.assertEqual(
                        game.home_team_id, expected,
                        f"{label} game {index + 1} has the wrong host")

    def test_the_semifinal_bracket_is_fixed_not_reseeded(self):
        """The 1/8 winner takes the 4/5 winner whatever the upsets."""
        first = {s.conference: {} for s in playoffs.series_in(self.league, playoffs.FIRST_ROUND)}
        for s in playoffs.series_in(self.league, playoffs.FIRST_ROUND):
            first[s.conference][s.high_rank] = s.winner
        for s in playoffs.series_in(self.league, playoffs.CONFERENCE_SEMIS):
            got = {s.high_seed, s.low_seed}
            branches = first[s.conference]
            options = [
                {branches[1], branches[4]},
                {branches[2], branches[3]},
            ]
            self.assertIn(got, options, "the bracket was re-seeded")

    def test_the_finals_are_one_club_from_each_conference(self):
        finals = playoffs.series_in(self.league, playoffs.KEYSTONE_FINALS)
        self.assertEqual(len(finals), 1)
        series = finals[0]
        sides = {
            conference_for(self.league.teams[t].abbreviation)
            for t in (series.high_seed, series.low_seed)
        }
        self.assertEqual(sides, set(CONFERENCES))

    def test_there_is_exactly_one_champion(self):
        won = playoffs.champion(self.league)
        self.assertIsNotNone(won)
        finals = playoffs.series_in(self.league, playoffs.KEYSTONE_FINALS)[0]
        self.assertIn(won, (finals.high_seed, finals.low_seed))

    def test_a_beaten_club_never_plays_again(self):
        eliminated: set[str] = set()
        for label in playoffs.ROUNDS:
            for s in playoffs.series_in(self.league, label):
                self.assertNotIn(s.high_seed, eliminated, label)
                self.assertNotIn(s.low_seed, eliminated, label)
            for s in playoffs.series_in(self.league, label):
                eliminated.add(s.loser)

    def test_the_postseason_is_at_most_sixty_five_wins_worth_of_games(self):
        played = sum(1 for g in self.league.schedule if playoffs.is_playoff(g))
        self.assertGreaterEqual(played, 15 * playoffs.WINS_NEEDED)
        self.assertLessEqual(played, 15 * playoffs.MAX_GAMES)


class TestItAllSurvivesASaveAndReload(unittest.TestCase):
    """The bracket is derived, so this is really asking whether the fixtures
    round-trip -- but that is the whole claim, so it is worth asserting."""

    def test_the_bracket_reads_the_same_after_a_round_trip(self):
        from bballsim.save import apply_season, dump_season, load_season

        league = finished_league()
        before = playoffs.bracket(league)

        data = dump_season(league.schedule, name=league.name, season=league.season)
        restored = load_season(data)
        rebuilt = League(name=league.name, season=league.season)
        for team in load_teams().teams:
            rebuilt.add_team(team)
        apply_season(rebuilt, restored)

        self.assertEqual(playoffs.bracket(rebuilt), before)
        self.assertEqual(playoffs.champion(rebuilt), playoffs.champion(league))

    def test_the_save_format_did_not_have_to_change(self):
        """Playoff games are ScheduledGames. That is the entire mechanism."""
        league = finished_league()
        postseason = [g for g in league.schedule if playoffs.is_playoff(g)]
        self.assertTrue(postseason)
        for game in postseason:
            self.assertIn(game.round_label, playoffs.PLAYOFF_ROUNDS)


class TestAdvanceIsSafeToCallRepeatedly(unittest.TestCase):
    def test_advancing_twice_adds_nothing_the_second_time(self):
        league = finished_league()
        self.assertEqual(playoffs.advance(league), [])
        self.assertEqual(playoffs.advance(league), [])

    def test_nothing_happens_before_the_regular_season_ends(self):
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            [t.id for t in saved.teams], start_date=date(2026, 10, 20),
            games_per_team=4))
        self.assertFalse(playoffs.regular_season_complete(league))
        self.assertEqual(playoffs.advance(league), [])
        self.assertEqual(playoffs.bracket(league)["rounds"], [])


if __name__ == "__main__":
    unittest.main()
