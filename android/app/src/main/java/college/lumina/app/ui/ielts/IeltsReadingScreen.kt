package college.lumina.app.ui.ielts

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import college.lumina.app.data.ielts.IeltsOption
import college.lumina.app.data.ielts.IeltsReadingFigure
import college.lumina.app.data.ielts.IeltsReadingQuestion
import college.lumina.app.data.ielts.IeltsReadingQuestionGroup
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal
import kotlinx.coroutines.delay

@Composable
fun IeltsReadingScreen(
    state: IeltsReadingUiState,
    contentPadding: PaddingValues,
    onExit: () -> Unit,
    onRetry: () -> Unit,
    onTick: (Int) -> Unit,
    onSelectPane: (ReadingPane) -> Unit,
    onSelectPassage: (Int) -> Unit,
    onAnswer: (Int, List<String>) -> Unit,
    onSubmit: () -> Unit,
) {
    var confirmExit by remember { mutableStateOf(false) }
    var confirmSubmit by remember { mutableStateOf(false) }
    BackHandler {
        if (state.result != null) onExit() else confirmExit = true
    }

    LaunchedEffect(state.startedAt, state.result) {
        if (state.startedAt.isBlank() || state.result != null) return@LaunchedEffect
        while (true) {
            val elapsed = (
                (System.currentTimeMillis() - java.time.Instant.parse(state.startedAt).toEpochMilli()) / 1000
                ).toInt().coerceAtMost(60 * 60)
            onTick(elapsed)
            if (elapsed >= 60 * 60) {
                onSubmit()
                break
            }
            delay(1000)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(contentPadding),
    ) {
        when {
            state.isLoading -> LoadingReading()
            state.test == null -> ReadingError(state.errorMessage ?: "阅读套题加载失败。", onRetry, onExit)
            state.result != null -> ReadingResult(state, onExit)
            else -> ReadingExam(
                state = state,
                onExit = { confirmExit = true },
                onSelectPane = onSelectPane,
                onSelectPassage = onSelectPassage,
                onAnswer = onAnswer,
                onSubmit = { confirmSubmit = true },
            )
        }
    }

    if (confirmExit) {
        AlertDialog(
            onDismissRequest = { confirmExit = false },
            title = { Text("退出阅读练习？") },
            text = { Text("本次尚未提交的答案会丢失。") },
            confirmButton = {
                TextButton(onClick = onExit) { Text("退出", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmExit = false }) { Text("继续作答") }
            },
        )
    }

    if (confirmSubmit) {
        AlertDialog(
            onDismissRequest = { confirmSubmit = false },
            title = { Text("提交阅读练习？") },
            text = {
                Text(
                    if (state.unansweredCount > 0) {
                        "还有 ${state.unansweredCount} 题未作答。提交后将立即评分。"
                    } else {
                        "40 道题均已作答，提交后将立即评分。"
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmSubmit = false
                        onSubmit()
                    },
                ) { Text("确认提交") }
            },
            dismissButton = {
                TextButton(onClick = { confirmSubmit = false }) { Text("返回检查") }
            },
        )
    }
}

@Composable
private fun ReadingExam(
    state: IeltsReadingUiState,
    onExit: () -> Unit,
    onSelectPane: (ReadingPane) -> Unit,
    onSelectPassage: (Int) -> Unit,
    onAnswer: (Int, List<String>) -> Unit,
    onSubmit: () -> Unit,
) {
    val test = state.test ?: return
    Column(modifier = Modifier.fillMaxSize()) {
        Surface(color = LuminaBrown, contentColor = Color.White, shadowElevation = 4.dp) {
            Column(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onExit) { Text("退出", color = Color.White) }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Cambridge ${test.bookNumber} · Test ${test.testNumber}",
                            fontWeight = FontWeight.Black,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            "已答 ${state.answeredCount}/${state.questions.size}",
                            color = Color.White.copy(alpha = 0.66f),
                            fontSize = 12.sp,
                        )
                    }
                    Text(
                        formatRemaining(60 * 60 - state.elapsedSeconds),
                        color = if (state.elapsedSeconds >= 50 * 60) LuminaGold else Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    ReadingPane.entries.forEach { pane ->
                        FilterChip(
                            selected = state.selectedPane == pane,
                            onClick = { onSelectPane(pane) },
                            label = { Text(if (pane == ReadingPane.Passage) "文章" else "题目") },
                        )
                    }
                    test.passages.forEach { passage ->
                        FilterChip(
                            selected = state.selectedPassageNumber == passage.number,
                            onClick = { onSelectPassage(passage.number) },
                            label = { Text("P${passage.number}") },
                        )
                    }
                }
            }
        }

        state.errorMessage?.let {
            Text(
                it,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.error.copy(alpha = 0.1f))
                    .padding(10.dp),
                color = MaterialTheme.colorScheme.error,
            )
        }

        if (state.selectedPane == ReadingPane.Passage) {
            PassagePane(state)
        } else {
            QuestionsPane(state, onAnswer, onSubmit)
        }
    }
}

