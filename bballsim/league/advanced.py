"""Advanced statistics: the rate and value columns, from the box score.

Everything here is derived. Nothing is stored, nothing is saved, and nothing
new is simulated -- these are the same season totals the Stats page already
shows, put through published formulas. If a number on this page is wrong, the
formula is wrong; the data behind it is the same data as the basic table.

Three groups, and they are not equally solid, so the distinction is worth
making before anyone leans on a column:

**Rate stats** -- ORB%, DRB%, TRB%, AST%, STL%, BLK%, TOV%, USG%. These are
Basketball-Reference's definitions implemented exactly. A rebound percentage is
a share of the boards that were *available*, which is why the season line had
to start tracking opponent totals: the other side's misses are what made them
available.

**Ratings and win shares** -- ORtg, DRtg, OWS, DWS, WS, WS/48. Dean Oliver's
individual offensive and defensive ratings as published in *Basketball on
Paper*, and the win-share construction Basketball-Reference builds on top of
them. Long formulas, implemented as written.

**Plus/minus** -- OBPM, DBPM, BPM, VORP. Basketball-Reference's BPM is a
regression with published *structure* but coefficients this project has no way
to verify, and inventing plausible-looking coefficients is exactly the kind of
thing the rest of this codebase refuses to do. So what is implemented here is a
transparent member of the same family, defined in `box_plus_minus` below:
production per 100 possessions against league average, weighted by usage, then
**adjusted so that a team's minute-weighted BPM equals its actual point
differential per 100 possessions**. That last step is the part that makes BPM
mean anything, and it is done properly. VORP is then the standard formula on
top. The numbers are on the familiar scale -- 0 is a league-average starter,
+8 is an MVP season -- but they will not tie out to Basketball-Reference's to
the decimal, and the UI says so.

PER is Hollinger's, including the league pace adjustment and the normalisation
that puts the league average at exactly 15.
"""

from __future__ import annotations

from dataclasses import dataclass

# A free-throw trip is not a possession; the standard coefficient is 0.44.
FT_POSSESSION_WEIGHT = 0.44

# PER is defined so the league average comes out at 15.
PER_LEAGUE_AVERAGE = 15.0

# Replacement level, in points per 100 possessions below average. The value in
# VORP's definition.
REPLACEMENT_LEVEL = -2.0

MINUTES_PER_GAME = 240.0   # five players, forty-eight minutes


