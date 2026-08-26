package college.lumina.app.ui.review

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.review.ReviewTransition
import college.lumina.app.data.review.ReviewWord
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

private val ReviewGreen = Color(0xFF168B63)
private val ReviewRed = Color(0xFFC44D45)

@Composable
fun ReviewScreen(
    state: ReviewUiState,
    onExit: () -> Unit,
    onRetry: () -> Unit,
    onInputChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onReveal: () -> Unit,
    onReturnToAnswer: () -> Unit,
    onUnknown: () -> Unit,
    onMastered: () -> Unit,
    onContinue: () -> Unit,
    onDismissError: () -> Unit,
    onLookupWord: (String) -> Unit,
) {
    val guardedExit = {
        if (!state.isSubmitting) onExit()
    }
    val currentWord = state.currentWord
    BackHandler(enabled = !state.isSubmitting, onBack = guardedExit)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream),
    ) {
        when {
            state.isLoading -> ReviewLoading()
            state.isCompleted -> ReviewResults(
                state = state,
                onDone = guardedExit,
            )

            state.words.isEmpty() -> ReviewFailure(
                message = state.errorMessage ?: "今日复习队列暂时无法打开。",
                onRetry = onRetry,
                onExit = guardedExit,
            )

            state.feedback != null -> ReviewFeedbackContent(
                state = state,
                onExit = guardedExit,
                onReturnToAnswer = onReturnToAnswer,
                onUnknown = onUnknown,
                onContinue = onContinue,
                onLookupWord = onLookupWord,
            )

            currentWord != null -> ReviewPrompt(
                state = state,
                word = currentWord,
                onExit = guardedExit,
                onInputChange = onInputChange,
                onSubmit = onSubmit,
                onReveal = onReveal,
                onMastered = onMastered,
                onDismissError = onDismissError,
            )

            else -> ReviewFailure(
                message = "当前复习队列为空。",
                onRetry = onRetry,
                onExit = guardedExit,
            )
        }
    }
}

@Composable
private fun ReviewPrompt(
    state: ReviewUiState,
    word: ReviewWord,
    onExit: () -> Unit,
    onInputChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onReveal: () -> Unit,
    onMastered: () -> Unit,
    onDismissError: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ReviewHeader(state, onExit)
        state.errorMessage?.let { ReviewErrorBanner(it, onDismissError) }

        ReviewCard {
            Text(
                text = "根据释义写出到期词",
                color = LuminaTeal,
                fontSize = 13.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = word.chineseDefinition.ifBlank { "暂无释义" },
                color = LuminaBrown,
                fontSize = 28.sp,
                fontWeight = FontWeight.Black,
            )
            word.senses.firstOrNull()?.let { sense ->
                if (sense.pos.isNotBlank()) {
                    Text(
                        text = sense.pos,
                        color = LuminaBrown.copy(alpha = 0.55f),
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (sense.exampleSentence.isNotBlank()) {
                    ReviewDetail(
                        label = "例句",
                        value = sense.exampleSentence.replace(word.word, "____", ignoreCase = true),
                    )
                }
            }
            OutlinedTextField(
                value = state.input,
                onValueChange = onInputChange,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isSubmitting,
                singleLine = true,
                label = { Text("英文单词") },
            )
            Button(
                onClick = onSubmit,
                modifier = Modifier.fillMaxWidth(),
                enabled = state.input.isNotBlank() && !state.isSubmitting,
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                if (state.isSubmitting) ReviewProgress() else Text("提交答案")
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onReveal,
                    modifier = Modifier.weight(1f),
                    enabled = !state.isSubmitting,
                ) {
                    Text("查看答案")
                }
                TextButton(
                    onClick = onMastered,
                    modifier = Modifier.weight(1f),
                    enabled = !state.isSubmitting,
                ) {
                    Text("直接掌握", color = ReviewRed)
                }
            }
        }
    }
}

