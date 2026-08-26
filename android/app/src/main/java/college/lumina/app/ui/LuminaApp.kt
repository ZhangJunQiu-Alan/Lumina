package college.lumina.app.ui

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import college.lumina.app.data.auth.AuthRepository
import college.lumina.app.data.auth.AuthSessionState
import college.lumina.app.data.audio.WordAudioRepository
import college.lumina.app.data.home.HomeRepository
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.IeltsModule
import college.lumina.app.data.library.LibraryRepository
import college.lumina.app.data.learning.LearningRepository
import college.lumina.app.data.review.ReviewRepository
import college.lumina.app.data.settings.LearningPreferencesRepository
import college.lumina.app.data.vocab.WordLookupRepository
import college.lumina.app.ui.auth.AuthScreen
import college.lumina.app.ui.auth.AuthViewModel
import college.lumina.app.ui.auth.SessionLoadingScreen
import college.lumina.app.ui.home.HomeScreen
import college.lumina.app.ui.home.HomeViewModel
import college.lumina.app.ui.ielts.IeltsScreen
import college.lumina.app.ui.ielts.IeltsViewModel
import college.lumina.app.ui.ielts.IeltsReadingScreen
import college.lumina.app.ui.ielts.IeltsReadingViewModel
import college.lumina.app.ui.ielts.IeltsListeningScreen
import college.lumina.app.ui.ielts.IeltsListeningViewModel
import college.lumina.app.ui.library.LibraryScreen
import college.lumina.app.ui.library.LibraryViewModel
import college.lumina.app.ui.learning.LearningScreen
import college.lumina.app.ui.learning.LearningViewModel
import college.lumina.app.ui.review.ReviewScreen
import college.lumina.app.ui.review.ReviewViewModel
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import college.lumina.app.ui.settings.SettingsScreen
import college.lumina.app.ui.settings.SettingsViewModel
import college.lumina.app.ui.vocab.WordLookupSheet
import college.lumina.app.ui.vocab.WordLookupViewModel

private enum class AppSection {
    Home,
    Library,
    Ielts,
    IeltsReading,
    IeltsListening,
    Learning,
    Review,
    Settings,
}

