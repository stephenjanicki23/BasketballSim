"""A drawn portrait for every player.

Each man gets a face: deterministic, unique to him, and the same every time
the page is opened. Not a photograph -- there is no image model in this
project and a published page cannot fetch one -- so these are **illustrations
assembled from parts**, the way a club crest is assembled from a glyph and two
colours. `logos.py` splits the same way and for the same reason: the mapping
lives here, the path data lives in `ui/app.js` next to the thing that draws it.

**Appearance is seeded from the player id, not from his name or his country.**
That is a deliberate choice and worth stating plainly. Code that reads a
nationality and picks a skin tone is a stereotype generator -- it encodes a
claim about what people from a place look like, and it would make a league
*less* varied than a real one rather than more, because real squads are not
sorted by passport. Seeding on the id gives every league the full spread and
lets a Lithuanian centre look like anyone.

**Age is allowed to show**, because that is not a stereotype, it is a fact
about a body: grey arrives with the thirties and a clean shave is more common
at nineteen than at thirty-four. Those are the only two places where anything
about the player feeds his picture.

**The club colours are his kit.** A portrait wears the crest palette of the
team he currently plays for, so a squad page reads as a squad and a traded
player visibly changes shirt.
"""

from __future__ import annotations

import random

from .engine.rng import seed_from_string
from .logos import logo_for

# Skin tones, light to deep. A spread rather than a token pair: a league of
# 360 should not look like it was cast from four people.
SKIN: tuple[str, ...] = (
    "#F3D2BC", "#EFC5A6", "#E3AE85", "#D2996B", "#BE8155",
    "#A76A44", "#8D5535", "#75422A", "#5C3421", "#472819",
)

# Hair colours, and how often each turns up. Black and browns dominate for the
# same reason they do anywhere; the greys are not in this table because they
# are applied by age below rather than drawn.
HAIR: tuple[tuple[str, float], ...] = (
    ("#140F0C", 0.34),   # black
    ("#2B1B12", 0.24),   # dark brown
    ("#4A2E1C", 0.16),   # brown
    ("#6B4326", 0.10),   # light brown
    ("#8A5A2B", 0.06),   # auburn
    ("#B07A3A", 0.05),   # dark blond
    ("#D8B072", 0.05),   # blond
)

GREY = "#B9B4AE"
SALT_AND_PEPPER = "#6E655D"

# Cuts. `bald` and `buzz` are common in the sport and read well at 40 pixels,
# which is the size this is usually seen at.
STYLES: tuple[tuple[str, float], ...] = (
    ("buzz", 0.20), ("short", 0.20), ("fade", 0.14), ("afro", 0.12),
    ("curls", 0.10), ("braids", 0.09), ("bald", 0.08), ("topknot", 0.07),
)

BEARDS: tuple[str, ...] = ("none", "stubble", "moustache", "goatee",
                           "short_beard", "full_beard")

# Chance of a headband. Small, so it stays a detail rather than a uniform.
HEADBAND_CHANCE = 0.16

# Age at which grey starts appearing at all, and the age by which it is likely.
GREY_STARTS = 29
GREY_CERTAIN = 40


def _weighted(rng: random.Random, table) -> str:
    total = sum(weight for _value, weight in table)
    roll = rng.uniform(0.0, total)
    for value, weight in table:
        roll -= weight
        if roll <= 0:
            return value
    return table[-1][0]


def _grey_share(age: int) -> float:
    if age < GREY_STARTS:
        return 0.0
    span = max(1, GREY_CERTAIN - GREY_STARTS)
    return min(1.0, (age - GREY_STARTS) / span)


def features(player, team=None) -> dict:
    """Everything the front end needs to draw one face.

    Pure and deterministic: the same player produces the same portrait in the
    app, in the published demo, and after a reload.
    """
    rng = random.Random(seed_from_string(f"portrait-{player.id}"))
    age = int(getattr(player, "age", 25) or 25)

    skin = rng.choice(SKIN)
    style = _weighted(rng, STYLES)
    hair = _weighted(rng, HAIR)

    # Grey, by age. Two stages, because a man does not go from black to white:
    # salt-and-pepper first, then grey.
    grey = _grey_share(age)
    if grey and rng.random() < grey:
        hair = GREY if rng.random() < grey * 0.6 else SALT_AND_PEPPER

    # Facial hair. Nineteen-year-olds are mostly clean-shaven; by thirty most
    # players have something.
    beard_chance = min(0.72, max(0.06, (age - 18) * 0.055))
    beard = rng.choice(BEARDS[1:]) if rng.random() < beard_chance else "none"
    if style == "bald" and beard == "none" and rng.random() < 0.5:
        beard = "short_beard"

    crest = logo_for(getattr(team, "abbreviation", "") if team else "")
    return {
        "skin": skin,
        "hair": hair,
        "style": style,
        "beard": beard,
        "brow": rng.randrange(3),
        "eyes": rng.randrange(3),
        "jaw": rng.randrange(3),
        "nose": rng.randrange(3),
        "headband": rng.random() < HEADBAND_CHANCE,
        # The kit. Two colours, straight off the club crest, so a squad reads
        # as a squad and a trade visibly changes somebody's shirt.
        #
        # `logo_for` returns primary/secondary. An earlier version asked for
        # "disc"/"mark" -- the words the crest *documentation* uses -- and got
        # the fallback grey for all thirty clubs, so every portrait in the
        # league wore the same shirt and nothing looked broken enough to
        # notice. `test_the_kit_comes_from_the_club` is what caught it.
        "kit": crest.get("primary", "#3A3A3A"),
        "trim": crest.get("secondary", "#F2F2F2"),
    }
