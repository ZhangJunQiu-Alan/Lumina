package college.lumina.app.data.settings

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface LearningPreferencesRepository {
    suspend fun fetchPreferences(): LearningPreferences

    suspend fun savePreferences(preferences: LearningPreferences): LearningPreferences
}

class RemoteLearningPreferencesRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: LearningPreferencesParser = LearningPreferencesParser(),
) : LearningPreferencesRepository {
    override suspend fun fetchPreferences(): LearningPreferences =
        parser.parse(
            apiClient.get("/api/settings/learning-preferences"),
        )

    override suspend fun savePreferences(preferences: LearningPreferences): LearningPreferences =
        parser.parse(
            apiClient.post(
                path = "/api/settings/learning-preferences",
                body = parser.encode(preferences),
            ),
        )
}

class LearningPreferencesParser(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    fun parse(rawBody: String): LearningPreferences =
        json.decodeFromString<LearningPreferencesEnvelope>(rawBody).data

    fun encode(preferences: LearningPreferences): String =
        json.encodeToString(preferences)
}

@Serializable
private data class LearningPreferencesEnvelope(
    val data: LearningPreferences,
)
