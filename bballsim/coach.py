"""Head coaches.

Seven ratings on a 0-100 scale, each with a job in the simulation. A coach who
only decorated a team page would be worse than no coach at all, so every rating
here is read somewhere:

    Offense              team shooting and ball movement
    Defense              what the opposition shoots
    Tactics              turnovers, and how well a scheme is executed
    Player Development   how fast CA climbs toward PA          (ability.develop)
    Leadership           how quickly a locker room gels        (chemistry drift)
    Talent Evaluation    how accurate the club's scouting is   (ability.scout)
    Overall Reputation   standing, not skill -- see below

**Reputation is not ability.** It is what the league thinks of a coach, which
correlates with how good he is but lags it: a coach can be overrated on the
back of one good roster, or underrated after a rebuild. It is generated from
the other six with noise rather than computed from them, so the gap is real and
a manager can be wrong about a hire.

Scale note: coaches are 0-100 rather than the players' 1-20 because these are
standing-and-competence numbers, closer to chemistry (0-100) or CA (0-200) than
to a player attribute. `coach_edge()` converts any of them to the same -1..+1
units the engine works in, so the scale never leaks into a probability.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, fields

COACH_MIN = 0.0
COACH_MAX = 100.0
COACH_AVERAGE = 50.0

# What a coach rating means, for team pages and hiring screens.
COACH_TIERS: tuple[tuple[float, str], ...] = (
    (92.0, "All-time great"),
    (84.0, "Elite"),
    (75.0, "Highly regarded"),
    (64.0, "Well respected"),
    (52.0, "Solid"),
    (40.0, "Journeyman"),
    (28.0, "Struggling"),
    (0.0, "Out of his depth"),
)


def coach_tier(value: float) -> str:
    for floor, label in COACH_TIERS:
        if value >= floor:
            return label
    return COACH_TIERS[-1][1]


def coach_edge(value: float) -> float:
    """A 0-100 coach rating as the -1..+1 units the engine uses.

    Going through this rather than dividing by a literal is what keeps the
    coach scale out of the probability code, the same way `ratings.fraction`
    does for the 1-20 attributes.
    """
    return (value - COACH_AVERAGE) / COACH_AVERAGE


def clamp_coach(value: float) -> float:
    return max(COACH_MIN, min(COACH_MAX, float(value)))


@dataclass
class CoachRatings:
    """The eight numbers. All 0-100, 50 being an ordinary head coach."""

    offense: float = COACH_AVERAGE
    defense: float = COACH_AVERAGE
    tactics: float = COACH_AVERAGE
    development: float = COACH_AVERAGE
    leadership: float = COACH_AVERAGE
    talent_evaluation: float = COACH_AVERAGE
    # How well he looks after bodies: how early he pulls a man who has lost a
    # step, and how willing he is to sit one for a night. High is not
    # automatically better -- a cautious coach protects a squad in March and
    # gives away games in November, which is the trade the rating exists to
    # make.
    player_management: float = COACH_AVERAGE
    reputation: float = COACH_AVERAGE

    def __post_init__(self) -> None:
        for f in fields(self):
            setattr(self, f.name, clamp_coach(getattr(self, f.name)))

    @classmethod
    def attribute_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]

    def to_dict(self) -> dict[str, float]:
        return {f.name: round(getattr(self, f.name), 1) for f in fields(self)}

    @classmethod
    def from_dict(cls, data: dict) -> "CoachRatings":
        known = set(cls.attribute_names())
        return cls(**{k: v for k, v in data.items() if k in known})


# Display order and labels, matching how a team page reads.
COACH_RATING_LABELS: tuple[tuple[str, str], ...] = (
    ("reputation", "Overall Reputation"),
    ("offense", "Offense"),
    ("defense", "Defense"),
    ("development", "Player Development"),
    ("player_management", "Player Management"),
    ("tactics", "Tactics"),
    ("leadership", "Leadership"),
    ("talent_evaluation", "Scouting Eye"),
)

# Everything except reputation, which is standing rather than skill.
COACHING_SKILLS = tuple(key for key, _ in COACH_RATING_LABELS if key != "reputation")


# One per coaching skill, and `test_coach` checks the two lists agree so this
# cannot fall behind `COACH_RATING_LABELS` again.
SPECIALISM_LABELS: dict[str, str] = {
    "offense": "Offensive mind",
    "defense": "Defensive specialist",
    "tactics": "Tactician",
    "development": "Player developer",
    "player_management": "Man manager",
    "leadership": "Motivator",
    "talent_evaluation": "Talent spotter",
}


@dataclass
class Coach:
    id: str
    first_name: str
    last_name: str
    age: int = 50
    nationality: str = "United States"
    seasons_coached: int = 0
    ratings: CoachRatings = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.ratings is None:
            self.ratings = CoachRatings()

    @property
    def name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def short_name(self) -> str:
        initial = f"{self.first_name[:1]}. " if self.first_name else ""
        return f"{initial}{self.last_name}"

    @property
    def tier(self) -> str:
        return coach_tier(self.ratings.reputation)

    @property
    def specialism(self) -> str:
        """What this coach is known for -- his best skill, named."""
        best = max(COACHING_SKILLS, key=lambda key: getattr(self.ratings, key))
        # Every coaching skill needs a name here. `COACHING_SKILLS` is derived
        # from `COACH_RATING_LABELS`, so adding a rating there without adding
        # it below leaves this raising a KeyError for whichever coach happens
        # to be best at the new one -- which is exactly what adding
        # `player_management` did.
        return SPECIALISM_LABELS[best]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "short_name": self.short_name,
            "age": self.age,
            "nationality": self.nationality,
            "seasons_coached": self.seasons_coached,
            "tier": self.tier,
            "specialism": self.specialism,
            "ratings": self.ratings.to_dict(),
        }


# --------------------------------------------------------------------------
# How much a coach is worth.
#
# Between the best and worst head coach in the league these add up to roughly
# five or six points a game, which is about what the research suggests
# coaching is worth. Big enough to matter when hiring, small enough that a
# great coach cannot carry a bad roster.
# --------------------------------------------------------------------------

COACH_SHOOTING_SWING = 0.010      # offense/defense, on field-goal percentage
COACH_ASSIST_SWING = 0.055        # offense, on assist rate
COACH_TURNOVER_SWING = 0.012      # tactics, on turnover rate
COACH_SCHEME_SWING = 0.30         # tactics, on how fully a scheme's effects land
COACH_REBOUND_SWING = 0.020       # defense, on the defensive glass
COACH_DEVELOPMENT_SWING = 0.45    # development, on CA growth per season
COACH_CHEMISTRY_SWING = 0.50      # leadership, on chemistry drift
COACH_SCOUTING_SWING = 0.35       # talent evaluation, on scouting accuracy


def offensive_edge(coach: Coach | None) -> float:
    return coach_edge(coach.ratings.offense) if coach else 0.0


def defensive_edge(coach: Coach | None) -> float:
    return coach_edge(coach.ratings.defense) if coach else 0.0


def tactical_edge(coach: Coach | None) -> float:
    return coach_edge(coach.ratings.tactics) if coach else 0.0


def development_multiplier(coach: Coach | None) -> float:
    """Multiplier on a season's CA growth."""
    return 1.0 + coach_edge(coach.ratings.development) * COACH_DEVELOPMENT_SWING if coach else 1.0


