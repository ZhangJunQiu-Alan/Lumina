package college.lumina.app.ui.ielts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.ielts.IeltsListeningEvaluation
import college.lumina.app.data.ielts.IeltsListeningQuestion
import college.lumina.app.data.ielts.IeltsListeningTest
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.SubmittedIeltsAttempt
import college.lumina.app.data.ielts.evaluateIeltsListening
import java.time.Instant
import kotlinx.coroutines.launch

data class IeltsListeningUiState(
    val test: IeltsListeningTest? = null,
    val answers: Map<Int, List<String>> = emptyMap(),
    val selectedSectionNumber: Int = 1,
    val startedAt: String = "",
    val elapsedSeconds: Int = 0,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val errorMessage: String? = null,
    val result: IeltsListeningEvaluation? = null,
    val submittedAttempt: SubmittedIeltsAttempt? = null,
) {
    val questions: List<IeltsListeningQuestion>
        get() = test?.questions.orEmpty()
    val answeredCount: Int
        get() = answers.values.count { it.any(String::isNotBlank) }
    val unansweredCount: Int
        get() = (questions.size - answeredCount).coerceAtLeast(0)
}

class IeltsListeningViewModel(
    private val repository: IeltsRepository,
) : ViewModel() {
    private var requestInFlight = false
    var uiState by mutableStateOf(IeltsListeningUiState())
        private set

    fun open(testId: String) {
        if (requestInFlight) return
        requestInFlight = true
        uiState = IeltsListeningUiState(isLoading = true)
        viewModelScope.launch {
            runCatching { repository.fetchListeningTest(testId) }
                .onSuccess { test ->
                    uiState = uiState.copy(
                        test = test,
                        selectedSectionNumber = test.sections.firstOrNull()?.number ?: 1,
                        startedAt = Instant.now().toString(),
                        isLoading = false,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(isLoading = false, errorMessage = error.message ?: "听力套题加载失败。")
                }
            requestInFlight = false
        }
    }

    fun retry() {
        uiState.test?.id?.let(::open)
    }

    fun updateElapsed(seconds: Int) {
        if (uiState.result != null) return
        uiState = uiState.copy(elapsedSeconds = seconds.coerceIn(0, 40 * 60))
    }

    fun selectSection(number: Int) {
        if (uiState.test?.sections?.none { it.number == number } != false) return
        uiState = uiState.copy(selectedSectionNumber = number)
    }

    fun setAnswer(questionNumber: Int, values: List<String>) {
        if (uiState.result != null) return
        uiState = uiState.copy(answers = uiState.answers + (questionNumber to values))
    }

    fun submit() {
        val test = uiState.test ?: return
        if (uiState.isSubmitting || uiState.result != null) return
        val evaluation = evaluateIeltsListening(test.questions, uiState.answers)
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            runCatching {
                repository.submitListeningAttempt(test, uiState.startedAt, uiState.elapsedSeconds, evaluation)
            }.onSuccess { attempt ->
                uiState = uiState.copy(isSubmitting = false, result = evaluation, submittedAttempt = attempt)
            }.onFailure { error ->
                uiState = uiState.copy(isSubmitting = false, errorMessage = error.message ?: "提交失败，请稍后重试。")
            }
        }
    }

    fun close() {
        uiState = IeltsListeningUiState()
    }

    companion object {
        fun factory(repository: IeltsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(IeltsListeningViewModel::class.java))
                    return IeltsListeningViewModel(repository) as T
                }
            }
    }
}
