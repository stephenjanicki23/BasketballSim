"""Draft picks as assets a front office can actually trade.

Before this the draft was a *process*: `league/offseason.draft` filled every
retirement vacancy from an intake, worst club picking first, and there was no
object anywhere representing "Redstone's 2029 first". You cannot build a trade
engine on that. Half of every real NBA trade is picks, a rebuild is mostly the
accumulation of picks, and a contender's aggression is measured in how many it
is willing to send out. So picks become things.

**A pick is owed by a club, not held by one.** `original_team` never changes --
it is what decides where the pick lands in the order -- and `owner` is who
gets to use it. That distinction is the whole reason a traded pick is
interesting: a rebuilding club wants Redstone's pick precisely because Redstone
is bad, and if the pick were simply "a 2029 first" that would not be true.

**Value is dynamic and mostly about uncertainty.** A pick three years out is
worth less than the same pick this year not because the player will be worse
but because nobody knows where it will land. The curve below prices a *known*
slot; `expected_value` blends that against how uncertain the slot is, which is
what makes a rebuilding team's own unprotected first the most valuable asset in
the league and a contender's 2031 second nearly worthless.

**What is real here and what is not.** Slot projection, class strength, years
away, protections and swaps are all modelled and all move the number. A lottery
*draw* is not: `projected_slot` uses reverse standings order, which is what the
existing `offseason.draft` actually does, so the valuation matches the draft
the league really runs rather than a lottery it does not have. That is stated
rather than papered over, and `LOTTERY_ODDS` is left undeclared instead of
being written as a constant nothing consults.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .engine.rng import seed_from_string

# How many rounds a draft has. Two, like the real one -- and the second round
# matters here mainly as small change in a negotiation, which is also true.
ROUNDS = 2

# How far ahead clubs trade. Real leagues cap this (the "Stepien rule" stops a
# club trading consecutive future firsts); this is the horizon the valuation
# curve is defined over.
FUTURE_YEARS = 4


@dataclass
class DraftPick:
    """One pick in one round of one draft.

    `original_team` is whose record decides where it lands. `owner` is who uses
    it. They differ exactly when the pick has been traded, which is the only
    reason any of this is interesting.
    """

    year: int
    round: int
    original_team: str
    owner: str = ""

    # Lottery protection: the pick conveys only if it lands outside the top
    # `protected_top`. 0 means unprotected. A protected pick is worth less to
    # the club receiving it and more to the club sending it, and `value_of`
    # prices that.
    protected_top: int = 0

    # A swap right rather than the pick itself: the holder may take the better
    # of the two. Worth a fraction of a pick and priced as one.
    swap_with: str = ""

    def __post_init__(self) -> None:
        if not self.owner:
            self.owner = self.original_team

    @property
    def traded(self) -> bool:
        return self.owner != self.original_team

    @property
    def label(self) -> str:
        suffix = ("" if not self.protected_top
                  else f" (top-{self.protected_top} protected)")
        return f"{self.year} Rd {self.round}{suffix}"

    def to_dict(self) -> dict:
        return {
            "year": self.year,
            "round": self.round,
            "originalTeam": self.original_team,
            "owner": self.owner,
            "protectedTop": self.protected_top,
            "swapWith": self.swap_with,
            "traded": self.traded,
            "label": self.label,
        }


# --------------------------------------------------------------------------
# What a slot is worth
#
# The shape of every real pick-value chart: brutally steep at the top and
# almost flat after the lottery. The first pick is not twice the fifth, it is
# four or five times it, and picks 25 and 45 are close to interchangeable.
#
# Expressed in the same units as `trade_value` uses for players, so a pick and
# a player can be added up on the same side of a deal without a conversion
# constant sitting between them.
# --------------------------------------------------------------------------

SLOT_CURVE: tuple[tuple[int, float], ...] = (
    (1, 1000.0),
    (2, 780.0),
    (3, 660.0),
    (4, 570.0),
    (5, 500.0),
    (8, 380.0),
    (11, 300.0),
    (14, 240.0),
    (20, 160.0),
    (25, 115.0),
    (30, 90.0),
    (40, 45.0),
    (50, 22.0),
    (60, 8.0),
)


def slot_value(slot: int) -> float:
    """What a pick at this overall position is worth, straight-line between
    the anchors above."""
    slot = max(1, int(slot))
    if slot <= SLOT_CURVE[0][0]:
        return SLOT_CURVE[0][1]
    for index in range(len(SLOT_CURVE) - 1):
        low_slot, low_value = SLOT_CURVE[index]
        high_slot, high_value = SLOT_CURVE[index + 1]
        if slot <= high_slot:
            span = high_slot - low_slot
            if span <= 0:
                return high_value
            t = (slot - low_slot) / span
            return low_value + (high_value - low_value) * t
    return SLOT_CURVE[-1][1]


# How much of its value a pick loses per year of distance. Not a discount rate
# on the player -- a discount on *knowing anything*. A pick four years out
# belongs to a club whose record nobody can predict.
FUTURE_DISCOUNT = 0.12

# ...and how far a distant pick's projected slot regresses toward the middle of
# the draft, for the same reason. At four years out, a tanking club's own first
# is priced almost exactly as a mid-lottery pick, because that is what it is.
FUTURE_REGRESSION = 0.30

# Some draft classes are better than others. Drawn once per year from the year
# itself, so every club in the league agrees about which drafts are loaded --
# which is what lets "we are saving our picks for 2031" be a real position.
CLASS_STRENGTH_SWING = 0.22


def class_strength(year: int) -> float:
    """0.0-1.0 -- how good this draft is thought to be.

    Deterministic on the year, so it is a fact about the league rather than
    about which club is asking.
    """
    rng = random.Random(seed_from_string(f"draft-class-{year}"))
    return min(1.0, max(0.0, rng.betavariate(2.6, 2.6)))


def class_label(year: int) -> str:
    strength = class_strength(year)
    if strength >= 0.80:
        return "Loaded"
    if strength >= 0.62:
        return "Strong"
    if strength >= 0.38:
        return "Ordinary"
    if strength >= 0.20:
        return "Weak"
    return "Very weak"


def class_multiplier(year: int) -> float:
    return 1.0 + (class_strength(year) - 0.5) * 2.0 * CLASS_STRENGTH_SWING


# --------------------------------------------------------------------------
# Where a pick is likely to land
# --------------------------------------------------------------------------

def standings_order(league) -> list[str]:
    """Club ids worst-first -- the order `offseason.draft` actually picks in.

    **Not a lottery.** This league does not run one, so pricing picks against
    lottery odds would be valuing a mechanism that does not exist. When a
    lottery arrives this is where it goes, and nothing else changes.
    """
    try:
        table = league.standings_table()
    except Exception:
        return list(getattr(league, "teams", {}))
    return [row["team_id"] for row in reversed(table)]


def projected_slot(league, pick: DraftPick, current_year: int) -> float:
    """Where this pick is likely to land, 1-60.

    For this year's draft that is just the club's position in the order. For a
    future one it regresses toward the middle, because a club's record three
    years out is not knowable -- and that regression is most of why future
    picks are cheaper than present ones.
    """
    order = standings_order(league)
    count = max(1, len(order))
    try:
        position = order.index(pick.original_team) + 1
    except ValueError:
        position = (count + 1) / 2

    years_away = max(0, pick.year - current_year)
    if years_away:
        middle = (count + 1) / 2
        pull = min(1.0, years_away * FUTURE_REGRESSION)
        position = position + (middle - position) * pull

    return position + (pick.round - 1) * count


def value_of(league, pick: DraftPick, current_year: int) -> float:
    """What this pick is worth right now, in trade-value units."""
    slot = projected_slot(league, pick, current_year)
    value = slot_value(round(slot))
    value *= class_multiplier(pick.year)

    years_away = max(0, pick.year - current_year)
    value *= max(0.35, 1.0 - years_away * FUTURE_DISCOUNT)

    # Protection cuts value in proportion to how much of the good outcome it
    # removes. A top-4 protected pick from a bad club is nearly worthless to
    # the club receiving it, which is exactly why clubs fight over protections.
    if pick.protected_top > 0:
        kept = max(0.0, 1.0 - _protection_bite(slot, pick.protected_top))
        value *= max(0.15, kept)

    # A swap is the *difference* between two picks, not a pick.
    if pick.swap_with:
        value *= 0.32
    return value


def _protection_bite(slot: float, protected_top: int) -> float:
    """How much of a pick's value the protection takes away, 0-1.

    A protection only bites when the pick is likely to land inside it. Top-3
    protection on a pick projected 25th costs nothing; on one projected 2nd it
    costs nearly everything.
    """
    if protected_top <= 0:
        return 0.0
    if slot > protected_top + 6:
        return 0.05
    if slot <= protected_top:
        return 0.80
    # Inside the fuzzy band just outside the protection.
    return 0.80 - 0.75 * ((slot - protected_top) / 6.0)


# --------------------------------------------------------------------------
# A league's worth of picks
# --------------------------------------------------------------------------

def generate(team_ids, current_year: int, years: int = FUTURE_YEARS) -> list[DraftPick]:
    """Every club's own picks for the next few drafts, untraded.

    The starting position: everybody owns everything of their own. Trades are
    what make the picture interesting, and they move `owner`.
    """
    picks: list[DraftPick] = []
    for offset in range(years):
        year = current_year + offset
        for team_id in team_ids:
            for round_number in range(1, ROUNDS + 1):
                picks.append(DraftPick(year=year, round=round_number,
                                       original_team=team_id, owner=team_id))
    return picks


def ensure(league) -> list[DraftPick]:
    """The league's pick inventory, created on first ask.

    Held on the league object for the same reason the offseason record is:
    every screen and every evaluation wants the same list, and threading it
    through every call would let two callers disagree about who owns what.
    """
    existing = getattr(league, "draft_picks", None)
    if existing:
        return existing
    made = generate(list(league.teams), current_year(league))
    league.draft_picks = made
    return made


def _start_year(season: str) -> int:
    try:
        return int(str(season).split("-")[0])
    except (ValueError, IndexError):
        return 2026


# A draft is named for the year it is *held*, which is the spring after the
# season that decides its order: the 2026-27 season ends in the 2027 draft.
#
# This module used to number picks off the season's opening year, so it called
# that draft "2026 Rd 1" while `offseason.draft` -- the code that actually runs
# it -- generated its class under 2027. Two names for one draft, and it cost
# nothing while no object was keyed on the year. `draft_class.board(year)` is
# keyed on it: the mismatch meant the sixty players the mock drafts named were
# not the sixty who would arrive.
DRAFT_YEAR_OFFSET = 1


def current_year(league) -> int:
    """The year of the next draft -- the one this season's table decides."""
    return _start_year(getattr(league, "season", "")) + DRAFT_YEAR_OFFSET


