"""Who a player is, as opposed to how good he is.

Age, height, weight, nationality, where he came from, and which draft class he
belongs to. None of this touches the simulation -- the engine reads ratings and
composites -- but a manager game is unplayable without it: you cannot scout a
prospect, run a draft or build a roster around names alone.

Two consistency rules are enforced here rather than left to callers:

  * **Draft class follows age.** A player's draft year is
    `current season - (age - the age he entered the league)`, and the age he
    entered depends on his route in. A four-year college senior arrives at 22,
    a one-and-done at 19. So a 30-year-old is never in last year's class.
  * **Draft position follows potential, not current ability.** Teams draft on
    what they think a player will become. A bust is a high pick with a low CA
    years later, which is exactly what should be possible.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Nationality. Weighted to look like an NBA roster: mostly American, with a
# long tail of basketball nations.
# --------------------------------------------------------------------------

NATIONALITIES: tuple[tuple[str, float], ...] = (
    ("United States", 72.0),
    ("Canada", 3.2), ("France", 2.6), ("Serbia", 2.0), ("Australia", 1.9),
    ("Spain", 1.6), ("Germany", 1.5), ("Nigeria", 1.3), ("Lithuania", 1.1),
    ("Slovenia", 1.0), ("Greece", 1.0), ("Croatia", 0.9), ("Turkey", 0.9),
    ("Brazil", 0.8), ("Argentina", 0.8), ("Latvia", 0.7),
    ("Dominican Republic", 0.7), ("Cameroon", 0.6), ("Senegal", 0.6),
    ("Italy", 0.6), ("Israel", 0.5), ("Japan", 0.5), ("Ukraine", 0.4),
    ("Montenegro", 0.4), ("Bahamas", 0.4), ("United Kingdom", 0.4),
    ("Finland", 0.3), ("Georgia", 0.3), ("New Zealand", 0.3),
    ("South Sudan", 0.3), ("Democratic Republic of the Congo", 0.3),
    ("Mali", 0.2), ("Switzerland", 0.2), ("Sweden", 0.2), ("Poland", 0.2),
)

COLLEGES: tuple[str, ...] = (
    "Duke", "Kentucky", "North Carolina", "Kansas", "UCLA", "Arizona",
    "Michigan State", "Villanova", "Gonzaga", "Texas", "Florida", "Louisville",
    "Indiana", "Connecticut", "Syracuse", "Michigan", "Ohio State", "Baylor",
    "Auburn", "Tennessee", "Alabama", "Arkansas", "Purdue", "Illinois",
    "Wisconsin", "Marquette", "Creighton", "Houston", "Memphis", "Oregon",
    "USC", "Washington", "Colorado", "Iowa State", "Oklahoma", "Texas Tech",
    "Virginia", "Miami", "Florida State", "Georgia Tech", "Providence",
    "Xavier", "Dayton", "Saint Mary's", "San Diego State", "Nevada",
    "Wichita State", "VCU", "Davidson", "Murray State",
)

# Routes into the league that are not college.
PREP_PROGRAMS: tuple[str, ...] = (
    "G League Ignite", "Overtime Elite", "NBA Global Academy",
    "Prep-to-pro", "Australian NBL Next Stars",
)

# Home clubs, so an international player's background reads like a real one.
INTERNATIONAL_CLUBS: dict[str, tuple[str, ...]] = {
    "Spain": ("Real Madrid", "FC Barcelona", "Baskonia", "Valencia Basket"),
    "Serbia": ("KK Crvena zvezda", "KK Partizan", "KK Mega Basket"),
    "France": ("ASVEL", "Paris Basketball", "Metropolitans 92", "Nanterre 92"),
    "Greece": ("Panathinaikos", "Olympiacos", "AEK Athens"),
    "Turkey": ("Anadolu Efes", "Fenerbahce", "Besiktas"),
    "Lithuania": ("Zalgiris Kaunas", "Rytas Vilnius"),
    "Slovenia": ("KK Cedevita Olimpija", "Krka"),
    "Croatia": ("KK Cibona", "KK Zadar", "KK Split"),
    "Italy": ("Olimpia Milano", "Virtus Bologna", "Reyer Venezia"),
    "Germany": ("Alba Berlin", "Bayern Munich", "Ratiopharm Ulm"),
    "Australia": ("Sydney Kings", "Melbourne United", "Perth Wildcats"),
    "New Zealand": ("New Zealand Breakers",),
    "Israel": ("Maccabi Tel Aviv", "Hapoel Jerusalem"),
    "Latvia": ("VEF Riga", "BK Ventspils"),
    "Montenegro": ("KK Buducnost",),
    "Ukraine": ("BC Budivelnyk", "BC Prometey"),
    "Georgia": ("BC Dinamo Tbilisi",),
    "Finland": ("Helsinki Seagulls",),
    "Poland": ("Stal Ostrow",),
    "Sweden": ("Norrkoping Dolphins",),
    "Switzerland": ("Fribourg Olympic",),
    "Japan": ("Ryukyu Golden Kings", "Chiba Jets"),
    "Brazil": ("Flamengo", "Sao Paulo FC"),
    "Argentina": ("Boca Juniors", "San Lorenzo"),
    "Canada": ("Canada Basketball Academy",),
    "United Kingdom": ("London Lions",),
}
# Countries with no club list fall back to a national-team pathway.
GENERIC_INTERNATIONAL = "{country} national program"


# Draft stock below this is usually not worth a pick; the range above it spans
# the whole board from the last pick to first overall.
DRAFT_STOCK_FLOOR = 112.0
DRAFT_STOCK_RANGE = 62.0


@dataclass
class DraftInfo:
    """Which class a player came in with, and where he went.

    `round` and `pick` are None for an undrafted player -- he still has a class
    year, because that is the season he entered the league.
    """

    year: int
    round: int | None = None
    pick: int | None = None

    @property
    def undrafted(self) -> bool:
        return self.pick is None

    @property
    def label(self) -> str:
        if self.undrafted:
            return f"{self.year} · Undrafted"
        return f"{self.year} · Rd {self.round}, Pick {self.pick}"

    def to_dict(self) -> dict:
        return {
            "year": self.year,
            "round": self.round,
            "pick": self.pick,
            "undrafted": self.undrafted,
            "label": self.label,
        }


@dataclass
class Biography:
    """Everything about a player that is not a rating."""

    nationality: str = "United States"
    background: str = ""            # "Duke", "Real Madrid (Spain)"
    background_type: str = "College"  # College | International | Prep
    draft: DraftInfo | None = None

    def to_dict(self) -> dict:
        return {
            "nationality": self.nationality,
            "background": self.background,
            "background_type": self.background_type,
            "draft": self.draft.to_dict() if self.draft else None,
        }


# --------------------------------------------------------------------------
# Physicals
# --------------------------------------------------------------------------

# Mean height in inches by position, with a realistic spread.
POSITION_HEIGHT: dict[str, tuple[float, float]] = {
    "PG": (74.5, 1.9),
    "SG": (77.0, 1.8),
    "SF": (79.3, 1.7),
    "PF": (81.2, 1.6),
    "C": (83.2, 1.7),
}


def draw_height(rng: random.Random, position: str) -> int:
    mean, spread = POSITION_HEIGHT.get(position, (79.0, 2.0))
    return int(round(max(68.0, min(90.0, rng.gauss(mean, spread)))))


def draw_weight(rng: random.Random, height_inches: int, strength: float) -> int:
    """Weight follows height, nudged by how strong the player is built."""
    base = 175.0 + (height_inches - 72) * 8.2
    build = (strength - 10.0) * 2.6      # 1-20 strength rating
    return int(round(max(150.0, min(330.0, base + build + rng.gauss(0, 9)))))


# --------------------------------------------------------------------------
# Age
# --------------------------------------------------------------------------

# Realistic league age distribution: a bulge through the mid-twenties, thin at
# both ends. Weighted so a roster does not read like a college team.
AGE_WEIGHTS: tuple[tuple[int, float], ...] = (
    (19, 1.2), (20, 2.4), (21, 3.6), (22, 5.0), (23, 6.4), (24, 7.4),
    (25, 8.0), (26, 8.2), (27, 7.8), (28, 7.0), (29, 6.2), (30, 5.2),
    (31, 4.2), (32, 3.2), (33, 2.4), (34, 1.6), (35, 1.0), (36, 0.6),
)


def draw_age(rng: random.Random, target_ca: float) -> int:
    """Age for a player of this ability.

    Weighted toward prime years, and tilted by ability: a very good player is
    unlikely to be 19, and a fringe roster player is more often a prospect or a
    veteran than a 26-year-old in his prime.
    """
    ages, weights = zip(*AGE_WEIGHTS)
    quality = max(0.0, min(1.0, (target_ca - 60.0) / 110.0))
    adjusted = []
    for age, weight in AGE_WEIGHTS:
        # Good players skew toward their prime; weak ones toward the edges.
        prime_distance = abs(age - 27) / 8.0
        adjusted.append(weight * (1.0 - quality * prime_distance * 0.55))
    return rng.choices(ages, weights=[max(0.05, w) for w in adjusted], k=1)[0]


# --------------------------------------------------------------------------
# Background and draft
# --------------------------------------------------------------------------

def draw_nationality(rng: random.Random) -> str:
    names, weights = zip(*NATIONALITIES)
    return rng.choices(names, weights=weights, k=1)[0]


def draw_background(rng: random.Random, nationality: str) -> tuple[str, str]:
    """Return (background, background_type) for this player.

    Americans mostly come through college, with a small prep/G-League route.
    Internationals split between a home club and a US college.
    """
    if nationality == "United States":
        roll = rng.random()
        if roll < 0.88:
            return rng.choice(COLLEGES), "College"
        return rng.choice(PREP_PROGRAMS), "Prep"

    if rng.random() < 0.35:
        return rng.choice(COLLEGES), "College"

    clubs = INTERNATIONAL_CLUBS.get(nationality)
    if clubs:
        club = rng.choice(clubs)
        # Some club names already carry the country ("New Zealand Breakers"),
        # so only add the suffix when it tells the reader something new.
        label = club if nationality in club else f"{club} ({nationality})"
        return label, "International"
    return GENERIC_INTERNATIONAL.format(country=nationality), "International"


def entry_age(rng: random.Random, background_type: str) -> int:
    """How old a player was when he entered the league, by route.

    This is what makes draft class and age agree: a 25-year-old who spent four
    years in college belongs to a more recent class than a 25-year-old who came
    straight out of high school.
    """
    if background_type == "College":
        # One-and-done through senior year.
        return rng.choices((19, 20, 21, 22, 23), weights=(26, 24, 22, 22, 6), k=1)[0]
    if background_type == "Prep":
        return rng.choices((19, 20), weights=(80, 20), k=1)[0]
    return rng.choices((19, 20, 21, 22), weights=(30, 30, 25, 15), k=1)[0]


def make_draft(
    rng: random.Random,
    age: int,
    season_start_year: int,
    potential_ability: float,
    background_type: str,
    draft_size: int = 60,
) -> DraftInfo:
    """Build a draft record that is consistent with the player's age.

    Draft position is drawn from **potential**, not current ability -- teams
    draft the player they think they are getting. That is what allows a bust:
    a first-round pick whose CA never caught up with the PA he was taken on.
    """
    entered_at = min(entry_age(rng, background_type), age)
    years_pro = max(0, age - entered_at)
    year = season_start_year - years_pro

    # Draft stock: what teams believed at the time, which is noisier than PA.
    stock = potential_ability + rng.gauss(0.0, 14.0)

    # A draft is small relative to the pool of players trying to get in, so
    # anyone short of the top of his class goes undrafted.
    undrafted_chance = max(0.0, min(0.95, (DRAFT_STOCK_FLOOR - stock) / 45.0))
    if rng.random() < undrafted_chance:
        return DraftInfo(year=year, round=None, pick=None)

    # Higher stock -> earlier pick, steep at the top of the board.
    quality = max(0.0, min(1.0, (stock - DRAFT_STOCK_FLOOR) / DRAFT_STOCK_RANGE))
    position = (1.0 - quality) ** 1.6
    pick = int(round(1 + position * (draft_size - 1) + rng.gauss(0, draft_size * 0.08)))
    pick = max(1, min(draft_size, pick))

    picks_per_round = max(1, draft_size // 2)
    draft_round = 1 if pick <= picks_per_round else 2
    return DraftInfo(year=year, round=draft_round, pick=pick)


def make_biography(
    rng: random.Random,
    age: int,
    season_start_year: int,
    potential_ability: float,
    draft_size: int = 60,
) -> Biography:
    nationality = draw_nationality(rng)
    background, background_type = draw_background(rng, nationality)
    draft = make_draft(
        rng, age, season_start_year, potential_ability, background_type, draft_size
    )
    return Biography(
        nationality=nationality,
        background=background,
        background_type=background_type,
        draft=draft,
    )
