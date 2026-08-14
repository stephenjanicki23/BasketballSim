"""The record book.

The claim worth defending is that the two halves are built oppositely for a
reason: season records are **derived** from the archives on every read, and
single-game records are **stored** because a box score cannot be recovered once
a season's calendar is replaced.

Two tests exist because getting them wrong would be invisible:

  * `TestObservingIsIdempotent` -- a restored season folds its results back
    through `League._record`, so a book that counted a 61-point night again on
    every boot would silently inflate itself. Idempotence is what lets the hook
    live anywhere.
  * `TestSeasonRecordsAreDerived` -- if these were ever stored they would drift
    from the archives behind them, which is the exact failure the whole project
    avoids by deriving.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import records as R
from bballsim import save
from bballsim.api import payload
from bballsim.league import offseason
from bballsim.league.calendar import GameStatus, build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_CACHE: dict[int, League] = {}


def played(games_per_team: int = 10) -> League:
    """A private league that has played a stretch of a season.

    Built on its own calendar rather than the committed one, and with the clock
    driven to a fixture rather than left at "now" -- see `test_mvp` for what a
    wall-clock-dependent fixture does to a shared league.
    """
    if games_per_team in _CACHE:
        return _CACHE[games_per_team]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
    league.tick()
    _CACHE[games_per_team] = league
    return league


def finished(league):
    return [g for g in league.schedule if g.status == GameStatus.FINAL]


class TestTheBookFillsItself(unittest.TestCase):

    def setUp(self):
        self.league = played()
        self.book = R.book_for(self.league)

    def test_games_reach_the_book_without_being_asked(self):
        """`League._finalize` is the only hook. If it were missing the page
        would be empty and nothing else would fail."""
        self.assertTrue(self.book.games)
        self.assertTrue(self.book.list_for("player:points"))

    def test_every_declared_category_has_a_list(self):
        for key, _label, _read in R.GAME_PLAYER_CATEGORIES:
            self.assertTrue(self.book.list_for(f"player:{key}"), key)
        for key, _label, _read in R.GAME_TEAM_CATEGORIES:
            self.assertTrue(self.book.list_for(f"team:{key}"), key)

    def test_a_list_is_at_most_ten_deep(self):
        for key, marks in self.book.games.items():
            self.assertLessEqual(len(marks), R.DEPTH, key)

    def test_lists_are_ordered_best_first(self):
        for key, marks in self.book.games.items():
            values = [m.value for m in marks]
            self.assertEqual(values, sorted(values, reverse=True), key)

    def test_the_top_points_mark_is_the_best_game_actually_played(self):
        """The book against the box scores it came from. A record book that
        disagreed with its own games would be the worst possible bug here."""
        best = 0
        for game in finished(self.league):
            for box in (game.result.home_box, game.result.away_box):
                for line in box.players.values():
                    best = max(best, line.points)
        self.assertEqual(self.book.list_for("player:points")[0].value, float(best))

    def test_a_mark_says_who_and_when(self):
        mark = self.book.list_for("player:points")[0]
        self.assertTrue(mark.holder_id)
        self.assertTrue(mark.name)
        self.assertTrue(mark.team_id)
        self.assertTrue(mark.game_id)
        self.assertTrue(mark.opponent_id)
        self.assertTrue(mark.played_on)
        self.assertTrue(mark.season)

    def test_the_game_a_mark_names_really_contains_it(self):
        for key in ("player:points", "player:rebounds", "player:assists"):
            mark = self.book.list_for(key)[0]
            game = self.league.game(mark.game_id)
            self.assertIsNotNone(game, mark.game_id)
            lines = {}
            for box in (game.result.home_box, game.result.away_box):
                lines.update(box.players)
            self.assertIn(mark.holder_id, lines)

    def test_nobody_who_did_not_play_is_on_a_list(self):
        for marks in self.book.games.values():
            for mark in marks:
                self.assertGreater(mark.value, 0.0)


class TestObservingIsIdempotent(unittest.TestCase):
    """The property that lets the hook live anywhere.

    A restored season folds its results back through `League._record`, and a
    book that counted the same night twice would inflate itself a little on
    every boot -- silently, and in a direction nobody would question.
    """

    def test_offering_the_same_game_twice_changes_nothing(self):
        league = played()
        before = {k: [m.to_dict() for m in v]
                  for k, v in R.book_for(league).games.items()}
        R.backfill(league)
        after = {k: [m.to_dict() for m in v]
                 for k, v in R.book_for(league).games.items()}
        self.assertEqual(before, after)

    def test_a_backfill_reports_nothing_taken_the_second_time(self):
        league = played()
        R.backfill(league)
        self.assertEqual(R.backfill(league), 0)

    def test_a_fresh_book_recovers_the_same_marks(self):
        """What `backfill` is for: a save that predates the book."""
        league = played()
        original = {k: [m.to_dict() for m in v]
                    for k, v in R.book_for(league).games.items()}
        league.records = R.Book()
        R.backfill(league)
        rebuilt = {k: [m.to_dict() for m in v]
                   for k, v in R.book_for(league).games.items()}
        self.assertEqual(rebuilt, original)


class TestSeasonRecordsAreDerived(unittest.TestCase):

    def test_they_match_the_season_totals_behind_them(self):
        league = played()
        best = max((line.points for line in league.stats.players.values()),
                   default=0)
        records = R.season_records(league)
        self.assertEqual(records["player:points"][0]["value"], float(best))

    def test_nothing_season_shaped_is_stored(self):
        """The book on the league carries single-game lists only. A season key
        appearing in here would mean it was being saved to disk."""
        league = played()
        for key in R.book_for(league).games:
            self.assertIn(key.split(":")[0], ("player", "team"))
            self.assertNotIn(key.split(":")[1], ("ppg", "rpg", "apg", "wins"))

    def test_a_rate_record_needs_a_real_number_of_games(self):
        """Without the qualifier, "most points per game" is won every year by
        somebody who played once and scored thirty."""
        league = played()
        book = R.book(league)
        minimum = book["rateMinimum"]
        self.assertGreater(minimum, 1)
        section = next(s for s in book["season"]["players"]
                       if s["key"] == "player:ppg")
        for mark in section["marks"]:
            line = league.stats.players[mark["holderId"]]
            self.assertGreaterEqual(line.games, minimum, mark["name"])

    def test_a_rate_section_says_what_its_qualifier_is(self):
        """An empty rate card that said "nothing on record yet" read as a bug:
        a third of the way through a season the true statement is that nobody
        has played enough games. The card can only say so if the payload
        carries the number."""
        book = R.book(played())
        rates = [s for s in book["season"]["players"]
                 if s["key"] in ("player:ppg", "player:rpg", "player:apg")]
        self.assertEqual(len(rates), 3)
        for section in rates:
            self.assertEqual(section["minimumGames"], book["rateMinimum"])
        totals = next(s for s in book["season"]["players"]
                      if s["key"] == "player:points")
        self.assertEqual(totals["minimumGames"], 0)

    def test_a_total_record_needs_no_qualifier(self):
        league = played()
        section = next(s for s in R.book(league)["season"]["players"]
                       if s["key"] == "player:points")
        self.assertTrue(section["marks"])

    def test_an_archived_season_is_still_on_the_board(self):
        """The half that reaches back further, and the reason it can: the
        archive keeps season totals."""
        league = played(6)
        offseason.play_out(league)
        offseason.roll_summer(league)
        self.assertTrue(league.history)
        seasons = R.book(league)["seasons"]
        for archive in league.history:
            self.assertIn(archive.season, seasons)


class TestItSurvivesASave(unittest.TestCase):

    def test_the_book_round_trips(self):
        league = played()
        blob = json.loads(json.dumps(save._round(
            save.dump_records(R.book_for(league)))))
        back = save.load_records(blob)
        original = R.book_for(league)
        self.assertEqual(set(back.games), set(original.games))
        for key, marks in original.games.items():
            self.assertEqual([m.to_dict() for m in back.games[key]],
                             [m.to_dict() for m in marks])

    def test_an_empty_book_round_trips(self):
        back = save.load_records(save.dump_records(R.Book()))
        self.assertEqual(back.games, {})

    def test_reading_a_missing_file_gives_an_empty_book(self):
        book = save.read_records(Path("/nonexistent/records.json"))
        self.assertEqual(book.games, {})


class TestThePostseasonCounts(unittest.TestCase):
    """`_record` skips playoff games because seeding is read off the standings.
    A record book that skipped them would be a strange record book."""

    def test_a_playoff_game_can_set_a_record(self):
        league = played(6)
        offseason.play_out(league)
        stages = {mark.stage for marks in R.book_for(league).games.values()
                  for mark in marks}
        self.assertTrue(any(stage for stage in stages),
                        "no postseason game reached the book")

    def test_a_regular_season_mark_carries_no_stage(self):
        league = played()
        for marks in R.book_for(league).games.values():
            for mark in marks:
                self.assertEqual(mark.stage, "")


class TestThePage(unittest.TestCase):

    def setUp(self):
        self.view = payload.records_view(played())

    def test_it_has_both_halves_for_players_and_teams(self):
        for half in ("game", "season"):
            for scope in ("players", "teams"):
                self.assertTrue(self.view[half][scope], f"{half}/{scope}")

    def test_every_section_declares_what_it_is(self):
        for half in ("game", "season"):
            for scope in ("players", "teams"):
                for section in self.view[half][scope]:
                    self.assertIn("key", section)
                    self.assertIn("label", section)
                    self.assertEqual(section["kind"], half)

    def test_club_names_are_added_here_not_stored(self):
        """`records.py` deals in ids because it is written to disk and a club
        can be renamed. A stored abbreviation would go stale."""
        mark = self.view["game"]["players"][0]["marks"][0]
        self.assertTrue(mark["teamAbbr"])
        self.assertTrue(mark["opponentAbbr"])
        stored = R.book_for(played()).list_for("player:points")[0]
        self.assertFalse(hasattr(stored, "team_abbr"))

    def test_the_caveat_is_in_the_payload(self):
        """The published demo reads this JSON and no UI copy, so the reason one
        half reaches further back than the other has to travel with it."""
        self.assertIn("cannot be recovered", self.view["note"])

    def test_it_is_json_serialisable(self):
        json.dumps(self.view)


if __name__ == "__main__":
    unittest.main()
