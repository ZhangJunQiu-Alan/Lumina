import { ReviewAttemptResponse, ReviewAttemptSource } from '../types';
import { submitBatchReviewAttempts } from './reviewApi';
import { getCachedAccessToken, resolveApiUrl } from './api';

export interface QueuedAttempt {
  clientAttemptId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
  timestamp: number;
}

export type AttemptSyncListener = (params: {
  attempt: QueuedAttempt;
  result: ReviewAttemptResponse;
}) => void;

const STORAGE_KEY = 'lumina_attempt_queue';
const SYNC_THRESHOLD = 5; // 每积攒 5 个词同步一次
const SYNC_INTERVAL_MS = 30000; // 每 30 秒强制检查一次同步

class AttemptBuffer {
  private queue: QueuedAttempt[] = [];
  private activeFlush: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<AttemptSyncListener>();

  constructor() {
    this.loadFromStorage();
    this.startTimer();
  }

  private createAttemptId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.queue = Array.isArray(parsed)
          ? parsed.map((item) => ({
              ...item,
              clientAttemptId: typeof item.clientAttemptId === 'string'
                ? item.clientAttemptId
                : this.createAttemptId(),
            }))
          : [];
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

  subscribe(listener: AttemptSyncListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifySynced(attempt: QueuedAttempt, result: ReviewAttemptResponse) {
    this.listeners.forEach((listener) => {
      try {
        listener({ attempt, result });
      } catch (error) {
        console.error('Attempt sync listener failed', error);
      }
    });
  }

  /**
   * 将一次练习结果加入队列
   */
  async pushAttempt(attempt: Omit<QueuedAttempt, 'clientAttemptId' | 'timestamp'>) {
    const item: QueuedAttempt = {
      ...attempt,
      clientAttemptId: this.createAttemptId(),
      timestamp: Date.now(),
    };

    this.queue.push(item);
    this.saveToStorage();

    // 如果达到阈值且当前没有正在同步，则触发同步
    if (this.queue.length >= SYNC_THRESHOLD && !this.activeFlush) {
      void this.flush();
    }
  }

  private async flushOnce() {
    const batchToSync = [...this.queue];
    if (batchToSync.length === 0) return true;

    try {
      // 使用批量接口一次性同步，提高效率
      const results = await submitBatchReviewAttempts(batchToSync.map(item => ({
        vocabularyItemId: item.vocabularyItemId,
        learningGroupId: item.learningGroupId,
        source: item.source,
        wasCorrect: item.wasCorrect,
        elapsedMs: item.elapsedMs,
        timestamp: item.timestamp, // 携带产生时间，用于后端冲突校验
      })));

      results.forEach((result, index) => {
        const attempt = batchToSync[index];
        if (attempt && !result.ignored) {
          this.notifySynced(attempt, result);
        }
      });

      // 同步成功，从主队列中移除这些已同步的项
      const syncedIds = new Set(batchToSync.map(i => i.clientAttemptId));
      this.queue = this.queue.filter(i => !syncedIds.has(i.clientAttemptId));
      this.saveToStorage();
      return true;
    } catch (e) {
      console.error('Batch sync failed, will retry later', e);
      return false;
    }
  }

  /**
   * 强制清空缓冲区并同步到服务器
   */
  async flush() {
    while (this.queue.length > 0) {
      if (this.activeFlush) {
        const completed = await this.activeFlush;
        if (!completed) return;
        continue;
      }

      const run = this.flushOnce();
      this.activeFlush = run;
      const completed = await run;
      if (this.activeFlush === run) {
        this.activeFlush = null;
      }
      if (!completed) return;
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
