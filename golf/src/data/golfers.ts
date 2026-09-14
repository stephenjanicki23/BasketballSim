/**
 * The tour: fifty golfers, none of them real.
 *
 * Each one is authored as a *seed* — a level, an archetype, an age, a
 * personality and the handful of ratings that define them specifically — and the
 * builder below fills in the rest. That keeps every player distinct without
 * hand-typing thirty numbers fifty times, and it means "elite putter" is a fact
 * about the golfer rather than a label on a spreadsheet.
 *
 * Distribution: 5 elite, 10 very good, 15 solid tour players, 10 average,
 * 7 fringe and 3 high-potential prospects.
 */

import {
  ARCHETYPES, PUTTING_STYLES, blankRatings, currentAbility, emptyCareer, emptySeason,
} from '../simulation/golferEngine';
import { clamp, createRng } from '../simulation/rng';
import type { ArchetypeId, Golfer, PuttingStyleId, RatingKey, Ratings } from '../simulation/types';

export interface GolferSeed {
  id: string;
  name: string;
  country: string;
  flag: string;
  age: number;
  archetype: ArchetypeId;
  puttingStyle: PuttingStyleId;
  /** Base rating level, 1–100, before archetype and age. */
  level: number;
  potential: number;
  personality: string;
  playingStyle: string;
  preferredConditions: string;
  weakness: string;
  /** Ratings that are true of this golfer specifically, not of their archetype. */
  overrides?: Partial<Ratings>;
  career?: { wins?: number; majors?: number; seasons?: number };
}

