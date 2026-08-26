package college.lumina.app.data.ielts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class IeltsReadingScoringTest {
    @Test
    fun normalizesTextAndScoresChoiceAndCompletionAnswers() {
        val questions = listOf(
            question(1, "true_false_not_given", listOf("TRUE")),
            question(2, "sentence_completion", listOf("batteries")),
            question(3, "multiple_choice_multi", listOf("A", "C")),
        )

        val result = evaluateIeltsReading(
            questions,
            mapOf(
                1 to listOf(" true "),
                2 to listOf("battery"),
                3 to listOf("c", "a"),
            ),
        )

        assertEquals(3, result.score)
        assertTrue(result.responses.all(IeltsReadingResponse::isCorrect))
    }

    @Test
    fun scoresSharedMultiChoiceOptionsOnceAcrossQuestionNumbers() {
        val questions = listOf(
            question(11, "multiple_choice_multi", listOf("A", "C")).copy(groupId = "group-shared"),
            question(12, "multiple_choice_multi", listOf("A", "C")).copy(groupId = "group-shared"),
        )

        val correct = evaluateIeltsReading(questions, mapOf(11 to listOf("C"), 12 to listOf("A")))
        val duplicate = evaluateIeltsReading(questions, mapOf(11 to listOf("A"), 12 to listOf("A")))

        assertEquals(2, correct.score)
        assertEquals(1, duplicate.score)
    }

    private fun question(number: Int, type: String, answer: List<String>) = IeltsReadingQuestion(
        id = "q-$number",
        testId = "test-1",
        groupId = "group-$number",
        number = number,
        answer = answer,
        type = type,
        passageNumber = 1,
    )
}
