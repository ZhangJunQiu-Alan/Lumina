package college.lumina.app.data.vocab

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WordLookupResult(
    @SerialName("vocabulary_item")
    val vocabularyItem: WordLookupVocabularyItem,
    val senses: List<WordLookupSense> = emptyList(),
    @SerialName("in_user_library")
    val inUserLibrary: Boolean = false,
    @SerialName("srs_state")
    val srsState: String? = null,
)

@Serializable
data class WordLookupVocabularyItem(
    val id: String,
    val word: String,
    @SerialName("ipa_uk")
    val ipaUk: String? = null,
    @SerialName("ipa_us")
    val ipaUs: String? = null,
    @SerialName("primary_meaning_zh")
    val primaryMeaningZh: String? = null,
    @SerialName("morphology_summary_zh")
    val morphologySummaryZh: String? = null,
    @SerialName("memory_tip")
    val memoryTip: String? = null,
    @SerialName("audio_uk_url")
    val audioUkUrl: String? = null,
    @SerialName("audio_us_url")
    val audioUsUrl: String? = null,
)

@Serializable
data class WordLookupSense(
    val pos: String = "",
    @SerialName("meaning_zh")
    val meaningZh: String = "",
)

@Serializable
data class SaveWordResult(
    val vocabularyItemId: String = "",
    val saved: Boolean = false,
    val inserted: Boolean = false,
    val skippedReason: String? = null,
)
