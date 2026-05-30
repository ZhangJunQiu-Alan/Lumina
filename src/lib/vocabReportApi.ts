import { apiFetch } from './api';

export type VocabularyIssueType = 'definition' | 'example' | 'pronunciation' | 'other';

export interface ReportVocabularyIssueInput {
  vocabularyItemId: string;
  wordSnapshot?: string | null;
  learningGroupId?: string | null;
  sessionRound?: string | null;
  issueType: VocabularyIssueType;
  note?: string | null;
  routePath?: string | null;
  userAgent?: string | null;
}

export interface ReportVocabularyIssueResult {
  id: string;
  status: string;
  createdAt: string;
}

interface VocabReportEnvelope<T> {
  data: T;
  error?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `HTTP ${response.status}`);
  }

  return (payload as VocabReportEnvelope<T>).data;
}

export async function reportVocabularyIssue(input: ReportVocabularyIssueInput): Promise<ReportVocabularyIssueResult> {
  const response = await apiFetch('/api/vocab/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return parseResponse<ReportVocabularyIssueResult>(response);
}
