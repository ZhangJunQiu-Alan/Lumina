package college.lumina.app.ui.ielts

import college.lumina.app.data.ielts.IeltsDashboard
import college.lumina.app.data.ielts.IeltsReadingEvaluation
import college.lumina.app.data.ielts.IeltsReadingPassage
import college.lumina.app.data.ielts.IeltsReadingQuestion
import college.lumina.app.data.ielts.IeltsReadingQuestionGroup
import college.lumina.app.data.ielts.IeltsReadingTest
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.IeltsListeningEvaluation
import college.lumina.app.data.ielts.IeltsListeningTest
import college.lumina.app.data.ielts.SubmittedIeltsAttempt
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IeltsReadingViewModelTest {
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
    fun loadsAnswersAndSubmitsReadingAttempt() = runTest(dispatcher) {
        val repository = FakeReadingRepository()
        val viewModel = IeltsReadingViewModel(repository)

        viewModel.open("test-1")
        advanceUntilIdle()
        assertFalse(viewModel.uiState.isLoading)

        viewModel.setAnswer(1, listOf("TRUE"))
        viewModel.updateElapsed(120)
        viewModel.submit()
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.result?.score)
        assertEquals(120, repository.submittedElapsed)
        assertEquals("attempt-1", viewModel.uiState.submittedAttempt?.id)
    }
}

private class FakeReadingRepository : IeltsRepository {
    var submittedElapsed = 0

    override suspend fun fetchDashboard() = IeltsDashboard()

    override suspend fun fetchReadingTest(testId: String) = IeltsReadingTest(
        id = testId,
        bookId = "book-19",
        bookNumber = 19,
        bookTitle = "Cambridge IELTS 19",
        testNumber = 1,
        title = "Test 1",
        passageCount = 1,
        questionCount = 1,
        passages = listOf(
            IeltsReadingPassage(
                id = "passage-1",
                number = 1,
                title = "Passage",
                body = "Body",
                groups = listOf(
                    IeltsReadingQuestionGroup(
                        id = "group-1",
                        type = "true_false_not_given",
                        questions = listOf(
                            IeltsReadingQuestion(
                                id = "q-1",
                                testId = testId,
                                groupId = "group-1",
                                number = 1,
                                answer = listOf("TRUE"),
                                type = "true_false_not_given",
                                passageNumber = 1,
                            ),
                        ),
                    ),
                ),
            ),
        ),
    )

    override suspend fun fetchListeningTest(testId: String): IeltsListeningTest =
        error("not used")

    override suspend fun submitReadingAttempt(
        test: IeltsReadingTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsReadingEvaluation,
    ): SubmittedIeltsAttempt {
        submittedElapsed = elapsedSeconds
        return SubmittedIeltsAttempt("attempt-1", "2026-06-12T00:00:00Z")
    }

    override suspend fun submitListeningAttempt(
        test: IeltsListeningTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsListeningEvaluation,
    ): SubmittedIeltsAttempt = error("not used")
}
