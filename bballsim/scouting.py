"""What a draft prospect plays like -- and nothing about how good he is.

A scouting card is the one page in this project that has to be *deliberately
incomplete*. `mock_draft.py` already refuses to print a prospect's current
ability or his ceiling, because finding out who turns into something is the
whole entertainment of a draft. This module adds a card beside the name, and
the same rule binds it: it may describe **how** a man plays and must say
nothing about **how well**.

That is harder than it sounds, because in this simulation style and quality are
not independent. `prospects.make_prospect` draws tendencies *from* the ratings,
which are drawn from current ability:

    usage            = gauss(5.0 + (target_ca / 200.0) * 12.0, 1.6)
    three_point_rate = gauss(ratings.three_point, 2.4)
    rim_rate         = gauss((ratings.layups + ratings.close_shot) / 2, 2.4)

So the tendencies of a good prospect are *higher across the board* than those
of a poor one. Printing them, or percentile-ranking them, or drawing them as
bars, hands the reader the number the page is supposed to be withholding. A
first attempt that showed "usage" as a bar would have been a CA readout with a
different label on it.

**The fix is composition.** A style vector here is the *share* each tendency
takes of that player's own total, so the five numbers sum to one. Ability
scales the tendencies roughly together, and dividing by their sum cancels a
common scale -- which turns "how much does he do" into "what does he do", the
only one of the two that is a style. `usage` is dropped outright rather than
normalised, because it is a direct linear function of current ability and is
not a shape at all.

`tests/test_scouting.py` measures the result rather than trusting the argument:
it builds whole classes and checks the correlation between each published axis
and current ability, which is the claim this docstring is making.

**The comp is a style comp, and the page says so.** Matching a prospect to the
league's best player would be a quality claim wearing a style label, so the
match reads only the four axes below and never ability, minutes, or production.
The pool is everyone who is in the league now and everyone the archives
remember playing in it. Those two halves are measured differently and have to
be:

    in the league now      his tendencies, which exist
    played in the league   his archived statistical shape, because a retired
                           player's tendencies do not survive him

Bridging the two is only legitimate because tendencies really do predict what a
player does on the floor. Measured over 359 qualified players in a simulated
season:

    usage            -> usage per 36      r = +0.80
    crash_glass      -> off reb per 36    r = +0.78
    pass_first       -> assist share      r = +0.76
    three_point_rate -> 3PA share         r = +0.59
    rim_rate         -> 3PA share         r = -0.37   (correctly negative)

Both halves are then percentile-ranked inside their own population, which is
what makes a tendency and a statistic comparable without inventing a regression
between them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# The five tendencies that describe a shape. `usage` is absent on purpose --
# see the docstring; it is ability wearing a costume.
SHAPE = ("three_point_rate", "rim_rate", "post_up_rate", "pass_first",
         "crash_glass")

# The axes a comp is made on. Four rather than five, because a box score has no
# post-up column: a prospect's post lean survives into the prose, where it can
# be said in words, but it cannot be matched against a man whose record is his
# statistics.
#
# Each is a *ratio*, never a count, for the same reason the shape is a share.
COMP_AXES = ("range", "rim", "creation", "glass")

# A comp has to be a player you could picture in the same role. Positions are
# grouped rather than matched exactly, because "he is the next Kofi Gladwell"
# is a useful sentence about a power forward compared to a centre and a useless
# one about a power forward compared to a point guard.
POSITION_GROUP = {"PG": "guard", "SG": "guard", "SF": "wing",
                  "PF": "big", "C": "big"}
NEIGHBOURS = {"guard": ("guard", "wing"), "wing": ("wing", "guard", "big"),
              "big": ("big", "wing")}

# A season short enough that its shape is noise. Same argument as the record
# book's rate qualifier and the All-Star ballot's games floor.
COMP_MINIMUM_GAMES = 20
COMP_MINIMUM_SHOTS = 100

# How far apart two styles can be and still be called a comp. Distance is in
# percentile space over four axes, so the worst possible is 2.0.
COMP_MAX_DISTANCE = 0.55


@dataclass
class Style:
    """One player's shape: five shares that sum to one."""

    shares: dict[str, float] = field(default_factory=dict)

    def share(self, name: str) -> float:
        return self.shares.get(name, 0.0)

    def to_dict(self) -> dict:
        return {k: round(v, 4) for k, v in self.shares.items()}


