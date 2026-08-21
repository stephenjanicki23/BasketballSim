"""The All-Star Game: a vote, a side that can play, and a game that leaks nothing.

Three claims, and each of them is the kind that fails silently.

  * `TestTheExhibitionIsSealedOff` -- the game is deliberately not a
    `ScheduledGame`, which is the entire mechanism keeping it out of the
    standings, the season totals, the record book, chemistry and health. If
    somebody ever put it on the calendar for convenience, every one of those
    would quietly start counting an exhibition and nothing would look broken
    until a scoring title came down to it.
  * `TestTheSideCanPlay` -- the vote on its own named an Ironridge twelve with
    no point guard on it and a Tidewater starting five of three power forwards.
    Both are shapes `lineup.LineupRules` forbids. Nothing would have thrown;
    the sim would just have fielded the least illegal five it could find.
  * `TestConditionIsRestored` -- the twelve are the real `Player` objects, so
    the engine drains the real condition. Without the restore, twenty-four men
    walk into their next league game tired from a game that never happened.

Run with:  python3 -m unittest tests.test_allstar -v
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import allstar, accolades, records, save
from bballsim.api import payload
from bballsim.conferences import CONFERENCES
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.lineup import DEFAULT_RULES, POSITIONS
from bballsim.roster import load_teams

_CACHE: dict[int, League] = {}
_AFTER: list[League] = []


def fresh(games_per_team: int = 20) -> League:
    """A league of its own that has played a stretch of a season.

    Built on its own calendar rather than the committed one, and with the clock
    driven to a fixture rather than left at "now": a shared league that
    simulates up to the real wall clock gives a different vote every day it is
    run, which `test_mvp` learned the hard way.
    """
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
    league.tick()
    return league


def played(games_per_team: int = 20) -> League:
    """A cached league with **voting still open**. Never play the exhibition on
    one of these.

    Learned by getting it wrong: this file first shared one cached league for
    everything, and `TestConditionIsRestored` played the game on it. Two later
    tests then failed -- a projected starter already carrying the badge, and a
    "voting is open" view that came back played -- and both looked like bugs in
    the code rather than in the fixture. A cache handed to a test that mutates
    it is not a fixture, it is a hidden dependency on test order.
    """
    if games_per_team not in _CACHE:
        _CACHE[games_per_team] = fresh(games_per_team)
    return _CACHE[games_per_team]


def after_the_game() -> League:
    """A cached league whose All-Star Game has been played. Its own, so playing
    it cannot reach the leagues above."""
    if not _AFTER:
        league = fresh()
        allstar.play(league)
        _AFTER.append(league)
    return _AFTER[0]


def snapshot(league) -> dict:
    """Everything the exhibition must not touch, as comparable text."""
    return {
        "standings": json.dumps(league.standings_table(), sort_keys=True, default=str),
        "player_stats": json.dumps(
            {l.player_id: (l.games, l.points, l.seconds)
             for l in league.stats.players.values()}, sort_keys=True),
        "team_stats": json.dumps(
            {l.team_id: (l.games, l.wins, l.points)
             for l in league.stats.teams.values()}, sort_keys=True),
        "records": json.dumps(records.book(league), sort_keys=True, default=str),
        "fixtures": len(league.schedule),
        "chemistry": json.dumps(
            {t.id: (t.team_chemistry, len(t.pair_chemistry))
             for t in league.teams.values()}, sort_keys=True),
        "health": json.dumps(
            {p.id: (p.injured, p.resting)
             for t in league.teams.values() for p in t.players}, sort_keys=True),
    }


class TestWhenItIs(unittest.TestCase):
    def test_it_is_always_a_wednesday(self):
        for day in range(1, 29):
            moment = datetime(2026, 11, day, 14, 30, tzinfo=timezone.utc)
            self.assertEqual(allstar.next_wednesday(moment).weekday(),
                             allstar.GAME_WEEKDAY)

    def test_a_wednesday_gets_next_week_not_this_afternoon(self):
        """Otherwise a league booted on a Wednesday morning schedules a game
        four hours out and nobody gets to vote in it."""
        wednesday = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(allstar.next_wednesday(wednesday).date(),
                         date(2026, 11, 11))

    def test_the_date_is_set_once_and_left_alone(self):
        """A date recomputed on every read slides a week forward every
        Wednesday, and the game never arrives."""
        league = played()
        first = allstar.state(league).tipoff_at
        league.clock.jump_to(league.clock.now() + timedelta(days=21))
        self.assertEqual(allstar.state(league).tipoff_at, first)


class TestTheVoteMoves(unittest.TestCase):
    def test_every_conference_has_a_board(self):
        counts = allstar.tally(played())
        self.assertEqual(set(counts), set(CONFERENCES))
        for conference, votes in counts.items():
            self.assertGreater(len(votes), allstar.ROSTER_SIZE, conference)

    def test_it_is_sorted_and_the_leader_gets_the_headline(self):
        for votes in allstar.tally(played()).values():
            scores = [v.score for v in votes]
            self.assertEqual(scores, sorted(scores, reverse=True))
            self.assertEqual(votes[0].votes, allstar.HEADLINE_VOTES)

    def test_the_field_actually_spreads(self):
        """The bug this pins: scaling the count across the pool instead of
        against the leader gave the leading vote-getter 1.5% of the ballot and
        put the whole field within two points of each other."""
        for conference, votes in allstar.tally(played()).items():
            top = votes[0].score
            tail = votes[-1].score
            self.assertGreater(top, 0.75, conference)
            self.assertLess(tail, 0.35, conference)
            self.assertLess(votes[24].votes, votes[0].votes * 0.8, conference)

    def test_a_short_season_is_not_a_case(self):
        league = played()
        minimum = allstar._minimum_games(league)
        self.assertGreater(minimum, 1)
        for votes in allstar.tally(league).values():
            self.assertTrue(all(v.games >= minimum for v in votes))

    def test_the_weights_are_the_whole_mechanism(self):
        self.assertAlmostEqual(sum(allstar.WEIGHTS.values()), 1.0, places=6)
        for votes in allstar.tally(played()).values():
            for vote in votes[:5]:
                self.assertEqual(set(vote.parts), set(allstar.WEIGHTS))
                expected = sum(vote.parts[k] * allstar.WEIGHTS[k]
                               for k in allstar.WEIGHTS)
                self.assertAlmostEqual(vote.score, expected, places=6)

    def test_a_player_only_stands_in_his_own_conference(self):
        league = played()
        for conference, votes in allstar.tally(league).items():
            for vote in votes:
                self.assertEqual(vote.conference, conference)


class TestTheSideCanPlay(unittest.TestCase):
    """The vote alone named sides the league forbids anyone to field."""

    def setUp(self):
        self.sides = allstar.select(played())

    def test_twelve_a_side_and_nobody_twice(self):
        for conference, side in self.sides.items():
            self.assertEqual(len(side.roster), allstar.ROSTER_SIZE, conference)
            ids = [v.player_id for v in side.roster]
            self.assertEqual(len(set(ids)), len(ids), conference)
            self.assertEqual(len(side.starters), 5, conference)

    def test_every_position_is_represented_twice_over(self):
        """Without the positional ballot the raw vote sent eight bigs and four
        shooting guards, which cannot make three distinct positions on the
        floor -- let alone a starter and a deputy at each."""
        for conference, side in self.sides.items():
            held = [v.position for v in side.roster]
            for position in POSITIONS:
                self.assertGreaterEqual(
                    held.count(position), 2,
                    f"{conference} has {held.count(position)} at {position}")

    def test_the_five_who_start_are_one_at_each_position(self):
        """The ballot is positional: the best centre in a conference starts at
        centre, not behind three forwards who polled higher."""
        for conference, side in self.sides.items():
            shape = sorted(v.position for v in side.starters)
            self.assertEqual(shape, sorted(POSITIONS), conference)

    def test_each_starter_is_his_position_s_leading_vote_getter(self):
        counts = allstar.tally(played())
        for conference, side in self.sides.items():
            board = counts[conference]
            for starter in side.starters:
                best = next(v for v in board if v.position == starter.position)
                self.assertEqual(starter.player_id, best.player_id,
                                 f"{conference} {starter.position}")

    def test_the_bench_is_the_runner_up_at_each_position_then_two_free(self):
        counts = allstar.tally(played())
        for conference, side in self.sides.items():
            board = counts[conference]
            positional = side.reserves[:allstar.POSITIONAL_RESERVES]
            self.assertEqual(sorted(v.position for v in positional),
                             sorted(POSITIONS), conference)
            for reserve in positional:
                at = [v for v in board if v.position == reserve.position]
                self.assertEqual(reserve.player_id, at[1].player_id,
                                 f"{conference} second {reserve.position}")

            # And the last two are simply the best left, wherever they play.
            wild = side.reserves[allstar.POSITIONAL_RESERVES:]
            self.assertEqual(len(wild), allstar.WILDCARDS, conference)
            chosen = {v.player_id for v in side.roster}
            missed = [v for v in board if v.player_id not in chosen]
            if missed:
                self.assertGreaterEqual(min(v.score for v in wild),
                                        max(v.score for v in missed),
                                        f"{conference} passed over a better vote")

    def test_the_announced_five_is_a_five_the_league_would_field(self):
        """Now true by construction rather than by consulting `lineup.py` --
        five distinct positions, one apiece, is legal under any reading of the
        rules. The raw vote's Tidewater starters were three power forwards."""
        for conference, side in self.sides.items():
            shape = [v.position for v in side.starters]
            self.assertTrue(DEFAULT_RULES.is_legal(shape),
                            f"{conference}: {DEFAULT_RULES.violations(shape)}")

    def test_the_starters_are_drawn_from_the_twelve(self):
        for side in self.sides.values():
            roster = {v.player_id for v in side.roster}
            self.assertTrue({v.player_id for v in side.starters} <= roster)
            self.assertEqual(len(side.reserves), allstar.RESERVES)


