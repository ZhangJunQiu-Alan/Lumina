package college.lumina.app.ui.ielts

import college.lumina.app.data.ielts.IeltsDashboard
import college.lumina.app.data.ielts.IeltsListeningEvaluation
import college.lumina.app.data.ielts.IeltsListeningQuestion
import college.lumina.app.data.ielts.IeltsListeningQuestionGroup
import college.lumina.app.data.ielts.IeltsListeningSection
import college.lumina.app.data.ielts.IeltsListeningTest
import college.lumina.app.data.ielts.IeltsReadingEvaluation
import college.lumina.app.data.ielts.IeltsReadingTest
import college.lumina.app.data.ielts.IeltsRepository
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class IeltsListeningViewModelTest {
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
    fun loadsAnswersAndSubmitsListeningAttempt() = runTest(dispatcher) {
        val repository = FakeListeningRepository()
        val viewModel = IeltsListeningViewModel(repository)
        viewModel.open("test-1")
        advanceUntilIdle()

        viewModel.setAnswer(1, listOf("Tom"))
        viewModel.updateElapsed(90)
        viewModel.submit()
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.result?.score)
        assertEquals(90, repository.submittedElapsed)
    }
}

private class FakeListeningRepository : IeltsRepository {
    var submittedElapsed = 0

    override suspend fun fetchDashboard() = IeltsDashboard()
    override suspend fun fetchReadingTest(testId: String): IeltsReadingTest = error("not used")
    override suspend fun fetchListeningTest(testId: String) = IeltsListeningTest(
        id = testId,
        bookId = "book-19",
        bookNumber = 19,
        bookTitle = "Cambridge IELTS 19",
        testNumber = 1,
        title = "Test 1",
        sectionCount = 1,
        questionCount = 1,
        sections = listOf(
            IeltsListeningSection(
                id = "section-1",
                number = 1,
                title = "Section 1",
                groups = listOf(
                    IeltsListeningQuestionGroup(
                        id = "group-1",
                        type = "form_completion",
                        questions = listOf(
                            IeltsListeningQuestion(
                                id = "q-1",
                                testId = testId,
                                sectionId = "section-1",
                                groupId = "group-1",
                                number = 1,
                                answer = listOf("Tom"),
                                type = "form_completion",
                                sectionNumber = 1,
                            ),
                        ),
                    ),
                ),
            ),
        ),
    )

    override suspend fun submitReadingAttempt(
        test: IeltsReadingTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsReadingEvaluation,
    ): SubmittedIeltsAttempt = error("not used")

    override suspend fun submitListeningAttempt(
        test: IeltsListeningTest,
        startedAt: String,
        elapsedSeconds: Int,
        evaluation: IeltsListeningEvaluation,
    ): SubmittedIeltsAttempt {
        submittedElapsed = elapsedSeconds
        return SubmittedIeltsAttempt("attempt-1", "2026-06-12T00:00:00Z")
    }
}
