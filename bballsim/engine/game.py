"""Full game simulation: runs possessions until somebody wins."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..health import starting_condition
from ..models import Lineup, Team
from ..ratings import normalize
from .boxscore import TeamBox
from .events import EventType, GameEvent, format_clock
from .possession import PossessionEngine
from .rng import SimRandom
from .rotation import RotationManager
from .state import GameRules, GameState, TeamState

MAX_OVERTIMES = 6


@dataclass
class GameResult:
    game_id: str
    seed: int
    home_team_id: str
    away_team_id: str
    home_score: int
    away_score: int
    periods_played: int
    events: list[GameEvent]
    home_box: TeamBox
    away_box: TeamBox
    duration_game_seconds: float = 0.0
    # Shared floor time per pair, in minutes -- feeds chemistry drift.
    home_pair_minutes: dict = field(default_factory=dict)
    away_pair_minutes: dict = field(default_factory=dict)

    @property
    def winner_id(self) -> str:
        return self.home_team_id if self.home_score >= self.away_score else self.away_team_id

    def to_dict(self, include_events: bool = False) -> dict:
        data = {
            "game_id": self.game_id,
            "seed": self.seed,
            "home_team_id": self.home_team_id,
            "away_team_id": self.away_team_id,
            "home_score": self.home_score,
            "away_score": self.away_score,
            "winner_id": self.winner_id,
            "periods_played": self.periods_played,
            "duration_game_seconds": round(self.duration_game_seconds, 1),
            "home_box": self.home_box.to_dict(),
            "away_box": self.away_box.to_dict(),
        }
        if include_events:
            data["events"] = [e.to_dict() for e in self.events]
        return data


class GameSimulator:
    """Simulates one game from tip-off to final buzzer.

    The whole game is simulated in one pass and the resulting event list is
    timestamped with `game_seconds`. The tracker then reveals events against a
    wall clock, which is why "watching live" and "watching a replay" are the
    same code path.
    """

    def __init__(
        self,
        game_id: str,
        home: Team,
        away: Team,
        rules: GameRules | None = None,
        seed: int | str | None = None,
        rotation_depth: int | None = None,
    ) -> None:
        self.game_id = game_id
        self.home = home
        self.away = away
        self.rules = rules or GameRules()
        self.rng = SimRandom(seed if seed is not None else game_id)
        self.possessions = PossessionEngine(self.rng)
        self.rotations = (RotationManager(rotation_depth)
                          if rotation_depth else RotationManager())

    # ------------------------------------------------------------------
    def simulate(self) -> GameResult:
        state = self._initial_state()
        # Tonight's form, rolled once per player from the hidden consistency
        # attribute. Everything downstream reads ratings through it.
        self.possessions.set_form(self.home.players + self.away.players)
        self._emit(state, EventType.GAME_START,
                   f"{self.away.full_name} at {self.home.full_name} -- tip-off")

        offense = self._jump_ball(state)

        period = 1
        while True:
            state.period = period
            state.clock = (
                self.rules.period_seconds if period <= self.rules.periods
                else self.rules.overtime_seconds
            )
            state.home.fouls_this_period = 0
            state.away.fouls_this_period = 0
            self._emit(state, EventType.PERIOD_START, f"Start of {state.period_label()}")

            offense = self._play_period(state, offense)

            state.home.box.points_by_period.append(
                state.home.score - sum(state.home.box.points_by_period)
            )
            state.away.box.points_by_period.append(
                state.away.score - sum(state.away.box.points_by_period)
            )
            self._emit(
                state, EventType.PERIOD_END,
                f"End of {state.period_label()} -- "
                f"{self.away.abbreviation} {state.away.score}, {self.home.abbreviation} {state.home.score}",
            )
            self._between_periods(state)

            if period >= self.rules.periods and state.home.score != state.away.score:
                break
            if period >= self.rules.periods + MAX_OVERTIMES:
                break
            period += 1

        state.finished = True
        self._emit(
            state, EventType.GAME_END,
            f"Final: {self.away.abbreviation} {state.away.score}, "
            f"{self.home.abbreviation} {state.home.score}",
        )

        return GameResult(
            game_id=self.game_id,
            seed=self.rng.seed,
            home_team_id=self.home.id,
            away_team_id=self.away.id,
            home_score=state.home.score,
            away_score=state.away.score,
            periods_played=state.period,
            events=state.events,
            home_box=state.home.box,
            away_box=state.away.box,
            duration_game_seconds=state.game_seconds,
            home_pair_minutes={k: v / 60.0 for k, v in state.home.pair_seconds.items()},
            away_pair_minutes={k: v / 60.0 for k, v in state.away.pair_seconds.items()},
        )

    # ------------------------------------------------------------------
    def _initial_state(self) -> GameState:
        home_state = self._team_state(self.home)
        away_state = self._team_state(self.away)
        return GameState(rules=self.rules, home=home_state, away=away_state, clock=self.rules.period_seconds)

    def _team_state(self, team: Team) -> TeamState:
        for player in team.players:
            # Not 100 for everybody: a man carrying a season's fatigue starts
            # the night already down. This is the only place season-level
            # health enters a game -- everything after it reads `condition`.
            player.condition = starting_condition(player)
        starters = team.starters()
        if len(starters) < 5:
            raise ValueError(f"{team.full_name} needs at least 5 healthy players, has {len(starters)}")
        box = TeamBox(team_id=team.id, name=team.full_name, timeouts_remaining=self.rules.timeouts_per_team)
        for player in team.players:
            box.line(player.id, player.name)
        return TeamState(
            team=team,
            box=box,
            on_court=Lineup(starters),
            timeouts_remaining=self.rules.timeouts_per_team,
        )

    def _jump_ball(self, state: GameState) -> TeamState:
        def tip_skill(player):
            return player.height_inches + player.ratings.vertical_leap * 0.06 + player.ratings.strength * 0.06

        home_jumper = max(state.home.on_court, key=tip_skill)
        away_jumper = max(state.away.on_court, key=tip_skill)
        home_edge = 0.5 + (
            (home_jumper.height_inches - away_jumper.height_inches) * 0.02
            + (normalize(home_jumper.ratings.strength) - normalize(away_jumper.ratings.strength)) * 0.15
        )
        winner = state.home if self.rng.chance(max(0.15, min(0.85, home_edge))) else state.away
        jumper = home_jumper if winner is state.home else away_jumper
        self._emit(
            state, EventType.JUMP_BALL,
            f"{jumper.short_name} wins the tip for {winner.team.abbreviation}",
            team_state=winner, player_id=jumper.id,
        )
        return winner

    def _play_period(self, state: GameState, offense: TeamState) -> TeamState:
        # Coming out of the break is a substitution opportunity, and a common
        # one -- a coach sets his lineup for the quarter before the ball is
        # even in play.
        self._maybe_substitute(state)
        while state.clock > 0:
            defense = state.opponent(offense)
            self.possessions.play(state, offense, defense)

            # Possession changes hands unless the offence kept it on the glass;
            # the possession engine already resolved any second-chance shots.
            offense = defense

            # Substitutions are only legal when the ball is dead, and the truest
            # signal of that is how the possession just *ended* -- read off the
            # last line of the play-by-play. A possession that finishes on a
            # whistle (a foul, its free throws, a ball knocked out of bounds)
            # is a dead ball; one that finishes on a made basket, a steal or a
            # live rebound is not, and no bench moves behind it. This is what
            # stopped the flood of subs on made baskets and fast breaks. The
            # last two minutes are the exception the real game makes -- a made
            # basket stops the clock there, and between that and the fouls and
            # timeouts the bench is effectively free to move every trip.
            endgame = (state.period >= self.rules.periods and state.clock <= 120)
            if endgame or self._ended_dead(state):
                self._maybe_substitute(state)
        return offense

    # A possession that ends on one of these left the ball dead -- the whistle
    # blew or the ball went out of bounds. Anything else (a made basket, a
    # steal, a live rebound and the break the other way) is live play, and no
    # substitution may happen behind it.
    _DEAD_BALL_END = frozenset({
        EventType.FOUL, EventType.TURNOVER,
        EventType.FREE_THROW_MADE, EventType.FREE_THROW_MISSED,
        EventType.TIMEOUT,
    })

    def _ended_dead(self, state: GameState) -> bool:
        """Did the possession just played end at a stoppage? Read from the last
        event, so a foul that flows into a live shot -- the same possession
        continuing -- is judged by the shot, not the foul."""
        for event in reversed(state.events):
            if event.type == EventType.SUBSTITUTION:
                continue
            return event.type in self._DEAD_BALL_END
        return False

    def _maybe_substitute(self, state: GameState) -> None:
        for team_state in (state.home, state.away):
            swaps = self.rotations.evaluate(
                team_state, state.period, self.rules.periods, state.clock,
                now=state.game_seconds,
            )
            if not swaps:
                continue
            self.rotations.apply(team_state, swaps)
            for player_out, player_in in swaps:
                self._emit(
                    state, EventType.SUBSTITUTION,
                    f"{team_state.team.abbreviation}: {player_in.short_name} in for {player_out.short_name}",
                    team_state=team_state, player_id=player_in.id, secondary_id=player_out.id,
                )

    def _between_periods(self, state: GameState) -> None:
        rest_seconds = 130.0
        for team_state in (state.home, state.away):
            self.rotations.rest_bench(team_state, rest_seconds)
            for player in team_state.on_court:
                player.condition = min(100.0, player.condition + rest_seconds * 0.02)

    # ------------------------------------------------------------------
    def _emit(
        self,
        state: GameState,
        event_type: EventType,
        description: str,
        team_state: TeamState | None = None,
        player_id: str | None = None,
        secondary_id: str | None = None,
    ) -> None:
        state.sequence += 1
        state.events.append(
            GameEvent(
                sequence=state.sequence,
                period=state.period,
                clock=format_clock(state.clock),
                game_seconds=state.game_seconds,
                type=event_type,
                description=description,
                team_id=team_state.id if team_state else None,
                player_id=player_id,
                secondary_player_id=secondary_id,
                home_score=state.home.score,
                away_score=state.away.score,
            )
        )