@Composable
private fun PassagePane(state: IeltsReadingUiState) {
    val passage = state.test?.passages?.firstOrNull { it.number == state.selectedPassageNumber } ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("READING PASSAGE ${passage.number}", color = LuminaTeal, fontWeight = FontWeight.Black)
        Text(passage.title, color = LuminaBrown, fontSize = 25.sp, fontWeight = FontWeight.Black)
        passage.body
            .split(Regex("\\n\\s*\\n"))
            .map(String::trim)
            .filter(String::isNotBlank)
            .forEach { paragraph ->
                Text(paragraph, color = LuminaBrown, fontSize = 17.sp, lineHeight = 29.sp)
            }
        passage.figures.forEach { figure ->
            ReadingFigureCard(figure)
        }
    }
}

@Composable
private fun ReadingFigureCard(figure: IeltsReadingFigure) {
    Surface(color = Color.White, shape = RoundedCornerShape(20.dp), shadowElevation = 2.dp) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (figure.title.isNotBlank()) {
                Text(figure.title, color = LuminaBrown, fontWeight = FontWeight.Black)
            }
            if (figure.imageUrl.isNotBlank()) {
                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 180.dp, max = 520.dp),
                    factory = { context ->
                        WebView(context).apply {
                            webViewClient = WebViewClient()
                            settings.loadWithOverviewMode = true
                            settings.useWideViewPort = true
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        }
                    },
                    update = { webView ->
                        val html = """
                            <html><body style="margin:0;background:transparent">
                            <img src="${figure.imageUrl}" style="width:100%;height:auto"/>
                            </body></html>
                        """.trimIndent()
                        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
                    },
                )
            }
            if (figure.caption.isNotBlank()) {
                Text(figure.caption, color = LuminaBrown.copy(alpha = 0.62f), fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun QuestionsPane(
    state: IeltsReadingUiState,
    onAnswer: (Int, List<String>) -> Unit,
    onSubmit: () -> Unit,
) {
    val passage = state.test?.passages?.firstOrNull { it.number == state.selectedPassageNumber } ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        passage.groups.forEach { group ->
            QuestionGroupCard(group, state.answers, onAnswer)
        }
        Button(
            onClick = onSubmit,
            enabled = !state.isSubmitting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.isSubmitting) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
            } else {
                Text("提交阅读练习")
            }
        }
    }
}

@Composable
private fun QuestionGroupCard(
    group: IeltsReadingQuestionGroup,
    answers: Map<Int, List<String>>,
    onAnswer: (Int, List<String>) -> Unit,
) {
    Surface(color = Color.White.copy(alpha = 0.94f), shape = RoundedCornerShape(24.dp), shadowElevation = 2.dp) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Text(questionTypeLabel(group.type), color = LuminaTeal, fontWeight = FontWeight.Black)
            if (group.prompt.isNotBlank()) {
                Text(group.prompt, color = LuminaBrown, fontSize = 17.sp, fontWeight = FontWeight.Black)
            }
            if (group.instructions.isNotBlank()) {
                Text(group.instructions, color = LuminaBrown.copy(alpha = 0.65f), lineHeight = 22.sp)
            }
            group.questions.forEach { question ->
                QuestionInput(
                    question = question,
                    group = group,
                    value = answers[question.number].orEmpty(),
                    onAnswer = { onAnswer(question.number, it) },
                )
            }
        }
    }
}

@Composable
private fun QuestionInput(
    question: IeltsReadingQuestion,
    group: IeltsReadingQuestionGroup,
    value: List<String>,
    onAnswer: (List<String>) -> Unit,
) {
    val options = if (question.options.isNotEmpty()) question.options else group.options
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "${question.number}. ${question.prompt}",
            color = LuminaBrown,
            fontWeight = FontWeight.Black,
            lineHeight = 22.sp,
        )
        when {
            question.type == "true_false_not_given" -> ChoiceButtons(
                options = listOf("TRUE", "FALSE", "NOT GIVEN").map { IeltsOption(it, it) },
                selected = value,
                multi = false,
                onAnswer = onAnswer,
            )

            question.type == "yes_no_not_given" -> ChoiceButtons(
                options = listOf("YES", "NO", "NOT GIVEN").map { IeltsOption(it, it) },
                selected = value,
                multi = false,
                onAnswer = onAnswer,
            )

            options.isNotEmpty() -> ChoiceButtons(
                options = options,
                selected = value,
                multi = question.type == "multiple_choice_multi" && group.questions.size == 1,
                onAnswer = onAnswer,
            )

            else -> OutlinedTextField(
                value = value.firstOrNull().orEmpty(),
                onValueChange = { onAnswer(listOf(it)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("输入答案") },
            )
        }
    }
}

