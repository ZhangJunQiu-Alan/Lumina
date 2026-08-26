package college.lumina.app.ui.vocab

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.vocab.WordLookupResult
import college.lumina.app.data.audio.WordAudioRepository
import college.lumina.app.data.settings.LearningPreferences
import college.lumina.app.ui.audio.AndroidAudioPlayer
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WordLookupSheet(
    state: WordLookupUiState,
    preferences: LearningPreferences,
    wordAudioRepository: WordAudioRepository,
    onDismiss: () -> Unit,
    onToggleSaved: () -> Unit,
    onDismissMessage: () -> Unit,
) {
    if (!state.isOpen) return
    val audioPlayer = remember { AndroidAudioPlayer() }
    val coroutineScope = rememberCoroutineScope()
    var playbackJob by remember { mutableStateOf<Job?>(null) }
    var isPlaying by remember { mutableStateOf(false) }

    fun playWord(word: String) {
        playbackJob?.cancel()
        audioPlayer.stop()
        isPlaying = true
        playbackJob = coroutineScope.launch {
            runCatching {
                val url = wordAudioRepository.fetchAudioUrl(word, preferences.defaultPronunciationLocale)
                audioPlayer.play(
                    url = url,
                    speed = preferences.speechPlaybackRate.toFloat(),
                    repeatCount = 1,
                    repeatGapMs = 0,
                )
            }
            isPlaying = false
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            playbackJob?.cancel()
            audioPlayer.close()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = LuminaCream,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 650.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator(color = LuminaTeal)
                    Text("正在查询 ${state.requestedWord.orEmpty()}", fontWeight = FontWeight.Bold)
                }

                state.result != null -> LookupResultContent(
                    result = state.result,
                    pronunciationLocale = preferences.defaultPronunciationLocale,
                    isPlaying = isPlaying,
                    isMutating = state.isMutating,
                    onPlay = ::playWord,
                    onToggleSaved = onToggleSaved,
                )

                state.isMissing -> {
                    Text(
                        text = state.requestedWord.orEmpty(),
                        color = LuminaBrown,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Text("词库暂未收录，已记录到待补充列表。", color = LuminaBrown.copy(alpha = 0.7f))
                }
            }

            (state.errorMessage ?: state.statusMessage)?.let { message ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = if (state.errorMessage != null) {
                        Color(0xFFC44D45).copy(alpha = 0.1f)
                    } else {
                        LuminaTeal.copy(alpha = 0.1f)
                    },
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = message,
                            modifier = Modifier.weight(1f),
                            color = LuminaBrown,
                            fontWeight = FontWeight.Bold,
                        )
                        TextButton(onClick = onDismissMessage) { Text("关闭") }
                    }
                }
            }
        }
    }
}

@Composable
private fun LookupResultContent(
    result: WordLookupResult,
    pronunciationLocale: String,
    isPlaying: Boolean,
    isMutating: Boolean,
    onPlay: (String) -> Unit,
    onToggleSaved: () -> Unit,
) {
    val item = result.vocabularyItem
    val phonetic = if (pronunciationLocale == "us") {
        item.ipaUs.orEmpty().ifBlank { item.ipaUk.orEmpty() }
    } else {
        item.ipaUk.orEmpty().ifBlank { item.ipaUs.orEmpty() }
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.word,
                color = LuminaBrown,
                fontSize = 32.sp,
                fontWeight = FontWeight.Black,
            )
            if (phonetic.isNotBlank()) {
                Text(phonetic, color = LuminaTeal, fontWeight = FontWeight.Bold)
            }
        }
        result.srsState?.let {
            Surface(
                color = LuminaGold.copy(alpha = 0.18f),
                shape = RoundedCornerShape(20.dp),
            ) {
                Text(
                    text = memoryStateLabel(it),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                    color = LuminaBrown,
                    fontWeight = FontWeight.Black,
                )
            }
        }
    }

    OutlinedButton(
        onClick = { onPlay(item.word) },
        enabled = !isPlaying,
    ) {
        if (isPlaying) {
            CircularProgressIndicator(
                modifier = Modifier.padding(end = 8.dp),
                color = LuminaTeal,
                strokeWidth = 2.dp,
            )
            Text("正在朗读")
        } else {
            Text("播放发音")
        }
    }

    if (result.senses.isNotEmpty()) {
        result.senses.forEach { sense ->
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color.White.copy(alpha = 0.92f),
                shape = RoundedCornerShape(18.dp),
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(
                        text = sense.pos.ifBlank { "释义" },
                        color = LuminaTeal,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        text = sense.meaningZh,
                        modifier = Modifier.weight(1f),
                        color = LuminaBrown,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    } else {
        Text(
            text = item.primaryMeaningZh.orEmpty().ifBlank { "暂无释义" },
            color = LuminaBrown,
            fontWeight = FontWeight.Bold,
        )
    }

    if (result.srsState == null) {
        Button(
            onClick = onToggleSaved,
            modifier = Modifier.fillMaxWidth(),
            enabled = !isMutating,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (result.inUserLibrary) Color(0xFFC44D45) else LuminaTeal,
            ),
        ) {
            if (isMutating) {
                CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp)
            } else {
                Text(if (result.inUserLibrary) "从个人词库移除" else "加入个人词库")
            }
        }
    } else {
        Text(
            text = "这个词已有学习记录，不能作为新的生词收藏。",
            color = LuminaBrown.copy(alpha = 0.65f),
            fontWeight = FontWeight.Bold,
        )
    }
}

private fun memoryStateLabel(state: String): String = when (state) {
    "new" -> "未学习"
    "fuzzy" -> "模糊"
    "slow_recall" -> "记忆中"
    "stable_recall" -> "已记忆"
    "mastered" -> "已掌握"
    else -> state
}
