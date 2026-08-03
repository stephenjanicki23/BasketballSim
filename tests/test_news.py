"""The newsroom.

The rule that matters for generated sports writing is that a story cannot
carry a number the data did not supply, and the test that matters is the one
that reads the finished prose back and checks. `TestNoInventedStatistics` pulls
every numeral out of every headline, standfirst, summary and article across a
whole simulated season and fails on any figure that was never recorded through
`Copy` -- which is the only way a number can legitimately get into a sentence.

Everything else here is about a feed being readable: the shape the home page
expects, the length a story is written to, and the fact that a night of
forty-five games does not produce a front page containing six of the same
story.

Run with:  python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import re
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bballsim import news
from bballsim.api.payload import bootstrap
from bballsim.league.calendar import build_daily_schedule
from bballsim.league.league import League
from bballsim.placeholder import make_teams

# Every run of numerals in a sentence: "125-120" is two, "42.1" is one.
NUMERALS = re.compile(r"\d+(?:\.\d+)?")

# Words that legitimately spell a number rather than printing one. A story is
# allowed to say "the three that usually define one" without that counting as
# a statistic, but it is not allowed to print a digit nobody measured.
ARTICLE_MIN_WORDS = 150
ARTICLE_MAX_WORDS = 300


def played_league(games_per_team: int = 6, teams: int = 10) -> League:
    """A league that has actually played, so there is something to report."""
    league = League(name="Test League", season="2026-27")
    for team in make_teams(teams):
        league.add_team(team)
    league.set_schedule(build_daily_schedule(
        list(league.teams), start_date=date(2026, 10, 20),
        games_per_team=games_per_team,
    ))
    league.clock.jump_to(league.schedule[-1].tipoff_at + timedelta(days=2))
    league.tick()
    return league


def every_story(league: League) -> list[news.Story]:
    """Every story every detector can produce, not just the ones that made the
    feed -- the caps in `write_stories` would otherwise hide most of them from
    these checks."""
    room = news.Newsroom(league=league)
    stories = []
    for detector in (news.streaks, news.mvp_race, news.coaching, news.league_news):
        stories.extend(detector(room))
    for night in room.nights:
        for detector in (news.triple_doubles, news.season_highs, news.big_games,
                         news.milestones, news.rookie_watch, news.recaps):
            stories.extend(detector(room, night))
    return stories


class TestNoInventedStatistics(unittest.TestCase):
    """The one rule the whole module exists to keep."""

    @classmethod
    def setUpClass(cls):
        cls.league = played_league()
        cls.stories = every_story(cls.league)

    def test_the_detectors_actually_produced_something(self):
        """Or every check below passes on an empty list and proves nothing."""
        self.assertGreater(len(self.stories), 20, "no stories to check")
        categories = {s.category for s in self.stories}
        self.assertGreaterEqual(len(categories), 5, categories)

    def test_every_number_in_every_story_came_from_the_data(self):
        for story in self.stories:
            text = " ".join(
                (story.headline, story.subheadline, story.summary, story.article)
            )
            for numeral in NUMERALS.findall(text):
                self.assertIn(
                    numeral, story.figures,
                    f"{story.id}: '{numeral}' appears in the story but was never "
                    f"recorded as a figure.\n{text}",
                )

    def test_recorded_figures_are_not_a_free_pass(self):
        """The check above is only worth anything if `figures` is a tight set
        rather than every number under the sun."""
        for story in self.stories:
            self.assertLess(
                len(story.figures), 120,
                f"{story.id} recorded {len(story.figures)} figures, which is broad "
                f"enough that the invented-statistic check would pass on anything",
            )

    def test_a_figure_that_was_never_recorded_is_caught(self):
        """Guard the guard: a doctored story must fail the same check."""
        story = self.stories[0]
        doctored = f"{story.article} He also scored 999999 points."
        loose = [n for n in NUMERALS.findall(doctored) if n not in story.figures]
        self.assertEqual(loose, ["999999"])


class TestStoryShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.league = played_league()
        cls.stories = every_story(cls.league)

    def test_every_field_the_home_page_reads_is_present(self):
        for story in self.stories:
            data = story.to_dict()
            for key in ("headline", "subheadline", "category", "importance",
                        "summary", "article"):
                self.assertTrue(data[key], f"{story.id} has an empty {key}")

    def test_headlines_are_five_to_twelve_words(self):
        for story in self.stories:
            words = len(story.headline.split())
            self.assertGreaterEqual(words, 5, f"{story.id}: {story.headline}")
            self.assertLessEqual(words, 12, f"{story.id}: {story.headline}")

    def test_a_subheadline_and_a_summary_are_one_sentence_each(self):
        for story in self.stories:
            for field, text in (("subheadline", story.subheadline),
                                ("summary", story.summary)):
                self.assertTrue(text.endswith("."), f"{story.id} {field}: {text}")
                # Decimals and records contain full stops; count sentence ends.
                sentences = re.findall(r"\.(?:\s|$)", text)
                self.assertEqual(len(sentences), 1, f"{story.id} {field}: {text}")

    def test_articles_are_written_to_length(self):
        for story in self.stories:
            words = len(story.article.split())
            self.assertGreaterEqual(
                words, ARTICLE_MIN_WORDS, f"{story.id} ran short at {words} words")
            self.assertLessEqual(
                words, ARTICLE_MAX_WORDS, f"{story.id} ran long at {words} words")

    def test_articles_are_three_paragraphs(self):
        for story in self.stories:
            blocks = [b for b in story.article.split("\n\n") if b.strip()]
            self.assertEqual(len(blocks), 3, f"{story.id} has {len(blocks)} paragraphs")

    def test_importance_is_a_percentage(self):
        for story in self.stories:
            self.assertGreaterEqual(story.importance, 1, story.id)
            self.assertLessEqual(story.importance, 100, story.id)

    def test_a_triple_double_outranks_a_routine_recap(self):
        by_category = {}
        for story in self.stories:
            by_category.setdefault(story.category, []).append(story.importance)
        if news.TRIPLE_DOUBLE in by_category and news.GAME_RECAP in by_category:
            self.assertGreater(
                min(by_category[news.TRIPLE_DOUBLE]),
                max(by_category[news.GAME_RECAP]),
            )

    def test_no_story_contains_an_unresolved_placeholder(self):
        for story in self.stories:
            text = story.headline + story.subheadline + story.summary + story.article
            for bad in ("None", "{", "}", "  ", " ."):
                self.assertNotIn(bad, text, f"{story.id}: {text[:200]}")

    def test_a_story_never_claims_the_wrong_side_won_something(self):
        """A recap reported "the winners took the glass 51-56" on a night the
        winners were out-rebounded. Every number here is real and the sentence
        around it was still false, which is the failure mode a figures audit
        cannot see."""
        for story in self.stories:
            for match in re.finditer(
                r"Rebounds finished (\d+)-(\d+)([^.]*)", story.article
            ):
                ours, theirs, claim = match.groups()
                if "winners" in claim:
                    self.assertGreater(int(ours), int(theirs), story.article)
                elif "taking the glass" in claim:
                    self.assertGreater(int(theirs), int(ours), story.article)
                elif "level" in claim:
                    self.assertEqual(int(ours), int(theirs), story.article)

    def test_ratings_reach_the_page_rounded(self):
        """Coach ratings are stored as floats. "rates 47.2168 for offence" is a
        raw value that escaped onto a news page once already."""
        for story in self.stories:
            if story.category != news.COACHING:
                continue
            for value in re.findall(r"\d+\.\d+", story.article):
                self.assertLessEqual(
                    len(value.split(".")[1]), 1,
                    f"{story.id} printed {value} to more than one decimal",
                )

    def test_no_story_opens_a_sentence_with_a_zero_count(self):
        """"0 games went to overtime" is a non-fact using up a sentence."""
        for story in self.stories:
            for sentence in re.split(r"(?<=\.)\s+", story.article):
                self.assertFalse(
                    sentence.startswith("0 "), f"{story.id}: {sentence}")

    def test_club_possessives_are_not_mangled(self):
        """Plural nicknames take a bare apostrophe: the Monarchs' win."""
        self.assertEqual(news.possessive("Monarchs"), "Monarchs'")
        self.assertEqual(news.possessive("Forge"), "Forge's")
        for story in self.stories:
            self.assertNotIn("s's", story.article, story.id)


