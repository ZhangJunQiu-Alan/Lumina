package college.lumina.app.ui.learning

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import college.lumina.app.data.api.ApiException
import college.lumina.app.data.learning.CompleteLearningRoundRequest
import college.lumina.app.data.learning.LearningRepository
import college.lumina.app.data.learning.LearningSessionData
import college.lumina.app.data.learning.LearningSessionSnapshot
import college.lumina.app.data.learning.LearningWord
import college.lumina.app.data.learning.ReviewAttemptRequest
import college.lumina.app.data.learning.SaveLearningSessionRequest
import college.lumina.app.data.settings.DefaultLearningPreferences
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.data.settings.LearningPreferencesRepository
import java.util.TimeZone
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class Round2Option(
    val word: String,
    val pos: String,
    val meaning: String,
    val isCorrect: Boolean,
)

data class LearningAnswerFeedback(
    val round: String,
    val word: LearningWord,
    val wasCorrect: Boolean,
    val selectedWord: String? = null,
    val typedAnswer: String? = null,
    val options: List<Round2Option> = emptyList(),
)

data class LearningUiState(
    val data: LearningSessionData? = null,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val spellingInput: String = "",
    val answerFeedback: LearningAnswerFeedback? = null,
    val preferences: LearningPreferences = DefaultLearningPreferences,
    val errorMessage: String? = null,
) {
    val session: LearningSessionSnapshot?
        get() = data?.session

    val currentWord: LearningWord?
        get() {
            val currentSession = session ?: return null
            val wordId = currentSession.queueWordIds.getOrNull(currentSession.currentIndex) ?: return null
            return data?.words?.firstOrNull { it.id == wordId }
        }

    val progressCurrent: Int
        get() = (session?.currentIndex ?: 0) + 1

    val progressTotal: Int
        get() = session?.queueWordIds?.size ?: 0
}