class TestTheExhibitionIsSealedOff(unittest.TestCase):
    """The one claim that would fail silently and expensively."""

    @classmethod
    def setUpClass(cls):
        cls.league = after_the_game()
        # Re-run it on a league of its own, so the before/after pair straddles
        # exactly one call to `play` and nothing else.
        cls.subject = fresh(games_per_team=10)
        cls.before = snapshot(cls.subject)
        allstar.play(cls.subject)
        cls.after = snapshot(cls.subject)
        cls.game = cls.league.allstar[cls.league.season]

    def test_it_is_never_on_the_calendar(self):
        """Not a rule applied in six places -- the reason all six hold."""
        ids = {g.id for g in self.subject.schedule}
        self.assertNotIn(f"allstar-{self.subject.season}", ids)
        self.assertEqual(self.before["fixtures"], self.after["fixtures"])

    def test_it_touches_nothing_that_counts(self):
        for key in ("standings", "player_stats", "team_stats", "records",
                    "chemistry", "health"):
            self.assertEqual(self.before[key], self.after[key], key)

    def test_it_was_actually_played(self):
        self.assertTrue(self.game.played)
        self.assertGreater(self.game.home_score, 60)
        self.assertGreater(self.game.away_score, 60)
        self.assertTrue(self.game.mvp_id)

    def test_the_mvp_comes_off_the_winning_side(self):
        winner = (self.game.home_conference
                  if self.game.home_score >= self.game.away_score
                  else self.game.away_conference)
        self.assertIn(self.game.mvp_id,
                      {row["playerId"] for row in self.game.box[winner]})

    def test_all_twenty_four_get_on_the_floor(self):
        """ROTATION_DEPTH is nine. A marquee game where three of the men the
        league just voted in record a DNP is not the game that was voted for."""
        for conference, rows in self.game.box.items():
            self.assertEqual(len(rows), allstar.ROSTER_SIZE, conference)
            self.assertTrue(all(r["minutes"] > 0 for r in rows), conference)

    def test_playing_it_twice_changes_nothing(self):
        again = allstar.play(self.subject)
        self.assertIs(again, self.subject.allstar[self.subject.season])
        self.assertEqual(self.after, snapshot(self.subject))
        again = allstar.play(self.league)
        self.assertIs(again, self.game)
        self.assertEqual(again.home_score, self.game.home_score)


