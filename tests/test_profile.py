"""Portraits and accolades: the two things a player page leads with.

Both are **derived**. A portrait is a function of the player id; an honours
list is a function of the archives. Neither is stored, so neither can drift
from what actually happened.

Two tests exist because getting them wrong would be invisible rather than
loud:

  * `TestAppearanceIsNotReadFromNationality` -- the deliberate design decision
    in `portraits.py`, pinned so it cannot be "improved" into a stereotype
    generator by somebody who thinks correlating the two would look better.
  * `TestHonoursAreEarned` -- an accolade that appeared without being won
    would be a participation ribbon, and nobody would notice for a long time.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import accolades, portraits
from bballsim.api import payload
from bballsim.league import offseason
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_CACHE: dict[tuple, League] = {}


def rolled(summers: int = 2) -> League:
    """A league with real history behind it, on its own short calendar.

    Six-game seasons: this file is testing whether an honour is awarded to the
    right man, not whether an 82-game season is realistic, and three full
    seasons of 1,230 games apiece is four minutes of nothing.
    """
    key = ("rolled", summers)
    if key in _CACHE:
        return _CACHE[key]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=6, season=league.season))
    for _ in range(summers):
        offseason.play_out(league)
        offseason.roll_summer(league)
    offseason.play_out(league)
    _CACHE[key] = league
    return league


def squad(league):
    return [(team, player) for team in league.teams.values()
            for player in team.players]


class TestEveryPlayerHasAFace(unittest.TestCase):

    def setUp(self):
        self.saved = load_teams()
        self.team = self.saved.teams[0]

    def test_a_portrait_is_the_same_every_time(self):
        player = self.team.players[0]
        self.assertEqual(portraits.features(player, self.team),
                         portraits.features(player, self.team))

    def test_two_players_do_not_share_a_face(self):
        faces = [tuple(sorted(portraits.features(p, t).items()))
                 for t in self.saved.teams for p in t.players]
        # Not all distinct -- with a dozen features some collisions are
        # expected -- but nothing like a handful of stamped-out templates.
        self.assertGreater(len(set(faces)) / len(faces), 0.9)

    def test_every_field_the_drawing_needs_is_present(self):
        face = portraits.features(self.team.players[0], self.team)
        for key in ("skin", "hair", "style", "beard", "brow", "eyes", "jaw",
                    "nose", "headband", "kit", "trim"):
            self.assertIn(key, face)

    def test_the_cut_is_one_the_front_end_can_draw(self):
        for team in self.saved.teams:
            for player in team.players:
                face = portraits.features(player, team)
                self.assertIn(face["style"], dict(portraits.STYLES))
                self.assertIn(face["beard"], portraits.BEARDS)

    def test_the_kit_comes_from_the_club(self):
        """A squad should read as a squad, and a traded player should visibly
        change shirt."""
        first, second = self.saved.teams[0], self.saved.teams[1]
        player = first.players[0]
        self.assertNotEqual(portraits.features(player, first)["kit"],
                            portraits.features(player, second)["kit"])

    def test_a_portrait_survives_having_no_club(self):
        face = portraits.features(self.team.players[0], None)
        self.assertTrue(face["kit"])


class TestAppearanceIsNotReadFromNationality(unittest.TestCase):
    """The design decision in `portraits.py`, pinned.

    Code that reads a nationality and picks a skin tone encodes a claim about
    what people from a place look like. It is also *worse at the job*: a real
    squad is not sorted by passport, so correlating the two makes a league less
    varied than the thing it is imitating. Seeding on the player id is the
    whole mechanism, and this test exists so it stays that way.
    """

    def test_the_same_country_produces_many_different_faces(self):
        saved = load_teams()
        by_country: dict[str, set] = {}
        for team in saved.teams:
            for player in team.players:
                where = getattr(player.bio, "nationality", "") or ""
                face = portraits.features(player, team)
                by_country.setdefault(where, set()).add(face["skin"])
        biggest = max(by_country.items(), key=lambda kv: len(kv[1]))
        self.assertGreater(
            len(biggest[1]), 3,
            f"{biggest[0]} produces only {len(biggest[1])} skin tones")

    def test_the_league_uses_the_whole_palette(self):
        saved = load_teams()
        seen = {portraits.features(p, t)["skin"]
                for t in saved.teams for p in t.players}
        self.assertEqual(len(seen), len(portraits.SKIN))

    def test_nothing_about_the_name_reaches_the_face(self):
        """Renaming a player must not change how he looks -- if it does, the
        surname is feeding the drawing."""
        saved = load_teams()
        team = saved.teams[0]
        player = team.players[0]
        before = portraits.features(player, team)
        player.first_name, player.last_name = "Zzz", "Qqqqq"
        self.assertEqual(portraits.features(player, team), before)


class TestAgeIsAllowedToShow(unittest.TestCase):
    """The one thing about a player that *does* feed his picture, because it
    is a fact about a body rather than a claim about a group."""

    def test_grey_arrives_with_the_thirties(self):
        self.assertEqual(portraits._grey_share(24), 0.0)
        self.assertGreater(portraits._grey_share(34), 0.0)
        self.assertEqual(portraits._grey_share(45), 1.0)

    def test_an_old_league_is_greyer_than_a_young_one(self):
        saved = load_teams()
        team = saved.teams[0]
        greys = {portraits.GREY, portraits.SALT_AND_PEPPER}

        def share(age):
            for player in team.players:
                player.bio.age = age
            hits = 0
            for player in team.players:
                player.age = age
                if portraits.features(player, team)["hair"] in greys:
                    hits += 1
            return hits / len(team.players)

        self.assertGreater(share(38), share(21))


class TestHonoursAreEarned(unittest.TestCase):

    def setUp(self):
        self.league = rolled()

    def test_a_champion_played_for_the_club_that_won_it(self):
        """The whole basis of the ring badge: the archive records which club a
        player's totals belong to, and the champion is a club id."""
        by_id = {p.id: p for _t, p in squad(self.league)}
        for season in accolades.seasons_of(self.league):
            if not season.champion:
                continue
            won, _lost = accolades._champions(season)
            for pid in won:
                line = season.stats.players[pid]
                self.assertEqual(line.team_id, season.champion)
                self.assertGreater(line.games, 0, pid)

    def test_nobody_holds_an_honour_from_a_season_that_was_not_played(self):
        labels = {s.label for s in accolades.seasons_of(self.league)}
        for _team, player in squad(self.league):
            for award in accolades.for_player(self.league, player):
                for season in award["seasons"]:
                    self.assertIn(season, labels)

    def test_somebody_won_something(self):
        earned = [p for _t, p in squad(self.league)
                  if accolades.for_player(self.league, p)]
        self.assertTrue(earned, "a league with history awarded nothing")

    def test_most_players_have_an_empty_shelf(self):
        """A badge everybody has is decoration. Championships go to one roster
        a year, so most of a league should have nothing."""
        players = squad(self.league)
        earned = [p for _t, p in players
                  if accolades.for_player(self.league, p)]
        self.assertLess(len(earned) / len(players), 0.6)

    def test_an_mvp_is_also_an_all_league_pick(self):
        """He topped the ballot; he cannot be outside the top five of it. The
        two are one list, and `for_player` must not double-count him."""
        for _team, player in squad(self.league):
            awards = {a["id"]: a for a in accolades.for_player(self.league, player)}
            mvp_seasons = set(awards.get("mvp", {}).get("seasons", []))
            all_league = set(awards.get("all_league", {}).get("seasons", []))
            self.assertFalse(mvp_seasons & all_league,
                             f"{player.name} listed twice for one season")

    def test_a_repeated_honour_carries_every_season(self):
        for _team, player in squad(self.league):
            for award in accolades.for_player(self.league, player):
                if award["seasons"]:
                    self.assertEqual(award["count"], len(award["seasons"]))
                    self.assertEqual(len(set(award["seasons"])),
                                     len(award["seasons"]), award["label"])

    def test_a_record_badge_matches_the_record_book(self):
        """The badge and the book read one source, so they cannot disagree
        about who holds what."""
        from bballsim import records
        book = records.book(self.league)
        holders = set()
        for half in ("game", "season"):
            for section in book[half]["players"]:
                if section["marks"]:
                    holders.add(section["marks"][0]["holderId"])
        for _team, player in squad(self.league):
            has = any(a["id"] == "record"
                      for a in accolades.for_player(self.league, player))
            self.assertEqual(has, player.id in holders, player.name)

    def test_the_honours_are_the_same_twice(self):
        _team, player = squad(self.league)[0]
        self.assertEqual(accolades.for_player(self.league, player),
                         accolades.for_player(self.league, player))


