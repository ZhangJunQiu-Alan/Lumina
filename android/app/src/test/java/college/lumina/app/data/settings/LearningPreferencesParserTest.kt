package college.lumina.app.data.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LearningPreferencesParserTest {
    private val parser = LearningPreferencesParser()

    @Test
    fun parsesLearningPreferencesEnvelope() {
        val preferences = parser.parse(
            """
            {
              "data": {
                "defaultPronunciationLocale": "us",
                "ieltsTargetScore": 7.5,
                "speechPlaybackRate": 0.8,
                "autoPlayEnabled": true,
                "autoPlayRepeatCount": 2,
                "autoPlayRepeatGapMs": 2500,
                "correctAnswerRevealMs": 1500,
                "wrongAnswerRevealMs": 5000,
                "round2Enabled": false,
                "reinforcementRound3Enabled": true,
                "reinforcementArticleEnabled": true,
                "popoverAutoPlayEnabled": true,
                "clozeSentenceAutoPlayEnabled": false,
                "memoryTipEnabled": false
              }
            }
            """.trimIndent(),
        )

        assertEquals("us", preferences.defaultPronunciationLocale)
        assertEquals(7.5, preferences.ieltsTargetScore, 0.0)
        assertEquals(0.8, preferences.speechPlaybackRate, 0.0)
        assertEquals(2, preferences.autoPlayRepeatCount)
        assertEquals(2500, preferences.autoPlayRepeatGapMs)
        assertEquals(1500, preferences.correctAnswerRevealMs)
        assertEquals(5000, preferences.wrongAnswerRevealMs)
        assertEquals(false, preferences.round2Enabled)
        assertEquals(true, preferences.reinforcementRound3Enabled)
        assertEquals(true, preferences.reinforcementArticleEnabled)
        assertEquals(true, preferences.popoverAutoPlayEnabled)
        assertEquals(false, preferences.clozeSentenceAutoPlayEnabled)
        assertEquals(false, preferences.memoryTipEnabled)
    }

    @Test
    fun encodesDefaultsForSaving() {
        val encoded = parser.encode(DefaultLearningPreferences)

        assertTrue(encoded.contains("\"defaultPronunciationLocale\":\"uk\""))
        assertTrue(encoded.contains("\"memoryTipEnabled\":true"))
    }
}
