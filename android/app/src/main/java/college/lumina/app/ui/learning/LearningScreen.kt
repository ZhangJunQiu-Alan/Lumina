package college.lumina.app.ui.learning

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.audio.WordAudioRepository
import college.lumina.app.data.learning.LearningWord
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.ui.audio.AndroidAudioPlayer
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private val CorrectGreen = Color(0xFF168B63)
private val WrongRed = Color(0xFFC44D45)

@Composable
fun LearningScreen(
    state: LearningUiState,
    round2Options: List<Round2Option>,
    wordAudioRepository: WordAudioRepository,
    onExit: () -> Unit,
    onRetry: () -> Unit,
    onRound1Action: (Boolean) -> Unit,
    onRound2Select: (Round2Option) -> Unit,
    onSpellingInput: (String) -> Unit,
    onSubmitRound3: () -> Unit,
    onContinue: () -> Unit,
    onDismissError: () -> Unit,
    onLookupWord: (String) -> Unit,
) {
    val audioPlayer = remember { AndroidAudioPlayer() }
    val coroutineScope = rememberCoroutineScope()
    var playbackJob by remember { mutableStateOf<Job?>(null) }
    var playingWordId by remember { mutableStateOf<String?>(null) }
    var audioErrorMessage by remember { mutableStateOf<String?>(null) }
    val preferences = state.preferences

    fun playWord(word: LearningWord) {
        playbackJob?.cancel()
        audioPlayer.stop()
        audioErrorMessage = null
        playingWordId = word.id
        playbackJob = coroutineScope.launch {
            runCatching {
                val url = wordAudioRepository.fetchAudioUrl(
                    word = word.word,
                    locale = preferences.defaultPronunciationLocale,
                )
                audioPlayer.play(
                    url = url,
                    speed = preferences.speechPlaybackRate.toFloat(),
                    repeatCount = preferences.autoPlayRepeatCount,
                    repeatGapMs = preferences.autoPlayRepeatGapMs.toLong(),
                )
            }.onFailure { error ->
                audioErrorMessage = error.message ?: "音频暂时无法播放。"
            }
            playingWordId = null
        }
    }

    val autoPlayWord = state.answerFeedback?.word ?: state.currentWord
    val canAutoPlayCurrentRound = state.answerFeedback != null || state.session?.round != "round3"
    LaunchedEffect(
        autoPlayWord?.id,
        state.answerFeedback?.round,
        state.session?.round,
        preferences.autoPlayEnabled,
        preferences.defaultPronunciationLocale,
        preferences.speechPlaybackRate,
        preferences.autoPlayRepeatCount,
        preferences.autoPlayRepeatGapMs,
    ) {
        if (preferences.autoPlayEnabled && canAutoPlayCurrentRound && autoPlayWord != null) {
            playWord(autoPlayWord)
        } else if (!preferences.autoPlayEnabled) {
            playbackJob?.cancel()
            audioPlayer.stop()
            playingWordId = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            playbackJob?.cancel()
            audioPlayer.close()
        }
    }

    val guardedExit = {
        if (!state.isSubmitting) {
            playbackJob?.cancel()
            audioPlayer.stop()
            onExit()
        }
    }
    BackHandler(enabled = !state.isSubmitting, onBack = guardedExit)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream),
    ) {
        when {
            state.isLoading -> LearningLoading()
            state.data == null -> LearningFailure(
                message = state.errorMessage ?: "这组学习暂时无法打开。",
                onRetry = onRetry,
                onExit = guardedExit,
            )

            state.answerFeedback != null -> FeedbackContent(
                state = state,
                isPlaying = playingWordId == state.answerFeedback.word.id,
                audioErrorMessage = audioErrorMessage,
                onPlayWord = ::playWord,
                onLookupWord = onLookupWord,
                onContinue = onContinue,
                onExit = guardedExit,
            )

            state.data.completed -> LearningCompleted(
                title = state.data.group.title,
                onDone = guardedExit,
            )

            state.currentWord == null || state.session == null -> LearningFailure(
                message = "当前学习队列为空，请返回后刷新词库。",
                onRetry = onRetry,
                onExit = guardedExit,
            )

            else -> LearningRoundContent(
                state = state,
                round2Options = round2Options,
                isPlaying = playingWordId == state.currentWord?.id,
                audioErrorMessage = audioErrorMessage,
                onPlayWord = ::playWord,
                onLookupWord = onLookupWord,
                onExit = guardedExit,
                onRound1Action = onRound1Action,
                onRound2Select = onRound2Select,
                onSpellingInput = onSpellingInput,
                onSubmitRound3 = onSubmitRound3,
                onDismissError = onDismissError,
            )
        }
    }
}

