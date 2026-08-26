package college.lumina.app.ui.ielts

import college.lumina.app.data.ielts.IeltsAttempt
import college.lumina.app.data.ielts.IeltsBook
import college.lumina.app.data.ielts.IeltsDashboard
import college.lumina.app.data.ielts.IeltsModule
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.IeltsListeningEvaluation
import college.lumina.app.data.ielts.IeltsListeningTest
import college.lumina.app.data.ielts.IeltsReadingEvaluation
import college.lumina.app.data.ielts.IeltsReadingTest
import college.lumina.app.data.ielts.SubmittedIeltsAttempt
import college.lumina.app.data.ielts.IeltsTest
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
class IeltsViewModelTest {
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
    fun loadsDashboardAndRecommendsFirstUnfinishedTest() = runTest(dispatcher) {
        val viewModel = IeltsViewModel(FakeIeltsRepository())
        advanceUntilIdle()

        assertFalse(viewModel.uiState.isLoading)
        assertEquals(7.0, viewModel.uiState.currentBand ?: 0.0, 0.01)
        assertEquals("reading-2", viewModel.uiState.nextTest?.test?.id)

        val next = viewModel.uiState.nextTest!!
        viewModel.selectTest(next.module, next.test)
        assertEquals(IeltsModule.Reading, viewModel.uiState.selectedTest?.module)
    }
}

private class FakeIeltsRepository : IeltsRepository {
    override suspend fun fetchDashboard(): IeltsDashboard {
        val first = test("reading-1", 1)
        val second = test("reading-2", 2)
        return IeltsDashboard(
            readingBooks = listOf(
                IeltsBook(
                    id = "book-19",
                    bookNumber = 19,
                    title = "Cambridge IELTS 19",
                    tests = listOf(first, second),
                ),
            ),
            readingAttempts = listOf(
                IeltsAttempt(
                    id = "attempt-1",
                    testId = first.id,
                    bookTitle = first.bookTitle,
                    bookNumber = first.bookNumber,
                    testNumber = first.testNumber,
                    score = 31,
                    totalQuestions = 40,
                    elapsedSeconds = 3600,
                    submittedAt = "2026-06-12T00:00:00Z",
                ),
            ),
        )
    }

    override suspend fun fetchReadingTest(testId: String): IeltsReadingTest =
        error("not used")

    override suspend fun fetchListeningTest(testId: String): IeltsListeningTest =
        error("not used")

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
    ): SubmittedIeltsAttempt = error("not used")

    private fun test(id: String, number: Int) = IeltsTest(
        id = id,
        bookId = "book-19",
        bookNumber = 19,
        bookTitle = "Cambridge IELTS 19",
        testNumber = number,
        title = "Test $number",
        partCount = 3,
        questionCount = 40,
    )
}
