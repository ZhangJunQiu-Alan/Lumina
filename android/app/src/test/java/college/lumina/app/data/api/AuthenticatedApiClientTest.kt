package college.lumina.app.data.api

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthenticatedApiClientTest {
    @Test
    fun sendsBearerTokenAndQueryParameters() = runTest {
        var authorizationHeader: String? = null
        var timezoneParameter: String? = null
        val engine = MockEngine { request ->
            authorizationHeader = request.headers[HttpHeaders.Authorization]
            timezoneParameter = request.url.parameters["timezone"]
            respond(
                content = """{"data":{"streak":1}}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val client = AuthenticatedApiClient(
            session = FakeApiSession("token-1"),
            baseUrl = "https://example.supabase.co/functions/v1/api",
            httpClient = HttpClient(engine),
        )

        val body = client.get(
            path = "/api/home/overview",
            query = mapOf("timezone" to "Asia/Shanghai"),
        )

        assertEquals("Bearer token-1", authorizationHeader)
        assertEquals("Asia/Shanghai", timezoneParameter)
        assertEquals("""{"data":{"streak":1}}""", body)
    }

    @Test
    fun refreshesSessionOnceAfterUnauthorizedResponse() = runTest {
        val session = FakeApiSession("expired-token")
        val authorizationHeaders = mutableListOf<String?>()
        var requestCount = 0
        val engine = MockEngine { request ->
            requestCount += 1
            authorizationHeaders += request.headers[HttpHeaders.Authorization]
            if (requestCount == 1) {
                respond(
                    content = """{"error":"Invalid or expired session"}""",
                    status = HttpStatusCode.Unauthorized,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            } else {
                respond(
                    content = """{"data":{}}""",
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }
        }
        val client = AuthenticatedApiClient(
            session = session,
            baseUrl = "https://example.supabase.co/functions/v1/api",
            httpClient = HttpClient(engine),
        )

        client.get("/api/home/overview")

        assertEquals(1, session.refreshCount)
        assertEquals(listOf("Bearer expired-token", "Bearer refreshed-token"), authorizationHeaders)
    }

    @Test
    fun sendsJsonPostBodyWithBearerToken() = runTest {
        var method: HttpMethod? = null
        var authorizationHeader: String? = null
        var contentType: String? = null
        var requestBody: String? = null
        val engine = MockEngine { request ->
            method = request.method
            authorizationHeader = request.headers[HttpHeaders.Authorization]
            val outgoingContent = request.body as OutgoingContent.ByteArrayContent
            contentType = request.headers[HttpHeaders.ContentType] ?: outgoingContent.contentType?.toString()
            requestBody = outgoingContent.bytes().decodeToString()
            respond(
                content = """{"data":{"completed":false}}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val client = AuthenticatedApiClient(
            session = FakeApiSession("token-1"),
            baseUrl = "https://example.supabase.co/functions/v1/api",
            httpClient = HttpClient(engine),
        )

        val body = client.post(
            path = "/api/learning/groups/group-1/session",
            body = """{"round":"round1"}""",
        )

        assertEquals(HttpMethod.Post, method)
        assertEquals("Bearer token-1", authorizationHeader)
        assertEquals("application/json", contentType)
        assertEquals("""{"round":"round1"}""", requestBody)
        assertEquals("""{"data":{"completed":false}}""", body)
    }

    @Test
    fun sendsAuthenticatedDeleteRequest() = runTest {
        var method: HttpMethod? = null
        var authorizationHeader: String? = null
        val engine = MockEngine { request ->
            method = request.method
            authorizationHeader = request.headers[HttpHeaders.Authorization]
            respond(
                content = """{"data":{"removed":true}}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val client = AuthenticatedApiClient(
            session = FakeApiSession("token-1"),
            baseUrl = "https://example.supabase.co/functions/v1/api",
            httpClient = HttpClient(engine),
        )

        client.delete("/api/library/saved-words/word-1")

        assertEquals(HttpMethod.Delete, method)
        assertEquals("Bearer token-1", authorizationHeader)
    }
}

private class FakeApiSession(
    private var token: String,
) : ApiSession {
    var refreshCount = 0
        private set

    override fun currentAccessTokenOrNull(): String = token

    override suspend fun refreshCurrentSession() {
        refreshCount += 1
        token = "refreshed-token"
    }
}
