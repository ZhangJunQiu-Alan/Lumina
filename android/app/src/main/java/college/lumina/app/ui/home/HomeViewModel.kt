package college.lumina.app.ui.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.home.HomeOfficialLibraryOption
import college.lumina.app.data.home.HomeOverview
import college.lumina.app.data.home.HomeRepository
import college.lumina.app.data.home.OrbitDay
import java.util.TimeZone
import kotlinx.coroutines.launch

data class HomeUiState(
    val overview: HomeOverview? = null,
    val selectedDate: String? = null,
    val selectedOfficialLibraryId: String? = null,
    val selectedStudyMode: String = "sequential",
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
    val actionMessage: String? = null,
) {
    val selectedDay: OrbitDay?
        get() = overview?.orbitDays?.firstOrNull { it.date == selectedDate }

    val selectedOfficialLibrary: HomeOfficialLibraryOption?
        get() = overview
            ?.routineCard
            ?.officialLibraryOptions
            ?.firstOrNull { it.libraryId == selectedOfficialLibraryId }
}

class HomeViewModel(
    private val homeRepository: HomeRepository,
    private val timeZone: String = TimeZone.getDefault().id,
) : ViewModel() {
    private var requestInFlight = false

    var uiState by mutableStateOf(HomeUiState())
        private set

    init {
        refresh()
    }

    fun refresh() {
        if (requestInFlight) return

        requestInFlight = true
        val hasContent = uiState.overview != null
        uiState = uiState.copy(
            isLoading = !hasContent,
            isRefreshing = hasContent,
            errorMessage = null,
        )
        viewModelScope.launch {
            runCatching {
                homeRepository.fetchOverview(timeZone)
            }.onSuccess { overview ->
                val availableLibraries = overview.routineCard.officialLibraryOptions
                val selectedLibraryId = uiState.selectedOfficialLibraryId
                    ?.takeIf { selected -> availableLibraries.any { it.libraryId == selected } }
                    ?: overview.routineCard.selectedOfficialLibraryId
                    ?: availableLibraries.firstOrNull()?.libraryId
                val selectedOption = availableLibraries.firstOrNull { it.libraryId == selectedLibraryId }
                val shouldPreserveStudyMode =
                    uiState.overview != null && selectedLibraryId == uiState.selectedOfficialLibraryId

                uiState = uiState.copy(
                    overview = overview,
                    selectedDate = overview.selectedDate
                        .takeIf(String::isNotBlank)
                        ?: overview.orbitDays.lastOrNull()?.date,
                    selectedOfficialLibraryId = selectedLibraryId,
                    selectedStudyMode = if (shouldPreserveStudyMode) {
                        uiState.selectedStudyMode
                    } else {
                        selectedOption?.mode
                            ?: overview.routineCard.lastUsedOfficialMode
                            ?: "sequential"
                    },
                    isLoading = false,
                    isRefreshing = false,
                    errorMessage = null,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isLoading = false,
                    isRefreshing = false,
                    errorMessage = error.toHomeErrorMessage(),
                )
            }
            requestInFlight = false
        }
    }

    fun selectDate(date: String) {
        if (uiState.overview?.orbitDays?.none { it.date == date } != false) return
        uiState = uiState.copy(selectedDate = date)
    }

    fun selectOfficialLibrary(libraryId: String) {
        val option = uiState.overview
            ?.routineCard
            ?.officialLibraryOptions
            ?.firstOrNull { it.libraryId == libraryId }
            ?: return
        uiState = uiState.copy(
            selectedOfficialLibraryId = libraryId,
            selectedStudyMode = option.mode,
        )
    }

    fun selectStudyMode(mode: String) {
        if (mode !in setOf("sequential", "shuffle")) return
        uiState = uiState.copy(selectedStudyMode = mode)
    }

    fun showPendingModuleMessage() {
        val ctaMode = uiState.overview?.routineCard?.ctaMode
        val destination = when (ctaMode) {
            "start_review", "continue_review" -> "复习模块"
            "open_library" -> "词库模块"
            else -> "学习模块"
        }
        uiState = uiState.copy(actionMessage = "$destination 将在下一阶段接入；当前首页数据已经与网页端同步。")
    }

    fun dismissActionMessage() {
        uiState = uiState.copy(actionMessage = null)
    }

    companion object {
        fun factory(homeRepository: HomeRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(HomeViewModel::class.java))
                    return HomeViewModel(homeRepository) as T
                }
            }
    }
}

private fun Throwable.toHomeErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("401") || raw.contains("登录") -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "首页加载超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "首页暂时无法加载，请稍后重试。"
    }
}
