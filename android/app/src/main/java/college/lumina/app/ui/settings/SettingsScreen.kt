package college.lumina.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.settings.AutoPlayGapOptions
import college.lumina.app.data.settings.AutoPlayRepeatOptions
import college.lumina.app.data.settings.CorrectAnswerRevealOptions
import college.lumina.app.data.settings.IeltsTargetScoreOptions
import college.lumina.app.data.settings.SpeechPlaybackRateOptions
import college.lumina.app.data.settings.WrongAnswerRevealOptions
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onDefaultPronunciationLocaleChange: (String) -> Unit,
    onIeltsTargetScoreChange: (Double) -> Unit,
    onSpeechPlaybackRateChange: (Double) -> Unit,
    onAutoPlayEnabledChange: (Boolean) -> Unit,
    onAutoPlayRepeatCountChange: (Int) -> Unit,
    onAutoPlayRepeatGapMsChange: (Int) -> Unit,
    onCorrectAnswerRevealMsChange: (Int) -> Unit,
    onWrongAnswerRevealMsChange: (Int) -> Unit,
    onRound3DictationEnabledChange: (Boolean) -> Unit,
    onRound2RecallEnabledChange: (Boolean) -> Unit,
    onReinforcementArticleEnabledChange: (Boolean) -> Unit,
    onPopoverAutoPlayEnabledChange: (Boolean) -> Unit,
    onClozeSentenceAutoPlayEnabledChange: (Boolean) -> Unit,
    onMemoryTipEnabledChange: (Boolean) -> Unit,
    onResetDefaults: () -> Unit,
    onDismissMessages: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(contentPadding),
    ) {
        if (state.isLoading) {
            Column(
                modifier = Modifier.align(Alignment.Center),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(color = LuminaTeal)
                Text("正在同步设置", color = LuminaBrown, fontWeight = FontWeight.Bold)
            }
        } else {
            SettingsContent(
                state = state,
                onRefresh = onRefresh,
                onDefaultPronunciationLocaleChange = onDefaultPronunciationLocaleChange,
                onIeltsTargetScoreChange = onIeltsTargetScoreChange,
                onSpeechPlaybackRateChange = onSpeechPlaybackRateChange,
                onAutoPlayEnabledChange = onAutoPlayEnabledChange,
                onAutoPlayRepeatCountChange = onAutoPlayRepeatCountChange,
                onAutoPlayRepeatGapMsChange = onAutoPlayRepeatGapMsChange,
                onCorrectAnswerRevealMsChange = onCorrectAnswerRevealMsChange,
                onWrongAnswerRevealMsChange = onWrongAnswerRevealMsChange,
                onRound3DictationEnabledChange = onRound3DictationEnabledChange,
                onRound2RecallEnabledChange = onRound2RecallEnabledChange,
                onReinforcementArticleEnabledChange = onReinforcementArticleEnabledChange,
                onPopoverAutoPlayEnabledChange = onPopoverAutoPlayEnabledChange,
                onClozeSentenceAutoPlayEnabledChange = onClozeSentenceAutoPlayEnabledChange,
                onMemoryTipEnabledChange = onMemoryTipEnabledChange,
                onResetDefaults = onResetDefaults,
            )
        }

        (state.errorMessage ?: state.statusMessage)?.let { message ->
            Snackbar(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(16.dp),
                action = {
                    TextButton(onClick = onDismissMessages) {
                        Text("知道了", color = LuminaGold)
                    }
                },
            ) {
                Text(message)
            }
        }
    }
}