@Composable
private fun LearningRoundContent(
    state: LearningUiState,
    round2Options: List<Round2Option>,
    isPlaying: Boolean,
    audioErrorMessage: String?,
    onPlayWord: (LearningWord) -> Unit,
    onLookupWord: (String) -> Unit,
    onExit: () -> Unit,
    onRound1Action: (Boolean) -> Unit,
    onRound2Select: (Round2Option) -> Unit,
    onSpellingInput: (String) -> Unit,
    onSubmitRound3: () -> Unit,
    onDismissError: () -> Unit,
) {
    val session = state.session ?: return
    val word = state.currentWord ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        LearningHeader(
            title = state.data?.group?.title.orEmpty(),
            round = session.round,
            current = state.progressCurrent,
            total = state.progressTotal,
            onExit = onExit,
        )

        state.errorMessage?.let {
            ErrorBanner(message = it, onDismiss = onDismissError)
        }
        audioErrorMessage?.let {
            ErrorBanner(message = it, onDismiss = null)
        }

        when (session.round) {
            "round1" -> Round1Card(
                word = word,
                preferences = state.preferences,
                isPlaying = isPlaying,
                onPlayWord = onPlayWord,
                onLookupWord = onLookupWord,
                isSubmitting = state.isSubmitting,
                onAction = onRound1Action,
            )

            "round2" -> Round2Card(
                word = word,
                options = round2Options,
                preferences = state.preferences,
                isPlaying = isPlaying,
                onPlayWord = onPlayWord,
                onLookupWord = onLookupWord,
                isSubmitting = state.isSubmitting,
                onSelect = onRound2Select,
            )

            "round3" -> Round3Card(
                word = word,
                value = state.spellingInput,
                isSubmitting = state.isSubmitting,
                onValueChange = onSpellingInput,
                onSubmit = onSubmitRound3,
            )
        }
    }
}

