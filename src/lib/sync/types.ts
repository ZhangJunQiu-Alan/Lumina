export type SyncJobKind =
  | 'batch_review_attempts'
  | 'word-progress'
  | 'learning-session'
  | 'session-clear'
  | 'routine-completed'
  | 'ielts-attempt'
  | (string & {});

export interface SyncJobError {
  status?: number;
  message: string;
  timestamp: number;
}

export interface UnifiedSyncJob<T = unknown> {
  id: string;
  kind: SyncJobKind;
  revision: string;
  userId: string;
  payload: T;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: number;
  lastError?: SyncJobError;
}

export interface DeadLetterJob<T = unknown> extends UnifiedSyncJob<T> {
  deadLetteredAt: number;
  fatalReason: string;
}

export type SyncHandler<T = unknown> = (payload: T, userId: string) => Promise<unknown>;
