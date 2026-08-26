package college.lumina.app.data.auth

import kotlinx.coroutines.flow.Flow

data class AuthenticatedUser(
    val id: String,
    val email: String,
    val displayName: String?,
)

sealed interface AuthSessionState {
    data object Initializing : AuthSessionState
    data object SignedOut : AuthSessionState
    data class SignedIn(val user: AuthenticatedUser) : AuthSessionState
}

enum class SignUpOutcome {
    SIGNED_IN,
    EMAIL_CONFIRMATION_REQUIRED,
}

interface AuthRepository {
    val sessionState: Flow<AuthSessionState>

    suspend fun signIn(email: String, password: String)

    suspend fun signUp(
        fullName: String,
        email: String,
        password: String,
    ): SignUpOutcome

    suspend fun signOut()
}
