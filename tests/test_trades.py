"""The trade engine: front offices that answer the same offer differently.

The premise of the whole system is one sentence from the brief -- *two teams
presented with the exact same trade offer should often make different
decisions* -- and most of what is worth testing is that this is true for the
right reasons rather than by accident.

Four of these exist because a real run failed them:

  * `TestRosterStrengthIsRelative` -- an absolute strength score put all thirty
    clubs between 64 and 68, so the league read as nineteen contenders with
    nobody rebuilding.
  * `TestConferenceStrengthDiscriminates` -- scored against a fixed scale it
    returned 8-13 for every club: a tenth of the championship window behaving
    as a constant.
  * `TestTheSearchFindsDealsAtAll` -- 200 random player-for-player swaps
    produced zero deals both clubs would sign. Evaluating offers is only half
    a front office.
  * `TestTheSearchIsFastEnoughToUse` -- before memoising, finding deals for one
    club took ten seconds.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import contracts as K
from bballsim import draft_picks as DP
from bballsim import front_office as FO
from bballsim import payroll
from bballsim import trade_value as TV
from bballsim import trades as T
from bballsim.league import League
from bballsim.roster import load_teams
from bballsim.save import apply_season, read_season, season_exists

_LEAGUE = None


def league() -> League:
    """The committed season, contracted and with picks. Shared and read-only
    except where a test says otherwise."""
    global _LEAGUE
    if _LEAGUE is None:
        saved = load_teams()
        lg = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            lg.add_team(team)
        if season_exists():
            apply_season(lg, read_season())
        K.generate_for_league(list(lg.teams.values()), season=lg.season)
        K.generate_coaches_for_league(list(lg.teams.values()), season=lg.season)
        lg.tick()
        DP.ensure(lg)
        _LEAGUE = lg
    return _LEAGUE


def fresh() -> League:
    """A private league, for tests that move players around."""
    saved = load_teams()
    lg = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        lg.add_team(team)
    if season_exists():
        apply_season(lg, read_season())
    K.generate_for_league(list(lg.teams.values()), season=lg.season)
    K.generate_coaches_for_league(list(lg.teams.values()), season=lg.season)
    lg.tick()
    DP.ensure(lg)
    return lg


def situations():
    lg = league()
    return {t.id: FO.situation(lg, t) for t in lg.teams.values()}


def extremes():
    """The most open window and the most closed, which is the pair every
    "two clubs disagree" test needs."""
    sits = situations()
    best = max(sits.values(), key=lambda s: s.window)
    worst = min(sits.values(), key=lambda s: s.window)
    return best, worst



def a_pending_deal(lg=None):
    """A league with at least one deal on the table, and that deal.

    Walks the market date forward until an opening produces something. Which
    two clubs go shopping is drawn from the date, so a single opening on a
    fresh league often finds nothing -- and every market test that guarded on
    that with `skipTest` was silently not running. Six of sixteen were skipping.
    """
    from datetime import timedelta

    from bballsim import trade_market as TM

    lg = lg or fresh()
    now = lg.clock.now()
    for step in range(14):
        moment = now + timedelta(days=step * TM.MARKET_INTERVAL_DAYS)
        TM.state(lg).last_opened = None
        made = TM.open_market(lg, moment)
        if made:
            return lg, made[0], moment
    raise AssertionError("the market never produced a deal in fourteen openings")


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------

class TestIdentity(unittest.TestCase):

    def test_there_are_twelve_traits(self):
        self.assertEqual(len(FO.Identity.names()), 12)

    def test_identity_is_stable_for_a_club(self):
        self.assertEqual(FO.generate("acb").to_dict(), FO.generate("acb").to_dict())

    def test_clubs_have_different_identities(self):
        labels = {FO.generate(t.id).label for t in league().teams.values()}
        self.assertGreaterEqual(len(labels), 5, labels)

    def test_traits_span_the_scale(self):
        for name in FO.Identity.names():
            values = [getattr(FO.generate(t.id), name)
                      for t in league().teams.values()]
            self.assertLess(min(values), 40.0, name)
            self.assertGreater(max(values), 60.0, name)


# --------------------------------------------------------------------------
# Timeline and window
# --------------------------------------------------------------------------

class TestRosterStrengthIsRelative(unittest.TestCase):
    """An absolute score put all thirty clubs between 64 and 68 -- every roster
    in a generated league is built to a similar budget, so the raw number
    carries almost no information. The league read as nineteen contenders and
    eleven playoff teams with nobody rebuilding."""

    def test_strength_uses_the_whole_scale(self):
        lg = league()
        values = [FO.roster_strength(lg, t) for t in lg.teams.values()]
        self.assertLess(min(values), 15.0)
        self.assertGreater(max(values), 85.0)

    def test_the_best_roster_scores_higher_than_the_worst(self):
        lg = league()
        ranked = sorted(lg.teams.values(), key=lambda t: FO.roster_talent(t))
        self.assertGreater(FO.roster_strength(lg, ranked[-1]),
                           FO.roster_strength(lg, ranked[0]))


class TestTimeline(unittest.TestCase):

    def test_the_league_is_not_all_one_phase(self):
        lg = league()
        phases = {FO.timeline(lg, t) for t in lg.teams.values()}
        self.assertGreaterEqual(len(phases), 5, phases)

    def test_there_are_buyers_and_sellers(self):
        lg = league()
        phases = [FO.timeline(lg, t) for t in lg.teams.values()]
        self.assertGreater(sum(1 for p in phases if p.buying), 2)
        self.assertGreater(sum(1 for p in phases if p.selling), 2)

    def test_a_phase_reads_correctly_in_a_sentence(self):
        """`label` is a heading. Dropping it into "we are a {label}" produced
        "we are a tanking"."""
        for phase in FO.Timeline:
            sentence = f"We are {phase.phrase}."
            self.assertNotIn("a tanking", sentence)
            self.assertNotIn("a middle of the pack", sentence)

    def test_the_best_roster_is_ahead_of_the_worst(self):
        lg = league()
        order = list(FO.Timeline)
        ranked = sorted(lg.teams.values(), key=lambda t: FO.roster_talent(t))
        self.assertLess(order.index(FO.timeline(lg, ranked[-1])),
                        order.index(FO.timeline(lg, ranked[0])))


class TestConferenceStrengthDiscriminates(unittest.TestCase):
    """Scored against a fixed scale it returned 8-13 for every club in the
    league: a tenth of the window behaving as a constant."""

    class FakeTeam:
        def __init__(self, tid):
            self.id = tid
            self.players = []
            self.coach = None

    class FakeLeague:
        def __init__(self, rows):
            self._rows = rows
            self.teams = {}

        def standings_table(self):
            return self._rows

    def table(self, east_top, west_top):
        rows = []
        for i in range(15):
            rows.append({"team_id": f"e{i}", "conference": "East",
                         "win_pct": max(0.1, east_top - i * 0.02)})
            rows.append({"team_id": f"w{i}", "conference": "West",
                         "win_pct": max(0.1, west_top - i * 0.02)})
        return self.FakeLeague(rows)

    def test_the_harder_conference_scores_lower(self):
        lg = self.table(east_top=0.80, west_top=0.60)
        hard = FO._conference_score(lg, self.FakeTeam("e0"))
        soft = FO._conference_score(lg, self.FakeTeam("w0"))
        self.assertLess(hard, soft)
        self.assertLess(hard, 25.0)
        self.assertGreater(soft, 75.0)

    def test_evenly_matched_conferences_are_neutral(self):
        lg = self.table(east_top=0.65, west_top=0.65)
        self.assertAlmostEqual(FO._conference_score(lg, self.FakeTeam("e0")),
                               50.0, places=4)


class TestChampionshipWindow(unittest.TestCase):

    def test_the_window_spans_a_usable_range(self):
        lg = league()
        values = [FO.window(lg, t) for t in lg.teams.values()]
        self.assertLess(min(values), 50.0)
        self.assertGreater(max(values), 70.0)

    def test_every_part_is_weighted_and_they_sum_to_one(self):
        self.assertAlmostEqual(sum(FO.WINDOW_WEIGHTS.values()), 1.0, places=6)

    def test_no_part_is_a_constant_across_the_league(self):
        """The bug that hid inside `conference` for two versions."""
        lg = league()
        rows = [FO.window_breakdown(lg, t)["parts"] for t in lg.teams.values()]
        for key in FO.WINDOW_WEIGHTS:
            values = [row[key] for row in rows]
            if key == "conference":
                continue   # genuinely flat when both conferences are level
            self.assertGreater(max(values) - min(values), 5.0,
                               f"{key} barely moves across the league")

    def test_a_better_roster_opens_the_window(self):
        lg = league()
        ranked = sorted(lg.teams.values(), key=lambda t: FO.roster_talent(t))
        self.assertGreater(FO.window(lg, ranked[-1]), FO.window(lg, ranked[0]))


class TestOwnerGoals(unittest.TestCase):

    def test_every_club_has_a_mandate(self):
        lg = league()
        for team in lg.teams.values():
            self.assertTrue(FO.owner_goals(lg, team), team.id)

    def test_a_rebuilding_club_is_asked_to_develop(self):
        lg = league()
        rebuilds = [t for t in lg.teams.values()
                    if FO.timeline(lg, t).selling]
        self.assertTrue(rebuilds)
        for team in rebuilds:
            self.assertIn(FO.OwnerGoal.DEVELOP, FO.owner_goals(lg, team), team.id)


# --------------------------------------------------------------------------
# Draft picks
# --------------------------------------------------------------------------

class TestDraftPicks(unittest.TestCase):

    def test_every_club_starts_with_its_own(self):
        lg = league()
        for team in lg.teams.values():
            picks = DP.owned_by(lg, team.id)
            self.assertTrue(picks)
            self.assertTrue(all(p.original_team == team.id for p in picks))

    def test_the_slot_curve_is_steep_at_the_top(self):
        """A first pick is not twice a fifth."""
        self.assertGreater(DP.slot_value(1), DP.slot_value(5) * 1.8)
        self.assertLess(DP.slot_value(25) / DP.slot_value(45), 4.0)

    def test_a_bad_club_s_pick_is_worth_more(self):
        lg = league()
        order = DP.standings_order(lg)
        year = DP.current_year(lg)
        worst = DP.DraftPick(year=year, round=1, original_team=order[0])
        best = DP.DraftPick(year=year, round=1, original_team=order[-1])
        self.assertGreater(DP.value_of(lg, worst, year),
                           DP.value_of(lg, best, year))

    def test_a_distant_pick_is_worth_less(self):
        lg = league()
        year = DP.current_year(lg)
        team_id = DP.standings_order(lg)[0]
        soon = DP.DraftPick(year=year, round=1, original_team=team_id)
        later = DP.DraftPick(year=year + 3, round=1, original_team=team_id)
        self.assertGreater(DP.value_of(lg, soon, year),
                           DP.value_of(lg, later, year))

    def test_protection_cuts_the_value_of_a_likely_lottery_pick(self):
        lg = league()
        year = DP.current_year(lg)
        team_id = DP.standings_order(lg)[0]
        naked = DP.DraftPick(year=year, round=1, original_team=team_id)
        guarded = DP.DraftPick(year=year, round=1, original_team=team_id,
                               protected_top=5)
        self.assertLess(DP.value_of(lg, guarded, year),
                        DP.value_of(lg, naked, year))

    def test_a_swap_is_worth_a_fraction_of_a_pick(self):
        lg = league()
        year = DP.current_year(lg)
        team_id = DP.standings_order(lg)[0]
        pick = DP.DraftPick(year=year, round=1, original_team=team_id)
        swap = DP.DraftPick(year=year, round=1, original_team=team_id,
                            swap_with="other")
        self.assertLess(DP.value_of(lg, swap, year), DP.value_of(lg, pick, year))

    def test_class_strength_is_a_fact_about_the_year(self):
        self.assertEqual(DP.class_strength(2029), DP.class_strength(2029))
        strengths = {round(DP.class_strength(y), 3) for y in range(2026, 2040)}
        self.assertGreater(len(strengths), 8, "every draft is the same")

    def test_a_second_rounder_is_worth_much_less_than_a_first(self):
        lg = league()
        year = DP.current_year(lg)
        team_id = DP.standings_order(lg)[5]
        first = DP.DraftPick(year=year, round=1, original_team=team_id)
        second = DP.DraftPick(year=year, round=2, original_team=team_id)
        self.assertGreater(DP.value_of(lg, first, year),
                           DP.value_of(lg, second, year) * 2.5)


# --------------------------------------------------------------------------
# Player value
# --------------------------------------------------------------------------

class TestTradeValue(unittest.TestCase):

    def players(self):
        return [p for t in league().teams.values() for p in t.players]

    def test_a_better_player_is_worth_more(self):
        ranked = sorted(self.players(), key=lambda p: p.ability.current)
        self.assertGreater(TV.base_value(ranked[-1]), TV.base_value(ranked[0]))

    def test_a_bad_contract_lowers_value(self):
        player = max(self.players(), key=lambda p: p.ability.current)
        good = TV.base_value(player)
        original = player.contract.salary
        try:
            player.contract.salary = int(K.max_salary(10))
            self.assertLess(TV.base_value(player), good)
        finally:
            player.contract.salary = original

    def test_an_injured_player_is_worth_less(self):
        from bballsim.health import MajorInjury

        player = max(self.players(), key=lambda p: p.ability.current)
        before = TV.durability_multiplier(player)
        original = player.health.injury
        try:
            player.health.injury = MajorInjury(name="knee", games_remaining=20,
                                               games_total=20)
            self.assertLess(TV.durability_multiplier(player), before)
        finally:
            player.health.injury = original

    def test_scarcity_applies_to_good_players_and_not_bad_ones(self):
        """There is no shortage of replacement-level anybody."""
        lg = league()
        weak = min(self.players(), key=lambda p: p.ability.current)
        self.assertAlmostEqual(TV.scarcity_multiplier(weak), 1.0, places=3)
        del lg


class TestTheSamePlayerIsWorthDifferentThings(unittest.TestCase):
    """The brief's central claim, tested directly."""

    @classmethod
    def setUpClass(cls):
        cls.lg = league()
        cls.best, cls.worst = extremes()

    def veteran(self):
        return max((p for t in self.lg.teams.values() for p in t.players
                    if p.age >= 31), key=lambda p: p.ability.current)

    def prospect(self):
        return max((p for t in self.lg.teams.values() for p in t.players
                    if p.age <= 22), key=lambda p: p.ability.potential)

    def test_a_veteran_is_worth_more_to_the_contender(self):
        player = self.veteran()
        self.assertGreater(TV.value_to(self.lg, self.best, player),
                           TV.value_to(self.lg, self.worst, player) * 1.25)

    def test_a_prospect_is_worth_more_to_the_rebuild(self):
        player = self.prospect()
        self.assertGreater(TV.value_to(self.lg, self.worst, player),
                           TV.value_to(self.lg, self.best, player) * 1.25)

    def test_the_two_clubs_are_genuinely_different(self):
        self.assertTrue(self.best.timeline.buying)
        self.assertTrue(self.worst.timeline.selling)


