package college.lumina.app.data.settings

import kotlinx.serialization.Serializable

@Serializable
data class LearningPreferences(
    val defaultPronunciationLocale: String = "uk",
    val ieltsTargetScore: Double = 7.0,
    val speechPlaybackRate: Double = 1.0,
    val autoPlayEnabled: Boolean = false,
    val autoPlayRepeatCount: Int = 3,
    val autoPlayRepeatGapMs: Int = 1500,
    val correctAnswerRevealMs: Int = 1000,
    val wrongAnswerRevealMs: Int = 8000,
    val round2Enabled: Boolean = true,
    val reinforcementRound3Enabled: Boolean = true,
    val reinforcementArticleEnabled: Boolean = false,
    val popoverAutoPlayEnabled: Boolean = false,
    val clozeSentenceAutoPlayEnabled: Boolean = true,
    val memoryTipEnabled: Boolean = true,
)

val DefaultLearningPreferences = LearningPreferences()

val SpeechPlaybackRateOptions = listOf(0.6, 0.8, 1.0)
val IeltsTargetScoreOptions = listOf(5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0)
val AutoPlayRepeatOptions = listOf(1, 2, 3)
val AutoPlayGapOptions = listOf(1000, 1500, 2500)
val CorrectAnswerRevealOptions = listOf(800, 1000, 1500, 2000)
val WrongAnswerRevealOptions = listOf(3000, 5000, 8000)

enum class ReinforcementRoundPreference {
    Round3Dictation,
    Round2Recall,
}

fun LearningPreferences.withReinforcementRoundToggle(
    preference: ReinforcementRoundPreference,
    checked: Boolean,
): LearningPreferences {
    val next = when (preference) {
        ReinforcementRoundPreference.Round3Dictation -> copy(round2Enabled = checked)
        ReinforcementRoundPreference.Round2Recall -> copy(reinforcementRound3Enabled = checked)
    }

    return if (!next.round2Enabled && !next.reinforcementRound3Enabled) {
        when (preference) {
            ReinforcementRoundPreference.Round3Dictation -> next.copy(reinforcementRound3Enabled = true)
            ReinforcementRoundPreference.Round2Recall -> next.copy(round2Enabled = true)
        }
    } else {
        next
    }
}