const SEEDS: GolferSeed[] = [
  // ---------------------------------------------------------------- elite (5)
  {
    id: 'vandehey', name: 'Marcus Vandehey', country: 'United States', flag: '🇺🇸', age: 29,
    archetype: 'allRounder', puttingStyle: 'clutch', level: 88, potential: 94,
    personality: 'Unhurried and faintly bored, as though the tournament is a formality he has agreed to attend.',
    playingStyle: 'Plays the middle of the green until the back nine on Sunday, then takes the flag on.',
    preferredConditions: 'Indifferent. Has won in 30 mph wind and in 104°F heat in the same season.',
    weakness: 'Occasionally loses interest in a week he cannot win, and misses a cut he had no business missing.',
    overrides: { greenReading: 84, speedControl: 86, lagPutting: 84, composure: 95, consistency: 90, midIron: 92, putting: 86, clutch: 92, decisionMaking: 91 },
    career: { wins: 19, majors: 4, seasons: 8 },
  },
  {
    id: 'shirakawa', name: 'Kaito Shirakawa', country: 'Japan', flag: '🇯🇵', age: 31,
    archetype: 'precision', puttingStyle: 'technician', level: 86, potential: 89,
    personality: 'Meticulous to the point of ritual. Marks his ball with the same coin, always the same way up.',
    playingStyle: 'Hits 3 wood off half the tees and 65% of fairways, then picks greens apart with wedges.',
    preferredConditions: 'Tight, tree-lined golf courses where driver is the wrong club.',
    weakness: 'On a long, wide course he is giving away forty yards a hole and cannot get it back.',
    overrides: { speedControl: 90, greenReading: 86, driverAccuracy: 96, wedgeAccuracy: 94, approachConsistency: 93, driverDistance: 58, courseManagement: 93 },
    career: { wins: 14, majors: 2, seasons: 10 },
  },
  {
    id: 'ballantyne', name: 'Rory Ballantyne', country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', age: 34,
    archetype: 'windSpecialist', puttingStyle: 'conservative', level: 85, potential: 87,
    personality: 'Dry to the point of unhelpfulness in interviews. Genuinely happier when the forecast is awful.',
    playingStyle: 'Flights everything low, uses the ground, never hits a shot above tree height if he can help it.',
    preferredConditions: 'Links golf, 25 mph, sideways rain. Has three wins in weather warnings.',
    weakness: 'On a soft, windless parkland course his low flight will not stop on the greens.',
    overrides: { lagPutting: 88, greenReading: 84, wind: 98, rain: 92, coldWeather: 90, launch: 28, midIron: 90, difficultLies: 88, hotWeather: 44 },
    career: { wins: 16, majors: 2, seasons: 13 },
  },
  {
    id: 'sandoval', name: 'Diego Sandoval', country: 'Spain', flag: '🇪🇸', age: 27,
    archetype: 'ballStriker', puttingStyle: 'poorReader', level: 86, potential: 93,
    personality: 'Physically incapable of hiding what he is feeling. The gallery always knows the score.',
    playingStyle: 'The best iron player alive — thirteen greens a round from anywhere — and a streaky putter.',
    preferredConditions: 'Firm greens where a well-struck iron is rewarded.',
    weakness: 'Putting. He has led the field in approach and finished 40th because of it.',
    overrides: { greenReading: 58, speedControl: 60, lagPutting: 62, longIron: 95, midIron: 96, shortIron: 94, approachConsistency: 93, putting: 62, longPutting: 58 },
    career: { wins: 11, majors: 1, seasons: 6 },
  },
  {
    id: 'ohlund', name: 'Lars Öhlund', country: 'Sweden', flag: '🇸🇪', age: 26,
    archetype: 'power', puttingStyle: 'aggressor', level: 85, potential: 95,
    personality: 'Amiable, enormous, and entirely unbothered by where the ball has gone.',
    playingStyle: 'Driver everywhere. Wedge from the rough is still a wedge.',
    preferredConditions: 'Long courses with short rough. Desert golf was designed for him.',
    weakness: 'Gets one-way bad with the driver under pressure, and the misses are 45 yards offline.',
    overrides: { driverDistance: 98, ballSpeed: 97, driverAccuracy: 58, drivingPressure: 62, wedgeAccuracy: 84 },
    career: { wins: 9, majors: 1, seasons: 5 },
  },

  // ----------------------------------------------------------- very good (10)
  {
    id: 'cartwright', name: 'Ben Cartwright', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', age: 33,
    archetype: 'courseManager', puttingStyle: 'conservative', level: 81, potential: 84,
    personality: 'Sounds like an accountant describing a golf course, which is exactly what makes him good at it.',
    playingStyle: 'Never short-sides himself. Two doubles a season, total.',
    preferredConditions: 'Hard setups where par is a good score and everyone else is making mistakes.',
    weakness: 'Cannot go low. Has never shot 63 and is not going to.',
    overrides: { courseManagement: 96, decisionMaking: 94, composure: 90, consistency: 91, clutch: 66, driverDistance: 60 },
    career: { wins: 8, majors: 1, seasons: 11 },
  },
  {
    id: 'mokoena', name: 'Thabo Mokoena', country: 'South Africa', flag: '🇿🇦', age: 28,
    archetype: 'power', puttingStyle: 'aggressor', level: 81, potential: 88,
    personality: 'Talks constantly, to his caddie, to the gallery, to the ball while it is in the air.',
    playingStyle: 'Aggressive off the tee and out of the rough; loves a long iron from a bad lie.',
    preferredConditions: 'Heat and altitude. Grew up playing in both.',
    weakness: 'Wedge play from inside 100 yards is the worst part of a very good game.',
    overrides: { driverDistance: 93, ballSpeed: 91, hotWeather: 94, difficultLies: 88, wedgeAccuracy: 63 },
    career: { wins: 6, majors: 0, seasons: 7 },
  },
  {
    id: 'park', name: 'Jae-won Park', country: 'South Korea', flag: '🇰🇷', age: 25,
    archetype: 'elitePutter', puttingStyle: 'technician', level: 80, potential: 91,
    personality: 'Blank-faced over the ball and startlingly funny off the course.',
    playingStyle: 'Gets it to the middle of the green and makes everything from 15 feet.',
    preferredConditions: 'Fast, subtle greens. The quicker they run, the bigger his edge.',
    weakness: 'Short off the tee, and on a 7,500-yard course it shows.',
    overrides: { greenReading: 94, speedControl: 92, lagPutting: 88, putting: 97, shortPutting: 96, longPutting: 90, puttingPressure: 92, driverDistance: 61, longIron: 66 },
    career: { wins: 5, majors: 0, seasons: 4 },
  },
  {
    id: 'aubert', name: 'Nicolas Aubert', country: 'France', flag: '🇫🇷', age: 30,
    archetype: 'allRounder', puttingStyle: 'steady', level: 80, potential: 85,
    personality: 'Elegant, unruffled, faintly amused by the whole business.',
    playingStyle: 'No obvious strength, no visible weakness, a lot of 68s.',
    preferredConditions: 'Cool, still mornings on a classic layout.',
    weakness: 'Has contended eleven times and won twice — the last hour is not his best hour.',
    overrides: { clutch: 62, composure: 74, consistency: 88, midIron: 84, chipping: 82 },
    career: { wins: 5, majors: 0, seasons: 9 },
  },
  {
    id: 'hargreave', name: 'Tom Hargreave', country: 'Australia', flag: '🇦🇺', age: 24,
    archetype: 'bomber', puttingStyle: 'aggressor', level: 79, potential: 94,
    personality: 'Utterly certain of himself in a way that is either charming or insufferable depending on the week.',
    playingStyle: 'Hits it 330 and figures the rest out from there.',
    preferredConditions: 'Wide fairways, firm ground, no trees.',
    weakness: 'Course management. Hits driver on a 340-yard hole with water at 320.',
    overrides: { driverDistance: 96, ballSpeed: 95, courseManagement: 48, decisionMaking: 52, chipping: 68 },
    career: { wins: 3, majors: 0, seasons: 3 },
  },
  {
    id: 'bettencourt', name: 'Paulo Bettencourt', country: 'Brazil', flag: '🇧🇷', age: 32,
    archetype: 'shortGame', puttingStyle: 'technician', level: 79, potential: 82,
    personality: 'Warm, superstitious, and openly delighted by his own good shots.',
    playingStyle: 'Misses eight greens and shoots 69 anyway.',
    preferredConditions: 'Courses with small greens, where everybody is chipping.',
    weakness: 'Long irons. From 210 yards he is looking for a bail-out.',
    overrides: { speedControl: 88, lagPutting: 84, chipping: 95, pitching: 94, bunkerPlay: 93, recovery: 90, longIron: 62, driverDistance: 66 },
    career: { wins: 6, majors: 0, seasons: 11 },
  },
  {
    id: 'solberg', name: 'Henrik Solberg', country: 'Norway', flag: '🇳🇴', age: 29,
    archetype: 'precision', puttingStyle: 'conservative', level: 79, potential: 84,
    personality: 'Quiet, systematic, keeps a notebook on every green he has ever putted.',
    playingStyle: 'Fairway, middle of the green, two putts, repeat.',
    preferredConditions: 'Cold and still. Comfortable in weather that bothers other people.',
    weakness: 'Not long enough to reach the par 5s, so he gives up strokes where the field scores.',
    overrides: { driverAccuracy: 92, coldWeather: 92, approachConsistency: 89, driverDistance: 57, clutch: 68 },
    career: { wins: 4, majors: 0, seasons: 8 },
  },
  {
    id: 'vantassel', name: 'Cole Vantassel', country: 'United States', flag: '🇺🇸', age: 26,
    archetype: 'volatile', puttingStyle: 'streaky', level: 80, potential: 93,
    personality: 'Electrifying and exhausting. Slams clubs, holes 40-footers, apologises to nobody.',
    playingStyle: 'Attacks every pin. Has shot 61 and 79 in consecutive rounds.',
    preferredConditions: 'Soft, gettable golf courses where the winning score is 22 under.',
    weakness: 'Everything, on the wrong day. Four rounds of steady golf is his rarest achievement.',
    overrides: { consistency: 34, composure: 44, clutch: 90, putting: 88, driverDistance: 90, courseManagement: 46 },
    career: { wins: 4, majors: 1, seasons: 5 },
  },
  {
    id: 'morgan', name: 'Rhys Morgan', country: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', age: 35,
    archetype: 'veteran', puttingStyle: 'conservative', level: 79, potential: 80,
    personality: 'Unfailingly decent, mildly weary, the man every young pro asks for advice.',
    playingStyle: 'Position, position, wedge. Has not missed a cut in nineteen months.',
    preferredConditions: 'Difficult, old-fashioned tests. Loves a links.',
    weakness: 'The distance has gone. He is playing 3 wood into greens where the kids have 8 iron.',
    overrides: { composure: 93, courseManagement: 92, chipping: 88, putting: 84, driverDistance: 52, ballSpeed: 50, stamina: 58 },
    career: { wins: 7, majors: 1, seasons: 14 },
  },
  {
    id: 'ferrante', name: 'Mateo Ferrante', country: 'Italy', flag: '🇮🇹', age: 28,
    archetype: 'ballStriker', puttingStyle: 'poorReader', level: 79, potential: 86,
    personality: 'Immaculate, theatrical, and privately convinced the greens are against him.',
    playingStyle: 'Beautiful swing, thirteen greens a round, three-putts from 25 feet.',
    preferredConditions: 'Firm, demanding approach shots into big greens.',
    weakness: 'Long putting. Loses a stroke and a half a round on the greens.',
    overrides: { lagPutting: 50, speedControl: 54, greenReading: 58, midIron: 92, longIron: 90, shortIron: 89, longPutting: 52, putting: 64 },
    career: { wins: 3, majors: 0, seasons: 7 },
  },

  // ---------------------------------------------------------------- solid (15)
  {
    id: 'wexler', name: 'Dane Wexler', country: 'United States', flag: '🇺🇸', age: 31,
    archetype: 'scrambler', puttingStyle: 'aggressor', level: 75, potential: 78,
    personality: 'Scruffy, cheerful, allergic to the practice range.',
    playingStyle: 'Finds trouble, invents a shot, saves par, grins.',
    preferredConditions: 'Anywhere with recovery angles. Hates a course with no imagination in it.',
    weakness: 'Driving accuracy. He is in the trees because he keeps hitting it there.',
    overrides: { recovery: 93, chipping: 89, difficultLies: 90, driverAccuracy: 52, approachConsistency: 58 },
    career: { wins: 2, majors: 0, seasons: 9 },
  },
  {
    id: 'kowalczyk', name: 'Adrian Kowalczyk', country: 'Poland', flag: '🇵🇱', age: 27,
    archetype: 'precision', puttingStyle: 'steady', level: 75, potential: 84,
    personality: 'Intense, self-critical, keeps a running tally of his own mistakes.',
    playingStyle: 'Straight, methodical, and improving every season.',
    preferredConditions: 'Narrow golf courses in cool weather.',
    weakness: 'Gets down on himself. A bogey on the 2nd can cost him three more.',
    overrides: { driverAccuracy: 90, composure: 54, consistency: 76 },
    career: { wins: 2, majors: 0, seasons: 5 },
  },
  {
    id: 'ryu', name: 'Sung-min Ryu', country: 'South Korea', flag: '🇰🇷', age: 30,
    archetype: 'courseManager', puttingStyle: 'conservative', level: 75, potential: 79,
    personality: 'Polite, precise and impossible to rattle.',
    playingStyle: 'Plots his way round. Never in a bunker he did not choose.',
    preferredConditions: 'Tough setups and slow greens.',
    weakness: 'Low ceiling. He shoots 69 whether the course is playing easy or hard.',
    overrides: { courseManagement: 91, decisionMaking: 88, composure: 87, driverDistance: 58, clutch: 64 },
    career: { wins: 2, majors: 0, seasons: 8 },
  },
  {
    id: 'ocampo', name: 'Felipe Ocampo', country: 'Colombia', flag: '🇨🇴', age: 25,
    archetype: 'power', puttingStyle: 'aggressor', level: 74, potential: 88,
    personality: 'All energy, no filter. Walks fast, plays fast, thinks last.',
    playingStyle: 'Bombs it, finds rough, hacks it out, holes a 20-footer.',
    preferredConditions: 'Heat and soft rough.',
    weakness: 'Decision making. His caddie has visibly aged.',
    overrides: { driverDistance: 92, ballSpeed: 90, decisionMaking: 46, courseManagement: 44, hotWeather: 90 },
    career: { wins: 1, majors: 0, seasons: 3 },
  },
  {
    id: 'reid', name: 'Callum Reid', country: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', age: 33,
    archetype: 'windSpecialist', puttingStyle: 'conservative', level: 74, potential: 77,
    personality: 'Taciturn. Answers most questions with a number.',
    playingStyle: 'Punches 5 irons from 170 yards and putts from off the green.',
    preferredConditions: 'Anything over 20 mph.',
    weakness: 'In calm, soft conditions he is a mid-pack player with no way to make birdies.',
    overrides: { wind: 93, rain: 87, launch: 32, chipping: 84, hotWeather: 48 },
    career: { wins: 2, majors: 0, seasons: 11 },
  },
  {
    id: 'nakahara', name: 'Yuji Nakahara', country: 'Japan', flag: '🇯🇵', age: 29,
    archetype: 'elitePutter', puttingStyle: 'streaky', level: 74, potential: 80,
    personality: 'Superstitious about his putter to a degree he will not discuss.',
    playingStyle: 'Average tee to green, remarkable from 10 feet.',
    preferredConditions: 'Fast greens and short courses.',
    weakness: 'Long irons and long par 4s. He has nothing from 200 yards.',
    overrides: { speedControl: 70, greenReading: 82, putting: 93, shortPutting: 94, longIron: 58, driverDistance: 60 },
    career: { wins: 2, majors: 0, seasons: 7 },
  },
  {
    id: 'deschamps', name: 'Owen Deschamps', country: 'Canada', flag: '🇨🇦', age: 26,
    archetype: 'allRounder', puttingStyle: 'steady', level: 74, potential: 86,
    personality: 'Earnest, studious, treats every round as homework.',
    playingStyle: 'Balanced and getting better. No holes in the game yet, no peaks either.',
    preferredConditions: 'Cold weather. Grew up playing in April sleet.',
    weakness: 'Has not learned how to win — leads after 54 holes and shoots 73.',
    overrides: { coldWeather: 90, clutch: 52, consistency: 80 },
    career: { wins: 1, majors: 0, seasons: 4 },
  },
  {
    id: 'asante', name: 'Kwame Asante', country: 'Ghana', flag: '🇬🇭', age: 23,
    archetype: 'bomber', puttingStyle: 'aggressor', level: 73, potential: 92,
    personality: 'Explosive, joyful, entirely unpolished.',
    playingStyle: 'Longest driver on tour by ball speed. Everything else is a work in progress.',
    preferredConditions: 'Heat, wide fairways, reachable par 5s.',
    weakness: 'Wedges and putting. He can make 4 from 340 yards and 6 from 90.',
    overrides: { speedControl: 52, lagPutting: 50, driverDistance: 97, ballSpeed: 98, wedgeAccuracy: 54, putting: 58, courseManagement: 44 },
    career: { wins: 1, majors: 0, seasons: 2 },
  },
  {
    id: 'vlk', name: 'Martin Vlk', country: 'Czechia', flag: '🇨🇿', age: 34,
    archetype: 'grinder', puttingStyle: 'conservative', level: 73, potential: 75,
    personality: 'Relentless, unglamorous, first on the range and last off it.',
    playingStyle: 'Makes every cut, contends twice a year, wins almost never.',
    preferredConditions: 'Long, hard weeks. Attrition suits him.',
    weakness: 'No birdie speed. Sunday charges are not part of the repertoire.',
    overrides: { consistency: 90, stamina: 91, fatigueResistance: 90, clutch: 56, driverDistance: 58 },
    career: { wins: 1, majors: 0, seasons: 12 },
  },
  {
    id: 'brennan', name: 'Luca Brennan', country: 'Ireland', flag: '🇮🇪', age: 28,
    archetype: 'shortGame', puttingStyle: 'aggressor', level: 73, potential: 81,
    personality: 'Chatty, lucky, and completely fearless around the greens.',
    playingStyle: 'Flop shots off tight lies for fun. Pitches it to two feet.',
    preferredConditions: 'Wet, soft conditions where he can attack pins.',
    weakness: 'Driving. He is 40th in distance and 130th in accuracy, which is a bad combination.',
    overrides: { chipping: 92, pitching: 93, bunkerPlay: 88, driverAccuracy: 54, rain: 88 },
    career: { wins: 1, majors: 0, seasons: 6 },
  },
  {
    id: 'vicuna', name: 'Andrés Vicuña', country: 'Chile', flag: '🇨🇱', age: 31,
    archetype: 'ballStriker', puttingStyle: 'poorReader', level: 73, potential: 77,
    personality: 'Serious, technical, happiest talking about launch angles.',
    playingStyle: 'Leads the field in greens hit and 90th in strokes gained putting.',
    preferredConditions: 'Firm greens and difficult approach shots.',
    weakness: 'Putting, and it has become a mental problem as much as a stroke one.',
    overrides: { greenReading: 52, speedControl: 56, lagPutting: 58, midIron: 89, longIron: 88, putting: 54, puttingPressure: 48 },
    career: { wins: 1, majors: 0, seasons: 9 },
  },
  {
    id: 'brandt', name: 'Stefan Brandt', country: 'Germany', flag: '🇩🇪', age: 36,
    archetype: 'veteran', puttingStyle: 'technician', level: 73, potential: 74,
    personality: 'Formal, precise, has played the same golf ball model for eleven years.',
    playingStyle: 'Fairways and greens, and a beautiful old-fashioned short game.',
    preferredConditions: 'Classic parkland courses in cool weather.',
    weakness: 'Four hundred yards shorter off the tee over eighteen holes than he was at 28.',
    overrides: { driverAccuracy: 88, courseManagement: 89, driverDistance: 48, ballSpeed: 46, stamina: 54, fatigueResistance: 56 },
    career: { wins: 4, majors: 0, seasons: 15 },
  },
  {
    id: 'teale', name: 'Jordan Teale', country: 'New Zealand', flag: '🇳🇿', age: 27,
    archetype: 'scrambler', puttingStyle: 'streaky', level: 72, potential: 82,
    personality: 'Unflappable, a little scruffy, entirely comfortable in a hedge.',
    playingStyle: 'Wild off the tee, magic out of trouble.',
    preferredConditions: 'Wind and rough. Thrives when the field is complaining.',
    weakness: 'Sooner or later the recovery does not come off and it is a double.',
    overrides: { recovery: 90, difficultLies: 89, driverAccuracy: 50, consistency: 58, wind: 84 },
    career: { wins: 1, majors: 0, seasons: 5 },
  },
  {
    id: 'chandrasekar', name: 'Ravi Chandrasekar', country: 'India', flag: '🇮🇳', age: 30,
    archetype: 'courseManager', puttingStyle: 'conservative', level: 72, potential: 78,
    personality: 'Thoughtful and disarmingly candid about his own limitations.',
    playingStyle: 'Plays to a plan and sticks to it whatever the leaderboard says.',
    preferredConditions: 'Extreme heat — the hotter it gets the better he plays relative to the field.',
    weakness: 'Not long enough to compete on a 7,500-yard golf course.',
    overrides: { hotWeather: 96, courseManagement: 88, decisionMaking: 86, driverDistance: 54 },
    career: { wins: 1, majors: 0, seasons: 8 },
  },
  {
    id: 'hollingsworth', name: 'Nate Hollingsworth', country: 'United States', flag: '🇺🇸', age: 24,
    archetype: 'volatile', puttingStyle: 'aggressor', level: 72, potential: 90,
    personality: 'Loud, confident, visibly enjoying himself until he is visibly not.',
    playingStyle: 'Goes at everything. Makes eight birdies and four bogeys.',
    preferredConditions: 'Soft courses with reachable par 5s.',
    weakness: 'No brakes. One bad swing becomes three holes of chaos.',
    overrides: { lagPutting: 52, speedControl: 58, consistency: 36, composure: 42, driverDistance: 88, putting: 84, clutch: 78 },
    career: { wins: 1, majors: 0, seasons: 3 },
  },

  // -------------------------------------------------------------- average (10)
  {
    id: 'petrossian', name: 'Ian Petrossian', country: 'Armenia', flag: '🇦🇲', age: 32,
    archetype: 'grinder', puttingStyle: 'conservative', level: 68, potential: 71,
    personality: 'Stoic to the point of invisibility. Nobody has seen him react to anything.',
    playingStyle: 'Grinds out pars and waits for the field to come back to him.',
    preferredConditions: 'Long, hard, grim weeks.',
    weakness: 'Cannot make enough birdies to matter on a soft course.',
    overrides: { consistency: 86, composure: 84, clutch: 52, driverDistance: 56 },
    career: { wins: 0, majors: 0, seasons: 9 },
  },
  {
    id: 'devries', name: 'Bram de Vries', country: 'Netherlands', flag: '🇳🇱', age: 29,
    archetype: 'precision', puttingStyle: 'technician', level: 68, potential: 76,
    personality: 'Cerebral, a bit fussy, endlessly tinkering with his equipment.',
    playingStyle: 'Straight and short. Hits more fairways than anyone outside the top 20.',
    preferredConditions: 'Tight tree-lined courses in the rain.',
    weakness: 'Has no answer on a long golf course, and there are a lot of long golf courses.',
    overrides: { driverAccuracy: 90, driverDistance: 46, rain: 86, longIron: 60 },
    career: { wins: 0, majors: 0, seasons: 6 },
  },
  {
    id: 'okafor', name: 'Sam Okafor', country: 'Nigeria', flag: '🇳🇬', age: 26,
    archetype: 'power', puttingStyle: 'aggressor', level: 68, potential: 85,
    personality: 'Big personality, bigger swing, still figuring out tour golf.',
    playingStyle: 'Hits it past everyone and has no idea where it is going.',
    preferredConditions: 'Heat and width.',
    weakness: 'Accuracy off the tee, and short game to cover for it.',
    overrides: { driverDistance: 93, ballSpeed: 92, driverAccuracy: 44, chipping: 58, hotWeather: 90 },
    career: { wins: 0, majors: 0, seasons: 3 },
  },
  {
    id: 'rasmussen', name: 'Emil Rasmussen', country: 'Denmark', flag: '🇩🇰', age: 35,
    archetype: 'shortGame', puttingStyle: 'clutch', level: 67, potential: 70,
    personality: 'Dry, self-deprecating, a genuinely great putter of a golf ball on a bad day.',
    playingStyle: 'Short, crooked, and gets up and down from everywhere.',
    preferredConditions: 'Small greens and cold mornings.',
    weakness: 'Length. He is hitting 4 iron where the field has 8.',
    overrides: { putting: 86, greenReading: 84, lagPutting: 82, chipping: 90, bunkerPlay: 88, driverDistance: 44, ballSpeed: 44, coldWeather: 86 },
    career: { wins: 1, majors: 0, seasons: 13 },
  },
  {
    id: 'marchetti', name: 'Hugo Marchetti', country: 'Argentina', flag: '🇦🇷', age: 28,
    archetype: 'allRounder', puttingStyle: 'steady', level: 67, potential: 78,
    personality: 'Sunny, sociable, and prone to the occasional flash of real quality.',
    playingStyle: 'Competent everywhere and outstanding nowhere.',
    preferredConditions: 'Warm and still.',
    weakness: 'Nothing to hide behind on a bad ball-striking week.',
    career: { wins: 0, majors: 0, seasons: 5 },
  },
  {
    id: 'tolliver', name: 'Jack Tolliver', country: 'United States', flag: '🇺🇸', age: 25,
    archetype: 'bomber', puttingStyle: 'aggressor', level: 67, potential: 84,
    personality: 'Brash, young and certain he belongs, which he nearly does.',
    playingStyle: 'Hits driver 325 and wedges it to 30 feet.',
    preferredConditions: 'Desert golf. Length and width, no trees.',
    weakness: 'Wedge play and putting — the two things that actually make the cut.',
    overrides: { speedControl: 50, lagPutting: 52, driverDistance: 94, ballSpeed: 93, wedgeAccuracy: 50, putting: 54 },
    career: { wins: 0, majors: 0, seasons: 3 },
  },
  {
    id: 'baek', name: 'Seung-ho Baek', country: 'South Korea', flag: '🇰🇷', age: 31,
    archetype: 'elitePutter', puttingStyle: 'conservative', level: 67, potential: 71,
    personality: 'Quiet, diligent, spends two hours a day on the practice green.',
    playingStyle: 'Gains two strokes a round putting and loses three everywhere else.',
    preferredConditions: 'Fast greens, short courses, no wind.',
    weakness: 'Everything from 150 yards and further out.',
    overrides: { lagPutting: 88, speedControl: 86, greenReading: 84, putting: 92, shortPutting: 93, longIron: 52, driverDistance: 50, approachConsistency: 56 },
    career: { wins: 0, majors: 0, seasons: 8 },
  },
  {
    id: 'haddad', name: 'Tariq Haddad', country: 'Morocco', flag: '🇲🇦', age: 30,
    archetype: 'windSpecialist', puttingStyle: 'poorReader', level: 67, potential: 73,
    personality: 'Calm, watchful, reads a golf course better than he plays it.',
    playingStyle: 'Low flight, long run-outs, excellent in a gale.',
    preferredConditions: 'Coastal wind and firm ground.',
    weakness: 'On a soft, still course he cannot get the ball to stop.',
    overrides: { wind: 91, launch: 34, hotWeather: 84, putting: 58 },
    career: { wins: 0, majors: 0, seasons: 7 },
  },
  {
    id: 'aaltonen', name: 'Vincent Aaltonen', country: 'Finland', flag: '🇫🇮', age: 33,
    archetype: 'courseManager', puttingStyle: 'conservative', level: 66, potential: 69,
    personality: 'Methodical, faintly gloomy, deeply reliable.',
    playingStyle: 'Plays the safe side of everything and makes a lot of 71s.',
    preferredConditions: 'Cold, hard golf.',
    weakness: 'No speed, no power, no way to make up ground.',
    overrides: { courseManagement: 88, coldWeather: 90, driverDistance: 46, clutch: 50 },
    career: { wins: 0, majors: 0, seasons: 10 },
  },
  {
    id: 'mercer', name: 'Blake Mercer', country: 'Australia', flag: '🇦🇺', age: 27,
    archetype: 'volatile', puttingStyle: 'streaky', level: 66, potential: 82,
    personality: 'Charming, chaotic, has been fined twice for club-throwing.',
    playingStyle: 'Shoots 65 on Thursday and 77 on Friday roughly once a month.',
    preferredConditions: 'Soft and gettable.',
    weakness: 'Temperament. Nothing about a bad break is ever absorbed quietly.',
    overrides: { consistency: 32, composure: 38, clutch: 72, driverDistance: 84 },
    career: { wins: 0, majors: 0, seasons: 4 },
  },

  // --------------------------------------------------------------- fringe (7)
  {
    id: 'lindqvist', name: 'Gus Lindqvist', country: 'Sweden', flag: '🇸🇪', age: 38,
    archetype: 'grinder', puttingStyle: 'steady', level: 60, potential: 62,
    personality: 'Thirteen years on tour and still on the range at seven in the morning.',
    playingStyle: 'Straight, short, stubborn. Makes a cut by one shot four times a year.',
    preferredConditions: 'Cold, wet, difficult.',
    weakness: 'Time. He knows it too.',
    overrides: { consistency: 82, stamina: 60, driverDistance: 42, ballSpeed: 42 },
    career: { wins: 0, majors: 0, seasons: 13 },
  },
  {
    id: 'ashcombe', name: 'Miles Ashcombe', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', age: 36,
    archetype: 'veteran', puttingStyle: 'technician', level: 60, potential: 62,
    personality: 'Urbane, a little rueful, the best storyteller in the locker room.',
    playingStyle: 'A lovely short game attached to a driver that has stopped cooperating.',
    preferredConditions: 'Old-fashioned courses that reward a bit of craft.',
    weakness: 'Off the tee. It has been a problem for three seasons.',
    overrides: { greenReading: 86, speedControl: 78, chipping: 86, putting: 80, driverAccuracy: 48, driverDistance: 44, composure: 80 },
    career: { wins: 1, majors: 0, seasons: 14 },
  },
  {
    id: 'salcedo', name: 'Rubén Salcedo', country: 'Mexico', flag: '🇲🇽', age: 29,
    archetype: 'power', puttingStyle: 'streaky', level: 60, potential: 74,
    personality: 'Quiet, hard-working, and one good putting week from a career.',
    playingStyle: 'Long and erratic, with flashes of very good golf.',
    preferredConditions: 'Heat and altitude.',
    weakness: 'Putting under pressure. He has three-putted the 18th to miss a cut twice.',
    overrides: { speedControl: 52, greenReading: 56, driverDistance: 88, puttingPressure: 40, putting: 50, hotWeather: 88 },
    career: { wins: 0, majors: 0, seasons: 5 },
  },
  {
    id: 'volkov', name: 'Dmitri Volkov', country: 'Kazakhstan', flag: '🇰🇿', age: 31,
    archetype: 'precision', puttingStyle: 'technician', level: 59, potential: 66,
    personality: 'Reserved and slightly stiff, with an unexpectedly delicate touch.',
    playingStyle: 'Very straight, very short, occasionally hangs around the top twenty.',
    preferredConditions: 'Narrow, cold and windless.',
    weakness: 'Length, and a long iron game that does not exist.',
    overrides: { driverAccuracy: 86, driverDistance: 40, longIron: 48, coldWeather: 84 },
    career: { wins: 0, majors: 0, seasons: 6 },
  },
  {
    id: 'fonoti', name: 'Tevita Fonoti', country: 'Fiji', flag: '🇫🇯', age: 25,
    archetype: 'bomber', puttingStyle: 'aggressor', level: 59, potential: 80,
    personality: 'Enormous, gentle, and completely raw.',
    playingStyle: 'Second-longest on tour with a short game that belongs at a municipal.',
    preferredConditions: 'Wide, hot, long.',
    weakness: 'Everything inside 100 yards.',
    overrides: { speedControl: 44, lagPutting: 44, greenReading: 46, driverDistance: 95, ballSpeed: 96, chipping: 44, pitching: 44, putting: 48, wedgeAccuracy: 46 },
    career: { wins: 0, majors: 0, seasons: 2 },
  },
  {
    id: 'pemberton', name: 'Alec Pemberton', country: 'United States', flag: '🇺🇸', age: 34,
    archetype: 'shortGame', puttingStyle: 'technician', level: 58, potential: 61,
    personality: 'Affable, resigned, gives clinics on chipping that are better than his results.',
    playingStyle: 'Superb from 40 yards in and nowhere near good enough from further out.',
    preferredConditions: 'Small greens and slow play.',
    weakness: 'Ball-striking. He is hitting nine greens a round.',
    overrides: { chipping: 88, pitching: 86, bunkerPlay: 85, midIron: 48, longIron: 44 },
    career: { wins: 0, majors: 0, seasons: 11 },
  },
  {
    id: 'bakker', name: 'Gerrit Bakker', country: 'Netherlands', flag: '🇳🇱', age: 42,
    archetype: 'veteran', puttingStyle: 'clutch', level: 57, potential: 58,
    personality: 'Genial and unbothered, playing out a career he has enjoyed enormously.',
    playingStyle: 'Reads greens better than anyone alive and cannot reach the par 4s.',
    preferredConditions: 'Anything with a bit of history to it.',
    weakness: 'Forty-two years old on a tour that keeps getting longer.',
    overrides: { greenReading: 96, lagPutting: 90, speedControl: 86, putting: 84, composure: 90, courseManagement: 90, driverDistance: 34, ballSpeed: 34, stamina: 40, fatigueResistance: 42 },
    career: { wins: 2, majors: 0, seasons: 19 },
  },

  // ------------------------------------------------------------ prospects (3)
  {
    id: 'lindgren', name: 'Kai Lindgren', country: 'Sweden', flag: '🇸🇪', age: 20,
    archetype: 'prospect', puttingStyle: 'aggressor', level: 64, potential: 95,
    personality: 'Startlingly self-possessed for twenty, and aware of exactly how good he might be.',
    playingStyle: 'Long, high, and already a beautiful iron player. Has no idea how to manage a golf course.',
    preferredConditions: 'Anything soft where he can fly the ball at flags.',
    weakness: 'Experience. He will hit driver at a water hazard because it is there.',
    overrides: { driverDistance: 88, ballSpeed: 86, midIron: 82, courseManagement: 38, decisionMaking: 42, composure: 46 },
    career: { wins: 0, majors: 0, seasons: 1 },
  },
  {
    id: 'bankole', name: 'Theo Bankole', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', age: 21,
    archetype: 'prospect', puttingStyle: 'clutch', level: 63, potential: 92,
    personality: 'Shy in public, ferociously competitive in private.',
    playingStyle: 'Superb putter already, with a tee-to-green game that needs two years.',
    preferredConditions: 'Fast greens.',
    weakness: 'Consistency. He has shot 66 and 78 in the same tournament twice this season.',
    overrides: { greenReading: 84, speedControl: 80, lagPutting: 76, putting: 88, shortPutting: 86, consistency: 40, approachConsistency: 52, courseManagement: 42 },
    career: { wins: 0, majors: 0, seasons: 1 },
  },
  {
    id: 'herrera', name: 'Santi Herrera', country: 'Spain', flag: '🇪🇸', age: 19,
    archetype: 'prospect', puttingStyle: 'streaky', level: 61, potential: 97,
    personality: 'Plays with the reckless joy of somebody who has never missed a cut that mattered.',
    playingStyle: 'Improvises everything. The short game is already world class.',
    preferredConditions: 'Anywhere he can be creative.',
    weakness: 'Nineteen. Physically strong, mentally nowhere near ready.',
    overrides: { greenReading: 74, speedControl: 56, chipping: 86, recovery: 84, difficultLies: 82, composure: 36, courseManagement: 34, consistency: 42 },
    career: { wins: 0, majors: 0, seasons: 1 },
  },
];

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Seeds are authored on an intuitive 1–100 scale — 88 reads as "one of the five
 * best players alive", 57 as "hanging on to his card". A professional tour is
 * not that widely spread, though: the gap between the best scoring average on
 * tour and the worst is about four strokes a round, not ten. So the authored
 * level is compressed into the band a tour field actually occupies, and the
 * *variation between a player's own skills* is widened to compensate.
 *
 * That second half matters more than the first. If every one of a golfer's
 * thirty ratings sits within a few points of one number, then the best player is
 * simultaneously the longest, straightest, best iron player and best putter in
 * the field, and he wins eleven events out of twenty. Real players are lopsided:
 * everybody out here is elite at something and ordinary at something else, and
 * that is why twenty tournaments produce fifteen different winners.
 */
