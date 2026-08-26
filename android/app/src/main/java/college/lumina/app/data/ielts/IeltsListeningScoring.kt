package college.lumina.app.data.ielts

fun evaluateIeltsListening(
    questions: List<IeltsListeningQuestion>,
    answers: Map<Int, List<String>>,
): IeltsListeningEvaluation {
    val responses = questions.map { question ->
        val response = answers[question.number].orEmpty().map(::normalizeIeltsAnswer).filter(String::isNotBlank)
        IeltsReadingResponse(
            questionId = question.id,
            questionNumber = question.number,
            response = response,
            correctAnswer = question.answer.map(::normalizeIeltsAnswer).filter(String::isNotBlank),
            isCorrect = response.size == 1 && question.answer.any { answer ->
                normalizeIeltsAnswer(response.singleOrNull().orEmpty()) == normalizeIeltsAnswer(answer) ||
                    looseListening(response.singleOrNull().orEmpty()) == looseListening(answer) ||
                    singularListening(response.singleOrNull().orEmpty()) == singularListening(answer)
            },
        )
    }.toMutableList()

    questions.indices
        .filter { responses[it].correctAnswer.distinct().size > 1 }
        .groupBy { index ->
            "${questions[index].groupId}:${responses[index].correctAnswer.distinct().sorted().joinToString("|")}"
        }
        .values
        .forEach { indexes ->
            val options = responses[indexes.first()].correctAnswer.distinct()
            if (indexes.size < 2 || options.size != indexes.size) return@forEach
            val remaining = options.toMutableList()
            indexes.sortedBy { questions[it].number }.forEach { index ->
                val value = responses[index].response.singleOrNull()
                val matchedIndex = remaining.indexOfFirst { correct ->
                    value != null && (
                        normalizeIeltsAnswer(value) == normalizeIeltsAnswer(correct) ||
                            looseListening(value) == looseListening(correct) ||
                            singularListening(value) == singularListening(correct)
                        )
                }
                responses[index] = responses[index].copy(isCorrect = matchedIndex >= 0)
                if (matchedIndex >= 0) remaining.removeAt(matchedIndex)
            }
        }

    return IeltsListeningEvaluation(
        score = responses.count(IeltsReadingResponse::isCorrect),
        totalQuestions = questions.size,
        responses = responses,
    )
}

private fun looseListening(value: String): String =
    normalizeIeltsAnswer(value).replace(Regex("\\s*-\\s*"), " ").replace(Regex("\\s+"), " ").trim()

private fun singularListening(value: String): String {
    val normalized = looseListening(value)
    return when {
        normalized.endsWith("ies") && normalized.length > 4 -> normalized.dropLast(3) + "y"
        normalized.endsWith("es") && normalized.length > 3 -> normalized.dropLast(2)
        normalized.endsWith("s") && normalized.length > 3 -> normalized.dropLast(1)
        else -> normalized
    }
}
