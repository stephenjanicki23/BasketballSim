"""Possession resolution -- the core of the simulation.

One call to `PossessionEngine.play` advances the game by exactly one
possession: it burns clock, decides whether the ball is turned over, picks a
shooter and a shot, resolves it, handles fouls and free throws, and rebounds
the miss. Every branch emits play-by-play events.

The engine never touches a raw attribute. Every skill it reads comes from
`bballsim/composites.py`, which blends the 81 visible attributes into the ~25
numbers basketball actually turns on. Tuning therefore happens in two places
and only two: the baselines below, and the blends in `composites.py`.

The general shape of every probability:

    probability = league_baseline
                  + composite_advantage * sensitivity
                  + tactical_modifiers
                  + chemistry / fatigue / clutch / situational modifiers
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import composites as C
from ..chemistry import ChemistryProfile
from ..chemistry import evaluate as evaluate_chemistry
from ..models import Lineup, Player
from ..ratings import SCALE_MAX, advantage, fraction, normalize
from ..tactics import defensive_effect, offensive_effect, slider_mod
from .events import EventType, ShotZone, format_clock
from .rng import SimRandom
from .state import GameState, TeamState

# --------------------------------------------------------------------------
# League baselines: what a perfectly average team produces against a perfectly
# average defence with neutral tactics.
# --------------------------------------------------------------------------

BASE_POSSESSION_SECONDS = 14.2
POSSESSION_SECONDS_SPREAD = 5.5
MIN_POSSESSION_SECONDS = 2.5

BASE_TURNOVER_RATE = 0.132
BASE_STEAL_SHARE = 0.60          # share of turnovers that are steals

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

# Which defensive composite guards which zone.
INTERIOR_ZONES = (ShotZone.RIM, ShotZone.PAINT)

BASE_ASSIST_RATE = 0.60          # share of made field goals that are assisted
BASE_OFF_REBOUND_RATE = 0.268
BASE_BLOCK_RATE = 0.058          # of two-point attempts
BASE_SHOOTING_FOUL_RATE = 0.105
BASE_NON_SHOOTING_FOUL_RATE = 0.120
BASE_FT_PCT = 0.737

CHEMISTRY_TURNOVER_SENSITIVITY = 0.045
CHEMISTRY_SHOT_QUALITY_SENSITIVITY = 0.030
FATIGUE_SHOOTING_PENALTY = 0.070   # at fully gassed
FATIGUE_TURNOVER_PENALTY = 0.030
FATIGUE_SECONDS_PER_POINT = 16.0   # floor time costing average stamina one point

# Shot selection: a player with poor judgement drifts toward shots he cannot
# make. This scales how much `shot_quality` pulls the mix toward his strengths.
SHOT_SELECTION_WEIGHT = 0.35

# Clutch only applies inside the last two minutes of a one-possession game.
CLUTCH_SECONDS = 120.0
CLUTCH_MARGIN = 6
CLUTCH_SHOOTING_SWING = 0.055
CLUTCH_TURNOVER_SWING = 0.035

# Consistency (hidden) sets how far a player's night drifts from his rating.
# Expressed as a share of the scale so it survives a scale change: 0.09 of
# 1-20 is a swing of about 1.8 points, roughly one tier on a bad night.
# Drawn once per game in `PossessionEngine.set_form`.
MAX_FORM_SWING = 0.09 * SCALE_MAX


@dataclass
class SideContext:
    """Everything the engine needs about one team for one possession."""

    state: TeamState
    lineup: Lineup
    chemistry: ChemistryProfile

    @property
    def tactics(self):
        return self.state.team.tactics


class PossessionEngine:
    def __init__(self, rng: SimRandom) -> None:
        self.rng = rng
        # player id -> tonight's form modifier, in rating points.
        self.form: dict[str, float] = {}

    # ------------------------------------------------------------------
    # Nightly form
    # ------------------------------------------------------------------
    def set_form(self, players: list[Player]) -> None:
        """Roll each player's form for this game.

        A high-consistency player performs near his rating every night; a low
        one is a coin flip. This is the hidden `consistency` attribute's only
        job, and it is why two identical rosters do not play identical games.
        """
        for player in players:
            spread = MAX_FORM_SWING * (1.0 - normalize(player.hidden.consistency) * 0.7)
            self.form[player.id] = self.rng.gauss(0.0, max(0.2, spread))

    def _skill(self, player: Player, composite) -> float:
        """A composite, adjusted for tonight's form."""
        return composite(player) + self.form.get(player.id, 0.0)

    def _lineup_skill(self, lineup: Lineup, composite) -> float:
        return sum(self._skill(p, composite) for p in lineup) / 5.0

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

        if self._is_turnover(game, off, deff):
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
        # Guards who push tempo shorten possessions on their own.
        pace += normalize(self._lineup_skill(off.lineup, C.transition_threat)) * 0.08
        pressure = slider_mod(deff.tactics.defensive_pressure) * 0.08
        seconds = BASE_POSSESSION_SECONDS * (1.0 - pace + pressure)
        seconds += self.rng.gauss(0.0, POSSESSION_SECONDS_SPREAD)

        seconds = self._apply_endgame_urgency(game, off, seconds)
        return max(MIN_POSSESSION_SECONDS, min(game.rules.shot_clock, seconds))

    def _apply_endgame_urgency(self, game: GameState, off: SideContext, seconds: float) -> float:
        last_period = game.period >= game.rules.periods
        if not last_period or game.clock > 120:
            return seconds
        margin = self._margin_for(game, off)
        if margin < 0:                      # trailing: hurry
            return seconds * 0.55
        if margin > 0 and game.clock < 60:  # leading: bleed the clock
            return min(game.rules.shot_clock, seconds * 1.6)
        return seconds

    def _margin_for(self, game: GameState, side: SideContext) -> int:
        margin = game.home.score - game.away.score
        return -margin if side.state is game.away else margin

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
            stamina = C.endurance(player)
            drain = seconds * (1.0 - normalize(stamina) * 0.5) / FATIGUE_SECONDS_PER_POINT
            player.condition = max(0.0, player.condition - drain)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = frozenset((ids[i], ids[j]))
                team_state.pair_seconds[key] = team_state.pair_seconds.get(key, 0.0) + seconds

    # ------------------------------------------------------------------
    # Clutch
    # ------------------------------------------------------------------
    def _is_clutch(self, game: GameState) -> bool:
        return (
            game.period >= game.rules.periods
            and game.clock <= CLUTCH_SECONDS
            and abs(game.home.score - game.away.score) <= CLUTCH_MARGIN
        )

    def _clutch_edge(self, game: GameState, player: Player) -> float:
        """Normalized crunch-time edge, or 0 outside crunch time.

        Blends the visible clutch composite with the hidden
        `big_game_performance` -- which is exactly the sort of thing a manager
        only learns by watching a player in April.
        """
        if not self._is_clutch(game):
            return 0.0
        return normalize(0.7 * C.clutch(player) + 0.3 * player.hidden.big_game_performance)

    # ------------------------------------------------------------------
    # Turnovers
    # ------------------------------------------------------------------
    def _is_turnover(self, game: GameState, off: SideContext, deff: SideContext) -> bool:
        security = self._lineup_skill(off.lineup, C.ball_security)
        pressure_skill = self._lineup_skill(deff.lineup, C.steal_threat)

        rate = BASE_TURNOVER_RATE
        rate -= advantage(security, pressure_skill) * 0.055
        rate += offensive_effect(off.tactics, "turnover_rate") * 0.5
        rate += defensive_effect(deff.tactics, "steal_rate") * 0.5
        rate += slider_mod(deff.tactics.defensive_pressure) * 0.030
        rate += slider_mod(off.tactics.ball_movement) * 0.012
        rate -= off.chemistry.execution * CHEMISTRY_TURNOVER_SENSITIVITY
        rate += self._fatigue(off.lineup) * FATIGUE_TURNOVER_PENALTY

        if self._is_clutch(game):
            handler = max(off.lineup, key=lambda p: p.tendencies.usage)
            rate -= self._clutch_edge(game, handler) * CLUTCH_TURNOVER_SWING

        return self.rng.chance(self._bounded(rate, 0.02, 0.35))

    def _resolve_turnover(self, game: GameState, off: SideContext, deff: SideContext) -> None:
        loser = self.rng.weighted_choice(
            off.lineup.players,
            [self._usage_weight(p) * (1.4 - normalize(self._skill(p, C.ball_security)))
             for p in off.lineup],
        )
        stealer = None
        if self.rng.chance(BASE_STEAL_SHARE + defensive_effect(deff.tactics, "steal_rate")):
            stealer = self.rng.weighted_choice(
                deff.lineup.players,
                [0.5 + normalize(self._skill(p, C.steal_threat)) for p in deff.lineup],
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
        rate -= normalize(self._lineup_skill(deff.lineup, C.foul_avoidance)) * 0.020
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
            [max(0.15, 1.0 - normalize(self._skill(p, C.foul_avoidance))) for p in deff.lineup],
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
        shooter = self._pick_shooter(game, off, putback)
        zone = ShotZone.RIM if putback else self._pick_zone(off, deff, shooter)

        defender = self._pick_defender(deff, zone)
        make_pct = self._make_probability(game, off, deff, shooter, defender, zone)

        if self.rng.chance(self._shooting_foul_rate(off, deff, shooter, defender, zone)):
            self._resolve_shooting_foul(game, off, deff, shooter, defender, zone, make_pct)
            return

        if not zone.is_three and self.rng.chance(self._block_rate(deff, defender, zone)):
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

    def _pick_shooter(self, game: GameState, off: SideContext, putback: bool) -> Player:
        if putback:
            weights = [
                0.4 + normalize(self._skill(p, C.offensive_rebounding))
                + normalize(self._skill(p, C.shooting_rim)) * 0.5
                for p in off.lineup
            ]
        else:
            weights = [self._usage_weight(p) for p in off.lineup]
            if self._is_clutch(game):
                # Late in a close game the ball finds whoever handles it best.
                weights = [
                    w * (1.0 + max(0.0, self._clutch_edge(game, p)) * 1.2)
                    for w, p in zip(weights, off.lineup)
                ]
        return self.rng.weighted_choice(off.lineup.players, weights)

    def _usage_weight(self, player: Player) -> float:
        base = 0.35 + fraction(player.tendencies.usage)
        # Creators and finishers command more of the offence than their raw
        # tendency alone suggests.
        skill = 1.0 + normalize(C.shot_creation(player)) * 0.20
        fatigue = 0.7 + 0.3 * (player.condition / 100.0)
        return max(0.05, base * skill * fatigue)

    def _pick_zone(self, off: SideContext, deff: SideContext, shooter: Player) -> ShotZone:
        three_push = (
            slider_mod(off.tactics.three_point_emphasis) * 0.30
            + offensive_effect(off.tactics, "three_rate")
            + normalize(shooter.tendencies.three_point_rate) * 0.30
        )
        rim_push = (
            offensive_effect(off.tactics, "rim_rate")
            + normalize(shooter.tendencies.rim_rate) * 0.30
            + normalize(shooter.ratings.acceleration) * 0.15
        )
        post_push = normalize(shooter.tendencies.post_up_rate) * 0.25

        rim_push -= defensive_effect(deff.tactics, "rim_pct") * -1.0
        rim_push -= slider_mod(deff.tactics.help_intensity) * 0.15
        rim_push -= normalize(self._lineup_skill(deff.lineup, C.help_defense)) * 0.12
        three_push -= slider_mod(deff.tactics.close_out_hard) * 0.15

        weights: dict[ShotZone, float] = {}
        for zone, base in BASE_SHOT_MIX.items():
            weight = base
            if zone.is_three:
                weight *= 1.0 + three_push
            elif zone is ShotZone.RIM:
                weight *= 1.0 + rim_push
            elif zone is ShotZone.PAINT:
                weight *= 1.0 + rim_push * 0.4 + post_push
            else:
                weight *= 1.0 - three_push * 0.5 - rim_push * 0.3
            weights[zone] = max(0.01, weight)

        # Shot selection: good judgement shifts attempts toward the zones this
        # shooter is actually good at; poor judgement leaves the mix alone.
        judgement = normalize(self._skill(shooter, C.shot_quality))
        if judgement != 0.0:
            for zone in weights:
                edge = normalize(self._skill(shooter, C.SHOOTING_BY_ZONE[zone.value]))
                weights[zone] = max(0.01, weights[zone] * (1.0 + judgement * edge * SHOT_SELECTION_WEIGHT))

        zones = list(weights.keys())
        return self.rng.weighted_choice(zones, [weights[z] for z in zones])

    def _pick_defender(self, deff: SideContext, zone: ShotZone) -> Player:
        composite = C.interior_defense if zone in INTERIOR_ZONES else C.perimeter_defense
        weights = [0.3 + normalize(self._skill(p, composite)) for p in deff.lineup]
        return self.rng.weighted_choice(deff.lineup.players, weights)

    def _make_probability(
        self,
        game: GameState,
        off: SideContext,
        deff: SideContext,
        shooter: Player,
        defender: Player,
        zone: ShotZone,
    ) -> float:
        shooter_skill = self._skill(shooter, C.SHOOTING_BY_ZONE[zone.value])
        defense_composite = C.interior_defense if zone in INTERIOR_ZONES else C.perimeter_defense

        # The primary defender matters most, but team defence behind him and
        # the quality of the contest both move the number.
        effective_defense = (
            0.55 * self._skill(defender, defense_composite)
            + 0.25 * self._lineup_skill(deff.lineup, defense_composite)
            + 0.20 * self._skill(defender, C.contest_quality)
        )

        pct = BASE_FG_PCT[zone]
        pct += advantage(shooter_skill, effective_defense) * SHOOTING_SENSITIVITY[zone]
        pct += off.chemistry.execution * CHEMISTRY_SHOT_QUALITY_SENSITIVITY
        pct += off.chemistry.spacing * 0.012
        pct -= self._fatigue(off.lineup) * FATIGUE_SHOOTING_PENALTY
        pct += self._clutch_edge(game, shooter) * CLUTCH_SHOOTING_SWING

        if zone.is_three:
            pct += defensive_effect(deff.tactics, "three_pct")
            pct -= slider_mod(deff.tactics.close_out_hard) * 0.020
        else:
            pct += defensive_effect(deff.tactics, "rim_pct")
            pct -= slider_mod(deff.tactics.help_intensity) * 0.018
            pct -= normalize(self._lineup_skill(deff.lineup, C.help_defense)) * 0.020

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
        # Off-ball movement earns the pass as much as the passer does.
        rate += normalize(self._skill(shooter, C.off_ball_gravity)) * 0.06
        if not self.rng.chance(self._bounded(rate, 0.05, 0.95)):
            return None
        candidates = [p for p in off.lineup if p.id != shooter.id]
        weights = [
            0.2 + normalize(self._skill(p, C.playmaking)) + fraction(p.tendencies.pass_first) * 0.5
            for p in candidates
        ]
        return self.rng.weighted_choice(candidates, weights)

    def _block_rate(self, deff: SideContext, defender: Player, zone: ShotZone) -> float:
        rate = BASE_BLOCK_RATE * (1.6 if zone in INTERIOR_ZONES else 0.5)
        rate += normalize(self._skill(defender, C.block_threat)) * 0.045
        rate += defensive_effect(deff.tactics, "block_rate") * 0.5
        return self._bounded(rate, 0.0, 0.30)

    # ------------------------------------------------------------------
    # Shooting fouls and free throws
    # ------------------------------------------------------------------
    def _shooting_foul_rate(
        self, off: SideContext, deff: SideContext, shooter: Player, defender: Player, zone: ShotZone
    ) -> float:
        rate = BASE_SHOOTING_FOUL_RATE * (1.5 if zone in INTERIOR_ZONES else 0.45)
        rate += normalize(self._skill(shooter, C.foul_drawing)) * 0.045
        rate -= normalize(self._skill(defender, C.foul_avoidance)) * 0.030
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
        pct = BASE_FT_PCT + normalize(self._skill(shooter, C.free_throw)) * 0.16
        pct += self._clutch_edge(game, shooter) * 0.03
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
        rate += advantage(
            self._lineup_skill(off.lineup, C.offensive_rebounding),
            self._lineup_skill(deff.lineup, C.defensive_rebounding),
        ) * 0.11
        rate += slider_mod(off.tactics.offensive_rebounding) * 0.055
        rate += offensive_effect(off.tactics, "oreb_rate") * 0.5
        rate -= defensive_effect(deff.tactics, "dreb_rate") * 0.5
        offensive = self.rng.chance(self._bounded(rate, 0.05, 0.55))

        side = off if offensive else deff
        composite = C.offensive_rebounding if offensive else C.defensive_rebounding
        rebounder = self.rng.weighted_choice(
            side.lineup.players,
            [0.25 + normalize(self._skill(p, composite)) + fraction(p.tendencies.crash_glass) / 3.0
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
