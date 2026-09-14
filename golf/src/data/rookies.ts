/**
 * New players joining the tour.
 *
 * When somebody retires the field has to stay at fifty, so a rookie comes up.
 * They are generated the same way the original fifty were — a level, an
 * archetype, a country, a potential — so a graduate is just another golfer, not
 * a special case the rest of the engine has to know about.
 */

import { buildGolfer } from './golfers';
import { type Rng } from '../simulation/rng';
import type { ArchetypeId, Golfer } from '../simulation/types';

interface Region {
  country: string;
  flag: string;
  first: string[];
  last: string[];
}

const REGIONS: Region[] = [
  { country: 'United States', flag: '🇺🇸', first: ['Brooks', 'Tanner', 'Wyatt', 'Chase', 'Grady', 'Beau', 'Colt', 'Hayden', 'Preston', 'Sawyer'], last: ['Whitlock', 'Kendrick', 'Marsden', 'Holloway', 'Draper', 'Calloway', 'Rennick', 'Stapleton', 'Vance', 'Bradshaw'] },
  { country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', first: ['Ollie', 'Harvey', 'Freddie', 'Jonty', 'Rufus', 'Alfie', 'Digby', 'Seb'], last: ['Ashworth', 'Fenwick', 'Braithwaite', 'Pemberly', 'Radcliffe', 'Thorne', 'Galloway', 'Winterbourne'] },
  { country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', first: ['Angus', 'Fraser', 'Lachlan', 'Struan', 'Ewan', 'Kenneth'], last: ['Macrae', 'Strathearn', 'Kinnaird', 'Dunbarry', 'Lockhart', 'Crichton'] },
  { country: 'Ireland', flag: '🇮🇪', first: ['Cillian', 'Oisín', 'Darragh', 'Fionn', 'Eoghan'], last: ["O'Halloran", 'Kilbride', 'Mulvaney', 'Devereux', 'Lanigan'] },
  { country: 'Australia', flag: '🇦🇺', first: ['Jarrah', 'Kip', 'Lockie', 'Baxter', 'Darcy'], last: ['Kirkbride', 'Hollingdale', 'Tamworth', 'Mundine', 'Carrick'] },
  { country: 'South Africa', flag: '🇿🇦', first: ['Ruan', 'Jaco', 'Sipho', 'Werner', 'Lehlohonolo'], last: ['Vorster', 'Nkosi', 'Bekker', 'Mthembu', 'Steenkamp'] },
  { country: 'Japan', flag: '🇯🇵', first: ['Haruto', 'Ren', 'Sota', 'Yuma', 'Riku'], last: ['Kurosawa', 'Tachibana', 'Minamoto', 'Hoshino', 'Sakaguchi'] },
  { country: 'South Korea', flag: '🇰🇷', first: ['Min-jun', 'Ji-hoon', 'Do-yun', 'Seo-jun', 'Eun-woo'], last: ['Hwang', 'Jeong', 'Moon', 'Seo', 'Yun'] },
  { country: 'Spain', flag: '🇪🇸', first: ['Álvaro', 'Nico', 'Iker', 'Pau', 'Mateo'], last: ['Arrizabalaga', 'Cifuentes', 'Ferreras', 'Olmedo', 'Zabaleta'] },
  { country: 'Sweden', flag: '🇸🇪', first: ['Elias', 'Viggo', 'Albin', 'Nils', 'Måns'], last: ['Sjöberg', 'Hedlund', 'Åkerman', 'Wikström', 'Norling'] },
  { country: 'Germany', flag: '🇩🇪', first: ['Jonas', 'Lennart', 'Tobias', 'Moritz', 'Emil'], last: ['Baumgartner', 'Reinhardt', 'Hoffmeister', 'Schwarzer', 'Kellermann'] },
  { country: 'France', flag: '🇫🇷', first: ['Théo', 'Corentin', 'Baptiste', 'Lucien', 'Émile'], last: ['Lemoine', 'Dufresne', 'Vasseur', 'Chastain', 'Brossard'] },
  { country: 'Argentina', flag: '🇦🇷', first: ['Ignacio', 'Tomás', 'Lautaro', 'Bruno', 'Facundo'], last: ['Quintanilla', 'Arrieta', 'Bustamante', 'Zubeldía', 'Calvente'] },
  { country: 'Canada', flag: '🇨🇦', first: ['Dax', 'Rowan', 'Emerson', 'Bennett', 'Cormac'], last: ['Lafontaine', 'Beauchamp', 'Tremblay', 'Ironside', 'Wheelock'] },
  { country: 'India', flag: '🇮🇳', first: ['Arjun', 'Vihaan', 'Kabir', 'Rohan', 'Aditya'], last: ['Venkatesan', 'Bhattacharya', 'Ramanathan', 'Deshmukh', 'Kulkarni'] },
  { country: 'Thailand', flag: '🇹🇭', first: ['Anon', 'Kiat', 'Somchai', 'Narong'], last: ['Ratanakul', 'Chaiyaphum', 'Wongwan', 'Suthichai'] },
  { country: 'Denmark', flag: '🇩🇰', first: ['Magnus', 'Villads', 'Asger', 'Frode'], last: ['Kjeldsen', 'Holmgaard', 'Brandt-Nielsen', 'Vestergaard'] },
  { country: 'New Zealand', flag: '🇳🇿', first: ['Tane', 'Cooper', 'Reuben', 'Finlay'], last: ['Whitcombe', 'Ngatai', 'Marlowe', 'Ashcroft'] },
];

const ARCHETYPES: ArchetypeId[] = [
  'prospect', 'prospect', 'power', 'bomber', 'precision', 'ballStriker',
  'shortGame', 'elitePutter', 'allRounder', 'grinder', 'scrambler', 'volatile',
  'windSpecialist', 'courseManager',
];

const PERSONALITIES = [
  'Quiet and businesslike, and completely unintimidated by the names on the leaderboard.',
  'Talks a lot, mostly to himself, and hits it further than anyone expects.',
  'Serious, technical and already dressed like a twenty-year veteran.',
  'Openly delighted to be here, which the galleries have noticed.',
  'Watchful and a little guarded. Gives away nothing on the course.',
  'Plays fast, walks faster, and has never laid up in his life.',
  'Studious. Keeps notes on every green he putts on.',
  'Cheerfully reckless. Will hit driver anywhere.',
];

const STYLES = [
  'Aggressive off the tee and prepared to live with the consequences.',
  'Positional golf, wedge play and a lot of pars.',
  'Long, high and still learning where the trouble is.',
  'Grinds out a score whatever the round is doing.',
  'Creative around the greens and inconsistent everywhere else.',
  'Metronomic. Fairway, green, two putts.',
];

const WEAKNESSES = [
  'Course management. Nobody has told him where not to go yet.',
  'Putting under pressure. The stroke gets quick.',
  'Wedge play from awkward distances.',
  'Long irons. He has no reliable shot from 200 yards.',
  'Consistency. The bad rounds are still very bad.',
  'Temperament. One bad break can cost him three holes.',
];

const CONDITIONS_PREF = [
  'Soft courses where he can fly the ball at flags.',
  'Firm and fast, with the ground helping.',
  'Heat. It never seems to bother him.',
  'Cool, still mornings.',
  'Wind — he grew up playing in it.',
];

/** A tour graduate. Good enough to be here, not yet good enough to matter. */
export function createRookie(rng: Rng, season: number, index: number): Golfer {
  const region = rng.pick(REGIONS);
  const name = `${rng.pick(region.first)} ${rng.pick(region.last)}`;
  const archetype = rng.pick(ARCHETYPES);
  const age = rng.int(20, 25);
  // Most graduates are fringe players. A few are something else entirely.
  const roll = rng.next();
  const level = roll < 0.6 ? rng.range(54, 62) : roll < 0.92 ? rng.range(62, 69) : rng.range(69, 75);
  const potential = clampRange(level + rng.range(8, 34) - (age - 20) * 1.6, level + 2, 97);

  return buildGolfer({
    id: `rookie-${season}-${index}`,
    name,
    country: region.country,
    flag: region.flag,
    age,
    archetype,
    level: Math.round(level),
    potential: Math.round(potential),
    personality: rng.pick(PERSONALITIES),
    playingStyle: rng.pick(STYLES),
    preferredConditions: rng.pick(CONDITIONS_PREF),
    weakness: rng.pick(WEAKNESSES),
    career: { wins: 0, majors: 0, seasons: 1 },
  });
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
