"""The board: next summer's draft class, declared in advance.

A mock draft is only worth reading if the names on it are the names that
actually arrive. Before this module the intake was built *at the moment of the
draft* and sized to the retirements it was replacing -- four clubs lose a
centre, the class is four centres -- which is a perfectly good way to keep
squads legal and a completely impossible one to write about in February. There
was no class to mock. There was a function that would invent one in July.

So the class is now **forward-declared**: drawn from the draft year alone,
months before anybody picks from it, and the same sixty players for everybody
who asks. `offseason.draft` then takes names off this board rather than
conjuring its own, which is what makes a mock draft a prediction rather than a
decoration.

**Seeded off the same string as the class strength.** `draft_picks.py` has
priced picks against `class_strength(year)` since the trade engine was built --
"we are saving our picks for 2031" is already a real position a front office
can hold. Generating the board from an unrelated seed would have produced a
league where the 2031 class is famously loaded and the sixty men in it are
ordinary. The strength draw and the player draw come off `draft-class-{year}`
together, and the strength *shifts the ladder*, so a loaded class is loaded in
the only way that can matter: the players in it are better.

**Two rounds, sixty names, and no lottery.** The order is reverse standings,
because that is what `offseason.draft` does; see `docs/TRADES.md` for why no
lottery is modelled rather than approximated.

**Positions are drawn from the class, not from the league's holes.** A real
draft class is whatever came through, and some years are thin at centre. That
is the fact that makes need-based and best-available mock drafts disagree,
which is the entire reason there are five writers rather than one. Keeping
squads legal is `offseason.draft`'s problem and it solves it by picking the
best available man *at the position it needs* -- see `sign_from_board`.
"""

from __future__ import annotations

import random

from .draft_picks import class_multiplier, class_strength
from .engine.rng import seed_from_string
from .models import Position
from .names import FIRST_NAMES, SURNAMES
from .prospects import TAIL_CA, TOP_CA, make_prospect

# Two rounds of thirty. The second round is mostly noise, and that is true of
# the real thing -- it is here because a mock draft that stops at thirty cannot
# show a club what its own second-rounder might be worth.
ROUND_SIZE = 30
ROUNDS = 2
BOARD_SIZE = ROUND_SIZE * ROUNDS

# How the five positions turn up in a class. Not uniform: guards and wings are
# simply more common than centres in any intake, and a class that was exactly
# 12 of each would never be thin anywhere, which is the thing worth simulating.
#
# Weights, not counts. The draw is multinomial, so an individual class can come
# out short at a position -- that is the point, and `POSITION_FLOOR` stops it
# becoming absurd.
POSITION_WEIGHTS: dict[str, float] = {
    "PG": 0.22, "SG": 0.24, "SF": 0.22, "PF": 0.18, "C": 0.14,
}

# However the draw falls, a class contains at least this many of each position.
# Without it a year could produce two centres for thirty clubs, and every mock
# draft would be the same list of two names at the top.
POSITION_FLOOR = 5

# What a strong class is worth at the top of the board. `class_multiplier`
# already exists and already prices picks; applying it to the CA ladder is what
# makes the label and the players agree.
#
# Applied to the *ceiling* far more than to the floor: a loaded draft is loaded
# because its best prospects are special, not because its 54th pick is good.
STRENGTH_AT_TOP = 1.0
STRENGTH_AT_TAIL = 0.15


def _ladder(year: int) -> list[float]:
    """CA targets down the board, tilted by how good this class is.

    `prospects.ladder` spaces a class evenly between the same two numbers every
    year. That is right for an intake sized to vacancies and wrong for a
    declared class, because it makes every draft identical in shape and leaves
    `class_label` describing something that is not there.
    """
    multiplier = class_multiplier(year)
    step = (TOP_CA - TAIL_CA) / (BOARD_SIZE - 1)
    board = []
    for index in range(BOARD_SIZE):
        base = TOP_CA - step * index
        share = index / (BOARD_SIZE - 1)
        weight = STRENGTH_AT_TOP + (STRENGTH_AT_TAIL - STRENGTH_AT_TOP) * share
        board.append(base * (1.0 + (multiplier - 1.0) * weight))
    return board


def _positions(rng: random.Random) -> list[str]:
    """One position per board slot, drawn then floored then shuffled.

    Shuffled at the end because the draw order is not the board order: a class
    thin at centre should still be able to have a centre first overall.
    """
    names = list(POSITION_WEIGHTS)
    weights = [POSITION_WEIGHTS[name] for name in names]
    drawn = rng.choices(names, weights=weights, k=BOARD_SIZE)

    # Top the short positions up by replacing the most common one, so the board
    # stays exactly BOARD_SIZE long however the floor bites.
    for position in names:
        while drawn.count(position) < POSITION_FLOOR:
            richest = max(names, key=drawn.count)
            drawn[drawn.index(richest)] = position
    rng.shuffle(drawn)
    return drawn


_CACHE: dict[int, list] = {}


def board(year: int) -> list:
    """The declared class for `year`, best prospect first.

    Memoised because building sixty players means solving sixty attribute sets,
    which is expensive enough to be felt on a page that asks twice.

    The returned players are **shared objects**. Nothing may mutate them until
    one is actually signed; `offseason.draft` copies what it needs. A caller
    that edited a board player would edit him for every future reader,
    including the mock drafts that have already named him.
    """
    cached = _CACHE.get(year)
    if cached is not None:
        return cached

    rng = random.Random(seed_from_string(f"draft-class-{year}-board"))
    targets = _ladder(year)
    positions = _positions(rng)
    taken: set[str] = set()
    players = []
    for index, (target, position) in enumerate(zip(targets, positions)):
        first, last = _name(rng, taken)
        players.append(make_prospect(
            rng,
            player_id=f"D{year}-{index + 1:02d}",
            jersey=0,                       # the club assigns it on signing
            position=Position(position),
            target_ca=target,
            season_start_year=year,
            first_name=first,
            last_name=last,
            rank=index / (BOARD_SIZE - 1),
            draft_size=BOARD_SIZE,
            pick=index + 1,
        ))
    _CACHE[year] = players
    return players


def _name(rng: random.Random, taken: set[str]) -> tuple[str, str]:
    """A name no one else on *this board* is using.

    Deliberately not checked against the league. The board is generated from
    the year alone so that it reads the same to everybody, and reaching into a
    particular league to avoid a collision would make one club's board differ
    from another's. `offseason.draft` disambiguates at signing, which is the
    only moment a duplicate could actually confuse a box score.
    """
    for _ in range(60):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(SURNAMES)
        if f"{first} {last}" not in taken:
            taken.add(f"{first} {last}")
            return first, last
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(SURNAMES)
    taken.add(f"{first} {last}")
    return first, last


def label(year: int) -> str:
    """"Loaded", "Ordinary", and so on -- the shared read on this class."""
    from .draft_picks import class_label
    return class_label(year)


def strength(year: int) -> float:
    return class_strength(year)


def by_position(year: int, position: str) -> list:
    """The board filtered to one position, best first."""
    return [p for p in board(year) if p.position.value == position]


def best_available(year: int, taken: set[str], position: str | None = None):
    """The top man left on the board, optionally at one position.

    `taken` is a set of prospect ids. Returns `None` when the board is
    exhausted, which is a real outcome rather than an error: a summer with more
    vacancies at one position than the class contains has to fall back on
    somebody, and `offseason.draft` says what it does about that.
    """
    for player in board(year):
        if player.id in taken:
            continue
        if position is not None and player.position.value != position:
            continue
        return player
    return None