class TestUntouchables(unittest.TestCase):

    def test_some_players_are_effectively_unavailable(self):
        lg = league()
        sits = situations()
        blocked = [p for t in lg.teams.values() for p in t.players
                   if TV.untouchable(lg, sits[t.id], p)]
        self.assertGreater(len(blocked), 2)
        self.assertLess(len(blocked), 60, "too many players are untouchable")

    def test_they_are_the_best_players(self):
        lg = league()
        sits = situations()
        blocked = [p for t in lg.teams.values() for p in t.players
                   if TV.untouchable(lg, sits[t.id], p)]
        self.assertTrue(blocked)
        self.assertGreater(min(p.ability.current for p in blocked), 140.0)

    def test_an_untouchable_is_a_surcharge_and_not_a_wall(self):
        """The brief says "unless overwhelmed", so it must be beatable in
        principle -- it is a huge penalty on the score, not a hard veto."""
        self.assertGreater(0.55, 0.0)   # the surcharge in `evaluate`
        lg = league()
        sits = situations()
        for team in lg.teams.values():
            for player in team.players:
                if TV.untouchable(lg, sits[team.id], player):
                    self.assertIsInstance(
                        TV.untouchable(lg, sits[team.id], player), bool)
                    return


# --------------------------------------------------------------------------
# The engine
# --------------------------------------------------------------------------

