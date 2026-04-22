import { supabaseAdmin } from './supabase.js';

type OrbitDayStatus = 'gap' | 'ordinary' | 'perfect' | 'shielded';
type LearningRoundType = 'round1' | 'round2' | 'round3' | 'article';
type RoutineStepKey = 'review' | 'round1' | 'round2' | 'round3' | 'article';
type RoutineCardState = 'not_started' | 'in_progress' | 'completed';
type RoutineVisibleStepStatus = 'completed' | 'current' | 'upcoming';
type RoutineCardCtaMode =
  | 'start_review'
  | 'continue_review'
  | 'start_learning'
  | 'continue_learning'
  | 'open_library';

interface ResumeCandidatePayload {
  groupId: string;
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
  lastActiveAt: string;
  libraryId: null;
  article: null;
  groupTitle: string;
  createdAt: string;
  queueLength: number;
}

interface OrbitDayPayload {
  date: string;
  weekdayLabel: string;
  shortDateLabel: string;
  status: OrbitDayStatus;
  reviewWordCount: number;
  learnedWordCount: number;
}

interface RoutineVisibleStepPayload {
  key: RoutineStepKey;
  label: string;
  status: RoutineVisibleStepStatus;
}

interface RoutineCardPayload {
  state: RoutineCardState;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaMode: RoutineCardCtaMode;
  boundLearningGroupId: string | null;
  visibleSteps: RoutineVisibleStepPayload[];
}

export interface HomeOverviewPayload {
  todayReviewCount: number;
  streak: number;
  perfectCheckinDays: number;
  totalLearned: number;
  orbitDays: OrbitDayPayload[];
  selectedDate: string;
  selectedDayReviewWordCount: number;
  selectedDayLearnedWordCount: number;
  resumeCandidate: ResumeCandidatePayload | null;
  routineCard: RoutineCardPayload;
}

interface ReviewEventRow {
  id: string;
  vocabulary_item_id: string;
  source: 'round2' | 'review' | null;
  next_state: string | null;
  next_review_at: string | null;
  created_at: string;
}

interface LearningGroupRow {
  id: string;
  group_name: string | null;
  source_type: 'custom' | 'system' | null;
  library_id: string | null;
  status: 'active' | 'completed' | null;
  created_at: string;
  completed_at: string | null;
  session_round: string | null;
  session_current_index: number | null;
  session_queue_word_ids: unknown;
  session_last_active_at: string | null;
}

interface LearningGroupWordRow {
  learning_group_id: string;
}

interface StreakProtectionEventRow {
  protected_date: string;
}

interface DailyRoutineProgressRow {
  id: string;
  local_date: string;
  timezone: string | null;
  day_kind: 'review_day' | 'learning_day' | null;
  starting_due_count: number | null;
  main_learning_group_id: string | null;
  step_order_json: unknown;
  completed_steps_json: unknown;
  status: RoutineCardState | null;
}

interface ReconstructedWordState {
  memoryState: string;
  nextReviewAt: string | null;
}

interface DailySummary {
  reviewWordCount: number;
  learnedWordCount: number;
  status: OrbitDayStatus;
}

const PAGE_SIZE = 1000;
const GROUP_ID_CHUNK_SIZE = 200;
const LEARNING_ROUNDS = new Set<LearningRoundType>(['round1', 'round2', 'round3', 'article']);
const ROUTINE_STEPS: RoutineStepKey[] = ['review', 'round1', 'round2', 'round3', 'article'];
const ROUTINE_STEP_LABELS: Record<RoutineStepKey, string> = {
  review: 'Round 0 · 到期复习',
  round1: 'Round 1 · 明示关联',
  round2: 'Round 2 · 语境复现',
  round3: 'Round 3 · 先判断，再确认',
  article: '阅读 · 文章巩固',
};
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const key = `${locale}:${timeZone}:${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  formatterCache.set(key, formatter);
  return formatter;
}

function normalizeTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return 'UTC';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function toDateKey(date: Date, timeZone: string) {
  const parts = getFormatter('en-CA', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function dateKeyFromIso(iso: string | null | undefined, timeZone: string) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return toDateKey(parsed, timeZone);
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map((value) => Number.parseInt(value, 10));
  return { year, month, day };
}

function toStableDate(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(dateKey: string, amount: number) {
  const date = toStableDate(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return toDateKey(date, 'UTC');
}

function buildDateRange(startDateKey: string, endDateKey: string) {
  const keys: string[] = [];
  for (let cursor = startDateKey; cursor <= endDateKey; cursor = addDays(cursor, 1)) {
    keys.push(cursor);
  }
  return keys;
}

function formatWeekdayLabel(dateKey: string, timeZone: string) {
  return getFormatter('zh-CN', timeZone, { weekday: 'short' }).format(toStableDate(dateKey));
}

function formatShortDateLabel(dateKey: string, timeZone: string) {
  const parts = getFormatter('en-US', timeZone, {
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(toStableDate(dateKey));

  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${month}.${day}`;
}

function normalizeSessionQueueWordIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function isLearningRoundType(value: unknown): value is LearningRoundType {
  return typeof value === 'string' && LEARNING_ROUNDS.has(value as LearningRoundType);
}

function resolveGroupTitle(groupName: string | null | undefined) {
  return groupName?.trim() || '这组词';
}

function buildResumeCandidate(row: LearningGroupRow): ResumeCandidatePayload | null {
  if (!isLearningRoundType(row.session_round)) return null;

  const queueWordIds = normalizeSessionQueueWordIds(row.session_queue_word_ids);
  const queueLength = queueWordIds.length;
  const maxIndex = queueLength > 0 ? queueLength - 1 : 0;
  const currentIndex = Number.isFinite(row.session_current_index)
    ? Math.min(Math.max(Math.round(row.session_current_index ?? 0), 0), maxIndex)
    : 0;

  return {
    groupId: row.id,
    round: row.session_round,
    currentIndex,
    queueWordIds,
    lastActiveAt: row.session_last_active_at ?? row.created_at,
    libraryId: null,
    article: null,
    groupTitle: resolveGroupTitle(row.group_name),
    createdAt: row.created_at,
    queueLength,
  };
}

function isDueForDay(state: ReconstructedWordState, dayKey: string, timeZone: string) {
  if (state.memoryState === 'mastered' || !state.nextReviewAt) {
    return false;
  }

  const dueDateKey = dateKeyFromIso(state.nextReviewAt, timeZone);
  return dueDateKey !== null && dueDateKey <= dayKey;
}

function countDueWords(states: Map<string, ReconstructedWordState>, dayKey: string, timeZone: string) {
  let count = 0;
  for (const state of states.values()) {
    if (isDueForDay(state, dayKey, timeZone)) {
      count += 1;
    }
  }
  return count;
}

function resolveDayStatus(input: {
  dueAtStartCount: number;
  dueAtEndCount: number;
  reviewWordCount: number;
  learnedWordCount: number;
  protectedByCard: boolean;
}): OrbitDayStatus {
  const {
    dueAtStartCount,
    dueAtEndCount,
    reviewWordCount,
    learnedWordCount,
    protectedByCard,
  } = input;

  const reviewCleared = dueAtEndCount === 0;
  const isReviewDay = dueAtStartCount > 50;
  const completedReviewRound = reviewCleared && (dueAtStartCount > 0 || reviewWordCount > 0);

  let status: OrbitDayStatus = 'gap';

  if (isReviewDay) {
    status = reviewCleared ? 'perfect' : 'gap';
  } else if (reviewCleared && learnedWordCount > 0) {
    status = 'perfect';
  } else if (completedReviewRound) {
    status = 'ordinary';
  }

  if (status === 'gap' && protectedByCard) {
    return 'shielded';
  }

  return status;
}

function isRoutineStepKey(value: unknown): value is RoutineStepKey {
  return typeof value === 'string' && ROUTINE_STEPS.includes(value as RoutineStepKey);
}

function normalizeRoutineSteps(value: unknown): RoutineStepKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRoutineStepKey);
}

function buildRoutineStepOrder(startingDueCount: number) {
  if (startingDueCount > 50) {
    return ['review'] as RoutineStepKey[];
  }

  if (startingDueCount > 0) {
    return ['review', 'round1', 'round2', 'round3', 'article'] as RoutineStepKey[];
  }

  return ['round1', 'round2', 'round3', 'article'] as RoutineStepKey[];
}

