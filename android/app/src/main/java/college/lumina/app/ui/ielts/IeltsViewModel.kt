package college.lumina.app.ui.ielts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.ielts.IeltsAttempt
import college.lumina.app.data.ielts.IeltsDashboard
import college.lumina.app.data.ielts.IeltsModule
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.IeltsTest
import college.lumina.app.data.ielts.IeltsTestSelection
import kotlin.math.round
import kotlinx.coroutines.launch

enum class IeltsTab {
    Overview,
    Reading,
    Listening,
}

data class IeltsUiState(
    val dashboard: IeltsDashboard? = null,
    val selectedTab: IeltsTab = IeltsTab.Overview,
    val selectedTest: IeltsTestSelection? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
) {
    val allAttempts: List<IeltsAttempt>
        get() = dashboard
            ?.let { it.readingAttempts + it.listeningAttempts }
            ?.sortedByDescending(IeltsAttempt::submittedAt)
            .orEmpty()

    val currentBand: Double?
        get() {
            val attempts = allAttempts.filter { it.totalQuestions > 0 }
            if (attempts.isEmpty()) return null
            val average = attempts.map { it.score.toDouble() / it.totalQuestions }.average() * 9
            return round(average * 2) / 2
        }

    val completedTestIds: Set<String>
        get() = allAttempts.map(IeltsAttempt::testId).toSet()

    val nextTest: IeltsTestSelection?
        get() {
            val value = dashboard ?: return null
            val reading = value.readingBooks
                .flatMap { it.tests }
                .firstOrNull { it.id !in completedTestIds }
                ?.let { IeltsTestSelection(IeltsModule.Reading, it) }
            val listening = value.listeningBooks
                .flatMap { it.tests }
                .firstOrNull { it.id !in completedTestIds }
                ?.let { IeltsTestSelection(IeltsModule.Listening, it) }
            return reading ?: listening
        }
}

class IeltsViewModel(
    private val repository: IeltsRepository,
) : ViewModel() {
    private var requestInFlight = false

    var uiState by mutableStateOf(IeltsUiState())
        private set

    init {
        refresh()
    }

    fun refresh() {
        if (requestInFlight) return
        requestInFlight = true
        val hasContent = uiState.dashboard != null
        uiState = uiState.copy(
            isLoading = !hasContent,
            isRefreshing = hasContent,
            errorMessage = null,
        )
        viewModelScope.launch {
            runCatching { repository.fetchDashboard() }
                .onSuccess { dashboard ->
                    uiState = uiState.copy(
                        dashboard = dashboard,
                        isLoading = false,
                        isRefreshing = false,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = error.toIeltsErrorMessage(),
                    )
                }
            requestInFlight = false
        }
    }

    fun selectTab(tab: IeltsTab) {
        uiState = uiState.copy(selectedTab = tab)
    }

    fun selectTest(module: IeltsModule, test: IeltsTest) {
        uiState = uiState.copy(selectedTest = IeltsTestSelection(module, test))
    }

    fun dismissTest() {
        uiState = uiState.copy(selectedTest = null)
    }

    companion object {
        fun factory(repository: IeltsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(IeltsViewModel::class.java))
                    return IeltsViewModel(repository) as T
                }
            }
    }
}

private fun Throwable.toIeltsErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "IELTS 数据加载超时，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "IELTS 数据暂时无法加载，请稍后重试。"
    }
}