@Composable
private fun ReviewFeedbackContent(
    state: ReviewUiState,
    onExit: () -> Unit,
    onReturnToAnswer: () -> Unit,
    onUnknown: () -> Unit,
    onContinue: () -> Unit,
    onLookupWord: (String) -> Unit,
) {
    val feedback = state.feedback ?: return
    val result = feedback.result
    val isRevealOnly = result == null
    val tone = when {
        isRevealOnly -> LuminaGold
        feedback.action == "unknown" -> ReviewRed
        feedback.action == "mastered" || feedback.wasCorrect == true -> ReviewGreen
        else -> ReviewRed
    }
    val title = when {
        isRevealOnly -> "答案已展开"
        feedback.action == "unknown" -> "已标记为不认识"
        feedback.action == "mastered" -> "已直接掌握"
        feedback.wasCorrect == true -> "回答正确"
        else -> "稍后会再出现"
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                color = tone,
                fontSize = 27.sp,
                fontWeight = FontWeight.Black,
            )
            TextButton(onClick = onExit, enabled = !state.isSubmitting) { Text("退出") }
        }

        ReviewCard {
            Text(
                text = feedback.word.word,
                color = LuminaBrown,
                fontSize = 38.sp,
                fontWeight = FontWeight.Black,
            )
            if (feedback.word.phonetic.isNotBlank()) {
                Text(feedback.word.phonetic, color = LuminaTeal, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = { onLookupWord(feedback.word.word) }) {
                Text("查看词条详情")
            }
            Text(
                text = feedback.word.chineseDefinition,
                color = LuminaBrown,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            feedback.typedAnswer?.let {
                ReviewDetail("你的答案", it)
            }
            feedback.word.senses.firstOrNull()?.let { sense ->
                if (sense.exampleSentence.isNotBlank()) ReviewDetail("例句", sense.exampleSentence)
                if (sense.exampleTranslationZh.isNotBlank()) {
                    Text(sense.exampleTranslationZh, color = LuminaBrown.copy(alpha = 0.65f))
                }
            }
            if (feedback.word.morphology.summaryZh.isNotBlank()) {
                ReviewDetail("词根词缀", feedback.word.morphology.summaryZh)
            }
            result?.transition?.let { transition ->
                ReviewTransitionLine(transition)
            }
        }

        state.errorMessage?.let { ReviewErrorBanner(it, null) }

        if (isRevealOnly) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onReturnToAnswer,
                    modifier = Modifier.weight(1f),
                    enabled = !state.isSubmitting,
                ) {
                    Text("返回作答")
                }
                Button(
                    onClick = onUnknown,
                    modifier = Modifier.weight(1f),
                    enabled = !state.isSubmitting,
                    colors = ButtonDefaults.buttonColors(containerColor = ReviewRed),
                ) {
                    if (state.isSubmitting) ReviewProgress() else Text("不认识")
                }
            }
        } else {
            Button(
                onClick = onContinue,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isSubmitting,
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                if (state.isSubmitting) ReviewProgress() else Text("继续下一个词")
            }
        }
    }
}

@Composable
private fun ReviewResults(
    state: ReviewUiState,
    onDone: () -> Unit,
) {
    val upgraded = state.summary.count { rank(it.transition.to) > rank(it.transition.from) }
    val mastered = state.summary.count { it.transition.to == "mastered" }
    val needsReview = state.summary.count {
        it.transition.result == "wrong" || rank(it.transition.to) < rank(it.transition.from)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ReviewCard {
            Text(
                text = if (state.summary.isEmpty()) "今天没有到期词" else "这一轮复习完成",
                color = LuminaTeal,
                fontSize = 30.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = if (state.summary.isEmpty()) {
                    "首页会同步显示今天的下一步。"
                } else {
                    "共 ${state.summary.size} 个词 · 升级 $upgraded · 掌握 $mastered · 需要巩固 $needsReview"
                },
                color = LuminaBrown.copy(alpha = 0.7f),
                fontWeight = FontWeight.Bold,
            )
        }

        state.summary.sortedBy { it.word.word }.forEach { item ->
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color.White.copy(alpha = 0.92f),
                shape = RoundedCornerShape(20.dp),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(item.word.word, color = LuminaBrown, fontSize = 19.sp, fontWeight = FontWeight.Black)
                        Text(
                            item.word.chineseDefinition,
                            color = LuminaBrown.copy(alpha = 0.62f),
                            fontSize = 12.sp,
                        )
                    }
                    Text(
                        text = "${stateLabel(item.transition.from)} → ${stateLabel(item.transition.to)}",
                        color = if (item.transition.to == "mastered") ReviewGreen else LuminaTeal,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }
        }

        Button(
            onClick = onDone,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
        ) {
            Text("回首页看下一步")
        }
    }
}

