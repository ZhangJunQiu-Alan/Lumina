package college.lumina.app.data.ielts

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface IeltsRepository {
    suspend fun fetchDashboard(): IeltsDashboard

    suspend fun fetchReadingTest(testId: String): IeltsReadingTest

    suspend fun fetchListeningTest(testId: String): IeltsListeningTest

    suspend fun submitReadingAttempt(
        test: IeltsReadingTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsReadingEvaluation,
    ): SubmittedIeltsAttempt

    suspend fun submitListeningAttempt(
        test: IeltsListeningTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsListeningEvaluation,
    ): SubmittedIeltsAttempt
}

class RemoteIeltsRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: IeltsDashboardParser = IeltsDashboardParser(),
) : IeltsRepository {
    override suspend fun fetchDashboard(): IeltsDashboard =
        parser.parse(apiClient.get("/api/ielts/dashboard"))

    override suspend fun fetchReadingTest(testId: String): IeltsReadingTest =
        parser.parseReadingTest(apiClient.get("/api/ielts/reading/tests/$testId"))

    override suspend fun fetchListeningTest(testId: String): IeltsListeningTest =
        parser.parseListeningTest(apiClient.get("/api/ielts/listening/tests/$testId"))

    override suspend fun submitReadingAttempt(
        test: IeltsReadingTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsReadingEvaluation,
    ): SubmittedIeltsAttempt {
        val request = SubmitReadingAttemptRequest(
            testId = test.id,
            startedAt = startedAt,
            submittedAt = java.time.Instant.now().toString(),
            elapsedSeconds = elapsedSeconds,
            score = evaluation.score,
            totalQuestions = evaluation.totalQuestions,
            responses = evaluation.responses,
        )
        return parser.parseSubmittedAttempt(
            apiClient.post("/api/ielts/reading/attempts", parser.encode(request)),
        )
    }

    override suspend fun submitListeningAttempt(
        test: IeltsListeningTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsListeningEvaluation,
    ): SubmittedIeltsAttempt {
        val request = SubmitListeningAttemptRequest(
            testId = test.id,
            startedAt = startedAt,
            submittedAt = java.time.Instant.now().toString(),
            elapsedSeconds = elapsedSeconds,
            score = evaluation.score,
            totalQuestions = evaluation.totalQuestions,
            responses = evaluation.responses,
        )
        return parser.parseSubmittedAttempt(
            apiClient.post("/api/ielts/listening/attempts", parser.encode(request)),
        )
    }
}

class IeltsDashboardParser(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    fun parse(rawBody: String): IeltsDashboard =
        json.decodeFromString<IeltsDashboardEnvelope>(rawBody).data

    fun parseReadingTest(rawBody: String): IeltsReadingTest =
        json.decodeFromString<IeltsReadingTestEnvelope>(rawBody).data

    fun parseListeningTest(rawBody: String): IeltsListeningTest =
        json.decodeFromString<IeltsListeningTestEnvelope>(rawBody).data

    fun parseSubmittedAttempt(rawBody: String): SubmittedIeltsAttempt =
        json.decodeFromString<SubmittedAttemptEnvelope>(rawBody).data

    fun encode(request: SubmitReadingAttemptRequest): String =
        json.encodeToString(request)

    fun encode(request: SubmitListeningAttemptRequest): String =
        json.encodeToString(request)
}

@Serializable
private data class IeltsDashboardEnvelope(
    val data: IeltsDashboard,
)

@Serializable
private data class IeltsReadingTestEnvelope(
    val data: IeltsReadingTest,
)

@Serializable
private data class IeltsListeningTestEnvelope(
    val data: IeltsListeningTest,
)

@Serializable
data class SubmitReadingAttemptRequest(
    val testId: String,
    val startedAt: String,
    val submittedAt: String,
    val elapsedSeconds: Int,
    val score: Int,
    val totalQuestions: Int,
    val responses: List<IeltsReadingResponse>,
)

@Serializable
private data class SubmittedAttemptEnvelope(
    val data: SubmittedIeltsAttempt,
)

@Serializable
data class SubmitListeningAttemptRequest(
    val testId: String,
    val startedAt: String,
    val submittedAt: String,
    val elapsedSeconds: Int,
    val score: Int,
    val totalQuestions: Int,
    val responses: List<IeltsReadingResponse>,
)
