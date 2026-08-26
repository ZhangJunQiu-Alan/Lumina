package college.lumina.app.ui.ielts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.ielts.IeltsReadingEvaluation
import college.lumina.app.data.ielts.IeltsReadingQuestion
import college.lumina.app.data.ielts.IeltsReadingTest
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.SubmittedIeltsAttempt
import college.lumina.app.data.ielts.evaluateIeltsReading
import java.time.Instant
import kotlinx.coroutines.launch

enum class ReadingPane {
    Passage,
    Questions,
}

data class IeltsReadingUiState(
    val test: IeltsReadingTest? = null,
    val answers: Map<Int, List<String>> = emptyMap(),
    val selectedPassageNumber: Int = 1,
    val selectedPane: ReadingPane = ReadingPane.Passage,
    val startedAt: String = "",
    val elapsedSeconds: Int = 0,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val result: IeltsReadingEvaluation? = null,
    val submittedAttempt: SubmittedIeltsAttempt? = null,
) {
    val questions: List<IeltsReadingQuestion>
        get() = test?.questions.orEmpty()

    val answeredCount: Int
        get() = answers.values.count { values -> values.any(String::isNotBlank) }

    val unansweredCount: Int
        get() = (questions.size - answeredCount).coerceAtLeast(0)
}

class IeltsReadingViewModel(
    private val repository: IeltsRepository,
) : ViewModel() {
    private var requestInFlight = false

    var uiState by mutableStateOf(IeltsReadingUiState())
        private set

    fun open(testId: String) {
        if (requestInFlight) return
        requestInFlight = true
        uiState = IeltsReadingUiState(isLoading = true)
        viewModelScope.launch {
            runCatching { repository.fetchReadingTest(testId) }
                .onSuccess { test ->
                    uiState = uiState.copy(
                        test = test,
                        selectedPassageNumber = test.passages.firstOrNull()?.number ?: 1,
                        startedAt = Instant.now().toString(),
                        isLoading = false,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(isLoading = false, errorMessage = error.message ?: "阅读套题加载失败。")
                }
            requestInFlight = false
        }
    }

    fun retry() {
        uiState.test?.id?.let(::open)
    }

    fun updateElapsed(seconds: Int) {
        if (uiState.result != null) return
        uiState = uiState.copy(elapsedSeconds = seconds.coerceIn(0, 60 * 60))
    }

    fun selectPane(pane: ReadingPane) {
        uiState = uiState.copy(selectedPane = pane)
    }

    fun selectPassage(number: Int) {
        if (uiState.test?.passages?.none { it.number == number } != false) return
        uiState = uiState.copy(selectedPassageNumber = number)
    }

    fun setAnswer(questionNumber: Int, values: List<String>) {
        if (uiState.result != null) return
        uiState = uiState.copy(
            answers = uiState.answers + (questionNumber to values),
        )
    }

    fun submit() {
        val test = uiState.test ?: return
        if (uiState.isSubmitting || uiState.result != null) return
        val evaluation = evaluateIeltsReading(test.questions, uiState.answers)
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            runCatching {
                repository.submitReadingAttempt(
                    test = test,
                    startedAt = uiState.startedAt,
                    elapsedSeconds = uiState.elapsedSeconds,
                    evaluation = evaluation,
                )
            }.onSuccess { attempt ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    result = evaluation,
                    submittedAttempt = attempt,
                    selectedPane = ReadingPane.Questions,
                )
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    errorMessage = error.message ?: "提交失败，请稍后重试。",
                )
            }
        }
    }

    fun close() {
        uiState = IeltsReadingUiState()
    }

    companion object {
        fun factory(repository: IeltsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(IeltsReadingViewModel::class.java))
                    return IeltsReadingViewModel(repository) as T
                }
            }
    }
}
