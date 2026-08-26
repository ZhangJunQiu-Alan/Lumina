package college.lumina.app.ui.audio

import android.media.MediaPlayer
import android.media.PlaybackParams
import java.io.Closeable
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AndroidAudioPlayer : Closeable {
    private var activePlayer: MediaPlayer? = null

    suspend fun play(
        url: String,
        speed: Float,
        repeatCount: Int,
        repeatGapMs: Long,
    ) {
        stop()
        val effectiveRepeatCount = repeatCount.coerceIn(1, 3)
        repeat(effectiveRepeatCount) { index ->
            playOnce(url, speed.coerceIn(0.5f, 2f))
            if (index < effectiveRepeatCount - 1 && repeatGapMs > 0) {
                delay(repeatGapMs)
            }
        }
    }

    fun stop() {
        activePlayer?.runCatching {
            stop()
            reset()
            release()
        }
        activePlayer = null
    }

    override fun close() {
        stop()
    }

    private suspend fun playOnce(
        url: String,
        speed: Float,
    ) {
        suspendCancellableCoroutine { continuation ->
            val player = MediaPlayer()
            activePlayer = player
            continuation.invokeOnCancellation {
                releasePlayer(player)
            }
            player.setOnPreparedListener {
                runCatching {
                    it.playbackParams = PlaybackParams().setSpeed(speed)
                    it.start()
                }.onFailure { error ->
                    finishWithError(player, continuation, error)
                }
            }
            player.setOnCompletionListener {
                releasePlayer(player)
                if (continuation.isActive) continuation.resume(Unit)
            }
            player.setOnErrorListener { _, what, extra ->
                finishWithError(
                    player,
                    continuation,
                    IllegalStateException("音频播放失败（$what/$extra）。"),
                )
                true
            }
            runCatching {
                player.setDataSource(url)
                player.prepareAsync()
            }.onFailure { error ->
                finishWithError(player, continuation, error)
            }
        }
    }

    private fun finishWithError(
        player: MediaPlayer,
        continuation: CancellableContinuation<Unit>,
        error: Throwable,
    ) {
        releasePlayer(player)
        if (continuation.isActive) continuation.resumeWithException(error)
    }

    private fun releasePlayer(player: MediaPlayer) {
        player.runCatching {
            reset()
            release()
        }
        if (activePlayer === player) activePlayer = null
    }
}
