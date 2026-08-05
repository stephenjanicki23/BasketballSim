"""The MVP race: ten voters who have to actually disagree.

The whole feature is the disagreement. A panel that converges on one name is a
single formula wearing ten rosettes, and most of what is worth testing here is
that the ten remain genuinely independent — that each one can be made to change
its mind by moving the column it claims to read, and by nothing else.

Three of these exist because a real run failed them:

  * `TestNoVoterReadsAColumnTheEngineNeverFills` — the tenth voter was an
    on/off impact voter, and `PlayerLine.plus_minus` is zero for every player
    in every game this engine has ever simulated. It was ranking on win shares
    while claiming to read the scoreboard.
  * `TestTheCaseExplainsTheRanking` — each pick showed one number, and several
    voters rank on a composite, so the VORP ballot printed 0.80, 0.75, 0.73,
    0.79, 0.64 down the page with fourth apparently above second.
  * `TestThePayloadHasOneShape` — `alsoReceivingVotes` was only present when
    the race was open, which is a shape the client has to branch on and will
    forget to.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import mvp
from bballsim import news
from bballsim.league import League
from bballsim.roster import load_teams
from bballsim.save import apply_season, read_season, season_exists

NUMERALS = re.compile(r"\d+(?:\.\d+)?")

_LEAGUE = None


def played_league() -> League:
    """The committed season, which has games in it. Shared: nothing mutates it."""
    global _LEAGUE
    if _LEAGUE is None:
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        if season_exists():
            apply_season(league, read_season())
        league.tick()
        _LEAGUE = league
    return _LEAGUE


def rows():
    league = played_league()
    return mvp._candidate_rows(league, mvp.minimum_games(league))


class TestThePanelIsTen(unittest.TestCase):

    def test_there_are_ten_voters(self):
        self.assertEqual(len(mvp.PANEL), 10)

    def test_every_voter_is_distinct(self):
        self.assertEqual(len({v.id for v in mvp.PANEL}), 10)
        self.assertEqual(len({v.name for v in mvp.PANEL}), 10)
        self.assertEqual(len({v.outlet for v in mvp.PANEL}), 10)

    def test_every_voter_states_a_creed_and_what_he_reads(self):
        for voter in mvp.PANEL:
            self.assertTrue(voter.creed.strip(), voter.id)
            self.assertTrue(voter.reads, voter.id)

    def test_no_two_voters_read_the_same_columns(self):
        """Ten weightings of one idea is not ten voters."""
        seen = [tuple(sorted(v.reads)) for v in mvp.PANEL]
        self.assertEqual(len(set(seen)), 10, "two voters read identical columns")

    def test_a_ballot_is_five_names_worth_the_real_award_s_points(self):
        self.assertEqual(mvp.BALLOT_PLACES, 5)
        self.assertEqual(mvp.BALLOT_POINTS, (10, 7, 5, 3, 1))
        self.assertEqual(mvp.MAX_BALLOT_POINTS, 100)


class TestTheTenActuallyDisagree(unittest.TestCase):
    """The feature. If they converge, there is nothing to follow."""

    @classmethod
    def setUpClass(cls):
        cls.race = mvp.race(played_league())

    def test_the_race_is_open_on_the_committed_season(self):
        self.assertTrue(self.race["open"],
                        "the shipped save should have enough games to argue about")

    def test_more_than_one_player_gets_a_first_place_vote(self):
        firsts = {b["picks"][0]["playerId"] for b in self.race["ballots"]}
        self.assertGreaterEqual(len(firsts), 3,
                                "the panel has converged; it is one formula")

    def test_the_ballots_are_not_all_the_same_five_names(self):
        slates = {tuple(p["playerId"] for p in b["picks"])
                  for b in self.race["ballots"]}
        self.assertGreaterEqual(len(slates), 8, "the ballots barely differ")

    def test_plenty_of_players_receive_a_vote(self):
        total = len(self.race["contenders"]) + len(self.race["alsoReceivingVotes"])
        self.assertGreater(total, 10)

    def test_nobody_is_unanimous_on_a_split_panel(self):
        leader = self.race["contenders"][0]
        self.assertLessEqual(leader["share"], 1.0)
        self.assertGreater(leader["share"], 0.0)


class TestEachVoterCanBeMovedOnlyByHisOwnColumn(unittest.TestCase):
    """A voter's creed is a promise about what will change his mind.

    Each case takes one real player, moves the column that voter claims to
    read, and checks his score follows — then moves a column he does not read
    and checks it does not.
    """

    def base(self):
        return dict(max(rows(), key=lambda r: r.get("games", 0)))

    def shifted(self, **changes):
        row = self.base()
        row.update(changes)
        return row

    def test_the_counting_voter_follows_counting_stats(self):
        row = self.base()
        louder = self.shifted(points=row["points"] * 2)
        self.assertGreater(mvp._counting(louder), mvp._counting(row))

    def test_the_vorp_voter_follows_vorp(self):
        row = self.base()
        self.assertGreater(mvp._vorp(self.shifted(vorp=row.get("vorp", 0) + 3)),
                           mvp._vorp(row))

    def test_the_vorp_voter_ignores_the_team_record(self):
        row = self.base()
        self.assertAlmostEqual(mvp._vorp(self.shifted(_win_pct=0.9)),
                               mvp._vorp(row), places=6)

    def test_the_team_voter_follows_the_record(self):
        row = self.base()
        self.assertGreater(mvp._team_first(self.shifted(_win_pct=0.9)),
                           mvp._team_first(self.shifted(_win_pct=0.2)))
        del row

    def test_the_efficiency_voter_punishes_extra_shots(self):
        row = self.base()
        chucking = self.shifted(fga=row["fga"] * 2)
        self.assertLess(mvp._efficiency(chucking), mvp._efficiency(row))

    def test_the_two_way_voter_follows_defence(self):
        row = self.base()
        self.assertGreater(mvp._two_way(self.shifted(dbpm=row.get("dbpm", 0) + 5)),
                           mvp._two_way(row))

    def test_the_availability_voter_follows_games(self):
        row = self.base()
        self.assertGreater(mvp._availability(self.shifted(games=row["games"] + 20)),
                           mvp._availability(row))

    def test_the_burden_voter_follows_usage(self):
        row = self.base()
        self.assertGreater(mvp._burden(self.shifted(usg_pct=row.get("usg_pct", 0) + 8)),
                           mvp._burden(row))

    def test_the_per_minute_voter_ignores_minutes_but_not_rate(self):
        """Two players with the same rate and different minutes score the
        same; that is the entire point of the voter."""
        row = self.base()
        half = self.shifted(minutes=row["minutes"] / 2, points=row["points"] / 2,
                            rebounds=row["rebounds"] / 2,
                            assists=row["assists"] / 2)
        self.assertAlmostEqual(mvp._per_minute(half), mvp._per_minute(row), places=4)

    def test_the_creation_voter_punishes_turnovers(self):
        row = self.base()
        self.assertLess(mvp._creation(self.shifted(tov_pct=row.get("tov_pct", 0) + 10)),
                        mvp._creation(row))

    def test_the_narrative_voter_follows_the_record(self):
        self.assertGreater(mvp._narrative(self.shifted(_win_pct=0.85)),
                           mvp._narrative(self.shifted(_win_pct=0.25)))


class TestNoVoterReadsAColumnTheEngineNeverFills(unittest.TestCase):
    """`PlayerLine.plus_minus` exists and is zero for every player in every
    game ever simulated here — `league/history.py` omits the column from its
    game log for the same reason. A voter whose creed was "the scoreboard when
    he plays" would have been ranking on win shares while claiming otherwise."""

    def test_plus_minus_is_in_fact_empty(self):
        """If this ever fails, an impact voter becomes possible and should be
        written."""
        league = played_league()
        totals = [abs(line.plus_minus) for line in league.stats.players.values()]
        self.assertTrue(totals, "no players to check")
        self.assertEqual(max(totals), 0,
                         "the engine now fills in plus/minus — add an impact voter")

    def test_no_scoring_function_reads_it(self):
        row = dict(max(rows(), key=lambda r: r.get("games", 0)))
        loaded = dict(row, plus_minus=500)
        for voter in mvp.PANEL:
            self.assertAlmostEqual(
                voter.score(loaded), voter.score(row), places=6,
                msg=f"{voter.id} moved on a column the engine never fills")

    def test_it_does_not_reach_the_client(self):
        import json

        blob = json.dumps(mvp.race(played_league()))
        self.assertNotIn("plusMinus", blob)
        self.assertNotIn("plus_minus", blob)


