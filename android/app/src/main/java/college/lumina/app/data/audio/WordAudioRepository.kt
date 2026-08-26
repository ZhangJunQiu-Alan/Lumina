package college.lumina.app.data.audio

import college.lumina.app.data.api.AuthenticatedApiClient
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

interface WordAudioRepository {
    suspend fun fetchAudioUrl(
        word: String,
        locale: String,
    ): String
}

class RemoteWordAudioRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: WordAudioResponseParser = WordAudioResponseParser(),
) : WordAudioRepository {
    override suspend fun fetchAudioUrl(
        word: String,
        locale: String,
    ): String {
        val encodedWord = URLEncoder
            .encode(word.trim(), StandardCharsets.UTF_8.toString())
            .replace("+", "%20")
        return parser.parse(
            apiClient.get(
                path = "/api/audio/$encodedWord",
                query = mapOf("locale" to locale),
            ),
        )
    }
}

class WordAudioResponseParser(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    fun parse(rawBody: String): String =
        json.decodeFromString<WordAudioEnvelope>(rawBody).data
}

@Serializable
private data class WordAudioEnvelope(
    val data: String,
)
