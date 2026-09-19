/**
 * The balancing configuration for created golfers. One file, every number.
 *
 * Nothing in the career system hardcodes a threshold, a cost or a cap: it is all
 * here, and every other module in /career reads it. Changing a value in this file
 * rebalances the game without touching a line of logic.
 *
 * ---------------------------------------------------------------------------
 * Why these particular numbers
 * ---------------------------------------------------------------------------
 * They come from measuring the tour, not from taste. `test/tourProfile.ts`
 * prints the distribution of all 33 ratings across the 156 golfers who hold a
 * card, and the answer is not what the authored seed scale suggests: a seed
 * "level" of 88 and one of 57 both compress into a five-point band, and the
 * spread you actually see comes from archetype bias and per-skill noise. The
 * field as it stands:
 *
 *     current ability      min 68   p10 73   median 76.5   p90 80   max 83
 *     any single rating    min 31   p10 60   median  77    p90 91   max 99
 *     rating groups        driving 74 median, short game 77, putting 76.5
 *
 * So on this scale 50 is not "average professional" — it is unplayable, and
 * nobody on tour is near it. Average is 76. That single fact drives every
 * number below, and it is why the example values in a generic design document
 * ("Driving Distance: MAX 70") would have produced a golfer who could not break
 * 80. A created golfer is measured against 68–83 ability, not against 1–100.
 */

import type { RatingKey } from '../simulation/types';

// ---------------------------------------------------------------------------
// The skill lines a player actually spends on
// ---------------------------------------------------------------------------

/**
 * A skill line is one row on the creation screen. It owns a set of the engine's
 * ratings and sets all of them.
 *
 * The engine has 33 ratings, which is the right amount of detail for a shot
 * simulation and far too much for a person allocating points — nobody wants to
 * choose between Short Putting and Long Putting before their first tee shot. So
 * the 32 trainable ones are grouped into 16 lines, chosen so that each line is a
 * thing a golfer would recognise as a part of their game, and so that two lines
 * are never the same decision wearing different labels.
 *
 * `launch` is the one rating no line owns. It is a ball-flight trait rather than
 * a skill — you do not practise hitting it higher, you either do or you don't —
 * so it comes from the archetype and never from the budget.
 */
export type SkillLineId =
  | 'power'
  | 'driving'
  | 'longGame'
  | 'ironPlay'
  | 'wedgePlay'
  | 'approachControl'
  | 'shortGame'
  | 'bunkerPlay'
  | 'recovery'
  | 'putting'
  | 'greenReading'
  | 'nerve'
  | 'courseManagement'
  | 'consistency'
  | 'fitness'
  | 'weather';

export interface SkillLine {
  id: SkillLineId;
  name: string;
  /** What this line means in play, in one clause. */
  blurb: string;
  /** Which of the engine's ratings this line sets. */
  keys: RatingKey[];
  /** Which broad part of the game it belongs to, for grouping on screen. */
  section: 'Off the tee' | 'Approach' | 'Around the green' | 'Putting' | 'Between the ears' | 'Body and weather';
}

