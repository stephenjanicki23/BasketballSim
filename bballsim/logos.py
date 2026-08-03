"""Club crests: which mark each team wears, and in what colours.

Every team gets an emblem drawn from its nickname -- an I-beam for the
Ironworks, an anchor for the Anchors, antlers for the Stags. The *shapes* live
in the front end (`ui/app.js`, `GLYPHS`) because they are SVG path data and
belong next to the thing that renders them; what lives here is the mapping
from a club to its glyph and its two colours.

Marks are geometric rather than illustrative on purpose. A crest in this app
is 34 pixels across in a schedule row, where a detailed animal drawing turns
to mud and a bold silhouette still reads. That is the same reason real
league marks simplify.

Two colours each: the disc and the glyph on it. The pair is chosen for
contrast at small size, and checked by `tests/test_logos.py` rather than by
eye -- a crest that fails against its own background is invisible exactly
where it matters.

None of this is saved with the roster. A crest is presentation, keyed by
abbreviation, and `bballsim/save.py` deliberately stores no derived values.
"""

from __future__ import annotations

# glyph, disc colour, mark colour.
TEAM_LOGOS: dict[str, tuple[str, str, str]] = {
    "NCI": ("beam",     "#2F4858", "#E8EDF2"),  # Ironworks
    "EPM": ("wheel",    "#123A6B", "#F2F6FB"),  # Mariners
    "SRM": ("picks",    "#343A40", "#F2A93B"),  # Miners
    "WFR": ("compass",  "#1F5F4B", "#EAF6F0"),  # Rovers
    "LSC": ("current",  "#0E7C86", "#E7FAFC"),  # Current
    "HLS": ("antlers",  "#6E2639", "#F7E9ED"),  # Stags
    "RBF": ("ladle",    "#B4441C", "#FFEDE3"),  # Foundry
    "GVS": ("towers",   "#33327A", "#ECEBFB"),  # Skyline
    "IVF": ("anvil",    "#2B2B2B", "#FF8A3D"),  # Forge
    "CHG": ("gull",     "#2C7FB8", "#FFFFFF"),  # Gulls
    "SRP": ("peaks",    "#46596B", "#F0F5F9"),  # Peaks
    "CFT": ("pine",     "#2D5A34", "#EFF7EE"),  # Timber
    "PUA": ("anchor",   "#0F2E4D", "#FFFFFF"),  # Anchors
    "SLC": ("comet",    "#4B2E83", "#FFE9A8"),  # Comets
    "FBS": ("shield",   "#8C1D2C", "#F8E6E8"),  # Sentinels
    "AVF": ("fox",      "#C25A21", "#FFF1E4"),  # Foxes
    "KBR": ("crown",    "#4C2A85", "#F6D96B"),  # Royals
    "MHM": ("butterfly", "#C2621C", "#FFF0DC"),  # Monarchs
    "CFC": ("paw",      "#8A5A2B", "#FBF2E7"),  # Coyotes
    "THW": ("hawk",     "#7A2E1E", "#F6E4DA"),  # Hawks
    "GPS": ("bolt",     "#37474F", "#FFD84D"),  # Storm
    "RSR": ("star",     "#A3392B", "#FBE9CE"),  # Rangers
    "BWT": ("wave",     "#1B7A8C", "#E6FAFB"),  # Tides
    "ACB": ("claw",     "#5A3A22", "#F2E5D7"),  # Bruins
    "STG": ("helm",     "#4A5560", "#E9EEF2"),  # Guardians
    "WMC": ("spiral",   "#3B2E6E", "#DCE4FF"),  # Cyclones
    "OKO": ("owl",      "#23324A", "#E9C46A"),  # Owls
    "CBS": ("pulse",    "#185ADB", "#EAF1FF"),  # Surge
    "FRF": ("falcon",   "#2E3A46", "#E0A526"),  # Falcons
    "NMP": ("wagon",    "#3E6B4A", "#F5EAD2"),  # Pioneers
}

# Used when a club has no crest of its own -- a new expansion team, or real
# data loaded over the placeholders.
FALLBACK_LOGO = ("shield", "#4A4239", "#F2EEE7")


def logo_for(abbreviation: str) -> dict:
    glyph, primary, secondary = TEAM_LOGOS.get(abbreviation, FALLBACK_LOGO)
    return {"glyph": glyph, "primary": primary, "secondary": secondary}


# --------------------------------------------------------------------------
# Contrast, so a mark is legible on its own disc.
#
# WCAG relative luminance. Not a design flourish: at 34px a glyph that only
# half-separates from the colour behind it reads as a smudge, and the whole
# point of a crest is to be identifiable at a glance in a list of 45 fixtures.
# --------------------------------------------------------------------------

def _channel(value: float) -> float:
    value /= 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_colour: str) -> float:
    raw = hex_colour.lstrip("#")
    r, g, b = (int(raw[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def contrast_ratio(first: str, second: str) -> float:
    a, b = relative_luminance(first), relative_luminance(second)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)