@Composable
fun LuminaApp(
    authRepository: AuthRepository,
    homeRepository: HomeRepository,
    ieltsRepository: IeltsRepository,
    libraryRepository: LibraryRepository,
    learningRepository: LearningRepository,
    reviewRepository: ReviewRepository,
    learningPreferencesRepository: LearningPreferencesRepository,
    wordAudioRepository: WordAudioRepository,
    wordLookupRepository: WordLookupRepository,
) {
    val viewModel: AuthViewModel = viewModel(
        factory = AuthViewModel.factory(authRepository),
    )
    val state = viewModel.uiState

    when (val sessionState = state.sessionState) {
        AuthSessionState.Initializing -> SessionLoadingScreen()
        AuthSessionState.SignedOut -> AuthScreen(
            state = state,
            onModeChange = viewModel::setMode,
            onFullNameChange = viewModel::setFullName,
            onEmailChange = viewModel::setEmail,
            onPasswordChange = viewModel::setPassword,
            onConfirmPasswordChange = viewModel::setConfirmPassword,
            onSubmit = viewModel::submit,
        )

        is AuthSessionState.SignedIn -> {
            var selectedSection by rememberSaveable { mutableStateOf(AppSection.Home) }
            val homeViewModel: HomeViewModel = viewModel(
                key = "home-${sessionState.user.id}",
                factory = HomeViewModel.factory(homeRepository),
            )
            val libraryViewModel: LibraryViewModel = viewModel(
                key = "library-${sessionState.user.id}",
                factory = LibraryViewModel.factory(libraryRepository),
            )
            val ieltsViewModel: IeltsViewModel = viewModel(
                key = "ielts-${sessionState.user.id}",
                factory = IeltsViewModel.factory(ieltsRepository),
            )
            val ieltsReadingViewModel: IeltsReadingViewModel = viewModel(
                key = "ielts-reading-${sessionState.user.id}",
                factory = IeltsReadingViewModel.factory(ieltsRepository),
            )
            val ieltsListeningViewModel: IeltsListeningViewModel = viewModel(
                key = "ielts-listening-${sessionState.user.id}",
                factory = IeltsListeningViewModel.factory(ieltsRepository),
            )
            val learningViewModel: LearningViewModel = viewModel(
                key = "learning-${sessionState.user.id}",
                factory = LearningViewModel.factory(
                    learningRepository,
                    learningPreferencesRepository,
                ),
            )
            val reviewViewModel: ReviewViewModel = viewModel(
                key = "review-${sessionState.user.id}",
                factory = ReviewViewModel.factory(reviewRepository),
            )
            val settingsViewModel: SettingsViewModel = viewModel(
                key = "settings-${sessionState.user.id}",
                factory = SettingsViewModel.factory(learningPreferencesRepository),
            )
            val wordLookupViewModel: WordLookupViewModel = viewModel(
                key = "word-lookup-${sessionState.user.id}",
                factory = WordLookupViewModel.factory(wordLookupRepository),
            )

            fun openGroup(groupId: String) {
                learningViewModel.openGroup(groupId)
                selectedSection = AppSection.Learning
            }

            fun startOfficial(
                libraryId: String,
                mode: String,
            ) {
                learningViewModel.startOfficial(libraryId, mode)
                selectedSection = AppSection.Learning
            }

            fun exitLearning() {
                learningViewModel.close()
                homeViewModel.refresh()
                libraryViewModel.refresh()
                selectedSection = AppSection.Home
            }

            fun startReview() {
                reviewViewModel.start()
                selectedSection = AppSection.Review
            }

            fun exitReview() {
                reviewViewModel.close()
                homeViewModel.refresh()
                libraryViewModel.refresh()
                selectedSection = AppSection.Home
            }

            fun openIeltsReading(testId: String) {
                ieltsReadingViewModel.open(testId)
                selectedSection = AppSection.IeltsReading
            }

            fun exitIeltsReading() {
                ieltsReadingViewModel.close()
                ieltsViewModel.refresh()
                selectedSection = AppSection.Ielts
            }

            fun openIeltsListening(testId: String) {
                ieltsListeningViewModel.open(testId)
                selectedSection = AppSection.IeltsListening
            }

            fun exitIeltsListening() {
                ieltsListeningViewModel.close()
                ieltsViewModel.refresh()
                selectedSection = AppSection.Ielts
            }

            Scaffold(
                bottomBar = {
                    if (
                        selectedSection != AppSection.Learning &&
                        selectedSection != AppSection.Review &&
                        selectedSection != AppSection.IeltsReading &&
                        selectedSection != AppSection.IeltsListening
                    ) {
                        NavigationBar {
                            NavigationBarItem(
                                selected = selectedSection == AppSection.Home,
                                onClick = { selectedSection = AppSection.Home },
                                icon = {
                                    Text(
                                        text = "首页",
                                        fontWeight = FontWeight.Black,
                                    )
                                },
                            )
                            NavigationBarItem(
                                selected = selectedSection == AppSection.Library,
                                onClick = { selectedSection = AppSection.Library },
                                icon = {
                                    Text(
                                        text = "词库",
                                        fontWeight = FontWeight.Black,
                                    )
                                },
                            )
                            NavigationBarItem(
                                selected = selectedSection == AppSection.Ielts,
                                onClick = { selectedSection = AppSection.Ielts },
                                icon = {
                                    Text(
                                        text = "IELTS",
                                        fontWeight = FontWeight.Black,
                                    )
                                },
                            )
                            NavigationBarItem(
                                selected = selectedSection == AppSection.Settings,
                                onClick = { selectedSection = AppSection.Settings },
                                icon = {
                                    Text(
                                        text = "设置",
                                        fontWeight = FontWeight.Black,
                                    )
                                },
                            )
                        }
                    }
                },
            ) { contentPadding: PaddingValues ->
                when (selectedSection) {
                    AppSection.Home -> HomeScreen(
                        user = sessionState.user,
                        state = homeViewModel.uiState,
                        contentPadding = contentPadding,
                        isSigningOut = state.isSubmitting,
                        authErrorMessage = state.feedback?.takeIf { it.isError }?.message,
                        onRefresh = homeViewModel::refresh,
                        onSelectDate = homeViewModel::selectDate,
                        onSelectLibrary = homeViewModel::selectOfficialLibrary,
                        onSelectStudyMode = homeViewModel::selectStudyMode,
                        onPrimaryAction = {
                            val homeState = homeViewModel.uiState
                            val overview = homeState.overview ?: return@HomeScreen
                            when (overview.routineCard.ctaMode) {
                                "open_library" -> selectedSection = AppSection.Library
                                "start_review", "continue_review" -> startReview()
                                else -> {
                                    val groupId = overview.routineCard.boundLearningGroupId
                                        ?: overview.resumeCandidate?.groupId
                                    if (groupId != null) {
                                        openGroup(groupId)
                                    } else {
                                        val libraryId = homeState.selectedOfficialLibraryId
                                        if (libraryId != null) {
                                            startOfficial(libraryId, homeState.selectedStudyMode)
                                        } else {
                                            selectedSection = AppSection.Library
                                        }
                                    }
                                }
                            }
                        },
                        onDismissActionMessage = homeViewModel::dismissActionMessage,
                        onSignOut = viewModel::signOut,
                    )

                    AppSection.Library -> LibraryScreen(
                        state = libraryViewModel.uiState,
                        contentPadding = contentPadding,
                        onRefresh = libraryViewModel::refresh,
                        onSelectTab = libraryViewModel::selectTab,
                        onOpenOfficialLibrary = libraryViewModel::openOfficialLibrary,
                        onClearLibraryFilter = libraryViewModel::clearLibraryFilter,
                        onOpenGroup = libraryViewModel::openGroup,
                        onCloseGroup = libraryViewModel::closeGroup,
                        onSelectWord = libraryViewModel::selectWord,
                        onDismissWord = libraryViewModel::dismissWord,
                        onStartGroup = ::openGroup,
                        onStartOfficial = ::startOfficial,
                        onLookupWord = wordLookupViewModel::open,
                        onRemoveSavedWord = libraryViewModel::removeSavedWord,
                        onStartSavedWordsGroup = {
                            libraryViewModel.startSavedWordsGroup(::openGroup)
                        },
                    )

                    AppSection.Ielts -> IeltsScreen(
                        state = ieltsViewModel.uiState,
                        targetScore = settingsViewModel.uiState.preferences.ieltsTargetScore,
                        contentPadding = contentPadding,
                        onRefresh = ieltsViewModel::refresh,
                        onSelectTab = ieltsViewModel::selectTab,
                        onSelectTest = { module, test ->
                            if (module == IeltsModule.Reading) openIeltsReading(test.id)
                            else openIeltsListening(test.id)
                        },
                        onDismissTest = ieltsViewModel::dismissTest,
                    )

                    AppSection.IeltsReading -> IeltsReadingScreen(
                        state = ieltsReadingViewModel.uiState,
                        contentPadding = contentPadding,
                        onExit = ::exitIeltsReading,
                        onRetry = ieltsReadingViewModel::retry,
                        onTick = ieltsReadingViewModel::updateElapsed,
                        onSelectPane = ieltsReadingViewModel::selectPane,
                        onSelectPassage = ieltsReadingViewModel::selectPassage,
                        onAnswer = ieltsReadingViewModel::setAnswer,
                        onSubmit = ieltsReadingViewModel::submit,
                    )

                    AppSection.IeltsListening -> IeltsListeningScreen(
                        state = ieltsListeningViewModel.uiState,
                        contentPadding = contentPadding,
                        onExit = ::exitIeltsListening,
                        onRetry = ieltsListeningViewModel::retry,
                        onTick = ieltsListeningViewModel::updateElapsed,
                        onSelectSection = ieltsListeningViewModel::selectSection,
                        onAnswer = ieltsListeningViewModel::setAnswer,
                        onSubmit = ieltsListeningViewModel::submit,
                    )

                    AppSection.Learning -> LearningScreen(
                        state = learningViewModel.uiState,
                        round2Options = learningViewModel.round2Options(),
                        wordAudioRepository = wordAudioRepository,
                        onLookupWord = wordLookupViewModel::open,
                        onExit = ::exitLearning,
                        onRetry = learningViewModel::retry,
                        onRound1Action = learningViewModel::confirmRound1,
                        onRound2Select = learningViewModel::selectRound2Option,
                        onSpellingInput = learningViewModel::setSpellingInput,
                        onSubmitRound3 = learningViewModel::submitRound3,
                        onContinue = learningViewModel::continueAfterFeedback,
                        onDismissError = learningViewModel::dismissError,
                    )

                    AppSection.Review -> ReviewScreen(
                        state = reviewViewModel.uiState,
                        onExit = ::exitReview,
                        onRetry = reviewViewModel::start,
                        onInputChange = reviewViewModel::setInput,
                        onSubmit = reviewViewModel::submitAnswer,
                        onReveal = reviewViewModel::revealAnswer,
                        onReturnToAnswer = reviewViewModel::returnToAnswer,
                        onUnknown = reviewViewModel::markUnknown,
                        onMastered = reviewViewModel::markMastered,
                        onContinue = reviewViewModel::continueAfterFeedback,
                        onDismissError = reviewViewModel::dismissError,
                        onLookupWord = wordLookupViewModel::open,
                    )

                    AppSection.Settings -> SettingsScreen(
                        state = settingsViewModel.uiState,
                        contentPadding = contentPadding,
                        onRefresh = settingsViewModel::refresh,
                        onDefaultPronunciationLocaleChange = settingsViewModel::setDefaultPronunciationLocale,
                        onIeltsTargetScoreChange = settingsViewModel::setIeltsTargetScore,
                        onSpeechPlaybackRateChange = settingsViewModel::setSpeechPlaybackRate,
                        onAutoPlayEnabledChange = settingsViewModel::setAutoPlayEnabled,
                        onAutoPlayRepeatCountChange = settingsViewModel::setAutoPlayRepeatCount,
                        onAutoPlayRepeatGapMsChange = settingsViewModel::setAutoPlayRepeatGapMs,
                        onCorrectAnswerRevealMsChange = settingsViewModel::setCorrectAnswerRevealMs,
                        onWrongAnswerRevealMsChange = settingsViewModel::setWrongAnswerRevealMs,
                        onRound3DictationEnabledChange = settingsViewModel::setRound3DictationEnabled,
                        onRound2RecallEnabledChange = settingsViewModel::setRound2RecallEnabled,
                        onReinforcementArticleEnabledChange = settingsViewModel::setReinforcementArticleEnabled,
                        onPopoverAutoPlayEnabledChange = settingsViewModel::setPopoverAutoPlayEnabled,
                        onClozeSentenceAutoPlayEnabledChange = settingsViewModel::setClozeSentenceAutoPlayEnabled,
                        onMemoryTipEnabledChange = settingsViewModel::setMemoryTipEnabled,
                        onResetDefaults = settingsViewModel::resetDefaults,
                        onDismissMessages = settingsViewModel::dismissMessages,
                    )
                }
            }

            WordLookupSheet(
                state = wordLookupViewModel.uiState,
                preferences = settingsViewModel.uiState.preferences,
                wordAudioRepository = wordAudioRepository,
                onDismiss = {
                    wordLookupViewModel.close()
                    libraryViewModel.refresh()
                },
                onToggleSaved = wordLookupViewModel::toggleSaved,
                onDismissMessage = wordLookupViewModel::dismissMessage,
            )
        }
    }
}