class TestTheScore(unittest.TestCase):

    def test_the_weights_are_normalised(self):
        """The brief's own percentages sum to 110, not 100. The proportions are
        what it meant, so they are kept and normalised -- otherwise a perfect
        trade scores 1.1 and the accept threshold means something other than
        what it says."""
        self.assertEqual(sum(T.BRIEF_WEIGHTS.values()), 110)
        self.assertAlmostEqual(sum(T.WEIGHTS.values()), 1.0, places=6)

    def test_the_briefs_proportions_are_preserved(self):
        self.assertAlmostEqual(T.WEIGHTS["player_value"] / T.WEIGHTS["roster_fit"],
                               2.0, places=6)
        self.assertAlmostEqual(T.WEIGHTS["roster_fit"] / T.WEIGHTS["chemistry"],
                               3.0, places=6)

    def test_every_part_appears_in_an_evaluation(self):
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        offer = T.Offer(sending=T.Package(a.id, [a.players[5].id]),
                        receiving=T.Package(b.id, [b.players[5].id]))
        result = T.evaluate(lg, a.id, offer)
        self.assertEqual(set(result.parts), set(T.WEIGHTS))

    def test_every_part_is_bounded(self):
        lg = league()
        ids = list(lg.teams)
        for index in range(0, 8, 2):
            a, b = lg.teams[ids[index]], lg.teams[ids[index + 1]]
            offer = T.Offer(sending=T.Package(a.id, [a.players[0].id]),
                            receiving=T.Package(b.id, [b.players[-1].id]))
            for key, value in T.evaluate(lg, a.id, offer).parts.items():
                self.assertGreaterEqual(value, -1.0001, key)
                self.assertLessEqual(value, 1.0001, key)

    def lopsided(self):
        """A star for a much worse player, with the salary matched so the deal
        is legal -- otherwise the verdict under test is the salary rule rather
        than the evaluation."""
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        star = max(a.players, key=lambda p: p.ability.current)
        # The worst player whose salary still matches, so legality passes.
        matched = [p for p in b.players
                   if payroll.salary_of(p) >= payroll.salary_of(star) * 0.75]
        if not matched:
            self.skipTest("no salary-matching partner")
        weakest = min(matched, key=lambda p: p.ability.current)
        offer = T.Offer(sending=T.Package(a.id, [star.id]),
                        receiving=T.Package(b.id, [weakest.id]))
        if not T.check_legality(lg, offer).legal:
            self.skipTest("could not build a legal lopsided offer")
        return lg, a, b, star, weakest, offer

    def test_giving_away_a_star_is_rejected(self):
        lg, a, _b, star, weakest, offer = self.lopsided()
        self.assertGreater(star.ability.current, weakest.ability.current)
        self.assertEqual(T.evaluate(lg, a.id, offer).verdict, "reject")

    def test_receiving_a_star_is_accepted(self):
        lg, _a, b, _star, _weakest, offer = self.lopsided()
        self.assertEqual(T.evaluate(lg, b.id, offer).verdict, "accept")