const LEVEL_CENTRE = 76;
const LEVEL_COMPRESSION = 0.16;
const SKILL_VARIATION = 9.5;

function compressLevel(level: number, compression = LEVEL_COMPRESSION): number {
  return LEVEL_CENTRE + (level - 72) * compression;
}

/** Which ratings decline with age, and which keep improving. */
const PHYSICAL: RatingKey[] = ['driverDistance', 'ballSpeed', 'stamina', 'fatigueResistance', 'launch'];
const MENTAL: RatingKey[] = ['composure', 'courseManagement', 'decisionMaking', 'consistency'];

function ageAdjust(key: RatingKey, age: number): number {
  let delta = 0;
  if (PHYSICAL.includes(key)) {
    if (age > 31) delta -= (age - 31) * 0.85;
    if (age < 23) delta -= (23 - age) * 0.5;
  }
  if (MENTAL.includes(key)) {
    delta += Math.min(10, Math.max(-12, (age - 26) * 0.9));
  }
  if (key === 'chipping' || key === 'pitching' || key === 'putting') {
    delta += Math.min(4, Math.max(-4, (age - 27) * 0.3));
  }
  return delta;
}

function buildRatings(seed: GolferSeed): Ratings {
  const level = compressLevel(seed.level);
  const ratings = blankRatings(level);
  const bias = ARCHETYPES[seed.archetype].bias;
  const style = PUTTING_STYLES[seed.puttingStyle].bias;
  const rng = createRng(`golfer:${seed.id}:ratings`);
  for (const key of Object.keys(ratings) as RatingKey[]) {
    const noise = rng.normal() * SKILL_VARIATION;
    const value = level + (bias[key] ?? 0) + (style[key] ?? 0) + noise + ageAdjust(key, seed.age);
    ratings[key] = clamp(Math.round(value), 12, 99);
  }
  // Authored specifics always win.
  for (const [key, value] of Object.entries(seed.overrides ?? {}) as [RatingKey, number][]) {
    ratings[key] = clamp(Math.round(value), 12, 99);
  }
  return ratings;
}

