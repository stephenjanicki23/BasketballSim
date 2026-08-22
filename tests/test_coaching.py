"""The coach page: results, not ratings.

The one claim worth defending with a test is the one the whole feature rests
on: **nothing here reads a coaching rating.** A coach has seven of them, and it
would be the easiest thing in the world to reach for `coach.ratings.defense`
when describing how his teams defend. The page must not, because a rating is
the simulation's private verdict and the page is supposed to be his public
record -- the seasons as they actually went.

Two other things are pinned because they would be wrong silently:

  * the championships, playoff berths and records must agree with the archives
    they are counted from -- a page that credited a coach with a title his club
    did not win would look perfectly normal;
  * the attribution rests on coaches never moving. `TestTheAttributionAssumption`
    states that out loud, so if coaches ever start changing clubs this file
    fails and points at the reason rather than letting the credit quietly go to
    the wrong man.

Run with:  python3 -m unittest tests.test_coaching -v
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import coaching
from bballsim.league import offseason
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

_LEAGUE: list[League] = []


def rolled() -> League:
    """A league that has finished three seasons and is playing a fourth, so a
    coach has a multi-year record to read.

    Short seasons and a fixed calendar: this is the same stepped roll the
    offseason tests use, so the years are deterministic rather than however
    many happen to fit inside a clock jump.
    """
    if _LEAGUE:
        return _LEAGUE[0]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=14, season=league.season))
    for _ in range(3):
        offseason.play_out(league)
        offseason.roll_summer(league)
    offseason.play_out(league)
    _LEAGUE.append(league)
    return league


class TestItReadsNoRatings(unittest.TestCase):
    def test_the_module_never_touches_coach_ratings(self):
        """Read the source and prove the words are not in it. Coarse, and
        exactly right: the guarantee is that no coaching rating can reach this
        page, and the surest way to keep it is that the module cannot name one."""
        source = (Path(__file__).resolve().parents[1]
                  / "bballsim" / "coaching.py").read_text()
        # Attribute access, not the bare words -- "ratings" and "defense"
        # appear all over the docstring and the style axes, which is fine; a
        # leading dot is a coach's rating being *read*, which is not.
        for banned in (".ratings", ".offense", ".tactics", ".development",
                       ".reputation", ".player_management",
                       ".talent_evaluation", ".leadership", "coach.ratings"):
            self.assertNotIn(banned, source, banned)

    def test_no_rating_reaches_the_payload(self):
        league = rolled()
        for team_id in list(league.teams)[:6]:
            blob = json.dumps(coaching.career(league, team_id).to_dict()).lower()
            for banned in ("rating", "reputation", "offense", "tactics",
                           "development", "overall"):
                self.assertNotIn(banned, blob, f"{team_id}: {banned}")


class TestTheRecordMatchesTheArchives(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = rolled()

    def test_championships_are_counted_from_the_archives(self):
        won: dict[str, int] = {}
        for archive in self.league.history:
            if archive.champion:
                won[archive.champion] = won.get(archive.champion, 0) + 1
        for team_id in self.league.teams:
            record = coaching.career(self.league, team_id).to_dict()["record"]
            self.assertEqual(record["championships"], won.get(team_id, 0), team_id)

    def test_wins_and_losses_sum_the_seasons(self):
        for team_id in list(self.league.teams)[:6]:
            car = coaching.career(self.league, team_id)
            data = car.to_dict()
            wins = sum(r["wins"] for r in data["seasons"])
            losses = sum(r["losses"] for r in data["seasons"])
            self.assertEqual(data["record"]["wins"], wins, team_id)
            self.assertEqual(data["record"]["losses"], losses, team_id)

    def test_a_playoff_berth_is_a_top_eight_finish(self):
        for team_id in self.league.teams:
            for row in coaching.seasons_under(self.league, team_id):
                if row.conference_rank <= coaching.PLAYOFF_SEEDS:
                    self.assertTrue(row.made_playoffs,
                                    f"{team_id} {row.season} rank "
                                    f"{row.conference_rank}")
                elif row.conference_rank <= 15:
                    self.assertFalse(row.made_playoffs,
                                     f"{team_id} {row.season}")

    def test_every_club_has_one_row_per_recorded_season(self):
        expected = len(self.league.history) + 1   # archives plus the live year
        for team_id in self.league.teams:
            rows = coaching.seasons_under(self.league, team_id)
            self.assertEqual(len(rows), expected, team_id)
            self.assertFalse(rows[-1].complete, "the live season is not complete")
            self.assertTrue(all(r.complete for r in rows[:-1]))

    def test_a_champion_reads_as_champions(self):
        champions = {a.champion for a in self.league.history if a.champion}
        self.assertTrue(champions, "the fixture produced no champion to check")
        for team_id in champions:
            finishes = {r.finish for r in coaching.seasons_under(self.league, team_id)}
            self.assertIn("Champions", finishes, team_id)


class TestStyleTracksActualPlay(unittest.TestCase):
    """The axes are a fingerprint of how the teams played, so they must move
    with the box score rather than sit at a default."""

    def test_the_axes_are_centred_on_the_league(self):
        """A z-score against the league should average to zero across the
        league -- if it does not, the axis is measuring something absolute and
        would read as a rating in disguise."""
        league = rolled()
        for axis in coaching.STYLE_AXES:
            values = [coaching.style_of(league, tid)[axis]
                      for tid in league.teams]
            mean = sum(values) / len(values)
            self.assertLess(abs(mean), 0.25, f"{axis} mean {mean:+.3f}")
            self.assertGreater(max(values) - min(values), 1.0,
                               f"{axis} has no spread")

    def test_a_fast_team_reads_as_fast(self):
        """Take the club that actually played fastest last archived season and
        check its pace axis is positive -- the fingerprint points the right
        way."""
        league = rolled()
        archive = league.history[-1]
        paces = {}
        for team_id in league.teams:
            line = archive.stats.teams.get(team_id)
            if line and line.games:
                paces[team_id] = line.possessions / line.games
        fastest = max(paces, key=paces.get)
        slowest = min(paces, key=paces.get)
        self.assertGreater(coaching.style_of(league, fastest)["pace"],
                           coaching.style_of(league, slowest)["pace"])


class TestTheAttributionAssumption(unittest.TestCase):
    """The whole page credits a club's history to its current coach. That is
    only honest because a coach never moves. This is the tripwire."""

    def test_a_coach_stays_with_his_club(self):
        import copy

        # A copy, because rolling a season mutates the league and the fixture
        # is shared -- the per-season-row test counts on it standing still.
        league = copy.deepcopy(rolled())
        before = {tid: team.coach.id if team.coach else None
                  for tid, team in league.teams.items()}
        # Roll another whole season and summer.
        offseason.play_out(league)
        offseason.roll_summer(league)
        after = {tid: team.coach.id if team.coach else None
                 for tid, team in league.teams.items()}
        self.assertEqual(before, after,
                         "a coach changed clubs -- coaching.py now needs a "
                         "per-season coach->club map, see its docstring")


class TestTheWriteUp(unittest.TestCase):
    def test_a_leaky_defence_is_never_called_stingy(self):
        """The bug that shipped once: a strongly negative axis picked the
        positive phrase."""
        league = rolled()
        for team_id in league.teams:
            car = coaching.career(league, team_id)
            text = car.summary().lower()
            if car.style.get("defense", 0) <= -coaching.LEAN:
                self.assertNotIn("stingy", text, team_id)
                self.assertNotIn("low-scoring defence", text, team_id)

    def test_a_coach_with_no_seasons_says_so(self):
        empty = League(name="Empty", season="2026-27")
        empty.add_team(load_teams().teams[0])
        team_id = next(iter(empty.teams))
        car = coaching.career(empty, team_id)
        self.assertEqual(car.to_dict()["record"]["seasons"], 0)
        self.assertIn("not yet", car.summary().lower())


if __name__ == "__main__":
    unittest.main()