def style_of(player) -> Style:
    """The composition of a player's tendencies.

    Scale-free by construction: multiply every tendency by any constant and
    this is unchanged, which is exactly what makes it a style rather than a
    rating.
    """
    tendencies = getattr(player, "tendencies", None)
    if tendencies is None:
        return Style()
    raw = {name: max(0.0, float(getattr(tendencies, name, 0.0)))
           for name in SHAPE}
    total = sum(raw.values())
    if total <= 0:
        return Style({name: 1.0 / len(SHAPE) for name in SHAPE})
    return Style({name: value / total for name, value in raw.items()})


def comp_axes_from_style(style: Style) -> dict[str, float]:
    """A prospect's four comp axes, from his shape.

    Ratios of ratios: every one of these is a share of a share, so nothing here
    carries a level either.
    """
    shot = (style.share("three_point_rate") + style.share("rim_rate")
            + style.share("post_up_rate")) or 1.0
    return {
        "range": style.share("three_point_rate") / shot,
        "rim": style.share("rim_rate") / shot,
        "creation": style.share("pass_first") / (style.share("pass_first") + shot),
        "glass": style.share("crash_glass") / (style.share("crash_glass") + shot),
    }


def comp_axes_from_line(line) -> dict[str, float] | None:
    """The same four axes for a man whose record is his statistics.

    `rim` is the free-throw rate, which is the standard reading of how much of
    a player's offence happens at the basket -- a box score has no column for
    where a shot was taken from inside the arc, but it does record who gets hit
    while taking it.
    """
    fga = float(getattr(line, "fga", 0) or 0)
    if fga < COMP_MINIMUM_SHOTS or getattr(line, "games", 0) < COMP_MINIMUM_GAMES:
        return None
    assists = float(getattr(line, "assists", 0) or 0)
    oreb = float(getattr(line, "offensive_rebounds", 0) or 0)
    return {
        "range": float(getattr(line, "tpa", 0) or 0) / fga,
        "rim": float(getattr(line, "fta", 0) or 0) / fga,
        "creation": assists / (assists + fga),
        "glass": oreb / (oreb + fga),
    }


def _percentiles(rows: list[dict]) -> list[dict]:
    """Rank each axis inside its own population, 0.0 to 1.0.

    What makes a tendency and a statistic comparable at all. Neither is on a
    scale the other shares, but "further out on this axis than four-fifths of
    his peers" means the same thing on both sides.
    """
    if not rows:
        return []
    out = [dict(row) for row in rows]
    for axis in COMP_AXES:
        order = sorted(range(len(out)), key=lambda i: out[i]["axes"][axis])
        last = max(1, len(order) - 1)
        for rank, index in enumerate(order):
            out[index].setdefault("pct", {})[axis] = rank / last
    return out


def _distance(left: dict, right: dict) -> float:
    return sum(abs(left[axis] - right[axis]) for axis in COMP_AXES) / len(COMP_AXES)


def league_pool(league) -> list[dict]:
    """Everyone a prospect could be compared to: in the league now, or in it
    once. Built from statistics in both halves, because that is the only record
    a player who has left the league leaves behind."""
    pool: list[dict] = []
    seen: set[str] = set()

    def offer(line, season: str, club: str, current: bool) -> None:
        axes = comp_axes_from_line(line)
        if axes is None:
            return
        key = f"{line.player_id}:{season}"
        if key in seen:
            return
        seen.add(key)
        pool.append({
            "playerId": line.player_id, "name": line.name,
            "position": getattr(line, "position", "") or "",
            "teamId": club, "season": season, "current": current, "axes": axes,
        })

    clubs = {tid: team.abbreviation for tid, team in league.teams.items()}
    for line in league.stats.players.values():
        offer(line, league.season, clubs.get(line.team_id, ""), True)
    for archive in getattr(league, "history", []) or []:
        for line in archive.stats.players.values():
            offer(line, archive.season, clubs.get(line.team_id, ""), False)
    return _percentiles(pool)


def class_pool(year: int) -> list[dict]:
    """The draft class, ranked against itself.

    His cohort is the right population to rank him in: "the most perimeter-
    oriented big in this class" is a scouting sentence, and it is one that can
    be said without knowing whether he is any good.
    """
    from . import draft_class

    rows = []
    for prospect in draft_class.board(year):
        shape = style_of(prospect)
        rows.append({"playerId": prospect.id, "name": prospect.name,
                     "position": prospect.position.value,
                     "shares": shape.shares,
                     "axes": comp_axes_from_style(shape)})
    return _percentiles(rows)