/** A plausible career for somebody who has been this good for this long. */
function buildCareer(seed: GolferSeed, ability: number): Golfer['career'] {
  const rng = createRng(`golfer:${seed.id}:career`);
  const career = emptyCareer();
  const seasons = seed.career?.seasons ?? Math.max(1, Math.min(seed.age - 21, 12));
  const events = Math.round(seasons * rng.range(19, 25));
  const cutRate = clamp(0.28 + (ability - 55) * 0.0155, 0.3, 0.94);
  const rounds = Math.round(events * (2 + cutRate * 2));
  const scoringAverage = 74.4 - (ability - 50) * 0.115;

  career.seasons = seasons;
  career.events = events;
  career.wins = seed.career?.wins ?? Math.max(0, Math.round((ability - 66) * 0.22 * seasons * 0.35));
  career.majors = seed.career?.majors ?? 0;
  career.top10s = Math.round(events * clamp((ability - 58) * 0.018, 0.02, 0.42));
  career.cutsMade = Math.round(events * cutRate);
  career.earnings = Math.round(career.top10s * rng.range(210000, 420000) + career.wins * rng.range(1400000, 2100000) + career.cutsMade * rng.range(52000, 94000));
  career.rounds = rounds;
  career.strokes = Math.round(rounds * scoringAverage);
  career.parTotal = rounds * 72;
  career.holes = rounds * 18;
  career.drives = rounds * 14;
  career.driveDistanceTotal = Math.round(career.drives * (262 + (seed.overrides?.driverDistance ?? seed.level) * 0.55));
  career.fairwayAttempts = career.drives;
  career.fairwaysHit = Math.round(career.drives * clamp(0.38 + ((seed.overrides?.driverAccuracy ?? seed.level) - 40) * 0.0055, 0.34, 0.78));
  career.greenAttempts = career.holes;
  career.greensHit = Math.round(career.holes * clamp(0.45 + (ability - 50) * 0.0055, 0.42, 0.76));
  career.scrambleAttempts = career.greenAttempts - career.greensHit;
  career.scrambleSaves = Math.round(career.scrambleAttempts * clamp(0.35 + (ability - 50) * 0.0065, 0.3, 0.72));
  career.puttHoles = career.holes;
  career.putts = Math.round(career.holes * (1.83 - (ability - 50) * 0.0018));
  career.birdies = Math.round(career.holes * clamp(0.12 + (ability - 50) * 0.0032, 0.09, 0.26));
  career.eagles = Math.round(career.holes * 0.006);
  career.bogeys = Math.round(career.holes * clamp(0.22 - (ability - 50) * 0.0022, 0.11, 0.3));
  career.doubles = Math.round(career.holes * clamp(0.035 - (ability - 50) * 0.00035, 0.012, 0.05));
  career.pars = career.holes - career.birdies - career.eagles - career.bogeys - career.doubles;
  career.bestFinishRank = career.wins > 0 ? 1 : Math.max(2, Math.round(rng.range(2, 14)));
  return career;
}

