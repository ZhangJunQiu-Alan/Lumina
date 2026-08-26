package college.lumina.app.data.ielts

private val outerPunctuation = setOf(
    ' ',
    '\t',
    '\n',
    '\r',
    '"',
    '\'',
    '.',
    ',',
    ';',
    ':',
    '!',
    '?',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
)

fun normalizeIeltsAnswer(value: String): String =
    value
        .replace(Regex("[‐‑‒–—]"), "-")
        .replace(Regex("[‘’]"), "'")
        .replace(Regex("[“”]"), "\"")
        .trim { it in outerPunctuation }
        .replace(Regex("\\s+"), " ")
        .trim()
        .lowercase()

private fun loose(value: String): String =
    normalizeIeltsAnswer(value).replace(Regex("\\s*-\\s*"), " ").replace(Regex("\\s+"), " ").trim()

private fun singular(value: String): String {
    val normalized = loose(value)
    return when {
        normalized.endsWith("ies") && normalized.length > 4 -> normalized.dropLast(3) + "y"
        normalized.endsWith("es") && normalized.length > 3 -> normalized.dropLast(2)
        normalized.endsWith("s") && normalized.length > 3 -> normalized.dropLast(1)
        else -> normalized
    }
}

private fun matches(left: String, right: String): Boolean {
    val normalizedLeft = normalizeIeltsAnswer(left)
    val normalizedRight = normalizeIeltsAnswer(right)
    return normalizedLeft.isNotBlank() &&
        normalizedRight.isNotBlank() &&
        (normalizedLeft == normalizedRight || loose(normalizedLeft) == loose(normalizedRight) ||
            singular(normalizedLeft) == singular(normalizedRight))
}

private fun isCorrect(question: IeltsReadingQuestion, response: List<String>): Boolean {
    val normalizedResponse = response.map(::normalizeIeltsAnswer).filter(String::isNotBlank)
    val answers = question.answer.map(::normalizeIeltsAnswer).filter(String::isNotBlank)
    if (question.type == "multiple_choice_multi") {
        if (normalizedResponse.size != answers.size || answers.isEmpty()) return false
        val unmatched = answers.toMutableList()
        return normalizedResponse.all { value ->
            val index = unmatched.indexOfFirst { matches(value, it) }
            if (index < 0) false else {
                unmatched.removeAt(index)
                true
            }
        } && unmatched.isEmpty()
    }
    return normalizedResponse.size == 1 && answers.any { matches(normalizedResponse.single(), it) }
}

fun evaluateIeltsReading(
    questions: List<IeltsReadingQuestion>,
    answers: Map<Int, List<String>>,
): IeltsReadingEvaluation {
    val responses = questions.map { question ->
        val response = answers[question.number].orEmpty().map(::normalizeIeltsAnswer).filter(String::isNotBlank)
        IeltsReadingResponse(
            questionId = question.id,
            questionNumber = question.number,
            response = response,
            correctAnswer = question.answer.map(::normalizeIeltsAnswer).filter(String::isNotBlank),
            isCorrect = isCorrect(question, response),
        )
    }.toMutableList()

    questions.indices
        .filter { questions[it].type == "multiple_choice_multi" && responses[it].correctAnswer.size > 1 }
        .groupBy { index ->
            "${questions[index].groupId}:${responses[index].correctAnswer.sorted().joinToString("|")}"
        }
        .values
        .forEach { indexes ->
            val correctOptions = responses[indexes.first()].correctAnswer.distinct()
            if (indexes.size < 2 || correctOptions.size != indexes.size) return@forEach
            val remaining = correctOptions.toMutableList()
            indexes.sortedBy { questions[it].number }.forEach { index ->
                val response = responses[index].response
                val matchedIndex = if (response.size == 1) {
                    remaining.indexOfFirst { matches(response.single(), it) }
                } else {
                    -1
                }
                responses[index] = responses[index].copy(isCorrect = matchedIndex >= 0)
                if (matchedIndex >= 0) remaining.removeAt(matchedIndex)
            }
        }

    return IeltsReadingEvaluation(
        score = responses.count(IeltsReadingResponse::isCorrect),
        totalQuestions = questions.size,
        responses = responses,
    )
}