def chemistry_multiplier(coach: Coach | None) -> float:
    """Multiplier on how fast pair chemistry builds."""
    return 1.0 + coach_edge(coach.ratings.leadership) * COACH_CHEMISTRY_SWING if coach else 1.0


def scouting_accuracy(coach: Coach | None, base: float = 0.55) -> float:
    """How well this club reads a player's ceiling, 0.05-1.0."""
    if coach is None:
        return base
    value = base + coach_edge(coach.ratings.talent_evaluation) * COACH_SCOUTING_SWING
    return max(0.05, min(1.0, value))


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

COACH_FIRST_NAMES: tuple[str, ...] = (
    "Aaron", "Bernard", "Curtis", "Dominic", "Edward", "Frank", "Gregg",
    "Hal", "Ira", "Jerome", "Keith", "Lionel", "Martin", "Neil", "Otis",
    "Preston", "Quentin", "Roland", "Stan", "Terrence", "Ulysses", "Victor",
    "Walter", "Xavier", "Yannis", "Zachary", "Bruce", "Chuck", "Desmond",
    "Elton", "Fabien", "Giorgio", "Hector", "Ivan", "Julius",
)

COACH_SURNAMES: tuple[str, ...] = (
    "Ashworth", "Belmonte", "Carruthers", "Delaney", "Espinoza", "Falconer",
    "Grimaldi", "Hutchings", "Ivarsson", "Jamison", "Kirchner", "Lombardi",
    "Marchetti", "Nowak", "O'Rourke", "Pellegrini", "Quarrie", "Rasmussen",
    "Sabatini", "Thibault", "Ueberroth", "Vasilenko", "Waverly", "Yates",
    "Zambrano", "Ackley", "Brentwood", "Castellanos", "Dvorak", "Eriksen",
    "Fontenot", "Galarraga", "Holloway", "Imperato", "Jaworski",
)

