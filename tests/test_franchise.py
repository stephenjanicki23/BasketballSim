"""The offseason: negotiations, the phase machine, and the summer wire.

**These tests do not play a season.** `offseason.play_out` needs a full thirty
clubs -- the postseason wants eight seeds per conference, and a ten-team league
can never fill a bracket, so `play_out` spins forever on one. The state a
summer produces is built directly instead, which is both faster and a better
test: it means the phase machine is exercised through its own API rather than
through whatever a simulated season happened to produce.

Three tests here exist because a real end-to-end run failed them:

  * `TestASecondSummerIsANewSummer` -- the offseason state carried over from
    the first summer still marked every player `re-signed`, so the second one
    renewed nobody while its report cheerfully claimed 199 contracts were
    expiring. It was reading the previous year's list.
  * `TestARetirementKnowsHowLongTheCareerWas` -- `seasons_played` counts
    summers this save has simulated, which is zero on a fresh league. Every
    first-summer retirement read as a one-season career and the newsroom
    filtered the lot.
  * `TestAnExpiredContractPaysNothing` (in `test_contracts`) -- payroll was
    charging clubs for men they were no longer paying.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import re
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import contracts as K
from bballsim import negotiation as N
from bballsim import news
from bballsim import payroll as P
from bballsim.api import payload as views
from bballsim.league import franchise
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

NUMERALS = re.compile(r"\d+(?:\.\d+)?")


def league(teams: int = 6) -> League:
    """A contracted league on a real calendar, with nothing played."""
    saved = load_teams(teams)
    lg = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        lg.add_team(team)
    lg.set_schedule(build_daily_schedule(
        list(lg.teams), start_date=date(2026, 10, 20),
        games_per_team=4, season=lg.season))
    K.generate_for_league(list(lg.teams.values()), season=lg.season)
    K.generate_coaches_for_league(list(lg.teams.values()), season=lg.season)
    return lg


def force_champion(lg: League, team_id: str | None = None) -> str:
    """Make `playoffs.champion` answer, without playing a postseason.

    The offseason gate is "the Finals have concluded", and that is the only
    thing these tests need from the playoffs. Patching the module function is
    honest about that -- the alternative is simulating 1,230 games to set one
    boolean.
    """
    from bballsim.league import playoffs

    winner = team_id or next(iter(lg.teams))
    lg._test_champion = winner
    playoffs.champion = lambda _league, _w=winner: _w  # type: ignore[assignment]
    franchise.playoffs.champion = playoffs.champion   # type: ignore[assignment]
    return winner


def restore_champion() -> None:
    from bballsim.league import playoffs

    if hasattr(playoffs, "_real_champion"):
        playoffs.champion = playoffs._real_champion
        franchise.playoffs.champion = playoffs._real_champion


class ChampionFixture(unittest.TestCase):
    """Saves and restores the real `playoffs.champion` around each test."""

    @classmethod
    def setUpClass(cls):
        from bballsim.league import playoffs

        if not hasattr(playoffs, "_real_champion"):
            playoffs._real_champion = playoffs.champion

    def tearDown(self):
        restore_champion()


# --------------------------------------------------------------------------
# The gate
# --------------------------------------------------------------------------

class TestTheMenuIsGatedOnTheFinals(ChampionFixture):
    """The brief's one hard rule: OFFSEASON does not exist until a trophy has
    been lifted."""

    def test_a_season_in_progress_has_no_offseason(self):
        lg = league()
        self.assertFalse(franchise.is_available(lg))

    def test_a_decided_championship_opens_it(self):
        lg = league()
        force_champion(lg)
        self.assertTrue(franchise.is_available(lg))

    def test_beginning_early_does_nothing_at_all(self):
        """Not an error -- a no-op. A screen asking too early must not age
        every contract in the league by a year."""
        lg = league()
        before = [p.contract.years_remaining
                  for t in lg.teams.values() for p in t.players]
        franchise.begin(lg)
        after = [p.contract.years_remaining
                 for t in lg.teams.values() for p in t.players]
        self.assertEqual(before, after)
        self.assertIs(franchise.state(lg).phase, franchise.Phase.SEASON)

    def test_the_api_reports_unavailable_rather_than_failing(self):
        view = views.offseason_view(league())
        self.assertFalse(view["available"])
        self.assertEqual(view["expected"], [])


# --------------------------------------------------------------------------
# The clock
# --------------------------------------------------------------------------

class TestContractsTickExactlyOnce(ChampionFixture):

    def setUp(self):
        self.lg = league()
        force_champion(self.lg)
        self.before = {p.id: p.contract.years_remaining
                       for t in self.lg.teams.values() for p in t.players}

    def remaining(self):
        return {p.id: p.contract.years_remaining
                for t in self.lg.teams.values() for p in t.players}

    def test_a_year_comes_off_everybody(self):
        franchise.begin(self.lg)
        for pid, was in self.before.items():
            self.assertEqual(self.remaining()[pid], max(0, was - 1), pid)

    def test_opening_twice_does_not_charge_two_years(self):
        """A double-click on the menu must not age the league twice."""
        franchise.begin(self.lg)
        once = self.remaining()
        franchise.begin(self.lg)
        self.assertEqual(self.remaining(), once)

    def test_coaches_tick_too(self):
        before = {t.id: t.coach.contract.years_remaining
                  for t in self.lg.teams.values()}
        franchise.begin(self.lg)
        for team_id, was in before.items():
            self.assertEqual(
                self.lg.teams[team_id].coach.contract.years_remaining,
                max(0, was - 1), team_id)

    def test_reaching_zero_does_not_make_a_free_agent(self):
        """Expiry and free agency are two steps, and this is the reason the
        Expected Free Agents screen exists at all."""
        franchise.begin(self.lg)
        state = franchise.state(self.lg)
        self.assertEqual(state.pool, [])
        self.assertGreater(len(state.expected), 0)


class TestASecondSummerIsANewSummer(ChampionFixture):
    """The bug: state from summer one still marked everyone `re-signed`, so
    summer two skipped them all -- while reporting the *previous* year's
    expiring count as though it were this year's."""

    def test_a_new_season_starts_a_fresh_record(self):
        lg = league()
        force_champion(lg)
        franchise.begin(lg)
        first = franchise.state(lg)
        first.phase = franchise.Phase.COMPLETE
        for entry in first.expected:
            entry.resolved = "re-signed"
        first_ids = {e.holder_id for e in first.expected}

        # The league rolls on.
        lg.season = "2027-28"
        second = franchise.begin(lg)

        self.assertEqual(second.season, "2027-28")
        self.assertEqual(second.signings, [])
        self.assertTrue(all(not e.resolved for e in second.expected),
                        "carried a resolution over from last summer")
        self.assertNotEqual(second.expected, first.expected)
        del first_ids

    def test_the_same_season_is_still_refused(self):
        lg = league()
        force_champion(lg)
        franchise.begin(lg)
        state = franchise.state(lg)
        state.phase = franchise.Phase.NEGOTIATIONS
        again = franchise.begin(lg)
        self.assertIs(again.phase, franchise.Phase.NEGOTIATIONS)