@Composable
private fun LearningHeader(
    title: String,
    round: String,
    current: Int,
    total: Int,
    onExit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = roundTitle(round),
                    color = LuminaTeal,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    text = title,
                    color = LuminaBrown,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                )
            }
            TextButton(onClick = onExit) {
                Text("退出")
            }
        }
        LinearProgressIndicator(
            progress = {
                if (total <= 0) 0f else (current.toFloat() / total).coerceIn(0f, 1f)
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp),
            color = LuminaTeal,
            trackColor = Color.White,
        )
        Text(
            text = "$current / $total",
            color = LuminaBrown.copy(alpha = 0.58f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun Round1Card(
    word: LearningWord,
    preferences: LearningPreferences,
    isPlaying: Boolean,
    onPlayWord: (LearningWord) -> Unit,
    onLookupWord: (String) -> Unit,
    isSubmitting: Boolean,
    onAction: (Boolean) -> Unit,
) {
    LearningCard {
        Text(
            text = word.word,
            color = LuminaBrown,
            fontSize = 38.sp,
            fontWeight = FontWeight.Black,
        )
        val phonetic = word.preferredPhonetic(preferences.defaultPronunciationLocale)
        if (phonetic.isNotBlank()) {
            Text(phonetic, color = LuminaTeal, fontWeight = FontWeight.Bold)
        }
        AudioButton(word, isPlaying, onPlayWord)
        TextButton(onClick = { onLookupWord(word.word) }) {
            Text("查看词条详情")
        }
        Text(
            text = word.meaning.ifBlank { "暂无释义" },
            color = LuminaBrown,
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
        )
        word.senses.firstOrNull()?.let { sense ->
            if (sense.exampleSentence.isNotBlank()) {
                DetailBlock("例句", sense.exampleSentence)
            }
            if (sense.exampleTranslation.isNotBlank()) {
                Text(sense.exampleTranslation, color = LuminaBrown.copy(alpha = 0.65f))
            }
        }
        if (word.morphologySummary.isNotBlank()) {
            DetailBlock("词根词缀", word.morphologySummary)
        }
        if (preferences.memoryTipEnabled && word.memoryTip.isNotBlank()) {
            DetailBlock("记忆提示", word.memoryTip)
        }
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedButton(
                onClick = { onAction(false) },
                modifier = Modifier.weight(1f),
                enabled = !isSubmitting,
            ) {
                Text("暂不学习")
            }
            Button(
                onClick = { onAction(true) },
                modifier = Modifier.weight(1f),
                enabled = !isSubmitting,
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                if (isSubmitting) SmallProgress() else Text("确认学习")
            }
        }
    }
}

@Composable
private fun Round2Card(
    word: LearningWord,
    options: List<Round2Option>,
    preferences: LearningPreferences,
    isPlaying: Boolean,
    onPlayWord: (LearningWord) -> Unit,
    onLookupWord: (String) -> Unit,
    isSubmitting: Boolean,
    onSelect: (Round2Option) -> Unit,
) {
    LearningCard {
        Text(
            text = "选择与单词匹配的释义",
            color = LuminaBrown.copy(alpha = 0.62f),
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = word.word,
            color = LuminaBrown,
            fontSize = 36.sp,
            fontWeight = FontWeight.Black,
        )
        val phonetic = word.preferredPhonetic(preferences.defaultPronunciationLocale)
        if (phonetic.isNotBlank()) {
            Text(phonetic, color = LuminaTeal)
        }
        AudioButton(word, isPlaying, onPlayWord)
        TextButton(onClick = { onLookupWord(word.word) }) {
            Text("查看词条详情")
        }
        options.forEach { option ->
            OutlinedButton(
                onClick = { onSelect(option) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !isSubmitting,
                shape = RoundedCornerShape(18.dp),
            ) {
                Text(
                    text = option.meaningLabel(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    textAlign = TextAlign.Start,
                    color = LuminaBrown,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        if (isSubmitting) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                SmallProgress()
            }
        }
    }
}

@Composable
private fun Round3Card(
    word: LearningWord,
    value: String,
    isSubmitting: Boolean,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    LearningCard {
        Text(
            text = "根据释义拼写英文单词",
            color = LuminaBrown.copy(alpha = 0.62f),
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = word.meaning.ifBlank { "暂无释义" },
            color = LuminaBrown,
            fontSize = 26.sp,
            fontWeight = FontWeight.Black,
        )
        word.senses.firstOrNull()?.exampleSentence
            ?.takeIf(String::isNotBlank)
            ?.let { sentence ->
                DetailBlock(
                    "例句",
                    sentence.replace(word.word, "____", ignoreCase = true),
                )
            }
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = !isSubmitting,
            singleLine = true,
            label = { Text("英文单词") },
        )
        Button(
            onClick = onSubmit,
            modifier = Modifier.fillMaxWidth(),
            enabled = !isSubmitting && value.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
        ) {
            if (isSubmitting) SmallProgress() else Text("提交答案")
        }
    }
}

@Composable
private fun FeedbackContent(
    state: LearningUiState,
    isPlaying: Boolean,
    audioErrorMessage: String?,
    onPlayWord: (LearningWord) -> Unit,
    onLookupWord: (String) -> Unit,
    onContinue: () -> Unit,
    onExit: () -> Unit,
) {
    val feedback = state.answerFeedback ?: return
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
                text = if (feedback.wasCorrect) "回答正确" else "再记一次",
                modifier = Modifier.weight(1f),
                color = if (feedback.wasCorrect) CorrectGreen else WrongRed,
                fontSize = 28.sp,
                fontWeight = FontWeight.Black,
            )
            TextButton(onClick = onExit) { Text("退出") }
        }
        LearningCard {
            Text(
                text = feedback.word.word,
                color = LuminaBrown,
                fontSize = 36.sp,
                fontWeight = FontWeight.Black,
            )
            val phonetic = feedback.word.preferredPhonetic(state.preferences.defaultPronunciationLocale)
            if (phonetic.isNotBlank()) {
                Text(phonetic, color = LuminaTeal, fontWeight = FontWeight.Bold)
            }
            AudioButton(feedback.word, isPlaying, onPlayWord)
            TextButton(onClick = { onLookupWord(feedback.word.word) }) {
                Text("查看词条详情")
            }
            Text(
                text = feedback.word.meaning,
                color = LuminaBrown,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
            if (feedback.round == "round2") {
                feedback.options.forEach { option ->
                    val selectedWrong = option.word == feedback.selectedWord && !option.isCorrect
                    val color = when {
                        option.isCorrect -> CorrectGreen
                        selectedWrong -> WrongRed
                        else -> LuminaBrown.copy(alpha = 0.5f)
                    }
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = color.copy(alpha = 0.1f),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Text(
                            text = "${option.meaningLabel()}：${option.word}",
                            modifier = Modifier.padding(14.dp),
                            color = color,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            } else {
                feedback.typedAnswer?.let {
                    DetailBlock("你的答案", it)
                }
                DetailBlock("正确答案", feedback.word.word)
            }
        }
        audioErrorMessage?.let { ErrorBanner(it, null) }
        state.errorMessage?.let { ErrorBanner(it, null) }
        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
        ) {
            Text(if (state.data?.completed == true) "查看完成结果" else "继续")
        }
    }
}

@Composable
private fun LearningCompleted(
    title: String,
    onDone: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding()
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "本组学习完成",
            color = LuminaTeal,
            fontSize = 31.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = title,
            color = LuminaBrown,
            textAlign = TextAlign.Center,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onDone,
            colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
        ) {
            Text("返回首页")
        }
    }
}