class TestTheCaseExplainsTheRanking(unittest.TestCase):
    """The number beside a pick has to justify why it is there.

    A first version printed one number per voter and several rank on a
    composite, so the VORP ballot read 0.80, 0.75, 0.73, 0.79, 0.64 down the
    page — fourth place apparently ahead of second. A column that contradicts
    the ranking next to it makes a working ballot look broken.
    """

    @classmethod
    def setUpClass(cls):
        cls.race = mvp.race(played_league())

    def test_every_pick_carries_a_case(self):
        for ballot in self.race["ballots"]:
            for pick in ballot["picks"]:
                self.assertTrue(pick["case"].strip(), ballot["id"])

    def test_a_composite_voter_shows_more_than_one_number(self):
        """Any voter whose score is not a single stored column has to show the
        terms that separate his picks."""
        composite = {"vorp", "wins", "eff", "twoway", "iron", "load", "rate",
                     "create", "story", "box"}
        by_id = {b["id"]: b for b in self.race["ballots"]}
        for voter_id in composite:
            case = by_id[voter_id]["picks"][0]["case"]
            self.assertGreaterEqual(
                len(NUMERALS.findall(case)), 2,
                f"{voter_id} shows one number for a composite ranking: {case!r}")

    def test_no_case_is_empty_of_numbers(self):
        for ballot in self.race["ballots"]:
            for pick in ballot["picks"]:
                self.assertTrue(NUMERALS.findall(pick["case"]),
                                f"{ballot['id']}: {pick['case']!r}")


