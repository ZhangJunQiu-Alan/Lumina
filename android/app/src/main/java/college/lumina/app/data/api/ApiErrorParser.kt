package college.lumina.app.data.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

internal object ApiErrorParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun messageFrom(rawBody: String): String? =
        runCatching {
            json.decodeFromString<ApiErrorPayload>(rawBody).error.trim().ifEmpty { null }
        }.getOrNull()
}

@Serializable
private data class ApiErrorPayload(
    val error: String = "",
)
