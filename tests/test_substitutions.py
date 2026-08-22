"""Substitutions happen at stoppages, not on every possession.

The bug this pins was visible the moment you watched a game: five men went
through the door on made baskets and fast breaks alike, because the loop
substituted after every change of possession. Basketball does not work that
way -- a coach can only sub when the ball is dead.

Two claims, and both would regress silently:

  * `TestSubsOnlyAtDeadBalls` -- a substitution must be preceded by a whistle
    (a foul, its free throws, a ball out of bounds) or a period break, never by
    a live-ball event like a made basket or a steal. The last two minutes are
    the one exception the real game makes, and the test allows it there.
  * `TestTheRotationDoesNotThrash` -- gating on dead balls is not enough on its
    own. There are forty-odd dead balls a game, and without a floor on a stint
    the rotation still churned a hundred subs a night, most of them a man going
    straight back out. A three-minute minimum turns that into the couple of
    dozen a real game has, and the minutes stay believable.

Run with:  python3 -m unittest tests.test_substitutions -v
"""

from __future__ import annotations

import copy
import statistics
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.engine.events import EventType
from bballsim.engine.game import GameSimulator
from bballsim.engine import rotation as R
from bballsim.roster import load_teams

# Live-ball events -- a substitution must never sit directly behind one of
# these outside the final two minutes.
LIVE_BALL = {EventType.SHOT_MADE, EventType.STEAL, EventType.REBOUND,
             EventType.ASSIST, EventType.BLOCK}

# The whistle events a sub is allowed to follow.
DEAD_BALL = {EventType.FOUL, EventType.TURNOVER, EventType.FREE_THROW_MADE,
             EventType.FREE_THROW_MISSED, EventType.PERIOD_START,
             EventType.PERIOD_END, EventType.TIMEOUT, EventType.JUMP_BALL}

_GAMES: list = []


def games(count: int = 10) -> list:
    """A handful of full games, each on its own copy of two clubs."""
    if _GAMES:
        return _GAMES
    teams = load_teams().teams
    for i in range(count):
        home = copy.deepcopy(teams[i])
        away = copy.deepcopy(teams[(i + 7) % len(teams)])
        _GAMES.append(
            GameSimulator(f"g{i}", home=home, away=away, seed=f"seed{i}").simulate())
    return _GAMES


def _preceding_non_sub(events, index):
    k = index - 1
    while k >= 0 and events[k].type == EventType.SUBSTITUTION:
        k -= 1
    return events[k] if k >= 0 else None


def _is_endgame(event, periods=4, period_seconds=720) -> bool:
    return (event.period >= periods
            and event.game_seconds >= periods * period_seconds - 120)


class TestSubsOnlyAtDeadBalls(unittest.TestCase):
    def test_no_sub_follows_a_live_ball_event(self):
        offenders = 0
        total = 0
        for result in games():
            events = result.events
            for i, event in enumerate(events):
                if event.type != EventType.SUBSTITUTION:
                    continue
                total += 1
                prev = _preceding_non_sub(events, i)
                if prev is None or _is_endgame(prev):
                    continue
                if prev.type in LIVE_BALL:
                    offenders += 1
        self.assertGreater(total, 0)
        self.assertEqual(offenders, 0,
                         f"{offenders} of {total} subs followed live play")

    def test_a_made_basket_in_open_play_does_not_trigger_a_sub(self):
        """The exact thing the reporter saw. Outside the last two minutes, the
        event straight after a clean made basket is never a substitution."""
        for result in games():
            events = result.events
            for i, event in enumerate(events[:-1]):
                if (event.type == EventType.SHOT_MADE
                        and not event.detail.get("and_one")
                        and not _is_endgame(event)):
                    self.assertNotEqual(events[i + 1].type, EventType.SUBSTITUTION,
                                        event.description)


class TestTheRotationDoesNotThrash(unittest.TestCase):
    def test_a_realistic_number_of_subs(self):
        counts = [sum(1 for e in r.events if e.type == EventType.SUBSTITUTION)
                  for r in games()]
        mean = statistics.mean(counts)
        # A real game runs 40-55 substitutions across both benches. Before the
        # minimum stint this sat over a hundred.
        self.assertGreater(mean, 30, f"too few subs ({mean:.0f}) -- rotation frozen")
        self.assertLess(mean, 75, f"too many subs ({mean:.0f}) -- rotation thrashing")

    def test_nobody_is_pulled_inside_the_minimum_stint(self):
        """A man who checks in is not pulled again for MIN_STINT_SECONDS -- the
        only exception is a foul-out, which this run is unlikely to hit but the
        assertion tolerates by checking fouls."""
        for result in games():
            box = {l.player_id: l for l in
                   list(result.home_box.players.values())
                   + list(result.away_box.players.values())}
            in_at: dict[str, float] = {}
            for event in result.events:
                if event.type != EventType.SUBSTITUTION:
                    continue
                pin, pout = event.player_id, event.secondary_player_id
                if pout in in_at:
                    stint = event.game_seconds - in_at[pout]
                    fouled_out = box[pout].fouls >= 6 if pout in box else False
                    if not fouled_out:
                        self.assertGreaterEqual(
                            stint, R.MIN_STINT_SECONDS - 1.0,
                            f"{pout} pulled after {stint:.0f}s")
                in_at[pin] = event.game_seconds

    def test_the_minutes_stay_believable(self):
        tops, rotation_sizes = [], []
        for result in games():
            for box in (result.home_box, result.away_box):
                mins = sorted((l.seconds / 60.0 for l in box.players.values()),
                              reverse=True)
                tops.append(mins[0])
                rotation_sizes.append(sum(1 for m in mins if m >= 8))
        self.assertLess(max(tops), 44, "someone played the whole game")
        self.assertGreater(statistics.mean(tops), 30, "the stars sat too much")
        self.assertGreater(statistics.mean(rotation_sizes), 7,
                           "the bench never played")


class TestForcedSubsStillHappen(unittest.TestCase):
    def test_a_fouled_out_player_comes_off_regardless_of_stint(self):
        """The minimum stint is for tired pulls. Six fouls comes off at once --
        constructed directly on the rotation rather than hoping a game produces
        a foul-out inside a stint."""
        from bballsim.engine.rotation import RotationManager
        from bballsim.engine.state import TeamState
        from bballsim.engine.game import GameSimulator
        from bballsim.models import Lineup

        teams = load_teams().teams
        team = copy.deepcopy(teams[0])
        sim = GameSimulator("f", home=team, away=copy.deepcopy(teams[1]), seed="f")
        state = sim._initial_state()
        home = state.home
        rot = RotationManager()

        # Everyone just checked in, so no tired pull is legal.
        starter = home.on_court.players[0]
        for player in team.players:
            rot._changed_at[player.id] = 100.0
        # Foul the starter out.
        home.box.line(starter.id, starter.name).fouls = 6

        swaps = rot.evaluate(home, period=2, final_period=4, clock=300.0, now=120.0)
        out = [pout.id for pout, _pin in swaps]
        self.assertIn(starter.id, out,
                      "a fouled-out starter was left on by the minimum stint")
