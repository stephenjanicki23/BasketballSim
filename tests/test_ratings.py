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
from bballsim.ability import (
    Ability,
    Archetype,
    CA_MAX,
    CA_MIN,
    POSITION_ARCHETYPES,
    ca_tier,
    ca_to_scale,
    current_ability,
    develop,
    expected_headroom,
    generate_ratings,
    make_ability,
    scout,
    star_tier,
    stars,
)
from bballsim.biography import make_biography
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
        h = HiddenAttributes(injury_proneness=-3)
        self.assertEqual(h.injury_proneness, SCALE_MIN)

    def test_potential_ability_is_not_a_1_20_attribute(self):
        # PA lives on the 0-200 CA scale in ability.py, not among the 1-20s.
        self.assertNotIn("potential_ability", HiddenAttributes.attribute_names())
        self.assertNotIn("potential_ability", Ratings.attribute_names())

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

    def test_current_ability_is_position_aware(self):
        big = Ratings()
        for key in ("rim_protection", "defensive_rebounding", "interior_defense", "blocks"):
            setattr(big, key, 18.0)
        # The same attributes are worth more CA at centre than at point guard.
        self.assertGreater(current_ability(big, "C"), current_ability(big, "PG"))


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


class TestCurrentAndPotentialAbility(unittest.TestCase):
    """CA/PA on the 0-200 scale, and the invariant between them."""

    def setUp(self):
        self.rng = __import__("random").Random(11)

    # -- the hard rule -------------------------------------------------
    def test_ca_can_never_exceed_pa_on_construction(self):
        self.assertEqual(Ability(current=180, potential=120).current, 120)
        self.assertEqual(Ability(current=999, potential=999).current, CA_MAX)
        self.assertEqual(Ability(current=-40, potential=-40).current, CA_MIN)

    def test_ca_can_never_exceed_pa_via_set_current(self):
        ability = Ability(current=100, potential=140)
        ability.set_current(500)
        self.assertEqual(ability.current, 140)
        ability.set_current(-20)
        self.assertEqual(ability.current, CA_MIN)

    def test_ca_can_never_exceed_pa_through_a_round_trip(self):
        restored = Ability.from_dict({"current": 190, "potential": 130})
        self.assertLessEqual(restored.current, restored.potential)

    def test_ca_can_never_exceed_pa_through_development(self):
        # Hammer a young player with maximum development for many seasons.
        ability = Ability(current=90, potential=140)
        for age in range(18, 40):
            develop(self.rng, ability, age, 20.0, 20.0, 20.0, minutes_played=3000)
            self.assertLessEqual(ability.current, ability.potential)
        self.assertLessEqual(ability.current, 140.0)

    def test_every_generated_player_satisfies_the_rule(self):
        for team in make_teams(8):
            for player in team.players:
                self.assertLessEqual(player.ability.current, player.ability.potential)

    # -- CA is a budget, not a label -----------------------------------
    def test_generated_attributes_reproduce_the_target_ca(self):
        for target in (60.0, 100.0, 140.0, 180.0):
            for position in ("PG", "SG", "SF", "PF", "C"):
                archetype = self.rng.choice(POSITION_ARCHETYPES[position])
                ratings = generate_ratings(
                    self.rng, ca=target, position=position, archetype=archetype, age=25
                )
                self.assertAlmostEqual(
                    current_ability(ratings, position), target, delta=0.5,
                    msg=f"{position} {archetype.value} at CA {target}",
                )

    def test_stored_ca_matches_recomputed_ca_for_every_player(self):
        for team in make_teams(8):
            for player in team.players:
                self.assertAlmostEqual(
                    player.current_ability, player.ability.current, delta=0.5
                )

    def test_higher_ca_means_a_better_player(self):
        weak = generate_ratings(self.rng, 70, "SF", Archetype.THREE_AND_D_WING, 25)
        strong = generate_ratings(self.rng, 170, "SF", Archetype.THREE_AND_D_WING, 25)
        weak_mean = sum(weak.to_dict().values()) / len(weak.to_dict())
        strong_mean = sum(strong.to_dict().values()) / len(strong.to_dict())
        self.assertGreater(strong_mean, weak_mean + 3.0)

    # -- same CA, different players ------------------------------------
    def test_same_ca_different_archetype_gives_a_different_distribution(self):
        anchor = generate_ratings(self.rng, 150, "C", Archetype.DEFENSIVE_ANCHOR, 26)
        stretch = generate_ratings(self.rng, 150, "C", Archetype.STRETCH_BIG, 26)

        # Equally good...
        self.assertAlmostEqual(current_ability(anchor, "C"), current_ability(stretch, "C"), delta=0.5)
        # ...at completely different things.
        self.assertGreater(anchor.rim_protection, stretch.rim_protection + 2.0)
        self.assertGreater(stretch.three_point, anchor.three_point + 2.0)

    def test_same_ca_guard_archetypes_diverge_too(self):
        general = generate_ratings(self.rng, 145, "PG", Archetype.FLOOR_GENERAL, 26)
        scorer = generate_ratings(self.rng, 145, "PG", Archetype.SCORING_GUARD, 26)
        self.assertGreater(general.court_vision, scorer.court_vision + 1.5)
        self.assertGreater(scorer.pull_up_shooting, general.pull_up_shooting + 1.5)

    def test_archetypes_are_position_appropriate(self):
        for team in make_teams(4):
            for player in team.players:
                self.assertIn(player.archetype, POSITION_ARCHETYPES[player.position.value])

    # -- age -----------------------------------------------------------
    def test_age_shifts_the_distribution_not_the_total(self):
        young = generate_ratings(self.rng, 140, "SG", Archetype.SCORING_GUARD, 20)
        old = generate_ratings(self.rng, 140, "SG", Archetype.SCORING_GUARD, 34)
        # Same ability...
        self.assertAlmostEqual(current_ability(young, "SG"), current_ability(old, "SG"), delta=0.5)
        # ...but the young man carries it in his legs and the veteran in his head.
        self.assertGreater(young.speed + young.quickness, old.speed + old.quickness)
        self.assertGreater(old.decision_making + old.defensive_iq,
                           young.decision_making + young.defensive_iq)

    def test_young_players_get_headroom_and_old_players_do_not(self):
        young = [make_ability(self.rng, 110, 19).headroom for _ in range(60)]
        old = [make_ability(self.rng, 110, 34).headroom for _ in range(60)]
        self.assertGreater(sum(young) / len(young), sum(old) / len(old) + 15)

    # -- development ---------------------------------------------------
    def test_young_players_grow_and_old_players_decline(self):
        def total_change(age: int) -> float:
            change = 0.0
            for _ in range(40):
                ability = Ability(current=110, potential=170)
                change += develop(self.rng, ability, age, 12.0, 12.0, 12.0)
            return change / 40

        self.assertGreater(total_change(20), 0.0)
        self.assertGreater(total_change(20), total_change(26))
        self.assertLess(total_change(34), 0.0)

    def test_a_player_at_his_ceiling_cannot_grow(self):
        ability = Ability(current=150, potential=150)
        change = develop(self.rng, ability, 21, 20.0, 20.0, 20.0)
        self.assertAlmostEqual(change, 0.0, places=6)
        self.assertEqual(ability.current, 150)

    def test_professionalism_and_work_rate_speed_development(self):
        def grown(quality: float) -> float:
            total = 0.0
            for _ in range(40):
                ability = Ability(current=100, potential=180)
                total += develop(self.rng, ability, 21, quality, quality, quality)
            return total / 40

        self.assertGreater(grown(18.0), grown(4.0))

    # -- scouting ------------------------------------------------------
    def test_scouting_brackets_the_truth_and_narrows_with_accuracy(self):
        ability = Ability(current=120, potential=165)
        vague = scout(ability, age=20, accuracy=0.2)
        sharp = scout(ability, age=20, accuracy=0.95)

        for report in (vague, sharp):
            self.assertLessEqual(report.current_low, ability.current)
            self.assertGreaterEqual(report.current_high, ability.current)
            self.assertLessEqual(report.potential_low, ability.potential)
            self.assertGreaterEqual(report.potential_high, ability.potential)

        vague_width = vague.potential_high - vague.potential_low
        sharp_width = sharp.potential_high - sharp.potential_low
        self.assertGreater(vague_width, sharp_width)

    def test_potential_is_harder_to_judge_than_current_ability(self):
        report = scout(Ability(current=120, potential=165), age=19, accuracy=0.5)
        self.assertGreater(
            report.potential_high - report.potential_low,
            report.current_high - report.current_low,
        )

    def test_scout_flags_prospects(self):
        prospect = scout(Ability(current=100, potential=175), age=20, accuracy=0.8)
        veteran = scout(Ability(current=140, potential=140), age=33, accuracy=0.8)
        self.assertEqual(prospect.verdict, "Elite prospect")
        self.assertEqual(veteran.verdict, "Past his peak")

    # -- display -------------------------------------------------------
    def test_ca_maps_onto_the_1_20_scale(self):
        self.assertAlmostEqual(ca_to_scale(0), SCALE_MIN)
        self.assertAlmostEqual(ca_to_scale(CA_MAX), SCALE_MAX)

    def test_ca_tiers_are_ordered(self):
        self.assertEqual(ca_tier(190), "Generational")
        self.assertEqual(ca_tier(150), "All-Star")
        self.assertEqual(ca_tier(100), "Rotation player")
        self.assertEqual(ca_tier(10), "Amateur")


