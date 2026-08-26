package college.lumina.app.ui.home

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.R
import college.lumina.app.data.auth.AuthenticatedUser
import college.lumina.app.data.home.HomeOfficialLibraryOption
import college.lumina.app.data.home.HomeOverview
import college.lumina.app.data.home.OrbitDay
import college.lumina.app.data.home.RoutineStep
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

@Composable
fun HomeScreen(
    user: AuthenticatedUser,
    state: HomeUiState,
    contentPadding: PaddingValues,
    isSigningOut: Boolean,
    authErrorMessage: String?,
    onRefresh: () -> Unit,
    onSelectDate: (String) -> Unit,
    onSelectLibrary: (String) -> Unit,
    onSelectStudyMode: (String) -> Unit,
    onPrimaryAction: () -> Unit,
    onDismissActionMessage: () -> Unit,
    onSignOut: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(contentPadding),
    ) {
        when {
            state.isLoading -> HomeLoadingState()
            state.overview == null -> HomeErrorState(
                message = state.errorMessage ?: "首页暂时无法加载。",
                onRetry = onRefresh,
                onSignOut = onSignOut,
            )

            else -> HomeContent(
                user = user,
                overview = state.overview,
                selectedDay = state.selectedDay,
                selectedOfficialLibrary = state.selectedOfficialLibrary,
                selectedStudyMode = state.selectedStudyMode,
                isRefreshing = state.isRefreshing,
                isSigningOut = isSigningOut,
                errorMessage = authErrorMessage ?: state.errorMessage,
                onRefresh = onRefresh,
                onSelectDate = onSelectDate,
                onSelectLibrary = onSelectLibrary,
                onSelectStudyMode = onSelectStudyMode,
                onPrimaryAction = onPrimaryAction,
                onSignOut = onSignOut,
            )
        }

        state.actionMessage?.let { message ->
            Snackbar(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(16.dp),
                action = {
                    TextButton(onClick = onDismissActionMessage) {
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
private fun HomeContent(
    user: AuthenticatedUser,
    overview: HomeOverview,
    selectedDay: OrbitDay?,
    selectedOfficialLibrary: HomeOfficialLibraryOption?,
    selectedStudyMode: String,
    isRefreshing: Boolean,
    isSigningOut: Boolean,
    errorMessage: String?,
    onRefresh: () -> Unit,
    onSelectDate: (String) -> Unit,
    onSelectLibrary: (String) -> Unit,
    onSelectStudyMode: (String) -> Unit,
    onPrimaryAction: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        HomeHeader(
            user = user,
            isRefreshing = isRefreshing,
            isSigningOut = isSigningOut,
            onRefresh = onRefresh,
            onSignOut = onSignOut,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MetricCard(value = overview.todayReviewCount, label = "今日到期")
            MetricCard(value = overview.streak, label = "连续学习")
            MetricCard(value = overview.perfectCheckinDays, label = "完成计划")
            MetricCard(value = overview.stableRecallCount, label = "已掌握")
        }

        LearningOrbitCard(
            days = overview.orbitDays,
            selectedDate = selectedDay?.date,
            selectedDay = selectedDay,
            onSelectDate = onSelectDate,
        )

        RoutineCard(
            overview = overview,
            selectedOfficialLibrary = selectedOfficialLibrary,
            selectedStudyMode = selectedStudyMode,
            onSelectLibrary = onSelectLibrary,
            onSelectStudyMode = onSelectStudyMode,
            onPrimaryAction = onPrimaryAction,
        )

        errorMessage?.let {
            Surface(
                color = MaterialTheme.colorScheme.error.copy(alpha = 0.08f),
                shape = RoundedCornerShape(18.dp),
            ) {
                Text(
                    text = it,
                    modifier = Modifier.padding(16.dp),
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun HomeHeader(
    user: AuthenticatedUser,
    isRefreshing: Boolean,
    isSigningOut: Boolean,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Image(
            painter = painterResource(R.drawable.lumina_logo),
            contentDescription = "Lumina",
            modifier = Modifier.size(54.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = user.displayName?.let { "你好，$it" } ?: "Lumina",
                color = LuminaBrown,
                fontSize = 23.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "今日学习概览",
                color = LuminaTeal,
                fontWeight = FontWeight.Bold,
            )
        }
        TextButton(
            onClick = onRefresh,
            enabled = !isRefreshing,
        ) {
            if (isRefreshing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    strokeWidth = 2.dp,
                    color = LuminaTeal,
                )
            } else {
                Text("刷新")
            }
        }
        TextButton(
            onClick = onSignOut,
            enabled = !isSigningOut,
        ) {
            Text("退出")
        }
    }
}

@Composable
private fun MetricCard(value: Int, label: String) {
    Surface(
        modifier = Modifier.size(width = 112.dp, height = 94.dp),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(22.dp),
        shadowElevation = 3.dp,
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = value.toString(),
                color = LuminaBrown,
                fontSize = 30.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = label,
                color = LuminaBrown.copy(alpha = 0.62f),
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun LearningOrbitCard(
    days: List<OrbitDay>,
    selectedDate: String?,
    selectedDay: OrbitDay?,
    onSelectDate: (String) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.88f),
        shape = RoundedCornerShape(26.dp),
        shadowElevation = 4.dp,
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "最近 7 天",
                color = LuminaBrown,
                fontSize = 19.sp,
                fontWeight = FontWeight.Black,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                days.takeLast(7).forEach { day ->
                    OrbitDayBadge(
                        day = day,
                        selected = day.date == selectedDate,
                        onClick = { onSelectDate(day.date) },
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                DaySummary(
                    modifier = Modifier.weight(1f),
                    value = selectedDay?.reviewWordCount ?: 0,
                    label = "复习单词",
                )
                DaySummary(
                    modifier = Modifier.weight(1f),
                    value = selectedDay?.learnedWordCount ?: 0,
                    label = "新学单词",
                )
            }
        }
    }
}

@Composable
private fun OrbitDayBadge(
    day: OrbitDay,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val statusColor = when (day.status) {
        "perfect" -> LuminaGold
        "ordinary" -> LuminaTeal
        "shielded" -> Color(0xFF7094D8)
        else -> Color(0xFFD8D0C2)
    }
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = day.weekdayLabel,
            color = LuminaBrown.copy(alpha = 0.58f),
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
        )
        Box(
            modifier = Modifier
                .size(if (selected) 34.dp else 29.dp)
                .clip(CircleShape)
                .background(if (selected) LuminaBrown else statusColor),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = day.date.substringAfterLast("-").trimStart('0').ifEmpty { "0" },
                color = if (selected || day.status != "gap") Color.White else LuminaBrown,
                fontSize = 11.sp,
                fontWeight = FontWeight.Black,
            )
        }
    }
}

@Composable
private fun DaySummary(
    modifier: Modifier,
    value: Int,
    label: String,
) {
    Surface(
        modifier = modifier,
        color = LuminaCream,
        shape = RoundedCornerShape(18.dp),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = value.toString(),
                color = LuminaBrown,
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = label,
                color = LuminaBrown.copy(alpha = 0.6f),
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun RoutineCard(
    overview: HomeOverview,
    selectedOfficialLibrary: HomeOfficialLibraryOption?,
    selectedStudyMode: String,
    onSelectLibrary: (String) -> Unit,
    onSelectStudyMode: (String) -> Unit,
    onPrimaryAction: () -> Unit,
) {
    val routine = overview.routineCard
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.92f),
        shape = RoundedCornerShape(28.dp),
        shadowElevation = 5.dp,
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = routine.title,
                color = LuminaBrown,
                fontSize = 27.sp,
                fontWeight = FontWeight.Black,
            )
            if (routine.subtitle.isNotBlank()) {
                Text(
                    text = routine.subtitle,
                    color = LuminaBrown.copy(alpha = 0.64f),
                )
            }

            if (routine.officialLibraryOptions.isNotEmpty()) {
                Text(
                    text = "学习词库",
                    color = LuminaBrown,
                    fontWeight = FontWeight.Black,
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    routine.officialLibraryOptions.forEach { option ->
                        FilterChip(
                            selected = option.libraryId == selectedOfficialLibrary?.libraryId,
                            onClick = { onSelectLibrary(option.libraryId) },
                            label = { Text(option.title) },
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = selectedStudyMode == "sequential",
                        onClick = { onSelectStudyMode("sequential") },
                        label = { Text("顺序") },
                    )
                    FilterChip(
                        selected = selectedStudyMode == "shuffle",
                        onClick = { onSelectStudyMode("shuffle") },
                        label = { Text("乱序") },
                    )
                }
                selectedOfficialLibrary?.let { option ->
                    Text(
                        text = "${option.completedMemoryWordCount}/${option.totalWordCount} 已掌握"
                            + if (option.activeRound != null) " · 当前 ${roundLabel(option.activeRound)}" else "",
                        color = LuminaTeal,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(LuminaCream, RoundedCornerShape(20.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                routine.visibleSteps.forEach { step ->
                    RoutineStepRow(step)
                }
            }

            Button(
                onClick = onPrimaryAction,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(19.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = LuminaGold,
                    contentColor = LuminaBrown,
                ),
            ) {
                Text(
                    text = if (routine.ctaMode == "open_library") {
                        routine.ctaLabel
                    } else {
                        "${routine.ctaLabel}（待接入）"
                    },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                )
            }
            Text(
                text = if (routine.ctaMode == "open_library") {
                    "点击进入原生词库，查看官方进度和学习组。"
                } else {
                    "学习和复习流程将在后续模块接入。"
                },
                modifier = Modifier.fillMaxWidth(),
                color = LuminaBrown.copy(alpha = 0.56f),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun RoutineStepRow(step: RoutineStep) {
    val (label, color) = when (step.status) {
        "completed" -> "已完成" to LuminaTeal
        "current" -> "进行中" to Color(0xFFE28A22)
        else -> "待开始" to LuminaBrown.copy(alpha = 0.42f)
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color),
        )
        Text(
            text = step.label,
            modifier = Modifier.weight(1f),
            color = LuminaBrown,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = label,
            color = color,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun HomeLoadingState() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painter = painterResource(R.drawable.lumina_logo),
            contentDescription = "Lumina",
            modifier = Modifier.size(86.dp),
        )
        Spacer(Modifier.height(20.dp))
        CircularProgressIndicator(color = LuminaTeal)
        Spacer(Modifier.height(12.dp))
        Text("正在同步今日学习数据…", color = LuminaBrown, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun HomeErrorState(
    message: String,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = "首页加载失败",
            color = LuminaBrown,
            fontSize = 25.sp,
            fontWeight = FontWeight.Black,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = message,
            color = LuminaBrown.copy(alpha = 0.68f),
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(22.dp))
        Button(onClick = onRetry) {
            Text("重新加载")
        }
        OutlinedButton(onClick = onSignOut) {
            Text("退出登录")
        }
    }
}

private fun roundLabel(round: String) = when (round) {
    "round1" -> "第一轮"
    "round2" -> "第二轮"
    "round3" -> "第三轮"
    "article" -> "文章巩固"
    else -> round
}
