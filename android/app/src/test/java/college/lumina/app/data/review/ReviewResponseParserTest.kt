package college.lumina.app.data.review

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewResponseParserTest {
    @Test
    fun parsesDueWordsAndAttemptTransitions() {
        val parser = ReviewResponseParser()
        val session = parser.parseSession(
            """
            {
              "data": {
                "words": [
                  {
                    "id": "word-1",
                    "word": "course",
                    "phonetic": "/kɔːs/",
                    "pos_tags": ["n."],
                    "chinese_definition": "课程",
                    "senses": [{
                      "pos": "n.",
                      "meaning_zh": "课程",
                      "example_sentence": "The course starts today.",
                      "example_translation_zh": "课程今天开始。"
                    }],
                    "memoryState": "fuzzy",
                    "nextReviewAt": "2026-06-11T00:00:00Z"
                  }
                ]
              }
            }
            """.trimIndent(),
        )
        val attempt = parser.parseAttempt(
            """
            {
              "data": {
                "memoryState": "slow_recall",
                "nextReviewAt": "2026-06-14T00:00:00Z",
                "graduated": false,
                "transition": {
                  "from": "fuzzy",
                  "to": "slow_recall",
                  "source": "review",
                  "result": "fast_correct",
                  "graduated": false,
                  "nextReviewAt": "2026-06-14T00:00:00Z"
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals("课程", session.words.single().chineseDefinition)
        assertEquals("The course starts today.", session.words.single().senses.single().exampleSentence)
        assertEquals("slow_recall", attempt.transition.to)
        assertTrue(attempt.transition.result == "fast_correct")
    }
}
