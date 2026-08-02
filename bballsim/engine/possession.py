"""Possession resolution -- the core of the simulation.

One call to `PossessionEngine.play` advances the game by exactly one
possession: it burns clock, decides whether the ball is turned over, picks a
shooter and a shot, resolves it, handles fouls and free throws, and rebounds
the miss. Every branch emits play-by-play events.

All tuning constants live at the top of this module. The general shape is:

    probability = league_baseline
                  + rating_advantage * sensitivity
                  + tactical_modifiers
                  + chemistry / fatigue / situational modifiers

Ratings and tactics enter as normalized (-1..+1) values so the sensitivity
numbers below read as "how many percentage points does a full scale of talent
move this outcome".
"""

from __future__ import annotations

from dataclasses import dataclass

from ..chemistry import ChemistryProfile
from ..chemistry import evaluate as evaluate_chemistry
from ..models import Lineup, Player
from ..ratings import advantage, normalize
from ..tactics import defensive_effect, offensive_effect, slider_mod
from .events import EventType, ShotZone, format_clock
from .rng import SimRandom
from .state import GameState, TeamState

# --------------------------------------------------------------------------
# League baselines. These are the numbers a perfectly average team produces
# against a perfectly average defence with neutral tactics.
# --------------------------------------------------------------------------

BASE_POSSESSION_SECONDS = 14.5
POSSESSION_SECONDS_SPREAD = 5.5
MIN_POSSESSION_SECONDS = 2.5

BASE_TURNOVER_RATE = 0.132
BASE_STEAL_SHARE = 0.60          # share of turnovers that are steals

# Shot mix: how often each zone is attacked, before tactics/tendencies.
BASE_SHOT_MIX: dict[ShotZone, float] = {
    ShotZone.RIM: 0.30,
    ShotZone.PAINT: 0.12,
    ShotZone.MID_RANGE: 0.16,
    ShotZone.CORNER_THREE: 0.11,
    ShotZone.ABOVE_BREAK_THREE: 0.31,
}

BASE_FG_PCT: dict[ShotZone, float] = {
    ShotZone.RIM: 0.635,
    ShotZone.PAINT: 0.440,
    ShotZone.MID_RANGE: 0.415,
    ShotZone.CORNER_THREE: 0.372,
    ShotZone.ABOVE_BREAK_THREE: 0.342,
}

# How much a full scale of shooter-over-defender advantage moves the make rate.
SHOOTING_SENSITIVITY: dict[ShotZone, float] = {
    ShotZone.RIM: 0.150,
    ShotZone.PAINT: 0.140,
    ShotZone.MID_RANGE: 0.150,
    ShotZone.CORNER_THREE: 0.130,
    ShotZone.ABOVE_BREAK_THREE: 0.130,
}

BASE_ASSIST_RATE = 0.60          # share of made field goals that are assisted
BASE_OFF_REBOUND_RATE = 0.235
BASE_BLOCK_RATE = 0.058          # of two-point attempts
BASE_SHOOTING_FOUL_RATE = 0.105
BASE_NON_SHOOTING_FOUL_RATE = 0.105
BASE_FT_PCT = 0.715

CHEMISTRY_TURNOVER_SENSITIVITY = 0.045
CHEMISTRY_SHOT_QUALITY_SENSITIVITY = 0.030
FATIGUE_SHOOTING_PENALTY = 0.070   # at fully gassed
FATIGUE_TURNOVER_PENALTY = 0.030
# Seconds of floor time that cost an average-stamina player one point of condition.
FATIGUE_SECONDS_PER_POINT = 16.0


@dataclass
class SideContext:
    """Everything the engine needs to know about one team for one possession."""

    state: TeamState
    lineup: Lineup
    chemistry: ChemistryProfile

    @property
    def tactics(self):
        return self.state.team.tactics