class TestConditionIsRestored(unittest.TestCase):
    def test_nobody_carries_the_exhibition_into_the_next_game(self):
        league = fresh(games_per_team=10)
        before = {p.id: p.condition
                  for t in league.teams.values() for p in t.players}
        allstar.play(league)
        after = {p.id: p.condition
                 for t in league.teams.values() for p in t.players}
        self.assertEqual(before, after)


class TestTheTickPlaysIt(unittest.TestCase):
    def test_it_declines_until_tip_off_and_then_does_not(self):
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            [t.id for t in saved.teams], start_date=date(2026, 10, 20),
            games_per_team=4, season=league.season))
        league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
        league.tick()

        game = allstar.state(league)
        self.assertFalse(game.played)
        self.assertIsNone(allstar.run(league))

        league.clock.jump_to(game.tipoff_at + timedelta(hours=1))
        league.tick()
        self.assertTrue(allstar.state(league).played)


class TestItSurvivesASave(unittest.TestCase):
    """Stored rather than derived, because a closed vote cannot be reopened."""

    def test_round_trip(self):
        league = after_the_game()
        original = league.allstar[league.season]
        path = Path(__file__).with_name("_allstar_roundtrip.json")
        try:
            save.write_allstar(path, league.allstar)
            back = save.read_allstar(path)[league.season]
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(back.tipoff_at, original.tipoff_at)
        self.assertEqual(back.played, original.played)
        self.assertEqual(back.home_score, original.home_score)
        self.assertEqual(back.mvp_id, original.mvp_id)
        self.assertEqual(back.selected(), original.selected())
        self.assertEqual(json.dumps(back.box, sort_keys=True),
                         json.dumps(original.box, sort_keys=True))

    def test_a_scheduled_game_survives_a_restart(self):
        """The bug this pins would never have thrown. Writing only *played*
        games meant a scheduled one was a date and nothing else, so the date
        was recomputed from "next Wednesday" on every boot -- and on a host
        that restarts a few times a week the game slides forward a week each
        time and never arrives."""
        league = played(games_per_team=10)
        game = allstar.state(league)
        self.assertFalse(game.played)
        path = Path(__file__).with_name("_allstar_scheduled.json")
        try:
            self.assertIsNotNone(save.write_allstar(path, league.allstar))
            back = save.read_allstar(path)
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual(back[league.season].tipoff_at, game.tipoff_at)
        self.assertFalse(back[league.season].played)

    def test_nothing_played_writes_no_file(self):
        path = Path(__file__).with_name("_allstar_empty.json")
        path.write_text("stale")
        try:
            self.assertIsNone(save.write_allstar(path, {}))
            self.assertFalse(path.is_file())
        finally:
            path.unlink(missing_ok=True)


