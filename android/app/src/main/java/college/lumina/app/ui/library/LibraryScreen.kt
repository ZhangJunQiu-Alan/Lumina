package college.lumina.app.ui.library

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.library.LibraryGroupDetail
import college.lumina.app.data.library.LibraryGroupSummary
import college.lumina.app.data.library.LibraryGroupWord
import college.lumina.app.data.library.OfficialLibraryOverview
import college.lumina.app.data.library.SavedWordEntry
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

@Composable
fun LibraryScreen(
    state: LibraryUiState,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onSelectTab: (LibraryTab) -> Unit,
    onOpenOfficialLibrary: (String) -> Unit,
    onClearLibraryFilter: () -> Unit,
    onOpenGroup: (String) -> Unit,
    onCloseGroup: () -> Unit,
    onSelectWord: (String) -> Unit,
    onDismissWord: () -> Unit,
    onStartGroup: (String) -> Unit,
    onStartOfficial: (String, String) -> Unit,
    onLookupWord: (String) -> Unit,
    onRemoveSavedWord: (String) -> Unit,
    onStartSavedWordsGroup: () -> Unit,
) {
    BackHandler(enabled = state.selectedGroupId != null, onBack = onCloseGroup)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(contentPadding),
    ) {
        when {
            state.isLoading -> LibraryLoadingState()
            state.overview == null -> LibraryErrorState(
                message = state.errorMessage ?: "词库暂时无法加载。",
                onRetry = onRefresh,
            )

            state.selectedGroupId != null -> GroupDetailContent(
                state = state,
                onBack = onCloseGroup,
                onRetry = { onOpenGroup(state.selectedGroupId) },
                onSelectWord = onSelectWord,
                onStartGroup = onStartGroup,
            )

            else -> LibraryOverviewContent(
                state = state,
                onRefresh = onRefresh,
                onSelectTab = onSelectTab,
                onOpenOfficialLibrary = onOpenOfficialLibrary,
                onClearLibraryFilter = onClearLibraryFilter,
                onOpenGroup = onOpenGroup,
                onStartOfficial = onStartOfficial,
                onLookupWord = onLookupWord,
                onRemoveSavedWord = onRemoveSavedWord,
                onStartSavedWordsGroup = onStartSavedWordsGroup,
            )
        }
    }

    state.selectedWord?.let { word ->
        WordDetailDialog(word = word, onDismiss = onDismissWord)
    }
}