def comp_for(prospect, year: int, pool: list[dict],
             ranked: list[dict] | None = None) -> dict | None:
    """The player in the league, now or once, who plays most like him.

    Style only. Ability, minutes and production are never read, so a comp says
    "this is the shape of him" and never "this is how good he will be" -- which
    is the thing the whole draft preview exists not to say.

    Returns None rather than reaching for a bad match: a prospect whose nearest
    neighbour is half a league away is better served by silence than by a name
    that does not fit.
    """
    ranked = ranked if ranked is not None else class_pool(year)
    mine = next((row for row in ranked if row["playerId"] == prospect.id), None)
    if mine is None or not pool:
        return None

    group = POSITION_GROUP.get(prospect.position.value, "wing")
    allowed = {g for g in NEIGHBOURS.get(group, (group,))}
    best, best_gap = None, None
    for row in pool:
        if POSITION_GROUP.get(row["position"], "") not in allowed:
            continue
        gap = _distance(mine["pct"], row["pct"])
        # Same position group first: a tie between a wing and a big goes to the
        # one who plays the prospect's own position.
        gap += 0.0 if POSITION_GROUP.get(row["position"]) == group else 0.06
        if best_gap is None or gap < best_gap:
            best, best_gap = row, gap

    if best is None or best_gap > COMP_MAX_DISTANCE:
        return None
    return {
        "playerId": best["playerId"], "name": best["name"],
        "position": best["position"], "teamId": best["teamId"],
        "season": best["season"], "current": best["current"],
        "fit": round(1.0 - min(1.0, best_gap), 3),
    }


# --------------------------------------------------------------------------
# The write-up
#
# Every phrase below describes what a player *does*. None of them grades it.
# There is no "elite", no "raw", no "polished", no "limited" -- those are the
# words a scouting report normally lives on, and every one of them would be a
# statement about ability, which is the thing this page is withholding.
# `tests/test_scouting.py` audits the vocabulary for exactly that.
# --------------------------------------------------------------------------

# How far above his position's own average a share has to sit before it is
# worth a sentence. Positional, because a centre who takes a fifth of his shots
# from range is a stretch big and a guard who does is not.
LEAN = 0.16
STRONG_LEAN = 0.34

SHOT_DIET = {
    "three_point_rate": ("spaces the floor and shoots from range",
                         "lives behind the arc"),
    "rim_rate": ("gets downhill towards the rim", "attacks the basket first"),
    "post_up_rate": ("works with his back to the basket",
                     "plays out of the post"),
}

# Read after "He is", so every branch finishes the sentence. Physical facts
# only: height is on his card in the app already, and a frame is not a rating.
FRAME = (
    (-2.5, "small for the position"),
    (-1.0, "on the short side for the position"),
    (1.0, "about the size the position expects"),
    (2.5, "big for the position"),
    (99.0, "long for the position"),
)

# A lean is only worth a sentence if it is both *more* than his position's
# peers and actually a real part of what he does. Relative lift alone called
# point guards post players, because a guard sitting a hair above a guard's
# tiny post share is still a guard who does not post up.
LIFT = 1.15
STRONG_LIFT = 1.5
SHARE_FLOOR = 0.18


def _position_means(ranked: list[dict], position: str, key: str) -> dict[str, float]:
    """Mean `axes` or `shares` among this class's players at one position.

    His cohort at his position is the only fair comparison: a centre who takes
    a fifth of his shots from range is a stretch big, and a guard who does is
    ordinary.
    """
    peers = [row for row in ranked if row["position"] == position] or ranked
    if not peers:
        return {}
    names = peers[0][key].keys()
    return {name: sum(row[key][name] for row in peers) / len(peers)
            for name in names}


