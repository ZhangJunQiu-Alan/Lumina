import { apiFetch } from './api';
import { readLocal, writeLocal } from './durableStorage';
import { enqueueSync, flushSyncQueue, pendingJobs, registerSyncHandler } from './syncQueue';

export type IeltsKind = 'reading' | 'listening';
interface AttemptBody {
  testId: string;
  startedAt: string;
  submittedAt: string;
  elapsedSeconds: number;
  score: number;
  totalQuestions: number;
  responses: unknown[];
}
interface Receipt extends AttemptBody {
  id: string;
}
const jobId = (kind: IeltsKind, testId: string, startedAt: string) => `ielts:${kind}:${testId}:${startedAt}`;
const receiptKey = (userId: string, id: string) => `lumina.receipt.v1.${userId}.${id}`;

export function ieltsSubmissionState(userId: string, kind: IeltsKind, testId: string, startedAt: string) {
  const id = jobId(kind, testId, startedAt);
  return {
    pending: pendingJobs(userId).some((job) => job.id === id),
    receipt: readLocal<Receipt>(receiptKey(userId, id)),
  };
}

registerSyncHandler('ielts-attempt', async (payload, userId) => {
  const { kind, body } = payload as { kind: IeltsKind; body: AttemptBody };
  const response = await apiFetch(`/api/ielts/${kind}/attempts`, {
    method: 'POST',
    userId,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.data?.id) throw new Error(result.error || '考试记录同步失败');
  writeLocal(receiptKey(userId, jobId(kind, body.testId, body.startedAt)), { ...body, ...result.data });
});

export async function submitDurableIeltsAttempt(userId: string, kind: IeltsKind, body: AttemptBody): Promise<Receipt> {
  const state = ieltsSubmissionState(userId, kind, body.testId, body.startedAt);
  if (state.receipt) return state.receipt;
  if (!state.pending) enqueueSync(userId, jobId(kind, body.testId, body.startedAt), 'ielts-attempt', { kind, body });
  await flushSyncQueue(userId);
  const receipt = ieltsSubmissionState(userId, kind, body.testId, body.startedAt).receipt;
  if (!receipt) throw new Error('答卷已保存在本机，等待联网后自动提交。请勿卸载应用或清除数据。');
  return receipt;
}