export function buildGolfer(seed: GolferSeed): Golfer {
  const ratings = buildRatings(seed);
  const rng = createRng(`golfer:${seed.id}:hidden`);
  const golfer: Golfer = {
    id: seed.id,
    name: seed.name,
    country: seed.country,
    flag: seed.flag,
    age: seed.age,
    turnedPro: seed.age - (seed.career?.seasons ?? Math.max(1, Math.min(seed.age - 21, 12))),
    archetype: seed.archetype,
    puttingStyle: seed.puttingStyle,
    personality: seed.personality,
    playingStyle: seed.playingStyle,
    preferredConditions: seed.preferredConditions,
    weakness: seed.weakness,
    ratings,
    hidden: {
      currentAbility: 50,
      potential: Math.round(compressLevel(seed.potential, 0.46)),
      form: Math.round(rng.range(-4, 4) * 10) / 10,
      confidence: clamp(Math.round(52 + (compressLevel(seed.level) - 74) * 1.4 + rng.range(-8, 8)), 20, 95),
      injuryRisk: clamp(Math.round(18 + (seed.age - 26) * 1.6 + rng.range(-8, 12)), 4, 82),
      adaptability: clamp(Math.round(50 + (ratings.decisionMaking - 50) * 0.5 + rng.range(-10, 14)), 15, 96),
    },
    career: emptyCareer(),
    season: emptySeason(),
    history: [],
    rankingPoints: 0,
    worldRank: 0,
    recentFinishes: [],
    fatigue: 0,
    injuredWeeks: 0,
  };
  golfer.hidden.currentAbility = currentAbility(golfer);
  golfer.career = buildCareer(seed, golfer.hidden.currentAbility);
  // Ranking points seed the initial world ranking from what they have done.
  golfer.rankingPoints =
    golfer.hidden.currentAbility * 1.4 + golfer.career.wins * 6 + golfer.career.majors * 12 + golfer.hidden.form * 2;
  return golfer;
}

export function createTour(): Golfer[] {
  const golfers = SEEDS.map(buildGolfer);
  golfers.sort((a, b) => b.rankingPoints - a.rankingPoints);
  golfers.forEach((g, i) => {
    g.worldRank = i + 1;
  });
  return golfers;
}

export const GOLFER_SEEDS = SEEDS;
