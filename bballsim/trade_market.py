"""The trade market: front offices that do their own business.

`trades.py` can evaluate an offer and find one worth making. This is what
actually runs it — nobody proposes anything by hand. Clubs go shopping on their
own cadence through the season, agree deals with each other, and the manager
watches it happen.

**The one lever is a veto.** A trade the engine is about to make sits *pending*
for a short window before it completes, so if the logic has produced something
absurd there is a button that stops it. That is the only human input in the
system, and it is deliberately an override rather than an approval step: a
pending trade with nobody watching goes through. The alternative — requiring
approval — would mean a league left running quietly does nothing at all, which
is the opposite of front offices managing themselves.

**Why a pending window rather than a rollback.** Undoing a completed trade
means restoring depth charts, pair chemistry and pick ownership that other
code has already moved on from, and a half-restored league is worse than a bad
trade. Holding the deal for a day costs nothing and makes the veto exact.

**Cost control is the whole engineering problem here.** `tick` runs on every
API request, and a full trade search is seconds per club. So the market opens
on a *league-day* cadence rather than per tick, looks at a couple of clubs each
time, and searches with a tighter budget than an interactive search would. The
work per opening is bounded and small; the league still turns over properly
because the openings accumulate across a season.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import timedelta

from . import front_office as FO
from . import trades
from .engine.rng import seed_from_string

# How often the market opens, in league days. Every opening costs a bounded
# amount of search, so this is the dial that decides how much of a tick the
# trade engine is allowed to be.
MARKET_INTERVAL_DAYS = 3

# How many clubs go shopping per opening, and how hard each looks. Both are
# deliberately smaller than an interactive search: this runs inside a request.
CLUBS_PER_OPENING = 2
DEALS_PER_CLUB = 1

# How long a deal sits pending before it completes. One league day: long enough
# that a manager watching can stop it, short enough that the league does not
# fill up with deals waiting on somebody.
PENDING_DAYS = 1

# A club that has just traded does not trade again immediately.
COOLDOWN_DAYS = 6

# How many completed trades to keep. A season of thirty clubs produces a lot
# and the screen only ever shows the recent ones.
LOG_LIMIT = 120


@dataclass
class PendingTrade:
    """A deal both clubs have agreed, waiting out its window."""

    id: str
    offer: trades.Offer
    proposed_at: object          # datetime
    decide_after: object         # datetime
    summary: dict = field(default_factory=dict)
    status: str = "pending"      # pending | done | vetoed
    vetoed_reason: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "proposedAt": self.proposed_at.isoformat() if self.proposed_at else None,
            "decideAfter": self.decide_after.isoformat() if self.decide_after else None,
            "vetoedReason": self.vetoed_reason,
            **self.summary,
        }


@dataclass
class Market:
    """The league's trade activity. Saved with the season."""

    last_opened: object | None = None       # datetime
    pending: list[PendingTrade] = field(default_factory=list)
    completed: list[dict] = field(default_factory=list)
    vetoed: list[dict] = field(default_factory=list)
    # Club id -> the datetime it may trade again.
    cooldowns: dict[str, object] = field(default_factory=dict)
    # Deals a manager has stopped. Kept so the engine does not immediately
    # re-propose the identical trade on the next opening, which would make the
    # veto button feel broken.
    blocked: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "pending": [p.to_dict() for p in self.pending],
            "completed": list(self.completed[-LOG_LIMIT:]),
            "vetoed": list(self.vetoed[-30:]),
            "lastOpened": self.last_opened.isoformat() if self.last_opened else None,
        }


def state(league) -> Market:
    """The league's market, created on first ask."""
    existing = getattr(league, "trade_market", None)
    if isinstance(existing, Market):
        return existing
    made = Market()
    league.trade_market = made
    return made


def _fingerprint(offer: trades.Offer) -> str:
    """A stable id for a deal, so a vetoed one can be recognised again."""
    parts = []
    for package in (offer.sending, offer.receiving):
        picks = ",".join(sorted(f"{p.year}-{p.round}-{p.original_team}"
                                for p in package.picks))
        parts.append(f"{package.team_id}:{','.join(sorted(package.player_ids))}:{picks}")
    return "|".join(sorted(parts))


# --------------------------------------------------------------------------
# Opening the market
# --------------------------------------------------------------------------