@Composable
private fun SettingsContent(
    state: SettingsUiState,
    onRefresh: () -> Unit,
    onDefaultPronunciationLocaleChange: (String) -> Unit,
    onIeltsTargetScoreChange: (Double) -> Unit,
    onSpeechPlaybackRateChange: (Double) -> Unit,
    onAutoPlayEnabledChange: (Boolean) -> Unit,
    onAutoPlayRepeatCountChange: (Int) -> Unit,
    onAutoPlayRepeatGapMsChange: (Int) -> Unit,
    onCorrectAnswerRevealMsChange: (Int) -> Unit,
    onWrongAnswerRevealMsChange: (Int) -> Unit,
    onRound3DictationEnabledChange: (Boolean) -> Unit,
    onRound2RecallEnabledChange: (Boolean) -> Unit,
    onReinforcementArticleEnabledChange: (Boolean) -> Unit,
    onPopoverAutoPlayEnabledChange: (Boolean) -> Unit,
    onClozeSentenceAutoPlayEnabledChange: (Boolean) -> Unit,
    onMemoryTipEnabledChange: (Boolean) -> Unit,
    onResetDefaults: () -> Unit,
) {
    val preferences = state.preferences
    val enabled = !state.isSaving && !state.isRefreshing

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SettingsHeader(
            isSaving = state.isSaving,
            isRefreshing = state.isRefreshing,
            onRefresh = onRefresh,
            onResetDefaults = onResetDefaults,
        )

        ChoiceRow(
            title = "默认口音",
            subtitle = "控制单词和例句优先使用英音或美音。",
            options = listOf("uk", "us"),
            selected = preferences.defaultPronunciationLocale,
            enabled = enabled,
            label = { if (it == "uk") "英音" else "美音" },
            onSelect = onDefaultPronunciationLocaleChange,
        )

        ChoiceRow(
            title = "雅思目标分",
            subtitle = "用于后续雅思练习结果的目标参照。",
            options = IeltsTargetScoreOptions,
            selected = preferences.ieltsTargetScore,
            enabled = enabled,
            label = ::formatDouble,
            onSelect = onIeltsTargetScoreChange,
        )

        SectionTitle("朗读")
        SwitchRow(
            title = "自动朗读",
            subtitle = "进入学习卡片后自动播放发音。",
            checked = preferences.autoPlayEnabled,
            enabled = enabled,
            onCheckedChange = onAutoPlayEnabledChange,
        )
        SwitchRow(
            title = "查词浮窗自动朗读",
            subtitle = "点开单词解释时自动播放发音。",
            checked = preferences.popoverAutoPlayEnabled,
            enabled = enabled,
            onCheckedChange = onPopoverAutoPlayEnabledChange,
        )
        SwitchRow(
            title = "句子默认朗读",
            subtitle = "Round 2 句子题默认播放例句音频。",
            checked = preferences.clozeSentenceAutoPlayEnabled,
            enabled = enabled,
            onCheckedChange = onClozeSentenceAutoPlayEnabledChange,
        )
        ChoiceRow(
            title = "朗读速度",
            subtitle = "降低速度能让听写更稳。",
            options = SpeechPlaybackRateOptions,
            selected = preferences.speechPlaybackRate,
            enabled = enabled,
            label = { "${formatDouble(it)}x" },
            onSelect = onSpeechPlaybackRateChange,
        )
        ChoiceRow(
            title = "朗读次数",
            subtitle = "自动朗读会按这个次数重复。",
            options = AutoPlayRepeatOptions,
            selected = preferences.autoPlayRepeatCount,
            enabled = enabled,
            label = { "${it} 次" },
            onSelect = onAutoPlayRepeatCountChange,
        )
        ChoiceRow(
            title = "重复间隔",
            subtitle = if (preferences.autoPlayRepeatCount == 1) {
                "朗读一次时不需要间隔。"
            } else {
                "两次朗读之间的等待时间。"
            },
            options = AutoPlayGapOptions,
            selected = preferences.autoPlayRepeatGapMs,
            enabled = enabled && preferences.autoPlayRepeatCount > 1,
            label = ::formatMilliseconds,
            onSelect = onAutoPlayRepeatGapMsChange,
        )

        SectionTitle("学习流程")
        SwitchRow(
            title = "Round 3 听写",
            subtitle = "开启后会保留听写巩固环节。关闭时会自动保留 Round 2 回忆。",
            checked = preferences.round2Enabled,
            enabled = enabled,
            onCheckedChange = onRound3DictationEnabledChange,
        )
        SwitchRow(
            title = "Round 2 回忆",
            subtitle = "开启后会保留回忆练习。关闭时会自动保留 Round 3 听写。",
            checked = preferences.reinforcementRound3Enabled,
            enabled = enabled,
            onCheckedChange = onRound2RecallEnabledChange,
        )
        SwitchRow(
            title = "文章巩固",
            subtitle = "学习完成后进入文章阅读巩固。",
            checked = preferences.reinforcementArticleEnabled,
            enabled = enabled,
            onCheckedChange = onReinforcementArticleEnabledChange,
        )
        SwitchRow(
            title = "记忆锦囊",
            subtitle = "在单词卡片中显示记忆提示。",
            checked = preferences.memoryTipEnabled,
            enabled = enabled,
            onCheckedChange = onMemoryTipEnabledChange,
        )

        SectionTitle("反馈时长")
        ChoiceRow(
            title = "答对反馈时间",
            subtitle = "答对后停留多久再继续。",
            options = CorrectAnswerRevealOptions,
            selected = preferences.correctAnswerRevealMs,
            enabled = enabled,
            label = ::formatMilliseconds,
            onSelect = onCorrectAnswerRevealMsChange,
        )
        ChoiceRow(
            title = "答错答案停留",
            subtitle = "答错后答案显示多久。",
            options = WrongAnswerRevealOptions,
            selected = preferences.wrongAnswerRevealMs,
            enabled = enabled,
            label = ::formatMilliseconds,
            onSelect = onWrongAnswerRevealMsChange,
        )
    }
}

