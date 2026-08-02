"""Tests for the attribute system and the composites built on top of it.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import copy
import sys
import unittest
from dataclasses import fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import composites as C
from bballsim.engine.game import GameSimulator
from bballsim.engine.possession import PossessionEngine
from bballsim.engine.rng import SimRandom
from bballsim.models import Lineup, Player, Position
from bballsim.placeholder import make_teams
from bballsim.ratings import (
    ATTRIBUTE_GROUPS,
    ATTRIBUTE_LABELS,
    HiddenAttributes,
    LEAGUE_AVERAGE,
    Ratings,
    SCALE_MAX,
    SCALE_MIN,
    Tendencies,
    advantage,
    normalize,
    overall,
    personality_label,
    tier_label,
    to_display,
)

ALL_COMPOSITES = [
    C.shooting_rim, C.shooting_paint, C.shooting_mid, C.shooting_corner_three,
    C.shooting_above_break_three, C.free_throw, C.shot_creation, C.shot_quality,
    C.off_ball_gravity, C.spacing, C.playmaking, C.ball_security,
    C.interior_defense, C.perimeter_defense, C.pick_and_roll_defense,
    C.help_defense, C.steal_threat, C.block_threat, C.contest_quality,
    C.offensive_rebounding, C.defensive_rebounding, C.foul_avoidance,
    C.foul_drawing, C.endurance, C.transition_threat, C.clutch,
]


class TestAttributeSchema(unittest.TestCase):
    def test_every_attribute_belongs_to_a_group(self):
        grouped = {key for keys in ATTRIBUTE_GROUPS.values() for key in keys}
        self.assertEqual(set(Ratings.attribute_names()), grouped)

    def test_every_attribute_has_a_short_label(self):
        missing = set(Ratings.attribute_names()) - set(ATTRIBUTE_LABELS)
        self.assertEqual(missing, set())

    def test_group_keys_all_exist_on_ratings(self):
        known = set(Ratings.attribute_names())
        for group, keys in ATTRIBUTE_GROUPS.items():
            for key in keys:
                self.assertIn(key, known, f"{group} references unknown attribute {key}")

    def test_shared_attributes_appear_in_two_groups(self):
        # decision_making and defensive_rebounding are deliberately displayed
        # under two headings while remaining one stored value.
        for key in ("decision_making", "defensive_rebounding"):
            groups = [g for g, keys in ATTRIBUTE_GROUPS.items() if key in keys]
            self.assertEqual(len(groups), 2, f"{key} should show under two groups, got {groups}")

    def test_visible_and_hidden_do_not_overlap(self):
        overlap = set(Ratings.attribute_names()) & set(HiddenAttributes.attribute_names())
        self.assertEqual(overlap, set())

    def test_values_are_clamped_to_the_scale(self):
        r = Ratings(three_point=500, layups=-40)
        self.assertEqual(r.three_point, SCALE_MAX)
        self.assertEqual(r.layups, SCALE_MIN)
        h = HiddenAttributes(potential_ability=500, injury_proneness=-3)
        self.assertEqual(h.potential_ability, SCALE_MAX)
        self.assertEqual(h.injury_proneness, SCALE_MIN)

    def test_round_trips_through_dict(self):
        original = make_teams(1)[0].players[0]
        self.assertEqual(Ratings.from_dict(original.ratings.to_dict()), original.ratings)
        self.assertEqual(
            HiddenAttributes.from_dict(original.hidden.to_dict()), original.hidden
        )

    def test_normalize_and_advantage(self):
        self.assertAlmostEqual(normalize(LEAGUE_AVERAGE), 0.0)
        self.assertAlmostEqual(normalize(SCALE_MAX), 1.0)
        self.assertAlmostEqual(advantage(15.0, LEAGUE_AVERAGE), 0.5)

    def test_scale_is_one_to_twenty(self):
        self.assertEqual((SCALE_MIN, LEAGUE_AVERAGE, SCALE_MAX), (1.0, 10.0, 20.0))

    def test_tier_labels_cover_the_whole_scale(self):
        self.assertEqual(tier_label(20), "Generational")
        self.assertEqual(tier_label(16.5), "All-Star")
        self.assertEqual(tier_label(12), "Average starter")
        self.assertEqual(tier_label(10), "Rotation player")
        self.assertEqual(tier_label(2), "Amateur")
        for value in range(1, 21):
            self.assertTrue(tier_label(value))

    def test_display_scale_conversion(self):
        self.assertEqual(to_display(14.4), 14)
        self.assertEqual(to_display(10.0, scale=100), 50)
        self.assertEqual(to_display(SCALE_MAX, scale=100), 100)


class TestComposites(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.players = [p for team in make_teams(4) for p in team.players]

    def test_every_composite_stays_on_the_rating_scale(self):
        for composite in ALL_COMPOSITES:
            for player in self.players:
                value = composite(player)
                self.assertGreaterEqual(value, SCALE_MIN, composite.__name__)
                self.assertLessEqual(value, SCALE_MAX, composite.__name__)

    def test_composites_only_reference_real_attributes(self):
        # A typo in a blend would raise here rather than silently reading 50.
        blank = Player(id="x", first_name="Test", last_name="Player")
        for composite in ALL_COMPOSITES:
            self.assertAlmostEqual(composite(blank), LEAGUE_AVERAGE, places=6, msg=composite.__name__)

    def test_composites_respond_to_their_inputs(self):
        low = Player(id="low", first_name="Low", last_name="Rim")
        high = copy.deepcopy(low)
        for key in ("layups", "close_shot", "dunking", "finishing_through_contact"):
            setattr(high.ratings, key, 19.0)
        self.assertGreater(C.shooting_rim(high), C.shooting_rim(low))
        # ...and only to their inputs: rim finishing is not a three-point skill.
        self.assertAlmostEqual(C.shooting_corner_three(high), C.shooting_corner_three(low))

    def test_zone_lookup_covers_every_shot_zone(self):
        from bballsim.engine.events import ShotZone
        for zone in ShotZone:
            self.assertIn(zone.value, C.SHOOTING_BY_ZONE)

    def test_overall_is_position_aware(self):
        big = Player(id="c", first_name="Big", last_name="Man", position=Position.C)
        for key in ("rim_protection", "defensive_rebounding", "interior_defense", "blocks"):
            setattr(big.ratings, key, 18.0)
        self.assertGreater(overall(big.ratings, "C"), overall(big.ratings, "PG"))


class TestPersonality(unittest.TestCase):
    def test_label_is_derived_not_stored(self):
        self.assertNotIn("personality", Ratings.attribute_names())
        self.assertNotIn("personality", HiddenAttributes.attribute_names())

    def test_model_professional_and_volatile_are_distinguishable(self):
        ratings = Ratings(competitive_drive=18)
        pro = HiddenAttributes(professionalism=18, ambition=14, temperament=16)
        volatile = HiddenAttributes(professionalism=8, ambition=17, temperament=4)
        self.assertEqual(personality_label(ratings, pro), "Model Professional")
        self.assertEqual(personality_label(ratings, volatile), "Volatile")

    def test_every_placeholder_player_gets_a_label(self):
        for team in make_teams(4):
            for player in team.players:
                self.assertTrue(player.personality)


class TestHiddenAttributesDriveTheSim(unittest.TestCase):
    def test_consistency_controls_the_nightly_form_roll(self):
        """The mechanism, tested directly.

        At game level the effect is deliberately modest -- a lineup averages
        five independent form rolls, so it moves a team score by a couple of
        points against a baseline standard deviation near 11. Asserting on
        final scores would need thousands of games to clear that noise, so the
        assertion lives where the effect actually is.
        """
        engine = PossessionEngine(SimRandom(seed="form"))

        def form_spread(consistency: float) -> float:
            players = []
            for i in range(400):
                player = Player(id=f"p{i}", first_name="Test", last_name=f"Player{i}")
                player.hidden.consistency = consistency
                players.append(player)
            engine.set_form(players)
            values = [engine.form[p.id] for p in players]
            mean = sum(values) / len(values)
            return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5

        erratic = form_spread(5.0)
        metronome = form_spread(95.0)
        self.assertGreater(erratic, metronome * 2.0)

    def test_form_is_applied_on_top_of_the_composite(self):
        engine = PossessionEngine(SimRandom(seed="applied"))
        player = Player(id="p", first_name="Test", last_name="Player")
        self.assertAlmostEqual(engine._skill(player, C.shooting_rim), C.shooting_rim(player))
        engine.form["p"] = 7.5
        self.assertAlmostEqual(
            engine._skill(player, C.shooting_rim), C.shooting_rim(player) + 7.5
        )

    def test_big_game_performance_only_matters_in_crunch_time(self):
        """Clutch attributes are inert until the last two minutes of a close game."""
        engine = PossessionEngine(SimRandom(seed="clutch"))
        teams = make_teams(2)
        game = GameSimulator("clutch", teams[0], teams[1], seed="clutch")
        state = game._initial_state()
        player = teams[0].players[0]

        state.period, state.clock = 1, 600.0
        self.assertEqual(engine._clutch_edge(state, player), 0.0)

        state.period, state.clock = 4, 30.0     # tied game, half a minute left
        self.assertNotEqual(engine._clutch_edge(state, player), 0.0)

    def test_hidden_attributes_are_not_in_the_public_player_dict(self):
        player = make_teams(1)[0].players[0]
        self.assertNotIn("hidden", player.to_dict())
        self.assertIn("hidden", player.scouted_dict())


class TestRatingsDriveOutcomes(unittest.TestCase):
    """Every comparison here is *paired*: both arms run the same seeds, so the
    difference measured is the attribute change and not the dice. An unpaired
    8-game sample has a standard error near 5 points and proves nothing.

    `apply` also asserts the attribute exists -- setting a misspelled field on
    a dataclass silently succeeds and would make these assertions vacuous.
    """

    GAMES = 24

    def apply(self, team, keys, value: float) -> None:
        known = set(Ratings.attribute_names())
        for key in keys:
            self.assertIn(key, known, f"unknown attribute {key}")
            for player in team.players:
                setattr(player.ratings, key, value)

    def paired(self, strong, weak, opponent, read):
        """Run both teams against the same opponent on the same seeds."""
        strong_total = weak_total = 0
        for i in range(self.GAMES):
            seed = f"paired-{i}"
            strong_total += read(GameSimulator(
                seed, copy.deepcopy(strong), copy.deepcopy(opponent), seed=seed).simulate())
            weak_total += read(GameSimulator(
                seed, copy.deepcopy(weak), copy.deepcopy(opponent), seed=seed).simulate())
        return strong_total / self.GAMES, weak_total / self.GAMES

    def test_better_shooters_score_more(self):
        good, opponent = make_teams(2)
        bad = copy.deepcopy(good)
        # Everything that feeds a shooting composite, and nothing else -- the
        # athletic inputs stay put so this measures shot-making alone.
        shooting = (
            "close_shot", "layups", "dunking", "finishing_through_contact",
            "euro_step", "floater", "post_moves", "post_footwork", "post_hook",
            "mid_range", "fadeaway", "three_point", "catch_and_shoot",
            "pull_up_shooting", "off_ball_shooting",
        )
        self.apply(good, shooting, 17.0)
        self.apply(bad, shooting, 5.0)

        good_points, bad_points = self.paired(good, bad, opponent, lambda r: r.home_score)
        self.assertGreater(good_points, bad_points + 15)

    def test_rim_protection_suppresses_opponent_scoring(self):
        anchored, weak = make_teams(2)
        soft = copy.deepcopy(anchored)
        rim = ("rim_protection", "interior_defense", "blocks", "post_defense",
               "help_defense", "defensive_iq")
        self.apply(anchored, rim, 18.0)
        self.apply(soft, rim, 4.0)

        strong_allowed, soft_allowed = self.paired(
            anchored, soft, weak, lambda r: r.away_score
        )
        self.assertLess(strong_allowed, soft_allowed - 4)

    def test_ball_security_reduces_turnovers(self):
        secure, opponent = make_teams(2)
        loose = copy.deepcopy(secure)
        keys = ("ball_handling", "dribbling", "decision_making", "composure", "focus")
        self.apply(secure, keys, 18.0)
        self.apply(loose, keys, 4.0)

        secure_tov, loose_tov = self.paired(
            secure, loose, opponent, lambda r: r.home_box.total("turnovers")
        )
        self.assertLess(secure_tov, loose_tov)

    def test_shooting_and_defence_are_separable(self):
        """Boosting defence must not quietly boost offence, or the composites
        are leaking into each other."""
        base, opponent = make_teams(2)
        defensive = copy.deepcopy(base)
        self.apply(defensive, ("perimeter_defense", "interior_defense",
                               "shot_contest", "rim_protection"), 19.0)

        scored_def, scored_base = self.paired(
            defensive, base, opponent, lambda r: r.home_score
        )
        self.assertLess(abs(scored_def - scored_base), 6.0)

    def test_all_round_better_team_wins_almost_always(self):
        strong, weak = make_teams(2)
        every = Ratings.attribute_names()
        self.apply(strong, every, 17.0)
        self.apply(weak, every, 5.0)

        wins = sum(
            1 for i in range(20)
            if GameSimulator(f"gap{i}", copy.deepcopy(strong), copy.deepcopy(weak),
                             seed=f"gap{i}").simulate().home_score
            > GameSimulator(f"gap{i}", copy.deepcopy(strong), copy.deepcopy(weak),
                            seed=f"gap{i}").simulate().away_score
        )
        self.assertEqual(wins, 20)


if __name__ == "__main__":
    unittest.main()
