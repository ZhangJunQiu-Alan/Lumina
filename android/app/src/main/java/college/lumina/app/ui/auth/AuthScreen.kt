package college.lumina.app.ui.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import college.lumina.app.R
import college.lumina.app.ui.theme.LuminaBrown
import college.lumina.app.ui.theme.LuminaCream
import college.lumina.app.ui.theme.LuminaGold
import college.lumina.app.ui.theme.LuminaTeal

@Composable
fun SessionLoadingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.lumina_logo),
                contentDescription = "Lumina",
                modifier = Modifier.size(88.dp),
            )
            CircularProgressIndicator(color = LuminaTeal)
            Text(
                text = "正在恢复账号状态…",
                color = LuminaBrown,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
fun AuthScreen(
    state: AuthUiState,
    onModeChange: (AuthMode) -> Unit,
    onFullNameChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onConfirmPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(LuminaCream),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.lumina_logo),
                contentDescription = "Lumina",
                modifier = Modifier.size(94.dp),
            )
            Text(
                text = "Lumina",
                color = LuminaBrown,
                fontSize = 34.sp,
                fontWeight = FontWeight.Black,
            )
            Text(
                text = "把网页账号与学习记录带到 Android",
                color = LuminaBrown.copy(alpha = 0.66f),
                style = MaterialTheme.typography.bodyMedium,
            )

            Spacer(Modifier.height(28.dp))

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color.White.copy(alpha = 0.92f),
                shape = RoundedCornerShape(28.dp),
                shadowElevation = 8.dp,
            ) {
                Column(
                    modifier = Modifier.padding(22.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    AuthModeSelector(
                        selectedMode = state.mode,
                        onModeChange = onModeChange,
                    )

                    Text(
                        text = if (state.mode == AuthMode.LOGIN) "继续你的学习" else "创建 Lumina 账号",
                        color = LuminaBrown,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Black,
                    )

                    if (state.mode == AuthMode.REGISTER) {
                        OutlinedTextField(
                            value = state.fullName,
                            onValueChange = onFullNameChange,
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("显示名称") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        )
                    }

                    OutlinedTextField(
                        value = state.email,
                        onValueChange = onEmailChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("邮箱") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Next,
                        ),
                    )

                    OutlinedTextField(
                        value = state.password,
                        onValueChange = onPasswordChange,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("密码") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = if (state.mode == AuthMode.LOGIN) ImeAction.Done else ImeAction.Next,
                        ),
                    )

                    if (state.mode == AuthMode.REGISTER) {
                        OutlinedTextField(
                            value = state.confirmPassword,
                            onValueChange = onConfirmPasswordChange,
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("确认密码") },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                        )
                    }

                    state.feedback?.let { feedback ->
                        Text(
                            text = feedback.message,
                            color = if (feedback.isError) {
                                MaterialTheme.colorScheme.error
                            } else {
                                LuminaTeal
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }

                    Button(
                        onClick = onSubmit,
                        enabled = !state.isSubmitting,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(54.dp),
                        shape = RoundedCornerShape(18.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = LuminaGold,
                            contentColor = LuminaBrown,
                        ),
                    ) {
                        if (state.isSubmitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                color = LuminaBrown,
                                strokeWidth = 3.dp,
                            )
                        } else {
                            Text(
                                text = if (state.mode == AuthMode.LOGIN) "登录" else "创建账号",
                                fontWeight = FontWeight.Black,
                                fontSize = 16.sp,
                            )
                        }
                    }

                    Text(
                        text = "当前先完成邮箱账号模块。Google 登录和密码找回将在后续账号增强中接入。",
                        color = LuminaBrown.copy(alpha = 0.56f),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthModeSelector(
    selectedMode: AuthMode,
    onModeChange: (AuthMode) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AuthMode.entries.forEach { mode ->
            val selected = mode == selectedMode
            TextButton(
                onClick = { onModeChange(mode) },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.textButtonColors(
                    containerColor = if (selected) LuminaTeal.copy(alpha = 0.14f) else Color.Transparent,
                    contentColor = if (selected) LuminaTeal else LuminaBrown.copy(alpha = 0.62f),
                ),
            ) {
                Text(
                    text = if (mode == AuthMode.LOGIN) "登录" else "注册",
                    fontWeight = FontWeight.Black,
                )
            }
        }
    }
}
