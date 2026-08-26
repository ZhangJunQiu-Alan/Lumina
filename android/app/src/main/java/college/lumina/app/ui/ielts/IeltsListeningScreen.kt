package college.lumina.app.ui.ielts

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import college.lumina.app.data.ielts.IeltsListeningQuestion
import college.lumina.app.data.ielts.IeltsListeningQuestionGroup
import college.lumina.app.data.ielts.IeltsOption
import college.lumina.app.ui.audio.AndroidAudioPlayer
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun IeltsListeningScreen(
    state: IeltsListeningUiState,
    contentPadding: PaddingValues,
    onExit: () -> Unit,
    onRetry: () -> Unit,
    onTick: (Int) -> Unit,
    onSelectSection: (Int) -> Unit,
    onAnswer: (Int, List<String>) -> Unit,
    onSubmit: () -> Unit,
) {
    var confirmExit by remember { mutableStateOf(false) }
    var confirmSubmit by remember { mutableStateOf(false) }
    BackHandler { if (state.result != null) onExit() else confirmExit = true }

    LaunchedEffect(state.startedAt, state.result) {
        if (state.startedAt.isBlank() || state.result != null) return@LaunchedEffect
        while (true) {
            val elapsed = ((System.currentTimeMillis() - java.time.Instant.parse(state.startedAt).toEpochMilli()) / 1000)
                .toInt()
                .coerceAtMost(40 * 60)
            onTick(elapsed)
            if (elapsed >= 40 * 60) {
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
            state.isLoading -> LoadingListening()
            state.test == null -> ListeningError(state.errorMessage ?: "听力套题加载失败。", onRetry, onExit)
            state.result != null -> ListeningResult(state, onExit)
            else -> ListeningExam(
                state = state,
                onExit = { confirmExit = true },
                onSelectSection = onSelectSection,
                onAnswer = onAnswer,
                onSubmit = { confirmSubmit = true },
            )
        }
    }

    if (confirmExit) {
        AlertDialog(
            onDismissRequest = { confirmExit = false },
            title = { Text("退出听力练习？") },
            text = { Text("本次尚未提交的答案会丢失。") },
            confirmButton = { TextButton(onClick = onExit) { Text("退出", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirmExit = false }) { Text("继续作答") } },
        )
    }
    if (confirmSubmit) {
        AlertDialog(
            onDismissRequest = { confirmSubmit = false },
            title = { Text("提交听力练习？") },
            text = { Text(if (state.unansweredCount > 0) "还有 ${state.unansweredCount} 题未作答。" else "40 道题均已作答。") },
            confirmButton = {
                TextButton(onClick = { confirmSubmit = false; onSubmit() }) { Text("确认提交") }
            },
            dismissButton = { TextButton(onClick = { confirmSubmit = false }) { Text("返回检查") } },
        )
    }
}

@Composable
private fun ListeningExam(
    state: IeltsListeningUiState,
    onExit: () -> Unit,
    onSelectSection: (Int) -> Unit,
    onAnswer: (Int, List<String>) -> Unit,
    onSubmit: () -> Unit,
) {
    val test = state.test ?: return
    val section = test.sections.firstOrNull { it.number == state.selectedSectionNumber } ?: return
    val player = remember { AndroidAudioPlayer() }
    val scope = rememberCoroutineScope()
    var audioError by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        Surface(color = LuminaBrown, contentColor = Color.White, shadowElevation = 4.dp) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onExit) { Text("退出", color = Color.White) }
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Listening · Test ${test.testNumber}", fontWeight = FontWeight.Black)
                        Text("已答 ${state.answeredCount}/${state.questions.size}", color = Color.White.copy(alpha = 0.66f), fontSize = 12.sp)
                    }
                    Text(formatRemaining(40 * 60 - state.elapsedSeconds), color = LuminaGold, fontWeight = FontWeight.Black)
                }
                Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    test.sections.forEach { item ->
                        FilterChip(
                            selected = item.number == section.number,
                            onClick = { onSelectSection(item.number) },
                            label = { Text("S${item.number}") },
                        )
                    }
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Surface(color = Color.White, shape = RoundedCornerShape(24.dp), shadowElevation = 2.dp) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Section ${section.number}", color = LuminaBrown, fontSize = 22.sp, fontWeight = FontWeight.Black)
                    if (section.instructions.isNotBlank()) Text(section.instructions, color = LuminaBrown.copy(alpha = 0.65f))
                    Button(
                        onClick = {
                            audioError = null
                            scope.launch {
                                runCatching { player.play(section.audioUrl, 1f, 1, 0) }
                                    .onFailure { audioError = it.message ?: "音频播放失败。" }
                            }
                        },
                        enabled = section.audioUrl.isNotBlank(),
                    ) { Text("播放本 Section 音频") }
                    audioError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }

            section.paperPages.take(2).forEach { page ->
                if (page.imageUrl.isNotBlank()) {
                    AndroidView(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 260.dp, max = 620.dp),
                        factory = { context ->
                            WebView(context).apply {
                                webViewClient = WebViewClient()
                                settings.loadWithOverviewMode = true
                                settings.useWideViewPort = true
                            }
                        },
                        update = {
                            it.loadDataWithBaseURL(
                                null,
                                """<html><body style="margin:0"><img src="${page.imageUrl}" style="width:100%;height:auto"/></body></html>""",
                                "text/html",
                                "UTF-8",
                                null,
                            )
                        },
                    )
                }
            }

            section.groups.forEach { group ->
                ListeningQuestionGroupCard(group, state.answers, onAnswer)
            }
            Button(onClick = onSubmit, enabled = !state.isSubmitting, modifier = Modifier.fillMaxWidth()) {
                if (state.isSubmitting) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("提交听力练习")
            }
        }
    }
}

