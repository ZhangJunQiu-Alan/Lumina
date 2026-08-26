package college.lumina.app.ui.ielts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.data.ielts.IeltsAttempt
import college.lumina.app.data.ielts.IeltsBook
import college.lumina.app.data.ielts.IeltsModule
import college.lumina.app.data.ielts.IeltsTest
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

@Composable
fun IeltsScreen(
    state: IeltsUiState,
    targetScore: Double,
    contentPadding: PaddingValues,
    onRefresh: () -> Unit,
    onSelectTab: (IeltsTab) -> Unit,
    onSelectTest: (IeltsModule, IeltsTest) -> Unit,
    onDismissTest: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(contentPadding),
    ) {
        when {
            state.isLoading -> LoadingState()
            state.dashboard == null -> ErrorState(state.errorMessage ?: "IELTS 数据暂时无法加载。", onRefresh)
            else -> DashboardContent(
                state = state,
                targetScore = targetScore,
                onRefresh = onRefresh,
                onSelectTab = onSelectTab,
                onSelectTest = onSelectTest,
            )
        }
    }

    state.selectedTest?.let { selection ->
        AlertDialog(
            onDismissRequest = onDismissTest,
            title = { Text("${moduleLabel(selection.module)} · Test ${selection.test.testNumber}") },
            text = {
                Text(
                    "已选中 ${selection.test.bookTitle}。原生答题页将在下一个模块接入，当前题库和练习记录入口已经准备完成。",
                )
            },
            confirmButton = {
                TextButton(onClick = onDismissTest) {
                    Text("知道了")
                }
            },
        )
    }
}

@Composable
private fun DashboardContent(
    state: IeltsUiState,
    targetScore: Double,
    onRefresh: () -> Unit,
    onSelectTab: (IeltsTab) -> Unit,
    onSelectTest: (IeltsModule, IeltsTest) -> Unit,
) {
    val dashboard = state.dashboard ?: return
    val readingTests = dashboard.readingBooks.flatMap(IeltsBook::tests)
    val listeningTests = dashboard.listeningBooks.flatMap(IeltsBook::tests)
    val listeningEnabled = listeningTests.isNotEmpty()
    val allTests = readingTests + listeningTests
    val completedCount = allTests.count { it.id in state.completedTestIds }
    val progress = if (allTests.isEmpty()) 0f else completedCount.toFloat() / allTests.size

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("IELTS", color = LuminaBrown, fontSize = 32.sp, fontWeight = FontWeight.Black)
                Text(
                    if (listeningEnabled) "Cambridge 阅读与听力练习中心" else "Cambridge 阅读练习中心",
                    color = LuminaBrown.copy(alpha = 0.62f),
                    fontWeight = FontWeight.Bold,
                )
            }
            TextButton(onClick = onRefresh, enabled = !state.isRefreshing) {
                if (state.isRefreshing) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("刷新")
                }
            }
        }

        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            IeltsTab.entries.filter { it != IeltsTab.Listening || listeningEnabled }.forEach { tab ->
                FilterChip(
                    selected = state.selectedTab == tab,
                    onClick = { onSelectTab(tab) },
                    label = { Text(tabLabel(tab)) },
                )
            }
        }

        state.errorMessage?.let {
            Surface(color = MaterialTheme.colorScheme.error.copy(alpha = 0.1f), shape = RoundedCornerShape(16.dp)) {
                Text(it, modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.error)
            }
        }

        when (state.selectedTab) {
            IeltsTab.Overview -> {
                OverviewHero(
                    currentBand = state.currentBand,
                    targetScore = targetScore,
                    completedCount = completedCount,
                    totalCount = allTests.size,
                    progress = progress,
                )
                state.nextTest?.let { selection ->
                    RecommendationCard(selection.module, selection.test) {
                        onSelectTest(selection.module, selection.test)
                    }
                }
                ModuleSummaryCard(
                    title = "Academic Reading",
                    completed = readingTests.count { it.id in state.completedTestIds },
                    total = readingTests.size,
                    attempts = dashboard.readingAttempts.size,
                    color = LuminaTeal,
                    onClick = { onSelectTab(IeltsTab.Reading) },
                )
                if (listeningEnabled) {
                    ModuleSummaryCard(
                        title = "Listening",
                        completed = listeningTests.count { it.id in state.completedTestIds },
                        total = listeningTests.size,
                        attempts = dashboard.listeningAttempts.size,
                        color = Color(0xFF6E62C6),
                        onClick = { onSelectTab(IeltsTab.Listening) },
                    )
                }
                if (state.allAttempts.isNotEmpty()) {
                    Text("最近练习", color = LuminaBrown, fontSize = 21.sp, fontWeight = FontWeight.Black)
                    state.allAttempts.take(6).forEach { attempt ->
                        AttemptCard(attempt)
                    }
                }
            }

            IeltsTab.Reading -> BookList(
                books = dashboard.readingBooks,
                module = IeltsModule.Reading,
                completedIds = state.completedTestIds,
                onSelectTest = onSelectTest,
            )

            IeltsTab.Listening -> BookList(
                books = if (listeningEnabled) dashboard.listeningBooks else dashboard.readingBooks,
                module = if (listeningEnabled) IeltsModule.Listening else IeltsModule.Reading,
                completedIds = state.completedTestIds,
                onSelectTest = onSelectTest,
            )
        }
    }
}

