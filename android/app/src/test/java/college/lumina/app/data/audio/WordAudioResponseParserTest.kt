package college.lumina.app.data.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class WordAudioResponseParserTest {
    @Test
    fun parsesAudioUrlEnvelope() {
        val url = WordAudioResponseParser().parse(
            """{"data":"https://example.com/audio/course-uk.mp3"}""",
        )

        assertEquals("https://example.com/audio/course-uk.mp3", url)
    }
}