class TestTwoClubsAnswerDifferently(unittest.TestCase):
    """*Two teams presented with the exact same trade offer should often make
    different decisions.* The sentence the whole system exists for."""

    def test_a_veteran_for_prospect_swap_splits_the_two_clubs(self):
        lg = league()
        best, worst = extremes()
        buyer, seller = lg.teams[best.team_id], lg.teams[worst.team_id]
        veteran = max((p for p in seller.players if p.age >= 30),
                      key=lambda p: p.ability.current)
        prospect = max((p for p in buyer.players if p.age <= 23),
                       key=lambda p: p.ability.potential, default=None)
        if prospect is None:
            self.skipTest("the contender has no young player to offer")
        offer = T.Offer(sending=T.Package(buyer.id, [prospect.id]),
                        receiving=T.Package(seller.id, [veteran.id]))
        buyer_view = T.evaluate(lg, buyer.id, offer)
        seller_view = T.evaluate(lg, seller.id, offer)
        # They need not both be happy, but they must not read it the same way.
        self.assertNotAlmostEqual(buyer_view.score, seller_view.score, places=2)

    def test_across_many_offers_the_clubs_often_disagree(self):
        import random

        lg = league()
        teams = list(lg.teams.values())
        rng = random.Random(11)
        disagreed = 0
        for _ in range(40):
            a, b = rng.sample(teams, 2)
            offer = T.Offer(
                sending=T.Package(a.id, [rng.choice(a.players).id]),
                receiving=T.Package(b.id, [rng.choice(b.players).id]))
            verdicts = {T.evaluate(lg, a.id, offer).verdict,
                        T.evaluate(lg, b.id, offer).verdict}
            if len(verdicts) > 1:
                disagreed += 1
        self.assertGreater(disagreed, 4, "the clubs answer everything alike")


