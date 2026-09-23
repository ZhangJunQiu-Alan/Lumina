import {
  enqueueSync as internalEnqueueSync,
  flushSyncQueue as internalFlushSyncQueue,
  pendingJobs as internalPendingJobs,
  registerSyncHandler as internalRegisterSyncHandler,
} from './sync/OfflineSyncManager';
import type { UnifiedSyncJob } from './sync/types';

export type SyncJob = UnifiedSyncJob;

export function pendingJobs(userId: string): SyncJob[] {
  return internalPendingJobs(userId);
}

export function registerSyncHandler(kind: string, handler: (payload: unknown, userId: string) => Promise<unknown>) {
  internalRegisterSyncHandler(kind, handler);
}

export function enqueueSync(userId: string, id: string, kind: string, payload: unknown): SyncJob {
  return internalEnqueueSync(userId, id, kind, payload);
}

export function flushSyncQueue(userId: string): Promise<void> {
  return internalFlushSyncQueue(userId);
}
