"""The offseason: ageing, retirement, the intake, and the next calendar.

The claims worth holding here are the ones a multi-season league gets wrong
quietly. A roster that drifts off twelve players, or eleven if somebody
retires, is obvious. These are not:

  * the archive is taken **before** anyone develops, so a season line belongs
    to the player who produced it rather than to the year-older man he becomes
    a millisecond later;
  * a retired player's id is **never** reissued, because his season lines stay
    in the archive under it and a newcomer inheriting one inherits a career;
  * the career profile is **stored**, not rebuilt, or `realisation` stops
    meaning anything and every player creeps toward his ceiling forever;
  * a past season is **derived on read** from stored totals, so changing an
    advanced formula changes every season on a career chart together.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.league import history, offseason, playoffs
from bballsim.league.advanced import advanced_table
from bballsim.league.calendar import GameStatus, build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams
from bballsim import save

_CACHE: dict[tuple, League] = {}

GAMES = 6


def fresh(games_per_team: int = GAMES) -> League:
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    return league


def rolled(summers: int = 2, play: bool = True) -> League:
    """A league that has lived through exactly `summers` offseasons.

    Stepped rather than jumped. One big clock jump rolls however many summers
    happen to fit inside it -- 400 days looks like a season and is two -- which
    made "everybody is a year older" fail by a year and pinned nothing.

    `play` then runs the new season out to its champion, so the league is
    sitting on a finished season rather than an empty calendar.
    """
    key = ("rolled", summers, play)
    if key in _CACHE:
        return _CACHE[key]
    league = fresh()
    for _ in range(summers):
        offseason.play_out(league)
        offseason.roll_summer(league)
    if play:
        offseason.play_out(league)
    _CACHE[key] = league
    return league


def played_out() -> League:
    """One season played to its champion, with the offseason not yet due."""
    key = ("played",)
    if key in _CACHE:
        return _CACHE[key]
    league = fresh()
    offseason.play_out(league)
    _CACHE[key] = league
    return league


class TestTheCalendar(unittest.TestCase):
    def test_the_label_rolls_over(self):
        self.assertEqual(offseason.next_label("2026-27"), "2027-28")
        self.assertEqual(offseason.next_label("2029-30"), "2030-31")
        self.assertEqual(offseason.next_label("2099-00"), "2100-01")

    def test_a_season_is_not_over_until_somebody_has_won_it(self):
        league = fresh()
        self.assertFalse(offseason.is_finished(league))
        self.assertFalse(offseason.is_due(league))
        self.assertIsNone(offseason.roll(league))

    def test_a_finished_season_still_waits_for_the_summer(self):
        """The gap is what stops a clock nudged forward a week from rolling a
        whole year the league did not ask for."""
        league = played_out()
        self.assertIsNotNone(playoffs.champion(league))
        self.assertTrue(offseason.is_finished(league))
        self.assertFalse(offseason.is_due(league))

    def test_the_next_season_is_the_same_length_as_the_last(self):
        """A league does not change format over the summer. Hard-coding 82 here
        turned a six-game test season into a full one."""
        league = rolled(1)
        regular = [g for g in league.schedule if not playoffs.is_playoff(g)]
        self.assertEqual(round(2 * len(regular) / len(league.teams)), GAMES)


class TestWhatTheSummerDid(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = fresh()
        cls.ages_before = {
            p.id: p.age for t in cls.before.teams.values() for p in t.players}
        cls.league = rolled(1)

    def test_the_season_moved_on(self):
        self.assertEqual(self.league.season, "2027-28")
        self.assertEqual(len(self.league.history), 1)
        self.assertEqual(self.league.history[0].season, "2026-27")

    def test_the_old_calendar_is_gone_and_the_new_one_is_in_its_place(self):
        """The fixture list is replaced, not appended to. Results are keyed by
        fixture id, so a schedule carrying both seasons would put last year's
        games back into this year's standings."""
        self.assertTrue(self.league.schedule)
        old = {g.id for g in self.before.schedule}
        new = {g.id for g in self.league.schedule}
        self.assertFalse(old & new)
        regular = [g for g in self.league.schedule if not playoffs.is_playoff(g)]
        self.assertEqual(len(regular), len(self.before.schedule))

    def test_everybody_who_stayed_is_a_year_older(self):
        checked = 0
        for team in self.league.teams.values():
            for player in team.players:
                if player.id not in self.ages_before:
                    continue    # arrived in the intake
                checked += 1
                self.assertEqual(player.age, self.ages_before[player.id] + 1,
                                 player.id)
        self.assertGreater(checked, 300)

    def test_every_club_still_fields_twelve(self):
        for team in self.league.teams.values():
            self.assertEqual(len(team.players), 12, team.id)

    def test_every_club_can_still_field_a_legal_five(self):
        for team in self.league.teams.values():
            self.assertEqual(len(team.starters()), 5, team.id)

    def test_the_archive_holds_the_season_that_was_played(self):
        past = self.league.history[0]
        self.assertTrue(past.stats.players)
        self.assertTrue(past.stats.teams)
        self.assertEqual(len(past.standings), 30)
        self.assertIsNotNone(past.champion)
        self.assertIn(past.champion, self.league.teams)
        self.assertNotEqual(past.champion, past.runner_up)

    def test_the_new_season_starts_from_nothing(self):
        """The clock may have run on into the new season, which is fine. What
        must not survive is the old season's totals: the standings have to
        account for the fixtures on the *current* calendar and no others."""
        regular = [g for g in self.league.schedule
                   if g.status == GameStatus.FINAL and not playoffs.is_playoff(g)]
        total = sum(r.games_played for r in self.league.standings.values())
        self.assertEqual(total, len(regular) * 2)
        self.assertEqual(
            sum(line.games for line in self.league.stats.players.values()),
            sum(len([p for p in box_players(g)]) for g in regular))


