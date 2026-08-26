package college.lumina.app.data.home

import kotlinx.serialization.Serializable

@Serializable
data class HomeOverview(
    val todayReviewCount: Int = 0,
    val streak: Int = 0,
    val perfectCheckinDays: Int = 0,
    val stableRecallCount: Int = 0,
    val orbitDays: List<OrbitDay> = emptyList(),
    val activityDays: List<ActivityDay> = emptyList(),
    val selectedDate: String = "",
    val selectedDayReviewWordCount: Int = 0,
    val selectedDayLearnedWordCount: Int = 0,
    val resumeCandidate: ResumeCandidate? = null,
    val routineCard: RoutineCard = RoutineCard(),
)

@Serializable
data class OrbitDay(
    val date: String,
    val weekdayLabel: String,
    val shortDateLabel: String,
    val status: String,
    val reviewWordCount: Int = 0,
    val learnedWordCount: Int = 0,
)

@Serializable
data class ActivityDay(
    val date: String,
    val weekdayLabel: String,
    val shortDateLabel: String,
    val status: String,
    val reviewWordCount: Int = 0,
    val learnedWordCount: Int = 0,
    val attemptCount: Int = 0,
    val correctAttemptCount: Int = 0,
    val accuracy: Int? = null,
)

@Serializable
data class ResumeCandidate(
    val groupId: String,
    val round: String,
    val currentIndex: Int = 0,
    val queueWordIds: List<String> = emptyList(),
    val passedQueueIndices: List<Int> = emptyList(),
    val round1ConfirmedWordIds: List<String> = emptyList(),
    val lastActiveAt: String = "",
    val groupCompleted: Boolean = false,
    val completedAt: String? = null,
    val libraryId: String? = null,
    val officialMode: String? = null,
    val article: String? = null,
    val groupTitle: String = "",
    val createdAt: String = "",
    val queueLength: Int = 0,
)

@Serializable
data class RoutineCard(
    val state: String = "not_started",
    val title: String = "今日学习",
    val subtitle: String = "",
    val ctaLabel: String = "开始学习",
    val ctaMode: String = "start_learning",
    val boundLearningGroupId: String? = null,
    val visibleSteps: List<RoutineStep> = emptyList(),
    val lastUsedOfficialLibraryId: String? = null,
    val lastUsedOfficialMode: String? = null,
    val lastUsedOfficialGroupCount: Int = 0,
    val selectedOfficialLibraryId: String? = null,
    val officialLibraryOptions: List<HomeOfficialLibraryOption> = emptyList(),
)

@Serializable
data class RoutineStep(
    val key: String,
    val label: String,
    val status: String,
)

@Serializable
data class HomeOfficialLibraryOption(
    val libraryId: String,
    val title: String,
    val mode: String = "sequential",
    val existingGroupCount: Int = 0,
    val activeGroupId: String? = null,
    val activeRound: String? = null,
    val confirmedWordCount: Int = 0,
    val loadedWordCount: Int = 0,
    val completedMemoryWordCount: Int = 0,
    val totalWordCount: Int = 0,
)
