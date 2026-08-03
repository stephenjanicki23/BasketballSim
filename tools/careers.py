#!/usr/bin/env python3
"""Run a career from 18 to retirement and print it.

    python3 tools/careers.py                # the three example careers
    python3 tools/careers.py --attributes   # ...with the attribute drift shown

The three prospects are built to the same brief -- same age, same draft-night
hype -- and differ only in the things the progression engine cares about:
what their game is built on, and what they are like. Everything printed is
produced by `bballsim/progression.py`; nothing here is written by hand.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim.ability import Ability, Archetype, generate_ratings  # noqa: E402
from bballsim.biography import Biography  # noqa: E402
from bballsim.models import Player, Position  # noqa: E402
from bballsim.progression import (  # noqa: E402
    ATHLETIC, CHARACTER, EXPERIENTIAL, TECHNICAL, build_profile,
    default_minutes, develop_season,
)
from bballsim.ratings import HiddenAttributes, Tendencies  # noqa: E402


def prospect(name: str, position: str, archetype: Archetype, ca: float, pa: float,
             character: dict[str, float], hidden_traits: dict[str, float],
             seed: str) -> Player:
    """An 18-year-old built to order.

    CA and PA are given rather than drawn: these three exist to show what the
    engine does with a fixed starting point, so the starting point has to be
    fixed.
    """
    rng = random.Random(abs(hash(seed)) % (2**31))
    ratings = generate_ratings(rng, ca, position, archetype, 18)
    for key, value in character.items():
        setattr(ratings, key, value)
    hidden = HiddenAttributes(**hidden_traits)
    first, last = name.split(" ", 1)
    return Player(
        id=seed, first_name=first, last_name=last,
        position=Position(position), age=18,
        ratings=ratings, tendencies=Tendencies(), hidden=hidden,
        ability=Ability(current=ca, potential=pa), archetype=archetype,
        bio=Biography(),
    )


# Three players, one brief: 18 years old, a near-identical ceiling, and
# "can't-miss" written on all three. They differ only in character and in what
# their game is built on -- which is the whole experiment.
#
#   Dante -- a slasher with professionalism 6. The talent is not the question.
#   Marcus -- a three-and-D guard with professionalism 19 and the work to match.
#   Elias -- a raw big, lower ceiling, but coachable and relentless.
#
# The career arc each one is assigned is *drawn*, not set here: `pick_arc`
# weights it from their attributes, so the label above each career is an
# outcome of the engine rather than a casting decision.
EXAMPLES = [
    dict(
        name="Dante Rowe", position="SG", archetype=Archetype.SLASHER,
        ca=95.0, pa=185.0, seed="example-dante",
        character={"work_rate": 7.0, "coachability": 6.0, "competitive_drive": 11.0,
                   "confidence": 16.0, "composure": 8.0},
        hidden_traits={"professionalism": 6.0, "development_rate": 9.0,
                       "ambition": 12.0, "injury_proneness": 8.0, "consistency": 9.0},
    ),
    dict(
        name="Marcus Vela", position="SG", archetype=Archetype.THREE_AND_D_GUARD,
        ca=95.0, pa=185.0, seed="example-marcus",
        character={"work_rate": 19.0, "coachability": 18.0, "competitive_drive": 17.0,
                   "confidence": 14.0, "composure": 16.0},
        hidden_traits={"professionalism": 19.0, "development_rate": 17.0,
                       "ambition": 17.0, "injury_proneness": 15.0, "consistency": 16.0},
    ),
    dict(
        name="Elias Turnbull", position="C", archetype=Archetype.RIM_RUNNER,
        ca=88.0, pa=178.0, seed="example-elias",
        character={"work_rate": 17.0, "coachability": 19.0, "competitive_drive": 15.0,
                   "confidence": 9.0, "composure": 11.0},
        hidden_traits={"professionalism": 15.0, "development_rate": 14.0,
                       "ambition": 13.0, "injury_proneness": 11.0, "consistency": 12.0},
    ),
]


def group_mean(player, keys) -> float:
    return sum(getattr(player.ratings, k) for k in keys) / len(keys)


def run(spec: dict, coach: float, show_attributes: bool) -> None:
    player = prospect(**spec)
    profile = build_profile(player, seed=spec["seed"])
    start = dict(
        athletic=group_mean(player, ATHLETIC),
        technical=group_mean(player, TECHNICAL),
        experiential=group_mean(player, EXPERIENTIAL),
        character=group_mean(player, CHARACTER),
    )

    print(f"\n{'=' * 78}")
    print(f"{player.name}  ({player.position.value})   "
          f"CA {player.ability.current:.0f}  PA {player.ability.potential:.0f}")
    print(f"  arc {profile.arc.label} · prime age {profile.prime_age:.1f} · "
          f"athletic peak {profile.athletic_peak:.1f} · "
          f"reaches {profile.realisation:.0%} of his ceiling")
    print(f"{'=' * 78}")
    header = f"{'age':>4} {'CA':>6} {'+/-':>6} {'PA':>6} {'min':>5}"
    if show_attributes:
        header += f" {'ATH':>5} {'TEC':>5} {'EXP':>5} {'CHR':>5}"
    print(header + "  notes")

    peak_ca, peak_age = player.ability.current, player.age
    while not profile.retired and player.age <= 44:
        minutes = default_minutes(player.age, player, profile)
        report = develop_season(
            player, profile, minutes=minutes, coach_development=coach,
            seed=f"{spec['seed']}-{player.age}")
        if report.ca_after > peak_ca:
            peak_ca, peak_age = report.ca_after, report.age
        notes = []
        if report.injury:
            notes.append(f"{report.injury} ({report.games_missed}g)")
        notes.extend(report.events)
        if report.retired:
            notes.append("RETIRES")
        line = (f"{report.age:>4} {report.ca_after:6.1f} {report.ca_change:+6.1f} "
                f"{report.potential:6.1f} {report.minutes:5.0f}")
        if show_attributes:
            line += (f" {group_mean(player, ATHLETIC):5.1f}"
                     f" {group_mean(player, TECHNICAL):5.1f}"
                     f" {group_mean(player, EXPERIENTIAL):5.1f}"
                     f" {group_mean(player, CHARACTER):5.1f}")
        print(line + "  " + "; ".join(notes))

    print(f"  peaked at CA {peak_ca:.0f} aged {peak_age}, "
          f"{peak_ca / spec['pa']:.0%} of a {spec['pa']:.0f} ceiling, "
          f"over {profile.seasons_played} seasons")
    if show_attributes:
        print("  attribute drift, 18 to retirement: " + "  ".join(
            f"{name} {start[name]:.1f}->{group_mean(player, keys):.1f}"
            for name, keys in (("athletic", ATHLETIC), ("technical", TECHNICAL),
                               ("experiential", EXPERIENTIAL), ("character", CHARACTER))
        ))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--coach", type=float, default=50.0,
                        help="head coach development rating, 0-100")
    parser.add_argument("--attributes", action="store_true",
                        help="show group averages drifting year by year")
    args = parser.parse_args()
    for spec in EXAMPLES:
        run(spec, args.coach, args.attributes)


if __name__ == "__main__":
    main()
