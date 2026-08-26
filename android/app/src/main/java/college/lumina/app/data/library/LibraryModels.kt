package college.lumina.app.data.library

import kotlinx.serialization.Serializable

@Serializable
data class LibraryOverview(
    val officialLibraries: List<OfficialLibraryOverview> = emptyList(),
    val groups: List<LibraryGroupSummary> = emptyList(),
)

@Serializable
data class OfficialLibraryOverview(
    val libraryId: String,
    val title: String,
    val description: String = "",
    val totalWordCount: Int = 0,
    val existingGroupCount: Int = 0,
    val loadedWordCount: Int = 0,
    val unlockedWordCount: Int = 0,
    val completedMemoryWordCount: Int = 0,
    val activeGroupId: String? = null,
    val activeRound: String? = null,
    val mode: String = "sequential",
)

@Serializable
data class LibraryGroupSummary(
    val id: String,
    val title: String,
    val createdAt: String,
    val wordCount: Int = 0,
    val sourceType: String = "custom",
    val libraryId: String? = null,
    val status: String = "active",
    val sessionRound: String? = null,
    val completedAt: String? = null,
)

@Serializable
data class LibraryGroupDetail(
    val group: LibraryGroupSummary? = null,
    val words: List<LibraryGroupWord> = emptyList(),
)

@Serializable
data class LibraryGroupWord(
    val id: String,
    val word: String,
    val phonetic: String = "",
    val meaning: String = "",
    val memoryTip: String = "",
    val posTags: List<String> = emptyList(),
    val examples: List<LibraryWordExample> = emptyList(),
    val memoryState: String = "new",
    val nextReviewAt: String? = null,
    val lastResult: String? = null,
    val sequenceNo: Int = 0,
)

@Serializable
data class LibraryWordExample(
    val sentence: String,
    val translation: String = "",
)

@Serializable
data class SavedWordEntry(
    val id: String,
    val vocabularyItemId: String,
    val word: String,
    val phonetic: String = "",
    val meaning: String = "",
    val exampleSentence: String = "",
    val enrichmentLevel: String = "full",
    val source: String = "manual",
    val savedAt: String = "",
    val memoryState: String = "new",
    val nextReviewAt: String? = null,
    val lastResult: String? = null,
    val isInActiveLearningGroup: Boolean = false,
)

@Serializable
data class CreateSavedWordsGroupResult(
    val groupId: String,
    val wordCount: Int,
)