@Composable
private fun ChoiceButtons(
    options: List<IeltsOption>,
    selected: List<String>,
    multi: Boolean,
    onAnswer: (List<String>) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        options.forEach { option ->
            val active = selected.any { it.equals(option.key, ignoreCase = true) }
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        if (multi) {
                            onAnswer(
                                if (active) selected.filterNot { it.equals(option.key, ignoreCase = true) }
                                else selected + option.key,
                            )
                        } else {
                            onAnswer(listOf(option.key))
                        }
                    },
                color = if (active) LuminaTeal.copy(alpha = 0.14f) else LuminaCream,
                shape = RoundedCornerShape(14.dp),
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (active) LuminaTeal else LuminaBrown.copy(alpha = 0.1f),
                ),
            ) {
                Text(
                    "${option.key}. ${option.text}",
                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                    color = if (active) LuminaTeal else LuminaBrown,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun ReadingResult(state: IeltsReadingUiState, onExit: () -> Unit) {
    val result = state.result ?: return
    val responseByNumber = result.responses.associateBy { it.questionNumber }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(color = LuminaBrown, contentColor = Color.White, shape = RoundedCornerShape(28.dp)) {
            Column(
                modifier = Modifier.padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text("阅读练习已提交", color = LuminaGold, fontWeight = FontWeight.Black)
                Text(
                    "${result.score} / ${result.totalQuestions}",
                    fontSize = 42.sp,
                    fontWeight = FontWeight.Black,
                )
                Text("用时 ${formatElapsed(state.elapsedSeconds)}", color = Color.White.copy(alpha = 0.7f))
            }
        }
        state.test?.questions?.forEach { question ->
            val response = responseByNumber[question.number] ?: return@forEach
            Surface(
                color = if (response.isCorrect) LuminaTeal.copy(alpha = 0.1f) else Color(0xFFFFE8E5),
                shape = RoundedCornerShape(18.dp),
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(
                        "${question.number}. ${question.prompt}",
                        color = LuminaBrown,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        "你的答案：${response.response.joinToString().ifBlank { "未作答" }}",
                        color = if (response.isCorrect) LuminaTeal else MaterialTheme.colorScheme.error,
                    )
                    if (!response.isCorrect) {
                        Text("正确答案：${response.correctAnswer.joinToString()}", color = LuminaBrown)
                    }
                    if (question.answerNote.isNotBlank()) {
                        Text(question.answerNote, color = LuminaBrown.copy(alpha = 0.62f), fontSize = 12.sp)
                    }
                }
            }
        }
        Button(onClick = onExit, modifier = Modifier.fillMaxWidth()) {
            Text("返回 IELTS 总览")
        }
    }
}

@Composable
private fun LoadingReading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = LuminaTeal)
            Text("正在载入阅读套题", modifier = Modifier.padding(top = 12.dp), color = LuminaBrown)
        }
    }
}

@Composable
private fun ReadingError(message: String, onRetry: () -> Unit, onExit: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onRetry) { Text("重试") }
            OutlinedButton(onClick = onExit) { Text("返回 IELTS") }
        }
    }
}

private fun questionTypeLabel(type: String) = when (type) {
    "true_false_not_given" -> "TRUE / FALSE / NOT GIVEN"
    "yes_no_not_given" -> "YES / NO / NOT GIVEN"
    "multiple_choice_single" -> "单选题"
    "multiple_choice_multi" -> "多选题"
    "matching_headings" -> "匹配标题"
    "matching_information" -> "匹配信息"
    "matching_features" -> "匹配特征"
    "matching_sentence_endings" -> "匹配句尾"
    "summary_completion" -> "摘要填空"
    "note_completion" -> "笔记填空"
    "table_completion" -> "表格填空"
    "flow_chart_completion" -> "流程图填空"
    "sentence_completion" -> "句子填空"
    "short_answer" -> "简答题"
    "diagram_label" -> "图示填空"
    else -> "题目"
}

private fun formatRemaining(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    return "%02d:%02d".format(safe / 60, safe % 60)
}

private fun formatElapsed(seconds: Int): String =
    "${seconds.coerceAtLeast(0) / 60}:${(seconds.coerceAtLeast(0) % 60).toString().padStart(2, '0')}"