@Composable
private fun ListeningQuestionGroupCard(
    group: IeltsListeningQuestionGroup,
    answers: Map<Int, List<String>>,
    onAnswer: (Int, List<String>) -> Unit,
) {
    Surface(color = Color.White.copy(alpha = 0.94f), shape = RoundedCornerShape(24.dp), shadowElevation = 2.dp) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            Text(listeningTypeLabel(group.type), color = LuminaTeal, fontWeight = FontWeight.Black)
            if (group.prompt.isNotBlank()) Text(group.prompt, color = LuminaBrown, fontWeight = FontWeight.Black)
            if (group.instructions.isNotBlank()) Text(group.instructions, color = LuminaBrown.copy(alpha = 0.65f))
            group.questions.forEach { question ->
                ListeningQuestionInput(question, group, answers[question.number].orEmpty()) {
                    onAnswer(question.number, it)
                }
            }
        }
    }
}

@Composable
private fun ListeningQuestionInput(
    question: IeltsListeningQuestion,
    group: IeltsListeningQuestionGroup,
    value: List<String>,
    onAnswer: (List<String>) -> Unit,
) {
    val options = if (question.options.isNotEmpty()) question.options else group.options
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("${question.number}. ${question.prompt}", color = LuminaBrown, fontWeight = FontWeight.Black)
        if ((question.type == "multiple_choice_single" || question.type == "matching") && options.isNotEmpty()) {
            ChoiceButtons(options, value, onAnswer)
        } else {
            OutlinedTextField(
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
private fun ChoiceButtons(options: List<IeltsOption>, selected: List<String>, onAnswer: (List<String>) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        options.forEach { option ->
            val active = selected.any { it.equals(option.key, ignoreCase = true) }
            Surface(
                modifier = Modifier.fillMaxWidth().clickable { onAnswer(listOf(option.key)) },
                color = if (active) LuminaGold.copy(alpha = 0.18f) else LuminaCream,
                shape = RoundedCornerShape(14.dp),
                border = BorderStroke(1.dp, if (active) LuminaGold else LuminaBrown.copy(alpha = 0.1f)),
            ) {
                Text(
                    "${option.key}. ${option.text}",
                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                    color = LuminaBrown,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun ListeningResult(state: IeltsListeningUiState, onExit: () -> Unit) {
    val result = state.result ?: return
    val responseByNumber = result.responses.associateBy { it.questionNumber }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Surface(color = LuminaBrown, contentColor = Color.White, shape = RoundedCornerShape(28.dp)) {
            Column(modifier = Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("听力练习已提交", color = LuminaGold, fontWeight = FontWeight.Black)
                Text("${result.score} / ${result.totalQuestions}", fontSize = 42.sp, fontWeight = FontWeight.Black)
            }
        }
        state.test?.questions?.forEach { question ->
            val response = responseByNumber[question.number] ?: return@forEach
            Surface(
                color = if (response.isCorrect) LuminaTeal.copy(alpha = 0.1f) else Color(0xFFFFE8E5),
                shape = RoundedCornerShape(18.dp),
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("${question.number}. ${question.prompt}", color = LuminaBrown, fontWeight = FontWeight.Black)
                    Text("你的答案：${response.response.joinToString().ifBlank { "未作答" }}", color = if (response.isCorrect) LuminaTeal else MaterialTheme.colorScheme.error)
                    if (!response.isCorrect) Text("正确答案：${response.correctAnswer.joinToString()}", color = LuminaBrown)
                }
            }
        }
        Button(onClick = onExit, modifier = Modifier.fillMaxWidth()) { Text("返回 IELTS 总览") }
    }
}

@Composable
private fun LoadingListening() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = LuminaTeal)
    }
}

@Composable
private fun ListeningError(message: String, onRetry: () -> Unit, onExit: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onRetry) { Text("重试") }
            OutlinedButton(onClick = onExit) { Text("返回 IELTS") }
        }
    }
}

private fun listeningTypeLabel(type: String) = when (type) {
    "form_completion" -> "表单填空"
    "note_completion" -> "笔记填空"
    "table_completion" -> "表格填空"
    "sentence_completion" -> "句子填空"
    "multiple_choice_single" -> "单选题"
    "matching" -> "匹配题"
    "diagram_label" -> "图示填空"
    else -> "题目"
}

private fun formatRemaining(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    return "%02d:%02d".format(safe / 60, safe % 60)
}
