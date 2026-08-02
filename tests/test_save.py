"""Saving and loading a league.

The point of a save file is that the people in it stop changing, so most of
these tests are about *fidelity*: every stored value has to survive the trip to
disk and back, and the committed league has to still be the league it was.

A spot check would not do. `test_every_stored_field_survives` walks the
dataclass fields rather than naming attributes by hand, so adding an attribute
to Ratings without teaching `save.py` about it fails here instead of silently
resetting that attribute to its default for all 360 players.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from dataclasses import fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.ability import Archetype
from bballsim.biography import DraftInfo
from bballsim.coach import CoachRatings
from bballsim.engine.game import GameSimulator
from bballsim.models import Position
from bballsim.placeholder import make_teams
from bballsim.ratings import HiddenAttributes, Ratings, Tendencies
from bballsim.roster import load_teams
from bballsim.save import (
    LEAGUE_PATH,
    SAVE_VERSION,
    dump_league,
    dump_team,
    fingerprint,
    league_exists,
    load_league,
    read_league,
    write_league,
)

# The league on disk. If this changes, every player and coach in the game has
# been replaced -- which is exactly what the save file exists to prevent. Only
# update it deliberately, alongside a regenerated data/league.json.
COMMITTED_FINGERPRINT = "3b29f0c12cb24b64"


def round_trip(teams):
    return load_league(json.loads(json.dumps(dump_league(
        teams, name="Test League", season="2026-27"
    )))).teams


class TestRoundTrip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = make_teams(4)
        cls.restored = round_trip(cls.original)

    def test_the_shape_of_the_league_survives(self):
        self.assertEqual(len(self.restored), len(self.original))
        for before, after in zip(self.original, self.restored):
            self.assertEqual(after.id, before.id)
            self.assertEqual(after.abbreviation, before.abbreviation)
            self.assertEqual(after.full_name, before.full_name)
            self.assertEqual(len(after.players), len(before.players))

    def test_every_stored_field_survives(self):
        """Walk the dataclasses instead of naming fields, so a new attribute
        that `save.py` does not know about fails here."""
        groups = (
            ("ratings", Ratings),
            ("tendencies", Tendencies),
            ("hidden", HiddenAttributes),
        )
        for before_team, after_team in zip(self.original, self.restored):
            for before, after in zip(before_team.players, after_team.players):
                for attr, cls in groups:
                    for f in fields(cls):
                        self.assertAlmostEqual(
                            getattr(getattr(after, attr), f.name),
                            getattr(getattr(before, attr), f.name),
                            places=3,
                            msg=f"{before.name}.{attr}.{f.name}",
                        )

    def test_identity_and_physicals_survive(self):
        for before_team, after_team in zip(self.original, self.restored):
            for before, after in zip(before_team.players, after_team.players):
                self.assertEqual(after.first_name, before.first_name)
                self.assertEqual(after.last_name, before.last_name)
                self.assertEqual(after.position, before.position)
                self.assertEqual(after.age, before.age)
                self.assertEqual(after.height_inches, before.height_inches)
                self.assertEqual(after.weight_lbs, before.weight_lbs)
                self.assertEqual(after.jersey, before.jersey)
                self.assertEqual(after.archetype, before.archetype)

    def test_ability_survives_and_keeps_the_hard_rule(self):
        for before_team, after_team in zip(self.original, self.restored):
            for before, after in zip(before_team.players, after_team.players):
                self.assertAlmostEqual(
                    after.ability.current, before.ability.current, places=3)
                self.assertAlmostEqual(
                    after.ability.potential, before.ability.potential, places=3)
                self.assertLessEqual(after.ability.current, after.ability.potential)

    def test_biography_and_draft_survive(self):
        drafted = 0
        for before_team, after_team in zip(self.original, self.restored):
            for before, after in zip(before_team.players, after_team.players):
                self.assertEqual(after.bio.nationality, before.bio.nationality)
                self.assertEqual(after.bio.background, before.bio.background)
                self.assertEqual(after.bio.background_type, before.bio.background_type)
                if before.bio.draft is None:
                    self.assertIsNone(after.bio.draft)
                    continue
                drafted += 1
                self.assertEqual(after.bio.draft.year, before.bio.draft.year)
                self.assertEqual(after.bio.draft.round, before.bio.draft.round)
                self.assertEqual(after.bio.draft.pick, before.bio.draft.pick)
                self.assertEqual(after.bio.draft.label, before.bio.draft.label)
        self.assertGreater(drafted, 0, "no drafted players -- the test proved nothing")

    def test_an_undrafted_player_stays_undrafted(self):
        undrafted = DraftInfo(year=2021)
        self.assertTrue(undrafted.undrafted)
        restored = DraftInfo.from_dict(
            {"year": 2021, "round": None, "pick": None, "undrafted": True, "label": "x"}
        )
        self.assertTrue(restored.undrafted)
        self.assertEqual(restored.label, undrafted.label)

    def test_coaches_survive_with_all_seven_ratings(self):
        for before_team, after_team in zip(self.original, self.restored):
            self.assertIsNotNone(after_team.coach)
            for f in fields(CoachRatings):
                self.assertAlmostEqual(
                    getattr(after_team.coach.ratings, f.name),
                    getattr(before_team.coach.ratings, f.name),
                    places=3,
                    msg=f"{before_team.coach.name}.{f.name}",
                )
            self.assertEqual(after_team.coach.name, before_team.coach.name)
            self.assertEqual(after_team.coach.age, before_team.coach.age)
            self.assertEqual(after_team.coach.seasons_coached,
                             before_team.coach.seasons_coached)
            self.assertEqual(after_team.coach.tier, before_team.coach.tier)
            self.assertEqual(after_team.coach.specialism, before_team.coach.specialism)

    def test_tactics_survive_including_the_schemes(self):
        for before, after in zip(self.original, self.restored):
            self.assertEqual(after.tactics.offensive_scheme,
                             before.tactics.offensive_scheme)
            self.assertEqual(after.tactics.defensive_scheme,
                             before.tactics.defensive_scheme)
            self.assertEqual(after.tactics.aggression, before.tactics.aggression)
            self.assertAlmostEqual(after.tactics.pace, before.tactics.pace, places=3)

    def test_chemistry_survives_its_frozenset_keys(self):
        team = copy.deepcopy(self.original[0])
        ids = [p.id for p in team.players[:4]]
        team.pair_chemistry[frozenset((ids[0], ids[1]))] = 81.5
        team.pair_chemistry[frozenset((ids[2], ids[3]))] = 22.25
        team.team_chemistry = 63.5

        after = round_trip([team])[0]
        self.assertEqual(after.team_chemistry, 63.5)
        self.assertEqual(after.pair_chemistry[frozenset((ids[1], ids[0]))], 81.5)
        self.assertEqual(after.pair_chemistry[frozenset((ids[3], ids[2]))], 22.25)

    def test_derived_values_are_recomputed_not_stored(self):
        """Stars, tiers and personality are not in the file -- they come back
        from the attributes, so a save can never disagree with itself."""
        raw = dump_team(self.original[0])["players"][0]
        for derived in ("stars", "tier", "overall", "personality", "name",
                        "current_ability", "short_name"):
            self.assertNotIn(derived, raw, f"{derived} should be derived, not stored")

        for before_team, after_team in zip(self.original, self.restored):
            for before, after in zip(before_team.players, after_team.players):
                self.assertEqual(after.stars, before.stars, before.name)
                self.assertEqual(after.tier, before.tier, before.name)
                self.assertEqual(after.personality, before.personality, before.name)

    def test_depth_charts_and_starting_fives_survive(self):
        for before, after in zip(self.original, self.restored):
            self.assertEqual(after.depth_chart, before.depth_chart)
            self.assertEqual([p.id for p in after.starters()],
                             [p.id for p in before.starters()])

    def test_a_reloaded_league_simulates_identically(self):
        """The end of it: same teams, same seed, same game."""
        before = GameSimulator(
            "g", copy.deepcopy(self.original[0]), copy.deepcopy(self.original[1]), seed="g"
        ).simulate()
        after = GameSimulator(
            "g", copy.deepcopy(self.restored[0]), copy.deepcopy(self.restored[1]), seed="g"
        ).simulate()
        self.assertEqual(after.home_score, before.home_score)
        self.assertEqual(after.away_score, before.away_score)
        self.assertEqual([e.description for e in after.events],
                         [e.description for e in before.events])


class TestTheFileOnDisk(unittest.TestCase):
    def test_writing_and_reading_a_file(self):
        teams = make_teams(3)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "league.json"
            write_league(path, teams, name="Disk League", season="2030-31")
            self.assertTrue(league_exists(path))

            saved = read_league(path)
            self.assertEqual(saved.name, "Disk League")
            self.assertEqual(saved.season, "2030-31")
            self.assertEqual(len(saved.teams), 3)
            self.assertEqual(len(saved.players), sum(len(t.players) for t in teams))

    def test_re_saving_an_unchanged_league_is_byte_identical(self):
        """Rounding happens once, on the first write. After that a save is
        stable, so a diff on data/league.json always means something moved."""
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "a.json"
            second = Path(tmp) / "b.json"
            write_league(first, make_teams(3), name="L", season="S")
            write_league(second, read_league(first).teams, name="L", season="S")
            self.assertEqual(first.read_text(), second.read_text())

    def test_a_newer_file_version_is_refused_rather_than_guessed(self):
        with self.assertRaises(ValueError):
            load_league({"version": SAVE_VERSION + 1, "teams": []})

    def test_fingerprints_track_the_contents(self):
        teams = make_teams(2)
        self.assertEqual(fingerprint(teams), fingerprint(round_trip(teams)))

        changed = copy.deepcopy(teams)
        changed[0].players[0].ratings.three_point += 1.0
        self.assertNotEqual(fingerprint(teams), fingerprint(changed))


class TestTheCommittedLeague(unittest.TestCase):
    """The league everybody actually plays with."""

    @classmethod
    def setUpClass(cls):
        if not league_exists(LEAGUE_PATH):
            raise unittest.SkipTest(f"no league at {LEAGUE_PATH}")
        cls.saved = read_league(LEAGUE_PATH)

    def test_it_is_a_full_thirty_team_league(self):
        self.assertEqual(len(self.saved.teams), 30)
        self.assertEqual(len(self.saved.players), 360)
        self.assertEqual(len({t.id for t in self.saved.teams}), 30)
        self.assertEqual(len({p.id for p in self.saved.players}), 360)

    def test_every_team_has_a_coach(self):
        coaches = [t.coach for t in self.saved.teams]
        self.assertTrue(all(coaches))
        self.assertEqual(len({c.id for c in coaches}), 30)

    def test_the_players_have_not_changed(self):
        """The whole point. If this fails, somebody regenerated the league --
        either restore data/league.json or, if the change was deliberate,
        update COMMITTED_FINGERPRINT in the same commit."""
        self.assertEqual(
            fingerprint(self.saved.teams),
            COMMITTED_FINGERPRINT,
            "the committed league is not the league these tests were written against",
        )

    def test_the_saved_league_is_internally_sound(self):
        for team in self.saved.teams:
            for player in team.players:
                self.assertLessEqual(player.ability.current, player.ability.potential)
                self.assertIn(player.position, set(Position))
                self.assertIsInstance(player.archetype, Archetype)
                self.assertGreaterEqual(player.age, 18)
                self.assertTrue(player.bio.nationality)

    def test_loading_it_twice_gives_independent_copies(self):
        """Two callers must not share players, or one simulation's fatigue
        leaks into the next."""
        first = load_teams(2).teams
        second = load_teams(2).teams
        first[0].players[0].condition = 12.0
        self.assertEqual(second[0].players[0].condition, 100.0)
        self.assertEqual(first[0].players[0].id, second[0].players[0].id)

    def test_asking_for_more_teams_than_exist_says_so(self):
        with self.assertRaises(ValueError):
            load_teams(64)

    def test_a_trimmed_league_is_the_first_n_teams(self):
        self.assertEqual(
            [t.id for t in load_teams(4).teams],
            [t.id for t in self.saved.teams[:4]],
        )


if __name__ == "__main__":
    unittest.main()