def is_due(league, now) -> bool:
    """Whether enough league time has passed to go shopping again."""
    market = state(league)
    if market.last_opened is None:
        return True
    return now - market.last_opened >= timedelta(days=MARKET_INTERVAL_DAYS)


def motivation(league, team) -> float:
    """How keen this club is to do something, 0-1.

    Aggressiveness is the base, sharpened by the deadline: the brief asks for
    contenders to get keener and sellers more willing as it approaches, and
    both fall out of multiplying one by the other.
    """
    situation = FO.situation(league, team)
    ident = situation.identity
    keen = ident.aggressiveness / 100.0
    pressure = trades.deadline_pressure(league)
    if situation.timeline.buying or situation.timeline.selling:
        keen *= 1.0 + pressure * 0.8
    else:
        # The brief's "bubble teams become unpredictable" -- a club in the
        # middle is as likely to buy as sell and so does less of either.
        keen *= 1.0 - pressure * 0.25
    return max(0.0, min(1.0, keen))


def shoppers(league, now) -> list:
    """Which clubs go looking this time.

    Weighted by motivation and drawn from the date, so it is deterministic --
    the same league at the same moment always sends the same clubs shopping --
    and rotating, so it is not the same two aggressive clubs every opening.
    """
    market = state(league)
    available = [t for t in league.teams.values()
                 if market.cooldowns.get(t.id) is None
                 or market.cooldowns[t.id] <= now]
    if not available:
        return []
    rng = random.Random(seed_from_string(f"market-{now.date().isoformat()}"))
    weights = [max(0.02, motivation(league, t)) for t in available]
    picked: list = []
    pool = list(zip(available, weights))
    for _ in range(min(CLUBS_PER_OPENING, len(pool))):
        total = sum(w for _t, w in pool)
        mark = rng.random() * total
        for index, (team, weight) in enumerate(pool):
            mark -= weight
            if mark <= 0:
                picked.append(team)
                pool.pop(index)
                break
    return picked


def open_market(league, now) -> list[PendingTrade]:
    """Run one market opening. Returns the deals newly put on the table."""
    market = state(league)
    market.last_opened = now

    # Anything whose window has passed completes first, so a deal never waits
    # two openings.
    settle(league, now)

    blocked = set(market.blocked)
    pending_ids = {p.id for p in market.pending}
    made: list[PendingTrade] = []

    for team in shoppers(league, now):
        found = trades.find_trades(league, team.id, limit=DEALS_PER_CLUB,
                                   max_partners=MARKET_PARTNERS,
                                   max_targets=MARKET_TARGETS,
                                   max_pieces=MARKET_PIECES)
        for deal in found:
            offer = deal["_offer"]
            key = _fingerprint(offer)
            if key in blocked or key in pending_ids:
                continue
            partner_id = offer.receiving.team_id
            if market.cooldowns.get(partner_id) and market.cooldowns[partner_id] > now:
                continue

            entry = PendingTrade(
                id=key,
                offer=offer,
                proposed_at=now,
                decide_after=now + timedelta(days=PENDING_DAYS),
                summary=describe(league, offer, deal),
            )
            market.pending.append(entry)
            pending_ids.add(key)
            made.append(entry)
            # Both clubs are busy for a while.
            for tid in (team.id, partner_id):
                market.cooldowns[tid] = now + timedelta(days=COOLDOWN_DAYS)
            break
    return made


# The market's own search budget, tighter than an interactive one because this
# runs inside `tick`, which runs on every API request.
MARKET_PARTNERS = 6
MARKET_TARGETS = 3
MARKET_PIECES = 3


def settle(league, now) -> list[dict]:
    """Complete every pending deal whose window has passed.

    A pending trade with nobody watching goes through. That is the design: the
    veto is an override, not an approval step.
    """
    market = state(league)
    done: list[dict] = []
    still_waiting: list[PendingTrade] = []

    for entry in market.pending:
        if entry.status != "pending" or entry.decide_after > now:
            still_waiting.append(entry)
            continue
        # Re-check: the league has moved since this was agreed, and a deal that
        # is no longer legal (a roster changed, a pick moved) must not fire.
        legality = trades.check_legality(league, entry.offer)
        if not legality.legal:
            entry.status = "vetoed"
            entry.vetoed_reason = "no longer legal: " + "; ".join(legality.reasons)
            market.vetoed.append(entry.to_dict())
            continue

        result = trades.execute(league, entry.offer)
        if result.get("done"):
            entry.status = "done"
            record = dict(entry.summary)
            record.update({"id": entry.id, "completedAt": now.isoformat()})
            market.completed.append(record)
            done.append(record)
        else:
            entry.status = "vetoed"
            entry.vetoed_reason = "; ".join(result.get("reasons", ["could not execute"]))
            market.vetoed.append(entry.to_dict())

    market.pending = still_waiting
    if len(market.completed) > LOG_LIMIT:
        del market.completed[:-LOG_LIMIT]
    return done


