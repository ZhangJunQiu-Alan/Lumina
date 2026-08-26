package college.lumina.app.ui.library

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.library.LibraryGroupDetail
import college.lumina.app.data.library.LibraryGroupWord
import college.lumina.app.data.library.LibraryOverview
import college.lumina.app.data.library.LibraryRepository
import college.lumina.app.data.library.SavedWordEntry
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

enum class LibraryTab {
    Official,
    Groups,
    Saved,
}

data class LibraryUiState(
    val overview: LibraryOverview? = null,
    val selectedTab: LibraryTab = LibraryTab.Official,
    val selectedLibraryId: String? = null,
    val selectedGroupId: String? = null,
    val groupDetail: LibraryGroupDetail? = null,
    val savedWords: List<SavedWordEntry> = emptyList(),
    val selectedWordId: String? = null,
    val deletingSavedWordId: String? = null,
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val isLoadingGroup: Boolean = false,
    val isCreatingSavedWordsGroup: Boolean = false,
    val errorMessage: String? = null,
) {
    val selectedWord: LibraryGroupWord?
        get() = groupDetail?.words?.firstOrNull { it.id == selectedWordId }
}

class LibraryViewModel(
    private val repository: LibraryRepository,
) : ViewModel() {
    private var overviewRequestInFlight = false
    private var groupRequestInFlight = false

    var uiState by mutableStateOf(LibraryUiState())
        private set

    init {
        refresh()
    }

    fun refresh() {
        if (overviewRequestInFlight) return

        overviewRequestInFlight = true
        val hasContent = uiState.overview != null
        uiState = uiState.copy(
            isLoading = !hasContent,
            isRefreshing = hasContent,
            errorMessage = null,
        )
        viewModelScope.launch {
            runCatching {
                coroutineScope {
                    val overview = async { repository.fetchOverview() }
                    val savedWords = async { repository.fetchSavedWords() }
                    overview.await() to savedWords.await()
                }
            }
                .onSuccess { (overview, savedWords) ->
                    uiState = uiState.copy(
                        overview = overview,
                        savedWords = savedWords,
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = null,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isLoading = false,
                        isRefreshing = false,
                        errorMessage = error.toLibraryErrorMessage(),
                    )
                }
            overviewRequestInFlight = false
        }
    }

    fun selectTab(tab: LibraryTab) {
        uiState = uiState.copy(
            selectedTab = tab,
            selectedLibraryId = if (tab == LibraryTab.Official) null else uiState.selectedLibraryId,
        )
    }

    fun openOfficialLibrary(libraryId: String) {
        uiState = uiState.copy(
            selectedTab = LibraryTab.Groups,
            selectedLibraryId = libraryId,
        )
    }

    fun clearLibraryFilter() {
        uiState = uiState.copy(selectedLibraryId = null)
    }

    fun openGroup(groupId: String) {
        if (groupRequestInFlight) return

        groupRequestInFlight = true
        uiState = uiState.copy(
            selectedGroupId = groupId,
            groupDetail = null,
            selectedWordId = null,
            isLoadingGroup = true,
            errorMessage = null,
        )
        viewModelScope.launch {
            runCatching { repository.fetchGroupDetail(groupId) }
                .onSuccess { detail ->
                    uiState = uiState.copy(
                        groupDetail = detail,
                        isLoadingGroup = false,
                        errorMessage = if (detail.group == null) "这组材料不存在，或它不属于当前账号。" else null,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isLoadingGroup = false,
                        errorMessage = error.toLibraryErrorMessage(),
                    )
                }
            groupRequestInFlight = false
        }
    }

    fun closeGroup() {
        uiState = uiState.copy(
            selectedGroupId = null,
            groupDetail = null,
            selectedWordId = null,
            isLoadingGroup = false,
            errorMessage = null,
        )
    }

    fun selectWord(wordId: String) {
        if (uiState.groupDetail?.words?.none { it.id == wordId } != false) return
        uiState = uiState.copy(selectedWordId = wordId)
    }

    fun dismissWord() {
        uiState = uiState.copy(selectedWordId = null)
    }

    fun removeSavedWord(vocabularyItemId: String) {
        if (uiState.deletingSavedWordId != null) return
        uiState = uiState.copy(deletingSavedWordId = vocabularyItemId, errorMessage = null)
        viewModelScope.launch {
            runCatching { repository.removeSavedWord(vocabularyItemId) }
                .onSuccess {
                    uiState = uiState.copy(
                        savedWords = uiState.savedWords.filterNot { it.vocabularyItemId == vocabularyItemId },
                        deletingSavedWordId = null,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        deletingSavedWordId = null,
                        errorMessage = error.toLibraryErrorMessage(),
                    )
                }
        }
    }

    fun startSavedWordsGroup(onCreated: (String) -> Unit) {
        if (uiState.isCreatingSavedWordsGroup) return
        val availableIds = uiState.savedWords
            .filterNot(SavedWordEntry::isInActiveLearningGroup)
            .take(30)
            .map(SavedWordEntry::vocabularyItemId)
        if (availableIds.size < 30) {
            uiState = uiState.copy(errorMessage = "还差 ${30 - availableIds.size} 个可用生词才能开始一组。")
            return
        }

        uiState = uiState.copy(isCreatingSavedWordsGroup = true, errorMessage = null)
        viewModelScope.launch {
            runCatching { repository.createLearningGroupFromSavedWords(availableIds) }
                .onSuccess { result ->
                    uiState = uiState.copy(isCreatingSavedWordsGroup = false)
                    refresh()
                    onCreated(result.groupId)
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isCreatingSavedWordsGroup = false,
                        errorMessage = error.toLibraryErrorMessage(),
                    )
                }
        }
    }

    companion object {
        fun factory(repository: LibraryRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(LibraryViewModel::class.java))
                    return LibraryViewModel(repository) as T
                }
            }
    }
}

private fun Throwable.toLibraryErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "词库加载超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "词库暂时无法加载，请稍后重试。"
    }
}