class LearningViewModel(
    private val repository: LearningRepository,
    private val preferencesRepository: LearningPreferencesRepository,
    private val timeZone: String = TimeZone.getDefault().id,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private var requestInFlight = false
    private var requestGeneration = 0
    private var promptStartedAt = clock()
    private var lastGroupId: String? = null
    private var lastOfficialRequest: Pair<String, String>? = null
    private var feedbackAdvanceJob: Job? = null

    var uiState by mutableStateOf(LearningUiState())
        private set

    fun openGroup(groupId: String) {
        lastGroupId = groupId
        lastOfficialRequest = null
        load { repository.fetchGroup(groupId) }
    }

    fun startOfficial(
        libraryId: String,
        mode: String,
    ) {
        lastGroupId = null
        lastOfficialRequest = libraryId to mode
        load { repository.startOfficial(libraryId, mode, timeZone) }
    }

    fun retry() {
        lastGroupId?.let(::openGroup)
            ?: lastOfficialRequest?.let { (libraryId, mode) -> startOfficial(libraryId, mode) }
    }

    fun close() {
        feedbackAdvanceJob?.cancel()
        requestGeneration += 1
        requestInFlight = false
        lastGroupId = null
        lastOfficialRequest = null
        uiState = LearningUiState()
    }

    fun setSpellingInput(value: String) {
        if (uiState.answerFeedback != null || uiState.isSubmitting) return
        uiState = uiState.copy(spellingInput = value, errorMessage = null)
    }

    fun confirmRound1(confirmed: Boolean) {
        val data = uiState.data ?: return
        val session = data.session ?: return
        val word = uiState.currentWord ?: return
        if (session.round != "round1" || requestInFlight) return

        val confirmedIds = if (confirmed) {
            (session.round1ConfirmedWordIds + word.id).distinct()
        } else {
            session.round1ConfirmedWordIds
        }
        val nextIndex = session.currentIndex + 1

        submit {
            if (nextIndex >= session.queueWordIds.size) {
                repository.completeRound(
                    data.group.id,
                    CompleteLearningRoundRequest(
                        round = "round1",
                        confirmedWordIds = confirmedIds,
                        timeZone = timeZone,
                    ),
                )
            } else {
                repository.saveSession(
                    data.group.id,
                    session.toSaveRequest(
                        currentIndex = nextIndex,
                        round1ConfirmedWordIds = confirmedIds,
                        timeZone = timeZone,
                    ),
                )
            }
        }
    }

    fun selectRound2Option(option: Round2Option) {
        val data = uiState.data ?: return
        val session = data.session ?: return
        val word = uiState.currentWord ?: return
        if (session.round != "round2" || requestInFlight || uiState.answerFeedback != null) return

        val options = buildRound2Options(word, data.words)
        val selected = options.firstOrNull { it.word == option.word } ?: return
        val feedback = LearningAnswerFeedback(
            round = "round2",
            word = word,
            wasCorrect = selected.isCorrect,
            selectedWord = selected.word,
            options = options,
        )
        submitAnswer(
            feedback = feedback,
            source = "round2",
            wasCorrect = selected.isCorrect,
            nextQueue = session.queueWordIds,
        )
    }

    fun submitRound3() {
        val data = uiState.data ?: return
        val session = data.session ?: return
        val word = uiState.currentWord ?: return
        if (session.round != "round3" || requestInFlight || uiState.answerFeedback != null) return

        val typed = uiState.spellingInput.trim()
        if (typed.isBlank()) {
            uiState = uiState.copy(errorMessage = "请先输入英文单词。")
            return
        }
        val wasCorrect = typed.equals(word.word.trim(), ignoreCase = true)
        val nextQueue = if (wasCorrect) {
            session.queueWordIds
        } else {
            session.queueWordIds.toMutableList().apply {
                add((session.currentIndex + 3).coerceAtMost(size), word.id)
            }
        }
        submitAnswer(
            feedback = LearningAnswerFeedback(
                round = "round3",
                word = word,
                wasCorrect = wasCorrect,
                typedAnswer = typed,
            ),
            source = "round3",
            wasCorrect = wasCorrect,
            nextQueue = nextQueue,
        )
    }

    fun continueAfterFeedback() {
        if (uiState.isSubmitting) return
        feedbackAdvanceJob?.cancel()
        feedbackAdvanceJob = null
        promptStartedAt = clock()
        uiState = uiState.copy(
            answerFeedback = null,
            spellingInput = "",
            errorMessage = null,
        )
    }

    fun dismissError() {
        uiState = uiState.copy(errorMessage = null)
    }

    fun round2Options(): List<Round2Option> {
        val data = uiState.data ?: return emptyList()
        val word = uiState.currentWord ?: return emptyList()
        return buildRound2Options(word, data.words)
    }

    private fun submitAnswer(
        feedback: LearningAnswerFeedback,
        source: String,
        wasCorrect: Boolean,
        nextQueue: List<String>,
    ) {
        val data = uiState.data ?: return
        val session = data.session ?: return
        val word = uiState.currentWord ?: return
        val nextIndex = session.currentIndex + 1
        val elapsedMs = (clock() - promptStartedAt).coerceAtLeast(0)

        requestInFlight = true
        val generation = requestGeneration
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            val result = runCatching {
                repository.submitAttempt(
                    ReviewAttemptRequest(
                        vocabularyItemId = word.id,
                        learningGroupId = data.group.id,
                        source = source,
                        wasCorrect = wasCorrect,
                        elapsedMs = elapsedMs,
                    ),
                )
                if (nextIndex >= nextQueue.size) {
                    repository.completeRound(
                        data.group.id,
                        CompleteLearningRoundRequest(
                            round = session.round,
                            timeZone = timeZone,
                        ),
                    )
                } else {
                    repository.saveSession(
                        data.group.id,
                        session.toSaveRequest(
                            currentIndex = nextIndex,
                            queueWordIds = nextQueue,
                            timeZone = timeZone,
                        ),
                    )
                }
            }
            if (generation != requestGeneration) return@launch
            result.onSuccess { updated ->
                uiState = uiState.copy(
                    data = updated,
                    isSubmitting = false,
                    spellingInput = "",
                    answerFeedback = feedback,
                    errorMessage = null,
                )
                scheduleFeedbackAdvance(feedback.wasCorrect)
            }.onFailure { error ->
                uiState = uiState.copy(
                    isSubmitting = false,
                    errorMessage = error.toLearningErrorMessage(),
                )
            }
            requestInFlight = false
        }
    }

    private fun load(block: suspend () -> LearningSessionData) {
        if (requestInFlight) return
        feedbackAdvanceJob?.cancel()
        val generation = ++requestGeneration
        requestInFlight = true
        uiState = LearningUiState(isLoading = true)
        viewModelScope.launch {
            val preferences = runCatching { preferencesRepository.fetchPreferences() }
                .getOrDefault(DefaultLearningPreferences)
            val result = runCatching { block() }
            if (generation != requestGeneration) return@launch
            result
                .onSuccess { data ->
                    promptStartedAt = clock()
                    uiState = LearningUiState(
                        data = data,
                        preferences = preferences,
                    )
                }
                .onFailure { error ->
                    uiState = LearningUiState(errorMessage = error.toLearningErrorMessage())
                }
            requestInFlight = false
        }
    }

    private fun submit(block: suspend () -> LearningSessionData) {
        if (requestInFlight) return
        requestInFlight = true
        val generation = requestGeneration
        uiState = uiState.copy(isSubmitting = true, errorMessage = null)
        viewModelScope.launch {
            val result = runCatching { block() }
            if (generation != requestGeneration) return@launch
            result
                .onSuccess { data ->
                    promptStartedAt = clock()
                    uiState = uiState.copy(
                        data = data,
                        isSubmitting = false,
                        spellingInput = "",
                        answerFeedback = null,
                        errorMessage = null,
                    )
                }
                .onFailure { error ->
                    uiState = uiState.copy(
                        isSubmitting = false,
                        errorMessage = error.toLearningErrorMessage(),
                    )
                }
            requestInFlight = false
        }
    }

    private fun scheduleFeedbackAdvance(wasCorrect: Boolean) {
        feedbackAdvanceJob?.cancel()
        val delayMs = if (wasCorrect) {
            uiState.preferences.correctAnswerRevealMs
        } else {
            uiState.preferences.wrongAnswerRevealMs
        }
        feedbackAdvanceJob = viewModelScope.launch {
            delay(delayMs.toLong())
            continueAfterFeedback()
        }
    }

    companion object {
        fun factory(
            repository: LearningRepository,
            preferencesRepository: LearningPreferencesRepository,
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    require(modelClass.isAssignableFrom(LearningViewModel::class.java))
                    return LearningViewModel(repository, preferencesRepository) as T
                }
            }
    }
}

