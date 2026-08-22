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

# How far the head coach's player-management rating moves that. This is the
# *minutes* half of the lever -- the softer one. Sitting a player out is a team
# sheet decision taken before the game; this is the coach shortening a shift
# because the man in front of him has lost a step.
#
# A high rating absorbs less, so the line stays high and a tired player comes
# off sooner. A low one absorbs more and rides him. Neither is free: the careful
# coach has fresher legs in March and gave away minutes in November, which is
# the whole trade.
MANAGEMENT_ABSORB_SWING = 0.26
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

# The shortest a man plays before he can be moved again. Substitutions now only
# happen at dead balls, but there are forty-odd of those a game, and without a
# floor on a stint the rotation thrashed: a player dipped below his tired line,
# got pulled at the next whistle, and a minute later the man who replaced him
# was the tired one. Three game-minutes of protection turns that churn -- most
# of a hundred subs a night, the majority of them a man going straight back out
# -- into the couple of dozen real rotations a game actually has. A foul-out or
# an injury is an emergency and ignores it; nothing else does.
MIN_STINT_SECONDS = 180.0


class RotationManager:
    """How deep a bench goes.

    `depth` is per-game rather than a module constant because the All-Star
    exhibition plays all twelve: a marquee game where three of the men the
    league just voted in record a DNP is not the game that was voted for. Every
    league game leaves it at `ROTATION_DEPTH`.
    """

    def __init__(self, depth: int = ROTATION_DEPTH) -> None:
        self.depth = depth
        # game_seconds at which each player last went in or out. Missing means
        # "since tip-off", which is eligible -- a starter can be pulled the
        # first time he tires without having to wait out a stint he began on
        # the floor.
        self._changed_at: dict[str, float] = {}

    def evaluate(
        self,
        team_state: TeamState,
        period: int,
        final_period: int,
        clock: float,
        now: float = 0.0,
    ) -> list[tuple[Player, Player]]:
        """Return (player_out, player_in) pairs to apply right now.

        `now` is the game clock in elapsed seconds, used only to keep a man on
        the floor for `MIN_STINT_SECONDS` before he can be moved again.
        """

        def settled(player: Player) -> bool:
            """Long enough in his current role to be moved without churn."""
            return now - self._changed_at.get(player.id, -1e9) >= MIN_STINT_SECONDS
        rotation = team_state.team.rotation()
        rank = {player.id: index for index, player in enumerate(rotation)}
        on_court = list(team_state.on_court.players)
        on_court_ids = {p.id for p in on_court}
        bench = [p for p in rotation if p.id not in on_court_ids]
        if not bench:
            return []
        # Who is eligible to come in: everyone who has been off long enough.
        # Kept as a set the replacement search can widen past in an emergency.
        rested_enough = {p.id for p in bench
                         if now - self._changed_at.get(p.id, -1e9) >= MIN_STINT_SECONDS}

        closing = period >= final_period and clock <= CLOSING_TIME_SECONDS
        stagger = slider_mod(team_state.team.tactics.minutes_stagger)
        coach = team_state.team.coach
        management = coach.ratings.player_management if coach else 50.0
        absorbed = max(0.0, min(1.0, CARRIED_FATIGUE_ABSORBED
                                - ((management - 50.0) / 50.0) * MANAGEMENT_ABSORB_SWING))

        def tired_line(player: Player) -> float:
            index = rank.get(player.id, len(RANK_FATIGUE_TOLERANCE))
            tolerance = (
                RANK_FATIGUE_TOLERANCE[index]
                if index < len(RANK_FATIGUE_TOLERANCE)
                else DEEP_BENCH_TOLERANCE
            )
            line = TIRED_THRESHOLD + tolerance + stagger * 12.0
            # Most of what he walked in carrying is forgiven, so the line
            # follows him down instead of cutting his night short -- how much,
            # is what the coach's player-management rating decides.
            carried = 100.0 - starting_condition(player)
            line -= carried * absorbed
            return line - 25.0 if closing else line

        fouled_out = [p for p in on_court if self._fouled_out(team_state, p)]
        # A tired man is only pulled once he has actually had his stint. The
        # foul-out list is not filtered -- six fouls comes off at once, minimum
        # stint or not.
        tired = sorted(
            (p for p in on_court
             if p.condition < tired_line(p) and p not in fouled_out
             and settled(p)),
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
            emergency = player_out in fouled_out
            replacement = self._best_replacement(
                bench, rank, used_in, player_out, closing, on_court=shape,
                rested_enough=rested_enough, emergency=emergency,
            )
            if replacement is None:
                continue
            used_in.add(replacement.id)
            swaps.append((player_out, replacement))
            self._changed_at[player_out.id] = now
            self._changed_at[replacement.id] = now
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
        rested_enough: set[str] | None = None,
        emergency: bool = False,
    ) -> Player | None:
        available = [p for p in bench if p.id not in used]
        # Prefer men who have been off long enough to come back without churn.
        # Dropped when it would leave nobody -- an empty bench of "rested" men,
        # or a foul-out that has to be covered right now by whoever is there.
        if rested_enough is not None and not emergency:
            settled = [p for p in available if p.id in rested_enough]
            if settled:
                available = settled
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
        in_rotation = [p for p in available if rank.get(p.id, 99) < self.depth]
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
            # Base endurance again -- a tired man must not also recover
            # more slowly because he is tired.
            rate = BENCH_RECOVERY_PER_SECOND * (1.0 + normalize(C.endurance_base(player)) * 0.4)
            player.condition = min(100.0, player.condition + seconds * rate)
