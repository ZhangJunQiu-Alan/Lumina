package college.lumina.app.data.learning

import kotlinx.serialization.Serializable

@Serializable
data class LearningSessionData(
    val group: LearningGroup = LearningGroup(),
    val session: LearningSessionSnapshot? = null,
    val words: List<LearningWord> = emptyList(),
    val preferences: LearningRoundPreferences = LearningRoundPreferences(),
    val completed: Boolean = false,
)

@Serializable
data class LearningGroup(
    val id: String = "",
    val title: String = "",
    val sourceType: String = "custom",
    val libraryId: String? = null,
    val officialMode: String? = null,
    val status: String = "active",
)

@Serializable
data class LearningSessionSnapshot(
    val round: String = "round1",
    val currentIndex: Int = 0,
    val queueWordIds: List<String> = emptyList(),
    val passedQueueIndices: List<Int> = emptyList(),
    val round1ConfirmedWordIds: List<String> = emptyList(),
)

@Serializable
data class LearningRoundPreferences(
    val recallEnabled: Boolean = true,
    val dictationEnabled: Boolean = true,
)

@Serializable
data class LearningWord(
    val id: String,
    val word: String,
    val phonetic: String = "",
    val ipaUk: String = "",
    val ipaUs: String = "",
    val meaning: String = "",
    val memoryTip: String = "",
    val posTags: List<String> = emptyList(),
    val senses: List<LearningSense> = emptyList(),
    val morphologySummary: String = "",
    val morphologyParts: List<LearningMorphologyPart> = emptyList(),
    val derivedWords: List<LearningRelation> = emptyList(),
    val synonyms: List<LearningRelation> = emptyList(),
    val antonyms: List<LearningRelation> = emptyList(),
    val confusingPairs: List<LearningConfusingPair> = emptyList(),
    val round2ChoiceDistractors: List<Round2ChoiceDistractor> = emptyList(),
)

@Serializable
data class LearningSense(
    val pos: String = "",
    val meaning: String = "",
    val exampleSentence: String = "",
    val exampleTranslation: String = "",
)

@Serializable
data class LearningMorphologyPart(
    val text: String = "",
    val kind: String = "root",
    val meaning: String = "",
    val note: String = "",
)

@Serializable
data class LearningRelation(
    val word: String = "",
    val meaning: String = "",
    val note: String = "",
)

@Serializable
data class LearningConfusingPair(
    val word: String = "",
    val difference: String = "",
)

@Serializable
data class Round2ChoiceDistractor(
    val word: String = "",
    val pos: String = "",
    val meaningZh: String = "",
)

@Serializable
data class SaveLearningSessionRequest(
    val round: String,
    val currentIndex: Int,
    val queueWordIds: List<String>,
    val passedQueueIndices: List<Int>,
    val round1ConfirmedWordIds: List<String>,
    val timeZone: String,
)

@Serializable
data class CompleteLearningRoundRequest(
    val round: String,
    val confirmedWordIds: List<String> = emptyList(),
    val timeZone: String,
)

@Serializable
data class StartOfficialLearningRequest(
    val mode: String,
    val timeZone: String,
)

@Serializable
data class ReviewAttemptRequest(
    val vocabularyItemId: String,
    val learningGroupId: String,
    val source: String,
    val wasCorrect: Boolean,
    val elapsedMs: Long,
)
