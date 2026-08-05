"""Contracts, valuation and payroll.

The money has one job: to be believable at a glance and to add up exactly.
Most of what is worth testing here is the second half of that -- a payroll
screen is a sum over fifteen integers and it has to agree with the fifteen
rows printed underneath it.

Three of these tests exist because a calibration run failed them, and none of
the three was visible from reading the code:

  * `TestTheCurveIsOrdered` -- the first value curve ran so hot above CA 145
    that the maximum bound on every star, and once every star is on a max the
    only thing separating their salaries is service years. The All-Star tier
    came out *better paid* than the Elite tier above it.
  * `TestTheMinimumIsAThingPeopleAreActuallyPaid` -- the bottom of the curve
    sat above the minimum salary, so a league of 360 produced exactly one
    minimum contract where a real roster's last few names are all on one.
  * `TestAnExpiredContractPaysNothing` -- an unsigned player stays on the
    roster today, and his lapsed salary was still being counted against his
    club's payroll.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import contracts as K
from bballsim import negotiation as N
from bballsim import payroll as P
from bballsim.ability import ca_tier
from bballsim.roster import load_teams

_LEAGUE = None


def league_with_contracts():
    """One league, contracted once. Generation is deterministic, so sharing it
    across the suite is safe and saves re-reading the roster thirty times."""
    global _LEAGUE
    if _LEAGUE is None:
        saved = load_teams()
        K.generate_for_league(saved.teams, season=saved.season)
        K.generate_coaches_for_league(saved.teams, season=saved.season)
        _LEAGUE = saved
    return _LEAGUE


def everyone():
    return [p for t in league_with_contracts().teams for p in t.players]


class TestAContractIsWhatItSaysItIs(unittest.TestCase):

    def setUp(self):
        self.contract = K.Contract(years=4, years_remaining=2, salary=10_000_000)

    def test_a_deal_in_its_last_year_is_expiring(self):
        self.assertFalse(self.contract.expiring)
        self.contract.years_remaining = 1
        self.assertTrue(self.contract.expiring)

    def test_a_deal_at_zero_is_expired_but_not_before(self):
        self.assertFalse(self.contract.expired)
        self.contract.years_remaining = 0
        self.assertTrue(self.contract.expired)

    def test_the_two_totals_are_different_questions(self):
        self.assertEqual(self.contract.total_value, 40_000_000)
        self.assertEqual(self.contract.remaining_value, 20_000_000)

    def test_years_served_is_the_gap(self):
        self.assertEqual(self.contract.years_served, 2)

    def test_ticking_down_stops_at_zero(self):
        """A counter running to -3 would make "how long has he been unsigned"
        look like a contract term."""
        for _ in range(8):
            K.tick_down(self.contract)
        self.assertEqual(self.contract.years_remaining, 0)

    def test_ticking_down_passes_none_through(self):
        self.assertIsNone(K.tick_down(None))


class TestWhatAPlayerIsWorth(unittest.TestCase):

    def player(self, ca=130.0, age=27, potential=None, position="SF"):
        team = load_teams(1).teams[0]
        person = next(p for p in team.players if p.position.value == position)
        person.ability.potential = max(potential or ca, ca)
        person.ability.set_current(ca)
        person.age = age
        person.career = None
        return person

    def test_a_better_player_is_worth_more(self):
        self.assertGreater(K.market_value(self.player(ca=160.0)),
                           K.market_value(self.player(ca=120.0)))

    def test_nobody_is_worth_less_than_the_minimum(self):
        self.assertGreaterEqual(K.market_value(self.player(ca=20.0)),
                                K.MINIMUM_SALARY)

    def test_nobody_is_worth_more_than_his_maximum(self):
        person = self.player(ca=200.0, age=30)
        self.assertLessEqual(K.market_value(person),
                             K.max_salary(K.service_years(person)))

    def test_a_veteran_is_paid_less_than_his_prime_self(self):
        self.assertLess(K.market_value(self.player(ca=140.0, age=36)),
                        K.market_value(self.player(ca=140.0, age=28)))

    def test_headroom_is_worth_money_to_the_young_and_nothing_to_the_old(self):
        young_flat = K.market_value(self.player(ca=120.0, age=22, potential=120.0))
        young_high = K.market_value(self.player(ca=120.0, age=22, potential=175.0))
        self.assertGreater(young_high, young_flat)

        old_flat = K.market_value(self.player(ca=120.0, age=33, potential=120.0))
        old_high = K.market_value(self.player(ca=120.0, age=33, potential=175.0))
        self.assertEqual(old_high, old_flat,
                         "a 33-year-old is not going to spend his headroom")

    def test_service_gates_the_maximum(self):
        """A 21-year-old superstar cannot be paid what a 30-year-old one is,
        which is why his second contract is the famous one."""
        self.assertLess(K.max_salary(0), K.max_salary(7))
        self.assertLess(K.max_salary(7), K.max_salary(10))


class TestTheCurveIsOrdered(unittest.TestCase):
    """Better players are paid more, tier by tier.

    Written because the first calibration inverted it: the All-Star tier came
    out better paid on average than the Elite tier above it, because the curve
    ran hot enough that the maximum bound on everybody and service years became
    the only differentiator.
    """

    ORDER = ("Elite NBA", "All-Star", "High-end starter", "Average starter",
             "Rotation player", "Bench player", "Fringe NBA")

    @classmethod
    def setUpClass(cls):
        cls.by_tier = {}
        for player in everyone():
            cls.by_tier.setdefault(ca_tier(player.ability.current), []).append(
                player.contract.salary)

    def mean(self, tier):
        values = self.by_tier.get(tier, [])
        return sum(values) / len(values) if values else 0.0

    def test_each_tier_is_paid_more_than_the_one_below(self):
        present = [t for t in self.ORDER if self.by_tier.get(t)]
        self.assertGreaterEqual(len(present), 5, "not enough tiers to compare")
        for better, worse in zip(present, present[1:]):
            self.assertGreater(
                self.mean(better), self.mean(worse),
                f"{better} is paid no better than {worse}")

    def test_the_league_has_a_believable_top_end(self):
        top = max(p.contract.salary for p in everyone())
        self.assertGreater(top, K.SALARY_CAP * 0.25)
        self.assertLessEqual(top, K.max_salary(10))


class TestTheMinimumIsAThingPeopleAreActuallyPaid(unittest.TestCase):
    """The bottom of the value curve has to fall *below* the minimum salary.

    Otherwise the minimum is a constant nobody is ever paid: a first pass
    floored the fringe tier around $2M and produced one minimum contract in a
    league of 360.
    """

    def test_the_curve_bottoms_out_under_the_minimum(self):
        floor = K.SALARY_CAP * K.VALUE_CURVE[-1][1]
        self.assertLess(floor, K.MINIMUM_SALARY)

    def test_a_real_league_carries_minimum_contracts(self):
        on_minimum = [p for p in everyone()
                      if p.contract.contract_type is K.ContractType.MINIMUM]
        self.assertGreaterEqual(len(on_minimum), 5)

    def test_nobody_is_paid_below_it(self):
        self.assertGreaterEqual(min(p.contract.salary for p in everyone()),
                                K.MINIMUM_SALARY)


class TestHowLongADealRuns(unittest.TestCase):

    def player(self, ca, age):
        person = load_teams(1).teams[0].players[0]
        person.ability.potential = max(200.0, ca)
        person.ability.set_current(ca)
        person.age = age
        return person

    def test_a_superstar_signs_long(self):
        label, shortest, longest = K.length_band(self.player(175.0, 27))
        self.assertEqual(label, "superstar")
        self.assertEqual((shortest, longest), (4, 5))

    def test_a_young_star_signs_long_a_tier_lower(self):
        label, _s, _l = K.length_band(self.player(148.0, 24))
        self.assertEqual(label, "young star")

    def test_age_outranks_ability(self):
        """Or a 35-year-old All-Star gets five guaranteed years."""
        label, shortest, longest = K.length_band(self.player(170.0, 35))
        self.assertEqual(label, "veteran")
        self.assertLessEqual(longest, 2)

    def test_a_young_reserve_is_not_called_a_veteran(self):
        """The bug: the veteran row carried an age *ceiling*, so every young
        low-CA player fell through the ability bands and matched it -- and the
        fringe row underneath was unreachable."""
        label, _s, _l = K.length_band(self.player(70.0, 25))
        self.assertEqual(label, "fringe")

    def test_every_band_is_reachable(self):
        seen = set()
        for ca in range(40, 200, 3):
            for age in range(19, 40):
                seen.add(K.length_band(self.player(float(ca), age))[0])
        for band in ("superstar", "young star", "starter", "role player",
                     "fringe", "veteran"):
            self.assertIn(band, seen, f"{band} is unreachable")

    def test_no_deal_runs_longer_than_five_years(self):
        self.assertLessEqual(max(p.contract.years for p in everyone()), 5)


class TestGenerationProducesALeague(unittest.TestCase):

    def test_everyone_has_a_contract(self):
        self.assertTrue(all(p.contract is not None for p in everyone()))

    def test_every_coach_has_one_too(self):
        for team in league_with_contracts().teams:
            self.assertIsNotNone(team.coach.contract, team.id)

    def test_contracts_are_staggered_so_the_league_does_not_expire_at_once(self):
        """A new save has no signing history, so years remaining is drawn
        inside the deal's length. Without it every contract in the league would
        run out in the same summer."""
        remaining = {p.contract.years_remaining for p in everyone()}
        self.assertGreaterEqual(len(remaining), 4, remaining)

    def test_generation_is_idempotent(self):
        """It is called on every boot to fill in an old save, so a second call
        must not re-price anybody."""
        saved = league_with_contracts()
        before = {p.id: p.contract.salary for p in everyone()}
        K.generate_for_league(saved.teams, season=saved.season)
        after = {p.id: p.contract.salary for p in everyone()}
        self.assertEqual(before, after)

    def test_the_same_league_generates_the_same_contracts(self):
        fresh = load_teams()
        K.generate_for_league(fresh.teams, season=fresh.season)
        mine = {p.id: p.contract.salary for t in fresh.teams for p in t.players}
        theirs = {p.id: p.contract.salary for p in everyone()}
        self.assertEqual(mine, theirs)

    def test_a_deal_is_never_labelled_something_it_does_not_pay(self):
        for player in everyone():
            contract = player.contract
            if contract.contract_type is K.ContractType.MAXIMUM:
                self.assertGreaterEqual(
                    contract.salary, K.max_salary(K.service_years(player)) * 0.97,
                    player.name)
            if contract.contract_type is K.ContractType.MINIMUM:
                self.assertLessEqual(contract.salary, K.MINIMUM_SALARY * 1.02,
                                     player.name)


class TestCoachesArePricedToo(unittest.TestCase):

    def test_a_better_coach_earns_more(self):
        coaches = sorted((t.coach for t in league_with_contracts().teams),
                         key=K.coach_standing)
        self.assertGreater(coaches[-1].contract.salary, coaches[0].contract.salary)

    def test_coaching_pay_is_in_a_believable_range(self):
        salaries = [t.coach.contract.salary for t in league_with_contracts().teams]
        self.assertGreaterEqual(min(salaries), K.COACH_MINIMUM_SALARY)
        self.assertLess(max(salaries), 20_000_000)

    def test_standing_is_not_just_reputation(self):
        """A club that has watched a coach work is paying for the work."""
        coach = league_with_contracts().teams[0].coach
        before = K.coach_standing(coach)
        coach.ratings.offense = min(100.0, coach.ratings.offense + 20)
        self.assertGreater(K.coach_standing(coach), before)


class TestPayrollAddsUp(unittest.TestCase):

    def setUp(self):
        self.team = league_with_contracts().teams[0]

    def test_the_total_is_the_sum_of_the_rows(self):
        by_hand = sum(p.contract.salary for p in self.team.players
                      if not p.contract.expired)
        self.assertEqual(P.player_payroll(self.team), by_hand)

    def test_the_coach_is_counted_separately(self):
        """Coaching salary does not count against a basketball cap, and folding
        the two together would make every cap calculation quietly wrong."""
        self.assertEqual(
            P.total_payroll(self.team),
            P.player_payroll(self.team) + P.coach_payroll(self.team))
        self.assertNotIn(self.team.coach.contract.salary,
                         [P.player_payroll(self.team)])

    def test_cap_room_is_the_cap_less_the_players(self):
        self.assertEqual(P.room_below_cap(self.team),
                         K.SALARY_CAP - P.player_payroll(self.team))

    def test_a_league_of_thirty_lands_near_the_cap(self):
        """The one number that says the whole curve is calibrated."""
        totals = [P.player_payroll(t) for t in league_with_contracts().teams]
        mean = sum(totals) / len(totals)
        self.assertGreater(mean, K.SALARY_CAP * 0.95)
        self.assertLess(mean, K.SALARY_CAP * 1.30)

    def test_the_tax_is_a_line_a_few_clubs_cross(self):
        over = sum(1 for t in league_with_contracts().teams if P.over_tax(t))
        self.assertLess(over, 12, "the tax line is not a line if everyone is over it")

    def test_committed_only_counts_years_that_exist(self):
        team = self.team
        one = P.committed(team, seasons=1)
        five = P.committed(team, seasons=5)
        self.assertGreater(five, one)
        self.assertLessEqual(
            five, sum(p.contract.salary * p.contract.years_remaining
                      for p in team.players))

    def test_every_club_lands_in_exactly_one_band(self):
        for team in league_with_contracts().teams:
            key, label = P.cap_band(team)
            self.assertIn((key, label), P.CAP_BANDS, team.id)


class TestAnExpiredContractPaysNothing(unittest.TestCase):
    """An unsigned player stays on the roster -- see `franchise.fill_pool` --
    and his lapsed salary was being counted against his club."""

    def setUp(self):
        self.team = load_teams(1).teams[0]
        K.generate_for_league([self.team], season="2026-27")

    def test_expiring_a_contract_removes_it_from_payroll(self):
        player = self.team.players[0]
        player.contract.years_remaining = 1
        before = P.player_payroll(self.team)
        player.contract.years_remaining = 0
        self.assertEqual(P.player_payroll(self.team),
                         before - player.contract.salary)

    def test_an_unsigned_player_costs_nothing(self):
        player = self.team.players[0]
        salary = player.contract.salary
        player.contract = None
        self.assertEqual(P.salary_of(player), 0)
        self.assertNotEqual(salary, 0)


class TestMoneyReadsTheSameEverywhere(unittest.TestCase):

    def test_millions_are_abbreviated(self):
        self.assertEqual(N.format_money(12_400_000), "$12.4M")

    def test_below_a_million_is_grouped(self):
        self.assertEqual(N.format_money(980_000), "$980,000")

    def test_payroll_uses_the_same_formatter(self):
        self.assertEqual(P.format_money(12_400_000), N.format_money(12_400_000))


if __name__ == "__main__":
    unittest.main()
