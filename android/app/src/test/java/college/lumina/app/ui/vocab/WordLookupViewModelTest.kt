package college.lumina.app.ui.vocab

import college.lumina.app.data.vocab.SaveWordResult
import college.lumina.app.data.vocab.WordLookupRepository
import college.lumina.app.data.vocab.WordLookupResult
import college.lumina.app.data.vocab.WordLookupSense
import college.lumina.app.data.vocab.WordLookupVocabularyItem
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
class WordLookupViewModelTest {
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
    fun opensLookupAndAddsWordToLibrary() = runTest(dispatcher) {
        val repository = FakeWordLookupRepository(sampleLookup())
        val viewModel = WordLookupViewModel(repository)

        viewModel.open("course")
        advanceUntilIdle()
        assertEquals("course", viewModel.uiState.result?.vocabularyItem?.word)
        assertFalse(viewModel.uiState.result?.inUserLibrary ?: true)

        viewModel.toggleSaved()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.result?.inUserLibrary == true)
        assertEquals("已加入个人词库。", viewModel.uiState.statusMessage)
    }

    @Test
    fun removesAlreadySavedWord() = runTest(dispatcher) {
        val repository = FakeWordLookupRepository(sampleLookup().copy(inUserLibrary = true))
        val viewModel = WordLookupViewModel(repository)
        viewModel.open("course")
        advanceUntilIdle()

        viewModel.toggleSaved()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.result?.inUserLibrary ?: true)
        assertEquals(listOf("word-1"), repository.removedIds)
    }
}

private class FakeWordLookupRepository(
    private var current: WordLookupResult?,
) : WordLookupRepository {
    val removedIds = mutableListOf<String>()

    override suspend fun lookup(word: String): WordLookupResult? = current

    override suspend fun save(vocabularyItemId: String): SaveWordResult {
        current = current?.copy(inUserLibrary = true)
        return SaveWordResult(
            vocabularyItemId = vocabularyItemId,
            saved = true,
            inserted = true,
        )
    }

    override suspend fun remove(vocabularyItemId: String) {
        removedIds += vocabularyItemId
        current = current?.copy(inUserLibrary = false)
    }
}

private fun sampleLookup() = WordLookupResult(
    vocabularyItem = WordLookupVocabularyItem(
        id = "word-1",
        word = "course",
        ipaUk = "/kɔːs/",
        primaryMeaningZh = "课程",
    ),
    senses = listOf(WordLookupSense(pos = "n.", meaningZh = "课程")),
)
