import type {
  LearningRoundType,
  RoutineCardState,
  RoutineStepKey,
} from '../types';
import { supabase } from './supabase';

type RoutineDayKind = 'review_day' | 'learning_day';

interface DailyRoutineProgressRow {
  id: string;
  user_id: string;
  local_date: string;
  timezone: string | null;
  day_kind: RoutineDayKind | null;
  starting_due_count: number | null;
  main_learning_group_id: string | null;
  step_order_json: unknown;
  completed_steps_json: unknown;
  status: RoutineCardState | null;
  created_at: string;
  updated_at: string;
}

const DAILY_ROUTINE_SELECT = `
  id,
  user_id,
  local_date,
  timezone,
  day_kind,
  starting_due_count,
  main_learning_group_id,
  step_order_json,
  completed_steps_json,
  status,
  created_at,
  updated_at
`;

const REVIEW_DAY_THRESHOLD = 50;
const ROUTINE_STEPS: RoutineStepKey[] = ['review', 'round1', 'round2', 'round3', 'article'];

function isRoutineStepKey(value: unknown): value is RoutineStepKey {
  return typeof value === 'string' && ROUTINE_STEPS.includes(value as RoutineStepKey);
}

function isMissingDailyRoutineTableError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('daily_routine_progress');
}

function isUniqueViolationError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '23505' || (error?.message ?? '').includes('duplicate key');
}

function normalizeRoutineSteps(value: unknown): RoutineStepKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRoutineStepKey);
}

function buildStepOrder(startingDueCount: number): RoutineStepKey[] {
  if (startingDueCount > REVIEW_DAY_THRESHOLD) {
    return ['review'];
  }

  if (startingDueCount > 0) {
    return ['review', 'round1', 'round2', 'round3', 'article'];
  }

  return ['round1', 'round2', 'round3', 'article'];
}

function resolveDayKind(startingDueCount: number): RoutineDayKind {
  return startingDueCount > REVIEW_DAY_THRESHOLD ? 'review_day' : 'learning_day';
}

function inferCompletedLearningSteps(round: LearningRoundType): RoutineStepKey[] {
  switch (round) {
    case 'round1':
      return [];
    case 'round2':
      return ['round1'];
    case 'round3':
      return ['round1', 'round2'];
    case 'article':
      return ['round1', 'round2', 'round3'];
    default:
      return [];
  }
}

function mergeCompletedSteps(
  stepOrder: RoutineStepKey[],
  ...stepLists: RoutineStepKey[][]
) {
  const allowedSteps = new Set(stepOrder);
  const seen = new Set<RoutineStepKey>();
  const merged: RoutineStepKey[] = [];

  for (const step of stepOrder) {
    if (!allowedSteps.has(step)) continue;

    for (const list of stepLists) {
      if (list.includes(step) && !seen.has(step)) {
        seen.add(step);
        merged.push(step);
      }
    }
  }

  return merged;
}

function resolveRoutineStatus(
  stepOrder: RoutineStepKey[],
  completedSteps: RoutineStepKey[],
  boundGroupId: string | null,
): RoutineCardState {
  if (stepOrder.length > 0 && stepOrder.every((step) => completedSteps.includes(step))) {
    return 'completed';
  }

  if (completedSteps.length > 0 || boundGroupId) {
    return 'in_progress';
  }

  return 'not_started';
}

