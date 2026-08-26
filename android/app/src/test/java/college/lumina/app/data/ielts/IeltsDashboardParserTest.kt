package college.lumina.app.data.ielts

import org.junit.Assert.assertEquals
import org.junit.Test

class IeltsDashboardParserTest {
    @Test
    fun parsesCatalogAndAttempts() {
        val dashboard = IeltsDashboardParser().parse(
            """
            {
              "data": {
                "readingBooks": [{
                  "id": "book-19",
                  "bookNumber": 19,
                  "title": "Cambridge IELTS 19",
                  "tests": [{
                    "id": "reading-1",
                    "bookId": "book-19",
                    "bookNumber": 19,
                    "bookTitle": "Cambridge IELTS 19",
                    "testNumber": 1,
                    "title": "Test 1",
                    "partCount": 3,
                    "questionCount": 40
                  }]
                }],
                "listeningBooks": [],
                "readingAttempts": [{
                  "id": "attempt-1",
                  "testId": "reading-1",
                  "bookTitle": "Cambridge IELTS 19",
                  "bookNumber": 19,
                  "testNumber": 1,
                  "score": 32,
                  "totalQuestions": 40,
                  "elapsedSeconds": 3500,
                  "submittedAt": "2026-06-12T00:00:00Z"
                }],
                "listeningAttempts": []
              }
            }
            """.trimIndent(),
        )

        assertEquals(40, dashboard.readingBooks.single().tests.single().questionCount)
        assertEquals(80, dashboard.readingAttempts.single().accuracyPercent)
    }

    @Test
    fun parsesReadingTestDetail() {
        val test = IeltsDashboardParser().parseReadingTest(
            """
            {
              "data": {
                "id": "test-1",
                "bookId": "book-19",
                "bookNumber": 19,
                "bookTitle": "Cambridge IELTS 19",
                "testNumber": 1,
                "title": "Test 1",
                "passageCount": 1,
                "questionCount": 1,
                "passages": [{
                  "id": "passage-1",
                  "number": 1,
                  "title": "A passage",
                  "body": "Paragraph",
                  "groups": [{
                    "id": "group-1",
                    "type": "multiple_choice_single",
                    "questions": [{
                      "id": "q-1",
                      "testId": "test-1",
                      "groupId": "group-1",
                      "number": 1,
                      "prompt": "Choose",
                      "answer": ["B"],
                      "type": "multiple_choice_single",
                      "passageNumber": 1
                    }]
                  }]
                }]
              }
            }
            """.trimIndent(),
        )

        assertEquals("Choose", test.questions.single().prompt)
        assertEquals("B", test.questions.single().answer.single())
    }

    @Test
    fun parsesListeningTestDetail() {
        val test = IeltsDashboardParser().parseListeningTest(
            """
            {
              "data": {
                "id": "test-1",
                "bookId": "book-19",
                "bookNumber": 19,
                "bookTitle": "Cambridge IELTS 19",
                "testNumber": 1,
                "title": "Test 1",
                "sectionCount": 1,
                "questionCount": 1,
                "sections": [{
                  "id": "section-1",
                  "number": 1,
                  "title": "Section 1",
                  "audioUrl": "https://example.test/audio.mp3",
                  "paperPages": [{"pageKey":"p1","pdfPage":1,"imageUrl":"https://example.test/page.jpg"}],
                  "groups": [{
                    "id": "group-1",
                    "type": "form_completion",
                    "questions": [{
                      "id": "q-1",
                      "testId": "test-1",
                      "sectionId": "section-1",
                      "groupId": "group-1",
                      "number": 1,
                      "prompt": "Name",
                      "answer": ["Tom"],
                      "type": "form_completion",
                      "sectionNumber": 1
                    }]
                  }]
                }]
              }
            }
            """.trimIndent(),
        )

        assertEquals("Name", test.questions.single().prompt)
        assertEquals("https://example.test/audio.mp3", test.sections.single().audioUrl)
    }
}