export const SKILL_LINES: SkillLine[] = [
  {
    id: 'power', name: 'Power', section: 'Off the tee',
    blurb: 'How far it goes. Carries bunkers, shortens par 5s, turns a 4 iron into a 7 iron.',
    keys: ['driverDistance', 'ballSpeed'],
  },
  {
    id: 'driving', name: 'Driving Accuracy', section: 'Off the tee',
    blurb: 'How often it finishes on the mown grass, and whether that survives Sunday.',
    keys: ['driverAccuracy', 'drivingPressure'],
  },
  {
    id: 'longGame', name: 'Long Irons & Woods', section: 'Approach',
    blurb: 'Everything from 190 yards out, including the second shot on a par 5.',
    keys: ['longIron'],
  },
  {
    id: 'ironPlay', name: 'Iron Play', section: 'Approach',
    blurb: 'The middle of the bag, which is most of the approach shots you hit.',
    keys: ['midIron', 'shortIron'],
  },
  {
    id: 'wedgePlay', name: 'Wedge Play', section: 'Approach',
    blurb: 'Inside 130 yards, where birdies are supposed to come from.',
    keys: ['wedgeAccuracy'],
  },
  {
    id: 'approachControl', name: 'Approach Control', section: 'Approach',
    blurb: 'How tight the miss is when the strike is not perfect. Turns bogeys into pars.',
    keys: ['approachConsistency'],
  },
  {
    id: 'shortGame', name: 'Chipping & Pitching', section: 'Around the green',
    blurb: 'Forty yards and in, off grass. The difference between a tap-in and a six-footer.',
    keys: ['chipping', 'pitching'],
  },
  {
    id: 'bunkerPlay', name: 'Bunker Play', section: 'Around the green',
    blurb: 'Sand, greenside and fairway. Cheap to ignore until the week you cannot.',
    keys: ['bunkerPlay'],
  },
  {
    id: 'recovery', name: 'Recovery', section: 'Around the green',
    blurb: 'Trees, deep rough, hardpan, a ball above your feet — getting out and getting away with it.',
    keys: ['recovery', 'difficultLies'],
  },
  {
    id: 'putting', name: 'Putting Stroke', section: 'Putting',
    blurb: 'Holing out. The single most valuable rating in the game and priced accordingly.',
    keys: ['putting', 'shortPutting', 'longPutting'],
  },
  {
    id: 'greenReading', name: 'Reading & Speed', section: 'Putting',
    blurb: 'Picking the line and getting the pace right, which is what stops three-putts.',
    keys: ['greenReading', 'speedControl', 'lagPutting'],
  },
  {
    id: 'nerve', name: 'Nerve', section: 'Between the ears',
    blurb: 'What your hands do with the tournament on the line.',
    keys: ['composure', 'clutch', 'puttingPressure'],
  },
  {
    id: 'courseManagement', name: 'Course Management', section: 'Between the ears',
    blurb: 'Choosing the right shot. Quietly saves more strokes a season than any single skill.',
    keys: ['courseManagement', 'decisionMaking'],
  },
  {
    id: 'consistency', name: 'Consistency', section: 'Between the ears',
    blurb: 'How small the gap is between your good days and your bad ones.',
    keys: ['consistency'],
  },
  {
    id: 'fitness', name: 'Fitness', section: 'Body and weather',
    blurb: 'Staying as sharp on the 72nd hole as the 1st, in heat, over four days.',
    keys: ['stamina', 'fatigueResistance'],
  },
  {
    id: 'weather', name: 'Weather Play', section: 'Body and weather',
    blurb: 'Wind, rain and cold. On a links in a gale it is the only rating that matters.',
    keys: ['wind', 'rain', 'coldWeather', 'hotWeather'],
  },
];

export const SKILL_LINE_BY_ID: Record<SkillLineId, SkillLine> = Object.fromEntries(
  SKILL_LINES.map((line) => [line.id, line]),
) as Record<SkillLineId, SkillLine>;

export const SKILL_LINE_IDS: SkillLineId[] = SKILL_LINES.map((line) => line.id);

