package college.lumina.app.ui.review

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.review.MarkReviewWordMasteredRequest
import college.lumina.app.data.review.MarkReviewWordUnknownRequest
import college.lumina.app.data.review.ReviewAttemptResult
import college.lumina.app.data.review.ReviewRepository
import college.lumina.app.data.review.ReviewTransition
import college.lumina.app.data.review.ReviewWord
import college.lumina.app.data.review.SubmitReviewAttemptRequest
import java.util.TimeZone
import kotlinx.coroutines.launch

data class ReviewSummaryItem(
    val word: ReviewWord,
    val transition: ReviewTransition,
)

data class ReviewFeedback(
    val word: ReviewWord,
    val typedAnswer: String? = null,
    val wasCorrect: Boolean? = null,
    val result: ReviewAttemptResult? = null,
    val action: String = "attempt",
)

data class ReviewUiState(
    val words: List<ReviewWord> = emptyList(),
    val queueWordIds: List<String> = emptyList(),
    val currentIndex: Int = 0,
    val completedWordIds: Set<String> = emptySet(),
    val input: String = "",
    val feedback: ReviewFeedback? = null,
    val summary: List<ReviewSummaryItem> = emptyList(),
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val isCompleted: Boolean = false,
    val errorMessage: String? = null,
) {
    val currentWord: ReviewWord?
        get() = queueWordIds.getOrNull(currentIndex)?.let { wordId ->
            words.firstOrNull { it.id == wordId }
        }

    val progressCurrent: Int
        get() = if (words.isEmpty()) 0 else (completedWordIds.size + 1).coerceAtMost(words.size)

    val progressTotal: Int
        get() = words.size
}

class ReviewViewModel(
    private val repository: ReviewRepository,
    private val timeZone: String = TimeZone.getDefault().id,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private var requestInFlight = false
    private var requestGeneration = 0
    private var promptStartedAt = clock()

    var uiState by mutableStateOf(ReviewUiState())
        private set

    fun start() {
        if (requestInFlight) return
        val generation = ++requestGeneration
        requestInFlight = true
        uiState = ReviewUiState(isLoading = true)
        viewModelScope.launch {
            val result = runCatching { repository.startSession(timeZone) }
            if (generation != requestGeneration) return@launch
            result.onSuccess { session ->
                promptStartedAt = clock()
                uiState = ReviewUiState(
                    words = session.words,
                    queueWordIds = session.words.map { it.id },
                    isCompleted = session.words.isEmpty(),
                )
            }.onFailure { error ->
                uiState = ReviewUiState(errorMessage = error.toReviewErrorMessage())
            }
            requestInFlight = false
        }
    }

    fun close() {
        requestGeneration += 1
        requestInFlight = false
        uiState = ReviewUiState()
    }

    fun setInput(value: String) {
        if (uiState.feedback != null || uiState.isSubmitting) return
        uiState = uiState.copy(input = value, errorMessage = null)
    }

    fun submitAnswer() {
        val word = uiState.currentWord ?: return
        if (requestInFlight || uiState.feedback != null) return
        val typed = uiState.input.trim()
        if (typed.isBlank()) {
            uiState = uiState.copy(errorMessage = "请先输入英文单词。")
            return
        }
        val wasCorrect = typed.equals(word.word.trim(), ignoreCase = true)
        submitResolution(
            word = word,
            feedback = ReviewFeedback(
                word = word,
                typedAnswer = typed,
                wasCorrect = wasCorrect,
            ),
            request = {
                repository.submitAttempt(
                    SubmitReviewAttemptRequest(
                        vocabularyItemId = word.id,
                        wasCorrect = wasCorrect,
                        elapsedMs = (clock() - promptStartedAt).coerceAtLeast(0),
                    ),
                )
            },
            requeue = !wasCorrect,
        )
    }

    fun revealAnswer() {
        val word = uiState.currentWord ?: return
        if (requestInFlight || uiState.feedback != null) return
        uiState = uiState.copy(
            input = "",
            feedback = ReviewFeedback(
                word = word,
                wasCorrect = false,
                action = "reveal",
            ),
            errorMessage = null,
        )
    }

    fun returnToAnswer() {
        if (uiState.feedback?.result != null || uiState.isSubmitting) return
        uiState = uiState.copy(feedback = null, errorMessage = null)
    }

    fun markUnknown() {
        val feedback = uiState.feedback ?: return
        if (feedback.action != "reveal" || feedback.result != null || requestInFlight) return
        submitResolution(
            word = feedback.word,
            feedback = feedback.copy(action = "unknown"),
            request = {
                repository.markUnknown(
                    MarkReviewWordUnknownRequest(
                        vocabularyItemId = feedback.word.id,
                        timestamp = clock(),
                    ),
                )
            },
            requeue = false,
        )
    }

    fun markMastered() {
        val word = uiState.currentWord ?: return
        if (requestInFlight || uiState.feedback != null) return
        submitResolution(
            word = word,
            feedback = ReviewFeedback(
                word = word,
                wasCorrect = true,
                action = "mastered",
            ),
            request = {
                repository.markMastered(
                    MarkReviewWordMasteredRequest(vocabularyItemId = word.id),
                )
            },
            requeue = false,
        )
    }

    fun continueAfterFeedback() {
        val feedback = uiState.feedback ?: return
        if (feedback.result == null || requestInFlight) return
        val nextIndex = uiState.currentIndex + 1
        if (nextIndex < uiState.queueWordIds.size) {
            promptStartedAt = clock()
            uiState = uiState.copy(
                currentIndex = nextIndex,
                input = "",
                feedback = null,
                errorMessage = null,
            )
            return
        }

        requestInFlight = true
        val generation = requestGeneration
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            val result = runCatching { repository.completeSession(timeZone) }
            if (generation != requestGeneration) return@launch
            result.onSuccess {
                uiState = uiState.copy(
                    input = "",
                    feedback = null,
                    isSubmitting = false,
                    isCompleted = true,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    errorMessage = error.toReviewErrorMessage(),
                )
            }
            requestInFlight = false
        }
    }

    fun dismissError() {
        uiState = uiState.copy(errorMessage = null)
    }

    private fun submitResolution(
        word: ReviewWord,
        feedback: ReviewFeedback,
        request: suspend () -> ReviewAttemptResult,
        requeue: Boolean,
    ) {
        requestInFlight = true
        val generation = requestGeneration
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            val result = runCatching { request() }
            if (generation != requestGeneration) return@launch
            result.onSuccess { attempt ->
                val nextQueue = if (requeue) {
                    uiState.queueWordIds.toMutableList().apply {
                        add((uiState.currentIndex + 3).coerceAtMost(size), word.id)
                    }
                } else {
                    uiState.queueWordIds
                }
                val completedIds = if (requeue) {
                    uiState.completedWordIds
                } else {
                    uiState.completedWordIds + word.id
                }
                val nextSummary = uiState.summary
                    .filterNot { it.word.id == word.id } + ReviewSummaryItem(word, attempt.transition)
                uiState = uiState.copy(
                    queueWordIds = nextQueue,
                    completedWordIds = completedIds,
                    input = "",
                    feedback = feedback.copy(result = attempt),
                    summary = nextSummary,
                    isSubmitting = false,
                    errorMessage = null,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    errorMessage = error.toReviewErrorMessage(),
                )
            }
            requestInFlight = false
        }
    }

    companion object {
        fun factory(repository: ReviewRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(ReviewViewModel::class.java))
                    return ReviewViewModel(repository) as T
                }
            }
    }
}

private fun Throwable.toReviewErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "复习进度保存超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "复习进度暂时无法保存，请稍后重试。"
    }
}
