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
    be large, and on a calendar where nearly every game is a back-to-back that
    is not a penalty for a hard schedule, it is a tax on everybody that
    squeezes out the gap between a starter and a reserve. The league pinned at
    Critical Fatigue to a man.

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

    def test_two_games_in_a_day_cost_more_than_two_games_in_two_days(self):
        saved = load_teams(2)
        player = saved.teams[0].players[0]
        player.health.fatigue = 50.0
        H.rest(player, 5.0)      # between slates
        crowded = player.health.fatigue

        player.health.fatigue = 50.0
        H.rest(player, 24.0)     # a full day
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


class TestTheSpreadSurvivesTheSchedule(unittest.TestCase):
    """A starter has to end up more tired than a reserve.

    This league plays 82 games in 28 days, so nearly every game is a
    back-to-back. A large flat charge for one is therefore a tax on everybody
    rather than a penalty for a hard schedule, and it flattens exactly the
    difference the system exists to show.
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