/** Which line owns a rating, or undefined for the ones no line owns (`launch`). */
export const LINE_FOR_RATING: Partial<Record<RatingKey, SkillLineId>> = (() => {
  const out: Partial<Record<RatingKey, SkillLineId>> = {};
  for (const line of SKILL_LINES) for (const key of line.keys) out[key] = line.id;
  return out;
})();

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export const CREATION = {
  /**
   * Where every line sits before a single point is spent. Below the worst player
   * on tour on purpose: an unspent golfer is not a professional yet.
   */
  baseRating: 62,

  /**
   * The floor. No line can be reduced below this, at creation or ever, which is
   * what stops a player dumping a skill to 1 to fund the rest — there is nothing
   * to harvest. It sits just under the field's 10th percentile, so it reads as a
   * real weakness without making the golfer unplayable.
   */
  minRating: 55,

  /**
   * The highest any line may start at. The field's median rating is 77 and its
   * 75th percentile is 85, so a golfer who starts one line here is better at
   * that one thing than roughly seven tour players in ten — very good, and
   * nowhere near the 95+ the specialists carry.
   */
  maxStartingRating: 82,

  /**
   * The budget.
   *
   * Set by measurement, not by feel. Spread evenly it lands a created golfer on
   * an overall ability of about 77 — the median of the 156 players who hold a
   * card, and four to six points short of the five best. That is the brief in
   * requirement 10 exactly: good enough to make cuts and contend on a good week,
   * clearly not good enough to beat Marcus Vandehey over a season. Spent on two
   * or three lines instead it buys a golfer who is top-quartile at those and
   * below average everywhere else, for the same overall standard.
   *
   * `test/careerBalance.ts` prints what every legal extreme of this number
   * actually produces, against the real field.
   */
  startingSkillPoints: 350,

  /**
   * What a point of rating costs at creation, by the rating it takes you *from*.
   * Rising cost is what makes the budget a set of trade-offs rather than a
   * number to divide by sixteen — and it is the other half of why min-maxing
   * does not pay, since the last two points of a line cost five times the first.
   */
  costBands: [
    { upTo: 70, cost: 1 },
    { upTo: 76, cost: 2 },
    { upTo: 80, cost: 3 },
    { upTo: 100, cost: 5 },
  ] as { upTo: number; cost: number }[],

  /** Age a created golfer turns pro at. Young enough to have a career in front of them. */
  startingAge: 23,

  /** Identity limits, enforced on the server as well as in the form. */
  nameMinLength: 2,
  nameMaxLength: 24,
} as const;

// ---------------------------------------------------------------------------
// Career ceilings
// ---------------------------------------------------------------------------

/**
 * Caps are *derived from the archetype's own bias vector*, not typed out by hand.
 *
 * The 14 archetypes already in the game are defined by a set of rating offsets —
 * a Bomber is +26 driver distance and −18 driver accuracy, and that is what makes
 * the existing tour's bombers bombers. Reusing those same numbers to generate the
 * caps means a created Bomber's ceiling is the ceiling of the thing the game
 * already calls a bomber, and it is impossible for the two definitions to drift
 * apart. Add an archetype to ARCHETYPES and its caps follow for nothing.
 *
 * Weaknesses are weighted harder than strengths deliberately. Every archetype's
 * signature skill tops out around the same place, because in this game everybody
 * elite at something is roughly equally elite at it; what distinguishes one
 * career identity from another is what it never gets to have.
 */
export const CAPS = {
  /** The ceiling for a rating the archetype neither favours nor punishes. */
  neutral: 82,
  /** Rating points of ceiling per point of positive archetype bias. */
  perPositiveBias: 0.58,
  /** Rating points of ceiling *lost* per point of negative archetype bias. */
  perNegativeBias: 0.85,
  /**
   * Every archetype buys the same amount of ceiling with the same amount of
   * weakness.
   *
   * This is the one place the derivation does not take the simulation's bias
   * vectors at face value, and it is worth saying why. Those vectors were written
   * to *flavour* an AI golfer, where overall strength comes from the seed level
   * and the bias only decides shape — so nobody ever had to make them fair. They
   * are not: the Course Manager's is +22 course management against a single −8,
   * while the Volatile Superstar's is −24 consistency for +12 distance. Read
   * literally into player-facing ceilings that makes Course Manager a free lunch
   * and Volatile a self-inflicted wound, which fails both "no archetype is elite
   * at everything" and "every archetype must be viable".
   *
   * So each archetype's deviations from neutral are scaled to a fixed budget:
   * `surplusBudget` rating points of ceiling above neutral, paid for with
   * `surplusBudget × weaknessRatio` points below it, distributed in proportion to
   * the bias vector's own shape. The shape stays the game's; the price is level.
   */
  surplusBudget: 22,
  /**
   * Deficit points per point of surplus. Below one on purpose: an identity should
   * net out a slightly better golfer than a shapeless one, or specialising is a
   * tax rather than a decision.
   */
  weaknessRatio: 0.75,

  /**
   * Nothing bought with XP reaches 99. The handful of 99s on tour are accidents
   * of generation at the very top of a long career, and leaving them out of
   * reach keeps them worth something.
   */
  max: 97,
  /**
   * Even an archetype's worst rating stops here. A ceiling below this produces a
   * golfer who cannot function — and requirement or not, an unplayable build is
   * not a meaningful choice.
   */
  min: 62,
  /**
   * How much of the archetype's within-line bias survives as a per-rating offset.
   * Keeps a Bomber's driver distance a shade ahead of their ball speed instead of
   * flattening both to the line's number.
   */
  withinLineBias: 0.5,
  /** `launch` is not trainable, so it is set from the archetype around this. */
  launchBase: 74,
} as const;

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

