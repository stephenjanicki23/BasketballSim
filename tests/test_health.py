"""Fatigue, wear and injuries.

The brief's central demand is that **fatigue matters more than injuries**, and
most of what is worth testing here is that claim rather than any one formula:
tiredness should be constant, visible and expensive, and serious injury should
be rare.

Two of these tests exist because the first calibration run failed them, and
both failures were invisible from the code:

  * `TestRestIsSpentInTheOrderItIsEarned` -- recovery used to be paid out in a
    lump per tick, so a season fast-forwarded to its end handed every player
    the whole season's rest and then played the games into it. An 82-game year
    finished at a mean fatigue of 0.8.
  * `TestTheSpreadSurvivesTheSchedule` -- the flat back-to-back charge used to
    be large, and back when every game was a back-to-back that is not a penalty
    for a hard schedule, it is a tax on everybody that squeezes out the gap
    between a starter and a reserve. The league pinned at Critical Fatigue to a
    man.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import composites as C
from bballsim import health as H
from bballsim.league import League, offseason
from bballsim.league.calendar import build_daily_schedule
from bballsim.roster import load_teams

_CACHE: dict[int, League] = {}


def played(games_per_team: int = 20) -> League:
    if games_per_team in _CACHE:
        return _CACHE[games_per_team]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
    league.tick()
    _CACHE[games_per_team] = league
    return league


def squad(league):
    return [p for t in league.teams.values() for p in t.players]


class TestTheBands(unittest.TestCase):
    """The brief's own ladder, which is the specification."""

    def test_fatigue_reads_the_brief_s_ladder(self):
        for value, expected in ((0, "Fully Rested"), (15, "Fully Rested"),
                                (16, "Fresh"), (30, "Fresh"),
                                (31, "Slightly Tired"), (45, "Slightly Tired"),
                                (46, "Noticeable Fatigue"), (60, "Noticeable Fatigue"),
                                (61, "Heavy Fatigue"), (75, "Heavy Fatigue"),
                                (76, "Exhausted"), (90, "Exhausted"),
                                (91, "Critical Fatigue"), (100, "Critical Fatigue")):
            self.assertEqual(H.label_for(H.FATIGUE_BANDS, value), expected, value)

    def test_the_penalty_table_is_the_brief_s(self):
        for fatigue, expected in ((20, 0.1), (40, 1.0), (60, 2.0),
                                  (80, 3.5), (95, 5.0), (100, 6.0)):
            self.assertAlmostEqual(H.interpolate(H.PENALTY_CURVE, fatigue),
                                   expected, places=6, msg=fatigue)

    def test_the_penalty_only_ever_grows(self):
        last = -1.0
        for step in range(0, 101):
            value = H.interpolate(H.PENALTY_CURVE, step)
            self.assertGreaterEqual(value, last, step)
            last = value


