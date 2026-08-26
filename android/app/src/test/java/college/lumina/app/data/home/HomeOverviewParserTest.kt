package college.lumina.app.data.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HomeOverviewParserTest {
    private val parser = HomeOverviewParser()

    @Test
    fun parsesHomeOverviewEnvelope() {
        val overview = parser.parse(
            """
            {
              "data": {
                "todayReviewCount": 12,
                "streak": 4,
                "perfectCheckinDays": 3,
                "stableRecallCount": 88,
                "orbitDays": [
                  {
                    "date": "2026-06-11",
                    "weekdayLabel": "周四",
                    "shortDateLabel": "6/11",
                    "status": "perfect",
                    "reviewWordCount": 12,
                    "learnedWordCount": 20
                  }
                ],
                "activityDays": [],
                "selectedDate": "2026-06-11",
                "selectedDayReviewWordCount": 12,
                "selectedDayLearnedWordCount": 20,
                "resumeCandidate": null,
                "routineCard": {
                  "state": "in_progress",
                  "title": "继续今日学习",
                  "subtitle": "完成剩余步骤",
                  "ctaLabel": "继续学习",
                  "ctaMode": "continue_learning",
                  "boundLearningGroupId": "group-1",
                  "visibleSteps": [
                    {"key":"review","label":"到期复习","status":"completed"},
                    {"key":"round1","label":"第一轮","status":"current"}
                  ],
                  "lastUsedOfficialLibraryId": "ielts-vocab",
                  "lastUsedOfficialMode": "sequential",
                  "lastUsedOfficialGroupCount": 2,
                  "selectedOfficialLibraryId": "ielts-vocab",
                  "officialLibraryOptions": [
                    {
                      "libraryId": "ielts-vocab",
                      "title": "雅思词汇真经",
                      "mode": "sequential",
                      "existingGroupCount": 2,
                      "activeGroupId": "group-1",
                      "activeRound": "round1",
                      "confirmedWordCount": 10,
                      "loadedWordCount": 40,
                      "completedMemoryWordCount": 88,
                      "totalWordCount": 3631
                    }
                  ]
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals(12, overview.todayReviewCount)
        assertEquals("perfect", overview.orbitDays.single().status)
        assertEquals("continue_learning", overview.routineCard.ctaMode)
        assertEquals("雅思词汇真经", overview.routineCard.officialLibraryOptions.single().title)
        assertNull(overview.resumeCandidate)
    }
}