class TestCareerTotals(unittest.TestCase):

    def test_they_add_up_the_seasons_actually_played(self):
        league = rolled()
        _team, player = squad(league)[0]
        totals = accolades.career_totals(league, player.id)
        expected = 0
        sources = [a.stats for a in league.history] + [league.stats]
        for stats in sources:
            line = stats.players.get(player.id)
            if line and line.games:
                expected += line.points
        self.assertEqual(totals["points"], expected)

    def test_a_player_who_never_played_has_nothing(self):
        league = rolled()
        totals = accolades.career_totals(league, "nobody-at-all")
        self.assertEqual(totals["games"], 0)
        self.assertEqual(totals["seasons"], 0)

    def test_a_milestone_needs_the_threshold(self):
        """Read straight off the table rather than trusting a league to reach
        one: six-game seasons never will, and a test that silently proved
        nothing would be worse than no test."""
        for key, label, threshold, stat in accolades.MILESTONES:
            self.assertGreater(threshold, 0, label)
            self.assertIn(stat, ("points", "rebounds", "assists", "tpm", "games"))


class TestTheTeamSubScreens(unittest.TestCase):
    """The two club-scoped screens under Teams.

    Both read data the squad payload already carries, so the interesting claim
    is that the *scoped* list agrees with the league-wide one. A per-club
    version written separately would answer "who is out of contract"
    differently from the Offseason screen the first time either was edited.
    """

    def setUp(self):
        self.league = rolled()
        self.team = next(iter(self.league.teams.values()))

    def test_a_club_list_is_the_league_list_filtered(self):
        from bballsim.league import franchise
        scoped, scoped_coaches = franchise.projected_expiring(
            self.league, self.team)
        everyone, all_coaches = franchise.projected_expiring(self.league)
        self.assertEqual(
            {e.holder_id for e in scoped},
            {e.holder_id for e in everyone if e.team_id == self.team.id})
        self.assertEqual(
            {e.holder_id for e in scoped_coaches},
            {e.holder_id for e in all_coaches if e.team_id == self.team.id})

    def test_every_club_scopes_correctly(self):
        """The loop variable used to shadow the parameter. It happened to work
        for a one-element list, and would have broken anything added under
        it."""
        from bballsim.league import franchise
        everyone, _ = franchise.projected_expiring(self.league)
        counted = 0
        for team in self.league.teams.values():
            scoped, _ = franchise.projected_expiring(self.league, team)
            for entry in scoped:
                self.assertEqual(entry.team_id, team.id)
            counted += len(scoped)
        self.assertEqual(counted, len(everyone))

    def test_the_squad_payload_carries_the_club_list(self):
        data = payload.team_squad(self.team, self.league)
        self.assertIn("expectedFreeAgents", data)
        for row in data["expectedFreeAgents"]:
            self.assertEqual(row["teamId"], self.team.id)
            for key in ("name", "requestedSalary", "requestedYears",
                        "interestLabel", "previousSalary"):
                self.assertIn(key, row)

    def test_only_last_year_deals_are_expected(self):
        data = payload.team_squad(self.team, self.league)
        listed = {row["id"] for row in data["expectedFreeAgents"]}
        for player in self.team.players:
            contract = getattr(player, "contract", None)
            if contract is None:
                continue
            self.assertEqual(player.id in listed,
                             contract.years_remaining <= 1, player.name)

    def test_the_injury_screen_reads_data_already_shipped(self):
        """No endpoint of its own: everything the availability screen shows is
        on `health`, which every squad row already carries."""
        data = payload.team_squad(self.team, self.league)
        for row in data["players"]:
            health = row["health"]
            for key in ("injury", "knock", "fatigue", "fatigueLabel",
                        "condition", "gamesMissed"):
                self.assertIn(key, health)

    def test_an_injury_says_how_long(self):
        """A screen that said "injured" without saying for how long would send
        a manager to the player page to find out, which is the thing it
        exists to save."""
        for team in self.league.teams.values():
            for row in payload.team_squad(team, self.league)["players"]:
                injury = row["health"].get("injury")
                if injury is None:
                    continue
                self.assertIn("name", injury)
                self.assertGreaterEqual(injury["gamesRemaining"], 0)
                self.assertGreater(injury["gamesTotal"], 0)


class TestThePayloadCarriesIt(unittest.TestCase):

    def test_a_squad_row_has_a_portrait_and_a_shelf(self):
        league = rolled()
        team = next(iter(league.teams.values()))
        data = payload.team_squad(team, league)
        for row in data["players"]:
            self.assertIn("portrait", row)
            self.assertIn("accolades", row)
            self.assertIn("career", row)

    def test_it_is_json_serialisable(self):
        import json
        league = rolled()
        team = next(iter(league.teams.values()))
        json.dumps(payload.team_squad(team, league))


if __name__ == "__main__":
    unittest.main()
