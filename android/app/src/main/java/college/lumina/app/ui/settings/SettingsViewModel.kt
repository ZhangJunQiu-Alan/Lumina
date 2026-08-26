package college.lumina.app.ui.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.settings.DefaultLearningPreferences
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.data.settings.LearningPreferencesRepository
import college.lumina.app.data.settings.ReinforcementRoundPreference
import college.lumina.app.data.settings.withReinforcementRoundToggle
import kotlinx.coroutines.launch

data class SettingsUiState(
    val preferences: LearningPreferences = DefaultLearningPreferences,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isSaving: Boolean = false,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
)

class SettingsViewModel(
    private val repository: LearningPreferencesRepository,
) : ViewModel() {
    private var requestInFlight = false

    var uiState by mutableStateOf(SettingsUiState())
        private set

    init {
        refresh()
    }

    fun refresh() {
        if (requestInFlight) return

        requestInFlight = true
        val hasContent = !uiState.isLoading
        uiState = uiState.copy(
            isLoading = !hasContent,
            isRefreshing = hasContent,
            errorMessage = null,
            statusMessage = null,
        )
        viewModelScope.launch {
            runCatching { repository.fetchPreferences() }
                .onSuccess { preferences ->
                    uiState = uiState.copy(
                        preferences = preferences,
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = null,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = error.toSettingsErrorMessage(),
                    )
                }
            requestInFlight = false
        }
    }

    fun setDefaultPronunciationLocale(locale: String) {
        if (locale != "uk" && locale != "us") return
        save(uiState.preferences.copy(defaultPronunciationLocale = locale))
    }

    fun setIeltsTargetScore(score: Double) {
        save(uiState.preferences.copy(ieltsTargetScore = score))
    }

    fun setSpeechPlaybackRate(rate: Double) {
        save(uiState.preferences.copy(speechPlaybackRate = rate))
    }

    fun setAutoPlayEnabled(enabled: Boolean) {
        save(uiState.preferences.copy(autoPlayEnabled = enabled))
    }

    fun setAutoPlayRepeatCount(count: Int) {
        save(uiState.preferences.copy(autoPlayRepeatCount = count))
    }

    fun setAutoPlayRepeatGapMs(gapMs: Int) {
        save(uiState.preferences.copy(autoPlayRepeatGapMs = gapMs))
    }

    fun setCorrectAnswerRevealMs(durationMs: Int) {
        save(uiState.preferences.copy(correctAnswerRevealMs = durationMs))
    }

    fun setWrongAnswerRevealMs(durationMs: Int) {
        save(uiState.preferences.copy(wrongAnswerRevealMs = durationMs))
    }

    fun setRound3DictationEnabled(enabled: Boolean) {
        save(
            uiState.preferences.withReinforcementRoundToggle(
                ReinforcementRoundPreference.Round3Dictation,
                enabled,
            ),
        )
    }

    fun setRound2RecallEnabled(enabled: Boolean) {
        save(
            uiState.preferences.withReinforcementRoundToggle(
                ReinforcementRoundPreference.Round2Recall,
                enabled,
            ),
        )
    }

    fun setReinforcementArticleEnabled(enabled: Boolean) {
        save(uiState.preferences.copy(reinforcementArticleEnabled = enabled))
    }

    fun setPopoverAutoPlayEnabled(enabled: Boolean) {
        save(uiState.preferences.copy(popoverAutoPlayEnabled = enabled))
    }

    fun setClozeSentenceAutoPlayEnabled(enabled: Boolean) {
        save(uiState.preferences.copy(clozeSentenceAutoPlayEnabled = enabled))
    }

    fun setMemoryTipEnabled(enabled: Boolean) {
        save(uiState.preferences.copy(memoryTipEnabled = enabled))
    }

    fun resetDefaults() {
        save(DefaultLearningPreferences)
    }

    fun dismissMessages() {
        uiState = uiState.copy(errorMessage = null, statusMessage = null)
    }

    private fun save(nextPreferences: LearningPreferences) {
        if (requestInFlight || nextPreferences == uiState.preferences) return

        requestInFlight = true
        val previousPreferences = uiState.preferences
        uiState = uiState.copy(
            preferences = nextPreferences,
            isSaving = true,
            errorMessage = null,
            statusMessage = null,
        )
        viewModelScope.launch {
            runCatching { repository.savePreferences(nextPreferences) }
                .onSuccess { savedPreferences ->
                    uiState = uiState.copy(
                        preferences = savedPreferences,
                        isSaving = false,
                        statusMessage = "设置已保存。",
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        preferences = previousPreferences,
                        isSaving = false,
                        errorMessage = error.toSettingsErrorMessage(),
                    )
                }
            requestInFlight = false
        }
    }

    companion object {
        fun factory(repository: LearningPreferencesRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(SettingsViewModel::class.java))
                    return SettingsViewModel(repository) as T
                }
            }
    }
}

private fun Throwable.toSettingsErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("401") || raw.contains("登录") -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "设置同步超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "设置暂时无法同步，请稍后重试。"
    }
}
