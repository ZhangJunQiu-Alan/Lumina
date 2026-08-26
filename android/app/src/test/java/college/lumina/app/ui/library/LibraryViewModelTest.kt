package college.lumina.app.ui.library

import college.lumina.app.data.library.LibraryGroupDetail
import college.lumina.app.data.library.LibraryGroupSummary
import college.lumina.app.data.library.LibraryGroupWord
import college.lumina.app.data.library.LibraryOverview
import college.lumina.app.data.library.LibraryRepository
import college.lumina.app.data.library.OfficialLibraryOverview
import college.lumina.app.data.library.SavedWordEntry
import college.lumina.app.data.library.CreateSavedWordsGroupResult
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LibraryViewModelTest {
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
    fun loadsOverviewFiltersLibraryAndOpensGroup() = runTest(dispatcher) {
        val repository = FakeLibraryRepository()
        val viewModel = LibraryViewModel(repository)
        advanceUntilIdle()

        assertFalse(viewModel.uiState.isLoading)
        assertEquals(1, viewModel.uiState.overview?.officialLibraries?.size)
        assertEquals("saved", viewModel.uiState.savedWords.single().word)

        viewModel.openOfficialLibrary("ielts-vocab")
        assertEquals(LibraryTab.Groups, viewModel.uiState.selectedTab)
        assertEquals("ielts-vocab", viewModel.uiState.selectedLibraryId)

        viewModel.openGroup("group-1")
        advanceUntilIdle()
        assertEquals("course", viewModel.uiState.groupDetail?.words?.single()?.word)

        viewModel.selectWord("word-1")
        assertEquals("word-1", viewModel.uiState.selectedWord?.id)

        viewModel.closeGroup()
        assertNull(viewModel.uiState.groupDetail)
    }

    @Test
    fun removesSavedWordAndCreatesGroupFromFirstThirtyAvailableWords() = runTest(dispatcher) {
        val repository = FakeLibraryRepository(savedWordCount = 31)
        val viewModel = LibraryViewModel(repository)
        advanceUntilIdle()

        viewModel.removeSavedWord("saved-31")
        advanceUntilIdle()
        assertEquals(30, viewModel.uiState.savedWords.size)

        var openedGroupId: String? = null
        viewModel.startSavedWordsGroup { openedGroupId = it }
        advanceUntilIdle()

        assertEquals("created-group", openedGroupId)
        assertEquals(30, repository.createdFromIds.size)
        assertEquals("saved-1", repository.createdFromIds.first())
    }
}

private class FakeLibraryRepository(
    private val savedWordCount: Int = 1,
) : LibraryRepository {
    var createdFromIds: List<String> = emptyList()
    private val group = LibraryGroupSummary(
        id = "group-1",
        title = "雅思词汇真经 · 0001-0030",
        createdAt = "2026-06-11T08:00:00Z",
        wordCount = 1,
        sourceType = "system",
        libraryId = "ielts-vocab",
    )

    override suspend fun fetchOverview() = LibraryOverview(
        officialLibraries = listOf(
            OfficialLibraryOverview(
                libraryId = "ielts-vocab",
                title = "雅思词汇真经",
                totalWordCount = 3631,
            ),
        ),
        groups = listOf(group),
    )

    override suspend fun fetchGroupDetail(groupId: String) = LibraryGroupDetail(
        group = group,
        words = listOf(
            LibraryGroupWord(
                id = "word-1",
                word = "course",
                meaning = "课程",
            ),
        ),
    )

    override suspend fun fetchSavedWords() = (1..savedWordCount).map { index ->
        SavedWordEntry(
            id = "row-$index",
            vocabularyItemId = "saved-$index",
            word = "saved",
            meaning = "已保存",
        )
    }

    override suspend fun removeSavedWord(vocabularyItemId: String) = Unit

    override suspend fun createLearningGroupFromSavedWords(
        vocabularyItemIds: List<String>,
    ): CreateSavedWordsGroupResult {
        createdFromIds = vocabularyItemIds
        return CreateSavedWordsGroupResult(groupId = "created-group", wordCount = vocabularyItemIds.size)
    }
}
