"""Scouting cards: what they say, and what they must never say.

Every other test file in this project pins what a feature *does*. Most of this
one pins what a feature **must not do**, because the whole value of a draft is
that nobody knows the answer yet, and a leak here would be silent -- the page
would look right, read well, and quietly hand over the number it exists to
withhold.

The leak tests are correlations rather than assertions about one player. That
is deliberate: a card can be free of ability numbers and still be a perfect
proxy for one, which is exactly what the first design was. `usage` is drawn as
`gauss(5.0 + (target_ca / 200.0) * 12.0, 1.6)` -- print it as a bar and you
have published current ability with a friendlier axis label. Only a measurement
over a whole population can tell those two situations apart.

Run with:  python3 -m unittest tests.test_scouting -v
"""

from __future__ import annotations

import json
import re
import statistics
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import draft_class, draft_picks, scouting
from bballsim.api import payload
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.roster import load_teams

# Enough classes that a correlation means something. At n=60 the comp leak
# measured +0.19 and at n=360 it measures +0.02; the first was noise, and a
# test written against one class would have been reporting it as signal.
YEARS = tuple(range(2027, 2033))

_LEAGUE: list[League] = []


def played(games_per_team: int = 12) -> League:
    """A league with a season's worth of statistics behind it, so there is a
    real pool to comp against."""
    if _LEAGUE:
        return _LEAGUE[0]
    saved = load_teams()
    league = League(name=saved.name, season=saved.season)
    for team in saved.teams:
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        [t.id for t in saved.teams], start_date=date(2026, 10, 20),
        games_per_team=games_per_team, season=league.season))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(hours=6))
    league.tick()
    _LEAGUE.append(league)
    return league


def every_prospect():
    for year in YEARS:
        for prospect in draft_class.board(year):
            yield year, prospect


def correlation(xs, ys) -> float:
    mx, my = statistics.mean(xs), statistics.mean(ys)
    vx = sum((x - mx) ** 2 for x in xs) ** 0.5
    vy = sum((y - my) ** 2 for y in ys) ** 0.5
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (vx * vy) if vx and vy else 0.0


class TestStyleIsAShapeNotALevel(unittest.TestCase):
    def test_the_shares_are_a_composition(self):
        for _year, prospect in every_prospect():
            shares = scouting.style_of(prospect).shares
            self.assertEqual(set(shares), set(scouting.SHAPE))
            self.assertAlmostEqual(sum(shares.values()), 1.0, places=6)
            self.assertTrue(all(v >= 0.0 for v in shares.values()))

    def test_scaling_every_tendency_changes_nothing(self):
        """The property the whole design rests on. If this were false, style
        would carry a level and the level is ability."""
        import copy

        for _year, prospect in list(every_prospect())[:40]:
            before = scouting.style_of(prospect).shares
            # Scaled *down*: Tendencies clamps at 20, so multiplying up
            # flattens whoever is already near the top and the test would be
            # measuring the clamp rather than the composition.
            quieter = copy.deepcopy(prospect)
            for name in scouting.SHAPE:
                setattr(quieter.tendencies, name,
                        getattr(quieter.tendencies, name) * 0.6)
            after = scouting.style_of(quieter).shares
            for name in scouting.SHAPE:
                self.assertAlmostEqual(before[name], after[name], places=6, msg=name)

    def test_usage_is_not_in_the_shape(self):
        """It is `5.0 + (ca / 200) * 12.0` with noise on it -- ability wearing a
        costume, and not a shape at all."""
        self.assertNotIn("usage", scouting.SHAPE)


