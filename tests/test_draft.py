"""The draft board, the five mock drafters, and the offseason preview.

The claim this file exists to defend is one sentence: **a mock draft names the
players who actually arrive.** Everything else here supports it.

Four tests exist because a real run failed them, and each says so in its
docstring:

  * `TestOneDraftHasOneName` -- `draft_picks` numbered the draft after 2026-27
    as 2026 and `offseason.draft` generated its class under 2027. Two names for
    one draft, harmless until `board(year)` was keyed on it, at which point the
    mocks named sixty players who would never arrive.
  * `TestTheWritersArgueWithTheBoard` -- with no deference weight, a writer
    reading only their own lens took the thirty-second-ranked prospect third
    overall.
  * `TestThePreviewChangesNothing` -- the whole safety case for unhiding the
    tab mid-season.
  * `TestASquadStaysLegal` -- drafting for need off a fixed board can exhaust a
    position, which the old vacancy-sized intake could not do.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import contracts as K
from bballsim import draft_class as DC
from bballsim import draft_picks as DP
from bballsim import mock_draft as MD
from bballsim.api import payload
from bballsim.league import franchise, offseason
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams
from bballsim.save import apply_season, read_season, season_exists

POSITIONS = ("PG", "SG", "SF", "PF", "C")

_LEAGUE: League | None = None


def league() -> League:
    """The committed season, contracted and with picks. Shared, read-only."""
    global _LEAGUE
    if _LEAGUE is None:
        saved = load_teams()
        lg = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            lg.add_team(team)
        if season_exists():
            apply_season(lg, read_season())
        K.generate_for_league(list(lg.teams.values()), season=lg.season)
        K.generate_coaches_for_league(list(lg.teams.values()), season=lg.season)
        lg.tick()
        DP.ensure(lg)
        _LEAGUE = lg
    return _LEAGUE


def small() -> League:
    """A private six-game league, for tests that roll a summer."""
    saved = load_teams()
    lg = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        lg.add_team(team)
    lg.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=6, season=lg.season))
    return lg


class TestTheBoardExistsBeforeTheDraft(unittest.TestCase):

    def test_a_class_is_the_same_every_time_it_is_asked_for(self):
        first = [p.id for p in DC.board(2031)]
        second = [p.id for p in DC.board(2031)]
        self.assertEqual(first, second)

    def test_two_years_are_two_different_classes(self):
        self.assertNotEqual([p.name for p in DC.board(2031)],
                            [p.name for p in DC.board(2032)])

    def test_a_class_is_two_full_rounds(self):
        self.assertEqual(len(DC.board(2031)), DC.BOARD_SIZE)
        self.assertEqual(DC.BOARD_SIZE, DC.ROUND_SIZE * DC.ROUNDS)

    def test_the_board_is_ranked_best_first(self):
        board = DC.board(2031)
        ability = [p.ability.current for p in board]
        self.assertEqual(ability, sorted(ability, reverse=True))

    def test_the_top_of_a_class_has_more_headroom_than_the_tail(self):
        board = DC.board(2031)
        top = board[0].ability.potential - board[0].ability.current
        tail = board[-1].ability.potential - board[-1].ability.current
        self.assertGreater(top, tail)

    def test_every_position_is_represented(self):
        counts = Counter(p.position.value for p in DC.board(2031))
        for position in POSITIONS:
            self.assertGreaterEqual(counts[position], DC.POSITION_FLOOR, position)

    def test_a_class_can_be_thin_somewhere(self):
        """The whole reason need-based and best-available mocks disagree. If
        every class were 12 of each, one board would do."""
        spreads = []
        for year in range(2028, 2044):
            counts = Counter(p.position.value for p in DC.board(year))
            spreads.append(max(counts.values()) - min(counts.values()))
        self.assertGreater(max(spreads), 4,
                           "no class in sixteen years is thin at a position")

    def test_a_strong_class_is_actually_stronger(self):
        """`class_label` has priced picks since the trade engine was built. If
        the label and the players disagreed, "we are saving our picks for 2031"
        would be a position about nothing."""
        years = list(range(2028, 2060))
        best = max(years, key=DC.strength)
        worst = min(years, key=DC.strength)
        self.assertGreater(DC.board(best)[0].ability.current,
                           DC.board(worst)[0].ability.current)

    def test_best_available_respects_what_is_gone(self):
        board = DC.board(2031)
        taken = {board[0].id, board[1].id}
        self.assertEqual(DC.best_available(2031, taken).id, board[2].id)

    def test_best_available_can_be_asked_for_a_position(self):
        pick = DC.best_available(2031, set(), "C")
        self.assertIsNotNone(pick)
        self.assertEqual(pick.position.value, "C")

    def test_an_exhausted_board_returns_nothing_rather_than_raising(self):
        everyone = {p.id for p in DC.board(2031)}
        self.assertIsNone(DC.best_available(2031, everyone))


class TestOneDraftHasOneName(unittest.TestCase):
    """The bug that would have made the whole feature a convincing lie.

    `draft_picks` numbered picks off the season's opening year, so it called
    the draft after 2026-27 the 2026 draft. `offseason.draft` generated its
    class under `next_label(season)`, so it called the same draft 2027. That
    cost nothing while no object was keyed on the year -- and `board(year)` is
    keyed on it, so the sixty players the writers mocked were not the sixty who
    would arrive.
    """

    def test_a_draft_is_named_for_the_year_it_is_held(self):
        lg = small()
        lg.season = "2026-27"
        self.assertEqual(DP.current_year(lg), 2027)

    def test_pick_labels_use_the_same_year_as_the_class(self):
        lg = small()
        year = DP.current_year(lg)
        soonest = min(p.year for p in DP.ensure(lg))
        self.assertEqual(soonest, year)
        self.assertTrue(DP.ensure(lg)[0].label.startswith(str(year)))

    def test_the_mock_and_the_intake_read_the_same_board(self):
        """The direct statement of the bug: whatever year the mock drafts, the
        intake has to sign from that same board."""
        lg = small()
        offseason.play_out(lg)
        year = DP.current_year(lg)
        mocked = {p["playerId"] for p in MD.mock(lg, MD.PANEL[0])}
        offseason.roll_summer(lg)
        arrived = [p for team in lg.teams.values() for p in team.players
                   if getattr(p, "board_rank", None) is not None]
        self.assertTrue(arrived, "nobody was drafted")
        board = {p.id for p in DC.board(year)}
        for player in arrived:
            self.assertIn(player.id, board,
                          f"{player.name} arrived but was never on the board")

    def test_the_mock_names_the_players_who_arrive(self):
        """The claim the whole feature rests on."""
        lg = small()
        offseason.play_out(lg)
        mocked = {p["playerId"] for p in MD.mock(lg, MD.PANEL[0])}
        offseason.roll_summer(lg)
        arrived = [p for team in lg.teams.values() for p in team.players
                   if getattr(p, "board_rank", None) is not None]
        named = [p for p in arrived if p.id in mocked]
        self.assertTrue(arrived)
        # Not all of them: a mock is 30 picks and clubs draft for position, so
        # somebody can arrive from outside the mocked thirty. Most of them.
        self.assertGreater(len(named) / len(arrived), 0.5,
                           f"only {len(named)} of {len(arrived)} were mocked")


class TestASquadStaysLegal(unittest.TestCase):
    """Drafting for need off a *fixed* board can exhaust a position, which the
    old vacancy-sized intake could not do -- it made a centre whenever it
    needed one."""

    def test_a_club_never_ends_a_summer_short_of_a_position(self):
        lg = small()
        offseason.play_out(lg)
        offseason.roll_summer(lg)
        for team in lg.teams.values():
            for position in POSITIONS:
                self.assertGreaterEqual(
                    sum(1 for p in team.players if p.position.value == position),
                    1, f"{team.id} has no {position}")

    def test_an_arrival_takes_the_position_that_came_free(self):
        """The draft replaces like for like, so a squad's shape is exactly
        preserved across a summer.

        The trade market is stubbed out for this one. It also runs on the tick
        that rolls the summer, it is entitled to change a squad's shape, and
        leaving it in made this test assert something about trades while
        claiming to assert something about the draft -- which is how it first
        failed, on a club that finished the summer with three point guards
        instead of two.
        """
        from bballsim import trade_market
        lg = small()
        offseason.play_out(lg)
        before = {t.id: Counter(p.position.value for p in t.players)
                  for t in lg.teams.values()}
        real = trade_market.run
        trade_market.run = lambda league: None
        try:
            offseason.roll_summer(lg)
        finally:
            trade_market.run = real
        after = {t.id: Counter(p.position.value for p in t.players)
                 for t in lg.teams.values()}
        for team_id in before:
            for position in POSITIONS:
                self.assertEqual(before[team_id][position],
                                 after[team_id][position],
                                 f"{team_id} changed shape at {position}")

    def test_the_board_is_not_mutated_by_signing_from_it(self):
        """`board` memoises and hands the same objects to every caller,
        including the mocks that already named them. Signing sets a jersey and
        a career profile; doing that in place would edit the board."""
        lg = small()
        offseason.play_out(lg)
        year = DP.current_year(lg)
        before = [(p.id, p.jersey, p.name) for p in DC.board(year)]
        offseason.roll_summer(lg)
        after = [(p.id, p.jersey, p.name) for p in DC.board(year)]
        self.assertEqual(before, after)


class TestWhenTheMocksGoOut(unittest.TestCase):

    def moment(self, year, month, day, hour=12):
        return datetime(year, month, day, hour, tzinfo=timezone.utc)

    def test_editions_are_wednesdays_and_sundays(self):
        for day in range(1, 29):
            edition = MD.edition_at(self.moment(2027, 3, day))
            self.assertIn(edition.weekday(), MD.PUBLISH_WEEKDAYS,
                          edition.isoformat())

    def test_an_edition_is_at_midnight(self):
        edition = MD.edition_at(self.moment(2027, 3, 12, 17))
        self.assertEqual((edition.hour, edition.minute, edition.second), (0, 0, 0))

    def test_an_edition_is_never_in_the_future(self):
        for day in range(1, 29):
            now = self.moment(2027, 3, day, 6)
            self.assertLessEqual(MD.edition_at(now), now)

    def test_the_board_does_not_move_between_publication_days(self):
        """What makes these mocks rather than a live leaderboard."""
        thursday = self.moment(2027, 3, 11, 9)
        friday = self.moment(2027, 3, 12, 22)
        self.assertEqual(MD.edition_at(thursday), MD.edition_at(friday))

    def test_the_next_edition_is_always_ahead(self):
        for day in range(1, 29):
            now = self.moment(2027, 3, day, 6)
            nxt = MD.next_edition_after(now)
            self.assertGreater(nxt, now)
            self.assertIn(nxt.weekday(), MD.PUBLISH_WEEKDAYS)

    def test_midnight_itself_publishes(self):
        """A Wednesday at 00:00 is that Wednesday's edition, not Sunday's."""
        midnight = self.moment(2027, 3, 10, 0)
        self.assertEqual(midnight.weekday(), 2)
        self.assertEqual(MD.edition_at(midnight), midnight)

    def test_the_gap_is_never_more_than_four_days(self):
        for day in range(1, 29):
            now = self.moment(2027, 3, day, 6)
            gap = MD.next_edition_after(now) - MD.edition_at(now)
            self.assertLessEqual(gap, timedelta(days=4))


class TestFiveWritersDisagree(unittest.TestCase):

    def setUp(self):
        self.league = league()
        self.boards = {w.id: MD.mock(self.league, w) for w in MD.PANEL}

    def test_there_are_five(self):
        self.assertEqual(len(MD.PANEL), 5)
        self.assertEqual(len({w.id for w in MD.PANEL}), 5)

    def test_each_writer_fills_a_first_round(self):
        for writer_id, picks in self.boards.items():
            self.assertEqual(len(picks), MD.MOCK_PICKS, writer_id)

    def test_nobody_is_drafted_twice_on_one_board(self):
        for writer_id, picks in self.boards.items():
            ids = [p["playerId"] for p in picks]
            self.assertEqual(len(ids), len(set(ids)), writer_id)

    def test_no_two_writers_produce_the_same_board(self):
        """If two agreed completely there would be four writers."""
        seen = {}
        for writer_id, picks in self.boards.items():
            key = tuple(p["playerId"] for p in picks)
            self.assertNotIn(key, seen,
                             f"{writer_id} and {seen.get(key)} are identical")
            seen[key] = writer_id

    def test_the_need_writer_drafts_for_need_more_than_the_board_writer(self):
        """The evidence a philosophy is doing something rather than decorating
        a chip row."""
        def hits(picks):
            return sum(1 for p in picks
                       if p["position"] in MD.thin_positions(
                           self.league.teams[p["teamId"]]))
        self.assertGreater(hits(self.boards["need"]), hits(self.boards["board"]))

    def test_the_board_writer_takes_the_board_in_order(self):
        picks = self.boards["board"]
        ranks = [p["boardRank"] for p in picks]
        self.assertEqual(ranks, sorted(ranks))
        self.assertTrue(all(p["reach"] == 0 for p in picks))

    def test_the_upside_writer_takes_more_potential_than_the_floor_writer(self):
        def ceiling(picks):
            return sum(p["potential"] for p in picks[:10]) / 10
        self.assertGreater(ceiling(self.boards["upside"]),
                           ceiling(self.boards["floor"]))

    def test_the_floor_writer_takes_more_ability_than_the_upside_writer(self):
        """The exact inverse, which is what makes them two philosophies rather
        than one with noise on it."""
        def now(picks):
            return sum(p["ca"] for p in picks[:10]) / 10
        self.assertGreater(now(self.boards["floor"]), now(self.boards["upside"]))

    def test_a_mock_is_the_same_twice(self):
        again = MD.mock(self.league, MD.PANEL[2])
        self.assertEqual([p["playerId"] for p in again],
                         [p["playerId"] for p in self.boards["upside"]])


class TestTheWritersArgueWithTheBoard(unittest.TestCase):
    """The bug the deference weight exists to hold down.

    The first version gave each writer only their own lens, and one of them
    took the thirty-second-ranked prospect third overall. That is not a
    dissenting mock draft, it is a different sport.
    """

    def setUp(self):
        self.league = league()

    def test_nobody_reaches_absurdly(self):
        for writer in MD.PANEL:
            for pick in MD.mock(self.league, writer):
                self.assertLess(
                    pick["reach"], 25,
                    f"{writer.id} took {pick['name']} (board "
                    f"{pick['boardRank']}) at {pick['slot']}")

    def test_every_writer_defers_at_least_a_little(self):
        for writer in MD.PANEL:
            self.assertGreater(writer.board_weight, 0.0, writer.id)
            self.assertLessEqual(writer.board_weight, 1.0, writer.id)

    def test_the_top_of_the_board_goes_early_on_every_board(self):
        """However each writer reads a class, the best prospect in it does not
        fall out of the first round."""
        best = DC.board(DP.current_year(self.league))[0].id
        for writer in MD.PANEL:
            picks = {p["playerId"]: p["slot"] for p in MD.mock(self.league, writer)}
            self.assertIn(best, picks, writer.id)
            self.assertLessEqual(picks[best], 20, writer.id)


class TestTheConsensusIsASummary(unittest.TestCase):

    def setUp(self):
        self.league = league()

    def test_it_is_ordered_by_average_slot(self):
        rows = MD.consensus(self.league)
        averages = [row["average"] for row in rows]
        self.assertEqual(averages, sorted(averages))

    def test_high_and_low_bracket_the_average(self):
        for row in MD.consensus(self.league):
            self.assertLessEqual(row["high"], row["average"])
            self.assertGreaterEqual(row["low"], row["average"])

    def test_nobody_appears_on_more_boards_than_there_are_writers(self):
        for row in MD.consensus(self.league):
            self.assertLessEqual(row["boards"], len(MD.PANEL))
            self.assertGreaterEqual(row["boards"], 1)

    def test_the_splits_are_the_widest_disagreements(self):
        splits = MD.disagreements(self.league)
        self.assertTrue(splits)
        spans = [row["low"] - row["high"] for row in splits]
        self.assertEqual(spans, sorted(spans, reverse=True))
        self.assertGreater(spans[0], 0, "the panel agrees about everybody")


class TestTheWritersWriteHonestly(unittest.TestCase):

    def setUp(self):
        self.league = league()

    def test_every_writer_files_a_piece(self):
        for writer in MD.PANEL:
            note = MD.note_for(self.league, writer, MD.mock(self.league, writer))
            self.assertIsNotNone(note, writer.id)
            self.assertEqual(len(note["body"]), 3, writer.id)

    def test_every_numeral_printed_was_recorded(self):
        """The same audit `tests/test_news.py` runs: a story may not print a
        figure that did not pass through `Copy`."""
        import re
        for writer in MD.PANEL:
            note = MD.note_for(self.league, writer, MD.mock(self.league, writer))
            allowed = set(note["figures"])
            for paragraph in note["body"]:
                for number in re.findall(r"\d+(?:\.\d+)?", paragraph):
                    self.assertIn(number, allowed,
                                  f"{writer.id} printed {number} unrecorded")

    def test_the_caveat_is_always_there(self):
        """A thirty-pick mock of a draft that fills retirement holes has to say
        so, every edition, or it is quietly overstating itself."""
        for writer in MD.PANEL:
            note = MD.note_for(self.league, writer, MD.mock(self.league, writer))
            self.assertIn("retirement", note["body"][2])

    def test_a_writer_with_no_picks_files_nothing(self):
        self.assertIsNone(MD.note_for(self.league, MD.PANEL[0], []))


class TestTheOrderFollowsOwnership(unittest.TestCase):

    def test_it_is_reverse_standings(self):
        lg = league()
        worst_first = DP.standings_order(lg)
        rows = MD.order(lg)
        self.assertEqual([r["slot"] for r in rows], list(range(1, len(rows) + 1)))
        for row in rows:
            self.assertIsNotNone(row["teamId"])
        # With nothing traded, the order is exactly the standings order.
        self.assertEqual([r["teamId"] for r in rows], worst_first[:len(rows)])

    def test_a_traded_pick_shows_its_new_owner(self):
        """A mock that ignored ownership would show a club picking with an
        asset it sold."""
        lg = league()
        year = DP.current_year(lg)
        pick = next(p for p in DP.ensure(lg) if p.year == year and p.round == 1
                    and p.original_team == DP.standings_order(lg)[0])
        original, buyer = pick.owner, DP.standings_order(lg)[-1]
        pick.owner = buyer
        try:
            top = MD.order(lg)[0]
            self.assertEqual(top["teamId"], buyer)
            self.assertEqual(top["viaTeamId"], original)
        finally:
            pick.owner = original


class TestThePreviewChangesNothing(unittest.TestCase):
    """The entire safety case for showing the OFFSEASON menu mid-season.

    `franchise.begin` ticks every contract down and is meant to run exactly
    once. A screen that could trigger it by being looked at would age a league
    behind the manager's back.
    """

    def fingerprint(self, lg):
        return [
            (p.id, p.age, round(p.ability.current, 4),
             getattr(getattr(p, "contract", None), "years_remaining", None))
            for team in lg.teams.values() for p in team.players
        ]

    def test_reading_the_preview_does_not_age_anybody(self):
        lg = league()
        before = self.fingerprint(lg)
        payload.offseason_preview(lg)
        payload.offseason_preview(lg)
        self.assertEqual(self.fingerprint(lg), before)

    def test_the_whole_view_does_not_open_a_summer(self):
        lg = league()
        before = self.fingerprint(lg)
        view = payload.offseason_view(lg)
        self.assertFalse(view["available"], "fixture already has a champion")
        self.assertEqual(self.fingerprint(lg), before)

    def test_the_preview_is_there_even_with_no_summer(self):
        view = payload.offseason_view(league())
        self.assertIn("preview", view)
        self.assertIn("mock", view["preview"])
        self.assertTrue(view["preview"]["mock"]["boards"])

    def test_projected_free_agents_are_the_last_year_of_a_deal(self):
        """`collect_expiring` reads `contract.expired`, which is only true
        after the summer ticks contracts down -- so during a season it
        correctly returns nobody, and a preview built on it is an empty page."""
        lg = league()
        during, _coaches = franchise.collect_expiring(lg)
        projected, _ = franchise.projected_expiring(lg)
        self.assertEqual(during, [], "contracts have already been ticked down")
        self.assertTrue(projected)
        holders = {e.holder_id for e in projected}
        for team in lg.teams.values():
            for player in team.players:
                contract = getattr(player, "contract", None)
                if contract is None:
                    continue
                self.assertEqual(player.id in holders,
                                 contract.years_remaining <= 1, player.id)

    def test_the_retirement_watch_is_ordered_by_risk(self):
        rows = franchise.retirement_watch(league())
        self.assertTrue(rows)
        risks = [row["risk"] for row in rows]
        self.assertEqual(risks, sorted(risks, reverse=True))

    def test_the_watch_and_the_decision_read_one_function(self):
        """Extracted from `_should_retire` so the screen and the summer cannot
        drift apart."""
        from bballsim import progression
        lg = league()
        for team in lg.teams.values():
            for player in team.players:
                risk = progression.retirement_risk(player)
                self.assertGreaterEqual(risk, 0.0, player.id)
                self.assertLessEqual(risk, 1.0, player.id)
                if player.age >= progression.HARD_RETIREMENT_AGE:
                    self.assertEqual(risk, 1.0, player.id)


class TestTheEditionShape(unittest.TestCase):

    def setUp(self):
        self.edition = MD.edition(league())

    def test_it_carries_both_dates(self):
        published = datetime.fromisoformat(self.edition["publishedAt"])
        upcoming = datetime.fromisoformat(self.edition["nextAt"])
        self.assertLess(published, upcoming)
        self.assertIn(published.weekday(), MD.PUBLISH_WEEKDAYS)

    def test_it_carries_a_board_per_writer(self):
        self.assertEqual(len(self.edition["boards"]), len(MD.PANEL))
        for entry in self.edition["boards"]:
            self.assertIn("writer", entry)
            self.assertIn("picks", entry)
            self.assertIn("note", entry)

    def test_the_class_label_matches_the_pick_pricing(self):
        year = self.edition["year"]
        self.assertEqual(self.edition["classLabel"], DP.class_label(year))

    def test_the_unfilled_caveat_is_in_the_payload(self):
        self.assertIn("retirement", self.edition["note"])
        self.assertIn(str(MD.MOCK_PICKS), self.edition["note"])

    def test_it_is_json_serialisable(self):
        import json
        json.dumps(self.edition)


if __name__ == "__main__":
    unittest.main()
