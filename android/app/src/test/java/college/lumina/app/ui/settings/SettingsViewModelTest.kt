package college.lumina.app.ui.settings

import college.lumina.app.data.settings.DefaultLearningPreferences
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.data.settings.LearningPreferencesRepository
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
class SettingsViewModelTest {
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
    fun loadsPreferencesOnInit() = runTest(dispatcher) {
        val repository = FakeLearningPreferencesRepository(
            DefaultLearningPreferences.copy(defaultPronunciationLocale = "us"),
        )
        val viewModel = SettingsViewModel(repository)

        advanceUntilIdle()

        assertFalse(viewModel.uiState.isLoading)
        assertEquals("us", viewModel.uiState.preferences.defaultPronunciationLocale)
    }

    @Test
    fun savesChangedPreference() = runTest(dispatcher) {
        val repository = FakeLearningPreferencesRepository(DefaultLearningPreferences)
        val viewModel = SettingsViewModel(repository)
        advanceUntilIdle()

        viewModel.setSpeechPlaybackRate(0.8)
        advanceUntilIdle()

        assertEquals(0.8, viewModel.uiState.preferences.speechPlaybackRate, 0.0)
        assertEquals(0.8, repository.saved.single().speechPlaybackRate, 0.0)
        assertEquals("设置已保存。", viewModel.uiState.statusMessage)
    }

    @Test
    fun keepsOneReinforcementRoundEnabledWhenTurningOffOnlyEnabledRound() = runTest(dispatcher) {
        val repository = FakeLearningPreferencesRepository(
            DefaultLearningPreferences.copy(
                round2Enabled = true,
                reinforcementRound3Enabled = false,
            ),
        )
        val viewModel = SettingsViewModel(repository)
        advanceUntilIdle()

        viewModel.setRound3DictationEnabled(false)
        advanceUntilIdle()

        assertFalse(viewModel.uiState.preferences.round2Enabled)
        assertTrue(viewModel.uiState.preferences.reinforcementRound3Enabled)
        assertFalse(repository.saved.single().round2Enabled)
        assertTrue(repository.saved.single().reinforcementRound3Enabled)
    }

    @Test
    fun resetsToDefaults() = runTest(dispatcher) {
        val repository = FakeLearningPreferencesRepository(
            DefaultLearningPreferences.copy(
                autoPlayEnabled = true,
                memoryTipEnabled = false,
            ),
        )
        val viewModel = SettingsViewModel(repository)
        advanceUntilIdle()

        viewModel.resetDefaults()
        advanceUntilIdle()

        assertEquals(DefaultLearningPreferences, viewModel.uiState.preferences)
    }
}

private class FakeLearningPreferencesRepository(
    private var current: LearningPreferences,
) : LearningPreferencesRepository {
    val saved = mutableListOf<LearningPreferences>()

    override suspend fun fetchPreferences(): LearningPreferences = current

    override suspend fun savePreferences(preferences: LearningPreferences): LearningPreferences {
        saved += preferences
        current = preferences
        return preferences
    }
}
