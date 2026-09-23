import { ReviewAttemptResponse, ReviewAttemptSource } from '../types';
import { submitBatchReviewAttempts } from './reviewApi';
import { supabase } from './supabase';
import { writeLocal } from './durableStorage';
import { extractErrorStatus, isTransientError, moveToDeadLetter } from './sync/OfflineSyncManager';

export interface QueuedAttempt {
  clientAttemptId: string;
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
  timestamp: number;
  retryCount?: number;
}

export type AttemptSyncListener = (params: { attempt: QueuedAttempt; result: ReviewAttemptResponse }) => void;

const STORAGE_KEY = 'lumina.attempt-queue.v2.';
const SYNC_THRESHOLD = 5; // 每积攒 5 个词同步一次
const SYNC_INTERVAL_MS = 30000; // 每 30 秒强制检查一次同步

class AttemptBuffer {
  private userId: string | null = null;
  private queue: QueuedAttempt[] = [];
  private activeFlush: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<AttemptSyncListener>();

  constructor() {
    supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      if (userId === this.userId) return;
      this.userId = userId;
      this.queue = [];
      this.loadFromStorage();
      if (userId) void this.flush();
    });
    if (typeof window !== 'undefined')
      window.addEventListener('online', () => {
        void this.flush();
      });
    this.startTimer();
  }

  private createAttemptId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !this.userId) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY + this.userId);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.queue = Array.isArray(parsed)
          ? parsed.map((item) => ({
              ...item,
              clientAttemptId: typeof item.clientAttemptId === 'string' ? item.clientAttemptId : this.createAttemptId(),
            }))
          : [];
      }
    } catch (e) {
      console.error('Failed to load attempt buffer from storage', e);
      this.queue = [];
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined' || !this.userId) return;
    writeLocal(STORAGE_KEY + this.userId, this.queue);
    window.dispatchEvent(new Event('lumina:sync-change'));
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
    if (!this.userId) throw new Error('请先登录，再保存答题记录。');
    const item: QueuedAttempt = {
      ...attempt,
      clientAttemptId: this.createAttemptId(),
      timestamp: Date.now(),
    };

    const nextQueue = [...this.queue, item];
    writeLocal(STORAGE_KEY + this.userId, nextQueue);
    this.queue = nextQueue;
    window.dispatchEvent(new Event('lumina:sync-change'));

    // 如果达到阈值且当前没有正在同步，则触发同步
    if (this.queue.length >= SYNC_THRESHOLD && !this.activeFlush) {
      void this.flush();
    }
  }

  private async flushOnce() {
    const owner = this.userId;
    if (!owner || navigator.onLine === false) return false;
    const batchToSync = this.queue.slice(0, 50);
    if (batchToSync.length === 0) return true;

    try {
      // 使用批量接口一次性同步，提高效率
      const results = await submitBatchReviewAttempts(
        batchToSync.map((item) => ({
          vocabularyItemId: item.vocabularyItemId,
          learningGroupId: item.learningGroupId,
          source: item.source,
          wasCorrect: item.wasCorrect,
          elapsedMs: item.elapsedMs,
          timestamp: item.timestamp, // 携带产生时间，用于后端冲突校验
        })),
        owner,
      );
      if (owner !== this.userId) return false;
      if (!Array.isArray(results) || results.length !== batchToSync.length) throw new Error('同步结果不完整');

      results.forEach((result, index) => {
        const attempt = batchToSync[index];
        if (attempt && !result.ignored) {
          this.notifySynced(attempt, result);
        }
      });

      // 同步成功，从主队列中移除这些已同步的项
      const syncedIds = new Set(batchToSync.map((i) => i.clientAttemptId));
      this.queue = this.queue.filter((i) => !syncedIds.has(i.clientAttemptId));
      this.saveToStorage();
      return true;
    } catch (e: unknown) {
      if (owner !== this.userId) return false;
      const status = extractErrorStatus(e);
      const transient = isTransientError(e);
      const isFatal = !transient;

      if (isFatal) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        const fatalReason = `Batch attempt non-transient error (HTTP ${status ?? 'unknown'}): ${errorMsg}`;
        moveToDeadLetter(
          owner,
          {
            id: `batch-attempt-${Date.now()}`,
            kind: 'batch_review_attempts',
            revision: crypto.randomUUID(),
            userId: owner,
            payload: batchToSync,
            createdAt: Date.now(),
            retryCount: 1,
            maxRetries: 3,
            nextRetryAt: 0,
          },
          fatalReason,
        );

        // Remove poison pill items from queue to UNBLOCK subsequent items
        const failedIds = new Set(batchToSync.map((i) => i.clientAttemptId));
        this.queue = this.queue.filter((i) => !failedIds.has(i.clientAttemptId));
        this.saveToStorage();
        return true;
      } else {
        const updatedBatch = batchToSync.map((item) => ({
          ...item,
          retryCount: (item.retryCount ?? 0) + 1,
        }));

        const exhaustedItems = updatedBatch.filter((item) => (item.retryCount ?? 0) >= 3);
        if (exhaustedItems.length > 0) {
          moveToDeadLetter(
            owner,
            {
              id: `exhausted-attempts-${Date.now()}`,
              kind: 'batch_review_attempts',
              revision: crypto.randomUUID(),
              userId: owner,
              payload: exhaustedItems,
              createdAt: Date.now(),
              retryCount: 3,
              maxRetries: 3,
              nextRetryAt: 0,
            },
            `Exceeded max retries: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        const exhaustedIds = new Set(exhaustedItems.map((i) => i.clientAttemptId));
        const updatedMap = new Map(updatedBatch.map((i) => [i.clientAttemptId, i]));

        this.queue = this.queue
          .filter((i) => !exhaustedIds.has(i.clientAttemptId))
          .map((i) => updatedMap.get(i.clientAttemptId) ?? i);
        this.saveToStorage();

        console.error('Batch sync failed, will retry later', e);
        return false;
      }
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

  flushKeepalive() {
    void this.flush();
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
