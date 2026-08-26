package college.lumina.app.ui.learning

import college.lumina.app.data.learning.CompleteLearningRoundRequest
import college.lumina.app.data.learning.LearningGroup
import college.lumina.app.data.learning.LearningRepository
import college.lumina.app.data.learning.LearningSense
import college.lumina.app.data.learning.LearningSessionData
import college.lumina.app.data.learning.LearningSessionSnapshot
import college.lumina.app.data.learning.LearningWord
import college.lumina.app.data.learning.ReviewAttemptRequest
import college.lumina.app.data.learning.Round2ChoiceDistractor
import college.lumina.app.data.learning.SaveLearningSessionRequest
import college.lumina.app.data.settings.DefaultLearningPreferences
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.data.settings.LearningPreferencesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LearningViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun round1PersistsConfirmedWordsBeforeChangingRound() = runTest(dispatcher) {
        val repository = FakeLearningRepository(sampleSession(round = "round1"))
        val viewModel = createViewModel(repository, clock = { 1_000L })

        viewModel.openGroup("group-1")
        advanceUntilIdle()
        viewModel.confirmRound1(confirmed = true)
        advanceUntilIdle()

        assertEquals(listOf("word-1"), repository.lastSave?.round1ConfirmedWordIds)
        assertEquals(1, viewModel.uiState.session?.currentIndex)

        viewModel.confirmRound1(confirmed = false)
        advanceUntilIdle()

        assertEquals(listOf("word-1"), repository.lastComplete?.confirmedWordIds)
        assertTrue(viewModel.uiState.data?.completed == true)
    }

    @Test
    fun round2RecordsAttemptBeforeAdvancingAndKeepsRevealOptions() = runTest(dispatcher) {
        val initial = sampleSession(round = "round2").copy(
            session = LearningSessionSnapshot(
                round = "round2",
                currentIndex = 0,
                queueWordIds = listOf("word-1"),
                round1ConfirmedWordIds = listOf("word-1"),
            ),
        )
        val repository = FakeLearningRepository(initial)
        val viewModel = createViewModel(repository, clock = { 2_000L })

        viewModel.openGroup("group-1")
        advanceUntilIdle()
        val options = viewModel.round2Options()
        val wrong = options.first { !it.isCorrect }
        viewModel.selectRound2Option(wrong)
        runCurrent()

        assertEquals(4, options.size)
        assertEquals(listOf("attempt", "complete"), repository.operations)
        assertFalse(repository.lastAttempt?.wasCorrect ?: true)
        assertEquals(4, viewModel.uiState.answerFeedback?.options?.size)
        assertEquals(wrong.word, viewModel.uiState.answerFeedback?.selectedWord)
    }

    @Test
    fun wrongRound3AnswerIsRequeuedAfterFutureWords() = runTest(dispatcher) {
        val repository = FakeLearningRepository(sampleSession(round = "round3"))
        var now = 5_000L
        val viewModel = createViewModel(repository, clock = { now })

        viewModel.openGroup("group-1")
        advanceUntilIdle()
        now = 7_500L
        viewModel.setSpellingInput("wrong")
        viewModel.submitRound3()
        runCurrent()

        assertEquals(listOf("attempt", "save"), repository.operations)
        assertEquals(2_500L, repository.lastAttempt?.elapsedMs)
        assertEquals(listOf("word-1", "word-2", "word-1"), repository.lastSave?.queueWordIds)
        assertEquals(1, repository.lastSave?.currentIndex)
        assertFalse(viewModel.uiState.answerFeedback?.wasCorrect ?: true)
    }

    @Test
    fun loadsAccountPreferencesWithLearningSession() = runTest(dispatcher) {
        val repository = FakeLearningRepository(sampleSession(round = "round1"))
        val preferences = DefaultLearningPreferences.copy(
            defaultPronunciationLocale = "us",
            memoryTipEnabled = false,
        )
        val viewModel = LearningViewModel(
            repository = repository,
            preferencesRepository = FakeLearningPreferencesRepository(preferences),
            timeZone = "Asia/Shanghai",
        )

        viewModel.openGroup("group-1")
        advanceUntilIdle()

        assertEquals("us", viewModel.uiState.preferences.defaultPronunciationLocale)
        assertFalse(viewModel.uiState.preferences.memoryTipEnabled)
    }

    @Test
    fun clearsCorrectFeedbackAfterConfiguredDelay() = runTest(dispatcher) {
        val initial = sampleSession(round = "round2").copy(
            session = LearningSessionSnapshot(
                round = "round2",
                currentIndex = 0,
                queueWordIds = listOf("word-1", "word-2"),
                round1ConfirmedWordIds = listOf("word-1", "word-2"),
            ),
        )
        val repository = FakeLearningRepository(initial)
        val preferences = DefaultLearningPreferences.copy(correctAnswerRevealMs = 800)
        val viewModel = LearningViewModel(
            repository = repository,
            preferencesRepository = FakeLearningPreferencesRepository(preferences),
            timeZone = "Asia/Shanghai",
        )
        viewModel.openGroup("group-1")
        advanceUntilIdle()

        viewModel.selectRound2Option(viewModel.round2Options().first { it.isCorrect })
        runCurrent()

        assertTrue(viewModel.uiState.answerFeedback?.wasCorrect == true)
        advanceTimeBy(800)
        runCurrent()

        assertEquals(null, viewModel.uiState.answerFeedback)
        assertEquals(1, viewModel.uiState.session?.currentIndex)
    }

    private fun createViewModel(
        repository: LearningRepository,
        clock: () -> Long,
    ) = LearningViewModel(
        repository = repository,
        preferencesRepository = FakeLearningPreferencesRepository(DefaultLearningPreferences),
        timeZone = "Asia/Shanghai",
        clock = clock,
    )
}