# --------------------------------------------------------------------------
# Negotiating
# --------------------------------------------------------------------------

class TestWhatAPlayerAsksFor(unittest.TestCase):

    def setUp(self):
        self.lg = league()
        self.team = next(iter(self.lg.teams.values()))
        self.player = max(self.team.players, key=lambda p: p.ability.current)
        self.where = N.situation(self.lg, self.team, self.player)

    def personality(self, **traits):
        person = N.Personality(**{**{"loyalty": 50.0, "money_desire": 50.0,
                                     "winning_desire": 50.0,
                                     "playing_time_desire": 50.0}, **traits})
        self.player.negotiation = person
        return person

    def test_money_motivated_players_ask_for_more(self):
        self.personality(money_desire=95.0)
        greedy = N.asking_salary(self.player, self.where)
        self.personality(money_desire=5.0)
        modest = N.asking_salary(self.player, self.where)
        self.assertGreater(greedy, modest)

    def test_a_loyal_player_gives_his_own_club_a_discount(self):
        self.personality(loyalty=95.0)
        home = N.asking_salary(self.player, self.where)
        away = N.asking_salary(
            self.player, N.Situation(team_id="x", contender=self.where.contender,
                                     role=self.where.role, incumbent=False))
        self.assertLess(home, away, "loyalty is worth nothing to a rival")

    def test_a_contender_earns_a_discount_from_someone_who_wants_to_win(self):
        self.personality(winning_desire=95.0)
        good = N.asking_salary(self.player, N.Situation(contender=0.85, role=0.8))
        bad = N.asking_salary(self.player, N.Situation(contender=0.15, role=0.8))
        self.assertLess(good, bad)

    def test_a_bench_role_costs_the_club_money(self):
        self.personality(playing_time_desire=90.0)
        starter = N.asking_salary(self.player, N.Situation(contender=0.5, role=0.9))
        reserve = N.asking_salary(self.player, N.Situation(contender=0.5, role=0.2))
        self.assertGreater(reserve, starter)

    def test_an_ask_is_always_a_deal_a_club_could_legally_make(self):
        for player in self.team.players:
            ask = N.asking_salary(player, N.situation(self.lg, self.team, player))
            self.assertGreaterEqual(ask, K.MINIMUM_SALARY, player.name)
            self.assertLessEqual(ask, K.max_salary(K.service_years(player)),
                                 player.name)

    def test_a_veteran_wants_the_years_while_they_are_offered(self):
        self.player.age = 36
        self.personality()
        _label, _shortest, longest = K.length_band(self.player)
        self.assertEqual(N.asking_years(self.player, self.where), longest)


