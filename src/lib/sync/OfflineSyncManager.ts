import { supabase } from '../supabase';
import { readLocal, writeLocal } from '../durableStorage';
import type { DeadLetterJob, SyncHandler, SyncJobError, UnifiedSyncJob } from './types';

const UNIFIED_QUEUE_PREFIX = 'lumina.sync.unified.v1.';
const DEAD_LETTER_PREFIX = 'lumina.sync.dead-letter.v1.';
const LEGACY_SYNC_PREFIX = 'lumina.sync.v1.';
const LEGACY_ATTEMPT_PREFIX = 'lumina.attempt-queue.v2.';

const DEFAULT_MAX_RETRIES = 3;
const handlers = new Map<string, SyncHandler>();
const activeFlushes = new Map<string, Promise<void>>();
const backoffTimers = new Map<string, ReturnType<typeof setTimeout>>();

function unifiedKey(userId: string) {
  return `${UNIFIED_QUEUE_PREFIX}${userId}`;
}

function deadLetterKey(userId: string) {
  return `${DEAD_LETTER_PREFIX}${userId}`;
}

export function extractErrorStatus(error: unknown): number | undefined {
  if (!error) return undefined;
  if (typeof error === 'object') {
    const candidate =
      (error as { status?: unknown; statusCode?: unknown }).status ??
      (error as { status?: unknown; statusCode?: unknown }).statusCode;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  if (error instanceof Error) {
    const match = error.message.match(/HTTP\s+(\d{3})/i) || error.message.match(/status:\s*(\d{3})/i);
    if (match) {
      const code = Number.parseInt(match[1], 10);
      if (Number.isFinite(code)) return code;
    }
  }
  return undefined;
}

export function isTransientError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const status = extractErrorStatus(error);
  if (typeof status === 'number') {
    // 429 Rate Limit is transient
    if (status === 429) return true;
    // 502, 503, 504 are transient gateway / service unavailable
    if (status === 502 || status === 503 || status === 504) return true;
    // Non-transient client errors (400 Bad Request, 401, 403, 404, 409, 422)
    if (status >= 400 && status < 500) return false;
    // 5xx server errors default to transient
    if (status >= 500) return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('offline') ||
      msg.includes('fetch') ||
      msg.includes('timeout') ||
      msg.includes('connection')
    ) {
      return true;
    }
  }
  // Default to transient for unexpected network/system failures
  return true;
}

export function calculateBackoffDelayMs(retryCount: number): number {
  const baseDelay = 1000;
  const maxDelay = 30000;
  const exponent = Math.max(0, retryCount - 1);
  return Math.min(maxDelay, baseDelay * Math.pow(2, exponent));
}

function migrateLegacyStorageIfPresent(userId: string) {
  if (typeof window === 'undefined' || !userId) return;

  const legacySyncRaw = localStorage.getItem(`${LEGACY_SYNC_PREFIX}${userId}`);
  const legacyAttemptRaw = localStorage.getItem(`${LEGACY_ATTEMPT_PREFIX}${userId}`);
  if (!legacySyncRaw && !legacyAttemptRaw) return;

  const currentJobs = readLocal<UnifiedSyncJob[]>(unifiedKey(userId)) ?? [];
  const nextJobs: UnifiedSyncJob[] = Array.isArray(currentJobs) ? [...currentJobs] : [];
  let changed = false;

  // 1. Migrate legacy syncQueue (lumina.sync.v1.${userId})
  if (legacySyncRaw) {
    try {
      const parsed = JSON.parse(legacySyncRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item?.id && item.kind && item.revision) {
            if (!nextJobs.some((existing) => existing.id === item.id)) {
              nextJobs.push({
                id: item.id,
                kind: item.kind,
                revision: item.revision,
                userId,
                payload: item.payload,
                createdAt: Date.now(),
                retryCount: 0,
                maxRetries: DEFAULT_MAX_RETRIES,
                nextRetryAt: 0,
              });
              changed = true;
            }
          }
        });
      }
    } catch {
      // Ignore corrupted legacy payload
    }
    localStorage.removeItem(`${LEGACY_SYNC_PREFIX}${userId}`);
  }

  // 2. Migrate legacy attemptBuffer (lumina.attempt-queue.v2.${userId})
  if (legacyAttemptRaw) {
    try {
      const parsed = JSON.parse(legacyAttemptRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const batchId = `migrated-attempt-batch-${Date.now()}`;
        nextJobs.push({
          id: batchId,
          kind: 'batch_review_attempts',
          revision: crypto.randomUUID(),
          userId,
          payload: parsed,
          createdAt: Date.now(),
          retryCount: 0,
          maxRetries: DEFAULT_MAX_RETRIES,
          nextRetryAt: 0,
        });
        changed = true;
      }
    } catch {
      // Ignore corrupted legacy attempt payload
    }
    localStorage.removeItem(`${LEGACY_ATTEMPT_PREFIX}${userId}`);
  }

  if (changed) {
    writeLocal(unifiedKey(userId), nextJobs);
    window.dispatchEvent(new Event('lumina:sync-change'));
  }
}