def owned_by(league, team_id: str) -> list[DraftPick]:
    """Every pick this club currently holds, soonest and highest first."""
    picks = [p for p in ensure(league) if p.owner == team_id]
    picks.sort(key=lambda p: (p.year, p.round,
                              projected_slot(league, p, current_year(league))))
    return picks


def capital(league, team_id: str) -> float:
    """The total trade value of a club's pick cupboard.

    The number a rebuild is actually measured in, and the one a contender
    spends down.
    """
    year = current_year(league)
    return sum(value_of(league, pick, year) for pick in owned_by(league, team_id))


def transfer(league, pick: DraftPick, to_team: str) -> None:
    """Move a pick. The only way ownership ever changes."""
    pick.owner = to_team


def summary(league, team_id: str) -> dict:
    """One club's draft assets, as a screen wants them."""
    year = current_year(league)
    picks = owned_by(league, team_id)
    return {
        "teamId": team_id,
        "capital": round(capital(league, team_id), 1),
        "count": len(picks),
        "firsts": sum(1 for p in picks if p.round == 1),
        "picks": [
            {
                **pick.to_dict(),
                "projectedSlot": round(projected_slot(league, pick, year), 1),
                "value": round(value_of(league, pick, year), 1),
                "classLabel": class_label(pick.year),
            }
            for pick in picks
        ],
    }