class TestWhatHeSaysBack(unittest.TestCase):

    def setUp(self):
        self.lg = league()
        self.team = next(iter(self.lg.teams.values()))
        self.player = self.team.players[0]
        self.player.negotiation = N.Personality()
        self.where = N.situation(self.lg, self.team, self.player)
        self.ask = N.demand(self.player, self.where)

    def answer(self, factor, years=None):
        offer = N.Offer(years=years or self.ask.years,
                        salary=int(self.ask.salary * factor))
        return N.evaluate(self.player, self.where, offer)

    def test_a_full_offer_is_accepted(self):
        self.assertIs(self.answer(1.05).verdict, N.Verdict.ACCEPT)

    def test_a_derisory_offer_is_rejected(self):
        self.assertIs(self.answer(0.4).verdict, N.Verdict.REJECT)

    def test_the_middle_produces_a_counter(self):
        self.assertIs(self.answer(0.85).verdict, N.Verdict.COUNTER)

    def test_a_counter_sits_between_the_two_numbers(self):
        response = self.answer(0.85)
        self.assertIsNotNone(response.counter)
        self.assertLessEqual(response.counter.salary, self.ask.salary)
        self.assertGreaterEqual(response.counter.salary,
                                int(self.ask.salary * 0.85))

    def test_too_few_years_is_a_real_objection(self):
        """A deal two years shorter than he wanted is not a rounding error."""
        self.player.age = 36     # veteran: wants the longest deal going
        ask = N.demand(self.player, self.where)
        if ask.years < 2:
            self.skipTest("this player does not want multiple years")
        full = N.evaluate(self.player, self.where,
                          N.Offer(years=ask.years, salary=ask.salary))
        short = N.evaluate(self.player, self.where,
                           N.Offer(years=1, salary=ask.salary))
        self.assertIs(full.verdict, N.Verdict.ACCEPT)
        self.assertIsNot(short.verdict, N.Verdict.ACCEPT)

    def test_a_man_who_wants_minutes_cannot_be_bought_onto_the_bench(self):
        """The one hard no in the system. Checked before the money, so a
        maximum offer cannot buy him."""
        self.player.negotiation = N.Personality(playing_time_desire=95.0)
        buried = N.Situation(contender=0.5, role=0.05, incumbent=True)
        response = N.evaluate(self.player, buried,
                              N.Offer(years=5, salary=K.max_salary(10)))
        self.assertIs(response.verdict, N.Verdict.REJECT)
        self.assertIn("role", response.message)

    def test_every_response_says_something(self):
        for factor in (0.3, 0.6, 0.8, 0.9, 1.0, 1.4):
            response = self.answer(factor)
            self.assertTrue(response.message.strip())
            self.assertNotIn("None", response.message)