class TestTheAccolade(unittest.TestCase):
    def test_nobody_is_an_all_star_until_tip_off(self):
        """The run-up is a race. A badge handed out on a projection would be
        taken back again the first time somebody scored forty."""
        league = played(games_per_team=10)
        candidate = allstar.select(league)[CONFERENCES[0]].starters[0]
        team = league.teams[candidate.team_id]
        player = team.player(candidate.player_id)
        ids = {a["id"] for a in accolades.for_player(league, player)}
        self.assertNotIn("all_star", ids)

    def test_the_selected_get_it_and_others_do_not(self):
        league = after_the_game()
        game = league.allstar[league.season]
        chosen = game.selected()

        row = next(r for rows in game.rosters.values() for r in rows)
        player = league.teams[row["teamId"]].player(row["playerId"])
        shelf = {a["id"]: a for a in accolades.for_player(league, player)}
        self.assertIn("all_star", shelf)
        self.assertEqual(shelf["all_star"]["seasons"], [league.season])

        other = next(p for t in league.teams.values() for p in t.players
                     if p.id not in chosen)
        self.assertNotIn("all_star",
                         {a["id"] for a in accolades.for_player(league, other)})

    def test_the_game_mvp_gets_his_own(self):
        league = after_the_game()
        game = league.allstar[league.season]
        row = next(r for rows in game.rosters.values() for r in rows
                   if r["playerId"] == game.mvp_id)
        player = league.teams[row["teamId"]].player(game.mvp_id)
        ids = {a["id"] for a in accolades.for_player(league, player)}
        self.assertIn("all_star_mvp", ids)


