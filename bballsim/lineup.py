"""What a legal basketball lineup looks like.

Five players is not five *any* players. A modern NBA team puts someone on the
floor who can bring the ball up and someone who can protect the rim, and no
coach starts five centres because they happen to be his five best players.

Without a rule like this, "best available" is the only pressure on lineup
selection, and a team whose top five by ability are all bigs will play them --
which is exactly the failure this module exists to prevent.

Deliberately dependency-free: it works on position *strings*, so `models` can
import it for `Team.starters()` and `engine.rotation` can import it for
substitutions without a circular import.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Hashable, Iterable, Sequence

POSITIONS = ("PG", "SG", "SF", "PF", "C")

GUARDS = frozenset({"PG", "SG"})
WINGS = frozenset({"SF"})
BIGS = frozenset({"PF", "C"})

LINEUP_SIZE = 5


@dataclass(frozen=True)
class LineupRules:
    """The shape of a modern starting five.

    The defaults allow everything the league actually plays -- two-big
    lineups, small-ball with a single big, three-guard looks -- while ruling
    out the shapes that only appear when a sim picks purely on ability.
    """

    size: int = LINEUP_SIZE
    max_per_position: int = 2      # never three point guards, never five centres
    min_guards: int = 1            # somebody has to bring it up
    max_guards: int = 3
    min_bigs: int = 1              # somebody has to defend the rim
    max_bigs: int = 3
    max_centers: int = 2
    min_distinct_positions: int = 3

    def violations(self, positions: Sequence[str]) -> list[str]:
        """Every rule this set of positions breaks. Empty means legal."""
        problems: list[str] = []
        if len(positions) != self.size:
            problems.append(f"needs {self.size} players, got {len(positions)}")

        for position in POSITIONS:
            count = positions.count(position)
            if count > self.max_per_position:
                problems.append(f"{count} at {position} (max {self.max_per_position})")

        guards = sum(1 for p in positions if p in GUARDS)
        bigs = sum(1 for p in positions if p in BIGS)
        centers = positions.count("C")

        if guards < self.min_guards:
            problems.append(f"{guards} guards (min {self.min_guards})")
        if guards > self.max_guards:
            problems.append(f"{guards} guards (max {self.max_guards})")
        if bigs < self.min_bigs:
            problems.append(f"{bigs} bigs (min {self.min_bigs})")
        if bigs > self.max_bigs:
            problems.append(f"{bigs} bigs (max {self.max_bigs})")
        if centers > self.max_centers:
            problems.append(f"{centers} centres (max {self.max_centers})")
        if len(set(positions)) < self.min_distinct_positions:
            problems.append(
                f"{len(set(positions))} distinct positions "
                f"(min {self.min_distinct_positions})"
            )
        return problems

    def is_legal(self, positions: Sequence[str]) -> bool:
        return not self.violations(positions)


DEFAULT_RULES = LineupRules()


def describe(positions: Sequence[str]) -> str:
    """A lineup's shape as guards-wings-bigs, e.g. '2-1-2'."""
    guards = sum(1 for p in positions if p in GUARDS)
    wings = sum(1 for p in positions if p in WINGS)
    bigs = sum(1 for p in positions if p in BIGS)
    return f"{guards}-{wings}-{bigs}"


def choose_lineup(
    candidates: Iterable[tuple[Hashable, str, float]],
    rules: LineupRules = DEFAULT_RULES,
    pool_size: int = 10,
) -> list[Hashable]:
    """Pick the strongest legal lineup.

    `candidates` is (key, position, strength), strongest first mattering only
    through `strength`. Returns the chosen keys, strongest first.

    Brute force over combinations: the pool is capped at ten, so this is at
    most C(10,5) = 252 checks, which is nothing next to simulating a
    possession. Doing it exactly avoids the greedy failure where taking the
    best player first paints the lineup into an illegal corner.
    """
    ranked = sorted(candidates, key=lambda c: -c[2])
    if len(ranked) < rules.size:
        # Not enough bodies to be picky -- hand back what there is.
        return [key for key, _position, _strength in ranked]

    # Try the strongest few first; that is the answer almost every time and
    # keeps this to C(10,5) = 252 checks.
    best = _strongest_legal(ranked[:pool_size], rules)
    if best is None and len(ranked) > pool_size:
        # No legal five among the best players -- a roster whose top ten are
        # all centres, say. Widen to everyone before giving up, because the
        # guard who fixes the shape may be the eleventh man.
        best = _strongest_legal(ranked, rules)
    if best is None:
        # Genuinely impossible (a squad of five centres). Field the strongest
        # illegal lineup rather than refuse to play.
        return [key for key, _position, _strength in ranked[: rules.size]]
    return best


def _strongest_legal(
    ranked: Sequence[tuple[Hashable, str, float]], rules: LineupRules
) -> list[Hashable] | None:
    best: tuple[float, list[Hashable]] | None = None
    for group in combinations(ranked, rules.size):
        if not rules.is_legal([position for _key, position, _strength in group]):
            continue
        total = sum(strength for _key, _position, strength in group)
        if best is None or total > best[0]:
            best = (total, [key for key, _position, _strength in group])
    return best[1] if best else None


def can_swap(
    on_court: Sequence[str],
    position_out: str,
    position_in: str,
    rules: LineupRules = DEFAULT_RULES,
) -> bool:
    """Would this substitution leave a legal lineup?"""
    remaining = list(on_court)
    if position_out in remaining:
        remaining.remove(position_out)
    return rules.is_legal(remaining + [position_in])
