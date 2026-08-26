package college.lumina.app.data.library

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface LibraryRepository {
    suspend fun fetchOverview(): LibraryOverview

    suspend fun fetchGroupDetail(groupId: String): LibraryGroupDetail

    suspend fun fetchSavedWords(): List<SavedWordEntry>

    suspend fun removeSavedWord(vocabularyItemId: String)

    suspend fun createLearningGroupFromSavedWords(vocabularyItemIds: List<String>): CreateSavedWordsGroupResult
}

class RemoteLibraryRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: LibraryResponseParser = LibraryResponseParser(),
) : LibraryRepository {
    override suspend fun fetchOverview(): LibraryOverview =
        parser.parseOverview(apiClient.get("/api/library/overview"))

    override suspend fun fetchGroupDetail(groupId: String): LibraryGroupDetail =
        parser.parseGroupDetail(apiClient.get("/api/library/groups/$groupId"))

    override suspend fun fetchSavedWords(): List<SavedWordEntry> =
        parser.parseSavedWords(apiClient.get("/api/library/saved-words"))

    override suspend fun removeSavedWord(vocabularyItemId: String) {
        apiClient.delete("/api/library/saved-words/$vocabularyItemId")
    }

    override suspend fun createLearningGroupFromSavedWords(
        vocabularyItemIds: List<String>,
    ): CreateSavedWordsGroupResult {
        val body = parser.json.encodeToString(CreateSavedWordsGroupRequest(vocabularyItemIds))
        return parser.parseCreatedGroup(apiClient.post("/api/library/saved-words/learning-group", body))
    }
}

class LibraryResponseParser(
    internal val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    fun parseOverview(rawBody: String): LibraryOverview =
        json.decodeFromString<LibraryOverviewEnvelope>(rawBody).data

    fun parseGroupDetail(rawBody: String): LibraryGroupDetail =
        json.decodeFromString<LibraryGroupDetailEnvelope>(rawBody).data

    fun parseSavedWords(rawBody: String): List<SavedWordEntry> =
        json.decodeFromString<SavedWordsEnvelope>(rawBody).data

    fun parseCreatedGroup(rawBody: String): CreateSavedWordsGroupResult =
        json.decodeFromString<CreateSavedWordsGroupEnvelope>(rawBody).data
}

@Serializable
private data class LibraryOverviewEnvelope(
    val data: LibraryOverview,
)

@Serializable
private data class LibraryGroupDetailEnvelope(
    val data: LibraryGroupDetail,
)

@Serializable
private data class SavedWordsEnvelope(
    val data: List<SavedWordEntry>,
)

@Serializable
private data class CreateSavedWordsGroupRequest(
    val vocabularyItemIds: List<String>,
)

@Serializable
private data class CreateSavedWordsGroupEnvelope(
    val data: CreateSavedWordsGroupResult,
)