class PossessionEngine:
    def __init__(self, rng: SimRandom) -> None:
        self.rng = rng

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------
    def play(self, game: GameState, offense: TeamState, defense: TeamState) -> None:
        off = self._context(offense)
        deff = self._context(defense)

        seconds = self._possession_length(game, off, deff)
        self._burn_clock(game, seconds)
        game.possession_count += 1
        offense.box.possessions += 1

        if self._is_turnover(off, deff):
            self._resolve_turnover(game, off, deff)
            return

        if self._is_non_shooting_foul(off, deff):
            if self._resolve_non_shooting_foul(game, off, deff):
                return  # bonus free throws ended the possession

        self._resolve_shot_attempt(game, off, deff, putback=False)

    # ------------------------------------------------------------------
    # Context / clock
    # ------------------------------------------------------------------
    def _context(self, team_state: TeamState) -> SideContext:
        return SideContext(
            state=team_state,
            lineup=team_state.on_court,
            chemistry=evaluate_chemistry(team_state.team, team_state.on_court),
        )

    def _possession_length(self, game: GameState, off: SideContext, deff: SideContext) -> float:
        pace = (
            slider_mod(off.tactics.pace) * 0.35
            + offensive_effect(off.tactics, "pace")
            + slider_mod(off.tactics.tempo_after_rebound) * 0.10
        )
        # Faster teams shorten possessions; pressure defence lengthens them.
        pressure = slider_mod(deff.tactics.defensive_pressure) * 0.08
        seconds = BASE_POSSESSION_SECONDS * (1.0 - pace + pressure)
        seconds += self.rng.gauss(0.0, POSSESSION_SECONDS_SPREAD)

        # Late-game situations override everything: trailing teams rush, leading
        # teams milk the clock.
        seconds = self._apply_endgame_urgency(game, off, seconds)
        return max(MIN_POSSESSION_SECONDS, min(game.rules.shot_clock, seconds))

    def _apply_endgame_urgency(self, game: GameState, off: SideContext, seconds: float) -> float:
        last_period = game.period >= game.rules.periods
        if not last_period or game.clock > 120:
            return seconds
        margin = game.home.score - game.away.score
        if off.state is game.away:
            margin = -margin
        if margin < 0:                     # trailing: hurry
            return seconds * 0.55
        if margin > 0 and game.clock < 60:  # leading: bleed the clock
            return min(game.rules.shot_clock, seconds * 1.6)
        return seconds

    def _burn_clock(self, game: GameState, seconds: float) -> None:
        seconds = min(seconds, game.clock)
        game.clock -= seconds
        game.game_seconds += seconds
        self._accrue_minutes(game.home, seconds)
        self._accrue_minutes(game.away, seconds)

    def _accrue_minutes(self, team_state: TeamState, seconds: float) -> None:
        ids = team_state.on_court.ids()
        for player in team_state.on_court:
            team_state.box.line(player.id, player.name).seconds += seconds
            drain = seconds * (1.0 - normalize(player.ratings.stamina) * 0.5) / FATIGUE_SECONDS_PER_POINT
            player.condition = max(0.0, player.condition - drain)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = frozenset((ids[i], ids[j]))
                team_state.pair_seconds[key] = team_state.pair_seconds.get(key, 0.0) + seconds

    # ------------------------------------------------------------------
    # Turnovers
    # ------------------------------------------------------------------
    def _is_turnover(self, off: SideContext, deff: SideContext) -> bool:
        handling = off.lineup.average("ball_handling")
        iq = off.lineup.average("basketball_iq")
        pressure_skill = deff.lineup.average("steal")

        rate = BASE_TURNOVER_RATE
        rate -= advantage(0.6 * handling + 0.4 * iq, pressure_skill) * 0.055
        rate += offensive_effect(off.tactics, "turnover_rate") * 0.5
        rate += defensive_effect(deff.tactics, "steal_rate") * 0.5
        rate += slider_mod(deff.tactics.defensive_pressure) * 0.030
        rate += slider_mod(off.tactics.ball_movement) * 0.012
        rate -= off.chemistry.execution * CHEMISTRY_TURNOVER_SENSITIVITY
        rate += self._fatigue(off.lineup) * FATIGUE_TURNOVER_PENALTY
        return self.rng.chance(self._bounded(rate, 0.02, 0.35))

    def _resolve_turnover(self, game: GameState, off: SideContext, deff: SideContext) -> None:
        loser = self.rng.weighted_choice(
            off.lineup.players,
            [self._usage_weight(p) * (1.4 - normalize(p.ratings.ball_handling)) for p in off.lineup],
        )
        stealer = None
        if self.rng.chance(BASE_STEAL_SHARE + defensive_effect(deff.tactics, "steal_rate")):
            stealer = self.rng.weighted_choice(
                deff.lineup.players,
                [0.5 + normalize(p.ratings.steal) + normalize(p.ratings.speed) * 0.3 for p in deff.lineup],
            )

        off.state.box.line(loser.id, loser.name).turnovers += 1
        if stealer is not None:
            deff.state.box.line(stealer.id, stealer.name).steals += 1
            self._emit(
                game, EventType.STEAL, deff.state, stealer,
                f"{stealer.short_name} steals it from {loser.short_name}",
                secondary=loser,
            )
        else:
            self._emit(
                game, EventType.TURNOVER, off.state, loser,
                f"Turnover by {loser.short_name}",
            )

    # ------------------------------------------------------------------
    # Fouls
    # ------------------------------------------------------------------
    def _is_non_shooting_foul(self, off: SideContext, deff: SideContext) -> bool:
        rate = BASE_NON_SHOOTING_FOUL_RATE
        rate += defensive_effect(deff.tactics, "foul_rate") * 0.5
        rate -= slider_mod(deff.tactics.foul_discipline) * 0.020
        rate += slider_mod(deff.tactics.defensive_pressure) * 0.015
        rate -= normalize(deff.lineup.average("discipline")) * 0.015
        return self.rng.chance(self._bounded(rate, 0.005, 0.20))

    def _resolve_non_shooting_foul(self, game: GameState, off: SideContext, deff: SideContext) -> bool:
        fouler = self._pick_fouler(deff)
        self._charge_foul(game, deff, fouler)

        if not deff.state.in_bonus:
            self._emit(
                game, EventType.FOUL, deff.state, fouler,
                f"Foul on {fouler.short_name}", detail={"kind": "personal", "bonus": False},
            )
            return False

        shooter = self.rng.weighted_choice(
            off.lineup.players, [self._usage_weight(p) for p in off.lineup]
        )
        self._emit(
            game, EventType.FOUL, deff.state, fouler,
            f"Foul on {fouler.short_name} -- {shooter.short_name} to the line",
            secondary=shooter, detail={"kind": "personal", "bonus": True},
        )
        self._shoot_free_throws(game, off, shooter, 2)
        return True

    def _pick_fouler(self, deff: SideContext) -> Player:
        return self.rng.weighted_choice(
            deff.lineup.players,
            [max(0.15, 1.0 - normalize(p.ratings.discipline)) for p in deff.lineup],
        )

    def _charge_foul(self, game: GameState, side: SideContext, player: Player) -> None:
        side.state.fouls_this_period += 1
        side.state.box.line(player.id, player.name).fouls += 1

    # ------------------------------------------------------------------
    # Shots
    # ------------------------------------------------------------------
    def _resolve_shot_attempt(
        self, game: GameState, off: SideContext, deff: SideContext, putback: bool
    ) -> None:
        shooter = self._pick_shooter(off, putback)
        zone = ShotZone.RIM if putback else self._pick_zone(off, deff, shooter)

        defender = self._pick_defender(deff, zone)
        make_pct = self._make_probability(off, deff, shooter, defender, zone)

        # A foul can happen on the shot itself.
        if self.rng.chance(self._shooting_foul_rate(off, deff, shooter, defender, zone)):
            self._resolve_shooting_foul(game, off, deff, shooter, defender, zone, make_pct)
            return

        if not zone.is_three and self.rng.chance(self._block_rate(off, deff, defender, zone)):
            self._record_shot(off, shooter, zone, made=False)
            deff.state.box.line(defender.id, defender.name).blocks += 1
            self._emit(
                game, EventType.BLOCK, deff.state, defender,
                f"{defender.short_name} blocks {shooter.short_name}'s shot {zone.label}",
                secondary=shooter, detail={"zone": zone.value},
            )
            self._rebound(game, off, deff)
            return

        if self.rng.chance(make_pct):
            self._record_shot(off, shooter, zone, made=True)
            assister = self._pick_assister(off, shooter, zone)
            text = f"{shooter.short_name} makes {self._shot_phrase(zone)}"
            if assister is not None:
                off.state.box.line(assister.id, assister.name).assists += 1
                text += f" ({assister.short_name} assist)"
            self._emit(
                game, EventType.SHOT_MADE, off.state, shooter, text,
                secondary=assister,
                detail={"zone": zone.value, "points": zone.points, "putback": putback},
            )
        else:
            self._record_shot(off, shooter, zone, made=False)
            self._emit(
                game, EventType.SHOT_MISSED, off.state, shooter,
                f"{shooter.short_name} misses {self._shot_phrase(zone)}",
                detail={"zone": zone.value, "putback": putback},
            )
            self._rebound(game, off, deff)

    def _pick_shooter(self, off: SideContext, putback: bool) -> Player:
        if putback:
            weights = [0.4 + normalize(p.ratings.off_rebounding) + normalize(p.ratings.finishing) * 0.5
                       for p in off.lineup]
        else:
            weights = [self._usage_weight(p) for p in off.lineup]
        return self.rng.weighted_choice(off.lineup.players, weights)

    def _usage_weight(self, player: Player) -> float:
        base = 0.35 + player.tendencies.usage / 100.0
        skill = 1.0 + normalize(player.ratings.finishing) * 0.15 + normalize(player.ratings.three_point) * 0.15
        fatigue = 0.7 + 0.3 * (player.condition / 100.0)
        return max(0.05, base * skill * fatigue)

    def _pick_zone(self, off: SideContext, deff: SideContext, shooter: Player) -> ShotZone:
        three_push = (
            slider_mod(off.tactics.three_point_emphasis) * 0.30
            + offensive_effect(off.tactics, "three_rate")
            + (shooter.tendencies.three_point_rate - 50.0) / 100.0 * 0.60
        )
        rim_push = (
            offensive_effect(off.tactics, "rim_rate")
            + (shooter.tendencies.rim_rate - 50.0) / 100.0 * 0.60
            + normalize(shooter.ratings.speed) * 0.15
        )
        # Good rim protection and heavy help push shots back out.
        rim_push -= defensive_effect(deff.tactics, "rim_pct") * -1.0
        rim_push -= slider_mod(deff.tactics.help_intensity) * 0.15
        three_push -= slider_mod(deff.tactics.close_out_hard) * 0.15

        weights: dict[ShotZone, float] = {}
        for zone, base in BASE_SHOT_MIX.items():
            weight = base
            if zone.is_three:
                weight *= 1.0 + three_push
            elif zone in (ShotZone.RIM, ShotZone.PAINT):
                weight *= 1.0 + rim_push
            else:
                weight *= 1.0 - three_push * 0.5 - rim_push * 0.3
            weights[zone] = max(0.01, weight)

        zones = list(weights.keys())
        return self.rng.weighted_choice(zones, [weights[z] for z in zones])

    def _pick_defender(self, deff: SideContext, zone: ShotZone) -> Player:
        if zone in (ShotZone.RIM, ShotZone.PAINT):
            weights = [0.3 + normalize(p.ratings.interior_defense) + normalize(p.ratings.block) * 0.5
                       for p in deff.lineup]
        else:
            weights = [0.3 + normalize(p.ratings.perimeter_defense) for p in deff.lineup]
        return self.rng.weighted_choice(deff.lineup.players, weights)

    def _make_probability(
        self,
        off: SideContext,
        deff: SideContext,
        shooter: Player,
        defender: Player,
        zone: ShotZone,
    ) -> float:
        shooter_attr = {
            ShotZone.RIM: shooter.ratings.finishing,
            ShotZone.PAINT: 0.5 * shooter.ratings.finishing + 0.5 * shooter.ratings.post_game,
            ShotZone.MID_RANGE: shooter.ratings.mid_range,
            ShotZone.CORNER_THREE: shooter.ratings.three_point,
            ShotZone.ABOVE_BREAK_THREE: shooter.ratings.three_point,
        }[zone]
        defender_attr = (
            defender.ratings.interior_defense
            if zone in (ShotZone.RIM, ShotZone.PAINT)
            else defender.ratings.perimeter_defense
        )
        # Team defence matters as much as the primary defender.
        team_defense = (
            deff.lineup.average("interior_defense")
            if zone in (ShotZone.RIM, ShotZone.PAINT)
            else deff.lineup.average("perimeter_defense")
        )
        effective_defense = 0.65 * defender_attr + 0.35 * team_defense

        pct = BASE_FG_PCT[zone]
        pct += advantage(shooter_attr, effective_defense) * SHOOTING_SENSITIVITY[zone]
        pct += off.chemistry.execution * CHEMISTRY_SHOT_QUALITY_SENSITIVITY
        pct += off.chemistry.spacing * 0.012
        pct -= self._fatigue(off.lineup) * FATIGUE_SHOOTING_PENALTY

        if zone.is_three:
            pct += defensive_effect(deff.tactics, "three_pct")
            pct -= slider_mod(deff.tactics.close_out_hard) * 0.020
        else:
            pct += defensive_effect(deff.tactics, "rim_pct")
            pct -= slider_mod(deff.tactics.help_intensity) * 0.018

        return self._bounded(pct, 0.05, 0.95)

    def _shot_phrase(self, zone: ShotZone) -> str:
        return {
            ShotZone.RIM: "a layup",
            ShotZone.PAINT: "a floater in the lane",
            ShotZone.MID_RANGE: "a jumper from mid-range",
            ShotZone.CORNER_THREE: "a three from the corner",
            ShotZone.ABOVE_BREAK_THREE: "a three from the top of the key",
        }[zone]

    def _record_shot(self, off: SideContext, shooter: Player, zone: ShotZone, made: bool) -> None:
        line = off.state.box.line(shooter.id, shooter.name)
        line.fga += 1
        if zone.is_three:
            line.tpa += 1
        if made:
            line.fgm += 1
            line.points += zone.points
            if zone.is_three:
                line.tpm += 1

    def _pick_assister(self, off: SideContext, shooter: Player, zone: ShotZone) -> Player | None:
        rate = BASE_ASSIST_RATE
        rate += offensive_effect(off.tactics, "assist_rate")
        rate += slider_mod(off.tactics.ball_movement) * 0.15
        rate += off.chemistry.execution * 0.10
        rate += 0.10 if zone.is_three else -0.05
        if not self.rng.chance(self._bounded(rate, 0.05, 0.95)):
            return None
        candidates = [p for p in off.lineup if p.id != shooter.id]
        weights = [0.2 + normalize(p.ratings.playmaking) + p.tendencies.pass_first / 200.0
                   for p in candidates]
        return self.rng.weighted_choice(candidates, weights)

    def _block_rate(self, off: SideContext, deff: SideContext, defender: Player, zone: ShotZone) -> float:
        rate = BASE_BLOCK_RATE * (1.6 if zone in (ShotZone.RIM, ShotZone.PAINT) else 0.5)
        rate += normalize(defender.ratings.block) * 0.045
        rate += defensive_effect(deff.tactics, "block_rate") * 0.5
        return self._bounded(rate, 0.0, 0.30)

    # ------------------------------------------------------------------
    # Shooting fouls and free throws
    # ------------------------------------------------------------------
    def _shooting_foul_rate(
        self, off: SideContext, deff: SideContext, shooter: Player, defender: Player, zone: ShotZone
    ) -> float:
        rate = BASE_SHOOTING_FOUL_RATE * (1.5 if zone in (ShotZone.RIM, ShotZone.PAINT) else 0.45)
        rate += normalize(shooter.ratings.drawing_fouls) * 0.045
        rate -= normalize(defender.ratings.discipline) * 0.025
        rate += defensive_effect(deff.tactics, "foul_rate") * 0.5
        rate -= slider_mod(deff.tactics.foul_discipline) * 0.025
        return self._bounded(rate, 0.005, 0.45)

    def _resolve_shooting_foul(
        self,
        game: GameState,
        off: SideContext,
        deff: SideContext,
        shooter: Player,
        defender: Player,
        zone: ShotZone,
        make_pct: float,
    ) -> None:
        self._charge_foul(game, deff, defender)
        # And-one: the shot still goes in some of the time.
        and_one = self.rng.chance(make_pct * 0.45)

        if and_one:
            self._record_shot(off, shooter, zone, made=True)
            self._emit(
                game, EventType.SHOT_MADE, off.state, shooter,
                f"{shooter.short_name} scores {zone.label} and draws the foul on {defender.short_name}",
                secondary=defender,
                detail={"zone": zone.value, "points": zone.points, "and_one": True},
            )
            self._shoot_free_throws(game, off, shooter, 1)
        else:
            self._emit(
                game, EventType.FOUL, deff.state, defender,
                f"Shooting foul on {defender.short_name} -- {shooter.short_name} to the line",
                secondary=shooter,
                detail={"kind": "shooting", "zone": zone.value},
            )
            self._shoot_free_throws(game, off, shooter, zone.points)

    def _shoot_free_throws(self, game: GameState, off: SideContext, shooter: Player, count: int) -> None:
        pct = BASE_FT_PCT + normalize(shooter.ratings.free_throw) * 0.16
        pct = self._bounded(pct, 0.30, 0.99)
        line = off.state.box.line(shooter.id, shooter.name)
        for i in range(count):
            line.fta += 1
            last = i == count - 1
            if self.rng.chance(pct):
                line.ftm += 1
                line.points += 1
                self._emit(
                    game, EventType.FREE_THROW_MADE, off.state, shooter,
                    f"{shooter.short_name} makes free throw {i + 1} of {count}",
                    detail={"attempt": i + 1, "of": count},
                )
            else:
                self._emit(
                    game, EventType.FREE_THROW_MISSED, off.state, shooter,
                    f"{shooter.short_name} misses free throw {i + 1} of {count}",
                    detail={"attempt": i + 1, "of": count},
                )
                if last:
                    self._rebound(game, off, self._context(game.opponent(off.state)))

    # ------------------------------------------------------------------
    # Rebounding
    # ------------------------------------------------------------------
    def _rebound(self, game: GameState, off: SideContext, deff: SideContext) -> None:
        rate = BASE_OFF_REBOUND_RATE
        rate += advantage(off.lineup.average("off_rebounding"), deff.lineup.average("def_rebounding")) * 0.11
        rate += slider_mod(off.tactics.offensive_rebounding) * 0.055
        rate += offensive_effect(off.tactics, "oreb_rate") * 0.5
        rate -= defensive_effect(deff.tactics, "dreb_rate") * 0.5
        offensive = self.rng.chance(self._bounded(rate, 0.05, 0.55))

        side = off if offensive else deff
        attribute = "off_rebounding" if offensive else "def_rebounding"
        rebounder = self.rng.weighted_choice(
            side.lineup.players,
            [0.25 + normalize(getattr(p.ratings, attribute)) + p.tendencies.crash_glass / 300.0
             for p in side.lineup],
        )
        line = side.state.box.line(rebounder.id, rebounder.name)
        if offensive:
            line.offensive_rebounds += 1
        else:
            line.defensive_rebounds += 1

        self._emit(
            game,
            EventType.REBOUND,
            side.state,
            rebounder,
            f"{rebounder.short_name} grabs the {'offensive' if offensive else 'defensive'} rebound",
            detail={"offensive": offensive},
        )

        if offensive and game.clock > 1.0:
            # Second-chance possession: short clock, usually a putback attempt.
            self._burn_clock(game, min(game.clock, self.rng.uniform(2.0, 7.0)))
            putback = self.rng.chance(0.55)
            self._resolve_shot_attempt(game, off, deff, putback=putback)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _fatigue(self, lineup: Lineup) -> float:
        """0.0 = fresh, 1.0 = fully gassed."""
        return 1.0 - (sum(p.condition for p in lineup) / 5.0) / 100.0

    @staticmethod
    def _bounded(value: float, low: float, high: float) -> float:
        return max(low, min(high, value))

    def _emit(
        self,
        game: GameState,
        event_type: EventType,
        team_state: TeamState | None,
        player: Player | None,
        description: str,
        secondary: Player | None = None,
        detail: dict | None = None,
    ) -> None:
        from .events import GameEvent  # local import keeps this module import-light

        game.sequence += 1
        game.events.append(
            GameEvent(
                sequence=game.sequence,
                period=game.period,
                clock=format_clock(game.clock),
                game_seconds=game.game_seconds,
                type=event_type,
                description=description,
                team_id=team_state.id if team_state else None,
                player_id=player.id if player else None,
                secondary_player_id=secondary.id if secondary else None,
                home_score=game.home.score,
                away_score=game.away.score,
                detail=detail or {},
            )
        )