class TestWhatFatigueCosts(unittest.TestCase):
    def setUp(self):
        self.player = load_teams(1).teams[0].players[0]

    def test_the_brief_s_worked_example(self):
        """40 costs a point off an athletic attribute, 60 two, 80 three-to-five."""
        self.assertAlmostEqual(H.penalty(40, "speed"), 1.4, places=2)
        self.assertAlmostEqual(H.penalty(60, "speed"), 2.8, places=2)
        self.assertGreaterEqual(H.penalty(80, "speed"), 3.0)
        self.assertLessEqual(H.penalty(80, "speed"), 5.0)

    def test_decision_making_is_only_nudged(self):
        """The brief marks it "(small)" and everything else on the list is not."""
        self.assertLess(H.penalty(80, "decision_making"), 1.5)
        self.assertLess(H.penalty(80, "decision_making"),
                        H.penalty(80, "speed") / 3.0)

    def test_the_head_is_left_alone(self):
        """Basketball IQ, leadership, professionalism, passing vision and
        experience. A tired player still reads the floor."""
        for attribute in ("offensive_awareness", "defensive_awareness",
                          "spatial_awareness", "anticipation", "defensive_iq",
                          "assist_iq", "leadership", "work_rate", "teamwork",
                          "coachability", "composure", "mental_toughness",
                          "passing", "court_vision"):
            self.assertEqual(H.penalty(100, attribute), 0.0, attribute)

    def test_a_gassed_player_is_a_worse_player(self):
        fresh = {name: fn(self.player) for name, fn in (
            ("perimeter", C.perimeter_defense), ("rim", C.shooting_rim),
            ("glass", C.defensive_rebounding))}
        self.player.condition = 20.0
        for name, fn in (("perimeter", C.perimeter_defense), ("rim", C.shooting_rim),
                         ("glass", C.defensive_rebounding)):
            self.assertLess(fn(self.player), fresh[name], name)

    def test_a_fresh_player_is_exactly_himself(self):
        """No penalty at all when there is nothing to pay -- an engine that
        quietly shaved a tenth off every composite would move every calibration
        in the project."""
        self.player.condition = 100.0
        for attribute in H.FATIGUE_WEIGHTS:
            self.assertEqual(H.effective(self.player, attribute),
                             getattr(self.player.ratings, attribute), attribute)

    def test_an_attribute_never_falls_off_the_scale(self):
        self.player.condition = 0.0
        self.player.health.knock = 100.0
        for attribute in H.FATIGUE_WEIGHTS:
            self.assertGreaterEqual(H.effective(self.player, attribute), 1.0, attribute)


class TestTheBridge(unittest.TestCase):
    """Season fatigue reaches a game in exactly one place."""

    def setUp(self):
        self.player = load_teams(1).teams[0].players[0]

    def test_a_rested_player_starts_at_full(self):
        self.assertEqual(H.starting_condition(self.player), 100.0)

    def test_a_tired_player_starts_the_night_already_down(self):
        self.player.health.fatigue = 70.0
        start = H.starting_condition(self.player)
        self.assertLess(start, 100.0)
        self.assertGreater(start, 25.0)

    def test_it_never_starts_a_man_on_the_floor(self):
        """Starting at condition 5 would have him substituted in the first
        timeout of every game he ever played, which is not fatigue modelling,
        it is a bug with a plausible cause."""
        self.player.health.fatigue = 100.0
        self.player.health.knock = 100.0
        self.assertGreaterEqual(H.starting_condition(self.player), 25.0)