class TestPersonalitiesAreStableAndHidden(unittest.TestCase):

    def test_the_same_player_always_negotiates_the_same_way(self):
        first = N.generate(load_teams(1).teams[0].players[0])
        second = N.generate(load_teams(1).teams[0].players[0])
        self.assertEqual(first.to_dict(), second.to_dict())

    def test_loyalty_is_read_through_rather_than_invented(self):
        """Two loyalties that could disagree would be worse than none."""
        player = load_teams(1).teams[0].players[0]
        person = N.generate(player)
        self.assertAlmostEqual(person.loyalty,
                               N.from_attribute(player.hidden.loyalty), places=6)

    def test_traits_span_the_scale(self):
        people = [N.personality_of(p) for t in load_teams(8).teams
                  for p in t.players]
        for trait in ("loyalty", "money_desire", "winning_desire",
                      "playing_time_desire"):
            values = [getattr(x, trait) for x in people]
            self.assertLess(min(values), 30.0, trait)
            self.assertGreater(max(values), 70.0, trait)

    def test_the_negotiation_screen_does_not_ship_the_traits(self):
        """A manager who can read the four numbers is solving, not negotiating."""
        lg = league()
        force = None
        team = next(iter(lg.teams.values()))
        player = team.players[0]
        player.contract.years_remaining = 0
        entry = franchise.FreeAgent(holder_id=player.id, name=player.name,
                                    team_id=team.id)
        row = views.negotiation_row(lg, entry)
        blob = repr(row)
        for key in ("moneyDesire", "winningDesire", "playingTimeDesire", "loyalty"):
            self.assertNotIn(key, blob, f"{key} leaked to the client")
        del force

    def test_interest_is_shown_instead(self):
        lg = league()
        team = next(iter(lg.teams.values()))
        player = team.players[0]
        where = N.situation(lg, team, player)
        value = N.interest_in_returning(player, where)
        self.assertGreaterEqual(value, 0.0)
        self.assertLessEqual(value, 100.0)
        self.assertTrue(N.interest_label(value))

    def test_an_ordinary_player_at_an_ordinary_club_is_open_to_staying(self):
        """The anchor. At 42 the ordinary case read "Undecided" and two thirds
        of an expiring class looked like it was leaving."""
        player = load_teams(1).teams[0].players[0]
        player.negotiation = N.Personality()
        player.contract = None
        middling = N.Situation(contender=0.5, role=0.55, incumbent=True)
        self.assertEqual(N.interest_label(
            N.interest_in_returning(player, middling)), "Open to staying")


class TestTheAiNegotiatesByTheSameRules(unittest.TestCase):

    def setUp(self):
        self.lg = league()

    def test_most_players_are_re_signed_by_their_own_club(self):
        signed = walked = 0
        for team in self.lg.teams.values():
            for player in team.players:
                where = N.situation(self.lg, team, player)
                ok, _terms = N.auto_resolve(player, where)
                signed += ok
                walked += not ok
        self.assertGreater(signed, walked, "clubs are losing more than they keep")

    def test_but_not_everybody(self):
        """A club that re-signed everyone would leave free agency empty, which
        is what the ceiling in `auto_resolve` exists to prevent."""
        walked = 0
        for team in self.lg.teams.values():
            for player in team.players:
                ok, _terms = N.auto_resolve(player, N.situation(self.lg, team, player))
                walked += not ok
        self.assertGreater(walked, 0)

    def test_agreed_terms_are_within_what_the_club_thinks_he_is_worth(self):
        for team in self.lg.teams.values():
            for player in team.players:
                ok, terms = N.auto_resolve(player, N.situation(self.lg, team, player))
                if ok and terms is not None:
                    self.assertLessEqual(
                        terms.salary,
                        int(K.market_value(player) * N.AI_CEILING) + 1,
                        player.name)

    def test_it_is_deterministic(self):
        team = next(iter(self.lg.teams.values()))
        player = team.players[0]
        where = N.situation(self.lg, team, player)
        first = N.auto_resolve(player, where)
        second = N.auto_resolve(player, where)
        self.assertEqual(first[0], second[0])
        if first[1] and second[1]:
            self.assertEqual(first[1].salary, second[1].salary)


class TestAManagerOfferGoesThroughTheSameService(ChampionFixture):

    def setUp(self):
        self.lg = league()
        force_champion(self.lg)
        franchise.begin(self.lg)
        state = franchise.state(self.lg)
        self.assertTrue(state.expected, "nobody expired; nothing to negotiate")
        self.entry = state.expected[0]
        self.team = self.lg.teams[self.entry.team_id]
        self.player = self.team.player(self.entry.holder_id)

    def test_a_generous_offer_signs_him(self):
        result = franchise.negotiate(
            self.lg, self.player.id, self.entry.requested_years,
            int(self.entry.requested_salary * 1.15))
        self.assertEqual(result["verdict"], "accept")
        self.assertEqual(self.player.contract.years_remaining,
                         self.entry.requested_years)
        self.assertGreater(self.player.contract.salary, 0)

    def test_a_signing_is_recorded_as_a_transaction(self):
        franchise.negotiate(self.lg, self.player.id, self.entry.requested_years,
                            int(self.entry.requested_salary * 1.2))
        signings = franchise.state(self.lg).signings
        self.assertTrue(any(s.holder_id == self.player.id and s.by_manager
                            for s in signings))

    def test_a_signing_moves_payroll_immediately(self):
        before = P.player_payroll(self.team)
        franchise.negotiate(self.lg, self.player.id, self.entry.requested_years,
                            int(self.entry.requested_salary * 1.2))
        self.assertGreater(P.player_payroll(self.team), before)

    def test_an_insulting_offer_does_not(self):
        result = franchise.negotiate(self.lg, self.player.id, 1, K.MINIMUM_SALARY)
        self.assertIn(result["verdict"], ("reject", "counter"))
        self.assertTrue(self.player.contract.expired)

    def test_negotiating_with_somebody_who_is_not_expiring_is_an_error(self):
        signed = next(p for t in self.lg.teams.values() for p in t.players
                      if not p.contract.expired)
        result = franchise.negotiate(self.lg, signed.id, 3, 10_000_000)
        self.assertIn("error", result)

    def test_auto_resolve_leaves_a_manager_signing_alone(self):
        franchise.negotiate(self.lg, self.player.id, self.entry.requested_years,
                            int(self.entry.requested_salary * 1.2))
        agreed = self.player.contract.salary
        franchise.resolve_players(self.lg)
        self.assertEqual(self.player.contract.salary, agreed)


