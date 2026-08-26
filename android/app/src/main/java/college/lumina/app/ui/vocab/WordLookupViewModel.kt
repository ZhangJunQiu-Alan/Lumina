package college.lumina.app.ui.vocab

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.vocab.WordLookupRepository
import college.lumina.app.data.vocab.WordLookupResult
import kotlinx.coroutines.launch

data class WordLookupUiState(
    val requestedWord: String? = null,
    val result: WordLookupResult? = null,
    val isLoading: Boolean = false,
    val isMutating: Boolean = false,
    val isMissing: Boolean = false,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
) {
    val isOpen: Boolean
        get() = requestedWord != null
}

class WordLookupViewModel(
    private val repository: WordLookupRepository,
) : ViewModel() {
    private var requestGeneration = 0

    var uiState by mutableStateOf(WordLookupUiState())
        private set

    fun open(word: String) {
        val normalized = word.trim()
        if (normalized.isBlank()) return
        val generation = ++requestGeneration
        uiState = WordLookupUiState(
            requestedWord = normalized,
            isLoading = true,
        )
        viewModelScope.launch {
            val result = runCatching { repository.lookup(normalized) }
            if (generation != requestGeneration) return@launch
            result.onSuccess { lookup ->
                uiState = uiState.copy(
                    result = lookup,
                    isLoading = false,
                    isMissing = lookup == null,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isLoading = false,
                    errorMessage = error.toLookupErrorMessage(),
                )
            }
        }
    }

    fun close() {
        requestGeneration += 1
        uiState = WordLookupUiState()
    }

    fun toggleSaved() {
        val current = uiState.result ?: return
        if (uiState.isMutating || current.srsState != null) return

        uiState = uiState.copy(
            isMutating = true,
            errorMessage = null,
            statusMessage = null,
        )
        viewModelScope.launch {
            val operation = if (current.inUserLibrary) {
                runCatching {
                    repository.remove(current.vocabularyItem.id)
                    false
                }
            } else {
                runCatching {
                    repository.save(current.vocabularyItem.id).saved
                }
            }
            operation.onSuccess { isSaved ->
                uiState = uiState.copy(
                    result = current.copy(inUserLibrary = isSaved),
                    isMutating = false,
                    statusMessage = if (isSaved) "已加入个人词库。" else "已从个人词库移除。",
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isMutating = false,
                    errorMessage = error.toLookupErrorMessage(),
                )
            }
        }
    }

    fun dismissMessage() {
        uiState = uiState.copy(errorMessage = null, statusMessage = null)
    }

    companion object {
        fun factory(repository: WordLookupRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(WordLookupViewModel::class.java))
                    return WordLookupViewModel(repository) as T
                }
            }
    }
}

private fun Throwable.toLookupErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "查词请求超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "暂时无法查询这个词，请稍后重试。"
    }
}
