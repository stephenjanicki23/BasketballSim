"""The progression engine.

The rule that cannot bend is CA <= PA, and it has to hold at the attribute
level now that attributes are what move. Most of what is below is either that
invariant or the properties a career is supposed to have: the legs go before
the judgement does, personality decides how much of a ceiling gets collected,
and no two players run the same curve.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import copy
import statistics
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.ability import Ability, current_ability
from bballsim.progression import (
    ATHLETIC, CHARACTER, DEVELOPMENT_GROUPS, EXPERIENTIAL, TECHNICAL,
    CareerArc, build_profile, coaching_growth, default_minutes, develop_season,
    effective_ceiling, group_curve, leg_reliance, minutes_factor, pick_arc,
    realisation_factor, simulate_career,
)
from bballsim.ratings import SCALE_MAX, SCALE_MIN, HiddenAttributes, Ratings
from bballsim.roster import load_teams


def sample(n: int = 60):
    players = [p for t in load_teams().teams for p in t.players]
    return [copy.deepcopy(p) for p in players[:n]]


def group_mean(player, keys) -> float:
    return sum(getattr(player.ratings, k) for k in keys) / len(keys)


class TestTheHardRule(unittest.TestCase):
    """CA never exceeds PA -- now enforced against the attribute set, because
    the attribute set is what changes."""

    def test_ca_never_passes_pa_over_a_whole_career(self):
        for player in sample(40):
            profile, history = simulate_career(player, seed=f"rule-{player.id}")
            for report in history:
                self.assertLessEqual(
                    report.ca_after, report.potential + 1e-6,
                    f"{player.name} at {report.age}")

    def test_ca_still_equals_what_the_attributes_price(self):
        """The whole design rests on this: CA is not stored alongside the
        attributes, it is derived from them."""
        for player in sample(25):
            profile = build_profile(player, seed=f"price-{player.id}")
            for _ in range(6):
                if profile.retired:
                    break
                develop_season(player, profile, minutes=2000.0,
                               seed=f"price-{player.id}-{player.age}")
                priced = current_ability(player.ratings, player.position.value)
                self.assertAlmostEqual(
                    player.ability.current, min(priced, player.ability.potential),
                    places=4, msg=player.name)

    def test_a_player_at_his_ceiling_stops_improving(self):
        player = sample(1)[0]
        player.ability = Ability(current=140.0, potential=140.0)
        profile = build_profile(player, seed="capped")
        player.age = 21
        before = current_ability(player.ratings, player.position.value)
        report = develop_season(player, profile, minutes=2000.0, seed="capped-21")
        self.assertLessEqual(report.ca_after, 140.0 + 1e-6)
        self.assertLessEqual(report.ca_after, max(before, 140.0) + 1e-6)

    def test_a_ceiling_lost_to_injury_never_comes_back(self):
        player = sample(1)[0]
        profile = build_profile(player, seed="pa-cut")
        highest = player.ability.potential
        for _ in range(14):
            if profile.retired:
                break
            report = develop_season(player, profile, minutes=2400.0,
                                    seed=f"pa-cut-{player.age}")
            self.assertLessEqual(report.potential, highest + 1e-6)
            highest = report.potential


class TestAgeing(unittest.TestCase):
    def test_the_legs_go_before_the_judgement_does(self):
        """The single property that makes a veteran feel like a veteran.

        Stated as a comparison rather than as "judgement rises", because on a
        cohort that is already past its prime it does not: those players have
        only decline left in every group. What has to hold at every age is
        that the legs lose *more* than the read of the game does.
        """
        athletic_loss, experiential_loss, counted = [], [], 0
        for player in sample(40):
            start_ath = group_mean(player, ATHLETIC)
            start_exp = group_mean(player, EXPERIENTIAL)
            _profile, history = simulate_career(player, seed=f"age-{player.id}")
            if len(history) < 5:
                continue
            counted += 1
            athletic_loss.append(start_ath - group_mean(player, ATHLETIC))
            experiential_loss.append(start_exp - group_mean(player, EXPERIENTIAL))
        self.assertGreater(counted, 20, "not enough careers to draw on")
        self.assertGreater(statistics.mean(athletic_loss), 1.0,
                           "careers are not costing anyone a step")
        self.assertGreater(statistics.mean(athletic_loss),
                           statistics.mean(experiential_loss) + 1.0,
                           "the legs are not going faster than the judgement")

    def test_a_young_player_gains_judgement(self):
        """The other half of the same property, tested where it applies."""
        gained = 0
        for player in sample(30):
            clone = copy.deepcopy(player)
            clone.age = 20
            start = group_mean(clone, EXPERIENTIAL)
            profile = build_profile(clone, seed=f"iq-{clone.id}")
            for _ in range(5):
                if profile.retired:
                    break
                develop_season(clone, profile, minutes=1800.0,
                               seed=f"iq-{clone.id}-{clone.age}")
            if group_mean(clone, EXPERIENTIAL) > start:
                gained += 1
        self.assertGreater(gained, 25, "young players are not learning")

    def test_character_keeps_rising_when_ability_is_falling(self):
        """Leadership and composure cost no CA, so they are free to grow while
        everything priced into it declines."""
        rising = 0
        for player in sample(30):
            start = group_mean(player, CHARACTER)
            profile, history = simulate_career(player, seed=f"chr-{player.id}")
            if history and group_mean(player, CHARACTER) > start:
                rising += 1
        self.assertGreater(rising, 24)

    def test_decline_accelerates_with_distance_past_the_prime(self):
        player = sample(1)[0]
        profile = build_profile(player, seed="accel")
        rates = [
            group_curve("athletic", profile.prime_age + years, profile)
            for years in (1, 4, 8)
        ]
        self.assertTrue(all(r < 0 for r in rates), rates)
        self.assertLess(rates[1], rates[0])
        self.assertLess(rates[2], rates[1])

    def test_athleticism_never_decays_to_nothing(self):
        """Losses are a share of what is left, so the curve flattens as it
        falls. A flat subtraction walks a 40-year-old down to 1 out of 20."""
        for player in sample(30):
            simulate_career(player, seed=f"floor-{player.id}")
            self.assertGreater(group_mean(player, ATHLETIC), 2.0, player.name)

    def test_no_attribute_leaves_the_scale(self):
        for player in sample(20):
            simulate_career(player, seed=f"scale-{player.id}")
            for key in Ratings.attribute_names():
                value = getattr(player.ratings, key)
                self.assertGreaterEqual(value, SCALE_MIN, key)
                self.assertLessEqual(value, SCALE_MAX, key)


class TestPrimeAge(unittest.TestCase):
    def test_every_player_gets_one_and_it_varies(self):
        primes = [build_profile(p, seed=f"prime-{p.id}").prime_age
                  for p in sample(120)]
        self.assertGreater(statistics.pstdev(primes), 0.8, "primes are uniform")
        self.assertTrue(all(25.0 <= p <= 33.5 for p in primes))
        self.assertTrue(24.0 < statistics.mean(primes) < 32.0)

    def test_the_athletic_peak_comes_before_the_prime(self):
        for player in sample(40):
            profile = build_profile(player, seed=f"peak-{player.id}")
            self.assertLess(profile.athletic_peak, profile.prime_age, player.name)

    def test_a_leg_dependent_player_peaks_earlier(self):
        """Prime age is read off what the player's game is built on, not
        drawn from a hat -- so this has to hold across the league."""
        pairs = []
        for player in sample(200):
            profile = build_profile(player, seed=f"rel-{player.id}")
            pairs.append((leg_reliance(player.ratings), profile.prime_age))
        legs = [p for r, p in pairs if r > 0]
        skill = [p for r, p in pairs if r < 0]
        self.assertTrue(legs and skill)
        self.assertLess(statistics.mean(legs), statistics.mean(skill))


class TestPersonality(unittest.TestCase):
    def test_the_spec_case_two_players_one_ceiling(self):
        """PA 185 and professionalism 19 finishes north of 180; the same
        ceiling with professionalism 6 stalls around 155."""
        ratings = Ratings()
        diligent = HiddenAttributes(professionalism=19, development_rate=19, ambition=19)
        for key in ("work_rate", "coachability", "competitive_drive"):
            setattr(ratings, key, 19)
        high = realisation_factor(diligent, ratings)

        lazy = HiddenAttributes(professionalism=6, development_rate=6, ambition=6)
        idle = Ratings()
        for key in ("work_rate", "coachability", "competitive_drive"):
            setattr(idle, key, 6)
        low = realisation_factor(lazy, idle)

        # Character closes a share of the gap from where a career starts, so
        # the comparison is made from a real starting point: an 18-year-old at
        # CA 95 with a ceiling of 185.
        start, ceiling = 95.0, 185.0
        diligent_end = start + high * (ceiling - start)
        idle_end = start + low * (ceiling - start)
        self.assertGreater(diligent_end, 178.0, diligent_end)
        self.assertLess(idle_end, 165.0, idle_end)
        self.assertGreater(idle_end, 145.0, idle_end)
        self.assertGreater(diligent_end - idle_end, 18.0)

    def test_realisation_stays_a_share(self):
        for player in sample(80):
            share = realisation_factor(player.hidden, player.ratings)
            self.assertGreater(share, 0.5)
            self.assertLessEqual(share, 1.0)

    def test_the_ceiling_is_below_potential_for_most_players(self):
        below = 0
        for player in sample(60):
            profile = build_profile(player, seed=f"ceil-{player.id}")
            if effective_ceiling(player.ability, profile) < player.ability.potential:
                below += 1
        self.assertGreater(below, 50, "everyone is reaching their ceiling")


class TestCoachingAndMinutes(unittest.TestCase):
    def test_a_developer_is_worth_growth(self):
        self.assertGreater(coaching_growth(95), coaching_growth(50))
        self.assertGreater(coaching_growth(50), coaching_growth(10))

    def test_a_good_coach_gets_a_prospect_further(self):
        """Tested on players with somewhere to go.

        Ageing a roster player back to 20 does not make him a prospect -- he
        keeps the CA he earned and arrives with two or three points of
        headroom, which is not enough room for any coach to show up in. The
        clones here are given a real ceiling to chase.
        """
        good, poor = [], []
        for player in sample(30):
            for bucket, rating in ((good, 95.0), (poor, 10.0)):
                clone = copy.deepcopy(player)
                clone.age = 20
                clone.ability = Ability(current=100.0, potential=165.0)
                profile = build_profile(clone, seed=f"coach-{clone.id}")
                for _ in range(6):
                    if profile.retired:
                        break
                    develop_season(clone, profile, minutes=2000.0,
                                   coach_development=rating,
                                   seed=f"coach-{clone.id}-{clone.age}")
                bucket.append(clone.ability.current)
        self.assertGreater(statistics.mean(good), statistics.mean(poor) + 2.0)

    def test_a_good_coach_also_slows_the_decline(self):
        good, poor = [], []
        for player in sample(24):
            for bucket, rating in ((good, 95.0), (poor, 10.0)):
                clone = copy.deepcopy(player)
                profile = build_profile(clone, seed=f"late-{clone.id}")
                clone.age = int(profile.prime_age) + 4
                for _ in range(5):
                    if profile.retired:
                        break
                    develop_season(clone, profile, minutes=2200.0,
                                   coach_development=rating,
                                   seed=f"late-{clone.id}-{clone.age}")
                bucket.append(clone.ability.current)
        self.assertGreater(statistics.mean(good), statistics.mean(poor))

    def test_minutes_are_an_inverted_u_for_a_young_player(self):
        player = sample(1)[0]
        profile = build_profile(player, seed="mins")
        age = profile.prime_age - 6
        starved = minutes_factor(age, 300.0, profile)
        ideal = minutes_factor(age, 2100.0, profile)
        overloaded = minutes_factor(age, 3200.0, profile)
        self.assertLess(starved, ideal)
        self.assertLess(overloaded, ideal)

    def test_minutes_stop_developing_a_veteran(self):
        player = sample(1)[0]
        profile = build_profile(player, seed="mins-vet")
        self.assertEqual(minutes_factor(profile.prime_age + 2, 2500.0, profile), 1.0)


class TestCareerArcs(unittest.TestCase):
    def test_all_eight_arcs_are_reachable(self):
        seen = set()
        for player in sample(360):
            seen.add(build_profile(player, seed=f"arc-{player.id}").arc)
        self.assertEqual(len(seen), len(CareerArc), sorted(a.value for a in seen))

    def test_arcs_produce_different_careers(self):
        """Two profiles with the same starting player must not run the same
        curve, or the archetypes are decoration."""
        player = sample(1)[0]
        lengths = {}
        for arc in CareerArc:
            clone = copy.deepcopy(player)
            profile = build_profile(clone, seed="fixed")
            object.__setattr__(profile, "arc", arc)
            n = 0
            while not profile.retired and clone.age <= 44 and n < 30:
                develop_season(clone, profile,
                               minutes=default_minutes(clone.age, clone, profile),
                               seed=f"arc-{arc.value}-{clone.age}")
                n += 1
            lengths[arc] = (n, round(profile.peak_ca, 1))
        self.assertGreater(len({v for v in lengths.values()}), 4, lengths)


class TestDeterminism(unittest.TestCase):
    def test_the_same_seed_runs_the_same_career(self):
        first, second = sample(1)[0], sample(1)[0]
        a = simulate_career(first, seed="same")[1]
        b = simulate_career(second, seed="same")[1]
        self.assertEqual([r.to_dict() for r in a], [r.to_dict() for r in b])

    def test_different_players_get_different_careers(self):
        shapes = set()
        for player in sample(20):
            _profile, history = simulate_career(player, seed=f"vary-{player.id}")
            shapes.add(tuple(round(r.ca_after, 1) for r in history))
        self.assertGreater(len(shapes), 18, "careers are converging")

    def test_a_profile_is_stable_without_an_explicit_seed(self):
        player = sample(1)[0]
        a = build_profile(player)
        b = build_profile(player)
        self.assertEqual(a.to_dict(), b.to_dict())


class TestLeagueWideOutcomes(unittest.TestCase):
    """Careers have to be believable one at a time *and* in aggregate."""

    @classmethod
    def setUpClass(cls):
        cls.retire_ages, cls.peak_ages, cls.realised, cls.injuries, cls.seasons = (
            [], [], [], 0, 0)
        for player in sample(120):
            potential = player.ability.potential
            profile, history = simulate_career(player, seed=f"league-{player.id}")
            if not history:
                continue
            cls.retire_ages.append(history[-1].age)
            cls.peak_ages.append(max(history, key=lambda r: r.ca_after).age)
            cls.realised.append(profile.peak_ca / potential if potential else 0)
            cls.injuries += sum(1 for r in history if r.injury)
            cls.seasons += len(history)

    def test_careers_end_in_the_mid_thirties(self):
        self.assertTrue(32.0 <= statistics.mean(self.retire_ages) <= 37.0,
                        statistics.mean(self.retire_ages))

    def test_players_peak_in_their_late_twenties(self):
        self.assertTrue(25.0 <= statistics.mean(self.peak_ages) <= 30.0,
                        statistics.mean(self.peak_ages))

    def test_reaching_the_ceiling_is_not_guaranteed(self):
        mean = statistics.mean(self.realised)
        self.assertLess(mean, 0.99, "everyone maxes out")
        self.assertGreater(mean, 0.80, "nobody develops")

    def test_injuries_happen_often_enough_to_matter_and_not_every_year(self):
        rate = self.injuries / self.seasons
        self.assertGreater(rate, 0.10, rate)
        self.assertLess(rate, 0.40, rate)


if __name__ == "__main__":
    unittest.main()