@Composable
private fun LearningFailure(
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
        Text(
            text = "学习内容加载失败",
            color = LuminaBrown,
            fontSize = 25.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(10.dp))
        Text(message, color = LuminaBrown.copy(alpha = 0.68f), textAlign = TextAlign.Center)
        Spacer(Modifier.height(20.dp))
        Button(onClick = onRetry) { Text("重新加载") }
        TextButton(onClick = onExit) { Text("返回首页") }
    }
}

@Composable
private fun LearningLoading() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = LuminaTeal)
        Spacer(Modifier.height(12.dp))
        Text("正在同步学习进度…", color = LuminaBrown, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun LearningCard(content: @Composable ColumnScope.() -> Unit) {
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
private fun DetailBlock(
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
private fun AudioButton(
    word: LearningWord,
    isPlaying: Boolean,
    onPlayWord: (LearningWord) -> Unit,
) {
    OutlinedButton(
        onClick = { onPlayWord(word) },
        enabled = !isPlaying,
    ) {
        if (isPlaying) {
            CircularProgressIndicator(
                modifier = Modifier.height(16.dp),
                strokeWidth = 2.dp,
                color = LuminaTeal,
            )
            Text("  正在朗读")
        } else {
            Text("播放发音")
        }
    }
}

@Composable
private fun ErrorBanner(
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
private fun SmallProgress() {
    CircularProgressIndicator(
        modifier = Modifier.height(18.dp),
        strokeWidth = 2.dp,
        color = Color.White,
    )
}

private fun Round2Option.meaningLabel(): String =
    listOf(pos.takeIf(String::isNotBlank), meaning.takeIf(String::isNotBlank))
        .filterNotNull()
        .joinToString(" ")
        .ifBlank { "暂无释义" }

private fun LearningWord.preferredPhonetic(locale: String): String =
    when (locale) {
        "us" -> ipaUs.ifBlank { phonetic.ifBlank { ipaUk } }
        else -> ipaUk.ifBlank { phonetic.ifBlank { ipaUs } }
    }

private fun roundTitle(round: String) = when (round) {
    "round1" -> "第一轮 · 认识与筛选"
    "round2" -> "第二轮 · 释义辨认"
    "round3" -> "第三轮 · 拼写回忆"
    else -> "学习"
}
