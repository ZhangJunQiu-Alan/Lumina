package college.lumina.app.data.ielts

import kotlinx.serialization.Serializable

@Serializable
data class IeltsDashboard(
    val readingBooks: List<IeltsBook> = emptyList(),
    val listeningBooks: List<IeltsBook> = emptyList(),
    val readingAttempts: List<IeltsAttempt> = emptyList(),
    val listeningAttempts: List<IeltsAttempt> = emptyList(),
)

@Serializable
data class IeltsBook(
    val id: String,
    val bookNumber: Int,
    val title: String,
    val sourceLabel: String = "",
    val tests: List<IeltsTest> = emptyList(),
)

@Serializable
data class IeltsTest(
    val id: String,
    val bookId: String,
    val bookNumber: Int,
    val bookTitle: String,
    val testNumber: Int,
    val title: String,
    val partCount: Int = 0,
    val questionCount: Int = 0,
)

@Serializable
data class IeltsAttempt(
    val id: String,
    val testId: String,
    val bookTitle: String,
    val bookNumber: Int,
    val testNumber: Int,
    val score: Int,
    val totalQuestions: Int,
    val elapsedSeconds: Int,
    val submittedAt: String,
) {
    val accuracyPercent: Int
        get() = if (totalQuestions > 0) ((score.toDouble() / totalQuestions) * 100).toInt() else 0
}

enum class IeltsModule {
    Reading,
    Listening,
}

data class IeltsTestSelection(
    val module: IeltsModule,
    val test: IeltsTest,
)

@Serializable
data class IeltsReadingTest(
    val id: String,
    val bookId: String,
    val bookNumber: Int,
    val bookTitle: String,
    val testNumber: Int,
    val title: String,
    val passageCount: Int,
    val questionCount: Int,
    val passages: List<IeltsReadingPassage> = emptyList(),
) {
    val questions: List<IeltsReadingQuestion>
        get() = passages.flatMap { passage -> passage.groups.flatMap(IeltsReadingQuestionGroup::questions) }
            .sortedBy(IeltsReadingQuestion::number)
}

@Serializable
data class IeltsReadingPassage(
    val id: String,
    val number: Int,
    val title: String,
    val body: String,
    val wordCount: Int = 0,
    val figures: List<IeltsReadingFigure> = emptyList(),
    val groups: List<IeltsReadingQuestionGroup> = emptyList(),
)

@Serializable
data class IeltsReadingFigure(
    val id: String,
    val figureKey: String = "",
    val title: String = "",
    val caption: String = "",
    val imageUrl: String = "",
    val storagePath: String = "",
    val pdfPage: Int? = null,
    val anchorText: String = "",
    val sortOrder: Int = 0,
)

@Serializable
data class IeltsReadingQuestionGroup(
    val id: String,
    val type: String,
    val prompt: String = "",
    val instructions: String = "",
    val options: List<IeltsOption> = emptyList(),
    val rangeStart: Int? = null,
    val rangeEnd: Int? = null,
    val questions: List<IeltsReadingQuestion> = emptyList(),
)

@Serializable
data class IeltsReadingQuestion(
    val id: String,
    val testId: String,
    val groupId: String,
    val number: Int,
    val prompt: String = "",
    val options: List<IeltsOption> = emptyList(),
    val answer: List<String> = emptyList(),
    val answerNote: String = "",
    val type: String,
    val passageNumber: Int,
)

@Serializable
data class IeltsOption(
    val key: String,
    val text: String,
)

data class IeltsReadingEvaluation(
    val score: Int,
    val totalQuestions: Int,
    val responses: List<IeltsReadingResponse>,
)

@Serializable
data class IeltsReadingResponse(
    val questionId: String,
    val questionNumber: Int,
    val response: List<String>,
    val correctAnswer: List<String>,
    val isCorrect: Boolean,
)

@Serializable
data class SubmittedIeltsAttempt(
    val id: String,
    val submittedAt: String,
)

@Serializable
data class IeltsListeningTest(
    val id: String,
    val bookId: String,
    val bookNumber: Int,
    val bookTitle: String,
    val testNumber: Int,
    val title: String,
    val sectionCount: Int,
    val questionCount: Int,
    val sections: List<IeltsListeningSection> = emptyList(),
) {
    val questions: List<IeltsListeningQuestion>
        get() = sections.flatMap { section -> section.groups.flatMap(IeltsListeningQuestionGroup::questions) }
            .sortedBy(IeltsListeningQuestion::number)
}

@Serializable
data class IeltsListeningSection(
    val id: String,
    val number: Int,
    val title: String,
    val instructions: String = "",
    val audioUrl: String = "",
    val audioStoragePath: String = "",
    val sourceAudioFilename: String = "",
    val paperPages: List<IeltsListeningPaperPage> = emptyList(),
    val groups: List<IeltsListeningQuestionGroup> = emptyList(),
)

@Serializable
data class IeltsListeningPaperPage(
    val pageKey: String,
    val pdfPage: Int,
    val width: Double = 0.0,
    val height: Double = 0.0,
    val storagePath: String = "",
    val imageUrl: String = "",
    val sortOrder: Int = 0,
)

@Serializable
data class IeltsListeningQuestionGroup(
    val id: String,
    val type: String,
    val prompt: String = "",
    val instructions: String = "",
    val options: List<IeltsOption> = emptyList(),
    val rangeStart: Int? = null,
    val rangeEnd: Int? = null,
    val questions: List<IeltsListeningQuestion> = emptyList(),
)

@Serializable
data class IeltsListeningQuestion(
    val id: String,
    val testId: String,
    val sectionId: String,
    val groupId: String,
    val number: Int,
    val prompt: String = "",
    val options: List<IeltsOption> = emptyList(),
    val answer: List<String> = emptyList(),
    val answerNote: String = "",
    val type: String,
    val sectionNumber: Int,
)

data class IeltsListeningEvaluation(
    val score: Int,
    val totalQuestions: Int,
    val responses: List<IeltsReadingResponse>,
)