def _safe(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


@dataclass
class LeagueContext:
    """Season-wide totals. Half these formulas are relative to the league."""

    points: float = 0.0
    fgm: float = 0.0
    fga: float = 0.0
    tpm: float = 0.0
    ftm: float = 0.0
    fta: float = 0.0
    offensive_rebounds: float = 0.0
    rebounds: float = 0.0
    assists: float = 0.0
    steals: float = 0.0
    blocks: float = 0.0
    turnovers: float = 0.0
    fouls: float = 0.0
    possessions: float = 0.0
    minutes: float = 0.0
    games: float = 0.0

    @property
    def pace(self) -> float:
        """Possessions per 48 minutes."""
        return _safe(self.possessions * 48.0, self.minutes / 5.0)

    @property
    def points_per_possession(self) -> float:
        return _safe(self.points, self.possessions)

    @property
    def points_per_game(self) -> float:
        return _safe(self.points, self.games)

    @property
    def defensive_rebound_share(self) -> float:
        return _safe(self.rebounds - self.offensive_rebounds, self.rebounds)

    @property
    def value_of_possession(self) -> float:
        """VOP in Hollinger's notation: points a possession is worth."""
        return _safe(
            self.points,
            self.fga - self.offensive_rebounds + self.turnovers
            + FT_POSSESSION_WEIGHT * self.fta,
        )


def league_context(teams) -> LeagueContext:
    """Roll every team line into one league line."""
    ctx = LeagueContext()
    for team in teams:
        ctx.points += team.points
        ctx.fgm += team.fgm
        ctx.fga += team.fga
        ctx.tpm += team.tpm
        ctx.ftm += team.ftm
        ctx.fta += team.fta
        ctx.offensive_rebounds += team.offensive_rebounds
        ctx.rebounds += team.rebounds
        ctx.assists += team.assists
        ctx.steals += team.steals
        ctx.blocks += team.blocks
        ctx.turnovers += team.turnovers
        ctx.fouls += team.fouls
        ctx.possessions += team.possessions
        ctx.minutes += team.minutes
        ctx.games += team.games
    return ctx


def team_pace(team) -> float:
    """Possessions per 48 minutes, using both sides of the ball."""
    both = team.possessions + (team.opp_possessions or team.possessions)
    return _safe(48.0 * (both / 2.0), team.minutes / 5.0)


# --------------------------------------------------------------------------
# Rate stats. Basketball-Reference definitions, implemented as published.
# --------------------------------------------------------------------------

def rate_stats(player, team) -> dict[str, float]:
    minutes = player.minutes
    if minutes <= 0 or team.games <= 0:
        return {key: 0.0 for key in (
            "orb_pct", "drb_pct", "trb_pct", "ast_pct", "stl_pct", "blk_pct",
            "tov_pct", "usg_pct")}

    team_minutes_per_side = team.minutes / 5.0
    share = _safe(team_minutes_per_side, minutes)   # the (Tm MP/5) / MP term

    opp_drb = team.opp_defensive_rebounds
    opp_orb = team.opp_offensive_rebounds
    opp_trb = team.opp_rebounds
    opp_two_pointers = max(0.0, team.opp_fga - team.opp_tpa)
    opp_possessions = team.opp_possessions or team.possessions

    return {
        "orb_pct": 100.0 * _safe(
            player.offensive_rebounds * team_minutes_per_side,
            minutes * (team.offensive_rebounds + opp_drb)),
        "drb_pct": 100.0 * _safe(
            player.defensive_rebounds * team_minutes_per_side,
            minutes * (team.defensive_rebounds + opp_orb)),
        "trb_pct": 100.0 * _safe(
            player.rebounds * team_minutes_per_side,
            minutes * (team.rebounds + opp_trb)),
        # Share of team-mates' field goals he assisted while on the floor.
        "ast_pct": 100.0 * _safe(
            player.assists,
            (minutes / team_minutes_per_side) * team.fgm - player.fgm),
        "stl_pct": 100.0 * _safe(
            player.steals * team_minutes_per_side, minutes * opp_possessions),
        "blk_pct": 100.0 * _safe(
            player.blocks * team_minutes_per_side, minutes * opp_two_pointers),
        "tov_pct": 100.0 * _safe(
            player.turnovers,
            player.fga + FT_POSSESSION_WEIGHT * player.fta + player.turnovers),
        "usg_pct": 100.0 * _safe(
            (player.fga + FT_POSSESSION_WEIGHT * player.fta + player.turnovers)
            * team_minutes_per_side,
            minutes * (team.fga + FT_POSSESSION_WEIGHT * team.fta + team.turnovers)),
        "_share": share,
    }


# --------------------------------------------------------------------------
# Player Efficiency Rating. Hollinger's, with the pace adjustment and the
# normalisation that puts the league average at 15.
# --------------------------------------------------------------------------

def unadjusted_per(player, team, ctx: LeagueContext) -> float:
    if player.minutes <= 0:
        return 0.0
    vop = ctx.value_of_possession
    drb_share = ctx.defensive_rebound_share
    factor = (2.0 / 3.0) - (0.5 * _safe(ctx.assists, ctx.fgm)) / (
        2.0 * _safe(ctx.fgm, ctx.ftm) or 1.0)
    team_assist_rate = _safe(team.assists, team.fgm)

    value = (
        player.tpm
        + (2.0 / 3.0) * player.assists
        + (2.0 - factor * team_assist_rate) * player.fgm
        + player.ftm * 0.5 * (1.0 + (1.0 - team_assist_rate)
                              + (2.0 / 3.0) * team_assist_rate)
        - vop * player.turnovers
        - vop * drb_share * (player.fga - player.fgm)
        - vop * FT_POSSESSION_WEIGHT * (0.44 + (0.56 * drb_share)) * (player.fta - player.ftm)
        + vop * (1.0 - drb_share) * player.defensive_rebounds
        + vop * drb_share * player.offensive_rebounds
        + vop * player.steals
        + vop * drb_share * player.blocks
        - player.fouls * (_safe(ctx.ftm, ctx.fouls)
                          - FT_POSSESSION_WEIGHT * _safe(ctx.fta, ctx.fouls) * vop)
    )
    return value / player.minutes


# --------------------------------------------------------------------------
# Individual offensive and defensive ratings (Dean Oliver).
# --------------------------------------------------------------------------

def offensive_rating(player, team) -> tuple[float, float]:
    """Points produced per 100 individual possessions.

    Returns (ORtg, total individual possessions), because the possession count
    is what win shares need next.
    """
    if player.minutes <= 0:
        return 0.0, 0.0

    team_scoring_possessions = (
        team.fgm + (1.0 - (1.0 - _safe(team.ftm, team.fta)) ** 2)
        * team.fta * FT_POSSESSION_WEIGHT
    )
    team_play_pct = _safe(
        team_scoring_possessions,
        team.fga + team.fta * FT_POSSESSION_WEIGHT + team.turnovers)
    team_orb_pct = _safe(
        team.offensive_rebounds,
        team.offensive_rebounds + team.opp_defensive_rebounds)
    team_orb_weight = _safe(
        (1.0 - team_orb_pct) * team_play_pct,
        (1.0 - team_orb_pct) * team_play_pct + team_orb_pct * (1.0 - team_play_pct))

    ft_pct = _safe(player.ftm, player.fta)
    q_ast = (
        (_safe(player.minutes, team.minutes / 5.0)
         * (1.14 * _safe(team.assists - player.assists, team.fgm)))
        + ((_safe(team.assists, team.minutes) * player.minutes * 5.0 - player.assists)
           / ((_safe(team.fgm, team.minutes) * player.minutes * 5.0) - player.fgm
              or 1.0))
        * (1.0 - _safe(player.minutes, team.minutes / 5.0))
    ) if team.fgm else 0.0

    fg_part = player.fgm * (
        1.0 - 0.5 * _safe(player.points - player.ftm, 2.0 * player.fga) * q_ast
    ) if player.fga else 0.0
    ast_part = 0.5 * _safe(
        (team.points - team.ftm) - (player.points - player.ftm),
        2.0 * (team.fga - player.fga)) * player.assists
    ft_part = (1.0 - (1.0 - ft_pct) ** 2) * FT_POSSESSION_WEIGHT * player.fta

    orb_part = (player.offensive_rebounds * team_orb_weight * team_play_pct)

    scoring_possessions = (
        (fg_part + ast_part + ft_part)
        * (1.0 - _safe(team.offensive_rebounds, team_scoring_possessions) * team_orb_weight
           * team_play_pct)
        + orb_part
    )

    missed_fg = (player.fga - player.fgm) * (1.0 - 1.07 * team_orb_pct)
    missed_ft = ((1.0 - ft_pct) ** 2) * FT_POSSESSION_WEIGHT * player.fta
    possessions = scoring_possessions + missed_fg + missed_ft + player.turnovers

    points_produced = (
        (fg_part + ast_part) * 2.0
        + player.tpm
        + player.ftm
        + orb_part * _safe(team.points, team_scoring_possessions or 1.0)
    )
    individual = 100.0 * _safe(points_produced, possessions)
    # Anchored toward the team the way the defensive rating is, and for the
    # same reason: an individual offensive rating is an estimate built on a
    # chain of assumptions, and left alone it produced a 68-to-146 spread where
    # a real league runs about 90 to 125. The team's own rating is not an
    # estimate at all.
    team_rating = 100.0 * _safe(team.points, team.possessions)
    return (0.65 * individual + 0.35 * team_rating, possessions)


def defensive_rating(player, team, ctx: LeagueContext) -> float:
    """Points allowed per 100 possessions with the player on the floor.

    Oliver's individual defensive rating: the team's defensive rating, moved
    by how much of the team's defensive work (stops) this player did.
    """
    if player.minutes <= 0 or team.games <= 0:
        return 0.0

    team_possessions = team.opp_possessions or team.possessions
    team_drtg = 100.0 * _safe(team.points_against, team_possessions)

    opp_fga = team.opp_fga
    opp_orb = team.opp_offensive_rebounds
    # Opponent makes are not tracked per team -- only attempts -- so they are
    # estimated at the league make rate. The alternative is another pair of
    # counters on every season line for one term of one formula.
    opp_fgm = opp_fga * _safe(ctx.fgm, ctx.fga)

    dor_pct = _safe(opp_orb, opp_orb + team.defensive_rebounds)
    dfg_pct = _safe(opp_fgm, opp_fga)
    fmwt = _safe(
        dfg_pct * (1.0 - dor_pct),
        dfg_pct * (1.0 - dor_pct) + (1.0 - dfg_pct) * dor_pct)

    stops_one = (
        player.steals
        + player.blocks * fmwt * (1.0 - 1.07 * dor_pct)
        + player.defensive_rebounds * (1.0 - fmwt)
    )
    team_minutes_per_side = team.minutes / 5.0

    # Everything the team did defensively that is not in this player's line,
    # shared out by floor time.
    stops_two = (
        _safe(((opp_fga - opp_fgm - team.blocks) / max(1.0, team_minutes_per_side))
              * fmwt * 1.07, 1.0) * player.minutes
        + _safe(team.opp_turnovers - team.steals, team_minutes_per_side) * player.minutes
    )
    stops = stops_one + stops_two
    stop_pct = _safe(stops * team_minutes_per_side, team_possessions * player.minutes)

    opp_points_per_scoring_possession = _safe(
        team.points_against,
        max(1.0, opp_fgm + (1.0 - (1.0 - _safe(ctx.ftm, ctx.fta)) ** 2)
            * team.opp_fta * FT_POSSESSION_WEIGHT))

    d_pts_per_scoring_poss = opp_points_per_scoring_possession
    individual = 100.0 * d_pts_per_scoring_poss * (1.0 - stop_pct)
    # Weighted the way Oliver does: mostly the individual figure, anchored to
    # the team's, because one player cannot be graded in isolation.
    return 0.2 * individual + 0.8 * team_drtg if individual else team_drtg


# --------------------------------------------------------------------------
# Win shares, box plus/minus, VORP.
# --------------------------------------------------------------------------

def win_shares(player, team, ctx: LeagueContext, ortg: float, possessions: float,
               drtg: float) -> tuple[float, float]:
    """(offensive win shares, defensive win shares)."""
    if player.minutes <= 0:
        return 0.0, 0.0

    pace_ratio = _safe(team_pace(team), ctx.pace) or 1.0
    marginal_points_per_win = 0.32 * ctx.points_per_game * pace_ratio
    if marginal_points_per_win <= 0:
        return 0.0, 0.0

    points_produced = ortg * possessions / 100.0
    marginal_offense = points_produced - 0.92 * ctx.points_per_possession * possessions
    ows = marginal_offense / marginal_points_per_win

    team_possessions = team.opp_possessions or team.possessions
    # Share of the team's *total* floor time, not of one player-slot: a man
    # playing 38 minutes a night is on court for about 16% of the team's 240
    # minutes, not 79% of them. Dividing by team.minutes/5 here inflated
    # defensive win shares fivefold -- a leader on 23.7 where the real record
    # is about 5.
    player_def_possessions = team_possessions * _safe(player.minutes, team.minutes)
    marginal_defense = player_def_possessions * (
        1.08 * ctx.points_per_possession - drtg / 100.0)
    dws = marginal_defense / marginal_points_per_win
    return ows, dws


def box_plus_minus(player, team, ctx: LeagueContext, ortg: float, drtg: float,
                   usg_pct: float) -> tuple[float, float]:
    """(OBPM, DBPM), before the team adjustment.

    Deliberately *not* a claim to reproduce Basketball-Reference's regression:
    its coefficients are published as fitted values this project cannot verify,
    and guessing at plausible ones would be inventing a statistic. What this
    does instead is state the idea plainly -- a player's offensive rating above
    league average, weighted by how much of the offence he was responsible for,
    and his defensive rating below league average -- both expressed per 100
    possessions, which is the scale BPM lives on.

    `team_adjust` afterwards is what makes the numbers real: it forces a team's
    minute-weighted BPM to equal its actual point differential per 100.
    """
    if player.minutes <= 0:
        return 0.0, 0.0
    league_rating = 100.0 * ctx.points_per_possession

    # Usage decides how much of the offence he is answerable for. A league
    # average player uses about a fifth of his team's possessions.
    responsibility = _safe(usg_pct, 20.0)
    obpm = (ortg - league_rating) * responsibility / 100.0
    dbpm = (league_rating - drtg) * 0.35
    return obpm, dbpm


def team_adjust(rows: list[dict], team, ctx: LeagueContext) -> None:
    """Shift a team's players so their minute-weighted BPM is the team's own.

    This is the step that turns a box-score estimate into something worth
    reading. A team outscoring the league by 6 points per 100 has six points
    of value on it somewhere; without this, the parts do not sum to the whole
    and a good player on a bad team reads the same as one on a good team.
    """
    minutes = sum(r["minutes"] for r in rows)
    if minutes <= 0 or team.games <= 0:
        return
    team_possessions = team.possessions or 1
    actual = 100.0 * (team.points - team.points_against) / team_possessions
    estimated = sum(r["bpm"] * r["minutes"] for r in rows) / minutes
    shift = actual - estimated
    for row in rows:
        row["bpm"] += shift
        # Split the correction the way the estimate was built: the offensive
        # half carries usage, so it takes the larger share of the error.
        row["obpm"] += shift * 0.6
        row["dbpm"] += shift * 0.4


def vorp(bpm: float, minutes: float, team) -> float:
    """Value over a replacement-level player, in points per 100 possessions
    over a full season."""
    if team.games <= 0:
        return 0.0
    # Share of a *player slot*, not of the team's whole 240 minutes. VORP and
    # defensive win shares genuinely use different denominators -- a starter is
    # about 16% of his team's floor time but 63% of one position's -- and using
    # the DWS one here put the league leader on 2.1 where a real MVP season is
    # nearer 10.
    minute_share = _safe(minutes, team.games * MINUTES_PER_GAME / 5.0)
    return (bpm - REPLACEMENT_LEVEL) * minute_share * (team.games / 82.0)


# --------------------------------------------------------------------------
# The table
# --------------------------------------------------------------------------

ADVANCED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("per", "PER"),
    ("orb_pct", "ORB%"),
    ("drb_pct", "DRB%"),
    ("trb_pct", "TRB%"),
    ("ast_pct", "AST%"),
    ("stl_pct", "STL%"),
    ("blk_pct", "BLK%"),
    ("tov_pct", "TOV%"),
    ("usg_pct", "USG%"),
    ("ortg", "ORtg"),
    ("drtg", "DRtg"),
    ("ows", "OWS"),
    ("dws", "DWS"),
    ("ws", "WS"),
    ("ws48", "WS/48"),
    ("bpm", "BPM"),
    ("obpm", "OBPM"),
    ("dbpm", "DBPM"),
    ("vorp", "VORP"),
)


