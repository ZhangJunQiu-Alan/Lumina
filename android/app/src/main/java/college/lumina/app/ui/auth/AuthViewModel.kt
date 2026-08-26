package college.lumina.app.ui.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.auth.AuthRepository
import college.lumina.app.data.auth.AuthSessionState
import college.lumina.app.data.auth.SignUpOutcome
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

enum class AuthMode {
    LOGIN,
    REGISTER,
}

data class AuthFeedback(
    val message: String,
    val isError: Boolean,
)

data class AuthUiState(
    val sessionState: AuthSessionState = AuthSessionState.Initializing,
    val mode: AuthMode = AuthMode.LOGIN,
    val fullName: String = "",
    val email: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val isSubmitting: Boolean = false,
    val feedback: AuthFeedback? = null,
)

class AuthViewModel(
    private val authRepository: AuthRepository,
) : ViewModel() {
    var uiState by mutableStateOf(AuthUiState())
        private set

    init {
        viewModelScope.launch {
            authRepository.sessionState.collectLatest { sessionState ->
                uiState = uiState.copy(
                    sessionState = sessionState,
                    isSubmitting = false,
                )
            }
        }
    }

    fun setMode(mode: AuthMode) {
        uiState = uiState.copy(
            mode = mode,
            feedback = null,
            password = "",
            confirmPassword = "",
        )
    }

    fun setFullName(value: String) {
        uiState = uiState.copy(fullName = value, feedback = null)
    }

    fun setEmail(value: String) {
        uiState = uiState.copy(email = value, feedback = null)
    }

    fun setPassword(value: String) {
        uiState = uiState.copy(password = value, feedback = null)
    }

    fun setConfirmPassword(value: String) {
        uiState = uiState.copy(confirmPassword = value, feedback = null)
    }

    fun submit() {
        if (uiState.isSubmitting) return

        val state = uiState
        val validationMessage = when (state.mode) {
            AuthMode.LOGIN -> AuthFormValidator.validateLogin(state.email, state.password)
            AuthMode.REGISTER -> AuthFormValidator.validateRegistration(
                fullName = state.fullName,
                email = state.email,
                password = state.password,
                confirmPassword = state.confirmPassword,
            )
        }
        if (validationMessage != null) {
            uiState = state.copy(feedback = AuthFeedback(validationMessage, isError = true))
            return
        }

        uiState = state.copy(isSubmitting = true, feedback = null)
        viewModelScope.launch {
            runCatching {
                when (state.mode) {
                    AuthMode.LOGIN -> authRepository.signIn(
                        email = state.email.trim(),
                        password = state.password,
                    )

                    AuthMode.REGISTER -> authRepository.signUp(
                        fullName = state.fullName.trim(),
                        email = state.email.trim(),
                        password = state.password,
                    )
                }
            }.onSuccess { result ->
                if (result == SignUpOutcome.EMAIL_CONFIRMATION_REQUIRED) {
                    uiState = uiState.copy(
                        isSubmitting = false,
                        feedback = AuthFeedback(
                            message = "账号已创建。请到邮箱完成确认，然后返回登录。",
                            isError = false,
                        ),
                    )
                }
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    feedback = AuthFeedback(
                        message = error.toFriendlyAuthMessage(),
                        isError = true,
                    ),
                )
            }
        }
    }

    fun signOut() {
        if (uiState.isSubmitting) return

        uiState = uiState.copy(isSubmitting = true, feedback = null)
        viewModelScope.launch {
            runCatching {
                authRepository.signOut()
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    feedback = AuthFeedback(
                        message = error.toFriendlyAuthMessage(),
                        isError = true,
                    ),
                )
            }
        }
    }

    companion object {
        fun factory(authRepository: AuthRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(AuthViewModel::class.java))
                    return AuthViewModel(authRepository) as T
                }
            }
    }
}

private fun Throwable.toFriendlyAuthMessage(): String {
    val rawMessage = message.orEmpty()
    return when {
        rawMessage.contains("Invalid login credentials", ignoreCase = true) ->
            "邮箱或密码不正确。"

        rawMessage.contains("Email not confirmed", ignoreCase = true) ->
            "请先到邮箱完成账号确认。"

        rawMessage.contains("User already registered", ignoreCase = true) ->
            "这个邮箱已经注册，可以直接登录。"

        rawMessage.contains("network", ignoreCase = true) ->
            "网络连接失败，请检查网络后重试。"

        rawMessage.isNotBlank() -> rawMessage
        else -> "操作没有完成，请稍后重试。"
    }
}
