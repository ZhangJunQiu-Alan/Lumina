package college.lumina.app.ui.home

import college.lumina.app.data.home.HomeOfficialLibraryOption
import college.lumina.app.data.home.HomeOverview
import college.lumina.app.data.home.HomeRepository
import college.lumina.app.data.home.OrbitDay
import college.lumina.app.data.home.RoutineCard
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
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
    fun loadsOverviewAndAllowsDateSelection() = runTest(dispatcher) {
        val viewModel = HomeViewModel(
            homeRepository = FakeHomeRepository(sampleOverview()),
            timeZone = "Asia/Shanghai",
        )

        advanceUntilIdle()

        assertFalse(viewModel.uiState.isLoading)
        assertEquals("2026-06-11", viewModel.uiState.selectedDate)
        assertEquals(20, viewModel.uiState.selectedDay?.learnedWordCount)

        viewModel.selectDate("2026-06-10")
        assertEquals(8, viewModel.uiState.selectedDay?.reviewWordCount)
    }

    @Test
    fun keepsFailureVisibleWhenInitialLoadFails() = runTest(dispatcher) {
        val viewModel = HomeViewModel(
            homeRepository = FailingHomeRepository(),
            timeZone = "Asia/Shanghai",
        )

        advanceUntilIdle()

        assertFalse(viewModel.uiState.isLoading)
        assertTrue(viewModel.uiState.errorMessage?.contains("offline") == true)
    }

    @Test
    fun selectsOfficialLibraryAndStudyModeLocally() = runTest(dispatcher) {
        val overview = sampleOverview().copy(
            routineCard = RoutineCard(
                selectedOfficialLibraryId = "ielts-vocab",
                officialLibraryOptions = listOf(
                    HomeOfficialLibraryOption(
                        libraryId = "ielts-vocab",
                        title = "雅思词汇真经",
                        mode = "sequential",
                    ),
                    HomeOfficialLibraryOption(
                        libraryId = "gre-zhenkao-v7",
                        title = "GRE 镇考机经词",
                        mode = "shuffle",
                    ),
                ),
            ),
        )
        val viewModel = HomeViewModel(
            homeRepository = FakeHomeRepository(overview),
            timeZone = "Asia/Shanghai",
        )
        advanceUntilIdle()

        viewModel.selectOfficialLibrary("gre-zhenkao-v7")
        assertEquals("gre-zhenkao-v7", viewModel.uiState.selectedOfficialLibraryId)
        assertEquals("shuffle", viewModel.uiState.selectedStudyMode)

        viewModel.selectStudyMode("sequential")
        assertEquals("sequential", viewModel.uiState.selectedStudyMode)
    }
}

private class FakeHomeRepository(
    private val overview: HomeOverview,
) : HomeRepository {
    override suspend fun fetchOverview(timeZone: String) = overview
}

private class FailingHomeRepository : HomeRepository {
    override suspend fun fetchOverview(timeZone: String): HomeOverview {
        error("offline")
    }
}

private fun sampleOverview() = HomeOverview(
    orbitDays = listOf(
        OrbitDay(
            date = "2026-06-10",
            weekdayLabel = "周三",
            shortDateLabel = "6/10",
            status = "ordinary",
            reviewWordCount = 8,
            learnedWordCount = 12,
        ),
        OrbitDay(
            date = "2026-06-11",
            weekdayLabel = "周四",
            shortDateLabel = "6/11",
            status = "perfect",
            reviewWordCount = 10,
            learnedWordCount = 20,
        ),
    ),
    selectedDate = "2026-06-11",
    routineCard = RoutineCard(),
)
