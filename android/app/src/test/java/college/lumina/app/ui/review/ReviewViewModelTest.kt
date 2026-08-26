package college.lumina.app.ui.review

import college.lumina.app.data.review.MarkReviewWordMasteredRequest
import college.lumina.app.data.review.MarkReviewWordUnknownRequest
import college.lumina.app.data.review.ReviewAttemptResult
import college.lumina.app.data.review.ReviewRepository
import college.lumina.app.data.review.ReviewSessionData
import college.lumina.app.data.review.ReviewTransition
import college.lumina.app.data.review.ReviewWord
import college.lumina.app.data.review.SubmitReviewAttemptRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModelTest {
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
    fun correctLastAnswerIsPersistedBeforeRoutineCompletion() = runTest(dispatcher) {
        val repository = FakeReviewRepository(listOf(reviewWord("word-1", "course")))
        var now = 1_000L
        val viewModel = ReviewViewModel(repository, timeZone = "Asia/Shanghai", clock = { now })

        viewModel.start()
        advanceUntilIdle()
        now = 3_500L
        viewModel.setInput("course")
        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(listOf("start", "attempt"), repository.operations)
        assertEquals(2_500L, repository.lastAttempt?.elapsedMs)
        assertFalse(viewModel.uiState.isCompleted)

        viewModel.continueAfterFeedback()
        advanceUntilIdle()

        assertEquals(listOf("start", "attempt", "complete"), repository.operations)
        assertTrue(viewModel.uiState.isCompleted)
        assertEquals("slow_recall", viewModel.uiState.summary.single().transition.to)
    }

    @Test
    fun wrongAnswerIsRequeuedAfterTwoFutureWords() = runTest(dispatcher) {
        val repository = FakeReviewRepository(
            listOf(
                reviewWord("word-1", "course"),
                reviewWord("word-2", "study"),
                reviewWord("word-3", "learn"),
            ),
        )
        val viewModel = ReviewViewModel(repository, clock = { 1_000L })

        viewModel.start()
        advanceUntilIdle()
        viewModel.setInput("wrong")
        viewModel.submitAnswer()
        advanceUntilIdle()

        assertEquals(listOf("word-1", "word-2", "word-3", "word-1"), viewModel.uiState.queueWordIds)
        assertFalse(viewModel.uiState.completedWordIds.contains("word-1"))

        viewModel.continueAfterFeedback()

        assertEquals(1, viewModel.uiState.currentIndex)
        assertEquals("word-2", viewModel.uiState.currentWord?.id)
    }

    @Test
    fun revealDoesNotWriteUntilUnknownIsConfirmed() = runTest(dispatcher) {
        val repository = FakeReviewRepository(listOf(reviewWord("word-1", "course")))
        val viewModel = ReviewViewModel(repository, clock = { 5_000L })

        viewModel.start()
        advanceUntilIdle()
        viewModel.revealAnswer()

        assertEquals(listOf("start"), repository.operations)
        assertNull(viewModel.uiState.feedback?.result)

        viewModel.markUnknown()
        advanceUntilIdle()

        assertEquals(listOf("start", "unknown"), repository.operations)
        assertEquals("fuzzy", viewModel.uiState.feedback?.result?.transition?.to)
        assertTrue(viewModel.uiState.completedWordIds.contains("word-1"))
    }
}

private class FakeReviewRepository(
    private val words: List<ReviewWord>,
) : ReviewRepository {
    val operations = mutableListOf<String>()
    var lastAttempt: SubmitReviewAttemptRequest? = null

    override suspend fun startSession(timeZone: String): ReviewSessionData {
        operations += "start"
        return ReviewSessionData(words)
    }

    override suspend fun submitAttempt(request: SubmitReviewAttemptRequest): ReviewAttemptResult {
        operations += "attempt"
        lastAttempt = request
        return attemptResult(
            from = "fuzzy",
            to = if (request.wasCorrect) "slow_recall" else "fuzzy",
            result = if (request.wasCorrect) "fast_correct" else "wrong",
        )
    }

    override suspend fun markUnknown(request: MarkReviewWordUnknownRequest): ReviewAttemptResult {
        operations += "unknown"
        return attemptResult(from = "stable_recall", to = "fuzzy", result = "wrong")
    }

    override suspend fun markMastered(request: MarkReviewWordMasteredRequest): ReviewAttemptResult {
        operations += "mastered"
        return attemptResult(from = "stable_recall", to = "mastered", result = "fast_correct")
    }

    override suspend fun completeSession(timeZone: String) {
        operations += "complete"
    }
}

private fun reviewWord(
    id: String,
    word: String,
) = ReviewWord(
    id = id,
    word = word,
    chineseDefinition = "释义-$word",
)

private fun attemptResult(
    from: String,
    to: String,
    result: String,
) = ReviewAttemptResult(
    memoryState = to,
    transition = ReviewTransition(
        from = from,
        to = to,
        source = "review",
        result = result,
        graduated = to == "mastered",
    ),
)