@Composable
private fun OverviewHero(
    currentBand: Double?,
    targetScore: Double,
    completedCount: Int,
    totalCount: Int,
    progress: Float,
) {
    Surface(
        color = LuminaBrown,
        contentColor = Color.White,
        shape = RoundedCornerShape(28.dp),
        shadowElevation = 5.dp,
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Metric("当前估算", currentBand?.let { "%.1f".format(it) } ?: "--")
                Metric("目标分", "%.1f".format(targetScore))
                Metric("已完成", "$completedCount/$totalCount")
            }
            LinearProgressIndicator(
                progress = { progress.coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(CircleShape),
                color = LuminaGold,
                trackColor = Color.White.copy(alpha = 0.18f),
            )
        }
    }
}

@Composable
private fun RowScope.Metric(label: String, value: String) {
    Column(modifier = Modifier.weight(1f)) {
        Text(value, fontSize = 24.sp, fontWeight = FontWeight.Black)
        Text(label, color = Color.White.copy(alpha = 0.66f), fontSize = 12.sp)
    }
}

@Composable
private fun RecommendationCard(module: IeltsModule, test: IeltsTest, onClick: () -> Unit) {
    Surface(color = LuminaGold.copy(alpha = 0.18f), shape = RoundedCornerShape(24.dp)) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text("推荐下一步", color = LuminaBrown.copy(alpha = 0.62f), fontWeight = FontWeight.Bold)
            Text(
                "${moduleLabel(module)} · Cambridge ${test.bookNumber} · Test ${test.testNumber}",
                color = LuminaBrown,
                fontSize = 20.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                "${test.questionCount} 题 · 预计 ${if (module == IeltsModule.Reading) 60 else 30} 分钟",
                color = LuminaBrown.copy(alpha = 0.62f),
            )
            Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
                Text("查看套题")
            }
        }
    }
}

@Composable
private fun ModuleSummaryCard(
    title: String,
    completed: Int,
    total: Int,
    attempts: Int,
    color: Color,
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
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(15.dp))
                    .background(color.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (title.startsWith("Academic")) "R" else "L", color = color, fontWeight = FontWeight.Black)
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 14.dp),
            ) {
                Text(title, color = LuminaBrown, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Text("$completed/$total 套已完成 · $attempts 次练习", color = LuminaBrown.copy(alpha = 0.58f))
            }
            Text("›", color = color, fontSize = 28.sp)
        }
    }
}

@Composable
private fun BookList(
    books: List<IeltsBook>,
    module: IeltsModule,
    completedIds: Set<String>,
    onSelectTest: (IeltsModule, IeltsTest) -> Unit,
) {
    if (books.isEmpty()) {
        Text("当前没有可用套题。", color = LuminaBrown.copy(alpha = 0.62f))
        return
    }

    books.forEach { book ->
        Text(book.title, color = LuminaBrown, fontSize = 21.sp, fontWeight = FontWeight.Black)
        book.tests.forEach { test ->
            TestCard(
                test = test,
                completed = test.id in completedIds,
                onClick = { onSelectTest(module, test) },
            )
        }
    }
}

@Composable
private fun TestCard(test: IeltsTest, completed: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Test ${test.testNumber}", color = LuminaBrown, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Text(
                    "${test.partCount} 部分 · ${test.questionCount} 题",
                    color = LuminaBrown.copy(alpha = 0.58f),
                )
            }
            Text(
                if (completed) "已练习" else "未开始",
                color = if (completed) LuminaTeal else Color(0xFFE28A22),
                fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun AttemptCard(attempt: IeltsAttempt) {
    Surface(color = Color.White.copy(alpha = 0.9f), shape = RoundedCornerShape(18.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Cambridge ${attempt.bookNumber} · Test ${attempt.testNumber}",
                    color = LuminaBrown,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(attempt.submittedAt.take(10), color = LuminaBrown.copy(alpha = 0.5f), fontSize = 12.sp)
            }
            Text(
                "${attempt.score}/${attempt.totalQuestions}",
                color = LuminaTeal,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun LoadingState() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = LuminaTeal)
            Text("正在加载 IELTS 练习", modifier = Modifier.padding(top = 12.dp), color = LuminaBrown)
        }
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onRetry) { Text("重试") }
        }
    }
}

private fun tabLabel(tab: IeltsTab) = when (tab) {
    IeltsTab.Overview -> "总览"
    IeltsTab.Reading -> "阅读"
    IeltsTab.Listening -> "听力"
}

private fun moduleLabel(module: IeltsModule) = when (module) {
    IeltsModule.Reading -> "阅读"
    IeltsModule.Listening -> "听力"
}