def box_players(game):
    """Every player who actually took the floor in a finished fixture."""
    return [
        line
        for box in (game.result.home_box, game.result.away_box)
        for line in box.players.values()
        if line.seconds > 0
    ]


class TestRetirementAndIntake(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.start = {p.id for t in fresh().teams.values() for p in t.players}
        cls.league = rolled(2)

    def test_somebody_retired_over_two_seasons(self):
        now = {p.id for t in self.league.teams.values() for p in t.players}
        self.assertTrue(self.start - now, "nobody retired in two seasons")

    def test_a_retired_player_never_has_his_id_reissued(self):
        """His season lines live in the archive under that id. A newcomer given
        it would inherit a career he never played, and the by-season chart reads
        those archives by id."""
        now = [p.id for t in self.league.teams.values() for p in t.players]
        self.assertEqual(len(now), len(set(now)))
        gone = self.start - set(now)
        arrivals = set(now) - self.start
        self.assertFalse(gone & arrivals)

    def test_an_arrival_is_young_and_unfinished(self):
        arrivals = [p for t in self.league.teams.values() for p in t.players
                    if p.id not in self.start]
        if not arrivals:
            self.skipTest("no retirements in this run")
        for player in arrivals:
            self.assertLessEqual(player.age, 24, player.id)
            self.assertLessEqual(player.ability.current, player.ability.potential)

    def test_an_arrival_plays_the_position_that_came_free(self):
        """A squad has to stay legal for `Team.starters()`, which picks the
        strongest *legal* five."""
        for team in self.league.teams.values():
            for position in ("PG", "SG", "SF", "PF", "C"):
                self.assertGreaterEqual(
                    sum(1 for p in team.players if p.position.value == position),
                    1, f"{team.id} has no {position}")

    def test_nobody_shares_a_name(self):
        names = [p.name for t in self.league.teams.values() for p in t.players]
        self.assertEqual(len(names), len(set(names)))


class TestTheCareerProfileIsStored(unittest.TestCase):
    def test_a_season_lived_is_a_season_recorded(self):
        league = rolled(2)
        for team in league.teams.values():
            for player in team.players:
                self.assertIsNotNone(player.career, player.id)
        veterans = [p for t in league.teams.values() for p in t.players
                    if p.career.seasons_played >= 2]
        self.assertTrue(veterans, "nobody accumulated two seasons")

    def test_the_baseline_survives_a_save(self):
        """Rebuilding the profile each offseason would reset `baseline_ca` to
        whatever a player is worth today, and `effective_ceiling` would then
        hand him a fresh share of the remaining gap every year -- so a player of
        poor character would never stall short of his ceiling, which is the one
        thing `realisation` exists to do."""
        league = rolled(1)
        blob = json.loads(json.dumps(save._round(save.dump_league(
            list(league.teams.values()), name=league.name, season=league.season))))
        back = save.load_league(blob)
        originals = {p.id: p for t in league.teams.values() for p in t.players}
        checked = 0
        for team in back.teams:
            for player in team.players:
                original = originals[player.id]
                self.assertIsNotNone(player.career, player.id)
                checked += 1
                for field in ("prime_age", "athletic_peak", "realisation",
                              "baseline_ca", "injury_load", "peak_ca"):
                    self.assertAlmostEqual(
                        getattr(player.career, field),
                        getattr(original.career, field), places=3,
                        msg=f"{player.id} {field}")
                self.assertEqual(player.career.arc, original.career.arc)
                self.assertEqual(player.career.seasons_played,
                                 original.career.seasons_played)
        self.assertEqual(checked, 360)

    def test_a_league_with_no_history_still_loads(self):
        """`data/league.json` predates career profiles and must keep working."""
        saved = load_teams()
        for team in saved.teams:
            for player in team.players:
                self.assertIsNone(player.career)


class TestTheArchiveStoresTotalsAndNothingElse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = rolled(2)
        cls.past = cls.league.history[0]

    def test_it_round_trips(self):
        blob = json.loads(json.dumps(save._round(
            save.dump_history(self.league.history))))
        back = save.load_history(blob)
        self.assertEqual(len(back), len(self.league.history))
        first = back[0]
        self.assertEqual(first.season, self.past.season)
        self.assertEqual(first.champion, self.past.champion)
        for pid, line in self.past.stats.players.items():
            other = first.stats.players[pid]
            self.assertEqual(other.games, line.games)
            self.assertEqual(other.points, line.points)
            self.assertAlmostEqual(other.seconds, line.seconds, places=3)
        for tid, line in self.past.stats.teams.items():
            self.assertEqual(first.stats.teams[tid].opp_fga, line.opp_fga)

    def test_a_past_season_is_derived_on_read(self):
        """Nothing derived is written. The advanced table for a finished season
        is computed now, by the same code the live season goes through -- so a
        formula change moves every season on a career chart together."""
        blob = json.loads(json.dumps(save._round(
            save.dump_history(self.league.history))))
        back = save.load_history(blob)
        self.assertEqual(advanced_table(back[0].stats),
                         advanced_table(self.past.stats))

    def test_the_file_carries_no_rates(self):
        blob = save.dump_history(self.league.history)
        row = blob["seasons"][0]["stats"]["players"][0]
        for derived in ("fg_pct", "tp_pct", "ft_pct", "minutes", "rebounds", "per"):
            self.assertNotIn(derived, row)
        self.assertIn("seconds", row)
        self.assertIn("fgm", row)


class TestTheCareerChart(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = rolled(2)
        cls.series = history.season_series(cls.league)

    def test_a_player_gets_a_point_for_every_season_he_played(self):
        veteran = max(self.series, key=lambda pid: len(self.series[pid]))
        points = self.series[veteran]
        self.assertGreaterEqual(len(points), 2)
        labels = [p["season"] for p in points]
        self.assertEqual(labels, sorted(labels))
        self.assertEqual(len(labels), len(set(labels)))

    def test_a_season_in_progress_can_only_ever_be_the_last_point(self):
        for points in self.series.values():
            for point in points[:-1]:
                self.assertTrue(point["complete"], point["season"])
            if not points[-1]["complete"]:
                self.assertEqual(points[-1]["season"], self.league.season)

    def test_a_decided_championship_is_not_called_in_progress(self):
        """A season is over when somebody has won it. The archive happens in the
        summer, months later, and a page that called a decided championship
        "in progress" until then would be wrong for exactly that long."""
        league = played_out()
        self.assertFalse(league.history)          # not archived yet
        rows = history.seasons(league)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["complete"])
        self.assertIsNotNone(rows[0]["champion"])
        for points in history.season_series(league).values():
            self.assertTrue(points[-1]["complete"])

    def test_a_season_still_being_played_is_marked_in_progress(self):
        league = fresh()
        league.clock.jump_to(league.schedule[len(league.schedule) // 2].tipoff_at)
        league.tick()
        rows = history.seasons(league)
        self.assertFalse(rows[-1]["complete"])
        self.assertIsNone(rows[-1]["champion"])
        series = history.season_series(league)
        self.assertTrue(series)
        for points in series.values():
            self.assertFalse(points[-1]["complete"])

    def test_a_past_point_is_that_season_s_advanced_row(self):
        past = self.league.history[0]
        table = {r["player_id"]: r for r in advanced_table(past.stats)}
        checked = 0
        for pid, points in self.series.items():
            first = points[0]
            if first["season"] != past.season or pid not in table:
                continue
            checked += 1
            row = table[pid]
            self.assertEqual(first["games"], row["games"])
            self.assertEqual(first["per"], round(row["per"], 2))
            self.assertEqual(first["ws"], round(row["ws"], 2))
        self.assertGreater(checked, 50)

    def test_the_seasons_list_ends_on_the_one_being_played(self):
        rows = history.seasons(self.league)
        self.assertEqual(len(rows), len(self.league.history) + 1)
        self.assertEqual(rows[-1]["season"], self.league.season)
        self.assertTrue(all(r["complete"] for r in rows))
        self.assertTrue(all(r["champion"] for r in rows))
        self.assertEqual(len({r["season"] for r in rows}), len(rows))

    def test_the_cache_does_not_outlive_the_season_it_was_built_for(self):
        """Both series memoise, and both memoise on how much has been played.
        A new season that starts with nothing played hits the same key an empty
        season would, so without invalidation the chart draws last year's line
        under this year's label."""
        league = fresh()
        league.clock.jump_to(league.schedule[len(league.schedule) // 2].tipoff_at)
        league.tick()
        before_in_season = history.advanced_series(league)
        before_by_season = history.season_series(league)
        self.assertIs(history.advanced_series(league), before_in_season)
        self.assertTrue(before_in_season)
        veteran = max(before_by_season, key=lambda pid: len(before_by_season[pid]))
        self.assertFalse(before_by_season[veteran][-1]["complete"])

        offseason.play_out(league)
        offseason.roll_summer(league)
        self.assertEqual(len(league.history), 1)

        after_by_season = history.season_series(league)
        self.assertIsNot(after_by_season, before_by_season)
        # Last season is now a completed point in the career, where before the
        # roll it was the season being played.
        self.assertTrue(after_by_season[veteran][0]["complete"])
        # And the in-season line belongs to the new season, not the old one.
        after_in_season = history.advanced_series(league)
        self.assertIsNot(after_in_season, before_in_season)


class TestDeterminism(unittest.TestCase):
    def test_the_same_league_lives_the_same_summer(self):
        one, two = fresh(), fresh()
        for league in (one, two):
            league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=400))
            league.tick()
        self.assertEqual(one.season, two.season)
        self.assertEqual(
            [(p.id, p.age, round(p.ability.current, 4))
             for t in one.teams.values() for p in t.players],
            [(p.id, p.age, round(p.ability.current, 4))
             for t in two.teams.values() for p in t.players])
        self.assertEqual([a.champion for a in one.history],
                         [a.champion for a in two.history])


if __name__ == "__main__":
    unittest.main()