class TestTheView(unittest.TestCase):
    def test_open_voting_ships_a_board_and_a_projection(self):
        league = played(games_per_team=10)
        view = payload.allstar_view(league)
        self.assertFalse(view["played"])
        self.assertEqual(set(view["standings"]), set(CONFERENCES))
        for conference in CONFERENCES:
            board = view["standings"][conference]
            self.assertLessEqual(len(board), payload.VOTE_BOARD_DEPTH)
            self.assertTrue(all(r["teamAbbr"] for r in board), conference)
            roster = view["rosters"][conference]
            self.assertEqual(len(roster), allstar.ROSTER_SIZE)
            self.assertEqual(sum(1 for r in roster if r["starter"]), 5)
        # The countdown is measured against the league's clock, not the
        # reader's. Compared by date rather than by string: the sim clock is
        # real time plus an offset, so it moves between the two calls.
        sent = datetime.fromisoformat(view["now"])
        self.assertEqual(sent.date(), league.clock.now().date())
        self.assertNotEqual(sent.date(), datetime.now(timezone.utc).date(),
                            "sending the reader's date makes the countdown "
                            "read 'in 76 days' for a game six days out")

    def test_a_played_game_ships_the_result_and_drops_the_projection(self):
        league = after_the_game()
        view = payload.allstar_view(league)
        self.assertTrue(view["played"])
        self.assertEqual(view["standings"], {})
        self.assertEqual(set(view["box"]), set(CONFERENCES))
        for rows in view["box"].values():
            self.assertTrue(all(r["teamId"] for r in rows))


class TestTheFixturesStaySeparate(unittest.TestCase):
    """The guard for the mistake above: if a test ever plays the exhibition on
    a cached open-voting league again, this says so directly rather than
    letting two unrelated tests fail with what look like real bugs."""

    def test_no_cached_open_league_has_played_its_game(self):
        for size, league in _CACHE.items():
            for game in (league.allstar or {}).values():
                self.assertFalse(game.played, f"played on the cached {size}")


if __name__ == "__main__":
    unittest.main()


class TestItWaitsForASeasonToVoteOn(unittest.TestCase):
    """`offseason.reschedule` clears `league.stats` when it installs a new
    calendar, so the opening days of every season have an empty ballot -- and a
    date set to "next Wednesday" can land inside them. Playing then would field
    two sides of nobody and mark that season's game *played*, freezing a broken
    result forever."""

    def _opening_night(self) -> League:
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            [t.id for t in saved.teams], start_date=date(2026, 10, 20),
            games_per_team=4, season=league.season))
        return league

    def test_it_declines_and_pushes_the_date_a_week(self):
        league = self._opening_night()
        game = allstar.state(league)
        first = game.tipoff_at
        league.clock.jump_to(first + timedelta(hours=2))

        self.assertIsNone(allstar.run(league))
        self.assertFalse(game.played)
        self.assertGreater(game.tipoff_at, league.clock.now())
        self.assertEqual(game.tipoff_at.weekday(), allstar.GAME_WEEKDAY)

    def test_a_clock_jumped_months_forward_still_lands_ahead(self):
        league = self._opening_night()
        game = allstar.state(league)
        league.clock.jump_to(game.tipoff_at + timedelta(days=200))

        self.assertIsNone(allstar.run(league))
        self.assertGreater(game.tipoff_at, league.clock.now())

    def test_play_refuses_rather_than_fielding_nobody(self):
        league = self._opening_night()
        with self.assertRaises(ValueError):
            allstar.play(league)
        self.assertFalse(allstar.state(league).played)