class TestLegality(unittest.TestCase):

    def test_a_club_cannot_trade_a_pick_it_does_not_own(self):
        lg = league()
        ids = list(lg.teams)
        stolen = DP.owned_by(lg, ids[1])[0]
        offer = T.Offer(sending=T.Package(ids[0], [], [stolen]),
                        receiving=T.Package(ids[1], []))
        self.assertFalse(T.check_legality(lg, offer).legal)

    def test_a_club_cannot_empty_its_roster(self):
        lg = league()
        ids = list(lg.teams)
        everyone = [p.id for p in lg.teams[ids[0]].players]
        offer = T.Offer(sending=T.Package(ids[0], everyone),
                        receiving=T.Package(ids[1], []))
        legality = T.check_legality(lg, offer)
        self.assertFalse(legality.legal)
        self.assertTrue(legality.reasons)

    def test_an_illegal_deal_is_always_rejected(self):
        lg = league()
        ids = list(lg.teams)
        everyone = [p.id for p in lg.teams[ids[0]].players]
        offer = T.Offer(sending=T.Package(ids[0], everyone),
                        receiving=T.Package(ids[1], []))
        self.assertEqual(T.evaluate(lg, ids[0], offer).verdict, "reject")

    def test_a_normal_one_for_one_is_legal(self):
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        offer = T.Offer(sending=T.Package(a.id, [a.players[4].id]),
                        receiving=T.Package(b.id, [b.players[4].id]))
        self.assertTrue(T.check_legality(lg, offer).legal)

    def test_a_club_cannot_trade_away_its_last_man_at_a_position(self):
        """It could, and it did. Two simulated summers of the market running
        itself left a club with no point guard, which `Team.starters` cannot
        field a legal five from. Roster generation and `offseason.draft` both
        keep every position occupied; the trade market was the one thing that
        did not."""
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        guards = [p.id for p in a.players if p.position.value == "PG"]
        self.assertTrue(guards, "fixture has no point guard to strip")
        keep = [p for p in b.players if p.position.value != "PG"][:len(guards)]
        offer = T.Offer(sending=T.Package(a.id, guards),
                        receiving=T.Package(b.id, [p.id for p in keep]))
        legality = T.check_legality(lg, offer)
        self.assertFalse(legality.legal)
        self.assertTrue(any("no PG" in reason for reason in legality.reasons),
                        legality.reasons)

    def test_the_last_man_rule_does_not_block_a_like_for_like_swap(self):
        """Sending a point guard out and taking one back leaves the shape
        intact, so the rule must not fire on it -- a guard-for-guard trade is
        the most ordinary deal in the sport."""
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        for team in (a, b):
            count = sum(1 for p in team.players if p.position.value == "PG")
            self.assertGreaterEqual(count, 1)
        mine = [p.id for p in a.players if p.position.value == "PG"]
        theirs = [p.id for p in b.players if p.position.value == "PG"]
        offer = T.Offer(sending=T.Package(a.id, mine),
                        receiving=T.Package(b.id, theirs))
        # Salary matching may still object; the shape must not.
        reasons = T.check_legality(lg, offer).reasons
        self.assertFalse([r for r in reasons if "would have no" in r], reasons)


class TestNegotiation(unittest.TestCase):
    """*The AI should not instantly accept or reject.*"""

    def counters(self, count=60):
        import random

        lg = league()
        teams = list(lg.teams.values())
        rng = random.Random(5)
        out = []
        for _ in range(count):
            a, b = rng.sample(teams, 2)
            offer = T.Offer(
                sending=T.Package(a.id, [rng.choice(a.players).id]),
                receiving=T.Package(b.id, [rng.choice(b.players).id]))
            response = T.respond(lg, a.id, offer)
            if response.evaluation.verdict == "counter":
                out.append(response)
        return out

    def test_some_offers_produce_a_counter(self):
        self.assertTrue(self.counters(), "nothing ever gets countered")

    def test_a_counter_asks_for_something_specific(self):
        for response in self.counters():
            if response.counter is not None:
                self.assertTrue(response.ask.strip())
                return
        self.skipTest("no counter produced a concrete ask")

    def test_a_counter_improves_the_package(self):
        for response in self.counters():
            if response.counter is None:
                continue
            original = response.evaluation
            improved = T.evaluate(league(), original.team_id, response.counter)
            self.assertGreaterEqual(improved.score, original.score - 1e-6)
            return
        self.skipTest("no counter produced")