internal fun buildRound2Options(
    correct: LearningWord,
    allWords: List<LearningWord>,
): List<Round2Option> {
    val correctSense = correct.senses.firstOrNull()
    val correctOption = Round2Option(
        word = correct.word,
        pos = correctSense?.pos.orEmpty().ifBlank { correct.posTags.firstOrNull().orEmpty() },
        meaning = correctSense?.meaning.orEmpty().ifBlank { correct.meaning },
        isCorrect = true,
    )
    val distractors = buildList {
        correct.round2ChoiceDistractors.forEach { distractor ->
            if (distractor.word.isNotBlank() && distractor.word != correct.word) {
                add(
                    Round2Option(
                        word = distractor.word,
                        pos = distractor.pos,
                        meaning = distractor.meaningZh,
                        isCorrect = false,
                    ),
                )
            }
        }
        allWords.forEach { word ->
            if (word.id != correct.id) {
                val sense = word.senses.firstOrNull()
                add(
                    Round2Option(
                        word = word.word,
                        pos = sense?.pos.orEmpty().ifBlank { word.posTags.firstOrNull().orEmpty() },
                        meaning = sense?.meaning.orEmpty().ifBlank { word.meaning },
                        isCorrect = false,
                    ),
                )
            }
        }
    }.distinctBy { it.word.lowercase() }
        .filter { it.meaning.isNotBlank() }
        .take(3)

    val combined = (distractors + correctOption).distinctBy { it.word.lowercase() }
    if (combined.size <= 1) return combined
    val rotation = (correct.id.hashCode() and Int.MAX_VALUE) % combined.size
    return combined.drop(rotation) + combined.take(rotation)
}

private fun LearningSessionSnapshot.toSaveRequest(
    currentIndex: Int,
    queueWordIds: List<String> = this.queueWordIds,
    round1ConfirmedWordIds: List<String> = this.round1ConfirmedWordIds,
    timeZone: String,
) = SaveLearningSessionRequest(
    round = round,
    currentIndex = currentIndex,
    queueWordIds = queueWordIds,
    passedQueueIndices = passedQueueIndices,
    round1ConfirmedWordIds = round1ConfirmedWordIds,
    timeZone = timeZone,
)

private fun Throwable.toLearningErrorMessage(): String {
    val raw = message.orEmpty()
    return when {
        this is ApiException && statusCode == 401 -> "登录状态已失效，请重新登录。"
        raw.contains("timeout", ignoreCase = true) -> "学习进度保存超时，请检查网络后重试。"
        raw.contains("network", ignoreCase = true) -> "网络连接失败，请检查网络后重试。"
        raw.isNotBlank() -> raw
        else -> "学习进度暂时无法保存，请稍后重试。"
    }
}