function inferCompletedLearningSteps(
  source: Pick<LearningGroupRow, 'status' | 'completed_at' | 'session_round'> | ResumeCandidatePayload | null | undefined,
) {
  if (!source) return [];

  if ('completed_at' in source && (source.completed_at || source.status === 'completed')) {
    return ['round1', 'round2', 'round3', 'article'] as RoutineStepKey[];
  }

  const currentRound = 'round' in source ? source.round : source.session_round;

  switch (currentRound) {
    case 'round2':
      return ['round1'] as RoutineStepKey[];
    case 'round3':
      return ['round1', 'round2'] as RoutineStepKey[];
    case 'article':
      return ['round1', 'round2', 'round3'] as RoutineStepKey[];
    default:
      return [];
  }
}

function mergeRoutineSteps(stepOrder: RoutineStepKey[], ...stepLists: RoutineStepKey[][]) {
  const merged: RoutineStepKey[] = [];
  const seen = new Set<RoutineStepKey>();

  for (const step of stepOrder) {
    for (const list of stepLists) {
      if (list.includes(step) && !seen.has(step)) {
        seen.add(step);
        merged.push(step);
      }
    }
  }

  return merged;
}

function resolveRoutineCardState(
  stepOrder: RoutineStepKey[],
  completedSteps: RoutineStepKey[],
  boundLearningGroupId: string | null,
  sourceStatus: RoutineCardState | null | undefined,
): RoutineCardState {
  if (stepOrder.length > 0 && stepOrder.every((step) => completedSteps.includes(step))) {
    return 'completed';
  }

  if (sourceStatus === 'in_progress' || completedSteps.length > 0 || boundLearningGroupId) {
    return 'in_progress';
  }

  return 'not_started';
}

function buildVisibleRoutineSteps(stepOrder: RoutineStepKey[], completedSteps: RoutineStepKey[]) {
  if (stepOrder.length === 0) {
    return [] as RoutineVisibleStepPayload[];
  }

  const completedSet = new Set(completedSteps);
  const firstIncompleteIndex = stepOrder.findIndex((step) => !completedSet.has(step));

  if (firstIncompleteIndex === -1) {
    const startIndex = Math.max(stepOrder.length - Math.min(2, stepOrder.length), 0);
    return stepOrder.slice(startIndex).map((step) => ({
      key: step,
      label: ROUTINE_STEP_LABELS[step],
      status: 'completed' as const,
    }));
  }

  const visibleCount = Math.min(2, stepOrder.length);
  const windowStart = stepOrder.length > 2
    ? Math.min(firstIncompleteIndex, stepOrder.length - visibleCount)
    : 0;
  const currentStep = stepOrder[firstIncompleteIndex];

  return stepOrder.slice(windowStart, windowStart + visibleCount).map((step) => ({
    key: step,
    label: ROUTINE_STEP_LABELS[step],
    status: (completedSet.has(step)
      ? 'completed'
      : step === currentStep
      ? 'current'
      : 'upcoming') as RoutineVisibleStepStatus,
  }));
}

function buildCompletedSubtitle(todaySummary: DailySummary | undefined) {
  if (!todaySummary) {
    return '今天的主线流程已经完成';
  }

  if (todaySummary.reviewWordCount === 0 && todaySummary.learnedWordCount === 0) {
    return '今天的主线流程已经完成';
  }

  return `今天已完成复习 ${todaySummary.reviewWordCount} 词 · 新学 ${todaySummary.learnedWordCount} 词`;
}

