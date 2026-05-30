import { supabaseAdmin } from './supabase.ts';

type IeltsAttemptKind = 'reading' | 'listening';

export interface IeltsAttemptResponseInput {
  questionId: string;
  questionNumber: number;
  response: string[];
  correctAnswer: string[];
  isCorrect: boolean;
}

export interface SubmitIeltsAttemptInput {
  userId: string;
  testId: string;
  startedAt: string;
  submittedAt: string;
  elapsedSeconds: number;
  score: number;
  totalQuestions: number;
  responses: IeltsAttemptResponseInput[];
}

export interface SubmittedIeltsAttempt {
  id: string;
  submittedAt: string;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (typeof item === 'string' || typeof item === 'number') return [String(item)];
      return [];
    })
    .filter(Boolean);
}

function normalizeResponses(value: unknown): IeltsAttemptResponseInput[] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};

    return {
      questionId: typeof record.questionId === 'string' ? record.questionId : '',
      questionNumber: Number(record.questionNumber) || 0,
      response: normalizeStringArray(record.response),
      correctAnswer: normalizeStringArray(record.correctAnswer),
      isCorrect: record.isCorrect === true,
    };
  });
}

function normalizeAttemptInput(userId: string, body: unknown): SubmitIeltsAttemptInput {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  return {
    userId,
    testId: typeof record.testId === 'string' ? record.testId : '',
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
    submittedAt: typeof record.submittedAt === 'string' ? record.submittedAt : new Date().toISOString(),
    elapsedSeconds: Math.max(0, Math.floor(Number(record.elapsedSeconds) || 0)),
    score: Math.max(0, Math.floor(Number(record.score) || 0)),
    totalQuestions: Math.max(0, Math.floor(Number(record.totalQuestions) || 0)),
    responses: normalizeResponses(record.responses),
  };
}

function assertAttemptInput(input: SubmitIeltsAttemptInput) {
  if (!input.userId) throw new Error('Missing user ID');
  if (!input.testId) throw new Error('Missing test ID');
  if (!input.startedAt) throw new Error('Missing startedAt');
  if (!input.submittedAt) throw new Error('Missing submittedAt');
  if (!Array.isArray(input.responses)) throw new Error('Missing responses array');
}

async function submitIeltsAttempt(
  kind: IeltsAttemptKind,
  input: SubmitIeltsAttemptInput,
): Promise<SubmittedIeltsAttempt> {
  assertAttemptInput(input);

  const rpcName = kind === 'reading' ? 'submit_ielts_reading_attempt' : 'submit_ielts_listening_attempt';

  const { data, error } = await supabaseAdmin.rpc(rpcName, {
    p_user_id: input.userId,
    p_test_id: input.testId,
    p_started_at: input.startedAt,
    p_submitted_at: input.submittedAt,
    p_elapsed_seconds: input.elapsedSeconds,
    p_score: input.score,
    p_total_questions: input.totalQuestions,
    p_responses: input.responses,
  });

  if (error || typeof data !== 'string') {
    throw new Error(`${rpcName} failed: ${error?.message ?? 'missing attempt id'}`);
  }

  return {
    id: data,
    submittedAt: input.submittedAt,
  };
}

export async function submitIeltsReadingAttempt(userId: string, body: unknown) {
  return submitIeltsAttempt('reading', normalizeAttemptInput(userId, body));
}

export async function submitIeltsListeningAttempt(userId: string, body: unknown) {
  return submitIeltsAttempt('listening', normalizeAttemptInput(userId, body));
}
