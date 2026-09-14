/**
 * The season: twenty events across the three venues.
 *
 * The tour only has three golf courses, so each one hosts several events a year
 * — different weeks, different weather, different pin sheets, different purses.
 * Four of the twenty are majors, which are worth double points and reliably
 * play two shots harder because of where they sit in the calendar.
 */

import type { TournamentDefinition } from '../simulation/tournamentEngine';

export const SCHEDULE: readonly TournamentDefinition[] = [
  { id: 'seasonOpener', name: 'Season Opener', courseId: 'desert', week: 1, purse: 7_500_000, tier: 'regular', blurb: 'Everybody arrives fresh and nobody knows anything yet.' },
  { id: 'valeClassic', name: 'Vela Verde Classic', courseId: 'desert', week: 3, purse: 8_200_000, tier: 'regular', blurb: 'The traditional desert curtain-raiser, usually won at 18 under.' },
  { id: 'headlandInvitational', name: 'Headland Invitational', courseId: 'coastal', week: 5, purse: 12_000_000, tier: 'invitational', blurb: 'Limited field, no cut fears for the elite, and a forecast nobody trusts.' },
  { id: 'hollisbrookOpen', name: 'Hollisbrook Open', courseId: 'woodland', week: 7, purse: 8_800_000, tier: 'regular', blurb: 'Narrow, wet and long. The straight hitters circle this one.' },
  { id: 'coastalOpen', name: 'The Coastal Open', courseId: 'coastal', week: 9, purse: 20_000_000, tier: 'major', blurb: 'The first major. Links golf, full exposure, and the wind decides.' },
  { id: 'desertShootout', name: 'Desert Shootout', courseId: 'desert', week: 11, purse: 8_000_000, tier: 'regular', blurb: 'A birdie-fest in 100°F heat. Endurance matters more than anybody admits.' },
  { id: 'pinesChampionship', name: 'Pines Championship', courseId: 'woodland', week: 13, purse: 9_500_000, tier: 'invitational', blurb: 'Small greens, tucked pins and the best scrambling week of the year.' },
  { id: 'nationalChampionship', name: 'The National', courseId: 'woodland', week: 15, purse: 20_000_000, tier: 'major', blurb: 'The second major. Woodland at its most severe: par is a score.' },
  { id: 'ardmoreClassic', name: 'Ardmore Classic', courseId: 'coastal', week: 17, purse: 8_400_000, tier: 'regular', blurb: 'Early-summer links golf, firm and fast, with the ground doing the work.' },
  { id: 'mesaInvitational', name: 'Mesa Invitational', courseId: 'desert', week: 19, purse: 12_000_000, tier: 'invitational', blurb: 'The longest setup of the year. The bombers have this circled.' },
  { id: 'desertChampionship', name: 'Desert Championship', courseId: 'desert', week: 21, purse: 20_000_000, tier: 'major', blurb: 'The third major, played in the hottest week of the calendar.' },
  { id: 'keepersTrophy', name: "Keeper's Trophy", courseId: 'woodland', week: 23, purse: 8_200_000, tier: 'regular', blurb: 'A quiet week in the trees that has launched three careers.' },
  { id: 'northShore', name: 'North Shore Open', courseId: 'coastal', week: 25, purse: 8_600_000, tier: 'regular', blurb: 'Two-club wind most years. Not everybody enters.' },
  { id: 'summitClassic', name: 'Summit Classic', courseId: 'desert', week: 27, purse: 9_000_000, tier: 'regular', blurb: 'Elevation, heat and a closing stretch beside the water.' },
  { id: 'hollisbrookMasters', name: 'Hollisbrook Masters', courseId: 'woodland', week: 29, purse: 13_000_000, tier: 'invitational', blurb: 'The best field of the regular season outside the majors.' },
  { id: 'linksChampionship', name: 'Links Championship', courseId: 'coastal', week: 31, purse: 20_000_000, tier: 'major', blurb: 'The final major. Four rounds on the headland with the claret on the line.' },
  { id: 'autumnOpen', name: 'Autumn Open', courseId: 'woodland', week: 33, purse: 8_000_000, tier: 'regular', blurb: 'Cold mornings, soft ground, and a last chance to keep a card.' },
  { id: 'desertFinal', name: 'Desert Final', courseId: 'desert', week: 35, purse: 8_500_000, tier: 'regular', blurb: 'The last full-field event before the playoffs.' },
  { id: 'playoffOpener', name: 'Playoff Opener', courseId: 'coastal', week: 37, purse: 15_000_000, tier: 'invitational', blurb: 'Points are doubled from here. The season narrows.' },
  { id: 'tourChampionship', name: 'Tour Championship', courseId: 'woodland', week: 39, purse: 25_000_000, tier: 'major', blurb: 'The last event of the year, and the one that names the Player of the Year.' },
];
