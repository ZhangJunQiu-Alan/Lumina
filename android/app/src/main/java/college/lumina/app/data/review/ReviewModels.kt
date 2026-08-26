package college.lumina.app.data.review

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ReviewSessionData(
    val words: List<ReviewWord> = emptyList(),
)

@Serializable
data class ReviewWord(
    val id: String,
    val word: String,
    val phonetic: String = "",
    @SerialName("ipa_uk")
    val ipaUk: String = "",
    @SerialName("ipa_us")
    val ipaUs: String = "",
    @SerialName("pos_tags")
    val posTags: List<String> = emptyList(),
    @SerialName("chinese_definition")
    val chineseDefinition: String = "",
    val senses: List<ReviewSense> = emptyList(),
    val morphology: ReviewMorphology = ReviewMorphology(),
    val confusingPairs: List<ReviewConfusingPair> = emptyList(),
    val memoryState: String = "fuzzy",
    val nextReviewAt: String? = null,
    val lastResult: String? = null,
)

@Serializable
data class ReviewSense(
    val pos: String = "",
    @SerialName("meaning_zh")
    val meaningZh: String = "",
    @SerialName("example_sentence")
    val exampleSentence: String = "",
    @SerialName("example_translation_zh")
    val exampleTranslationZh: String = "",
)

@Serializable
data class ReviewMorphology(
    val summaryZh: String = "",
    val parts: List<ReviewMorphologyPart> = emptyList(),
)

@Serializable
data class ReviewMorphologyPart(
    val text: String = "",
    val kind: String = "",
    val meaningZh: String = "",
    val noteZh: String = "",
)

@Serializable
data class ReviewConfusingPair(
    val word: String = "",
    val difference: String = "",
)

@Serializable
data class ReviewAttemptResult(
    val memoryState: String,
    val nextReviewAt: String? = null,
    val graduated: Boolean = false,
    val ignored: Boolean = false,
    val transition: ReviewTransition,
)

@Serializable
data class ReviewTransition(
    val from: String? = null,
    val to: String,
    val source: String,
    val result: String,
    val graduated: Boolean = false,
    val nextReviewAt: String? = null,
)

@Serializable
data class ReviewSessionRequest(
    val timeZone: String,
)

@Serializable
data class SubmitReviewAttemptRequest(
    val vocabularyItemId: String,
    val source: String = "review",
    val wasCorrect: Boolean,
    val elapsedMs: Long,
)

@Serializable
data class MarkReviewWordUnknownRequest(
    val vocabularyItemId: String,
    val timestamp: Long,
)

@Serializable
data class MarkReviewWordMasteredRequest(
    val vocabularyItemId: String,
)