class TestTheFeedIsReadable(unittest.TestCase):
    """Ranking alone makes a log, not a front page."""

    @classmethod
    def setUpClass(cls):
        cls.league = played_league(games_per_team=8)
        cls.feed = news.write_stories(cls.league, limit=12)

    def test_the_feed_fills_up(self):
        self.assertGreater(len(self.feed), 4)
        self.assertLessEqual(len(self.feed), 12)

    def test_it_is_ordered_by_importance(self):
        scores = [s.importance for s in self.feed]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_no_category_takes_over_the_page(self):
        counts: dict[str, int] = {}
        for story in self.feed:
            counts[story.category] = counts.get(story.category, 0) + 1
        for category, count in counts.items():
            self.assertLessEqual(
                count, news.CATEGORY_LIMIT.get(category, 1),
                f"{category} appears {count} times",
            )

    def test_the_page_carries_more_than_one_kind_of_news(self):
        self.assertGreaterEqual(len({s.category for s in self.feed}), 3)

    def test_a_player_is_the_subject_of_at_most_one_story(self):
        seen = []
        for story in self.feed:
            seen.extend(story.player_ids)
        self.assertEqual(len(seen), len(set(seen)), "a player appears twice")

    def test_a_game_is_covered_once(self):
        games = [s.game_id for s in self.feed if s.game_id]
        self.assertEqual(len(games), len(set(games)), "a game is covered twice")

    def test_the_same_league_writes_the_same_feed(self):
        """Deterministic, like everything else in the sim: an article must not
        rewrite itself between refreshes."""
        again = news.write_stories(self.league, limit=12)
        self.assertEqual(
            [(s.id, s.headline, s.article) for s in self.feed],
            [(s.id, s.headline, s.article) for s in again],
        )

    def test_two_stories_of_a_kind_do_not_read_alike(self):
        by_category: dict[str, list[str]] = {}
        for story in self.feed:
            by_category.setdefault(story.category, []).append(story.article)
        for category, articles in by_category.items():
            if len(articles) < 2:
                continue
            closers = [a.split("\n\n")[-1] for a in articles]
            self.assertEqual(
                len(set(closers)), len(closers),
                f"two {category} stories close with the same sentence",
            )


