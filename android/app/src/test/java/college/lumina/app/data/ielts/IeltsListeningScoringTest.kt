package college.lumina.app.data.ielts

import org.junit.Assert.assertEquals
import org.junit.Test

class IeltsListeningScoringTest {
    @Test
    fun scoresTextAndSharedAlternatives() {
        val questions = listOf(
            question(1, listOf("batteries")),
            question(2, listOf("A", "D")).copy(groupId = "shared"),
            question(3, listOf("A", "D")).copy(groupId = "shared"),
        )

        val result = evaluateIeltsListening(
            questions,
            mapOf(1 to listOf("battery"), 2 to listOf("D"), 3 to listOf("A")),
        )

        assertEquals(3, result.score)
    }

    private fun question(number: Int, answer: List<String>) = IeltsListeningQuestion(
        id = "q-$number",
        testId = "test-1",
        sectionId = "section-1",
        groupId = "group-$number",
        number = number,
        answer = answer,
        type = "form_completion",
        sectionNumber = 1,
    )
}