class TestTheCardDoesNotLeakAbility(unittest.TestCase):
    """The tests this file exists for."""

    @classmethod
    def setUpClass(cls):
        cls.rows = list(every_prospect())
        cls.ca = [p.ability.current for _y, p in cls.rows]
        cls.pa = [p.ability.potential for _y, p in cls.rows]

    def test_raw_tendencies_would_have_leaked(self):
        """Establishes that the danger is real rather than theoretical. If this
        ever goes to zero the composition below is no longer doing any work and
        somebody should find out why."""
        worst = 0.0
        for name in scouting.SHAPE + ("usage",):
            values = [getattr(p.tendencies, name) for _y, p in self.rows]
            worst = max(worst, abs(correlation(values, self.ca)))
        self.assertGreater(worst, 0.2, "raw tendencies no longer track ability")

    def test_published_shares_do_not(self):
        for name in scouting.SHAPE:
            values = [scouting.style_of(p).share(name) for _y, p in self.rows]
            for label, target in (("CA", self.ca), ("PA", self.pa)):
                r = correlation(values, target)
                self.assertLess(abs(r), 0.10, f"{name} vs {label} r={r:+.3f}")

    def test_the_comp_says_nothing_about_how_good_he_is(self):
        league = played()
        pool = scouting.league_pool(league)
        lines = {l.player_id: l for l in league.stats.players.values()}

        ca, pa, scoring, minutes = [], [], [], []
        for year in YEARS:
            ranked = scouting.class_pool(year)
            for prospect in draft_class.board(year):
                comp = scouting.comp_for(prospect, year, pool, ranked)
                line = lines.get(comp["playerId"]) if comp else None
                if not line or not line.games:
                    continue
                ca.append(prospect.ability.current)
                pa.append(prospect.ability.potential)
                scoring.append(line.points / line.games)
                minutes.append(line.seconds / 60.0 / line.games)

        self.assertGreater(len(ca), 200, "too few comps to measure")
        for label, target in (("CA", ca), ("PA", pa)):
            for what, values in (("points", scoring), ("minutes", minutes)):
                r = correlation(target, values)
                self.assertLess(abs(r), 0.15, f"{label} vs comp {what} r={r:+.3f}")

    def test_the_threshold_would_actually_catch_a_leak(self):
        """A loose threshold passes everything, including a leak, and a test
        that cannot fail proves nothing. So build the leak on purpose -- give
        every prospect the pool player whose scoring rank matches his ability
        rank, which is exactly what a well-meaning "comp him to someone of his
        level" would produce -- and check the number this file asserts on goes
        past the line. It reads +0.98 against a limit of 0.15."""
        league = played()
        lines = {l.player_id: l for l in league.stats.players.values()}
        pool = [r for r in scouting.league_pool(league) if r["playerId"] in lines]
        self.assertGreater(len(pool), 50)
        pool.sort(key=lambda r: lines[r["playerId"]].points / lines[r["playerId"]].games)

        rows = sorted(self.rows, key=lambda yp: yp[1].ability.current)
        ability, scoring = [], []
        for index, (_year, prospect) in enumerate(rows):
            share = index / max(1, len(rows) - 1)
            leaky = lines[pool[int(share * (len(pool) - 1))]["playerId"]]
            ability.append(prospect.ability.current)
            scoring.append(leaky.points / leaky.games)

        self.assertGreater(abs(correlation(ability, scoring)), 0.15,
                           "the leak test cannot detect a leak")

    def test_no_ability_number_reaches_the_payload(self):
        """Stripped rather than hidden in the UI: a surprise one browser tab
        away is not a surprise."""
        card = scouting.card_for(
            draft_class.board(2027)[0], 2027,
            scouting.league_pool(played()), scouting.class_pool(2027))
        blob = json.dumps(card).lower()
        for banned in ("current", "potential", "ceiling", "ability",
                       "overall", "rating", "usage", "tendenc"):
            self.assertNotIn(banned, blob, banned)