def summary(prospect, year: int, ranked: list[dict] | None = None) -> str:
    """One paragraph on how he plays, measured against his own class.

    Assembled from the shape rather than written beside it, so it cannot drift
    from the card it is describing -- the same discipline `mock_draft.note_for`
    and the trade engine's explanations follow.
    """
    from .biography import POSITION_HEIGHT

    ranked = ranked if ranked is not None else class_pool(year)
    mine = next((r for r in ranked if r["playerId"] == prospect.id), None)
    if mine is None:
        return ""
    position = prospect.position.value
    axis_mean = _position_means(ranked, position, "axes")
    share_mean = _position_means(ranked, position, "shares")

    bits: list[str] = []

    # What he does with the ball. **What he does most**, not what he does most
    # unusually -- ranking by lift alone led with a scoring guard's third
    # habit, calling a man who takes 18% of his shots from the post someone who
    # "plays out of the post". Lift decides only how emphatically it is put.
    lift = {}
    for name in SHOT_DIET:
        mean = share_mean.get(name) or 0.0
        lift[name] = (mine["shares"][name] / mean) if mean > 0 else 0.0
    lead_axis = max(SHOT_DIET, key=lambda name: mine["shares"][name])
    bits.append(SHOT_DIET[lead_axis][1 if lift[lead_axis] >= STRONG_LIFT else 0])

    # A second habit worth a line only when it is genuinely unusual for the
    # position -- a posting guard, a centre who steps out. This is where the
    # lift belongs: it is the whole content of "unusually for a...".
    other = [name for name in SHOT_DIET
             if name != lead_axis and lift[name] >= STRONG_LIFT
             and mine["shares"][name] >= SHARE_FLOOR]
    unusual = ""
    if other:
        pick = max(other, key=lambda name: lift[name])
        unusual = f" Unusually for the position, he also {SHOT_DIET[pick][0]}."

    creation = mine["axes"]["creation"] - (axis_mean.get("creation") or 0.0)
    if creation >= 0.05:
        bits.append("looks to pass before he looks to score")
    elif creation <= -0.05:
        bits.append("looks for his own shot first")

    glass = mine["axes"]["glass"] - (axis_mean.get("glass") or 0.0)
    if glass >= 0.03:
        bits.append("crashes the offensive glass")
    elif glass <= -0.03:
        bits.append("gets back rather than chase the offensive board")

    mean_height, spread = POSITION_HEIGHT.get(position, (78.0, 2.5))
    z = (prospect.height_inches - mean_height) / (spread or 1.0)
    frame = next(text for edge, text in FRAME if z <= edge)

    archetype = prospect.archetype.label if prospect.archetype else position
    lead = f"A {archetype.lower()} who {bits[0]}"
    rest = "".join(f", {bit}" for bit in bits[1:])
    return f"{lead}{rest}.{unusual} He is {frame}."


# --------------------------------------------------------------------------
# The card
# --------------------------------------------------------------------------

def card_for(prospect, year: int, pool: list[dict],
             ranked: list[dict] | None = None) -> dict:
    """Everything the page shows about one prospect.

    What is *absent* is the point, and it is absent here rather than hidden in
    the UI: no current ability, no potential, no ratings, no tendencies, no
    hidden attributes. A surprise one browser tab away is not a surprise --
    `mock_draft.py` makes the same argument about board rank.

    What is present is what a scouting page can honestly show before a man has
    played a professional minute: who he is, how big he is, where he came from,
    what he does with the ball, and who he plays like.
    """
    from . import portraits

    ranked = ranked if ranked is not None else class_pool(year)
    bio = prospect.bio
    return {
        "playerId": prospect.id,
        "name": prospect.name,
        "position": prospect.position.value,
        "age": prospect.age,
        "height": prospect.height,
        "weight": prospect.weight_lbs,
        "nationality": bio.nationality if bio else "",
        "background": bio.background if bio else "",
        "backgroundType": bio.background_type if bio else "",
        "archetype": prospect.archetype.label if prospect.archetype else "",
        "portrait": portraits.features(prospect),
        # Shares, not levels. See the module docstring for why that distinction
        # is the whole design and not a detail.
        "style": style_of(prospect).to_dict(),
        "summary": summary(prospect, year, ranked),
        "comp": comp_for(prospect, year, pool, ranked),
    }


def cards(league) -> dict:
    """The whole declared class, carded.

    Built in one pass: the league pool and the class ranking are each computed
    once and handed to all sixty, because building them per prospect meant
    percentile-ranking three hundred player-seasons sixty times over.
    """
    from . import draft_class, draft_picks

    year = draft_picks.current_year(league)
    pool = league_pool(league)
    ranked = class_pool(year)
    return {
        "year": year,
        "classLabel": draft_class.label(year),
        "compPool": len(pool),
        "note": (
            "Scouting describes how a prospect plays, never how good he is. "
            "Ability and ceiling are deliberately absent — finding out who "
            "turns into something is the point of a draft. Comparisons are "
            "style only: they are matched on shot diet, creation and work on "
            "the glass, and never on ability or production."
        ),
        "prospects": [card_for(p, year, pool, ranked)
                      for p in draft_class.board(year)],
    }