# --------------------------------------------------------------------------
# The pool
# --------------------------------------------------------------------------

class TestThePool(ChampionFixture):

    def setUp(self):
        self.lg = league()
        force_champion(self.lg)
        franchise.begin(self.lg)
        franchise.resolve_players(self.lg)
        franchise.resolve_coaches(self.lg)
        self.pool = franchise.fill_pool(self.lg)

    def test_it_holds_only_the_unsigned(self):
        for entry in self.pool:
            self.assertEqual(entry.resolved, "pool")

    def test_nobody_re_signed_is_in_it(self):
        signed = {s.holder_id for s in franchise.state(self.lg).signings}
        self.assertFalse(signed & {e.holder_id for e in self.pool})

    def test_an_unsigned_player_stays_on_his_roster(self):
        """The documented placeholder: there is no free agency to move him to,
        and a player vanishing from a squad would break a league with no
        mechanism to replace him."""
        for entry in self.pool:
            if entry.is_coach:
                continue
            team = self.lg.teams[entry.team_id]
            self.assertIsNotNone(team.player(entry.holder_id))

    def test_and_costs_his_club_nothing(self):
        for entry in self.pool:
            if entry.is_coach:
                continue
            player = self.lg.teams[entry.team_id].player(entry.holder_id)
            self.assertEqual(P.salary_of(player), 0, player.name)


class TestRetirementIsDecidedInOnePlace(unittest.TestCase):
    """The decision belongs to `progression`, which is where a career is
    modelled. `franchise` does the contractual half."""

    def test_a_retired_man_is_taken_out_of_the_pool(self):
        lg = league()
        state = franchise.state(lg)
        state.pool = [franchise.FreeAgent(holder_id="p1", name="A"),
                      franchise.FreeAgent(holder_id="p2", name="B")]
        state.expected = list(state.pool)
        franchise.apply_retirements(lg, [{"playerId": "p1", "name": "A"}])
        self.assertEqual([e.holder_id for e in state.pool], ["p2"])
        self.assertEqual(state.expected[0].resolved, "retired")

    def test_pressure_rises_with_wear_rings_bench_time_and_decline(self):
        from bballsim.progression import (
            CareerArc, CareerProfile, retirement_pressure)

        player = load_teams(1).teams[0].players[0]
        profile = CareerProfile(prime_age=27.0, athletic_peak=26.0,
                                arc=CareerArc.WORKHORSE, realisation=0.7,
                                peak_ca=player.ability.current)
        base = retirement_pressure(player, profile, minutes=2000.0, championships=0)

        player.health.wear = 90.0
        self.assertGreater(retirement_pressure(player, profile, minutes=2000.0), base)
        player.health.wear = 0.0

        self.assertGreater(
            retirement_pressure(player, profile, minutes=2000.0, championships=3),
            base, "rings should make a man likelier to stop")
        self.assertGreater(
            retirement_pressure(player, profile, minutes=0.0), base,
            "being out of the rotation should too")

        profile.peak_ca = player.ability.current * 1.6
        self.assertGreater(retirement_pressure(player, profile, minutes=2000.0),
                           base, "decline against his own peak should too")

    def test_no_single_factor_retires_anybody_on_its_own(self):
        from bballsim.progression import CareerProfile, CareerArc, retirement_pressure

        player = load_teams(1).teams[0].players[0]
        player.health.wear = 100.0
        profile = CareerProfile(prime_age=27.0, athletic_peak=26.0,
                                arc=CareerArc.WORKHORSE, realisation=0.7,
                                peak_ca=player.ability.current * 3)
        worst = retirement_pressure(player, profile, minutes=0.0, championships=3)
        self.assertLess(worst, 3.0, "pressure is a nudge, not a verdict")