class TestStarRating(unittest.TestCase):
    """The headline number a manager sees: 0.5 to 5 stars."""

    def test_ten_tiers_map_onto_ten_half_star_steps(self):
        values = sorted({stars(ca) for ca in range(0, 201)})
        self.assertEqual(values, [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0])

    def test_stars_never_decrease_as_ca_rises(self):
        previous = 0.0
        for ca in range(0, 201):
            value = stars(ca)
            self.assertGreaterEqual(value, previous)
            previous = value

    def test_star_ends_of_the_scale(self):
        self.assertEqual(stars(200), 5.0)
        self.assertEqual(stars(0), 0.5)

    def test_star_tier_round_trips_with_the_ca_tier(self):
        for ca in (195, 170, 150, 133, 118, 100, 85, 65, 45, 20):
            self.assertEqual(star_tier(stars(ca)), ca_tier(ca))

    def test_potential_stars_are_never_below_current_stars(self):
        for team in make_teams(8):
            for player in team.players:
                self.assertGreaterEqual(player.potential_stars, player.stars)

    def test_every_player_lands_on_a_valid_half_star(self):
        for team in make_teams(4):
            for player in team.players:
                self.assertIn(player.stars * 2, range(1, 11))


class TestBiography(unittest.TestCase):
    SEASON = 2026

    @classmethod
    def setUpClass(cls):
        cls.players = [p for team in make_teams(8, season_start_year=cls.SEASON)
                       for p in team.players]

    def test_every_player_has_a_full_biography(self):
        for player in self.players:
            bio = player.bio
            self.assertTrue(bio.nationality)
            self.assertTrue(bio.background)
            self.assertIn(bio.background_type, {"College", "International", "Prep"})
            self.assertIsNotNone(bio.draft)

    # -- the rule the user asked for: gap shrinks as age rises ---------
    def test_bigger_ca_pa_gap_means_a_younger_player(self):
        ages = [p.age for p in self.players]
        gaps = [p.ability.headroom for p in self.players]
        mean_age = sum(ages) / len(ages)
        mean_gap = sum(gaps) / len(gaps)
        covariance = sum((a - mean_age) * (g - mean_gap) for a, g in zip(ages, gaps))
        age_var = sum((a - mean_age) ** 2 for a in ages) ** 0.5
        gap_var = sum((g - mean_gap) ** 2 for g in gaps) ** 0.5
        correlation = covariance / (age_var * gap_var)
        # Strongly negative: older players are closer to their ceiling.
        self.assertLess(correlation, -0.6, f"age/headroom correlation {correlation:.2f}")

    def test_the_biggest_gaps_belong_to_the_youngest_players(self):
        by_gap = sorted(self.players, key=lambda p: -p.ability.headroom)
        top_ten = by_gap[:10]
        bottom_ten = by_gap[-10:]
        self.assertLess(
            sum(p.age for p in top_ten) / 10,
            sum(p.age for p in bottom_ten) / 10,
        )

    def test_expected_headroom_falls_monotonically_with_age(self):
        previous = float("inf")
        for age in range(18, 40):
            value = expected_headroom(age)
            self.assertLessEqual(value, previous)
            previous = value

    def test_veterans_are_essentially_at_their_ceiling(self):
        veterans = [p for p in self.players if p.age >= 30]
        self.assertTrue(veterans)
        for player in veterans:
            self.assertLess(player.ability.headroom, 8.0)

    # -- the rule the user asked for: draft class fits the age ---------
    def test_draft_class_is_consistent_with_age(self):
        for player in self.players:
            years_pro = self.SEASON - player.bio.draft.year
            self.assertGreaterEqual(years_pro, 0, "nobody is drafted in the future")
            age_at_draft = player.age - years_pro
            self.assertGreaterEqual(age_at_draft, 18, player.name)
            self.assertLessEqual(age_at_draft, 23, player.name)

    def test_a_rookie_belongs_to_the_current_class(self):
        rng = __import__("random").Random(3)
        for _ in range(50):
            bio = make_biography(rng, age=19, season_start_year=self.SEASON,
                                 potential_ability=150.0)
            self.assertEqual(bio.draft.year, self.SEASON)

    def test_older_players_belong_to_older_classes(self):
        young = [p.bio.draft.year for p in self.players if p.age <= 22]
        old = [p.bio.draft.year for p in self.players if p.age >= 31]
        self.assertTrue(young and old)
        self.assertGreater(sum(young) / len(young), sum(old) / len(old) + 5)

    # -- draft position ------------------------------------------------
    def test_draft_position_tracks_potential_not_current_ability(self):
        drafted = [p for p in self.players if not p.bio.draft.undrafted]
        early = [p for p in drafted if p.bio.draft.pick <= 4]
        late = [p for p in drafted if p.bio.draft.pick >= 12]
        self.assertTrue(early and late)
        self.assertGreater(
            sum(p.ability.potential for p in early) / len(early),
            sum(p.ability.potential for p in late) / len(late),
        )

    def test_undrafted_players_still_have_a_class_year(self):
        undrafted = [p for p in self.players if p.bio.draft.undrafted]
        for player in undrafted:
            self.assertIsNotNone(player.bio.draft.year)
            self.assertIsNone(player.bio.draft.pick)
            self.assertIn("Undrafted", player.bio.draft.label)

    # -- physicals -----------------------------------------------------
    def test_bigs_are_taller_than_guards(self):
        guards = [p.height_inches for p in self.players if p.position.value in ("PG", "SG")]
        bigs = [p.height_inches for p in self.players if p.position.value in ("PF", "C")]
        self.assertGreater(sum(bigs) / len(bigs), sum(guards) / len(guards) + 4)

    def test_heights_and_weights_are_plausible(self):
        for player in self.players:
            self.assertGreaterEqual(player.height_inches, 68)
            self.assertLessEqual(player.height_inches, 90)
            self.assertGreaterEqual(player.weight_lbs, 150)
            self.assertLessEqual(player.weight_lbs, 330)
            self.assertRegex(player.height, r"^\d'\d{1,2}\"$")

    def test_taller_players_weigh_more(self):
        tall = [p.weight_lbs for p in self.players if p.height_inches >= 82]
        short = [p.weight_lbs for p in self.players if p.height_inches <= 75]
        self.assertGreater(sum(tall) / len(tall), sum(short) / len(short))

    # -- nationality ---------------------------------------------------
    def test_the_league_is_mostly_but_not_entirely_american(self):
        american = sum(1 for p in self.players if p.bio.nationality == "United States")
        share = american / len(self.players)
        self.assertGreater(share, 0.5)
        self.assertLess(share, 0.95)

    def test_international_backgrounds_do_not_repeat_the_country(self):
        for player in self.players:
            if player.bio.background_type != "International":
                continue
            country = player.bio.nationality
            self.assertLessEqual(
                player.bio.background.count(country), 1, player.bio.background
            )


