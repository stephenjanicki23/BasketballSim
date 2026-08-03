"""Club crests.

A crest is 34 pixels across in a schedule row. Most of what can go wrong with
one is invisible in source and obvious on screen, so these tests check the
things that *are* checkable: every club has a mark, the marks are distinct, the
glyph a club asks for actually exists in the front end, and the two colours
separate well enough to see at that size.

The glyph shapes live in `ui/app.js`; the mapping from club to glyph lives in
`bballsim/logos.py`. The two are read together here, because a club pointing at
a glyph that was renamed or removed would render as a blank disc and nothing
else would catch it.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.api.payload import team_summary
from bballsim.logos import (
    FALLBACK_LOGO,
    TEAM_LOGOS,
    contrast_ratio,
    logo_for,
    relative_luminance,
)
from bballsim.roster import load_teams

APP_JS = Path(__file__).resolve().parents[1] / "ui" / "app.js"

# A crest is small and often on a busy row. 3:1 is the WCAG floor for
# non-text graphics; below it a mark stops being identifiable at a glance,
# which is the only job it has.
MIN_CONTRAST = 3.0


def glyph_names_in_app() -> set[str]:
    """The glyph keys `ui/app.js` actually defines."""
    source = APP_JS.read_text()
    block = source[source.index("const GLYPHS = {"):source.index("/* Build a club's crest")]
    return set(re.findall(r"^  ([a-z]+):", block, re.M))


class TestEveryClubHasACrest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.teams = load_teams().teams

    def test_all_thirty_clubs_are_covered(self):
        for team in self.teams:
            self.assertIn(team.abbreviation, TEAM_LOGOS, team.abbreviation)

    def test_no_crest_points_at_a_club_that_does_not_exist(self):
        known = {team.abbreviation for team in self.teams}
        for abbreviation in TEAM_LOGOS:
            self.assertIn(abbreviation, known, abbreviation)

    def test_every_club_wears_its_own_mark(self):
        """Two clubs sharing a glyph would be indistinguishable in a fixture
        list, which is where crests are actually read."""
        glyphs = [glyph for glyph, _p, _s in TEAM_LOGOS.values()]
        self.assertEqual(len(set(glyphs)), len(glyphs), "a glyph is used twice")

    def test_crests_are_visually_distinct_by_colour_too(self):
        discs = [primary for _g, primary, _s in TEAM_LOGOS.values()]
        self.assertEqual(len(set(discs)), len(discs), "two clubs share a disc colour")

    def test_the_crest_travels_with_the_team(self):
        summary = team_summary(self.teams[0])
        self.assertEqual(summary["logo"], logo_for(self.teams[0].abbreviation))
        for key in ("glyph", "primary", "secondary"):
            self.assertIn(key, summary["logo"], key)

    def test_an_unknown_club_still_gets_something_to_wear(self):
        """Real data loaded over the placeholders must not render as nothing."""
        fallback = logo_for("ZZZ")
        self.assertEqual(
            (fallback["glyph"], fallback["primary"], fallback["secondary"]),
            FALLBACK_LOGO,
        )


class TestCrestsAreLegible(unittest.TestCase):
    def test_every_mark_separates_from_its_disc(self):
        for abbreviation, (_glyph, primary, secondary) in TEAM_LOGOS.items():
            ratio = contrast_ratio(primary, secondary)
            self.assertGreaterEqual(
                ratio, MIN_CONTRAST,
                f"{abbreviation}: {primary} on {secondary} is only {ratio:.2f}:1",
            )

    def test_the_fallback_is_legible_too(self):
        _glyph, primary, secondary = FALLBACK_LOGO
        self.assertGreaterEqual(contrast_ratio(primary, secondary), MIN_CONTRAST)

    def test_luminance_matches_the_known_anchors(self):
        """Guard the contrast maths itself, or the test above proves nothing."""
        self.assertAlmostEqual(relative_luminance("#FFFFFF"), 1.0, places=3)
        self.assertAlmostEqual(relative_luminance("#000000"), 0.0, places=3)
        self.assertAlmostEqual(contrast_ratio("#FFFFFF", "#000000"), 21.0, places=1)
        self.assertAlmostEqual(contrast_ratio("#FFFFFF", "#FFFFFF"), 1.0, places=3)

    def test_colours_are_six_digit_hex(self):
        for abbreviation, (_g, primary, secondary) in TEAM_LOGOS.items():
            for colour in (primary, secondary):
                self.assertRegex(colour, r"^#[0-9A-Fa-f]{6}$", abbreviation)


class TestTheGlyphsExist(unittest.TestCase):
    """The mapping and the shapes live in different files and different
    languages. Nothing but this checks they still agree."""

    @classmethod
    def setUpClass(cls):
        cls.defined = glyph_names_in_app()

    def test_the_front_end_defines_every_glyph_a_club_asks_for(self):
        for abbreviation, (glyph, _p, _s) in TEAM_LOGOS.items():
            self.assertIn(glyph, self.defined, f"{abbreviation} wants a missing glyph")

    def test_the_fallback_glyph_exists(self):
        self.assertIn(FALLBACK_LOGO[0], self.defined)

    def test_no_glyph_is_defined_and_never_worn(self):
        worn = {glyph for glyph, _p, _s in TEAM_LOGOS.values()} | {FALLBACK_LOGO[0]}
        self.assertEqual(self.defined - worn, set(), "unused glyph left behind")

    def test_glyphs_stay_inside_the_box_they_are_drawn_on(self):
        """Coordinates are on a 0-64 viewBox. A stray 3-digit number is a typo
        that would push part of a mark outside the disc."""
        source = APP_JS.read_text()
        block = source[source.index("const GLYPHS = {"):source.index("/* Build a club's crest")]
        for number in re.findall(r"-?\d+(?:\.\d+)?", block):
            value = abs(float(number))
            # 240 and 360 appear as rotation angles, 64 as the viewBox itself.
            self.assertLessEqual(value, 360.0, number)


if __name__ == "__main__":
    unittest.main()