class TestARetirementKnowsHowLongTheCareerWas(unittest.TestCase):
    """`seasons_played` counts summers *this save* has run, which is zero on a
    fresh league -- so a 36-year-old's retirement read as a one-season career
    and the newsroom's floor filtered every one of them out."""

    def test_career_length_comes_off_the_draft_class(self):
        from bballsim.league.offseason import career_seasons
        from bballsim.progression import CareerProfile, CareerArc

        player = load_teams(1).teams[0].players[0]
        profile = CareerProfile(prime_age=27.0, athletic_peak=26.0,
                                arc=CareerArc.WORKHORSE, realisation=0.7)
        profile.seasons_played = 0
        if player.bio.draft is None:
            self.skipTest("this player has no draft class")
        drafted = player.bio.draft.year
        self.assertEqual(career_seasons(player, profile, "2026-27"),
                         2026 - drafted + 1)

    def test_a_simulated_career_still_counts_if_it_is_longer(self):
        from bballsim.league.offseason import career_seasons
        from bballsim.progression import CareerProfile, CareerArc

        player = load_teams(1).teams[0].players[0]
        profile = CareerProfile(prime_age=27.0, athletic_peak=26.0,
                                arc=CareerArc.WORKHORSE, realisation=0.7)
        profile.seasons_played = 40
        self.assertEqual(career_seasons(player, profile, "2026-27"), 40)


# --------------------------------------------------------------------------
# The wire
# --------------------------------------------------------------------------

def summer_with_stories(lg: League) -> franchise.Offseason:
    """An offseason record with one of everything, built by hand."""
    state = franchise.state(lg)
    teams = list(lg.teams.values())
    state.season = lg.season
    state.expected = [
        franchise.FreeAgent(holder_id=p.id, name=p.name, team_id=teams[0].id,
                            previous_salary=p.contract.salary,
                            requested_years=3, requested_salary=p.contract.salary)
        for p in teams[0].players[:5]
    ]
    state.pool = state.expected[3:]
    for entry in state.pool:
        entry.resolved = "pool"
    state.signings = [
        franchise.Signing(holder_id=teams[0].players[0].id,
                          name=teams[0].players[0].name, team_id=teams[0].id,
                          years=4, salary=32_400_000),
        franchise.Signing(holder_id=teams[1].players[0].id,
                          name=teams[1].players[0].name, team_id=teams[1].id,
                          years=3, salary=24_000_000),
        franchise.Signing(holder_id=teams[0].coach.id, name=teams[0].coach.name,
                          team_id=teams[0].id, years=3, salary=6_400_000,
                          is_coach=True),
    ]
    state.retired = [{
        "playerId": teams[2].players[0].id, "name": teams[2].players[0].name,
        "teamId": teams[2].id, "age": 37, "ca": 96.4, "peakCa": 154.2,
        "seasons": 15,
    }]
    return state