export function registerSyncHandler(kind: string, handler: SyncHandler) {
  handlers.set(kind, handler);
}

export function pendingJobs(userId: string): UnifiedSyncJob[] {
  migrateLegacyStorageIfPresent(userId);
  const items = readLocal<UnifiedSyncJob[]>(unifiedKey(userId));
  return Array.isArray(items) ? items.filter((job) => job?.id && job.kind && job.revision) : [];
}

export function deadLetterJobs(userId: string): DeadLetterJob[] {
  const items = readLocal<DeadLetterJob[]>(deadLetterKey(userId));
  return Array.isArray(items) ? items.filter((job) => job?.id && job.kind && job.revision) : [];
}

function writePendingJobs(userId: string, jobs: UnifiedSyncJob[]) {
  writeLocal(unifiedKey(userId), jobs);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lumina:sync-change'));
  }
}

function writeDeadLetterJobs(userId: string, jobs: DeadLetterJob[]) {
  writeLocal(deadLetterKey(userId), jobs);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lumina:sync-change'));
    window.dispatchEvent(new Event('lumina:sync-dead-letter'));
  }
}

export function moveToDeadLetter(userId: string, job: UnifiedSyncJob, fatalReason: string): DeadLetterJob {
  const existing = deadLetterJobs(userId);
  const deadLetterItem: DeadLetterJob = {
    ...job,
    deadLetteredAt: Date.now(),
    fatalReason,
  };
  const filtered = existing.filter((item) => item.id !== job.id);
  writeDeadLetterJobs(userId, [...filtered, deadLetterItem]);

  console.warn(
    `[OfflineSyncManager] Poison pill job moved to Dead Letter Queue [${job.id}, kind: ${job.kind}]: ${fatalReason}`,
  );
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lumina:sync-poison-pill', { detail: deadLetterItem }));
  }
  return deadLetterItem;
}

export function clearDeadLetters(userId: string) {
  writeDeadLetterJobs(userId, []);
}

export function retryDeadLetters(userId: string) {
  const deadList = deadLetterJobs(userId);
  if (deadList.length === 0) return;

  const current = pendingJobs(userId);
  const restoredJobs: UnifiedSyncJob[] = deadList.map((item) => ({
    id: item.id,
    kind: item.kind,
    revision: crypto.randomUUID(),
    userId: item.userId,
    payload: item.payload,
    createdAt: item.createdAt,
    retryCount: 0,
    maxRetries: item.maxRetries || DEFAULT_MAX_RETRIES,
    nextRetryAt: 0,
  }));

  const existingIds = new Set(restoredJobs.map((j) => j.id));
  const merged = [...current.filter((j) => !existingIds.has(j.id)), ...restoredJobs];
  writePendingJobs(userId, merged);
  clearDeadLetters(userId);

  void flushSyncQueue(userId);
}

export interface EnqueueSyncOptions {
  maxRetries?: number;
}

export function enqueueSync<T = unknown>(
  userId: string,
  id: string,
  kind: string,
  payload: T,
  options?: EnqueueSyncOptions,
): UnifiedSyncJob<T> {
  migrateLegacyStorageIfPresent(userId);
  const job: UnifiedSyncJob<T> = {
    id,
    kind,
    payload,
    revision: crypto.randomUUID(),
    userId,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    nextRetryAt: 0,
  };

  const queue = pendingJobs(userId).filter((item) => item.id !== id);
  writePendingJobs(userId, [...queue, job]);
  return job;
}