private class FakeLearningPreferencesRepository(
    private val preferences: LearningPreferences,
) : LearningPreferencesRepository {
    override suspend fun fetchPreferences(): LearningPreferences = preferences

    override suspend fun savePreferences(preferences: LearningPreferences): LearningPreferences = preferences
}

private class FakeLearningRepository(
    private var current: LearningSessionData,
) : LearningRepository {
    val operations = mutableListOf<String>()
    var lastSave: SaveLearningSessionRequest? = null
    var lastComplete: CompleteLearningRoundRequest? = null
    var lastAttempt: ReviewAttemptRequest? = null

    override suspend fun fetchGroup(groupId: String) = current

    override suspend fun startOfficial(
        libraryId: String,
        mode: String,
        timeZone: String,
    ) = current

    override suspend fun saveSession(
        groupId: String,
        request: SaveLearningSessionRequest,
    ): LearningSessionData {
        operations += "save"
        lastSave = request
        current = current.copy(
            session = LearningSessionSnapshot(
                round = request.round,
                currentIndex = request.currentIndex,
                queueWordIds = request.queueWordIds,
                passedQueueIndices = request.passedQueueIndices,
                round1ConfirmedWordIds = request.round1ConfirmedWordIds,
            ),
        )
        return current
    }

    override suspend fun completeRound(
        groupId: String,
        request: CompleteLearningRoundRequest,
    ): LearningSessionData {
        operations += "complete"
        lastComplete = request
        current = current.copy(
            session = null,
            completed = true,
            group = current.group.copy(status = "completed"),
        )
        return current
    }

    override suspend fun submitAttempt(request: ReviewAttemptRequest) {
        operations += "attempt"
        lastAttempt = request
    }
}

private fun sampleSession(round: String): LearningSessionData {
    val words = listOf(
        LearningWord(
            id = "word-1",
            word = "course",
            meaning = "课程",
            senses = listOf(LearningSense(pos = "n.", meaning = "课程")),
            round2ChoiceDistractors = listOf(
                Round2ChoiceDistractor("cause", "n.", "原因"),
                Round2ChoiceDistractor("court", "n.", "法庭"),
                Round2ChoiceDistractor("coarse", "adj.", "粗糙的"),
            ),
        ),
        LearningWord(
            id = "word-2",
            word = "study",
            meaning = "学习",
            senses = listOf(LearningSense(pos = "v.", meaning = "学习")),
        ),
    )
    return LearningSessionData(
        group = LearningGroup(id = "group-1", title = "测试学习组"),
        session = LearningSessionSnapshot(
            round = round,
            currentIndex = 0,
            queueWordIds = words.map { it.id },
            round1ConfirmedWordIds = if (round == "round1") emptyList() else words.map { it.id },
        ),
        words = words,
    )
}
