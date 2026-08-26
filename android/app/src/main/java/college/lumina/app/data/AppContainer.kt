package college.lumina.app.data

import college.lumina.app.BuildConfig
import college.lumina.app.data.api.AuthenticatedApiClient
import college.lumina.app.data.api.SupabaseApiSession
import college.lumina.app.data.audio.RemoteWordAudioRepository
import college.lumina.app.data.audio.WordAudioRepository
import college.lumina.app.data.auth.AuthRepository
import college.lumina.app.data.auth.SupabaseAuthRepository
import college.lumina.app.data.home.HomeRepository
import college.lumina.app.data.home.RemoteHomeRepository
import college.lumina.app.data.ielts.IeltsRepository
import college.lumina.app.data.ielts.RemoteIeltsRepository
import college.lumina.app.data.library.LibraryRepository
import college.lumina.app.data.library.RemoteLibraryRepository
import college.lumina.app.data.learning.LearningRepository
import college.lumina.app.data.learning.RemoteLearningRepository
import college.lumina.app.data.review.RemoteReviewRepository
import college.lumina.app.data.review.ReviewRepository
import college.lumina.app.data.settings.LearningPreferencesRepository
import college.lumina.app.data.settings.RemoteLearningPreferencesRepository
import college.lumina.app.data.vocab.RemoteWordLookupRepository
import college.lumina.app.data.vocab.WordLookupRepository
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.createSupabaseClient

class AppContainer private constructor(
    val supabaseClient: SupabaseClient,
    val authRepository: AuthRepository,
    val homeRepository: HomeRepository,
    val ieltsRepository: IeltsRepository,
    val libraryRepository: LibraryRepository,
    val learningRepository: LearningRepository,
    val reviewRepository: ReviewRepository,
    val learningPreferencesRepository: LearningPreferencesRepository,
    val wordAudioRepository: WordAudioRepository,
    val wordLookupRepository: WordLookupRepository,
) {
    companion object {
        fun create(): AppContainer {
            check(BuildConfig.SUPABASE_URL.isNotBlank()) {
                "Missing SUPABASE_URL. Configure android/local.properties or the repository .env file."
            }
            check(BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()) {
                "Missing SUPABASE_PUBLISHABLE_KEY. Configure android/local.properties or the repository .env file."
            }
            check(BuildConfig.API_BASE_URL.isNotBlank()) {
                "Missing API_BASE_URL. Configure android/local.properties or the repository .env file."
            }

            val supabaseClient = createSupabaseClient(
                supabaseUrl = BuildConfig.SUPABASE_URL,
                supabaseKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            ) {
                install(Auth) {
                    flowType = FlowType.PKCE
                    scheme = "lumina"
                    host = "auth"
                }
            }

            val apiClient = AuthenticatedApiClient(
                session = SupabaseApiSession(supabaseClient.auth),
                baseUrl = BuildConfig.API_BASE_URL,
            )

            return AppContainer(
                supabaseClient = supabaseClient,
                authRepository = SupabaseAuthRepository(supabaseClient.auth),
                homeRepository = RemoteHomeRepository(apiClient),
                ieltsRepository = RemoteIeltsRepository(apiClient),
                libraryRepository = RemoteLibraryRepository(apiClient),
                learningRepository = RemoteLearningRepository(apiClient),
                reviewRepository = RemoteReviewRepository(apiClient),
                learningPreferencesRepository = RemoteLearningPreferencesRepository(apiClient),
                wordAudioRepository = RemoteWordAudioRepository(apiClient),
                wordLookupRepository = RemoteWordLookupRepository(apiClient),
            )
        }
    }
}
