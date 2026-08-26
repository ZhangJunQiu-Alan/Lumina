package college.lumina.app.data.vocab

import college.lumina.app.data.api.AuthenticatedApiClient
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface WordLookupRepository {
    suspend fun lookup(word: String): WordLookupResult?

    suspend fun save(vocabularyItemId: String): SaveWordResult

    suspend fun remove(vocabularyItemId: String)
}

class RemoteWordLookupRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: WordLookupResponseParser = WordLookupResponseParser(),
) : WordLookupRepository {
    override suspend fun lookup(word: String): WordLookupResult? =
        parser.parseLookup(
            apiClient.post(
                path = "/api/vocab/lookup",
                body = parser.encode(WordLookupRequest(word.trim())),
            ),
        )

    override suspend fun save(vocabularyItemId: String): SaveWordResult =
        parser.parseSave(
            apiClient.post(
                path = "/api/library/saved-words",
                body = parser.encode(SaveWordRequest(vocabularyItemId)),
            ),
        )

    override suspend fun remove(vocabularyItemId: String) {
        val encodedId = URLEncoder
            .encode(vocabularyItemId, StandardCharsets.UTF_8.toString())
            .replace("+", "%20")
        apiClient.delete("/api/library/saved-words/$encodedId")
    }
}

class WordLookupResponseParser(
    @PublishedApi internal val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    fun parseLookup(rawBody: String): WordLookupResult? =
        json.decodeFromString<WordLookupEnvelope>(rawBody).data

    fun parseSave(rawBody: String): SaveWordResult =
        json.decodeFromString<SaveWordEnvelope>(rawBody).data

    inline fun <reified T> encode(value: T): String = json.encodeToString(value)
}

@Serializable
private data class WordLookupRequest(
    val word: String,
)

@Serializable
private data class SaveWordRequest(
    val vocabularyItemId: String,
    val source: String = "reading_popup",
)

@Serializable
private data class WordLookupEnvelope(
    val data: WordLookupResult? = null,
    val missing: Boolean = false,
)

@Serializable
private data class SaveWordEnvelope(
    val data: SaveWordResult,
)