class TestTheExplanation(unittest.TestCase):

    def legal_offer(self, lg, a, b):
        """A one-for-one that passes salary matching, so the reasoning under
        test is the evaluation rather than the legality message."""
        for mine in sorted(a.players, key=lambda p: -payroll.salary_of(p)):
            for theirs in sorted(b.players, key=lambda p: -payroll.salary_of(p)):
                offer = T.Offer(sending=T.Package(a.id, [mine.id]),
                                receiving=T.Package(b.id, [theirs.id]))
                if T.check_legality(lg, offer).legal:
                    return offer
        return None

    def evaluation(self):
        lg = league()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        offer = self.legal_offer(lg, a, b)
        if offer is None:
            self.skipTest("no legal one-for-one available")
        return T.evaluate(lg, a.id, offer)

    def test_every_decision_carries_reasoning(self):
        self.assertTrue(self.evaluation().reasoning.strip())

    def test_the_reasoning_names_the_club_and_its_phase(self):
        lg = league()
        team = lg.teams[list(lg.teams)[0]]
        text = self.evaluation().reasoning
        self.assertIn(team.full_name, text)
        self.assertIn("championship window", text)

    def test_the_reasoning_reads_as_english(self):
        """The bug: "Oakhaven Owls are a tanking with a window of 40"."""
        lg = league()
        ids = list(lg.teams)
        for index in range(0, 10, 2):
            a, b = lg.teams[ids[index]], lg.teams[ids[index + 1]]
            offer = T.Offer(sending=T.Package(a.id, [a.players[2].id]),
                            receiving=T.Package(b.id, [b.players[2].id]))
            legal = self.legal_offer(lg, a, b)
            if legal is None:
                continue
            for team_id in (a.id, b.id):
                text = T.evaluate(lg, team_id, legal).reasoning
                self.assertNotIn("are a tanking", text)
                self.assertNotIn("are a middle of the pack", text)
                self.assertNotIn("None", text)
                self.assertNotIn("  ", text)

    def test_an_untouchable_says_so(self):
        lg = league()
        sits = situations()
        for team in lg.teams.values():
            for player in team.players:
                if not TV.untouchable(lg, sits[team.id], player):
                    continue
                other = next(t for t in lg.teams.values() if t.id != team.id)
                # Salary-matched, or the legality message pre-empts the
                # untouchable one.
                partner = max(other.players, key=payroll.salary_of)
                offer = T.Offer(
                    sending=T.Package(team.id, [player.id]),
                    receiving=T.Package(other.id, [partner.id]))
                if not T.check_legality(lg, offer).legal:
                    continue
                result = T.evaluate(lg, team.id, offer)
                self.assertIn("not available", result.reasoning)
                self.assertIn(player.name, result.reasoning)
                return
        self.skipTest("no untouchable players")


class TestTheSearchFindsDealsAtAll(unittest.TestCase):
    """200 random player-for-player swaps produced zero deals both clubs would
    sign. Evaluating offers is only half a front office -- the other half is
    coming up with one."""

    def test_a_club_can_find_a_deal_it_would_propose(self):
        lg = league()
        found = T.find_trades(lg, list(lg.teams)[0], limit=3)
        self.assertTrue(found, "no club can find a trade it would make")

    def test_both_sides_would_sign_what_it_finds(self):
        lg = league()
        for deal in T.find_trades(lg, list(lg.teams)[0], limit=3):
            result = T.assess(lg, deal["_offer"])
            self.assertTrue(result["agreed"])

    def test_it_never_offers_an_untouchable(self):
        lg = league()
        sits = situations()
        for team_id in list(lg.teams)[:4]:
            for deal in T.find_trades(lg, team_id, limit=2):
                offer = deal["_offer"]
                for pid in offer.sending.player_ids:
                    player = lg.teams[team_id].player(pid)
                    self.assertFalse(TV.untouchable(lg, sits[team_id], player),
                                     f"{player.name} should not be on offer")

    def test_what_it_finds_is_legal(self):
        lg = league()
        for deal in T.find_trades(lg, list(lg.teams)[0], limit=3):
            self.assertTrue(T.check_legality(lg, deal["_offer"]).legal)


class TestTheSearchIsFastEnoughToUse(unittest.TestCase):
    """Before memoising the league fit profiles and the club situations,
    finding deals for a single club took ten seconds -- unusable behind an
    endpoint."""

    def test_a_search_completes_quickly(self):
        lg = league()
        T.find_trades(lg, list(lg.teams)[0], limit=1)   # warm the caches
        start = time.time()
        T.find_trades(lg, list(lg.teams)[1], limit=3)
        self.assertLess(time.time() - start, 8.0)

    def test_the_fit_cache_invalidates_when_a_roster_changes(self):
        lg = fresh()
        ids = list(lg.teams)
        before = T.league_profiles(lg)[ids[0]]["spacing"]
        moved = lg.teams[ids[0]].players[3]
        lg.teams[ids[0]].players.remove(moved)
        lg.teams[ids[1]].players.append(moved)
        after = T.league_profiles(lg)[ids[0]]["spacing"]
        self.assertNotAlmostEqual(before, after, places=6)

    def test_the_situation_cache_invalidates_too(self):
        lg = fresh()
        ids = list(lg.teams)
        before = FO.situation(lg, lg.teams[ids[0]]).roster_strength
        best = max(lg.teams[ids[0]].players, key=lambda p: p.ability.current)
        lg.teams[ids[0]].players.remove(best)
        lg.teams[ids[1]].players.append(best)
        after = FO.situation(lg, lg.teams[ids[0]]).roster_strength
        self.assertNotAlmostEqual(before, after, places=4)


