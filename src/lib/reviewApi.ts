import { ReviewAttemptResponse, ReviewAttemptSource, ReviewWord } from '../types';
import { apiFetch } from './api';

interface ReviewApiEnvelope<T> {
  data: T;
  error?: string;
}

interface SubmitReviewAttemptInput {
  vocabularyItemId: string;
  learningGroupId?: string | null;
  source: ReviewAttemptSource;
  wasCorrect: boolean;
  elapsedMs: number;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  return (payload as ReviewApiEnvelope<T>).data;
}

export async function fetchDueReviewWords(): Promise<ReviewWord[]> {
  const response = await apiFetch('/api/review/due');
  return parseResponse<ReviewWord[]>(response);
}

export async function submitReviewAttempt(input: SubmitReviewAttemptInput): Promise<ReviewAttemptResponse> {
  const response = await apiFetch('/api/review/attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return parseResponse<ReviewAttemptResponse>(response);
}

export async function submitBatchReviewAttempts(attempts: SubmitReviewAttemptInput[]): Promise<ReviewAttemptResponse[]> {
  const response = await apiFetch('/api/review/batch-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempts }),
  });

  return parseResponse<ReviewAttemptResponse[]>(response);
}
