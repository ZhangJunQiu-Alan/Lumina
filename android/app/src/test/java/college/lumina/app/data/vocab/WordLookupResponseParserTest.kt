package college.lumina.app.data.vocab

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WordLookupResponseParserTest {
    private val parser = WordLookupResponseParser()

    @Test
    fun parsesLookupResult() {
        val result = parser.parseLookup(
            """
            {
              "data": {
                "vocabulary_item": {
                  "id": "word-1",
                  "word": "course",
                  "ipa_uk": "/kɔːs/",
                  "ipa_us": "/kɔːrs/",
                  "primary_meaning_zh": "课程",
                  "memory_tip": "联想 course"
                },
                "senses": [
                  {"pos": "n.", "meaning_zh": "课程"}
                ],
                "in_user_library": true,
                "srs_state": null
              }
            }
            """.trimIndent(),
        )

        assertEquals("course", result?.vocabularyItem?.word)
        assertEquals("/kɔːs/", result?.vocabularyItem?.ipaUk)
        assertEquals("课程", result?.senses?.single()?.meaningZh)
        assertTrue(result?.inUserLibrary == true)
        assertNull(result?.srsState)
    }

    @Test
    fun parsesMissingLookupAndSaveResult() {
        assertNull(parser.parseLookup("""{"data":null,"missing":true}"""))

        val saved = parser.parseSave(
            """{"data":{"vocabularyItemId":"word-1","saved":false,"inserted":false,"skippedReason":"non_new_state"}}""",
        )
        assertFalse(saved.saved)
        assertEquals("non_new_state", saved.skippedReason)
    }
}