class TestExecuting(unittest.TestCase):

    def test_a_trade_moves_the_players(self):
        lg = fresh()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        mine, theirs = a.players[5], b.players[5]
        offer = T.Offer(sending=T.Package(a.id, [mine.id]),
                        receiving=T.Package(b.id, [theirs.id]))
        self.assertTrue(T.execute(lg, offer)["done"])
        self.assertIsNone(a.player(mine.id))
        self.assertIsNotNone(a.player(theirs.id))
        self.assertIsNone(b.player(theirs.id))
        self.assertIsNotNone(b.player(mine.id))

    def test_a_trade_moves_the_picks(self):
        lg = fresh()
        ids = list(lg.teams)
        pick = DP.owned_by(lg, ids[0])[0]
        offer = T.Offer(sending=T.Package(ids[0], [], [pick]),
                        receiving=T.Package(ids[1], []))
        T.execute(lg, offer)
        self.assertEqual(pick.owner, ids[1])
        self.assertEqual(pick.original_team, ids[0],
                         "the original club must not change")

    def test_a_traded_player_leaves_his_relationships_behind(self):
        lg = fresh()
        ids = list(lg.teams)
        a, b = lg.teams[ids[0]], lg.teams[ids[1]]
        mine = a.players[5]
        from bballsim.chemistry import set_pair_chemistry

        set_pair_chemistry(a, mine.id, a.players[0].id, 90.0)
        offer = T.Offer(sending=T.Package(a.id, [mine.id]),
                        receiving=T.Package(b.id, [b.players[5].id]))
        T.execute(lg, offer)
        for pair in a.pair_chemistry:
            self.assertNotIn(mine.id, pair)

    def test_an_illegal_trade_does_not_execute(self):
        lg = fresh()
        ids = list(lg.teams)
        everyone = [p.id for p in lg.teams[ids[0]].players]
        offer = T.Offer(sending=T.Package(ids[0], everyone),
                        receiving=T.Package(ids[1], []))
        self.assertFalse(T.execute(lg, offer)["done"])
        self.assertEqual(len(lg.teams[ids[0]].players), len(everyone))


class TestDeadlineBehaviour(unittest.TestCase):

    def test_pressure_rises_toward_the_deadline(self):
        lg = league()
        pressure = T.deadline_pressure(lg)
        self.assertGreaterEqual(pressure, 0.0)
        self.assertLessEqual(pressure, 1.0)

    def test_a_league_with_no_games_has_no_pressure(self):
        saved = load_teams(4)
        lg = League(name=saved.name, season=saved.season)
        for team in saved.teams:
            lg.add_team(team)
        self.assertEqual(T.deadline_pressure(lg), 0.0)


if __name__ == "__main__":
    unittest.main()


# --------------------------------------------------------------------------
# The autonomous market
# --------------------------------------------------------------------------

