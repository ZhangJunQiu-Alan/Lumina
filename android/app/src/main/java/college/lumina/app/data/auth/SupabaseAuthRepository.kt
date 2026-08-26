package college.lumina.app.data.auth

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class SupabaseAuthRepository(
    private val auth: Auth,
) : AuthRepository {
    override val sessionState: Flow<AuthSessionState> =
        auth.sessionStatus.map { status ->
            when (status) {
                SessionStatus.Initializing -> AuthSessionState.Initializing
                is SessionStatus.Authenticated -> AuthSessionState.SignedIn(status.session.user.toDomainUser())
                is SessionStatus.RefreshFailure -> AuthSessionState.Initializing
                is SessionStatus.NotAuthenticated -> AuthSessionState.SignedOut
            }
        }

    override suspend fun signIn(email: String, password: String) {
        auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
    }

    override suspend fun signUp(
        fullName: String,
        email: String,
        password: String,
    ): SignUpOutcome {
        auth.signUpWith(Email, redirectUrl = EMAIL_CONFIRMATION_REDIRECT_URL) {
            this.email = email
            this.password = password
            data = buildJsonObject {
                put("full_name", fullName)
            }
        }

        return if (auth.currentSessionOrNull() == null) {
            SignUpOutcome.EMAIL_CONFIRMATION_REQUIRED
        } else {
            SignUpOutcome.SIGNED_IN
        }
    }

    override suspend fun signOut() {
        auth.signOut()
    }
}

private const val EMAIL_CONFIRMATION_REDIRECT_URL = "https://lumina.college/auth"

private fun UserInfo?.toDomainUser(): AuthenticatedUser {
    requireNotNull(this) { "Authenticated Supabase session did not contain a user." }

    return AuthenticatedUser(
        id = id,
        email = email.orEmpty(),
        displayName = userMetadata
            ?.get("full_name")
            ?.jsonPrimitive
            ?.content
            ?.takeIf(String::isNotBlank),
    )
}