function buildRoutineCard(input: {
  todayReviewCount: number;
  todaySummary: DailySummary | undefined;
  resumeCandidate: ResumeCandidatePayload | null;
  routineProgress: DailyRoutineProgressRow | null;
  learningGroupsById: Map<string, LearningGroupRow>;
}) {
  const {
    todayReviewCount,
    todaySummary,
    resumeCandidate,
    routineProgress,
    learningGroupsById,
  } = input;

  const provisionalStepOrder = buildRoutineStepOrder(routineProgress?.starting_due_count ?? todayReviewCount);
  const stepOrder = routineProgress
    ? normalizeRoutineSteps(routineProgress.step_order_json).length > 0
      ? normalizeRoutineSteps(routineProgress.step_order_json)
      : provisionalStepOrder
    : provisionalStepOrder;

  const routineCompletedSteps = normalizeRoutineSteps(routineProgress?.completed_steps_json);
  const boundLearningGroupId = routineProgress?.main_learning_group_id ?? resumeCandidate?.groupId ?? null;
  const boundGroup = boundLearningGroupId ? learningGroupsById.get(boundLearningGroupId) ?? null : null;
  const inferredLearningSteps = boundGroup
    ? inferCompletedLearningSteps(boundGroup)
    : inferCompletedLearningSteps(resumeCandidate);
  const inferredReviewSteps = stepOrder.includes('review') && todayReviewCount === 0 ? (['review'] as RoutineStepKey[]) : [];
  const completedSteps = mergeRoutineSteps(
    stepOrder,
    routineCompletedSteps,
    inferredLearningSteps,
    inferredReviewSteps,
  );
  const state = resolveRoutineCardState(stepOrder, completedSteps, boundLearningGroupId, routineProgress?.status);
  const visibleSteps = buildVisibleRoutineSteps(stepOrder, completedSteps);
  const currentStep = visibleSteps.find((step) => step.status === 'current')?.key ?? null;
  const boundGroupTitle = boundGroup?.group_name?.trim() || resumeCandidate?.groupTitle || null;

  if (state === 'completed') {
    return {
      state,
      title: '今日已完成',
      subtitle: buildCompletedSubtitle(todaySummary),
      ctaLabel: '去词库看看',
      ctaMode: 'open_library',
      boundLearningGroupId,
      visibleSteps,
    } satisfies RoutineCardPayload;
  }

  if (currentStep === 'review') {
    return {
      state,
      title: '清理今日到期内容',
      subtitle: todayReviewCount > 0 ? `待复习：${todayReviewCount} 个单词` : '先完成今天的复习轮',
      ctaLabel: state === 'not_started' ? '开始复习' : '继续复习',
      ctaMode: state === 'not_started' ? 'start_review' : 'continue_review',
      boundLearningGroupId,
      visibleSteps,
    } satisfies RoutineCardPayload;
  }

  if (boundGroupTitle) {
    return {
      state,
      title: '接续上一次的专注',
      subtitle: `${boundGroupTitle} · ${ROUTINE_STEP_LABELS[currentStep ?? 'round1']}`,
      ctaLabel: '继续学习',
      ctaMode: 'continue_learning',
      boundLearningGroupId,
      visibleSteps,
    } satisfies RoutineCardPayload;
  }

  const reviewAlreadyDone = completedSteps.includes('review');

  return {
    state,
    title: '开始新的学习旅程',
    subtitle: reviewAlreadyDone ? '复习已完成，继续今天的新组学习' : '从 Round 1 开始今天的主线任务',
    ctaLabel: '开始学习',
    ctaMode: 'start_learning',
    boundLearningGroupId,
    visibleSteps,
  } satisfies RoutineCardPayload;
}

