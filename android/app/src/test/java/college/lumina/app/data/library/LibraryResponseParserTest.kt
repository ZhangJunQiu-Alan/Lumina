package college.lumina.app.data.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryResponseParserTest {
    private val parser = LibraryResponseParser()

    @Test
    fun parsesSavedWordsEnvelope() {
        val words = parser.parseSavedWords(
            """
            {
              "data": [{
                "id": "row-1",
                "vocabularyItemId": "word-1",
                "word": "course",
                "meaning": "课程",
                "isInActiveLearningGroup": true
              }]
            }
            """.trimIndent(),
        )

        assertEquals("course", words.single().word)
        assertTrue(words.single().isInActiveLearningGroup)
    }

    @Test
    fun parsesCreatedSavedWordsGroup() {
        val result = parser.parseCreatedGroup(
            """{"data":{"groupId":"group-1","wordCount":30}}""",
        )

        assertEquals("group-1", result.groupId)
        assertEquals(30, result.wordCount)
    }
}
