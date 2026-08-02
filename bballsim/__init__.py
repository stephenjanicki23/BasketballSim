"""Basketball Manager simulation engine.

Layers, bottom up:

    ratings.py / tactics.py / chemistry.py   inputs the sim reads
    models.py                                players, teams, lineups
    engine/                                  possession-by-possession sim
    league/                                  calendar, standings, sim clock
    api/                                     JSON API + static file server
"""

__version__ = "0.1.0"

from .models import Lineup, Player, Position, Team
from .ratings import Ratings, Tendencies
from .tactics import Aggression, DefensiveScheme, OffensiveScheme, Tactics

__all__ = [
    "Lineup",
    "Player",
    "Position",
    "Team",
    "Ratings",
    "Tendencies",
    "Tactics",
    "OffensiveScheme",
    "DefensiveScheme",
    "Aggression",
]