class TestTheWriteUp(unittest.TestCase):
    # Words that grade rather than describe. A scouting report normally lives
    # on these, and every one of them is a claim about ability.
    BANNED = ("elite", "poor", "weak", "gifted", "raw", "polished", "limited",
              "star", "bust", "best", "worst", "good", "bad", "great",
              "excellent", "superb", "outstanding", "special", "average",
              "solid", "high-level", "upside", "ceiling", "potential",
              # Not bare "floor": "floor general" is an archetype and "spaces
              # the floor" is a description. It is the scouting sense of a
              # player's floor that would be a grade.
              "high floor", "low floor", "his floor")

    def test_the_vocabulary_grades_nothing(self):
        for year in YEARS[:3]:
            ranked = scouting.class_pool(year)
            for prospect in draft_class.board(year):
                text = scouting.summary(prospect, year, ranked).lower()
                for word in self.BANNED:
                    self.assertNotIn(word, text, f"{word!r} in {text!r}")

    def test_every_prospect_gets_a_sentence(self):
        for year in YEARS[:3]:
            ranked = scouting.class_pool(year)
            for prospect in draft_class.board(year):
                text = scouting.summary(prospect, year, ranked)
                self.assertTrue(text.endswith("."), text)
                self.assertGreater(len(text), 40, text)
                self.assertTrue(text.startswith("A "), text)

    def test_it_leads_with_what_he_does_most(self):
        """Ranking by lift instead led with a scoring guard's third habit, and
        called a man who takes 18% of his shots from the post a post player."""
        phrases = {name: texts for name, texts in scouting.SHOT_DIET.items()}
        for year in YEARS[:2]:
            ranked = scouting.class_pool(year)
            for prospect in draft_class.board(year):
                shares = scouting.style_of(prospect).shares
                biggest = max(phrases, key=lambda n: shares[n])
                text = scouting.summary(prospect, year, ranked)
                lead = text.split(". ")[0]
                self.assertTrue(
                    any(p in lead for p in phrases[biggest]),
                    f"{biggest} is his largest but the lead reads {lead!r}")


class TestTheComp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played()
        cls.pool = scouting.league_pool(cls.league)

    def test_the_pool_is_players_who_actually_played(self):
        self.assertTrue(self.pool)
        for row in self.pool:
            self.assertTrue(row["name"])
            self.assertEqual(set(row["axes"]), set(scouting.COMP_AXES))
            self.assertEqual(set(row["pct"]), set(scouting.COMP_AXES))

    def test_a_comp_is_somebody_you_could_picture_in_the_role(self):
        """A power forward compared with a centre is a useful sentence. A power
        forward compared with a point guard is not."""
        for year in YEARS[:3]:
            ranked = scouting.class_pool(year)
            for prospect in draft_class.board(year):
                comp = scouting.comp_for(prospect, year, self.pool, ranked)
                if comp is None:
                    continue
                mine = scouting.POSITION_GROUP[prospect.position.value]
                theirs = scouting.POSITION_GROUP.get(comp["position"], "")
                self.assertIn(theirs, scouting.NEIGHBOURS[mine],
                              f"{prospect.position.value} -> {comp['position']}")

    def test_an_empty_league_produces_no_comps_rather_than_bad_ones(self):
        """Silence beats a name that does not fit."""
        empty = League(name="Empty", season="2026-27")
        pool = scouting.league_pool(empty)
        self.assertEqual(pool, [])
        ranked = scouting.class_pool(2027)
        for prospect in draft_class.board(2027)[:5]:
            self.assertIsNone(scouting.comp_for(prospect, 2027, pool, ranked))

    def test_no_single_player_is_everybody_s_comp(self):
        """A comp pool that collapses onto one name is not matching on
        anything."""
        year = draft_picks.current_year(self.league)
        ranked = scouting.class_pool(year)
        names = [c["name"] for c in
                 (scouting.comp_for(p, year, self.pool, ranked)
                  for p in draft_class.board(year)) if c]
        self.assertGreater(len(names), 30)
        top = max(names.count(n) for n in set(names))
        self.assertLessEqual(top, len(names) // 5)


class TestTheView(unittest.TestCase):
    def test_the_class_is_carded_whole(self):
        league = played()
        data = scouting.cards(league)
        self.assertEqual(len(data["prospects"]), draft_class.BOARD_SIZE)
        self.assertTrue(data["note"])
        for card in data["prospects"]:
            self.assertTrue(card["name"])
            self.assertTrue(card["summary"])
            self.assertTrue(card["portrait"])
            self.assertEqual(set(card["style"]), set(scouting.SHAPE))

    def test_it_rides_along_with_the_offseason_preview(self):
        view = payload.offseason_preview(played())
        self.assertIn("prospects", view)
        self.assertEqual(len(view["prospects"]["prospects"]),
                         draft_class.BOARD_SIZE)


if __name__ == "__main__":
    unittest.main()