class TestTheOffseasonWire(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.lg = league()
        cls.state = summer_with_stories(cls.lg)
        cls.stories = (news.retirements(cls.lg, cls.state)
                       + news.free_agency_wire(cls.lg, cls.state)
                       + news.contract_stories(cls.lg, cls.state)
                       + news.coach_stories(cls.lg, cls.state))

    def test_the_detectors_produced_something(self):
        self.assertGreaterEqual(len(self.stories), 4)
        self.assertGreaterEqual(len({s.category for s in self.stories}), 4)

    def test_every_number_came_from_the_data(self):
        """The rule the whole newsroom exists to keep. A salary is a number
        like any other."""
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

    def test_no_story_carries_an_unresolved_placeholder(self):
        for story in self.stories:
            text = story.headline + story.article
            for bad in ("None", "{", "}", "  "):
                self.assertNotIn(bad, text, story.id)

    def test_a_player_who_never_declined_is_not_told_he_did(self):
        """A player can finish level with his own peak -- most obviously in a
        league's first simulated summer, where `peak_ca` has only been set
        once. Asserting a decline anyway produced "peaked well above where it
        ended" two lines above "a decline of 0.0 points"."""
        state = summer_with_stories(self.lg)
        state.retired = [dict(state.retired[0], peakCa=93.0, ca=93.0)]
        story = news.retirements(self.lg, state)[0]
        self.assertNotIn("0.0 points", story.article)
        self.assertNotIn("peaked well above", story.article)
        self.assertIn("as good on the last day", story.article)

    def test_a_player_who_did_decline_is_told_so(self):
        state = summer_with_stories(self.lg)
        state.retired = [dict(state.retired[0], peakCa=154.2, ca=96.4)]
        story = news.retirements(self.lg, state)[0]
        self.assertIn("decline of", story.article)
        self.assertIn("57.8", story.figures)

    def test_both_shapes_still_meet_the_house_rules(self):
        for peak, final in ((93.0, 93.0), (154.2, 96.4)):
            state = summer_with_stories(self.lg)
            state.retired = [dict(state.retired[0], peakCa=peak, ca=final)]
            story = news.retirements(self.lg, state)[0]
            words = len(story.article.split())
            self.assertGreaterEqual(words, 150, f"{peak}->{final}: {words}")
            self.assertLessEqual(words, 300, f"{peak}->{final}: {words}")
            self.assertEqual(len(story.article.split("\n\n")), 3)
            for numeral in NUMERALS.findall(
                    " ".join((story.headline, story.subheadline,
                              story.summary, story.article))):
                self.assertIn(numeral, story.figures, f"{peak}->{final}")

    def test_a_short_career_is_not_a_retirement_story(self):
        self.state.retired = [{"playerId": "x", "name": "A B", "teamId": "",
                               "age": 24, "ca": 80.0, "peakCa": 85.0,
                               "seasons": 2}]
        self.assertEqual(news.retirements(self.lg, self.state), [])

    def test_a_career_ending_outranks_a_re_signing(self):
        state = summer_with_stories(self.lg)
        retirement = news.retirements(self.lg, state)[0]
        contract = news.contract_stories(self.lg, state)[0]
        self.assertGreater(retirement.importance, contract.importance)

    def test_the_feed_caps_each_category(self):
        state = summer_with_stories(self.lg)
        state.retired = state.retired * 9
        for index, row in enumerate(state.retired):
            state.retired[index] = dict(row, playerId=f"r{index}")
        self.lg.offseason = state
        feed = news.offseason_stories(self.lg)
        retirements = [s for s in feed if s.category == news.RETIREMENT]
        self.assertLessEqual(len(retirements), 5)
        self.assertGreater(len({s.category for s in feed}), 1)

    def test_a_league_with_no_summer_writes_nothing(self):
        fresh = league()
        self.assertEqual(news.offseason_stories(fresh), [])


# --------------------------------------------------------------------------
# The API shape
# --------------------------------------------------------------------------

class TestTheSummerSurvivesARestart(ChampionFixture):
    """Almost everything in an offseason record is something that has *stopped
    being true*: once a player re-signs, nothing left in the league says his
    contract was expiring. Those are events, and an event that is not written
    down is gone."""

    def setUp(self):
        from bballsim import save

        self.save = save
        self.lg = league()
        force_champion(self.lg)
        franchise.begin(self.lg)
        franchise.resolve_players(self.lg)
        franchise.fill_pool(self.lg)
        self.state = franchise.state(self.lg)

    def round_trip(self):
        import json

        blob = json.loads(json.dumps(self.save.dump_offseason(self.state)))
        return self.save.load_offseason(blob)

    def test_the_phase_comes_back(self):
        """Genuine state: reloading mid-summer has to put the manager back
        where he was, not at the start."""
        self.assertIs(self.round_trip().phase, self.state.phase)

    def test_every_expiring_entry_comes_back_with_its_resolution(self):
        back = self.round_trip()
        self.assertEqual([e.holder_id for e in back.expected],
                         [e.holder_id for e in self.state.expected])
        self.assertEqual([e.resolved for e in back.expected],
                         [e.resolved for e in self.state.expected])

    def test_signings_come_back_exactly(self):
        back = self.round_trip()
        self.assertEqual(
            [(s.holder_id, s.years, s.salary) for s in back.signings],
            [(s.holder_id, s.years, s.salary) for s in self.state.signings])

    def test_the_pool_comes_back(self):
        self.assertEqual([e.holder_id for e in self.round_trip().pool],
                         [e.holder_id for e in self.state.pool])

    def test_a_league_not_in_a_summer_writes_no_file(self):
        """A stale offseason.json would reopen the menu mid-season with a
        year-old expiring list. Absent is the correct representation."""
        self.state.phase = franchise.Phase.SEASON
        self.assertIsNone(self.save.dump_offseason(self.state))

    def test_writing_none_removes_an_existing_file(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "offseason.json"
            self.save.write_offseason(path, self.state)
            self.assertTrue(path.is_file())
            self.state.phase = franchise.Phase.SEASON
            self.save.write_offseason(path, self.state)
            self.assertFalse(path.is_file())


class TestContractsSurviveALeagueSave(unittest.TestCase):

    def test_a_contract_reloads_exactly(self):
        import json

        from bballsim import save

        saved = load_teams(4)
        K.generate_for_league(saved.teams, season=saved.season)
        K.generate_coaches_for_league(saved.teams, season=saved.season)
        for team in saved.teams:
            for player in team.players:
                N.personality_of(player)

        blob = json.loads(json.dumps(save._round(save.dump_league(
            saved.teams, name=saved.name, season=saved.season))))
        back = save.load_league(blob)

        originals = {p.id: p for t in saved.teams for p in t.players}
        checked = 0
        for team in back.teams:
            for player in team.players:
                was = originals[player.id].contract
                now = player.contract
                self.assertEqual(
                    (now.years, now.years_remaining, now.salary, now.contract_type),
                    (was.years, was.years_remaining, was.salary, was.contract_type),
                    player.id)
                checked += 1
            self.assertIsNotNone(team.coach.contract, team.id)
        self.assertEqual(checked, sum(len(t.players) for t in saved.teams))

    def test_a_league_with_no_contracts_writes_none(self):
        """Same rule as `career` and `health`: a league generated before
        contracts existed has to fingerprint exactly as it did."""
        from bballsim import save

        team = load_teams(1).teams[0]
        team.players[0].contract = None
        team.players[0].negotiation = None
        dumped = save.dump_player(team.players[0])
        self.assertNotIn("contract", dumped)
        self.assertNotIn("negotiation", dumped)

    def test_derived_contract_fields_are_not_written(self):
        """`Contract.to_dict` carries six fields that are functions of the four
        real ones. Writing them would put derived numbers in a save file."""
        from bballsim import save

        contract = K.Contract(years=4, years_remaining=2, salary=10_000_000)
        dumped = save.dump_contract(contract)
        for derived in ("expiring", "expired", "totalValue", "remainingValue",
                        "contractTypeLabel"):
            self.assertNotIn(derived, dumped)


class TestTheOffseasonView(ChampionFixture):

    def setUp(self):
        self.lg = league()
        force_champion(self.lg)
        franchise.begin(self.lg)
        self.view = views.offseason_view(self.lg)

    def test_it_says_which_screens_are_real(self):
        """A placeholder must not look implemented on one screen and not
        another, so the UI is told rather than guessing."""
        flags = self.view["implemented"]
        self.assertTrue(flags["negotiations"])
        self.assertFalse(flags["freeAgency"])
        self.assertFalse(flags["draft"])
        self.assertFalse(flags["trainingCamp"])

    def test_every_expiring_row_carries_what_the_screen_shows(self):
        self.assertTrue(self.view["expected"])
        for row in self.view["expected"]:
            for key in ("name", "teamName", "position", "age", "overall",
                        "ppg", "rpg", "apg", "interestLabel",
                        "requestedYears", "requestedSalary", "currentSalary"):
                self.assertIn(key, row)

    def test_rows_are_sorted_best_first(self):
        overalls = [row["overall"] for row in self.view["expected"]
                    if "overall" in row]
        self.assertEqual(overalls, sorted(overalls, reverse=True))

    def test_the_summer_is_labelled_with_the_season_that_finished(self):
        """After `advance` the league is already on next season, and reading
        the label off it put "2027-28 Offseason" at the top of a page reporting
        2026-27's business."""
        state = franchise.state(self.lg)
        state.season = "2026-27"
        self.lg.season = "2027-28"
        self.assertEqual(views.offseason_view(self.lg)["season"], "2026-27")

    def test_the_money_constants_are_shipped(self):
        money = self.view["money"]
        self.assertEqual(money["salaryCap"], K.SALARY_CAP)
        self.assertEqual(money["luxuryTax"], K.LUXURY_TAX_LINE)
        self.assertEqual(len(money["maxByService"]), 3)

    def test_payrolls_are_richest_first(self):
        totals = [row["total"] for row in self.view["payrolls"]]
        self.assertEqual(totals, sorted(totals, reverse=True))

    def test_a_squad_page_carries_salary_and_years(self):
        team = next(iter(self.lg.teams.values()))
        detail = views.player_detail(team.players[0])
        self.assertIn("contract", detail)
        self.assertIn("marketValue", detail)
        self.assertIn("salary", detail["contract"])
        self.assertIn("yearsRemaining", detail["contract"])

    def test_a_team_summary_carries_payroll(self):
        team = next(iter(self.lg.teams.values()))
        summary = views.team_summary(team)
        self.assertIn("payroll", summary)
        self.assertEqual(summary["payroll"]["players"], P.player_payroll(team))


if __name__ == "__main__":
    unittest.main()