class TestLeagueComposition(unittest.TestCase):
    """A 30-team league, and the positional spread of its best players."""

    @classmethod
    def setUpClass(cls):
        cls.teams = make_teams(30)
        cls.players = [p for team in cls.teams for p in team.players]

    def test_thirty_teams_with_unique_identities(self):
        self.assertEqual(len(self.teams), 30)
        self.assertEqual(len({t.abbreviation for t in self.teams}), 30)
        self.assertEqual(len({t.full_name for t in self.teams}), 30)
        self.assertEqual(len({t.id for t in self.teams}), 30)

    def test_every_player_in_the_league_has_a_unique_name(self):
        self.assertEqual(len(self.players), 360)
        self.assertEqual(len({p.name for p in self.players}), 360)
        # Short names drive the play-by-play, so those must be unique too.
        self.assertEqual(len({p.short_name for p in self.players}), 360)

    def test_the_best_player_is_not_always_a_point_guard(self):
        """The bug this replaced: the CA ladder was zipped against a fixed
        position order, so slot 0 -- the franchise player -- was a PG on every
        single team."""
        best_positions = [
            max(team.players, key=lambda p: p.ability.current).position.value
            for team in self.teams
        ]
        distinct = set(best_positions)
        self.assertGreaterEqual(len(distinct), 4, f"only {distinct} lead a team")
        # And no single position should dominate.
        for position in distinct:
            share = best_positions.count(position) / len(best_positions)
            self.assertLess(share, 0.45, f"{position} leads {share:.0%} of teams")

    def test_every_starting_five_covers_every_position(self):
        for team in self.teams:
            positions = {p.position.value for p in team.starters()}
            self.assertEqual(positions, {"PG", "SG", "SF", "PF", "C"}, team.abbreviation)

    def test_the_depth_chart_leads_with_the_best_starter(self):
        for team in self.teams:
            starters = team.starters()
            self.assertEqual(
                starters[0].ability.current,
                max(p.ability.current for p in starters),
                team.abbreviation,
            )

    def test_the_league_follows_the_tier_pyramid(self):
        """More rotation players than All-Stars, more All-Stars than
        generational talents -- the shape of the rating table."""
        counts = {}
        for player in self.players:
            counts[player.stars] = counts.get(player.stars, 0) + 1

        elite = sum(n for star, n in counts.items() if star >= 4.5)
        all_star = sum(n for star, n in counts.items() if star == 4.0)
        rotation = sum(n for star, n in counts.items() if 2.0 <= star <= 3.0)

        self.assertGreater(rotation, all_star)
        self.assertGreater(all_star, elite)
        self.assertGreater(elite, 0, "a 30-team league should have some elite talent")

    def test_every_team_has_a_full_roster(self):
        for team in self.teams:
            self.assertEqual(len(team.players), 12, team.abbreviation)
            self.assertEqual(len(team.depth_chart), 12, team.abbreviation)

    def test_pace_stays_inside_a_believable_band(self):
        """Scheme and slider used to compound without limit -- a seven-seconds
        team with pace at 70 ran 129 possessions a game."""
        results = [
            GameSimulator(f"pace-{i}", copy.deepcopy(self.teams[i]),
                          copy.deepcopy(self.teams[29 - i]), seed=f"pace-{i}").simulate()
            for i in range(12)
        ]
        for result in results:
            for box in (result.home_box, result.away_box):
                self.assertGreater(box.possessions, 78)
                self.assertLess(box.possessions, 125)