export const PROGRESSION = {
  /** XP for one rating point at `pivot`. */
  costBase: 240,
  /** The rating at which a point costs exactly `costBase`. */
  costPivot: 70,
  /**
   * Compounding per rating point. 1.09 means a point at 90 costs five and a half
   * times a point at 70, which is the shape requirement 13 asks for: early
   * progress feels quick, the last few points of a career do not.
   */
  costGrowth: 1.09,

  /**
   * Soft caps, expressed as headroom to *this archetype's* ceiling rather than as
   * absolute ratings. That is the point: 88 is an ordinary number for an Elite
   * Putter's stroke and a career-defining one for a Ball Striker's, and a soft
   * cap written in absolute terms cannot tell the difference.
   */
  softCaps: [
    { headroomAbove: 12, multiplier: 1 },
    { headroomAbove: 6, multiplier: 1.5 },
    { headroomAbove: 2, multiplier: 2.4 },
    { headroomAbove: -1, multiplier: 3.8 },
  ] as { headroomAbove: number; multiplier: number }[],

  /** A line can only move up this far in one offseason, however much XP is banked. */
  maxGainPerLinePerOffseason: 6,

  /**
   * Age drift, applied each offseason before any XP is spent.
   *
   * A created golfer gets no free skill growth — every rating point is bought —
   * but they do age, and that is what gives the career an arc instead of a ramp.
   * After 30 the power goes, a little at a time; the head keeps improving until
   * the very end. Late career is spending XP to stand still in one place while
   * still gaining in another, which is exactly what it looks like from the
   * outside.
   */
  age: {
    /**
     * Age is a *deterministic offset* applied on top of the ratings a player has
     * bought, not a yearly nudge applied to them. Two reasons, and the second is
     * the important one. It cannot drift out of step with the golfer's age after
     * a reload, and — because what the player buys is never edited by anything
     * but the player — the bought line is always exactly the sum of what they
     * paid for, which is what makes the ceiling checkable.
     */
    /** Physical decline starts the season after this birthday. */
    declineFrom: 31,
    /** Rating points of physical decline per year past `declineFrom`. */
    declinePerYear: 0.9,
    /** Total decline stops here, however long the career runs. */
    declineCap: 14,
    /** Which lines the years take. */
    physicalLines: ['power', 'fitness'] as SkillLineId[],
    /** Which lines experience keeps paying into, and by how much a year. */
    experienceLines: ['courseManagement', 'nerve'] as SkillLineId[],
    experiencePerYear: 0.45,
    /** Experience stops accruing at this age, and stops at `experienceCap` anyway. */
    experienceUntilAge: 42,
    experienceCap: 6,
  },
} as const;

// ---------------------------------------------------------------------------
// Earning XP
// ---------------------------------------------------------------------------

