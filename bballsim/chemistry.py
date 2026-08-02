"""Team and lineup chemistry.

Chemistry is a multiplier on execution, not on talent. Two elite players who
have never played together turn the ball over more and pass up open looks; a
settled group finishes possessions cleanly.

Four layers:
  1. team_chemistry  -- locker room / system fit, one number per team
  2. pair_chemistry  -- how well two specific players play together
  3. character       -- teamwork, coachability and locker-room presence, which
                        are attributes of the five men actually on the floor
  4. lineup fit      -- structural (spacing, playmaking, size) rather than
                        relational, computed fresh from whoever is out there
"""

from __future__ import annotations

from dataclasses import dataclass

from . import composites as C
from .coach import chemistry_multiplier
from .models import Lineup, Team
from .ratings import fraction, normalize

# Chemistry is stored 0-100 rather than on the 1-20 rating scale: it measures a
# relationship, not an ability, and never appears in a scout's attribute list.
NEUTRAL_CHEMISTRY = 50.0


def normalize_chemistry(value: float) -> float:
    """0-100 chemistry -> the same -1..+1 units the engine works in."""
    return (value - NEUTRAL_CHEMISTRY) / NEUTRAL_CHEMISTRY


@dataclass
class ChemistryProfile:
    """Resolved chemistry for one lineup, in normalized -1..+1 units."""

    relational: float      # team + pair chemistry
    character: float       # teamwork / coachability / locker room
    spacing: float         # how much floor the lineup stretches
    playmaking_fit: float  # is there someone to actually create shots
    size_fit: float        # can this group rebound and protect the rim

    @property
    def execution(self) -> float:
        """Single modifier applied to turnovers / assists / shot quality."""
        return (
            0.40 * self.relational
            + 0.20 * self.character
            + 0.25 * self.playmaking_fit
            + 0.15 * self.spacing
        )

    def to_dict(self) -> dict:
        return {
            "relational": round(self.relational, 3),
            "character": round(self.character, 3),
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
    relational = normalize_chemistry(0.4 * team.team_chemistry + 0.6 * pair_average)

    # Character: who these five are, rather than how long they have played
    # together. Leadership is weighted toward the best leader on the floor --
    # one strong voice carries a group further than five average ones.
    character_scores = [
        0.45 * p.ratings.teamwork
        + 0.25 * p.ratings.coachability
        + 0.30 * p.hidden.locker_room_presence
        for p in lineup
    ]
    best_leader = max(
        0.6 * p.ratings.leadership + 0.4 * p.hidden.leadership_influence for p in lineup
    )
    character = normalize(
        0.75 * (sum(character_scores) / 5.0) + 0.25 * best_leader
    )

    # Spacing: how many of the five can genuinely shoot it, weighted by how
    # willing they are to. One non-shooter is survivable, three is not.
    shooters = [
        normalize(C.spacing(p)) * (0.5 + fraction(p.tendencies.three_point_rate))
        for p in lineup
    ]
    spacing = sum(shooters) / 5.0

    # Playmaking fit: dominated by the best creator, with a bump for a second.
    creators = sorted((normalize(C.playmaking(p)) for p in lineup), reverse=True)
    playmaking_fit = 0.6 * creators[0] + 0.25 * creators[1] + 0.15 * creators[2]

    # Size fit: rebounding and rim protection, with a penalty for going small.
    size_fit = (
        0.5 * normalize(sum(C.defensive_rebounding(p) for p in lineup) / 5.0)
        + 0.5 * normalize(sum(C.interior_defense(p) for p in lineup) / 5.0)
    )
    if len(lineup.bigs()) == 0:
        size_fit -= 0.15

    return ChemistryProfile(
        relational=relational,
        character=character,
        spacing=spacing,
        playmaking_fit=playmaking_fit,
        size_fit=size_fit,
    )


def drift_after_game(team: Team, minutes_together: dict[frozenset[str], float]) -> None:
    """Nudge pair chemistry toward familiarity after a game.

    Called by the league layer once a game finishes. Pairs that share the floor
    trend upward slowly; everything else decays toward neutral. Professional,
    coachable players build rapport faster.
    """
    # A coach who can lead a room gets it to gel faster.
    coaching = chemistry_multiplier(team.coach)
    rapport = {
        p.id: 1.0 + normalize(0.5 * p.ratings.teamwork + 0.5 * p.hidden.professionalism) * 0.5
        for p in team.players
    }

    for key, minutes in minutes_together.items():
        current = team.pair_chemistry.get(key, NEUTRAL_CHEMISTRY)
        pace = sum(rapport.get(pid, 1.0) for pid in key) / max(1, len(key))
        gain = min(1.5, minutes / 20.0) * pace * coaching
        team.pair_chemistry[key] = min(100.0, current + gain)

    for key, value in list(team.pair_chemistry.items()):
        if key not in minutes_together:
            team.pair_chemistry[key] = value + (NEUTRAL_CHEMISTRY - value) * 0.02
