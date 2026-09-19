/**
 * The season: twenty events, twenty golf courses, four of them majors.
 *
 * Every week is somewhere different, which is what makes a season a season
 * rather than three courses in rotation. The shape of it is deliberate:
 *
 *   - It opens in the desert, hot and wide, where somebody shoots 22 under and
 *     everybody decides they are in form.
 *   - The four majors sit at weeks 9, 19, 27 and 35 — far enough apart that a
 *     season has four separate peaks, and each on a completely different kind of
 *     golf course, so no single sort of player can own all of them. The Desert
 *     Championship is played at altitude on the tightest desert course on tour;
 *     The National is parkland at its most severe; the Kilbrannan Open is links
 *     golf in whatever the weather does; and Pebble Beach is Pebble Beach.
 *   - The links stretch runs from week 27 to the end, so the year finishes in
 *     the wind.
 *   - Six invitationals take the top 78 of the world ranking only, which is why
 *     a created golfer ranked 157th plays fourteen events in their first season
 *     and has to earn the other six.
 *
 * Majors are worth double points and rank four times as heavily; the Tour
 * Championship is the richest week of the year and is not one.
 */

import type { TournamentDefinition } from '../simulation/tournamentEngine';

export const SCHEDULE: readonly TournamentDefinition[] = [
  // --- The desert swing ------------------------------------------------------
  { id: 'seasonOpener', name: 'Season Opener', courseId: 'vermilion', week: 1, purse: 7_500_000, tier: 'regular', blurb: 'The longest course on tour, in 105°F, and somebody will still shoot 22 under. Nobody knows anything yet.' },
  { id: 'henderson', name: 'Spring Desert Classic', courseId: 'ocotillo', week: 3, purse: 8_000_000, tier: 'regular', blurb: 'A par 70 under 7,000 yards with greens nobody can putt. The scoring stops dead after week one.' },
  { id: 'calderaInvitational', name: 'Caldera Invitational', courseId: 'caldera', week: 5, purse: 12_000_000, tier: 'invitational', blurb: 'Seven thousand feet up, where a 7 iron goes 195 and every number in the book is wrong.' },
  { id: 'valeClassic', name: 'Vela Verde Classic', courseId: 'desert', week: 7, purse: 8_200_000, tier: 'regular', blurb: 'The traditional desert curtain-raiser, usually won at 18 under.' },

  // --- Major: the desert -----------------------------------------------------
  { id: 'desertChampionship', name: 'The Desert Championship', courseId: 'concord', week: 9, purse: 20_000_000, tier: 'major', blurb: 'The first major. Two and a half thousand feet up, the narrowest desert course on tour, and par is a very good score.' },

  { id: 'moabOpen', name: 'Moab Open', courseId: 'redbutte', week: 11, purse: 8_400_000, tier: 'regular', blurb: 'Corridors cut through sandstone. Miss the fairway and you are not playing a golf shot, you are taking a drop.' },
  { id: 'bayouClassic', name: 'Bayou Classic', courseId: 'blackwater', week: 13, purse: 8_000_000, tier: 'regular', blurb: 'Flat, wet and ninety-five per cent humidity. Nothing runs and nothing is downhill.' },
  { id: 'ranchInvitational', name: 'The Ranch Invitational', courseId: 'ranch', week: 15, purse: 12_000_000, tier: 'invitational', blurb: 'Limited field on a course traced hole by hole off the club’s own overheads. The real thing, to the yard.' },
  { id: 'blueRidgeOpen', name: 'Blue Ridge Open', courseId: 'cascade', week: 17, purse: 9_000_000, tier: 'regular', blurb: 'Mountain parkland with a river through eleven holes. A two-shot lead here is not a lead.' },

  // --- Major: parkland -------------------------------------------------------
  { id: 'nationalChampionship', name: 'The National', courseId: 'woodland', week: 19, purse: 20_000_000, tier: 'major', blurb: 'The second major. Woodland at its most severe: narrow, wet, long, and par is a score.' },

  { id: 'deschutesOpen', name: 'Deschutes Open', courseId: 'thornwood', week: 21, purse: 8_600_000, tier: 'regular', blurb: 'Eighteen corridors through two-hundred-foot firs. There is no recovery shot here, only a punch-out.' },
  { id: 'kingsmoorInvitational', name: 'The Kingsmoor Invitational', courseId: 'kingsmoor', week: 23, purse: 13_000_000, tier: 'invitational', blurb: 'Laid out in 1823 and barely touched since. Fifteen-yard greens, blind approaches and stone walls that are out of bounds.' },
  { id: 'ashbourneOpen', name: 'Ashbourne Open', courseId: 'ashbourne', week: 25, purse: 8_800_000, tier: 'regular', blurb: 'Heather, gorse and sandy ground. A par 70 that has never given up a four-round total under 265.' },

  // --- Major: links ----------------------------------------------------------
  { id: 'kilbrannanOpen', name: 'The Kilbrannan Open', courseId: 'kilbrannan', week: 27, purse: 20_000_000, tier: 'major', blurb: 'The third major, and the oldest championship in the game. A hundred and forty-seven bunkers, no trees, and whatever the weather decides.' },

  { id: 'thornmouthClassic', name: 'Thornmouth Classic', courseId: 'thornmouth', week: 29, purse: 8_500_000, tier: 'regular', blurb: 'Shared fairways, double greens and a road behind the 17th. Four hundred years of golf and none of it fair.' },
  { id: 'carrickmoorInvitational', name: 'Carrickmoor Invitational', courseId: 'carrickmoor', week: 31, purse: 12_000_000, tier: 'invitational', blurb: 'The links everybody wants to play: wide, rumpled and receptive, with three drivable par 4s.' },
  { id: 'saltmarshOpen', name: 'Saltmarsh Open', courseId: 'saltmarsh', week: 33, purse: 8_200_000, tier: 'regular', blurb: 'Under 6,900 yards, tidal creeks on nine holes and the smallest greens on tour. Nobody has ever taken it apart.' },

  // --- Major: Pebble Beach ---------------------------------------------------
  { id: 'pebbleChampionship', name: 'The Pebble Beach Championship', courseId: 'pebble', week: 35, purse: 22_000_000, tier: 'major', blurb: 'The fourth and final major, on the cliffs. The 7th is 106 yards and the 8th is the best second shot in golf.' },

  { id: 'playoffOpener', name: 'Playoff Opener', courseId: 'dunmorra', week: 37, purse: 15_000_000, tier: 'invitational', blurb: 'Points are doubled from here, among eighty-foot dunes with nine blind tee shots. The season narrows.' },
  { id: 'tourChampionship', name: 'Tour Championship', courseId: 'coastal', week: 39, purse: 25_000_000, tier: 'invitational', blurb: 'Not a major, but the richest week of the year, and the one that names the Player of the Year.' },
];
