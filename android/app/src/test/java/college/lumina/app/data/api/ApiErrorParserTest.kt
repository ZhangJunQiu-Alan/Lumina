package college.lumina.app.data.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiErrorParserTest {
    @Test
    fun readsServerErrorMessage() {
        assertEquals(
            "Invalid or expired session",
            ApiErrorParser.messageFrom("""{"error":"Invalid or expired session"}"""),
        )
    }

    @Test
    fun ignoresInvalidPayload() {
        assertNull(ApiErrorParser.messageFrom("not-json"))
    }
}