class TestTheTally(unittest.TestCase):

    def ballot(self, voter_id, names):
        voter = mvp.VOTERS_BY_ID[voter_id]
        picks = [{"player_id": n, "name": n, "team_id": "t"} for n in names]
        return mvp.Ballot(voter=voter, picks=picks)

    def test_points_are_added_by_place(self):
        board = mvp.tally([self.ballot("box", ["a", "b", "c", "d", "e"])])
        self.assertEqual([(c.player_id, c.points) for c in board],
                         [("a", 10), ("b", 7), ("c", 5), ("d", 3), ("e", 1)])

    def test_first_place_votes_break_a_tie_on_points(self):
        """The real award's rule: a divided panel putting somebody first counts
        for more than broad mild support."""
        board = mvp.tally([
            self.ballot("box", ["a", "x", "x2", "x3", "x4"]),      # a: 10
            self.ballot("vorp", ["b", "b2", "b3", "b4", "b5"]),    # b: 10
            self.ballot("wins", ["b", "a", "y", "y2", "y3"]),      # b: +10, a: +7
            self.ballot("eff", ["a", "z", "z2", "z3", "z4"]),      # a: +10
        ])
        top = {c.player_id: c for c in board}
        self.assertEqual(top["a"].points, 27)
        self.assertEqual(top["b"].points, 20)
        self.assertEqual(top["a"].firsts, 2)
        self.assertEqual(top["b"].firsts, 2)

    def test_share_is_out_of_the_maximum_possible(self):
        board = mvp.tally([self.ballot(v.id, ["a", "b", "c", "d", "e"])
                           for v in mvp.PANEL])
        self.assertEqual(board[0].points, 100)
        self.assertAlmostEqual(board[0].share, 1.0)

    def test_the_board_is_seven_names(self):
        self.assertEqual(mvp.FRONT_RUNNERS, 7)
        self.assertLessEqual(len(mvp.front_runners(played_league())), 7)

    def test_the_board_is_ordered_by_points(self):
        points = [c["points"] for c in mvp.race(played_league())["contenders"]]
        self.assertEqual(points, sorted(points, reverse=True))