async function fetchReviewEvents(userId: string) {
  const rows: ReviewEventRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('review_events')
      .select('id, vocabulary_item_id, source, next_state, next_review_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`review_events lookup failed: ${error.message}`);
    }

    const page = (data ?? []) as ReviewEventRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchLearningGroups(userId: string) {
  const rows: LearningGroupRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('learning_groups')
      .select(`
        id,
        group_name,
        source_type,
        library_id,
        status,
        created_at,
        completed_at,
        session_round,
        session_current_index,
        session_queue_word_ids,
        session_last_active_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`learning_groups lookup failed: ${error.message}`);
    }

    const page = (data ?? []) as LearningGroupRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

async function fetchLearningGroupWordCounts(groupIds: string[]) {
  const counts = new Map<string, number>();

  for (const groupId of groupIds) {
    counts.set(groupId, 0);
  }

  for (let offset = 0; offset < groupIds.length; offset += GROUP_ID_CHUNK_SIZE) {
    const chunk = groupIds.slice(offset, offset + GROUP_ID_CHUNK_SIZE);

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from('learning_group_words')
        .select('learning_group_id')
        .in('learning_group_id', chunk)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`learning_group_words lookup failed: ${error.message}`);
      }

      const page = (data ?? []) as LearningGroupWordRow[];
      for (const row of page) {
        counts.set(row.learning_group_id, (counts.get(row.learning_group_id) ?? 0) + 1);
      }

      if (page.length < PAGE_SIZE) {
        break;
      }
    }
  }

  return counts;
}

async function fetchStreakProtectionEvents(userId: string) {
  const rows: StreakProtectionEventRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('streak_protection_events')
      .select('protected_date')
      .eq('user_id', userId)
      .order('protected_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`streak_protection_events lookup failed: ${error.message}`);
    }

    const page = (data ?? []) as StreakProtectionEventRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

function isMissingDailyRoutineProgressError(error: { message?: string } | null | undefined) {
  return (error?.message ?? '').includes('daily_routine_progress');
}

async function fetchDailyRoutineProgress(userId: string, localDate: string) {
  const result = await supabaseAdmin
    .from('daily_routine_progress')
    .select(`
      id,
      local_date,
      timezone,
      day_kind,
      starting_due_count,
      main_learning_group_id,
      step_order_json,
      completed_steps_json,
      status
    `)
    .eq('user_id', userId)
    .eq('local_date', localDate)
    .maybeSingle();

  if (result.error) {
    if (isMissingDailyRoutineProgressError(result.error)) {
      return null;
    }

    throw new Error(`daily_routine_progress lookup failed: ${result.error.message}`);
  }

  return (result.data as DailyRoutineProgressRow | null) ?? null;
}

export async function getHomeOverview(userId: string, requestedTimeZone: string | null | undefined) {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const nowIso = new Date().toISOString();
  const todayKey = toDateKey(new Date(), timeZone);

  const [
    reviewEvents,
    learningGroups,
    protectionEvents,
    routineProgress,
    masteredCountResult,
    dueCountResult,
  ] = await Promise.all([
    fetchReviewEvents(userId),
    fetchLearningGroups(userId),
    fetchStreakProtectionEvents(userId),
    fetchDailyRoutineProgress(userId, todayKey),
    supabaseAdmin
      .from('review_states')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('memory_state', 'mastered'),
    supabaseAdmin
      .from('review_states')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('memory_state', 'mastered')
      .not('next_review_at', 'is', null)
      .lte('next_review_at', nowIso),
  ]);

  if (masteredCountResult.error) {
    throw new Error(`review_states mastered count failed: ${masteredCountResult.error.message}`);
  }
  if (dueCountResult.error) {
    throw new Error(`review_states due count failed: ${dueCountResult.error.message}`);
  }

  const completedGroups = learningGroups.filter((group) => Boolean(group.completed_at));
  const completedGroupIds = completedGroups.map((group) => group.id);
  const groupWordCounts = completedGroupIds.length > 0
    ? await fetchLearningGroupWordCounts(completedGroupIds)
    : new Map<string, number>();
  const learningGroupsById = new Map(learningGroups.map((group) => [group.id, group]));
  const reviewWordIdsByDate = new Map<string, Set<string>>();
  const learnedWordCountByDate = new Map<string, number>();
  const protectedDates = new Set(
    protectionEvents
      .map((event) => event.protected_date)
      .filter((dateKey): dateKey is string => typeof dateKey === 'string' && dateKey.length > 0),
  );

  const relevantDateKeys = [todayKey];
  const eventsWithDateKey = reviewEvents.map((event) => {
    const dayKey = dateKeyFromIso(event.created_at, timeZone) ?? todayKey;
    relevantDateKeys.push(dayKey);

    if (event.source === 'review') {
      const seen = reviewWordIdsByDate.get(dayKey) ?? new Set<string>();
      seen.add(event.vocabulary_item_id);
      reviewWordIdsByDate.set(dayKey, seen);
    }

    return { ...event, dayKey };
  });

  for (const group of completedGroups) {
    const dayKey = dateKeyFromIso(group.completed_at, timeZone);
    if (!dayKey) continue;

    relevantDateKeys.push(dayKey);
    learnedWordCountByDate.set(dayKey, (learnedWordCountByDate.get(dayKey) ?? 0) + (groupWordCounts.get(group.id) ?? 0));
  }

  for (const protectedDate of protectedDates) {
    relevantDateKeys.push(protectedDate);
  }

  const startDateKey = [...relevantDateKeys].sort()[0] ?? todayKey;
  const dateKeys = buildDateRange(startDateKey, todayKey);
  const reconstructedStates = new Map<string, ReconstructedWordState>();
  const dailySummaries = new Map<string, DailySummary>();

  let eventIndex = 0;
  for (const dateKey of dateKeys) {
    const dueAtStartCount = countDueWords(reconstructedStates, dateKey, timeZone);

    while (eventIndex < eventsWithDateKey.length && eventsWithDateKey[eventIndex].dayKey === dateKey) {
      const event = eventsWithDateKey[eventIndex];
      reconstructedStates.set(event.vocabulary_item_id, {
        memoryState: event.next_state ?? 'new',
        nextReviewAt: event.next_review_at,
      });
      eventIndex += 1;
    }

    const dueAtEndCount = countDueWords(reconstructedStates, dateKey, timeZone);
    const reviewWordCount = reviewWordIdsByDate.get(dateKey)?.size ?? 0;
    const learnedWordCount = learnedWordCountByDate.get(dateKey) ?? 0;
    const status = resolveDayStatus({
      dueAtStartCount,
      dueAtEndCount,
      reviewWordCount,
      learnedWordCount,
      protectedByCard: protectedDates.has(dateKey),
    });

    dailySummaries.set(dateKey, {
      reviewWordCount,
      learnedWordCount,
      status,
    });
  }

  let perfectCheckinDays = 0;
  let streak = 0;
  for (const dateKey of dateKeys) {
    const summary = dailySummaries.get(dateKey);
    if (summary?.status === 'perfect') {
      perfectCheckinDays += 1;
    }
  }
  for (let index = dateKeys.length - 1; index >= 0; index -= 1) {
    const summary = dailySummaries.get(dateKeys[index]);
    if (!summary || summary.status === 'gap') {
      break;
    }
    streak += 1;
  }

  const orbitDays = buildDateRange(addDays(todayKey, -6), todayKey).map((dateKey) => {
    const summary = dailySummaries.get(dateKey) ?? {
      reviewWordCount: 0,
      learnedWordCount: 0,
      status: (protectedDates.has(dateKey) ? 'shielded' : 'gap') as OrbitDayStatus,
    };

    return {
      date: dateKey,
      weekdayLabel: formatWeekdayLabel(dateKey, timeZone),
      shortDateLabel: formatShortDateLabel(dateKey, timeZone),
      status: summary.status,
      reviewWordCount: summary.reviewWordCount,
      learnedWordCount: summary.learnedWordCount,
    };
  });

  const selectedOrbitDay = orbitDays[orbitDays.length - 1] ?? {
    date: todayKey,
    reviewWordCount: 0,
    learnedWordCount: 0,
  };

  const resumeCandidate = [...learningGroups]
    .filter((group) => group.status !== 'completed' && isLearningRoundType(group.session_round))
    .sort((left, right) => {
      const leftActive = Date.parse(left.session_last_active_at ?? left.created_at);
      const rightActive = Date.parse(right.session_last_active_at ?? right.created_at);
      if (rightActive !== leftActive) {
        return rightActive - leftActive;
      }
      return Date.parse(right.created_at) - Date.parse(left.created_at);
    })
    .map(buildResumeCandidate)
    .find((candidate): candidate is ResumeCandidatePayload => Boolean(candidate)) ?? null;
  const routineCard = buildRoutineCard({
    todayReviewCount: dueCountResult.count ?? 0,
    todaySummary: dailySummaries.get(todayKey),
    resumeCandidate,
    routineProgress,
    learningGroupsById,
  });

  return {
    todayReviewCount: dueCountResult.count ?? 0,
    streak,
    perfectCheckinDays,
    totalLearned: masteredCountResult.count ?? 0,
    orbitDays,
    selectedDate: selectedOrbitDay.date,
    selectedDayReviewWordCount: selectedOrbitDay.reviewWordCount,
    selectedDayLearnedWordCount: selectedOrbitDay.learnedWordCount,
    resumeCandidate,
    routineCard,
  } satisfies HomeOverviewPayload;
}
