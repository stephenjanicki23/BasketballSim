"""The awards watch: seven honours, and never a standing.

The rule the feature keeps: it names who is in contention for each award and
says nothing about who is ahead. No vote, no share, no ranking number, no
front-runner marker. Who wins is found out when the season ends.

The team awards -- All-League, All-Defensive, All-Rookie -- are a first and a
second team, one player at each position, which is the shape the honour takes.
The first/second split is the award's structure, not a vote, and the tests
below pin the structure without letting a number sneak in behind it:

  * every team has one player per position and none twice across the two teams;
  * the rookie teams are made of actual rookies;
  * the sixth-man field is made of actual reserves;
  * the payload carries no vote, share, rank, ballot or advanced-stat column.

Run with:  python3 -m unittest tests.test_awards -v
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import awards, mvp
from bballsim.api import payload
from bballsim.lineup import POSITIONS
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_LEAGUE: list[League] = []


def played(games_per_team: int = 24) -> League:
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


def award(data, award_id):
    return next((a for a in data["awards"] if a["id"] == award_id), None)


class TestTheSlate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = awards.watch(played())

    def test_all_seven_honours_are_present(self):
        ids = {a["id"] for a in self.data["awards"]}
        for expected in ("mvp", "all_league", "all_defense", "all_rookie",
                         "sixth_man", "scoring_title", "coach"):
            self.assertIn(expected, ids, expected)

    def test_the_dropped_titles_are_gone(self):
        ids = {a["id"] for a in self.data["awards"]}
        self.assertNotIn("rebounding_title", ids)
        self.assertNotIn("playmaking_title", ids)

    def test_the_two_award_kinds_are_shaped_right(self):
        for a in self.data["awards"]:
            if a["format"] == "teams":
                self.assertIn("teams", a)
                self.assertNotIn("contenders", a)
            else:
                self.assertIn("contenders", a)
                self.assertNotIn("teams", a)


class TestTheTeams(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = awards.watch(played())

    def _team_awards(self):
        return [a for a in self.data["awards"] if a["format"] == "teams"]

    def test_a_team_is_one_player_per_position(self):
        for a in self._team_awards():
            for team in a["teams"]:
                positions = [p["position"] for p in team["players"]]
                # No position appears twice, and every named slot is a real one.
                self.assertEqual(len(positions), len(set(positions)),
                                 f"{a['id']} {team['tier']}")
                for p in positions:
                    self.assertIn(p, POSITIONS)

    def test_the_first_team_is_full(self):
        """The first team of every award should have all five positions -- the
        league is deep enough that only a thin rookie class leaves a gap, and
        even then only on the second team."""
        for a in self._team_awards():
            first = a["teams"][0]
            if a["id"] != "all_rookie":
                self.assertEqual(len(first["players"]), len(POSITIONS), a["id"])

    def test_nobody_is_on_both_teams_of_one_award(self):
        for a in self._team_awards():
            ids = [p["playerId"] for team in a["teams"] for p in team["players"]]
            self.assertEqual(len(ids), len(set(ids)), a["id"])

    def test_the_first_team_outranks_the_second_without_saying_so(self):
        """The split has to mean something -- the first team is the better five
        -- even though no number on the page says it. Checked here against the
        value score the module used, which never reaches the payload."""
        league = played()
        rows = {r["player_id"]: r for r in mvp._candidate_rows(
            league, mvp.minimum_games(league))}
        card = award(awards.watch(league), "all_league")
        first = {p["position"]: p["playerId"] for p in card["teams"][0]["players"]}
        second = {p["position"]: p["playerId"] for p in card["teams"][1]["players"]}
        for position, second_id in second.items():
            first_id = first.get(position)
            if first_id and first_id in rows and second_id in rows:
                self.assertGreaterEqual(awards._value(rows[first_id]),
                                        awards._value(rows[second_id]),
                                        position)


class TestRookiesAreRookies(unittest.TestCase):
    def test_every_all_rookie_name_is_a_rookie(self):
        league = played()
        rookies = awards._rookie_ids(league)
        self.assertTrue(rookies, "the fixture produced no rookies to check")
        card = award(awards.watch(league), "all_rookie")
        for team in card["teams"]:
            for p in team["players"]:
                self.assertIn(p["playerId"], rookies, p["name"])


class TestSixthMenAreReserves(unittest.TestCase):
    def test_no_sixth_man_is_among_his_club_top_five_minutes(self):
        league = played()
        rows = mvp._candidate_rows(league, mvp.minimum_games(league))
        by_club: dict[str, list[dict]] = {}
        for r in rows:
            by_club.setdefault(r["team_id"], []).append(r)
        starters = set()
        for club in by_club.values():
            club.sort(key=lambda r: r.get("minutes", 0), reverse=True)
            starters.update(r["player_id"] for r in club[:awards.STARTERS_PER_CLUB])
        card = award(awards.watch(league), "sixth_man")
        for c in card["contenders"]:
            self.assertNotIn(c["playerId"], starters, c["name"])


class TestCoachOfTheYear(unittest.TestCase):
    def test_the_field_is_coaches_with_a_record_line(self):
        card = award(awards.watch(played()), "coach")
        self.assertTrue(card["contenders"])
        for c in card["contenders"]:
            self.assertRegex(c["line"], r"^\d+-\d+$")
            self.assertEqual(c["position"], "")


class TestNoStandingLeaks(unittest.TestCase):
    def test_the_payload_carries_no_vote_or_advanced_column(self):
        data = awards.watch(played())
        keys = set()
        for a in data["awards"]:
            for c in a.get("contenders", []):
                keys |= set(c)
            for team in a.get("teams", []):
                for p in team["players"]:
                    keys |= set(p)
        # A row is identity and one line, nothing that ranks it.
        self.assertEqual(keys, {"playerId", "name", "teamId", "position", "line"})

    def test_the_scoring_lines_are_real_per_game_numbers(self):
        card = award(awards.watch(played()), "scoring_title")
        tops = [float(re.match(r"([\d.]+) pts", c["line"]).group(1))
                for c in card["contenders"]]
        self.assertGreater(max(tops), 15.0, tops)

    def test_list_contenders_are_alphabetical(self):
        for a in awards.watch(played())["awards"]:
            if a["format"] == "list":
                names = [c["name"] for c in a["contenders"]]
                self.assertEqual(names, sorted(names), a["id"])


class TestItRidesInTheBootstrap(unittest.TestCase):
    def test_the_bootstrap_ships_awards_not_mvp(self):
        boot = payload.bootstrap(played())
        self.assertIn("awards", boot)
        self.assertNotIn("mvp", boot)


class TestBeforeThereIsASeason(unittest.TestCase):
    def test_a_fresh_league_has_nothing_to_watch(self):
        saved = load_teams()
        league = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            [t.id for t in saved.teams], start_date=date(2026, 10, 20),
            games_per_team=4, season=league.season))
        data = awards.watch(league)
        self.assertFalse(data["open"])
        self.assertEqual(data["awards"], [])


if __name__ == "__main__":
    unittest.main()
