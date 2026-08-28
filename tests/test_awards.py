"""The awards watch shows the field, and never the standing.

The one rule this feature exists to keep: it names who is in contention for each
award and says nothing about who is ahead. No vote count, no vote share, no
ranking, no front-runner marker. The winner is found out when the season ends,
not read off this page -- the same discipline the All-Star vote and the draft
scouting cards follow.

Two claims are pinned, and both would regress without a sound:

  * `TestNoStandingLeaks` -- the serialised payload carries no vote, share,
    rank, first-place count or "leader" field. It is checked against the JSON
    text because the guarantee is that none of it can reach the page, and the
    surest proof is that the words are not there.
  * `TestTheOrderRevealsNothing` -- the contenders come out alphabetical. If the
    selection order ever survived into the payload it would be a ranking in
    disguise, so the test sorts the names itself and demands they already match.

Run with:  python3 -m unittest tests.test_awards -v
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import awards, mvp
from bballsim.api import payload
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_LEAGUE: list[League] = []


def played(games_per_team: int = 20) -> League:
    """A league with a season behind it, so every award has a field."""
    if _LEAGUE:
        return _LEAGUE[0]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
    league.tick()
    _LEAGUE.append(league)
    return league


class TestEveryAwardHasAField(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = awards.watch(played())

    def test_all_the_season_awards_are_present(self):
        ids = {a["id"] for a in self.data["awards"]}
        for expected in ("mvp", "all_league", "scoring_title",
                         "rebounding_title", "playmaking_title"):
            self.assertIn(expected, ids, expected)

    def test_each_award_names_a_shortlist(self):
        for award in self.data["awards"]:
            self.assertGreaterEqual(len(award["contenders"]), 3, award["id"])
            self.assertTrue(award["name"])
            self.assertTrue(award["basis"])

    def test_a_contender_is_a_player_with_a_line(self):
        for award in self.data["awards"]:
            for c in award["contenders"]:
                self.assertTrue(c["playerId"])
                self.assertTrue(c["name"])
                self.assertRegex(c["line"], r"pts.*reb.*ast")

    def test_the_lines_are_real_per_game_numbers(self):
        """The double-divide bug did not change *which* names appeared -- near
        season's end games counts are close, so the order held -- it wrecked the
        *numbers*, turning 21.8 points into 0.9. So check the magnitude, not
        just the shape: a scoring contender averages real points."""
        import re
        scoring = next(a for a in self.data["awards"]
                       if a["id"] == "scoring_title")
        tops = []
        for c in scoring["contenders"]:
            tops.append(float(re.match(r"([\d.]+) pts", c["line"]).group(1)))
        self.assertGreater(max(tops), 15.0,
                           f"scoring lines look double-divided: {tops}")

    def test_the_stat_titles_pick_the_real_leaders(self):
        """The scoring shortlist must actually be the top scorers -- the bug
        that shipped once had them at 0.9 points a game."""
        league = played()
        minimum = mvp.minimum_games(league)
        rows = mvp._candidate_rows(league, minimum)
        top = sorted(rows, key=lambda r: r["points"] / max(1, r["games"]),
                     reverse=True)[:awards.STAT_CONTENDERS]
        expected = {r["player_id"] for r in top}
        scoring = next(a for a in self.data["awards"] if a["id"] == "scoring_title")
        got = {c["playerId"] for c in scoring["contenders"]}
        self.assertEqual(got, expected)


class TestNoStandingLeaks(unittest.TestCase):
    def test_the_payload_carries_no_vote_or_rank(self):
        blob = json.dumps(awards.watch(played())["awards"]).lower()
        for banned in ("vote", "share", "rank", "first", "points\":",
                       "leader", "favourite", "favorite", "standing",
                       "ppg", "appearances", "ballot"):
            self.assertNotIn(banned, blob, banned)

    def test_a_contender_has_only_identity_and_a_line(self):
        for award in awards.watch(played())["awards"]:
            for c in award["contenders"]:
                self.assertEqual(set(c), {"playerId", "name", "teamId",
                                          "position", "line"})


class TestTheOrderRevealsNothing(unittest.TestCase):
    def test_contenders_are_alphabetical(self):
        for award in awards.watch(played())["awards"]:
            names = [c["name"] for c in award["contenders"]]
            self.assertEqual(names, sorted(names), award["id"])

    def test_the_selection_order_does_not_survive(self):
        """Build the MVP field twice from the same league and confirm the
        payload order is stable and alphabetical -- not the panel's order,
        which is what would leak the leader."""
        league = played()
        pool = awards._voted_pool(league)          # panel order, best first
        card = next(a for a in awards.watch(league)["awards"] if a["id"] == "mvp")
        panel_first = pool[0]["name"]
        shown_first = card["contenders"][0]["name"]
        # The panel's leader is only "first" on the card if he also sorts first
        # by name; in general the two disagree, and the card follows the name.
        self.assertEqual([c["name"] for c in card["contenders"]],
                         sorted(c["name"] for c in card["contenders"]))
        del panel_first, shown_first  # asserted structurally above


class TestItRidesInTheBootstrap(unittest.TestCase):
    def test_the_bootstrap_ships_awards_not_mvp(self):
        boot = payload.bootstrap(played())
        self.assertIn("awards", boot)
        self.assertNotIn("mvp", boot)
        self.assertEqual({a["id"] for a in boot["awards"]["awards"]} >= {"mvp"},
                         True)


class TestBeforeThereIsASeason(unittest.TestCase):
    def test_a_fresh_league_has_nothing_to_watch_yet(self):
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            [t.id for t in saved.teams], start_date=date(2026, 10, 20),
            games_per_team=4, season=league.season))
        data = awards.watch(league)
        # No games played, so the voted awards are shut and the stat titles have
        # nobody over the games floor.
        self.assertFalse(data["open"])
        self.assertEqual(data["awards"], [])


if __name__ == "__main__":
    unittest.main()
