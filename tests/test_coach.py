"""Head coaches: the seven ratings, and the job each one does.

A coach who only decorated a team page would be worse than no coach at all,
so most of these tests are about *effect* -- they run games and look at what
changed. The comparisons are paired (both arms share seeds) because an
unpaired handful of games has a standard error near 5 points.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import copy
import random
import sys
import unittest
from dataclasses import fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.ability import Ability, develop
from bballsim.chemistry import drift_after_game
from bballsim.coach import (
    COACHING_SKILLS,
    COACH_AVERAGE,
    COACH_MAX,
    COACH_MIN,
    COACH_RATING_LABELS,
    Coach,
    CoachRatings,
    chemistry_multiplier,
    coach_edge,
    coach_tier,
    development_multiplier,
    make_coach,
    make_coaches,
    scouting_accuracy,
)
from bballsim.engine.game import GameSimulator
from bballsim.placeholder import make_teams


def coach_with(**ratings) -> Coach:
    """A coach who is average at everything except what the test names."""
    return Coach(
        id="c-test",
        first_name="Test",
        last_name="Coach",
        ratings=CoachRatings(**ratings),
    )


class TestCoachRatings(unittest.TestCase):
    """The seven numbers the user asked for, on the scale they asked for."""

    def test_the_seven_ratings_exist_and_are_the_only_ones(self):
        self.assertEqual(
            set(CoachRatings.attribute_names()),
            {
                "offense", "defense", "tactics", "development",
                "leadership", "talent_evaluation", "reputation",
            },
        )

    def test_every_rating_has_a_display_label(self):
        labelled = {key for key, _ in COACH_RATING_LABELS}
        self.assertEqual(labelled, set(CoachRatings.attribute_names()))
        # Labels must be the ones a team page reads, not the field names.
        self.assertEqual(dict(COACH_RATING_LABELS)["talent_evaluation"], "Scouting Eye")
        self.assertEqual(dict(COACH_RATING_LABELS)["development"], "Player Development")

    def test_reputation_is_not_counted_as_a_coaching_skill(self):
        self.assertNotIn("reputation", COACHING_SKILLS)
        self.assertEqual(len(COACHING_SKILLS), 6)

    def test_ratings_are_clamped_to_the_scale(self):
        ratings = CoachRatings(offense=140.0, defense=-30.0)
        self.assertEqual(ratings.offense, COACH_MAX)
        self.assertEqual(ratings.defense, COACH_MIN)

    def test_a_blank_coach_is_average_at_everything(self):
        for field in fields(CoachRatings):
            self.assertEqual(getattr(CoachRatings(), field.name), COACH_AVERAGE)

    def test_edge_is_zero_at_average_and_signed_either_side(self):
        self.assertEqual(coach_edge(COACH_AVERAGE), 0.0)
        self.assertGreater(coach_edge(90.0), 0.0)
        self.assertLess(coach_edge(20.0), 0.0)

    def test_tiers_run_from_great_to_awful(self):
        self.assertEqual(coach_tier(99.0), "All-time great")
        self.assertEqual(coach_tier(0.0), "Out of his depth")
        # A Spoelstra-shaped coach should read as elite, not merely solid.
        spoelstra = coach_with(
            reputation=99, offense=95, defense=99, development=92,
            tactics=99, leadership=98, talent_evaluation=88,
        )
        self.assertEqual(spoelstra.tier, "All-time great")

    def test_specialism_names_the_best_skill(self):
        self.assertEqual(coach_with(defense=95).specialism, "Defensive specialist")
        self.assertEqual(coach_with(development=95).specialism, "Player developer")
        self.assertEqual(coach_with(talent_evaluation=95).specialism, "Talent spotter")
        # Reputation is standing, so it must never win the specialism.
        self.assertNotEqual(coach_with(reputation=100, offense=70).specialism, "")
        self.assertEqual(coach_with(reputation=100, offense=70).specialism, "Offensive mind")

    def test_round_trips_through_a_dict(self):
        coach = coach_with(offense=71.4, defense=63.2)
        payload = coach.to_dict()
        self.assertEqual(payload["ratings"]["offense"], 71.4)
        self.assertEqual(set(payload["ratings"]), set(CoachRatings.attribute_names()))
        self.assertEqual(
            CoachRatings.from_dict(payload["ratings"]).defense, 63.2
        )


class TestCoachGeneration(unittest.TestCase):
    def setUp(self):
        self.rng = random.Random(7)
        self.coaches = make_coaches(self.rng, 30)

    def test_thirty_coaches_with_distinct_names(self):
        self.assertEqual(len(self.coaches), 30)
        self.assertEqual(len({c.name for c in self.coaches}), 30)
        self.assertEqual(len({c.id for c in self.coaches}), 30)

    def test_every_rating_lands_on_the_scale(self):
        for coach in self.coaches:
            for field in fields(CoachRatings):
                value = getattr(coach.ratings, field.name)
                self.assertGreaterEqual(value, COACH_MIN, coach.name)
                self.assertLessEqual(value, COACH_MAX, coach.name)

    def test_coaches_are_not_all_the_same(self):
        offense = [c.ratings.offense for c in self.coaches]
        self.assertGreater(max(offense) - min(offense), 25.0)
        self.assertGreater(len({c.specialism for c in self.coaches}), 2)

    def test_quality_skews_low_so_elite_coaches_are_scarce(self):
        elite = [c for c in self.coaches if c.ratings.reputation >= 84.0]
        self.assertLess(len(elite), 8, "too many elite coaches in a 30-team league")

    def test_reputation_tracks_ability_without_matching_it(self):
        """Standing correlates with skill but lags it -- a coach can be
        overrated. If reputation were computed from the skills there would be
        no hires to get wrong."""
        rng = random.Random(3)
        coaches = make_coaches(rng, 30)
        gaps = []
        for coach in coaches:
            skill = sum(getattr(coach.ratings, k) for k in COACHING_SKILLS) / len(COACHING_SKILLS)
            gaps.append(coach.ratings.reputation - skill)

        # Correlated: the best-regarded half is genuinely better than the rest.
        by_reputation = sorted(coaches, key=lambda c: c.ratings.reputation)
        skill_of = lambda group: sum(  # noqa: E731
            sum(getattr(c.ratings, k) for k in COACHING_SKILLS) for c in group
        ) / (len(group) * len(COACHING_SKILLS))
        self.assertGreater(skill_of(by_reputation[15:]), skill_of(by_reputation[:15]) + 8)

        # But not identical: somebody in the league is misjudged by 5+ points.
        self.assertGreater(max(abs(g) for g in gaps), 5.0)

    def test_nobody_has_coached_since_before_he_was_old_enough(self):
        for coach in self.coaches:
            self.assertGreaterEqual(coach.age - coach.seasons_coached, 32, coach.name)

    def test_generation_is_reproducible(self):
        again = make_coaches(random.Random(7), 30)
        self.assertEqual([c.name for c in again], [c.name for c in self.coaches])
        self.assertEqual(
            [c.ratings.to_dict() for c in again],
            [c.ratings.to_dict() for c in self.coaches],
        )

    def test_asking_for_more_coaches_than_names_is_an_error(self):
        with self.assertRaises(ValueError):
            make_coaches(random.Random(1), 500)


class TestEveryTeamHasACoach(unittest.TestCase):
    def test_thirty_teams_thirty_distinct_coaches(self):
        teams = make_teams(30)
        self.assertTrue(all(t.coach is not None for t in teams))
        self.assertEqual(len({t.coach.id for t in teams}), 30)

    def test_the_coach_ships_with_the_team(self):
        team = make_teams(1)[0]
        payload = team.to_dict()["coach"]
        self.assertEqual(payload["name"], team.coach.name)
        self.assertIn("Overall Reputation", dict(
            (label, key) for key, label in COACH_RATING_LABELS
        ))
        self.assertEqual(set(payload["ratings"]), set(CoachRatings.attribute_names()))


class TestCoachingChangesResults(unittest.TestCase):
    """Paired games: same rosters, same seeds, only the coach differs."""

    # Coaching is worth a handful of points, which is small next to the spread
    # of a single game -- so these need a real sample to see through the noise.
    GAMES = 32

    ELITE = dict(offense=95, defense=95, tactics=95, development=95,
                 leadership=95, talent_evaluation=95, reputation=95)
    POOR = dict(offense=12, defense=12, tactics=12, development=12,
                leadership=12, talent_evaluation=12, reputation=12)

    def paired(self, better, worse, opponent, read):
        better_total = worse_total = 0
        for i in range(self.GAMES):
            seed = f"coach-{i}"
            better_total += read(GameSimulator(
                seed, copy.deepcopy(better), copy.deepcopy(opponent), seed=seed).simulate())
            worse_total += read(GameSimulator(
                seed, copy.deepcopy(worse), copy.deepcopy(opponent), seed=seed).simulate())
        return better_total / self.GAMES, worse_total / self.GAMES

    def setUp(self):
        base, self.opponent = make_teams(2)
        self.well_coached = copy.deepcopy(base)
        self.well_coached.coach = coach_with(**self.ELITE)
        self.badly_coached = copy.deepcopy(base)
        self.badly_coached.coach = coach_with(**self.POOR)
        self.opponent.coach = coach_with()  # average, so it is not a variable

    def one_rating(self, high: float, low: float, key: str, read):
        """Move a single coach rating and nothing else."""
        base, opponent = make_teams(2)
        opponent.coach = coach_with()
        better = copy.deepcopy(base)
        better.coach = coach_with(**{key: high})
        worse = copy.deepcopy(base)
        worse.coach = coach_with(**{key: low})
        return self.paired(better, worse, opponent, read)

    def test_a_better_coach_is_worth_points(self):
        good_net, bad_net = self.paired(
            self.well_coached, self.badly_coached, self.opponent,
            lambda r: r.home_score - r.away_score,
        )
        self.assertGreater(good_net, bad_net + 4.0)

    def test_the_league_spread_of_coaches_is_worth_about_five_points(self):
        """The number that actually matters is the *generated* spread, not the
        synthetic extreme: 95-across-the-board against 12 is a matchup no
        league produces. Best against worst in a real 30-team league should be
        worth a handful of points -- enough to weigh when hiring, not enough to
        carry a bad roster."""
        teams = make_teams(30)
        skill = lambda t: sum(  # noqa: E731
            getattr(t.coach.ratings, k) for k in COACHING_SKILLS
        ) / len(COACHING_SKILLS)
        best = max(teams, key=skill).coach
        worst = min(teams, key=skill).coach

        base, opponent = make_teams(2)
        opponent.coach = coach_with()
        well = copy.deepcopy(base)
        well.coach = best
        badly = copy.deepcopy(base)
        badly.coach = worst

        good_net, bad_net = self.paired(
            well, badly, opponent, lambda r: r.home_score - r.away_score
        )
        worth = good_net - bad_net
        self.assertGreater(worth, 1.5, "the best coach in the league should matter")
        self.assertLess(worth, 9.0, "a coach should not be worth a whole roster")

    def test_an_offensive_coach_lifts_assists(self):
        sharp, blunt = self.one_rating(97, 8, "offense", lambda r: r.home_box.total("assists"))
        self.assertGreater(sharp, blunt + 1.5)

    def test_an_offensive_coach_lifts_scoring(self):
        sharp, blunt = self.one_rating(97, 8, "offense", lambda r: r.home_score)
        self.assertGreater(sharp, blunt + 1.5)

    def test_a_defensive_coach_lowers_what_the_opposition_scores(self):
        stingy, porous = self.one_rating(97, 8, "defense", lambda r: r.away_score)
        self.assertLess(stingy, porous - 2.5)

    def test_a_tactical_coach_protects_the_ball(self):
        sharp, loose = self.one_rating(97, 8, "tactics", lambda r: r.home_box.total("turnovers"))
        self.assertLess(sharp, loose - 0.4)

    def test_no_coach_is_playable(self):
        """A team without a head coach must simulate, at roughly the level of
        one with an average coach -- `None` is neutral, not a penalty."""
        base, opponent = make_teams(2)
        opponent.coach = coach_with()
        headless = copy.deepcopy(base)
        headless.coach = None
        average = copy.deepcopy(base)
        average.coach = coach_with()

        headless_pts, average_pts = self.paired(
            headless, average, opponent, lambda r: r.home_score
        )
        self.assertAlmostEqual(headless_pts, average_pts, delta=0.01)


class TestCoachingOffTheCourt(unittest.TestCase):
    """Development, leadership and the scouting eye never touch a possession,
    so they are tested where they do their work."""

    @staticmethod
    def season(ability: Ability, age: int, seed: int, coaching: float) -> None:
        """One season of development, with everything but the coach held fixed."""
        develop(
            random.Random(seed),
            ability,
            age=age,
            development_rate=12.0,
            professionalism=12.0,
            work_rate=12.0,
            coaching=coaching,
        )

    def test_a_developer_grows_a_prospect_faster(self):
        good = development_multiplier(coach_with(development=95))
        bad = development_multiplier(coach_with(development=10))
        self.assertGreater(good, 1.0)
        self.assertLess(bad, 1.0)
        self.assertEqual(development_multiplier(None), 1.0)

        well_coached = Ability(current=95.0, potential=170.0)
        badly_coached = Ability(current=95.0, potential=170.0)
        for season in range(3):
            self.season(well_coached, 21 + season, season, good)
            self.season(badly_coached, 21 + season, season, bad)

        self.assertGreater(well_coached.current, badly_coached.current)
        # The hard rule holds however good the coach is.
        self.assertLessEqual(well_coached.current, well_coached.potential)

    def test_a_developer_slows_decline_as_well_as_speeding_growth(self):
        good = development_multiplier(coach_with(development=95))
        bad = development_multiplier(coach_with(development=10))
        well_coached = Ability(current=150.0, potential=150.0)
        badly_coached = Ability(current=150.0, potential=150.0)
        for season in range(3):
            self.season(well_coached, 35 + season, season, good)
            self.season(badly_coached, 35 + season, season, bad)

        self.assertLess(well_coached.current, 150.0, "an ageing player should decline")
        self.assertGreater(well_coached.current, badly_coached.current)

    def test_a_leader_gels_a_locker_room_faster(self):
        self.assertGreater(chemistry_multiplier(coach_with(leadership=95)), 1.0)
        self.assertLess(chemistry_multiplier(coach_with(leadership=10)), 1.0)
        self.assertEqual(chemistry_multiplier(None), 1.0)

        base = make_teams(1)[0]
        led = copy.deepcopy(base)
        led.coach = coach_with(leadership=97)
        drifting = copy.deepcopy(base)
        drifting.coach = coach_with(leadership=6)

        # The same minutes together on both sides, so only the coach differs.
        ids = [p.id for p in base.players[:5]]
        pair_minutes = {
            frozenset((ids[i], ids[j])): 28.0
            for i in range(len(ids)) for j in range(i + 1, len(ids))
        }
        for team in (led, drifting):
            for _ in range(5):
                drift_after_game(team, dict(pair_minutes))

        strongest = lambda t: max(t.pair_chemistry.values())  # noqa: E731
        self.assertGreater(strongest(led), strongest(drifting))

    def test_a_talent_spotter_scouts_more_accurately(self):
        self.assertGreater(
            scouting_accuracy(coach_with(talent_evaluation=95)),
            scouting_accuracy(coach_with(talent_evaluation=10)),
        )
        self.assertEqual(scouting_accuracy(None, base=0.55), 0.55)

    def test_scouting_accuracy_stays_a_probability(self):
        for value in (0.0, 25.0, 50.0, 75.0, 100.0):
            accuracy = scouting_accuracy(coach_with(talent_evaluation=value), base=0.95)
            self.assertGreaterEqual(accuracy, 0.05)
            self.assertLessEqual(accuracy, 1.0)


if __name__ == "__main__":
    unittest.main()
