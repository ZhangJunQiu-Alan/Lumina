import { ReviewAttemptSource } from '../types';
import { submitBatchReviewAttempts } from './reviewApi';
import { getCachedAccessToken, resolveApiUrl } from './api';

export interface QueuedAttempt {
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
  timestamp: number;
}

const STORAGE_KEY = 'lumina_attempt_queue';
const SYNC_THRESHOLD = 5; // 每积攒 5 个词同步一次
const SYNC_INTERVAL_MS = 30000; // 每 30 秒强制检查一次同步

class AttemptBuffer {
  private queue: QueuedAttempt[] = [];
  private isSyncing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromStorage();
    this.startTimer();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load attempt buffer from storage', e);
      this.queue = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error('Failed to save attempt buffer to storage', e);
    }
  }

  private startTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.queue.length > 0) {
        void this.flush();
      }
    }, SYNC_INTERVAL_MS);
  }

  /**
   * 将一次练习结果加入队列
   */
  async pushAttempt(attempt: Omit<QueuedAttempt, 'timestamp'>) {
    const item: QueuedAttempt = {
      ...attempt,
      timestamp: Date.now(),
    };

    this.queue.push(item);
    this.saveToStorage();

    // 如果达到阈值且当前没有正在同步，则触发同步
    if (this.queue.length >= SYNC_THRESHOLD && !this.isSyncing) {
      void this.flush();
    }
  }

  /**
   * 强制清空缓冲区并同步到服务器
   */
  async flush() {
    if (this.isSyncing || this.queue.length === 0) return;

    this.isSyncing = true;
    const batchToSync = [...this.queue];
    
    try {
      // 使用批量接口一次性同步，提高效率
      await submitBatchReviewAttempts(batchToSync.map(item => ({
        vocabularyItemId: item.vocabularyItemId,
        learningGroupId: item.learningGroupId,
        source: item.source,
        wasCorrect: item.wasCorrect,
        elapsedMs: item.elapsedMs,
        timestamp: item.timestamp, // 携带产生时间，用于后端冲突校验
      })));

      // 同步成功，从主队列中移除这些已同步的项
      const syncedTimestamps = new Set(batchToSync.map(i => i.timestamp));
      this.queue = this.queue.filter(i => !syncedTimestamps.has(i.timestamp));
      this.saveToStorage();
    } catch (e) {
      console.error('Batch sync failed, will retry later', e);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 页面隐藏 / 关闭时使用。通过 fetch keepalive 立即把队列送出去，
   * 不清空本地队列——服务端按 timestamp 做幂等校验，重复到达会被 skip。
   * 下次启动若前次请求实际到达，重放也是安全的；若未到达，重放即兜底。
   */
  flushKeepalive() {
    if (this.queue.length === 0) return;
    const token = getCachedAccessToken();
    if (!token) return;

    const snapshot = [...this.queue];
    const payload = JSON.stringify({
      attempts: snapshot.map((item) => ({
        vocabularyItemId: item.vocabularyItemId,
        learningGroupId: item.learningGroupId,
        source: item.source,
        wasCorrect: item.wasCorrect,
        elapsedMs: item.elapsedMs,
        timestamp: item.timestamp,
      })),
    });

    try {
      fetch(resolveApiUrl('/api/review/batch-attempt'), {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: payload,
      }).catch(() => {});
    } catch {
      // keepalive 超过 64KB 等极端情况会同步抛错，留给下次启动重放
    }
  }

  /**
   * 获取当前待同步的数量
   */
  getPendingCount() {
    return this.queue.length;
  }
}

// 导出单例
export const attemptBuffer = new AttemptBuffer();