function resolveTimeZone(timeZone?: string) {
  if (!timeZone) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function resolveRoutineLocalDate(timeZone = resolveTimeZone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

async function fetchDailyRoutineProgress(
  userId: string,
  localDate: string,
): Promise<DailyRoutineProgressRow | null> {
  const result = await supabase
    .from('daily_routine_progress')
    .select(DAILY_ROUTINE_SELECT)
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();

  if (result.error) {
    if (isMissingDailyRoutineTableError(result.error)) {
      return null;
    }

    throw new Error(`daily_routine_progress lookup failed: ${result.error.message}`);
  }

  return (result.data as DailyRoutineProgressRow | null) ?? null;
}

async function countCurrentDueWords(userId: string) {
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from('review_states')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .neq('memory_state', 'mastered')
    .not('next_review_at', 'is', null)
    .lte('next_review_at', nowIso);

  if (result.error) {
    throw new Error(`review_states due count failed: ${result.error.message}`);
  }

  return result.count ?? 0;
}

async function insertDailyRoutineProgress(
  userId: string,
  localDate: string,
  timeZone: string,
  startingDueCount: number,
) {
  const timestamp = new Date().toISOString();
  const result = await supabase
    .from('daily_routine_progress')
    .insert({
      user_id: userId,
      local_date: localDate,
      timezone: timeZone,
      day_kind: resolveDayKind(startingDueCount),
      starting_due_count: startingDueCount,
      step_order_json: buildStepOrder(startingDueCount),
      completed_steps_json: [],
      status: 'not_started',
      updated_at: timestamp,
    })
    .select(DAILY_ROUTINE_SELECT)
    .maybeSingle();

  if (result.error) {
    if (isMissingDailyRoutineTableError(result.error)) {
      return null;
    }

    if (isUniqueViolationError(result.error)) {
      return fetchDailyRoutineProgress(userId, localDate);
    }

    throw new Error(`daily_routine_progress insert failed: ${result.error.message}`);
  }

  return (result.data as DailyRoutineProgressRow | null) ?? null;
}

async function updateDailyRoutineProgress(
  rowId: string,
  payload: Partial<DailyRoutineProgressRow>,
) {
  const result = await supabase
    .from('daily_routine_progress')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
    .select(DAILY_ROUTINE_SELECT)
    .maybeSingle();

  if (result.error) {
    if (isMissingDailyRoutineTableError(result.error)) {
      return null;
    }

    throw new Error(`daily_routine_progress update failed: ${result.error.message}`);
  }

  return (result.data as DailyRoutineProgressRow | null) ?? null;
}

export async function ensureTodayRoutineProgress(
  userId: string,
  options: {
    timeZone?: string;
    startingDueCount?: number;
  } = {},
) {
  const timeZone = resolveTimeZone(options.timeZone);
  const localDate = resolveRoutineLocalDate(timeZone);
  const existing = await fetchDailyRoutineProgress(userId, localDate);

  if (existing) {
    return existing;
  }

  const startingDueCount = options.startingDueCount ?? await countCurrentDueWords(userId);
  return insertDailyRoutineProgress(userId, localDate, timeZone, startingDueCount);
}

export async function markRoutineReviewStarted(
  userId: string,
  options: {
    timeZone?: string;
    startingDueCount?: number;
  } = {},
) {
  const existing = await ensureTodayRoutineProgress(userId, options);
  if (!existing) return null;

  const stepOrder = normalizeRoutineSteps(existing.step_order_json);
  if (!stepOrder.includes('review') || existing.status === 'completed' || existing.status === 'in_progress') {
    return existing;
  }

  return updateDailyRoutineProgress(existing.id, { status: 'in_progress' });
}

export async function bindRoutineMainLearningGroup(
  userId: string,
  input: {
    groupId: string;
    round: LearningRoundType;
    timeZone?: string;
    startingDueCount?: number;
  },
) {
  const existing = await ensureTodayRoutineProgress(userId, {
    timeZone: input.timeZone,
    startingDueCount: input.startingDueCount,
  });
  if (!existing) return null;

  const stepOrder = normalizeRoutineSteps(existing.step_order_json);
  if (stepOrder.length === 1 && stepOrder[0] === 'review') {
    return existing;
  }

  if (existing.main_learning_group_id && existing.main_learning_group_id !== input.groupId) {
    return existing;
  }

  const mergedCompletedSteps = mergeCompletedSteps(
    stepOrder,
    normalizeRoutineSteps(existing.completed_steps_json),
    inferCompletedLearningSteps(input.round),
  );
  const nextStatus = resolveRoutineStatus(stepOrder, mergedCompletedSteps, input.groupId);
  const hasSameCompletedSteps = mergedCompletedSteps.length === normalizeRoutineSteps(existing.completed_steps_json).length
    && mergedCompletedSteps.every((step, index) => step === normalizeRoutineSteps(existing.completed_steps_json)[index]);

  if (
    existing.main_learning_group_id === input.groupId
    && hasSameCompletedSteps
    && existing.status === nextStatus
  ) {
    return existing;
  }

  return updateDailyRoutineProgress(existing.id, {
    main_learning_group_id: input.groupId,
    completed_steps_json: mergedCompletedSteps,
    status: nextStatus,
  });
}

export async function markRoutineStepCompleted(
  userId: string,
  input: {
    step: RoutineStepKey;
    groupId?: string | null;
    timeZone?: string;
    startingDueCount?: number;
  },
) {
  const existing = await ensureTodayRoutineProgress(userId, {
    timeZone: input.timeZone,
    startingDueCount: input.startingDueCount,
  });
  if (!existing) return null;

  const stepOrder = normalizeRoutineSteps(existing.step_order_json);
  if (!stepOrder.includes(input.step)) {
    return existing;
  }

  if (input.step !== 'review') {
    if (!existing.main_learning_group_id && !input.groupId) {
      return existing;
    }

    if (existing.main_learning_group_id && input.groupId && existing.main_learning_group_id !== input.groupId) {
      return existing;
    }
  }

  const completedSteps = normalizeRoutineSteps(existing.completed_steps_json);
  const boundGroupId = input.step === 'review'
    ? existing.main_learning_group_id
    : existing.main_learning_group_id ?? input.groupId ?? null;
  const mergedCompletedSteps = mergeCompletedSteps(stepOrder, completedSteps, [input.step]);
  const nextStatus = resolveRoutineStatus(stepOrder, mergedCompletedSteps, boundGroupId);
  const hasSameCompletedSteps = mergedCompletedSteps.length === completedSteps.length
    && mergedCompletedSteps.every((step, index) => step === completedSteps[index]);

  if (
    hasSameCompletedSteps
    && existing.status === nextStatus
    && existing.main_learning_group_id === boundGroupId
  ) {
    return existing;
  }

  return updateDailyRoutineProgress(existing.id, {
    completed_steps_json: mergedCompletedSteps,
    main_learning_group_id: boundGroupId,
    status: nextStatus,
  });
}