class TestAnUnplayedSeason(unittest.TestCase):
    """A newsroom with nothing to report must say nothing, not guess."""

    def test_no_games_means_no_stories(self):
        league = League(name="Test League", season="2026-27")
        for team in make_teams(6):
            league.add_team(team)
        league.set_schedule(build_daily_schedule(
            list(league.teams), start_date=date(2026, 10, 20),
            games_per_team=4,
        ))
        self.assertEqual(news.write_stories(league), [])

    def test_the_bootstrap_still_carries_the_key(self):
        league = League(name="Test League", season="2026-27")
        for team in make_teams(6):
            league.add_team(team)
        payload = bootstrap(league)
        self.assertIn("news", payload)
        self.assertEqual(payload["news"], [])


class TestTheHomePagePayload(unittest.TestCase):
    def test_the_feed_ships_in_the_bootstrap(self):
        league = played_league()
        payload = bootstrap(league)
        self.assertGreater(len(payload["news"]), 0)
        first = payload["news"][0]
        for key in ("id", "headline", "subheadline", "category", "importance",
                    "summary", "article", "day", "gameId", "teamIds", "playerIds"):
            self.assertIn(key, first)

    def test_stories_point_at_clubs_that_exist(self):
        league = played_league()
        payload = bootstrap(league)
        known = {t["id"] for t in payload["teams"]}
        for story in payload["news"]:
            for team_id in story["teamIds"]:
                self.assertIn(team_id, known, story["id"])

    def test_stories_point_at_games_that_exist(self):
        league = played_league()
        payload = bootstrap(league)
        fixtures = {g.id for g in league.schedule}
        for story in payload["news"]:
            if story["gameId"]:
                self.assertIn(story["gameId"], fixtures, story["id"])


if __name__ == "__main__":
    unittest.main()