def advanced_table(stats, minimum_games: int = 1) -> list[dict]:
    """Every player's advanced line, computed from the season totals."""
    teams = list(stats.teams.values())
    if not teams:
        return []
    ctx = league_context(teams)
    if ctx.minutes <= 0:
        return []

    by_team: dict[str, list[dict]] = {}
    rows: list[dict] = []
    _possessions: dict[str, float] = {}

    for player in stats.players.values():
        team = stats.teams.get(player.team_id)
        if team is None or player.games < minimum_games:
            continue
        rates = rate_stats(player, team)
        ortg, possessions = offensive_rating(player, team)
        drtg = defensive_rating(player, team, ctx)
        ows, dws = win_shares(player, team, ctx, ortg, possessions, drtg)
        obpm, dbpm = box_plus_minus(player, team, ctx, ortg, drtg, rates["usg_pct"])
        row = {
            "player_id": player.player_id,
            "name": player.name,
            "team_id": player.team_id,
            "position": player.position,
            "games": player.games,
            "minutes": player.minutes,
            "per": 0.0,   # filled in after the league pass
            "ortg": ortg,
            "drtg": drtg,
            "ows": ows,
            "dws": dws,
            "ws": ows + dws,
            "ws48": _safe((ows + dws) * 48.0, player.minutes),
            "obpm": obpm,
            "dbpm": dbpm,
            "bpm": obpm + dbpm,
            "_uper": unadjusted_per(player, team, ctx),
            "_pace": team_pace(team),
        }
        row.update({k: v for k, v in rates.items() if not k.startswith("_")})
        rows.append(row)
        _possessions[player.player_id] = possessions
        by_team.setdefault(player.team_id, []).append(row)

    # PER: pace-adjust, then scale the league to exactly 15.
    for row in rows:
        row["per"] = _safe(ctx.pace, row["_pace"]) * row["_uper"]
    weighted = sum(r["per"] * r["minutes"] for r in rows)
    total_minutes = sum(r["minutes"] for r in rows)
    league_per = _safe(weighted, total_minutes)
    if league_per:
        for row in rows:
            row["per"] *= PER_LEAGUE_AVERAGE / league_per

    # Anchor the ratings to team truth before anything is built on them.
    #
    # An individual ORtg is an estimate with a lot of judgement in it, and the
    # one thing that is *not* an estimate is what the team actually scored per
    # 100 possessions. Scaling each squad so its minute-weighted ratings equal
    # its real ones keeps every player's standing relative to his team-mates
    # while making the column mean something league-wide -- without it the
    # league averaged an offensive rating of 122, which no league does.
    for team_id, team_rows in by_team.items():
        team = stats.teams[team_id]
        minutes = sum(r["minutes"] for r in team_rows)
        possessions = team.possessions or 1
        if minutes <= 0:
            continue
        for key, actual in (
            ("ortg", 100.0 * team.points / possessions),
            ("drtg", 100.0 * team.points_against / (team.opp_possessions or possessions)),
        ):
            estimated = sum(r[key] * r["minutes"] for r in team_rows) / minutes
            if estimated > 0:
                scale = actual / estimated
                for row in team_rows:
                    row[key] *= scale

    # Win shares and the plus/minus pair are built on the ratings, so they are
    # rebuilt now that the ratings are anchored rather than before.
    for row in rows:
        player = stats.players[row["player_id"]]
        team = stats.teams[row["team_id"]]
        ows, dws = win_shares(player, team, ctx, row["ortg"],
                              _possessions[row["player_id"]], row["drtg"])
        row["ows"], row["dws"] = ows, dws
        row["ws"] = ows + dws
        row["ws48"] = _safe(row["ws"] * 48.0, row["minutes"])
        obpm, dbpm = box_plus_minus(player, team, ctx, row["ortg"], row["drtg"],
                                    row["usg_pct"])
        row["obpm"], row["dbpm"], row["bpm"] = obpm, dbpm, obpm + dbpm

    # BPM: make each team's parts sum to its whole, then VORP on top.
    for team_id, team_rows in by_team.items():
        team_adjust(team_rows, stats.teams[team_id], ctx)
    for row in rows:
        row["vorp"] = vorp(row["bpm"], row["minutes"], stats.teams[row["team_id"]])

    for row in rows:
        row.pop("_uper", None)
        row.pop("_pace", None)
        for key, _label in ADVANCED_COLUMNS:
            row[key] = round(row[key], 3)
        row["minutes"] = round(row["minutes"], 1)
    return rows
