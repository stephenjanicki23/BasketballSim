"""Team and lineup chemistry.

Chemistry is a multiplier on execution, not on talent. Two elite players who
have never played together turn the ball over more and pass up open looks; a
settled group finishes possessions cleanly.

Model has three layers:
  1. team_chemistry  -- locker room / system fit, one number per team
  2. pair_chemistry  -- how well two specific players play together
  3. lineup fit      -- structural (spacing, size, ball-handling) rather than
                        relational, computed fresh from whoever is on the floor
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import Lineup, Team
from .ratings import normalize

NEUTRAL_CHEMISTRY = 50.0


@dataclass
class ChemistryProfile:
    """Resolved chemistry for one lineup, in normalized -1..+1 units."""

    relational: float   # team + pair chemistry
    spacing: float      # how much floor the lineup stretches
    playmaking_fit: float  # is there someone to actually create shots
    size_fit: float     # can this group rebound and protect the rim

    @property
    def execution(self) -> float:
        """Single modifier applied to turnovers / assists / shot quality."""
        return 0.5 * self.relational + 0.3 * self.playmaking_fit + 0.2 * self.spacing

    def to_dict(self) -> dict:
        return {
            "relational": round(self.relational, 3),
            "spacing": round(self.spacing, 3),
            "playmaking_fit": round(self.playmaking_fit, 3),
            "size_fit": round(self.size_fit, 3),
            "execution": round(self.execution, 3),
        }


def pair_key(player_a_id: str, player_b_id: str) -> frozenset[str]:
    return frozenset((player_a_id, player_b_id))


def get_pair_chemistry(team: Team, a_id: str, b_id: str) -> float:
    return team.pair_chemistry.get(pair_key(a_id, b_id), NEUTRAL_CHEMISTRY)


def set_pair_chemistry(team: Team, a_id: str, b_id: str, value: float) -> None:
    team.pair_chemistry[pair_key(a_id, b_id)] = max(0.0, min(100.0, value))


def evaluate(team: Team, lineup: Lineup) -> ChemistryProfile:
    """Resolve the chemistry profile for a lineup that is about to play."""
    ids = lineup.ids()

    pairs = [
        get_pair_chemistry(team, ids[i], ids[j])
        for i in range(len(ids))
        for j in range(i + 1, len(ids))
    ]
    pair_average = sum(pairs) / len(pairs) if pairs else NEUTRAL_CHEMISTRY
    relational = normalize(0.4 * team.team_chemistry + 0.6 * pair_average)

    # Spacing: how many of the five can genuinely shoot it, weighted by how
    # willing they are to. One non-shooter is survivable, three is not.
    shooters = [
        normalize(p.ratings.three_point) * (0.5 + p.tendencies.three_point_rate / 100.0)
        for p in lineup
    ]
    spacing = sum(shooters) / 5.0

    # Playmaking fit: dominated by the best creator, with a bump for a second one.
    creators = sorted((normalize(p.ratings.playmaking) for p in lineup), reverse=True)
    playmaking_fit = 0.6 * creators[0] + 0.25 * creators[1] + 0.15 * creators[2]

    # Size fit: rebounding and rim protection, with a penalty for going small.
    size_fit = (
        0.5 * normalize(lineup.average("def_rebounding"))
        + 0.5 * normalize(lineup.average("interior_defense"))
    )
    if len(lineup.bigs()) == 0:
        size_fit -= 0.15

    return ChemistryProfile(
        relational=relational,
        spacing=spacing,
        playmaking_fit=playmaking_fit,
        size_fit=size_fit,
    )


def drift_after_game(team: Team, minutes_together: dict[frozenset[str], float]) -> None:
    """Nudge pair chemistry toward familiarity after a game.

    Called by the league layer once a game finishes. Pairs that share the floor
    trend upward slowly; everything else decays toward neutral.
    """
    for key, minutes in minutes_together.items():
        current = team.pair_chemistry.get(key, NEUTRAL_CHEMISTRY)
        gain = min(1.5, minutes / 20.0)
        team.pair_chemistry[key] = min(100.0, current + gain)

    for key, value in list(team.pair_chemistry.items()):
        if key not in minutes_together:
            team.pair_chemistry[key] = value + (NEUTRAL_CHEMISTRY - value) * 0.02
