"""Substitution logic.

Deliberately simple for now: the engine checks for subs at dead balls and
period breaks, pulling tired players for the best rested option in the
rotation. Replace `RotationManager.evaluate` with minute-target or
matchup-based logic later without touching the possession engine.
"""

from __future__ import annotations

from .. import composites as C
from ..health import starting_condition
from ..lineup import DEFAULT_RULES, can_swap
from ..models import Lineup, Player
from ..ratings import normalize
from ..tactics import slider_mod
from .state import TeamState

TIRED_THRESHOLD = 62.0     # condition below this and a player wants out

# How much of a player's *carried* fatigue the bench absorbs rather than
# charging him in minutes.
#
# The tired line is an absolute condition, and season fatigue now starts a
# player below 100 -- so without this a man who tipped off at 70 crossed the
# line far sooner than one who tipped off fresh, and season fatigue quietly
# became a minutes cap. Measured: the league's heaviest workload fell from 39.2
# minutes a night to 32.3 and the leading scorer from 28.8 points to 24.4, with
# team scoring unchanged. The points had not gone anywhere; they had been spread
# down the bench by a coach nobody asked.
#
# A real coach does the opposite of that with a tired star: he rides him a
# little longer and accepts a worse version of him, which is exactly what the
# attribute penalty already models. So most of the carried deficit is absorbed
# here and the rest still bites -- a knackered player does lose some floor time,
# just not seven minutes of it.
CARRIED_FATIGUE_ABSORBED = 0.62
RESTED_THRESHOLD = 78.0    # a bench player needs this much to come in
BENCH_RECOVERY_PER_SECOND = 0.115
CLOSING_TIME_SECONDS = 6 * 60  # inside this in the 4th, stars stay on

# How much fatigue a player is asked to play through, by depth-chart rank.
# Your best player grinds; the twelfth man comes out the moment he tires.
# This is what separates a 36-minute star from an 11-man committee.
RANK_FATIGUE_TOLERANCE = [-18.0, -15.0, -12.0, -10.0, -8.0, 2.0, 4.0, 6.0, 8.0]
DEEP_BENCH_TOLERANCE = 12.0

# Managers ride a short rotation; the back of the roster only plays when the
# front of it is unavailable (fouled out, injured, or gassed).
ROTATION_DEPTH = 9


class RotationManager:
    def evaluate(
        self,
        team_state: TeamState,
        period: int,
        final_period: int,
        clock: float,
    ) -> list[tuple[Player, Player]]:
        """Return (player_out, player_in) pairs to apply right now."""
        rotation = team_state.team.rotation()
        rank = {player.id: index for index, player in enumerate(rotation)}
        on_court = list(team_state.on_court.players)
        on_court_ids = {p.id for p in on_court}
        bench = [p for p in rotation if p.id not in on_court_ids]
        if not bench:
            return []

        closing = period >= final_period and clock <= CLOSING_TIME_SECONDS
        stagger = slider_mod(team_state.team.tactics.minutes_stagger)

        def tired_line(player: Player) -> float:
            index = rank.get(player.id, len(RANK_FATIGUE_TOLERANCE))
            tolerance = (
                RANK_FATIGUE_TOLERANCE[index]
                if index < len(RANK_FATIGUE_TOLERANCE)
                else DEEP_BENCH_TOLERANCE
            )
            line = TIRED_THRESHOLD + tolerance + stagger * 12.0
            # Most of what he walked in carrying is forgiven, so the line
            # follows him down instead of cutting his night short.
            carried = 100.0 - starting_condition(player)
            line -= carried * CARRIED_FATIGUE_ABSORBED
            return line - 25.0 if closing else line

        fouled_out = [p for p in on_court if self._fouled_out(team_state, p)]
        tired = sorted(
            (p for p in on_court if p.condition < tired_line(p) and p not in fouled_out),
            key=lambda p: p.condition,
        )
        candidates_out = fouled_out + tired

        swaps: list[tuple[Player, Player]] = []
        used_in: set[str] = set()
        # The lineup evolves as swaps are chosen, so legality has to be checked
        # against the running shape rather than the one we started with --
        # otherwise three individually-legal swaps can combine into four guards.
        shape = [p.position.value for p in on_court]

        for player_out in candidates_out:
            replacement = self._best_replacement(
                bench, rank, used_in, player_out, closing, on_court=shape,
            )
            if replacement is None:
                continue
            used_in.add(replacement.id)
            swaps.append((player_out, replacement))
            shape.remove(player_out.position.value)
            shape.append(replacement.position.value)
            if len(swaps) >= 3:
                break
        return swaps

    def _fouled_out(self, team_state: TeamState, player: Player) -> bool:
        return team_state.box.line(player.id).fouls >= 6

    def _best_replacement(
        self,
        bench: list[Player],
        rank: dict[str, int],
        used: set[str],
        player_out: Player,
        closing: bool,
        on_court: list[str] | None = None,
    ) -> Player | None:
        available = [p for p in bench if p.id not in used]
        # A tired centre cannot be replaced by a fourth guard. Filter to swaps
        # that leave a legal lineup *before* ranking, so the fallback path
        # ("nobody rested, take anyone") cannot break the shape either.
        if on_court is not None:
            available = [
                p for p in available
                if can_swap(on_court, player_out.position.value, p.position.value, DEFAULT_RULES)
            ]
            # No legal replacement? Then there is no substitution. A tired
            # centre stays on rather than being swapped for a fourth guard --
            # declining is always available, and always legal.
            if not available:
                return None
        in_rotation = [p for p in available if rank.get(p.id, 99) < ROTATION_DEPTH]
        options = [p for p in in_rotation if closing or p.condition >= RESTED_THRESHOLD]
        if not options:
            options = [p for p in in_rotation if p.condition > 45.0]
        if not options:
            options = [p for p in available if p.condition > 40.0]
        if not options:
            return None
        same_position = [p for p in options if p.position == player_out.position]
        pool = same_position or options
        # Depth-chart order dominates: minutes go to the rotation, not the roster.
        return max(pool, key=lambda p: -rank.get(p.id, 99) * 6.0 + p.condition * 0.1)

    def apply(self, team_state: TeamState, swaps: list[tuple[Player, Player]]) -> None:
        players = list(team_state.on_court.players)
        for player_out, player_in in swaps:
            if player_out in players and player_in not in players:
                players[players.index(player_out)] = player_in
        team_state.on_court = Lineup(players)

    def rest_bench(self, team_state: TeamState, seconds: float) -> None:
        on_court_ids = {p.id for p in team_state.on_court}
        for player in team_state.team.players:
            if player.id in on_court_ids:
                continue
            # Well-conditioned players get their wind back faster.
            rate = BENCH_RECOVERY_PER_SECOND * (1.0 + normalize(C.endurance(player)) * 0.4)
            player.condition = min(100.0, player.condition + seconds * rate)