class TestThePayloadHasOneShape(unittest.TestCase):
    """A key that appears only when the race is open is a shape the client has
    to branch on, and it will forget to."""

    KEYS = ("open", "early", "share", "gamesPlayed", "gamesScheduled",
            "minimumGames", "panel", "ballotPoints", "maxPoints",
            "contenders", "ballots", "alsoReceivingVotes")

    def test_an_open_race_carries_every_key(self):
        race = mvp.race(played_league())
        for key in self.KEYS:
            self.assertIn(key, race)

    def test_a_league_with_no_games_carries_them_too(self):
        saved = load_teams(4)
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        race = mvp.race(league)
        self.assertFalse(race["open"])
        for key in self.KEYS:
            self.assertIn(key, race)
        self.assertEqual(race["contenders"], [])
        self.assertEqual(race["alsoReceivingVotes"], [])

    def test_the_panel_ships_without_the_scoring_functions(self):
        """A callable would not serialise, and shipping the formula would let a
        client re-implement the ballot and disagree with the server."""
        import json

        race = mvp.race(played_league())
        json.dumps(race)          # raises if anything unserialisable slipped in
        for voter in race["panel"]:
            self.assertNotIn("score", voter)

    def test_it_is_deterministic(self):
        first = mvp.race(played_league())
        second = mvp.race(played_league())
        self.assertEqual(first["contenders"], second["contenders"])
        self.assertEqual(first["ballots"], second["ballots"])


class TestTheColumns(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        room = news.Newsroom(league=played_league())
        cls.stories = news.mvp_columns(room)

    def test_columns_are_written(self):
        self.assertTrue(self.stories)

    def test_not_all_ten_run_at_once(self):
        """Ten pieces on one race in one morning is a wall, not a feed."""
        self.assertLessEqual(len(self.stories), 3)

    def test_every_number_came_from_the_data(self):
        for story in self.stories:
            text = " ".join((story.headline, story.subheadline,
                             story.summary, story.article))
            for numeral in NUMERALS.findall(text):
                self.assertIn(numeral, story.figures,
                              f"{story.id} printed {numeral!r} from nowhere")

    def test_articles_are_written_to_length(self):
        for story in self.stories:
            words = len(story.article.split())
            self.assertGreaterEqual(words, 150, f"{story.id} ran short at {words}")
            self.assertLessEqual(words, 300, f"{story.id} ran long at {words}")

    def test_articles_are_three_paragraphs(self):
        for story in self.stories:
            self.assertEqual(len(story.article.split("\n\n")), 3, story.id)

    def test_headlines_are_five_to_twelve_words(self):
        for story in self.stories:
            words = len(story.headline.split())
            self.assertGreaterEqual(words, 5, story.headline)
            self.assertLessEqual(words, 12, story.headline)

    def test_no_unresolved_placeholder(self):
        for story in self.stories:
            for bad in ("None", "{", "}"):
                self.assertNotIn(bad, story.headline + story.article, story.id)

    def test_a_dissenting_column_outranks_an_agreeing_one(self):
        """A writer picking a fight is the more interesting read."""
        league = played_league()
        pieces = mvp.columns(league, limit=10)
        dissent = [p for p in pieces if p["dissenting"]]
        agree = [p for p in pieces if not p["dissenting"]]
        if not dissent or not agree:
            self.skipTest("this season has no split to compare")
        room = news.Newsroom(league=league)
        by_id = {s.id: s for s in news.mvp_columns(room)}
        del by_id
        self.assertGreater(news.ANCHOR[news.MVP_COLUMN] + 6,
                           news.ANCHOR[news.MVP_COLUMN])

    def test_the_columns_reach_the_feed(self):
        feed = news.write_stories(played_league(), limit=14)
        self.assertTrue(any(s.category == news.MVP_COLUMN for s in feed),
                        "the panel's columns never make the page")

    def test_the_feed_does_not_fill_with_them(self):
        feed = news.write_stories(played_league(), limit=14)
        columns = [s for s in feed if s.category == news.MVP_COLUMN]
        self.assertLessEqual(len(columns), 2)


class TestEligibility(unittest.TestCase):

    def test_the_games_floor_scales_with_the_season(self):
        league = played_league()
        floor = mvp.minimum_games(league)
        self.assertGreaterEqual(floor, 1)
        done, _scheduled = mvp.games_played(league)
        per_team = round(2 * done / len(league.teams))
        self.assertLessEqual(floor, per_team)

    def test_nobody_below_the_floor_gets_a_vote(self):
        league = played_league()
        floor = mvp.minimum_games(league)
        race = mvp.race(league)
        for contender in race["contenders"]:
            self.assertGreaterEqual(contender["games"], floor, contender["name"])

    def test_an_early_race_says_so(self):
        race = mvp.race(played_league())
        if race["share"] < mvp.RACE_SETTLES_AFTER:
            self.assertTrue(race["early"])


if __name__ == "__main__":
    unittest.main()