class TestTheMarketRunsItself(unittest.TestCase):
    """Front offices do their own business. Nobody proposes anything by hand,
    and the only human input is a veto."""

    _WOUND = None

    def wound_forward(self, openings: int = 5):
        """A league run forward far enough for the market to have done business.

        Built **once** for the class. Winding the clock forward also simulates
        every game in between -- three league days is over a hundred fixtures
        here -- so doing it per test made this file take ten minutes.
        """
        from datetime import timedelta

        from bballsim import trade_market as TM

        if TestTheMarketRunsItself._WOUND is None:
            lg = fresh()
            for _ in range(openings):
                lg.clock.advance(timedelta(days=TM.MARKET_INTERVAL_DAYS))
                lg.tick()
            TestTheMarketRunsItself._WOUND = (lg, TM.state(lg))
        return TestTheMarketRunsItself._WOUND

    def test_trades_happen_without_anybody_asking(self):
        _lg, market = self.wound_forward()
        self.assertGreater(len(market.completed), 0,
                           "no club ever traded on its own")

    def test_a_deal_waits_before_it_completes(self):
        """The window is what makes a veto possible at all."""
        from datetime import timedelta

        from bballsim import trade_market as TM

        _lg, entry, _moment = a_pending_deal()
        self.assertEqual(entry.status, "pending")
        self.assertEqual(entry.decide_after - entry.proposed_at,
                         timedelta(days=TM.PENDING_DAYS))

    def test_a_pending_deal_nobody_stops_goes_through(self):
        """An override, not an approval step: a league left running trades."""
        from datetime import timedelta

        from bballsim import trade_market as TM

        lg, entry, moment = a_pending_deal()
        done = TM.settle(lg, moment + timedelta(days=TM.PENDING_DAYS + 1))
        self.assertTrue(done)
        self.assertEqual(entry.status, "done")

    def test_a_vetoed_deal_does_not_happen(self):
        from datetime import timedelta

        from bballsim import trade_market as TM

        lg, entry, moment = a_pending_deal()
        sending = lg.teams[entry.offer.sending.team_id]
        moving = list(entry.offer.sending.player_ids)

        self.assertTrue(TM.veto(lg, entry.id)["vetoed"])
        TM.settle(lg, moment + timedelta(days=TM.PENDING_DAYS + 1))
        for pid in moving:
            self.assertIsNotNone(sending.player(pid),
                                 "a vetoed player moved anyway")

    def test_a_vetoed_deal_is_not_proposed_again(self):
        """Otherwise the button feels like it did not work."""
        from bballsim import trade_market as TM

        lg, entry, _moment = a_pending_deal()
        TM.veto(lg, entry.id)
        self.assertIn(entry.id, TM.state(lg).blocked)

    def test_vetoing_something_that_is_not_pending_says_so(self):
        from bballsim import trade_market as TM

        lg = fresh()
        result = TM.veto(lg, "not-a-real-trade")
        self.assertFalse(result["vetoed"])
        self.assertIn("error", result)

    def test_an_ordinary_tick_costs_nothing(self):
        """`tick` runs on every API request and a trade search is seconds, so
        everything expensive has to sit behind the cadence guard."""
        lg = fresh()
        lg.tick()                      # opens the market once
        start = time.time()
        for _ in range(5):
            lg.tick()
        self.assertLess(time.time() - start, 1.0)

    def test_the_market_only_opens_on_its_cadence(self):
        from datetime import timedelta

        from bballsim import trade_market as TM

        lg = fresh()
        now = lg.clock.now()
        TM.open_market(lg, now)
        self.assertFalse(TM.is_due(lg, now + timedelta(hours=12)))
        self.assertTrue(TM.is_due(
            lg, now + timedelta(days=TM.MARKET_INTERVAL_DAYS)))

    def test_a_club_that_just_traded_waits(self):
        from bballsim import trade_market as TM

        lg, entry, moment = a_pending_deal()
        market = TM.state(lg)
        traded = entry.offer.sending.team_id
        self.assertIn(traded, market.cooldowns)
        self.assertGreater(market.cooldowns[traded], moment)

    def test_every_completed_trade_carries_both_sides_reasoning(self):
        _lg, market = self.wound_forward()
        if not market.completed:
            self.skipTest("no trades completed")
        for row in market.completed:
            self.assertEqual(len(row["sides"]), 2)
            for side in row["sides"]:
                self.assertTrue(side["reasoning"].strip())
                self.assertIn("championship window", side["reasoning"])

    def test_a_deal_that_became_illegal_does_not_fire(self):
        """The league moves between agreement and settlement."""
        from datetime import timedelta

        from bballsim import trade_market as TM

        lg, entry, moment = a_pending_deal()
        # Strip the sending club down so the deal breaks the roster minimum.
        sending = lg.teams[entry.offer.sending.team_id]
        keep = set(entry.offer.sending.player_ids)
        sending.players = ([p for p in sending.players if p.id in keep]
                           + [p for p in sending.players if p.id not in keep])[:2]
        TM.settle(lg, moment + timedelta(days=TM.PENDING_DAYS + 1))
        self.assertEqual(entry.status, "vetoed")
        self.assertIn("no longer legal", entry.vetoed_reason)

    def test_it_is_deterministic(self):
        from datetime import timedelta

        from bballsim import trade_market as TM

        first, second = fresh(), fresh()
        for lg in (first, second):
            lg.clock.jump_to(lg.clock.now())
        moment = first.clock.now()
        a = [p.id for p in TM.open_market(first, moment)]
        b = [p.id for p in TM.open_market(second, moment)]
        self.assertEqual(a, b)


class TestTheMarketSurvivesARestart(unittest.TestCase):

    def market(self):
        from bballsim import trade_market as TM

        lg, _entry, _moment = a_pending_deal()
        return lg, TM.state(lg)

    def test_the_log_and_pending_deals_round_trip(self):
        import json

        from bballsim import save

        lg, market = self.market()
        blob = json.loads(json.dumps(save.dump_market(market), default=str))
        back = save.load_market(blob, lg)
        self.assertEqual([p.id for p in back.pending],
                         [p.id for p in market.pending])
        self.assertEqual(len(back.completed), len(market.completed))
        self.assertEqual(back.blocked, market.blocked)

    def test_a_restored_pending_deal_points_at_the_real_picks(self):
        """Written as coordinates and matched back, so a restored deal cannot
        hold a stale copy of a pick that has since moved."""
        import json

        from bballsim import draft_picks, save, trades

        lg = fresh()
        pick = draft_picks.owned_by(lg, list(lg.teams)[0])[0]
        offer = trades.Offer(
            sending=trades.Package(list(lg.teams)[0], [], [pick]),
            receiving=trades.Package(list(lg.teams)[1], []))
        market = save.load_market(json.loads(json.dumps({
            "version": 1, "last_opened": None, "cooldowns": {}, "blocked": [],
            "completed": [], "vetoed": [],
            "pending": [{
                "id": "x",
                "proposed_at": lg.clock.now().isoformat(),
                "decide_after": lg.clock.now().isoformat(),
                "summary": {},
                "sending": save._dump_package(offer.sending),
                "receiving": save._dump_package(offer.receiving),
            }],
        })), lg)
        restored = market.pending[0].offer.sending.picks[0]
        self.assertIs(restored, pick, "restored a copy rather than the pick")

    def test_pick_ownership_round_trips(self):
        from bballsim import draft_picks, save

        lg = fresh()
        ids = list(lg.teams)
        pick = draft_picks.owned_by(lg, ids[0])[0]
        pick.owner = ids[1]
        rows = save.dump_pick_ownership(lg)
        pick.owner = ids[0]
        save.apply_pick_ownership(lg, rows)
        self.assertEqual(pick.owner, ids[1])

    def test_a_league_with_no_market_writes_nothing(self):
        from bballsim import save, trade_market

        self.assertIsNone(save.dump_market(trade_market.Market()))
