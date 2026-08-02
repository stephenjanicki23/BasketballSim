"""Seeded randomness.

Every game gets its own seed so a simulation is exactly reproducible: replay a
game, re-sim a day, or debug a weird box score by re-running the same seed.
"""

from __future__ import annotations

import hashlib
import random
from typing import Sequence, TypeVar

T = TypeVar("T")


def seed_from_string(text: str) -> int:
    """A stable integer seed for a string.

    Deliberately *not* `hash()`: Python salts string hashing per process, so
    `hash("game-3")` differs between runs and the same seed would replay a
    different game tomorrow. A digest is the same everywhere, forever, which
    is the whole point of seeding a save.
    """
    digest = hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % (2**31)


class SimRandom:
    def __init__(self, seed: int | str | None = None) -> None:
        if isinstance(seed, str):
            seed = seed_from_string(seed)
        self.seed = seed if seed is not None else random.randrange(2**31)
        self._random = random.Random(self.seed)

    def chance(self, probability: float) -> bool:
        return self._random.random() < probability

    def uniform(self, low: float, high: float) -> float:
        return self._random.uniform(low, high)

    def gauss(self, mu: float, sigma: float) -> float:
        return self._random.gauss(mu, sigma)

    def choice(self, items: Sequence[T]) -> T:
        return self._random.choice(items)

    def weighted_choice(self, items: Sequence[T], weights: Sequence[float]) -> T:
        safe = [max(0.0001, w) for w in weights]
        return self._random.choices(list(items), weights=safe, k=1)[0]

    def shuffled(self, items: Sequence[T]) -> list[T]:
        copy = list(items)
        self._random.shuffle(copy)
        return copy
