package college.lumina.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LuminaColorScheme = lightColorScheme(
    primary = LuminaTeal,
    onPrimary = Color.White,
    secondary = LuminaGold,
    onSecondary = LuminaBrown,
    background = LuminaCream,
    onBackground = LuminaBrown,
    surface = Color.White,
    onSurface = LuminaBrown,
    error = Color(0xFFB3261E),
)

@Composable
fun LuminaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LuminaColorScheme,
        content = content,
    )
}
