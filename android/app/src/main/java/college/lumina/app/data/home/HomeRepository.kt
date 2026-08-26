package college.lumina.app.data.home

import college.lumina.app.data.api.AuthenticatedApiClient
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

interface HomeRepository {
    suspend fun fetchOverview(timeZone: String): HomeOverview
}

class RemoteHomeRepository(
    private val apiClient: AuthenticatedApiClient,
    private val parser: HomeOverviewParser = HomeOverviewParser(),
) : HomeRepository {
    override suspend fun fetchOverview(timeZone: String): HomeOverview {
        val body = apiClient.get(
            path = "/api/home/overview",
            query = mapOf("timezone" to timeZone),
        )
        return parser.parse(body)
    }
}

class HomeOverviewParser(
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    },
) {
    fun parse(rawBody: String): HomeOverview =
        json.decodeFromString<HomeOverviewEnvelope>(rawBody).data
}

@Serializable
private data class HomeOverviewEnvelope(
    val data: HomeOverview,
)