@Composable
private fun SettingsHeader(
    isSaving: Boolean,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onResetDefaults: () -> Unit,
) {
    Surface(
        color = Color.White.copy(alpha = 0.96f),
        shape = RoundedCornerShape(26.dp),
        shadowElevation = 3.dp,
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "设置",
                        color = LuminaBrown,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        text = if (isSaving) "正在保存设置" else "学习偏好会同步到你的账号",
                        color = LuminaTeal,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (isSaving || isRefreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = LuminaTeal,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = onRefresh,
                    enabled = !isSaving && !isRefreshing,
                ) {
                    Text("刷新")
                }
                Button(
                    onClick = onResetDefaults,
                    enabled = !isSaving && !isRefreshing,
                ) {
                    Text("恢复默认")
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        color = LuminaBrown,
        fontWeight = FontWeight.Black,
        fontSize = 18.sp,
        modifier = Modifier.padding(top = 4.dp),
    )
}

@Composable
private fun SwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    enabled: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    PreferenceSurface {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = LuminaBrown,
                    fontWeight = FontWeight.Black,
                    fontSize = 17.sp,
                )
                Text(
                    text = subtitle,
                    color = LuminaTeal,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 18.sp,
                )
            }
            Switch(
                checked = checked,
                onCheckedChange = onCheckedChange,
                enabled = enabled,
            )
        }
    }
}

@Composable
private fun <T> ChoiceRow(
    title: String,
    subtitle: String,
    options: List<T>,
    selected: T,
    enabled: Boolean,
    label: (T) -> String,
    onSelect: (T) -> Unit,
) {
    PreferenceSurface {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = title,
                color = LuminaBrown,
                fontWeight = FontWeight.Black,
                fontSize = 17.sp,
            )
            Text(
                text = subtitle,
                color = LuminaTeal,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 18.sp,
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                options.forEach { option ->
                    FilterChip(
                        selected = option == selected,
                        onClick = { onSelect(option) },
                        enabled = enabled,
                        label = { Text(label(option), fontWeight = FontWeight.Bold) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PreferenceSurface(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.94f),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 2.dp,
    ) {
        Box(modifier = Modifier.padding(16.dp)) {
            content()
        }
    }
}

private fun formatMilliseconds(value: Int): String =
    if (value % 1000 == 0) {
        "${value / 1000} 秒"
    } else {
        "${value / 1000.0} 秒"
    }

private fun formatDouble(value: Double): String =
    if (value % 1.0 == 0.0) {
        value.toInt().toString()
    } else {
        value.toString()
    }