def veto(league, trade_id: str, reason: str = "vetoed by the manager") -> dict:
    """Stop a pending trade. The one place a human touches this system.

    The deal is also remembered so the engine does not simply re-propose the
    identical thing at the next opening, which would make the button feel like
    it had not worked.
    """
    market = state(league)
    for entry in market.pending:
        if entry.id != trade_id:
            continue
        entry.status = "vetoed"
        entry.vetoed_reason = reason
        market.vetoed.append(entry.to_dict())
        market.pending = [p for p in market.pending if p.id != trade_id]
        if trade_id not in market.blocked:
            market.blocked.append(trade_id)
        return {"vetoed": True, "id": trade_id}
    return {"vetoed": False, "error": "not a pending trade", "id": trade_id}


# --------------------------------------------------------------------------
# Describing a deal
# --------------------------------------------------------------------------

def describe(league, offer: trades.Offer, deal: dict | None = None) -> dict:
    """Everything a screen needs about one trade, including both sides' reasons."""
    from .negotiation import format_money

    sending = league.teams.get(offer.sending.team_id)
    receiving = league.teams.get(offer.receiving.team_id)
    out_players = trades.players_of(league, offer.sending)
    in_players = trades.players_of(league, offer.receiving)

    if deal is not None:
        ours, theirs = deal.get("ourReasoning", ""), deal.get("theirReasoning", "")
        our_score, their_score = deal.get("ourScore", 0.0), deal.get("theirScore", 0.0)
    else:
        assessment = trades.assess(league, offer)
        a = assessment["sides"][offer.sending.team_id]
        b = assessment["sides"][offer.receiving.team_id]
        ours, theirs = a["reasoning"], b["reasoning"]
        our_score, their_score = a["score"], b["score"]

    def side(team, players, picks, reasoning, score):
        situation = FO.situation(league, team)
        return {
            "teamId": team.id,
            "abbr": team.abbreviation,
            "name": team.full_name,
            "timeline": situation.timeline.label,
            "window": round(situation.window, 1),
            "sends": [
                {"playerId": p.id, "name": p.name, "position": p.position.value,
                 "age": p.age, "overall": p.overall,
                 "salary": trades.payroll.salary_of(p)}
                for p in players
            ],
            "sendsPicks": [p.to_dict() for p in picks],
            "salaryOut": trades.salary_of(players),
            "reasoning": reasoning,
            "score": round(score, 4),
        }

    return {
        "sides": [
            side(sending, out_players, offer.sending.picks, ours, our_score),
            side(receiving, in_players, offer.receiving.picks, theirs, their_score),
        ],
        "headline": headline(sending, receiving, out_players, in_players,
                             offer.sending.picks, offer.receiving.picks),
        "salarySwing": format_money(abs(trades.salary_of(out_players)
                                        - trades.salary_of(in_players))),
        "offer": offer.to_dict(),
    }


def headline(sending, receiving, out_players, in_players,
             out_picks, in_picks) -> str:
    """One line: who got what."""
    def piece(players, picks) -> str:
        names = [p.name for p in players]
        if picks:
            names.append(f"{len(picks)} pick" + ("s" if len(picks) > 1 else ""))
        return " and ".join(names) if names else "cash considerations"

    return (f"{receiving.abbreviation} get {piece(out_players, out_picks)}; "
            f"{sending.abbreviation} get {piece(in_players, in_picks)}")


# --------------------------------------------------------------------------
# The hook
# --------------------------------------------------------------------------

def run(league) -> list[PendingTrade]:
    """Called from `League.tick`. Cheap unless the market is actually due.

    The guard matters more than it looks: `tick` fires on every API request,
    and a full trade search is seconds. Everything expensive sits behind
    `is_due`, so the ordinary tick costs one datetime comparison.
    """
    if not getattr(league, "trades_enabled", True):
        return []
    now = league.clock.now()
    market = state(league)
    if market.pending:
        settle(league, now)
    if not is_due(league, now):
        return []
    return open_market(league, now)