# Coaching profiles: a coach is rarely good at everything, so generation picks
# a leaning and spends above his baseline there. This is why hiring is a real
# choice rather than a search for the biggest number.
COACH_PROFILES: dict[str, dict[str, float]] = {
    "offensive": {"offense": 12.0, "tactics": 4.0, "defense": -8.0, "development": -2.0,
                  "player_management": -3.0},
    "defensive": {"defense": 13.0, "tactics": 5.0, "offense": -9.0, "development": -1.0,
                  "player_management": 1.0},
    "tactician": {"tactics": 13.0, "offense": 4.0, "defense": 4.0, "leadership": -6.0},
    "developer": {"development": 14.0, "talent_evaluation": 7.0, "tactics": -5.0, "offense": -3.0,
                  "player_management": 8.0},
    "motivator": {"leadership": 14.0, "development": 5.0, "tactics": -7.0, "talent_evaluation": -3.0,
                  "player_management": -4.0},
    "evaluator": {"talent_evaluation": 15.0, "development": 6.0, "offense": -4.0, "defense": -3.0},
    "balanced": {},
}


def make_coach(
    rng: random.Random,
    coach_id: str,
    first_name: str,
    last_name: str,
    quality: float,
    nationality: str = "United States",
) -> Coach:
    """Build a coach around a quality level (0.0-1.0) and a leaning.

    `quality` sets the baseline every rating is drawn around; the profile then
    moves ability between areas without adding any. Reputation is drawn from
    the resulting skills *with noise*, so a coach can be over- or underrated.
    """
    baseline = 34.0 + quality * 50.0
    profile_name = rng.choice(list(COACH_PROFILES))
    profile = COACH_PROFILES[profile_name]

    def draw(key: str) -> float:
        return clamp_coach(rng.gauss(baseline + profile.get(key, 0.0), 6.5))

    ratings = CoachRatings(**{key: draw(key) for key in COACHING_SKILLS})

    # Reputation follows the on-court skills most visible from outside -- wins
    # come from offense, defense and tactics -- and lags development and
    # scouting, which the public never really sees.
    visible = (
        0.34 * ratings.offense
        + 0.34 * ratings.defense
        + 0.22 * ratings.tactics
        + 0.10 * ratings.leadership
    )
    ratings.reputation = clamp_coach(rng.gauss(visible, 7.0))

    age = rng.randint(36, 68)
    return Coach(
        id=coach_id,
        first_name=first_name,
        last_name=last_name,
        age=age,
        nationality=nationality,
        # A coach cannot have been in the job before he was old enough to hold it.
        seasons_coached=max(0, min(age - 32, rng.randint(0, 24))),
        ratings=ratings,
    )


def make_coaches(rng: random.Random, count: int) -> list[Coach]:
    """A league's worth of coaches: a few excellent, most ordinary."""
    if count > min(len(COACH_FIRST_NAMES), len(COACH_SURNAMES)):
        raise ValueError(f"need {count} unique coach names")

    first_names = rng.sample(COACH_FIRST_NAMES, count)
    surnames = rng.sample(COACH_SURNAMES, count)

    coaches = []
    for index in range(count):
        # Quality skews low: elite head coaches are scarce.
        quality = min(1.0, max(0.0, rng.betavariate(2.2, 2.6)))
        coaches.append(make_coach(
            rng,
            coach_id=f"coach-{index + 1:02d}",
            first_name=first_names[index],
            last_name=surnames[index],
            quality=quality,
        ))
    return coaches