@Composable
private fun LibraryOverviewContent(
    state: LibraryUiState,
    onRefresh: () -> Unit,
    onSelectTab: (LibraryTab) -> Unit,
    onOpenOfficialLibrary: (String) -> Unit,
    onClearLibraryFilter: () -> Unit,
    onOpenGroup: (String) -> Unit,
    onStartOfficial: (String, String) -> Unit,
    onLookupWord: (String) -> Unit,
    onRemoveSavedWord: (String) -> Unit,
    onStartSavedWordsGroup: () -> Unit,
) {
    val overview = state.overview ?: return

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "我的词库",
                    color = LuminaBrown,
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    text = "查看官方进度、学习组和自己保存的生词",
                    color = LuminaBrown.copy(alpha = 0.62f),
                    fontWeight = FontWeight.Bold,
                )
            }
            TextButton(onClick = onRefresh, enabled = !state.isRefreshing) {
                if (state.isRefreshing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = LuminaTeal,
                    )
                } else {
                    Text("刷新")
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = state.selectedTab == LibraryTab.Official,
                onClick = { onSelectTab(LibraryTab.Official) },
                label = { Text("官方词库") },
            )
            FilterChip(
                selected = state.selectedTab == LibraryTab.Groups,
                onClick = { onSelectTab(LibraryTab.Groups) },
                label = { Text("学习组 ${overview.groups.size}") },
            )
            FilterChip(
                selected = state.selectedTab == LibraryTab.Saved,
                onClick = { onSelectTab(LibraryTab.Saved) },
                label = { Text("生词 ${state.savedWords.size}") },
            )
        }

        state.errorMessage?.let { InlineError(it) }

        when (state.selectedTab) {
            LibraryTab.Official -> overview.officialLibraries.forEach { library ->
                    OfficialLibraryCard(
                        library = library,
                        onClick = { onOpenOfficialLibrary(library.libraryId) },
                        onStart = { onStartOfficial(library.libraryId, library.mode) },
                    )
                }

            LibraryTab.Groups -> {
            val selectedLibrary = overview.officialLibraries
                .firstOrNull { it.libraryId == state.selectedLibraryId }
            if (selectedLibrary != null) {
                Surface(
                    color = LuminaTeal.copy(alpha = 0.1f),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "只看：${selectedLibrary.title}",
                            modifier = Modifier.weight(1f),
                            color = LuminaTeal,
                            fontWeight = FontWeight.Black,
                        )
                        TextButton(onClick = onClearLibraryFilter) {
                            Text("显示全部")
                        }
                    }
                }
            }

            val groups = overview.groups.filter {
                state.selectedLibraryId == null || it.libraryId == state.selectedLibraryId
            }
            if (groups.isEmpty()) {
                EmptyGroupsState(selectedLibrary?.title)
            } else {
                groups.forEach { group ->
                    LearningGroupCard(group = group, onClick = { onOpenGroup(group.id) })
                }
            }
            }

            LibraryTab.Saved -> SavedWordsContent(
                state = state,
                onLookupWord = onLookupWord,
                onRemoveSavedWord = onRemoveSavedWord,
                onStartGroup = onStartSavedWordsGroup,
            )
        }

        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun SavedWordsContent(
    state: LibraryUiState,
    onLookupWord: (String) -> Unit,
    onRemoveSavedWord: (String) -> Unit,
    onStartGroup: () -> Unit,
) {
    var pendingRemoval by remember { mutableStateOf<SavedWordEntry?>(null) }
    val availableCount = state.savedWords.count { !it.isInActiveLearningGroup }
    Surface(
        color = LuminaTeal.copy(alpha = 0.1f),
        shape = RoundedCornerShape(22.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("个人生词库", color = LuminaBrown, fontSize = 20.sp, fontWeight = FontWeight.Black)
            Text(
                "按保存顺序凑满 30 个可用词即可生成个人学习组。",
                color = LuminaBrown.copy(alpha = 0.65f),
                fontWeight = FontWeight.Bold,
            )
            Button(
                onClick = onStartGroup,
                enabled = availableCount >= 30 && !state.isCreatingSavedWordsGroup,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                if (state.isCreatingSavedWordsGroup) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = Color.White,
                    )
                } else {
                    Text(if (availableCount >= 30) "用前 30 个生词开始学习" else "还差 ${30 - availableCount} 个可用词")
                }
            }
        }
    }

    if (state.savedWords.isEmpty()) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color.White.copy(alpha = 0.9f),
            shape = RoundedCornerShape(24.dp),
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("生词库还是空的", color = LuminaBrown, fontSize = 20.sp, fontWeight = FontWeight.Black)
                Text("在查词详情中点击“加入生词库”即可保存。", color = LuminaBrown.copy(alpha = 0.6f))
            }
        }
        return
    }

    state.savedWords.forEach { entry ->
        SavedWordCard(
            entry = entry,
            isDeleting = state.deletingSavedWordId == entry.vocabularyItemId,
            onLookup = { onLookupWord(entry.word) },
            onRemove = { pendingRemoval = entry },
        )
    }

    pendingRemoval?.let { entry ->
        AlertDialog(
            onDismissRequest = { pendingRemoval = null },
            title = { Text("移除生词") },
            text = { Text("确定从个人生词库移除 “${entry.word}” 吗？这不会删除已有学习与复习记录。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingRemoval = null
                        onRemoveSavedWord(entry.vocabularyItemId)
                    },
                ) {
                    Text("移除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemoval = null }) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun SavedWordCard(
    entry: SavedWordEntry,
    isDeleting: Boolean,
    onLookup: () -> Unit,
    onRemove: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onLookup),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(24.dp),
        shadowElevation = 3.dp,
    ) {
        Column(
            modifier = Modifier.padding(17.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(entry.word, color = LuminaBrown, fontSize = 21.sp, fontWeight = FontWeight.Black)
                    if (entry.phonetic.isNotBlank()) {
                        Text(entry.phonetic, color = LuminaTeal, fontWeight = FontWeight.Bold)
                    }
                }
                StatusBadge(
                    label = if (entry.isInActiveLearningGroup) "学习中" else "可用",
                    color = if (entry.isInActiveLearningGroup) Color(0xFFE28A22) else LuminaTeal,
                )
            }
            Text(
                entry.meaning.ifBlank { "暂无释义" },
                color = LuminaBrown,
                fontWeight = FontWeight.Black,
            )
            if (entry.exampleSentence.isNotBlank()) {
                Text(
                    entry.exampleSentence,
                    color = LuminaBrown.copy(alpha = 0.62f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "保存于 ${entry.savedAt.take(10)}",
                    modifier = Modifier.weight(1f),
                    color = LuminaBrown.copy(alpha = 0.5f),
                    fontSize = 12.sp,
                )
                TextButton(onClick = onRemove, enabled = !isDeleting) {
                    if (isDeleting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("移除", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun OfficialLibraryCard(
    library: OfficialLibraryOverview,
    onClick: () -> Unit,
    onStart: () -> Unit,
) {
    val masteredProgress = if (library.totalWordCount > 0) {
        library.completedMemoryWordCount.toFloat() / library.totalWordCount
    } else {
        0f
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(26.dp),
        shadowElevation = 4.dp,
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(13.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = library.title,
                        color = LuminaBrown,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.Black,
                    )
                    Text(
                        text = library.description,
                        color = LuminaBrown.copy(alpha = 0.58f),
                        fontSize = 12.sp,
                    )
                }
                StatusBadge(
                    label = if (library.activeGroupId != null) "进行中" else "${library.existingGroupCount} 组",
                    color = if (library.activeGroupId != null) Color(0xFFE28A22) else LuminaTeal,
                )
            }

            LinearProgressIndicator(
                progress = { masteredProgress.coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(CircleShape),
                color = LuminaTeal,
                trackColor = LuminaCream,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = "${library.completedMemoryWordCount}/${library.totalWordCount} 已掌握",
                    color = LuminaTeal,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    text = "${library.loadedWordCount} 已载入 · ${modeLabel(library.mode)}",
                    color = LuminaBrown.copy(alpha = 0.58f),
                    fontSize = 12.sp,
                )
            }
            Text(
                text = if (library.existingGroupCount > 0) "查看这个词库的学习组 ›" else "尚未开始，可创建第一组",
                color = LuminaBrown.copy(alpha = 0.7f),
                fontWeight = FontWeight.Bold,
            )
            Button(
                onClick = onStart,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                Text(if (library.activeGroupId != null) "继续学习" else "开始学习")
            }
        }
    }
}

@Composable
private fun LearningGroupCard(
    group: LibraryGroupSummary,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(24.dp),
        shadowElevation = 3.dp,
    ) {
        Column(
            modifier = Modifier.padding(17.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = group.title,
                        color = LuminaBrown,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Black,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${group.wordCount} 个词 · ${group.createdAt.take(10)}",
                        color = LuminaBrown.copy(alpha = 0.58f),
                        fontSize = 12.sp,
                    )
                }
                StatusBadge(
                    label = if (group.status == "completed") "已完成" else "进行中",
                    color = if (group.status == "completed") LuminaTeal else Color(0xFFE28A22),
                )
            }
            Text(
                text = "${if (group.sourceType == "system") "官方词库" else "个人学习组"}"
                    + (group.sessionRound?.let { " · ${roundLabel(it)}" } ?: ""),
                color = LuminaBrown.copy(alpha = 0.72f),
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun GroupDetailContent(
    state: LibraryUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onSelectWord: (String) -> Unit,
    onStartGroup: (String) -> Unit,
) {
    when {
        state.isLoadingGroup -> LibraryLoadingState(message = "正在打开学习组…")
        state.groupDetail?.group == null -> LibraryErrorState(
            message = state.errorMessage ?: "这组材料暂时打不开。",
            onRetry = onRetry,
            onBack = onBack,
        )

        else -> GroupDetailList(
            detail = state.groupDetail,
            errorMessage = state.errorMessage,
            onBack = onBack,
            onSelectWord = onSelectWord,
            onStartGroup = onStartGroup,
        )
    }
}

@Composable
private fun GroupDetailList(
    detail: LibraryGroupDetail,
    errorMessage: String?,
    onBack: () -> Unit,
    onSelectWord: (String) -> Unit,
    onStartGroup: (String) -> Unit,
) {
    val group = detail.group ?: return

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp),
    ) {
        TextButton(onClick = onBack) {
            Text("‹ 返回学习组")
        }
        Text(
            text = group.title,
            color = LuminaBrown,
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
        )
        Text(
            text = "${group.wordCount} 个词 · ${if (group.status == "completed") "已完成" else "进行中"}"
                + (group.sessionRound?.let { " · ${roundLabel(it)}" } ?: ""),
            color = LuminaTeal,
            fontWeight = FontWeight.Black,
        )
        if (group.status != "completed") {
            Button(
                onClick = { onStartGroup(group.id) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
            ) {
                Text("继续学习")
            }
        }
        errorMessage?.let { InlineError(it) }

        if (detail.words.isEmpty()) {
            EmptyGroupsState("这个学习组")
        } else {
            detail.words.forEachIndexed { index, word ->
                WordCard(
                    number = index + 1,
                    word = word,
                    onClick = { onSelectWord(word.id) },
                )
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun WordCard(
    number: Int,
    word: LibraryGroupWord,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(LuminaCream),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = number.toString().padStart(2, '0'),
                    color = LuminaBrown.copy(alpha = 0.58f),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = word.word,
                        modifier = Modifier.weight(1f),
                        color = LuminaBrown,
                        fontSize = 21.sp,
                        fontWeight = FontWeight.Black,
                    )
                    StatusBadge(memoryStateLabel(word.memoryState), memoryStateColor(word.memoryState))
                }
                if (word.phonetic.isNotBlank()) {
                    Text(word.phonetic, color = LuminaTeal, fontSize = 12.sp)
                }
                Text(
                    text = word.meaning.ifBlank { "暂无释义" },
                    color = LuminaBrown.copy(alpha = 0.78f),
                )
            }
        }
    }
}

@Composable
private fun WordDetailDialog(
    word: LibraryGroupWord,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text(word.word, fontWeight = FontWeight.Black)
                if (word.phonetic.isNotBlank()) {
                    Text(word.phonetic, color = LuminaTeal, fontSize = 13.sp)
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusBadge(memoryStateLabel(word.memoryState), memoryStateColor(word.memoryState))
                Text(word.meaning.ifBlank { "暂无释义" }, fontWeight = FontWeight.Bold)
                if (word.posTags.isNotEmpty()) {
                    Text("词性：${word.posTags.joinToString(" · ")}")
                }
                if (word.memoryTip.isNotBlank()) {
                    Text("记忆提示：${word.memoryTip}")
                }
                word.examples.firstOrNull()?.let { example ->
                    Text(example.sentence, fontWeight = FontWeight.Bold)
                    if (example.translation.isNotBlank()) {
                        Text(example.translation, color = LuminaBrown.copy(alpha = 0.68f))
                    }
                }
                Text(
                    text = "下次复习：${word.nextReviewAt?.replace('T', ' ')?.take(16) ?: "未安排"}",
                    color = LuminaBrown.copy(alpha = 0.62f),
                    fontSize = 12.sp,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("关闭")
            }
        },
    )
}

@Composable
private fun StatusBadge(label: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.12f),
        shape = CircleShape,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            color = color,
            fontSize = 10.sp,
            fontWeight = FontWeight.Black,
        )
    }
}

