package college.lumina.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import college.lumina.app.ui.LuminaApp
import college.lumina.app.ui.theme.LuminaTheme
import io.github.jan.supabase.auth.handleDeeplinks

class MainActivity : ComponentActivity() {
    private val appContainer: AppContainerAccessor
        get() = AppContainerAccessor(application as LuminaApplication)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        appContainer.handleAuthIntent(intent)

        setContent {
            LuminaTheme {
                LuminaApp(
                    authRepository = appContainer.authRepository,
                    homeRepository = appContainer.homeRepository,
                    ieltsRepository = appContainer.ieltsRepository,
                    libraryRepository = appContainer.libraryRepository,
                    learningRepository = appContainer.learningRepository,
                    reviewRepository = appContainer.reviewRepository,
                    learningPreferencesRepository = appContainer.learningPreferencesRepository,
                    wordAudioRepository = appContainer.wordAudioRepository,
                    wordLookupRepository = appContainer.wordLookupRepository,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        appContainer.handleAuthIntent(intent)
    }
}

private class AppContainerAccessor(
    application: LuminaApplication,
) {
    private val container = application.container

    val authRepository
        get() = container.authRepository

    val homeRepository
        get() = container.homeRepository

    val ieltsRepository
        get() = container.ieltsRepository

    val libraryRepository
        get() = container.libraryRepository

    val learningRepository
        get() = container.learningRepository

    val reviewRepository
        get() = container.reviewRepository

    val learningPreferencesRepository
        get() = container.learningPreferencesRepository

    val wordAudioRepository
        get() = container.wordAudioRepository

    val wordLookupRepository
        get() = container.wordLookupRepository

    fun handleAuthIntent(intent: Intent) {
        container.supabaseClient.handleDeeplinks(intent)
    }
}
