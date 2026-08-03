"""Two conferences, fifteen clubs each.

The shipped roster already had a `conference` field and it was a coin flip --
seventeen East, thirteen West, with the Eastport Mariners in the West. This
replaces it with a real split.

Membership is **derived, not saved**. It is keyed by abbreviation and lives
here, the same way `logos.py` holds the crests, so the frozen `data/league.json`
never has to change and a save written before conferences existed still loads
into the right league. `save.py` stores what happened, not how the league is
organised.

The two names come from what the clubs actually are. The nicknames split
cleanly down a line that runs through the middle of the league: forges,
foundries, mines, ridges, timber and the animals that live in it on one side;
harbours, tides, gales, anchors and everything that navigates by them on the
other.

    IRONRIDGE   inland, industrial, mountain, forest
    TIDEWATER   coastal, maritime, weather, sky

They meet in the **Keystone Finals** -- the keystone being the stone at the top
of an arch that carries the load of both halves and without which neither
stands. Two conferences, one wedge holding them together, and the club that
wins it lifts the Keystone Trophy.
"""

from __future__ import annotations

IRONRIDGE = "Ironridge"
TIDEWATER = "Tidewater"

CONFERENCES: tuple[str, str] = (IRONRIDGE, TIDEWATER)

# The championship, and what the winner lifts.
FINALS_NAME = "Keystone Finals"
TROPHY_NAME = "Keystone Trophy"
CHAMPION_TITLE = "Keystone Champions"

CONFERENCE_OF: dict[str, str] = {
    # Ironridge -- inland, industrial, mountain, forest.
    "NCI": IRONRIDGE,  # North City Ironworks
    "SRM": IRONRIDGE,  # Southridge Miners
    "RBF": IRONRIDGE,  # Riverbend Foundry
    "IVF": IRONRIDGE,  # Ironvale Forge
    "HLS": IRONRIDGE,  # Highland Stags
    "SRP": IRONRIDGE,  # Summit Ridge Peaks
    "CFT": IRONRIDGE,  # Cedar Falls Timber
    "AVF": IRONRIDGE,  # Autumn Valley Foxes
    "CFC": IRONRIDGE,  # Copperfield Coyotes
    "THW": IRONRIDGE,  # Thornwood Hawks
    "ACB": IRONRIDGE,  # Alder Creek Bruins
    "STG": IRONRIDGE,  # Stonegate Guardians
    "OKO": IRONRIDGE,  # Oakhaven Owls
    "FRF": IRONRIDGE,  # Falconridge Falcons
    "RSR": IRONRIDGE,  # Redstone Rangers
    # Tidewater -- coastal, maritime, weather, sky.
    "EPM": TIDEWATER,  # Eastport Mariners
    "LSC": TIDEWATER,  # Lakeside Current
    "CHG": TIDEWATER,  # Cape Harbor Gulls
    "PUA": TIDEWATER,  # Port Union Anchors
    "BWT": TIDEWATER,  # Brightwater Tides
    "CBS": TIDEWATER,  # Crescent Bay Surge
    "GPS": TIDEWATER,  # Gale Point Storm
    "WMC": TIDEWATER,  # Windmere Cyclones
    "SLC": TIDEWATER,  # Silverlake Comets
    "GVS": TIDEWATER,  # Grandview Skyline
    "KBR": TIDEWATER,  # Kingsbridge Royals
    "MHM": TIDEWATER,  # Marble Heights Monarchs
    "WFR": TIDEWATER,  # Westfield Rovers
    "FBS": TIDEWATER,  # Fort Bellamy Sentinels
    "NMP": TIDEWATER,  # New Meridian Pioneers
}

# An expansion club, or real data loaded over the placeholders, has to land
# somewhere rather than vanish from the standings.
FALLBACK_CONFERENCE = IRONRIDGE


def conference_for(abbreviation: str) -> str:
    return CONFERENCE_OF.get(abbreviation, FALLBACK_CONFERENCE)


def stamp(teams) -> None:
    """Write the canonical conference onto each team.

    Called once when a roster is loaded. `Team.conference` stays the field
    everything reads; this makes sure what it holds is this file's answer and
    not whatever a stale save happened to carry.
    """
    for team in teams:
        team.conference = conference_for(team.abbreviation)


def split(teams) -> dict[str, list]:
    """Teams grouped by conference, in the order given."""
    grouped: dict[str, list] = {name: [] for name in CONFERENCES}
    for team in teams:
        grouped.setdefault(conference_for(team.abbreviation), []).append(team)
    return grouped