@Composable
private fun EmptyGroupsState(subject: String?) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.8f),
        shape = RoundedCornerShape(24.dp),
    ) {
        Column(
            modifier = Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "${subject ?: "当前"}还没有学习组",
                color = LuminaBrown,
                fontSize = 19.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = "从官方词库开始后，学习组会显示在这里。",
                color = LuminaBrown.copy(alpha = 0.58f),
            )
        }
    }
}

@Composable
private fun InlineError(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.error.copy(alpha = 0.08f),
        shape = RoundedCornerShape(18.dp),
    ) {
        Text(
            text = message,
            modifier = Modifier.padding(14.dp),
            color = MaterialTheme.colorScheme.error,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun LibraryLoadingState(message: String = "正在同步词库…") {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(color = LuminaTeal)
        Spacer(Modifier.height(12.dp))
        Text(message, color = LuminaBrown, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun LibraryErrorState(
    message: String,
    onRetry: () -> Unit,
    onBack: (() -> Unit)? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "词库加载失败",
            color = LuminaBrown,
            fontSize = 24.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(10.dp))
        Text(message, color = LuminaBrown.copy(alpha = 0.68f))
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = LuminaTeal),
        ) {
            Text("重新加载")
        }
        if (onBack != null) {
            OutlinedButton(onClick = onBack) {
                Text("返回词库")
            }
        }
    }
}

private fun modeLabel(mode: String) = if (mode == "shuffle") "乱序" else "顺序"

private fun roundLabel(round: String) = when (round) {
    "round1" -> "第一轮"
    "round2" -> "第二轮"
    "round3" -> "第三轮"
    "article" -> "文章巩固"
    else -> round
}

private fun memoryStateLabel(state: String) = when (state) {
    "fuzzy" -> "模糊"
    "slow_recall" -> "慢回忆"
    "stable_recall" -> "稳回忆"
    "mastered" -> "掌握"
    else -> "新词"
}

private fun memoryStateColor(state: String) = when (state) {
    "fuzzy" -> Color(0xFFC95D4B)
    "slow_recall" -> Color(0xFFE28A22)
    "stable_recall" -> Color(0xFF3D78C5)
    "mastered" -> LuminaTeal
    else -> LuminaBrown.copy(alpha = 0.58f)
}
