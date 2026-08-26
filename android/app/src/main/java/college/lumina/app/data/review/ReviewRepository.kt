package college.lumina.app.data.review

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface ReviewRepository {
    suspend fun startSession(timeZone: String): ReviewSessionData

    suspend fun submitAttempt(request: SubmitReviewAttemptRequest): ReviewAttemptResult

    suspend fun markUnknown(request: MarkReviewWordUnknownRequest): ReviewAttemptResult

    suspend fun markMastered(request: MarkReviewWordMasteredRequest): ReviewAttemptResult

    suspend fun completeSession(timeZone: String)
}

class RemoteReviewRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: ReviewResponseParser = ReviewResponseParser(),
) : ReviewRepository {
    override suspend fun startSession(timeZone: String): ReviewSessionData =
        parser.parseSession(
            apiClient.post(
                "/api/review/session/start",
                parser.encode(ReviewSessionRequest(timeZone)),
            ),
        )

    override suspend fun submitAttempt(request: SubmitReviewAttemptRequest): ReviewAttemptResult =
        parser.parseAttempt(
            apiClient.post("/api/review/attempt", parser.encode(request)),
        )

    override suspend fun markUnknown(request: MarkReviewWordUnknownRequest): ReviewAttemptResult =
        parser.parseAttempt(
            apiClient.post("/api/review/unknown", parser.encode(request)),
        )

    override suspend fun markMastered(request: MarkReviewWordMasteredRequest): ReviewAttemptResult =
        parser.parseAttempt(
            apiClient.post("/api/review/mastered", parser.encode(request)),
        )

    override suspend fun completeSession(timeZone: String) {
        apiClient.post(
            "/api/review/session/complete",
            parser.encode(ReviewSessionRequest(timeZone)),
        )
    }
}

class ReviewResponseParser(
    @PublishedApi internal val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    fun parseSession(rawBody: String): ReviewSessionData =
        json.decodeFromString<ReviewSessionEnvelope>(rawBody).data

    fun parseAttempt(rawBody: String): ReviewAttemptResult =
        json.decodeFromString<ReviewAttemptEnvelope>(rawBody).data

    inline fun <reified T> encode(value: T): String = json.encodeToString(value)
}

@Serializable
private data class ReviewSessionEnvelope(
    val data: ReviewSessionData,
)

@Serializable
private data class ReviewAttemptEnvelope(
    val data: ReviewAttemptResult,
)