/**
 * What a week is worth.
 *
 * Calibrated so that a season of solid-but-unremarkable golf — half the cuts
 * made, a couple of top-25s — buys around six or seven rating points spread
 * across a young golfer's game, which is roughly what the simulation's own
 * development engine hands an AI prospect of the same age. Playing badly still
 * earns something; playing well earns several times more.
 */
export const XP = {
  /** Turning up. Deliberately small: requirement 11 is that a round is not a payday. */
  perStart: 100,
  /** Playing the weekend. */
  madeCut: 200,

  /** Finishing position, which is most of a good week's XP. */
  finish: [
    { positionUpTo: 1, xp: 1800 },
    { positionUpTo: 3, xp: 900 },
    { positionUpTo: 5, xp: 560 },
    { positionUpTo: 10, xp: 380 },
    { positionUpTo: 25, xp: 220 },
    { positionUpTo: Infinity, xp: 80 },
  ] as { positionUpTo: number; xp: number }[],

  /** Everything except the per-start fee scales with what the week was worth. */
  tierMultiplier: { regular: 1, invitational: 1.25, major: 1.6 } as Record<string, number>,

  /** Things that happened on the golf course, which reward good play in bad weeks. */
  perBirdie: 6,
  perEagle: 40,
  perAlbatross: 250,
  /**
   * A low round, and a second tier for a genuinely low one. Measured against par
   * rather than in strokes, because the tour plays a par 71 and two par 72s and a
   * 68 is not the same round on each of them.
   */
  lowRoundToPar: -4,
  lowRoundXp: 120,
  veryLowRoundToPar: -7,
  veryLowRoundXp: 320,

  /**
   * Beating expectations: finishing better than your own world ranking. This is
   * the line that keeps a career moving when the golfer is not yet good enough
   * to collect top-10 money, and that stops paying once they are ranked where
   * they finish.
   */
  perPlaceBeatingRank: 6,
  beatingRankCap: 400,

  /** A new career-best finish. Once each, by definition. */
  personalBest: 400,

  /**
   * Hard ceilings, enforced wherever XP is awarded.
   *
   * These exist because of where the simulation runs. The tour is simulated in
   * the browser, so what reaches the store is a *claim* about a week — "I finished
   * third in the Coastal Open" — and a claim can be false. Two things keep that
   * bounded. XP is never accepted as a number: the caller says what happened and
   * `xpForEvent` decides what it is worth, so there is no field to inflate. And
   * these caps put a roof on the most an honest week or season can possibly pay,
   * so even a fabricated result cannot buy a career in an afternoon.
   *
   * A determined player running their own copy can still lie about their results.
   * The only real fix is simulating the tour server-side, which a game whose
   * whole season runs locally cannot do; these caps are the honest mitigation, not
   * a claim to have solved it.
   */
  maxPerEvent: 6000,
  maxPerSeasonBonus: 9000,
  /** More events than the calendar has is not a season anybody played. */
  maxEventsPerSeason: 24,

  /** Paid once at the end of the season, on the season's own record. */
  season: {
    perCutMade: 40,
    perTop10: 120,
    perWin: 600,
    /** Finishing in the top this many of the points standings. */
    standingsBonuses: [
      { rankUpTo: 1, xp: 3000 },
      { rankUpTo: 5, xp: 1400 },
      { rankUpTo: 15, xp: 800 },
      { rankUpTo: 40, xp: 400 },
      { rankUpTo: Infinity, xp: 120 },
    ] as { rankUpTo: number; xp: number }[],
    /** Beating your own previous best scoring average. */
    scoringAverageImproved: 500,
  },
} as const;

/**
 * Everything above, in one object, so a balance pass is one import and one diff.
 * Nothing reads this — it exists to be the answer to "where do I change the
 * numbers".
 */
export const CAREER_CONFIG = { CREATION, CAPS, PROGRESSION, XP, SKILL_LINES } as const;