export interface FlushOptions {
  ignoreBackoff?: boolean;
}

export function flushSyncQueue(userId: string, options?: FlushOptions): Promise<void> {
  migrateLegacyStorageIfPresent(userId);
  if (activeFlushes.has(userId)) {
    return activeFlushes.get(userId)!;
  }

  const ignoreBackoff = options?.ignoreBackoff ?? true;

  const run = (async () => {
    while (navigator.onLine !== false) {
      const now = Date.now();
      const allJobs = pendingJobs(userId);
      // Find the first job that has a registered handler and is eligible to run
      const executableJob = allJobs.find(
        (item) => handlers.has(item.kind) && (ignoreBackoff || item.nextRetryAt <= now),
      );

      if (!executableJob) {
        // If there are registered jobs waiting on backoff timer, schedule wakeup
        const waitingJob = allJobs
          .filter((item) => handlers.has(item.kind) && item.nextRetryAt > now)
          .sort((a, b) => a.nextRetryAt - b.nextRetryAt)[0];

        if (waitingJob && typeof window !== 'undefined') {
          const delay = Math.max(100, waitingJob.nextRetryAt - now);
          if (backoffTimers.has(userId)) clearTimeout(backoffTimers.get(userId)!);
          const timer = setTimeout(() => {
            backoffTimers.delete(userId);
            void flushSyncQueue(userId, { ignoreBackoff: false });
          }, delay);
          backoffTimers.set(userId, timer);
        }
        return;
      }

      const handler = handlers.get(executableJob.kind)!;
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== userId) return;

      try {
        await handler(executableJob.payload, userId);

        // Success: remove from pending queue
        const remaining = pendingJobs(userId).filter((item) => item.revision !== executableJob.revision);
        writePendingJobs(userId, remaining);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const status = extractErrorStatus(err);
        const transient = isTransientError(err);
        const reachedMaxRetries = executableJob.retryCount + 1 >= executableJob.maxRetries;

        if (!transient || reachedMaxRetries) {
          // Non-transient poison pill OR retry limit exhausted -> isolate to dead letter queue
          const fatalReason = !transient
            ? `Non-transient client error (HTTP ${status ?? 'unknown'}): ${errorMsg}`
            : `Exceeded max retry attempts (${executableJob.maxRetries}): ${errorMsg}`;

          moveToDeadLetter(userId, executableJob, fatalReason);

          // Remove the poison pill from pending queue to UNBLOCK subsequent jobs!
          const remaining = pendingJobs(userId).filter((item) => item.revision !== executableJob.revision);
          writePendingJobs(userId, remaining);

          // Continue loop to process remaining jobs in queue!
          continue;
        } else {
          // Transient error: increment retry count and apply exponential backoff
          const nextRetryCount = executableJob.retryCount + 1;
          const backoffDelay = calculateBackoffDelayMs(nextRetryCount);
          const errorDetails: SyncJobError = {
            status,
            message: errorMsg,
            timestamp: Date.now(),
          };

          const updatedJob: UnifiedSyncJob = {
            ...executableJob,
            retryCount: nextRetryCount,
            nextRetryAt: Date.now() + backoffDelay,
            lastError: errorDetails,
          };

          const updatedQueue = pendingJobs(userId).map((item) =>
            item.revision === executableJob.revision ? updatedJob : item,
          );
          writePendingJobs(userId, updatedQueue);

          // Schedule auto-retry timer
          if (typeof window !== 'undefined') {
            if (backoffTimers.has(userId)) clearTimeout(backoffTimers.get(userId)!);
            const timer = setTimeout(() => {
              backoffTimers.delete(userId);
              void flushSyncQueue(userId, { ignoreBackoff: false });
            }, backoffDelay);
            backoffTimers.set(userId, timer);
          }

          // Transient error halts immediate draining until backoff timer or online event fires
          return;
        }
      }
    }
  })().finally(() => {
    activeFlushes.delete(userId);
  });

  activeFlushes.set(userId, run);
  return run;
}