@Composable
private fun ReviewHeader(
    state: ReviewUiState,
    onExit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Round 0 · 到期复习", color = LuminaTeal, fontSize = 13.sp, fontWeight = FontWeight.Black)
                Text("今日复习", color = LuminaBrown, fontSize = 23.sp, fontWeight = FontWeight.Black)
            }
            TextButton(onClick = onExit) { Text("退出") }
        }
        LinearProgressIndicator(
            progress = {
                if (state.progressTotal == 0) 0f
                else (state.completedWordIds.size.toFloat() / state.progressTotal).coerceIn(0f, 1f)
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp),
            color = LuminaTeal,
            trackColor = Color.White,
        )
        Text(
            text = "${state.progressCurrent} / ${state.progressTotal}",
            color = LuminaBrown.copy(alpha = 0.58f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun ReviewTransitionLine(transition: ReviewTransition) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = LuminaTeal.copy(alpha = 0.1f),
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = "${stateLabel(transition.from)} → ${stateLabel(transition.to)}",
            modifier = Modifier.padding(14.dp),
            color = LuminaTeal,
            fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ReviewCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.94f),
        shape = RoundedCornerShape(28.dp),
        shadowElevation = 4.dp,
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            content = content,
        )
    }
}

@Composable
private fun ReviewDetail(
    label: String,
    value: String,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = LuminaGold.copy(alpha = 0.13f),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(label, color = LuminaTeal, fontSize = 11.sp, fontWeight = FontWeight.Black)
            Text(value, color = LuminaBrown, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ReviewErrorBanner(
    message: String,
    onDismiss: (() -> Unit)?,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.09f),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = message,
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.error,
                fontWeight = FontWeight.Bold,
            )
            if (onDismiss != null) {
                TextButton(onClick = onDismiss) { Text("关闭") }
            }
        }
    }
}

@Composable
private fun ReviewLoading() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = LuminaTeal)
        Spacer(Modifier.height(12.dp))
        Text("正在整理今日到期词…", color = LuminaBrown, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ReviewFailure(
    message: String,
    onRetry: () -> Unit,
    onExit: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("复习内容加载失败", color = LuminaBrown, fontSize = 25.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(10.dp))
        Text(message, color = LuminaBrown.copy(alpha = 0.68f), textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        Button(onClick = onRetry) { Text("重新加载") }
        TextButton(onClick = onExit) { Text("返回首页") }
    }
}

@Composable
private fun ReviewProgress() {
    CircularProgressIndicator(
        modifier = Modifier.size(18.dp),
        strokeWidth = 2.dp,
        color = Color.White,
    )
}

private fun stateLabel(state: String?): String = when (state) {
    "new" -> "新词"
    "fuzzy" -> "模糊"
    "slow_recall" -> "慢回忆"
    "stable_recall" -> "稳回忆"
    "mastered" -> "掌握"
    null -> "刚加入"
    else -> state
}

private fun rank(state: String?): Int = when (state) {
    "new" -> 0
    "fuzzy" -> 1
    "slow_recall" -> 2
    "stable_recall" -> 3
    "mastered" -> 4
    else -> -1
}
