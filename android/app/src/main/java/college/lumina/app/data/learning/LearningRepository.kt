package college.lumina.app.data.learning

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface LearningRepository {
    suspend fun fetchGroup(groupId: String): LearningSessionData

    suspend fun startOfficial(
        libraryId: String,
        mode: String,
        timeZone: String,
    ): LearningSessionData

    suspend fun saveSession(
        groupId: String,
        request: SaveLearningSessionRequest,
    ): LearningSessionData

    suspend fun completeRound(
        groupId: String,
        request: CompleteLearningRoundRequest,
    ): LearningSessionData

    suspend fun submitAttempt(request: ReviewAttemptRequest)
}

class RemoteLearningRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: LearningResponseParser = LearningResponseParser(),
) : LearningRepository {
    override suspend fun fetchGroup(groupId: String): LearningSessionData =
        parser.parseSession(apiClient.get("/api/learning/groups/$groupId"))

    override suspend fun startOfficial(
        libraryId: String,
        mode: String,
        timeZone: String,
    ): LearningSessionData = parser.parseSession(
        apiClient.post(
            "/api/learning/official/$libraryId/start",
            parser.encode(StartOfficialLearningRequest(mode, timeZone)),
        ),
    )

    override suspend fun saveSession(
        groupId: String,
        request: SaveLearningSessionRequest,
    ): LearningSessionData = parser.parseSession(
        apiClient.post(
            "/api/learning/groups/$groupId/session",
            parser.encode(request),
        ),
    )

    override suspend fun completeRound(
        groupId: String,
        request: CompleteLearningRoundRequest,
    ): LearningSessionData = parser.parseSession(
        apiClient.post(
            "/api/learning/groups/$groupId/complete-round",
            parser.encode(request),
        ),
    )

    override suspend fun submitAttempt(request: ReviewAttemptRequest) {
        apiClient.post("/api/review/attempt", parser.encode(request))
    }
}

class LearningResponseParser(
    @PublishedApi internal val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    fun parseSession(rawBody: String): LearningSessionData =
        json.decodeFromString<LearningSessionEnvelope>(rawBody).data

    inline fun <reified T> encode(value: T): String = json.encodeToString(value)
}

@Serializable
private data class LearningSessionEnvelope(
    val data: LearningSessionData,
)
