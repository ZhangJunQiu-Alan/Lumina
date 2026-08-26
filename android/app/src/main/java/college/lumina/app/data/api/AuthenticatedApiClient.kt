package college.lumina.app.data.api

import io.github.jan.supabase.auth.Auth
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode

class AuthenticatedApiClient(
    private val session: ApiSession,
    baseUrl: String,
    private val httpClient: HttpClient = defaultHttpClient(),
) {
    private val normalizedBaseUrl = baseUrl.trimEnd('/')

    suspend fun get(
        path: String,
        query: Map<String, String> = emptyMap(),
    ): String = executeGet(path, query, retryAfterRefresh = true)

    suspend fun post(
        path: String,
        body: String,
    ): String = executePost(path, body, retryAfterRefresh = true)

    suspend fun delete(path: String): String =
        executeDelete(path, retryAfterRefresh = true)

    private suspend fun executeGet(
        path: String,
        query: Map<String, String>,
        retryAfterRefresh: Boolean,
    ): String {
        val accessToken = session.currentAccessTokenOrNull()
            ?: throw ApiException("请先登录，再继续当前操作。")
        val response = httpClient.get("$normalizedBaseUrl/${path.trimStart('/')}") {
            bearerAuth(accessToken)
            query.forEach { (key, value) -> parameter(key, value) }
        }

        if (response.status == HttpStatusCode.Unauthorized && retryAfterRefresh) {
            session.refreshCurrentSession()
            return executeGet(path, query, retryAfterRefresh = false)
        }

        val body = response.bodyAsText()
        if (response.status.value !in 200..299) {
            throw ApiException(
                message = ApiErrorParser.messageFrom(body)
                    ?: "请求失败（HTTP ${response.status.value}）。",
                statusCode = response.status.value,
            )
        }
        return body
    }

    private suspend fun executePost(
        path: String,
        body: String,
        retryAfterRefresh: Boolean,
    ): String {
        val accessToken = session.currentAccessTokenOrNull()
            ?: throw ApiException("请先登录，再继续当前操作。")
        val response = httpClient.post("$normalizedBaseUrl/${path.trimStart('/')}") {
            bearerAuth(accessToken)
            header(HttpHeaders.ContentType, ContentType.Application.Json)
            setBody(body)
        }

        if (response.status == HttpStatusCode.Unauthorized && retryAfterRefresh) {
            session.refreshCurrentSession()
            return executePost(path, body, retryAfterRefresh = false)
        }

        val responseBody = response.bodyAsText()
        if (response.status.value !in 200..299) {
            throw ApiException(
                message = ApiErrorParser.messageFrom(responseBody)
                    ?: "请求失败（HTTP ${response.status.value}）。",
                statusCode = response.status.value,
            )
        }
        return responseBody
    }

    private suspend fun executeDelete(
        path: String,
        retryAfterRefresh: Boolean,
    ): String {
        val accessToken = session.currentAccessTokenOrNull()
            ?: throw ApiException("请先登录，再继续当前操作。")
        val response = httpClient.delete("$normalizedBaseUrl/${path.trimStart('/')}") {
            bearerAuth(accessToken)
        }

        if (response.status == HttpStatusCode.Unauthorized && retryAfterRefresh) {
            session.refreshCurrentSession()
            return executeDelete(path, retryAfterRefresh = false)
        }

        val responseBody = response.bodyAsText()
        if (response.status.value !in 200..299) {
            throw ApiException(
                message = ApiErrorParser.messageFrom(responseBody)
                    ?: "请求失败（HTTP ${response.status.value}）。",
                statusCode = response.status.value,
            )
        }
        return responseBody
    }

    companion object {
        private fun defaultHttpClient() = HttpClient(Android) {
            install(HttpTimeout) {
                connectTimeoutMillis = 15_000
                requestTimeoutMillis = 30_000
                socketTimeoutMillis = 30_000
            }
        }
    }
}

interface ApiSession {
    fun currentAccessTokenOrNull(): String?

    suspend fun refreshCurrentSession()
}

class SupabaseApiSession(
    private val auth: Auth,
) : ApiSession {
    override fun currentAccessTokenOrNull(): String? = auth.currentAccessTokenOrNull()

    override suspend fun refreshCurrentSession() {
        auth.refreshCurrentSession()
    }
}

class ApiException(
    override val message: String,
    val statusCode: Int? = null,
) : RuntimeException(message)