class TestTheCoachActuallyRestsPeople(unittest.TestCase):
    """The bug that made the rest lever inert.

    `plan_rest` compares `projected_loss` -- what a man would be down *at
    tip-off* -- against `rest_threshold`. The threshold had been calibrated
    against `ability_lost` read at a player's *live* mid-game condition, where
    losses run 7 to 23. Projected losses run 0 to about 9, and the lowest
    threshold any coach in the league could reach was 5.0.

    So no coach ever rested anybody, in any game ever simulated, and nothing in
    the code showed it: both halves were individually sensible, they just were
    not denominated in the same thing. These tests hold the two scales
    together, and they are written against the ratings the league actually
    generates rather than against 0-100, because that is where the bug lived.
    """

    def setUp(self):
        self.league = played()
        self.losses = sorted(H.projected_loss(p) for p in squad(self.league))
        self.ratings = sorted(
            (t.coach.ratings.player_management if t.coach else 50.0)
            for t in self.league.teams.values())

    def median_loss(self):
        return self.losses[len(self.losses) // 2]

    def test_the_threshold_is_denominated_in_what_plan_rest_measures(self):
        """The one that would have caught it: the hardest coach in the league
        has to have a threshold a real player can actually cross."""
        hardest = H.rest_threshold(self.ratings[-1])
        self.assertLess(hardest, self.losses[-1],
                        "no player in the league is ever tired enough to be "
                        "rested by anybody -- the threshold and the "
                        "measurement are on different scales")

    def test_it_is_not_so_low_that_everybody_sits(self):
        """The other side of the same wall. A threshold under the league's
        median projected loss would have half the league rested every night."""
        softest = H.rest_threshold(self.ratings[0])
        self.assertGreater(softest, self.median_loss())

    def test_somebody_gets_a_night_off(self):
        resting = {t.id: H.plan_rest(t) for t in self.league.teams.values()}
        clubs = sum(1 for who in resting.values() if who)
        self.assertGreater(clubs, 0, "the rest lever never fires")
        self.assertLess(clubs, len(resting),
                        "every club in the league is resting somebody")

    def test_the_rating_changes_the_answer(self):
        """A `player_management` rating that produced the same team sheet at
        both ends of the league's range would not be a rating."""
        low, high = self.ratings[0], self.ratings[-1]
        self.assertGreater(H.rest_threshold(low), H.rest_threshold(high))
        self.assertGreater(H.rest_threshold(low) - H.rest_threshold(high), 0.5,
                           "the best and worst coaches in the league are "
                           "separated by less than a rounding error")

    def test_a_club_never_sits_more_than_the_cap(self):
        for team in self.league.teams.values():
            self.assertLessEqual(len(H.plan_rest(team)), H.MAX_RESTED_PER_GAME,
                                 team.id)

    def test_nobody_is_rested_out_of_a_playoff_game(self):
        for team in self.league.teams.values():
            self.assertEqual(H.plan_rest(team, playoff=True), set(), team.id)

    def test_the_manager_overrules_the_coach_anywhere(self):
        team = next(iter(self.league.teams.values()))
        pick = team.rotation()[0]
        team.rested = [pick.id]
        try:
            self.assertIn(pick.id, H.plan_rest(team))
            self.assertIn(pick.id, H.plan_rest(team, playoff=True))
        finally:
            team.rested = []

    def test_the_twelfth_man_is_not_worth_resting(self):
        for team in self.league.teams.values():
            bench = {p.id for p in team.rotation()[H.REST_MINIMUM_ROLE:]}
            self.assertEqual(H.plan_rest(team) & bench, set(), team.id)

    def test_the_floor_keeps_the_most_protective_coach_honest(self):
        self.assertGreater(H.rest_threshold(100.0), 0.0)
        self.assertGreaterEqual(H.rest_threshold(100.0), H.REST_THRESHOLD_FLOOR)


class TestRestIsSpentInTheOrderItIsEarned(unittest.TestCase):
    """The bug that made the whole system do nothing.

    Recovery used to be handed out once per `tick`, for the entire span the
    clock had jumped. Playing a season in one tick therefore paid out the
    season's rest *first* and played the games into it afterwards, so load had
    nothing to accumulate against.
    """

    def test_a_season_played_in_one_jump_still_tires_people(self):
        league = played()
        peaks = [p.health.fatigue for p in squad(league)]
        self.assertGreater(max(peaks), 40.0,
                           "nobody got tired across a whole season")

    def test_a_short_gap_leaves_more_fatigue_than_a_long_one(self):
        saved = load_teams(2)
        player = saved.teams[0].players[0]
        player.health.fatigue = 50.0
        H.rest(player, 1 * H.HOURS_PER_DAY)      # back-to-back
        crowded = player.health.fatigue

        player.health.fatigue = 50.0
        H.rest(player, 3 * H.HOURS_PER_DAY)      # three days off
        spaced = player.health.fatigue

        self.assertGreater(crowded, spaced)

    def test_recovery_is_never_negative_and_never_overshoots(self):
        """A four-month summer used to drive fatigue thousands of points below
        zero and leave the clamp doing the modelling."""
        player = load_teams(1).teams[0].players[0]
        player.health.fatigue = 4.0
        H.rest(player, 24.0 * 120)
        self.assertGreaterEqual(player.health.fatigue, 0.0)
        self.assertLessEqual(player.health.fatigue, 4.0)


class TestTheRestGapIsDrawnNotRead(unittest.TestCase):
    """The fixture list is a viewing calendar, not a basketball schedule.

    Three slates a day and 82 games in 28 days means a club's games sit about
    five hours apart on the real clock. No professional plays that, so the
    health model draws its own gap instead of reading one off the clock.
    """

    def test_the_same_fixture_always_gives_the_same_gap(self):
        first = H.rest_gap("BOS", "g-0412")
        for _ in range(5):
            self.assertEqual(H.rest_gap("BOS", "g-0412"), first)

    def test_two_clubs_in_the_same_fixture_can_get_different_gaps(self):
        pairs = [("t%02d" % i, "t%02d" % (i + 1)) for i in range(0, 20, 2)]
        differ = any(H.rest_gap(home, "g-1") != H.rest_gap(away, "g-1")
                     for home, away in pairs)
        self.assertTrue(differ, "the gap does not depend on the club")

    def test_the_draw_matches_its_weights(self):
        counts = {days: 0 for days, _ in H.REST_GAP_WEIGHTS}
        draws = 20000
        for i in range(draws):
            counts[H.rest_gap("t%02d" % (i % 30), "g-%05d" % i)] += 1
        for days, weight in H.REST_GAP_WEIGHTS:
            self.assertAlmostEqual(counts[days] / draws, weight, delta=0.02,
                                   msg=f"{days}-day gaps")

    def test_a_back_to_back_is_the_occasional_one(self):
        """A real season has a dozen or so, not forty and not none."""
        share = dict(H.REST_GAP_WEIGHTS)[1]
        self.assertGreater(share * 82, 8)
        self.assertLess(share * 82, 20)

    def test_the_mean_gap_is_the_two_or_three_days_that_was_asked_for(self):
        self.assertGreater(H.MEAN_REST_GAP, 2.0)
        self.assertLess(H.MEAN_REST_GAP, 3.0)

    def test_the_weights_are_a_distribution(self):
        self.assertAlmostEqual(sum(w for _, w in H.REST_GAP_WEIGHTS), 1.0, places=6)


class TestTheSpreadSurvivesTheSchedule(unittest.TestCase):
    """A starter has to end up more tired than a reserve.

    Rest gaps are drawn per club per game, so the flat charges land on some
    nights and not others. If a charge is large enough to dominate the minutes
    term it becomes a tax on everybody rather than a penalty for a hard
    schedule, and it flattens exactly the difference the system exists to show.
    """

    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.lines = cls.league.stats.players

    def minutes(self, player):
        line = self.lines.get(player.id)
        return line.minutes / max(1, line.games) if line and line.games else 0.0

    def test_heavy_minutes_are_more_tiring_than_light_ones(self):
        heavy = [p.health.fatigue for p in squad(self.league)
                 if self.minutes(p) >= 26 and not p.injured]
        light = [p.health.fatigue for p in squad(self.league)
                 if 0 < self.minutes(p) <= 16 and not p.injured]
        self.assertTrue(heavy and light, "no split to compare")
        self.assertGreater(sum(heavy) / len(heavy), sum(light) / len(light))

    def test_the_league_does_not_pin_at_one_end_of_the_scale(self):
        fatigue = [p.health.fatigue for p in squad(self.league) if not p.injured]
        average = sum(fatigue) / len(fatigue)
        self.assertGreater(average, 8.0, "the scale is doing nothing")
        self.assertLess(average, 88.0, "everybody is exhausted")

    def test_more_than_one_band_is_in_use(self):
        bands = {H.label_for(H.FATIGUE_BANDS, p.health.fatigue)
                 for p in squad(self.league)}
        self.assertGreaterEqual(len(bands), 3, sorted(bands))


class TestInjuriesAreRare(unittest.TestCase):
    """The brief's other half: serious injury should be uncommon enough that a
    manager loses games to his own rotation choices rather than to dice."""

    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.players = squad(cls.league)

    def test_most_of_the_league_gets_through_the_season(self):
        hurt = [p for p in self.players if p.health.games_missed]
        self.assertLess(len(hurt), len(self.players) * 0.30,
                        "a third of the league is in the treatment room")

    def test_a_major_injury_rules_a_player_out(self):
        """`Player.injured` gates `available_players`, and therefore the
        rotation and the starting five. It had no writer before this."""
        for player in self.players:
            self.assertEqual(player.injured, player.health.injury is not None,
                             player.id)
        for team in self.league.teams.values():
            for player in team.available_players():
                self.assertIsNone(player.health.injury, player.id)

    def test_a_knock_does_not_rule_anybody_out(self):
        """By design: a knock is a performance cost, which is what keeps the
        decision with the manager instead of the physio."""
        player = load_teams(1).teams[0].players[0]
        player.health.knock = 90.0
        H.sync(player)
        self.assertFalse(player.injured)
        self.assertTrue(player.health.available)

    def test_tiredness_and_mileage_raise_the_risk(self):
        player = load_teams(1).teams[0].players[0]
        base = H.risk_multiplier(player, 30.0)
        player.health.fatigue = 95.0
        tired = H.risk_multiplier(player, 30.0)
        player.health.wear = 60.0
        worn = H.risk_multiplier(player, 30.0)
        self.assertGreater(tired, base * 1.5)
        self.assertGreater(worn, tired)

    def test_you_cannot_get_hurt_on_the_bench(self):
        player = load_teams(1).teams[0].players[0]
        self.assertEqual(H.roll_injury(player, 0.0, "seed"), (None, None))
        self.assertEqual(H.risk_multiplier(player, 0.0), 0.0)

    def test_the_same_season_produces_the_same_injuries(self):
        """Everything else here is reproducible; an injury list that changed on
        reload would be the one thing that was not."""
        player = load_teams(1).teams[0].players[0]
        first = [H.roll_injury(player, 32.0, f"g{i}-p") for i in range(200)]
        again = [H.roll_injury(player, 32.0, f"g{i}-p") for i in range(200)]
        self.assertEqual([k for k, _ in first], [k for k, _ in again])


class TestWearAndTear(unittest.TestCase):
    def test_a_season_of_heavy_minutes_is_worth_single_digits(self):
        """It is a career quantity. If one season moved it 40 points, a
        thirty-year-old would be unplayable."""
        league = played()
        wear = [p.health.wear for p in squad(league)]
        self.assertLess(max(wear), 25.0)
        self.assertGreater(max(wear), 0.5, "mileage is not accumulating at all")

    def test_playing_tired_does_more_damage_than_playing_fresh(self):
        """The mechanism that makes a rest decision echo years later rather
        than just next week."""
        player = load_teams(1).teams[0].players[0]
        self.assertGreater(H.game_wear(player, 36.0, 95.0),
                           H.game_wear(player, 36.0, 10.0) * 1.5)

    def test_age_costs_more_than_youth_for_the_same_night(self):
        young, old = load_teams(1).teams[0].players[:2]
        young.age, old.age = 23, 35
        self.assertGreater(H.game_wear(old, 36.0, 50.0),
                           H.game_wear(young, 36.0, 50.0))

    def test_a_summer_sheds_some_but_not_all(self):
        saved = load_teams(2)
        for team in saved.teams:
            for player in team.players:
                player.health.wear = 40.0
                player.health.fatigue = 80.0
                player.health.knock = 30.0
        H.reset_season(saved.teams)
        for team in saved.teams:
            for player in team.players:
                self.assertEqual(player.health.fatigue, 0.0)
                self.assertEqual(player.health.knock, 0.0)
                self.assertLess(player.health.wear, 40.0)
                self.assertGreater(player.health.wear, 25.0)


class TestRecoveryStillDependsOnTheBody(unittest.TestCase):
    """`recovery_rate` once ended `max(4.0, rate)`.

    That floor was set when the constant it guarded was much larger. When the
    rest model moved to whole days and the constant came down, every computed
    rate fell below the floor -- so the floor became the only term and stamina,
    professionalism, staff and age stopped mattering to recovery entirely.
    Nothing failed; the league just recovered at one flat rate.
    """

    def rate(self, **kwargs):
        player = load_teams(1).teams[0].players[0]
        staff = kwargs.pop("staff", 50.0)
        for field, value in kwargs.items():
            target = player.hidden if field == "professionalism" else player
            if field == "stamina":
                target = player.ratings
            setattr(target, field, value)
        return H.recovery_rate(player, staff)

    def test_the_floor_does_not_swallow_the_constant(self):
        """The thing that actually went wrong: a floor above the typical rate."""
        rates = [H.recovery_rate(p)
                 for team in load_teams(4).teams for p in team.players]
        self.assertGreater(max(rates), min(rates) * 1.05,
                           "every player recovers at the same rate")

    def test_stamina_pays(self):
        self.assertGreater(self.rate(stamina=18.0), self.rate(stamina=5.0))

    def test_professionalism_pays(self):
        self.assertGreater(self.rate(professionalism=18.0),
                           self.rate(professionalism=5.0))

    def test_a_good_performance_department_pays(self):
        self.assertGreater(self.rate(staff=90.0), self.rate(staff=20.0))

    def test_older_bodies_do_not_bounce_back(self):
        self.assertLess(self.rate(age=36), self.rate(age=22))


class TestWhatCostsWhat(unittest.TestCase):
    """The accrual terms the brief lists, each shown to matter on its own."""

    def setUp(self):
        self.player = load_teams(1).teams[0].players[0]
        self.player.age = 26

    def base(self, **kwargs):
        return H.game_fatigue(self.player, 32.0, **kwargs)

    def test_minutes_are_the_main_term(self):
        self.assertGreater(H.game_fatigue(self.player, 36.0),
                           H.game_fatigue(self.player, 12.0) * 2.0)

    def test_a_back_to_back_costs_more(self):
        self.assertGreater(self.base(back_to_back=True), self.base())

    def test_overtime_costs_more(self):
        self.assertGreater(self.base(overtimes=1), self.base())
        self.assertGreater(self.base(overtimes=2), self.base(overtimes=1))

    def test_the_road_costs_more_than_home(self):
        self.assertGreater(self.base(away=True), self.base())

    def test_a_playoff_night_costs_more_than_a_blowout(self):
        self.assertGreater(H.game_intensity("Conference Finals", 3),
                           H.game_intensity("", 30))

    def test_age_costs_more(self):
        young = H.age_factor(23)
        old = H.age_factor(36)
        self.assertEqual(young, 1.0)
        self.assertGreater(old, young)

    def test_conditioning_pays_for_itself(self):
        strong, weak = load_teams(1).teams[0].players[:2]
        for key in ("stamina", "work_rate"):
            setattr(strong.ratings, key, 19.0)
            setattr(weak.ratings, key, 4.0)
        self.assertLess(H.conditioning(strong), H.conditioning(weak))

    def test_playing_through_a_knock_is_more_tiring(self):
        clean = self.base()
        self.player.health.knock = 60.0
        self.assertGreater(self.base(), clean)

    def test_nothing_is_charged_for_a_night_on_the_bench(self):
        self.assertEqual(H.game_fatigue(self.player, 0.0), 0.0)
        self.assertEqual(H.game_wear(self.player, 0.0, 50.0), 0.0)


class TestItSurvivesASave(unittest.TestCase):
    def test_health_round_trips(self):
        import json

        from bballsim import save

        league = played()
        blob = json.loads(json.dumps(save._round(save.dump_league(
            list(league.teams.values()), name=league.name, season=league.season))))
        back = save.load_league(blob)
        originals = {p.id: p for p in squad(league)}
        checked = 0
        for team in back.teams:
            for player in team.players:
                original = originals[player.id]
                checked += 1
                for field in ("fatigue", "wear", "knock"):
                    self.assertAlmostEqual(getattr(player.health, field),
                                           getattr(original.health, field),
                                           places=3, msg=f"{player.id} {field}")
                self.assertEqual(player.health.injury is None,
                                 original.health.injury is None, player.id)
        self.assertEqual(checked, 360)

    def test_a_league_that_has_played_nothing_writes_no_health(self):
        """Same reason `career` is omitted: a fresh league must fingerprint
        exactly as it did before health existed."""
        from bballsim import save

        team = load_teams(1).teams[0]
        self.assertNotIn("health", save.dump_player(team.players[0]))


if __name__ == "__main__":
    unittest.main()
