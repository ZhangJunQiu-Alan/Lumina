package college.lumina.app.data.learning

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class LearningResponseParserTest {
    @Test
    fun parsesLearningSessionEnvelope() {
        val data = LearningResponseParser().parseSession(
            """
            {
              "data": {
                "group": {
                  "id": "group-1",
                  "title": "雅思词汇真经",
                  "sourceType": "system",
                  "libraryId": "ielts-vocab",
                  "officialMode": "sequential",
                  "status": "active"
                },
                "session": {
                  "round": "round2",
                  "currentIndex": 1,
                  "queueWordIds": ["word-1", "word-2"],
                  "passedQueueIndices": [0],
                  "round1ConfirmedWordIds": ["word-1", "word-2"]
                },
                "words": [
                  {
                    "id": "word-1",
                    "word": "course",
                    "meaning": "课程",
                    "senses": [{"pos": "n.", "meaning": "课程"}],
                    "round2ChoiceDistractors": [
                      {"word": "cause", "pos": "n.", "meaningZh": "原因"}
                    ]
                  }
                ],
                "preferences": {
                  "recallEnabled": true,
                  "dictationEnabled": true
                },
                "completed": false
              }
            }
            """.trimIndent(),
        )

        assertEquals("group-1", data.group.id)
        assertEquals("round2", data.session?.round)
        assertEquals("课程", data.words.single().senses.single().meaning)
        assertEquals("cause", data.words.single().round2ChoiceDistractors.single().word)
        assertFalse(data.completed)
    }
}
