import { supabaseAdmin } from './supabase.ts';
import {
  isOfficialLibraryId,
  resolveOfficialLibraryId,
  resolveOfficialStudyModeFromGroupName,
  type OfficialStudyMode,
} from '../officialLibraryLite.ts';
import type { OfficialLibraryId } from '../types.ts';
import { redistributeDueReviewBacklog } from './review.ts';

type OrbitDayStatus = 'gap' | 'ordinary' | 'perfect' | 'shielded';
type LearningRoundType = 'round1' | 'round2' | 'round3' | 'article';
type RoutineStepKey = 'review' | 'round1' | 'round2' | 'round3';
type RoutineCardState = 'not_started' | 'in_progress' | 'completed';
type RoutineVisibleStepStatus = 'completed' | 'current' | 'upcoming';
type RoutineCardCtaMode = 'start_review' | 'continue_review' | 'start_learning' | 'continue_learning' | 'open_library';

interface ResumeCandidatePayload {
  groupId: string;
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
  lastActiveAt: string;
  groupCompleted: boolean;
  completedAt: string | null;
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

interface ActivityDayPayload extends OrbitDayPayload {
  attemptCount: number;
  correctAttemptCount: number;
  accuracy: number | null;
}

interface RoutineVisibleStepPayload {
  key: RoutineStepKey;
  label: string;
  status: RoutineVisibleStepStatus;
}

interface HomeOfficialLibraryOptionPayload {
  libraryId: OfficialLibraryId;
  title: string;
  mode: OfficialStudyMode;
  existingGroupCount: number;
  activeGroupId: string | null;
  activeRound: LearningRoundType | null;
  confirmedWordCount: number;
  loadedWordCount: number;
  completedMemoryWordCount: number;
  totalWordCount: number;
}

interface RoutineCardPayload {
  state: RoutineCardState;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaMode: RoutineCardCtaMode;
  boundLearningGroupId: string | null;
  visibleSteps: RoutineVisibleStepPayload[];
  lastUsedOfficialLibraryId: OfficialLibraryId | null;
  lastUsedOfficialMode: OfficialStudyMode | null;
  lastUsedOfficialGroupCount: number;
  selectedOfficialLibraryId: OfficialLibraryId | null;
  officialLibraryOptions: HomeOfficialLibraryOptionPayload[];
}

export type { ActivityDayPayload, OrbitDayPayload };

export interface HomeOverviewPayload {
  todayReviewCount: number;
  streak: number;
  perfectCheckinDays: number;
  stableRecallCount: number;
  orbitDays: OrbitDayPayload[];
  activityDays: ActivityDayPayload[];
  selectedDate: string;
  selectedDayReviewWordCount: number;
  selectedDayLearnedWordCount: number;
  resumeCandidate: ResumeCandidatePayload | null;
  routineCard: RoutineCardPayload;
}

interface ReviewEventRow {
  id: string;
  vocabulary_item_id: string;
  learning_group_id: string | null;
  source: 'round2' | 'round3' | 'review' | 'manual_mastered' | null;
  was_correct: boolean | null;
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
  session_round1_confirmed_word_ids?: unknown;
  session_last_active_at: string | null;
  word_count?: number | null;
}

interface DailyUserStatisticRow {
  date_key: string;
  review_word_count: number;
  learned_word_count: number;
  attempt_count: number;
  correct_count: number;
  is_routine_finished: boolean;
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

interface Round2GroupProgress {
  correctWordIds: Set<string>;
  lastAttemptAt: string | null;
}

interface DailySummary {
  reviewWordCount: number;
  learnedWordCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  status: OrbitDayStatus;
}

const PAGE_SIZE = 1000;
const GROUP_ID_CHUNK_SIZE = 200;
const LEARNING_ROUNDS = new Set<LearningRoundType>(['round1', 'round2', 'round3', 'article']);
const ROUTINE_STEPS: RoutineStepKey[] = ['review', 'round1', 'round2', 'round3'];
const ROUTINE_DAY_RESET_HOUR = 5;
const ROUTINE_STEP_LABELS: Record<RoutineStepKey, string> = {
  review: 'Round 0 · 到期复习',
  round1: 'Round 1 · 词汇记忆',
  round2: 'Round 2 · 主动回忆',
  round3: 'Round 3 · 听写',
};
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
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

function toRoutineDateKey(date: Date, timeZone: string) {
  const shifted = new Date(date.getTime() - ROUTINE_DAY_RESET_HOUR * 60 * 60 * 1000);
  return toDateKey(shifted, timeZone);
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
  void timeZone;
  return getFormatter('zh-CN', 'UTC', { weekday: 'short' }).format(toStableDate(dateKey));
}

function formatShortDateLabel(dateKey: string, timeZone: string) {
  void timeZone;
  const { month, day } = parseDateKey(dateKey);
  return `${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

function normalizeSessionQueueWordIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function normalizeRound1ConfirmedWordIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function latestIso(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right ?? null;
  if (!right) return left;

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function isLearningRoundType(value: unknown): value is LearningRoundType {
  return typeof value === 'string' && LEARNING_ROUNDS.has(value as LearningRoundType);
}

function isCoreLearningRound(value: unknown): value is Extract<LearningRoundType, 'round1' | 'round2' | 'round3'> {
  return value === 'round1' || value === 'round2' || value === 'round3';
}

function isReinforcementRound(value: unknown): value is Extract<LearningRoundType, 'article'> {
  return value === 'article';
}

function isCoreLearningComplete(input: {
  status?: 'active' | 'completed' | null;
  completedAt?: string | null;
  round?: LearningRoundType | string | null;
  sessionRound?: LearningRoundType | string | null;
  groupCompleted?: boolean;
}) {
  const round = input.round ?? input.sessionRound ?? null;

  return (
    input.groupCompleted === true ||
    input.status === 'completed' ||
    Boolean(input.completedAt) ||
    isReinforcementRound(round)
  );
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
    groupCompleted: isCoreLearningComplete({
      status: row.status,
      completedAt: row.completed_at,
      sessionRound: row.session_round,
    }),
    completedAt: row.completed_at,
    libraryId: null,
    article: null,
    groupTitle: resolveGroupTitle(row.group_name),
    createdAt: row.created_at,
    queueLength,
  };
}

function buildRound2ProgressByGroupId(reviewEvents: ReviewEventRow[]) {
  const progressByGroupId = new Map<string, Round2GroupProgress>();

  for (const event of reviewEvents) {
    if ((event.source !== 'round2' && event.source !== 'round3') || !event.learning_group_id) continue;

    const progress = progressByGroupId.get(event.learning_group_id) ?? {
      correctWordIds: new Set<string>(),
      lastAttemptAt: null,
    };

    if (event.was_correct) {
      progress.correctWordIds.add(event.vocabulary_item_id);
    }
    progress.lastAttemptAt = latestIso(progress.lastAttemptAt, event.created_at);
    progressByGroupId.set(event.learning_group_id, progress);
  }

  return progressByGroupId;
}

function reconcileLearningGroupWithRound2History(
  group: LearningGroupRow,
  progress: Round2GroupProgress | undefined,
): LearningGroupRow {
  if (
    !progress ||
    progress.correctWordIds.size === 0 ||
    isCoreLearningComplete({
      status: group.status,
      completedAt: group.completed_at,
      sessionRound: group.session_round,
    })
  ) {
    return group;
  }

  const queueWordIds = normalizeSessionQueueWordIds(group.session_queue_word_ids);
  if (queueWordIds.length === 0 || !queueWordIds.some((wordId) => progress.correctWordIds.has(wordId))) {
    return group;
  }

  const lastActiveAt =
    latestIso(group.session_last_active_at ?? group.created_at, progress.lastAttemptAt) ?? group.session_last_active_at;
  const firstPendingIndex = queueWordIds.findIndex((wordId) => !progress.correctWordIds.has(wordId));

  if (firstPendingIndex === -1) {
    return {
      ...group,
      status: 'completed',
      completed_at: group.completed_at ?? progress.lastAttemptAt ?? lastActiveAt,
      session_round: 'article',
      session_current_index: 0,
      session_last_active_at: lastActiveAt,
    };
  }

  return {
    ...group,
    session_round: 'round3',
    session_current_index: firstPendingIndex,
    session_last_active_at: lastActiveAt,
  };
}

async function fetchRecentDailyRoutineProgress(userId: string, dateKeys: string[]) {
  const { data, error } = await supabaseAdmin
    .from('daily_routine_progress')
    .select(
      `
      id,
      local_date,
      status
    `,
    )
    .eq('user_id', userId)
    .in('local_date', dateKeys);

  if (error) {
    if (isMissingDailyRoutineProgressError(error)) {
      return new Map<string, string>();
    }
    throw new Error(`daily_routine_progress batch lookup failed: ${error.message}`);
  }

  const statusMap = new Map<string, string>();
  (data ?? []).forEach((row) => {
    statusMap.set(row.local_date, row.status);
  });
  return statusMap;
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
    return ['review', 'round1', 'round2', 'round3'] as RoutineStepKey[];
  }

  return ['round1', 'round2', 'round3'] as RoutineStepKey[];
}

function inferCompletedLearningSteps(
  source:
    | Pick<LearningGroupRow, 'status' | 'completed_at' | 'session_round'>
    | ResumeCandidatePayload
    | null
    | undefined,
) {
  if (!source) return [];

  if (
    'completed_at' in source &&
    isCoreLearningComplete({
      status: source.status,
      completedAt: source.completed_at,
      sessionRound: source.session_round,
    })
  ) {
    return ['round1', 'round2', 'round3'] as RoutineStepKey[];
  }

  if ('groupCompleted' in source && source.groupCompleted) {
    return ['round1', 'round2', 'round3'] as RoutineStepKey[];
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
  const windowStart = stepOrder.length > 2 ? Math.min(firstIncompleteIndex, stepOrder.length - visibleCount) : 0;
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
    return '今日学习计划已完成';
  }

  if (todaySummary.reviewWordCount === 0 && todaySummary.learnedWordCount === 0) {
    return '今日学习计划已完成';
  }

  return `今天已完成复习 ${todaySummary.reviewWordCount} 词 · 新学 ${todaySummary.learnedWordCount} 词`;
}

function getLearningGroupActivityTime(
  group: Pick<LearningGroupRow, 'created_at' | 'completed_at' | 'session_last_active_at'>,
) {
  return Math.max(
    Date.parse(group.session_last_active_at ?? '') || 0,
    Date.parse(group.completed_at ?? '') || 0,
    Date.parse(group.created_at) || 0,
  );
}

interface LastUsedOfficialLibraryRef {
  libraryId: OfficialLibraryId;
  mode: OfficialStudyMode;
  groupCount: number;
  title: string;
}

function resolveLastUsedOfficialLibrary(learningGroups: LearningGroupRow[]): LastUsedOfficialLibraryRef | null {
  const sorted = [...learningGroups].sort((left, right) => {
    const leftActive = getLearningGroupActivityTime(left);
    const rightActive = getLearningGroupActivityTime(right);
    if (rightActive !== leftActive) return rightActive - leftActive;
    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });

  let resolvedLibraryId: OfficialLibraryId | null = null;
  let mostRecentMatchingGroup: LearningGroupRow | null = null;

  for (const group of sorted) {
    if (isOfficialLibraryId(group.library_id)) {
      resolvedLibraryId = group.library_id;
      mostRecentMatchingGroup = group;
      break;
    }

    const fallbackId = resolveOfficialLibraryId(group.library_id, group.group_name, group.source_type);
    if (fallbackId) {
      resolvedLibraryId = fallbackId;
      mostRecentMatchingGroup = group;
      break;
    }
  }

  if (!resolvedLibraryId || !mostRecentMatchingGroup) {
    return null;
  }

  const groupCount = learningGroups.reduce((count, group) => {
    const groupLibraryId = isOfficialLibraryId(group.library_id)
      ? group.library_id
      : resolveOfficialLibraryId(group.library_id, group.group_name, group.source_type);
    return groupLibraryId === resolvedLibraryId ? count + 1 : count;
  }, 0);

  return {
    libraryId: resolvedLibraryId,
    mode: resolveOfficialStudyModeFromGroupName(resolvedLibraryId, mostRecentMatchingGroup.group_name),
    groupCount,
    title: mostRecentMatchingGroup.group_name?.trim() || resolvedLibraryId,
  };
}

export const OFFICIAL_LIBRARY_TITLES: Record<OfficialLibraryId, string> = {
  'ielts-vocab': '雅思词汇真经',
  'gre-zhenkao-v7': 'GRE 真考词汇',
  'cet4-vocab': '四级核心词汇',
  'cet6-vocab': '六级核心词汇',
  'tem4-vocab': '专业四级词汇',
  'tem8-vocab': '专业八级词汇',
  'npee-vocab': '考研大纲词汇',
  'gaokao-vocab': '高考英语核心词汇',
};

// Hardcoded because the Edge runtime cannot load the multi-MB src/data vocab arrays.
// Guarded against the real counts by scripts/test-enterprise-hardening-contracts.ts.
export const OFFICIAL_LIBRARY_TOTALS: Record<OfficialLibraryId, number> = {
  'ielts-vocab': 3631,
  'gre-zhenkao-v7': 1351,
  'cet4-vocab': 4530,
  'cet6-vocab': 2215,
  'tem4-vocab': 8585,
  'tem8-vocab': 3983,
  'npee-vocab': 5390,
  'gaokao-vocab': 3449,
};

function resolveOfficialGroupLibraryId(group: LearningGroupRow) {
  return isOfficialLibraryId(group.library_id)
    ? group.library_id
    : resolveOfficialLibraryId(group.library_id, group.group_name, group.source_type);
}

function getRound1ConfirmedCount(group: LearningGroupRow) {
  const confirmedIds = normalizeRound1ConfirmedWordIds(group.session_round1_confirmed_word_ids);
  if (confirmedIds.length > 0) return confirmedIds.length;

  const queueWordIds = normalizeSessionQueueWordIds(group.session_queue_word_ids);
  if (group.session_round === 'round1') {
    return Math.min(Math.max(group.session_current_index ?? 0, 0), queueWordIds.length);
  }

  if (isCoreLearningRound(group.session_round) || isReinforcementRound(group.session_round)) {
    return queueWordIds.length;
  }

  return 0;
}

function buildHomeOfficialLibraryOptions(
  learningGroups: LearningGroupRow[],
  learningGroupWordCounts: Map<string, number>,
  officialCompletedMemoryCounts: Map<OfficialLibraryId, number>,
): HomeOfficialLibraryOptionPayload[] {
  const groupsByLibrary = new Map<OfficialLibraryId, LearningGroupRow[]>();

  for (const group of learningGroups) {
    const libraryId = resolveOfficialGroupLibraryId(group);
    if (!libraryId) continue;
    const groups = groupsByLibrary.get(libraryId) ?? [];
    groups.push(group);
    groupsByLibrary.set(libraryId, groups);
  }

  return [...groupsByLibrary.entries()]
    .map(([libraryId, groups]) => {
      const sortedGroups = [...groups].sort((left, right) => {
        const leftActive = getLearningGroupActivityTime(left);
        const rightActive = getLearningGroupActivityTime(right);
        if (rightActive !== leftActive) return rightActive - leftActive;
        return Date.parse(right.created_at) - Date.parse(left.created_at);
      });
      const activeGroup =
        sortedGroups.find(
          (group) =>
            isCoreLearningRound(group.session_round) &&
            !isCoreLearningComplete({
              status: group.status,
              completedAt: group.completed_at,
              sessionRound: group.session_round,
            }),
        ) ?? null;
      const referenceGroup = activeGroup ?? sortedGroups[0] ?? null;
      const loadedWordCount = activeGroup
        ? (learningGroupWordCounts.get(activeGroup.id) ??
          normalizeSessionQueueWordIds(activeGroup.session_queue_word_ids).length)
        : sortedGroups.reduce((count, group) => count + (learningGroupWordCounts.get(group.id) ?? 0), 0);
      const confirmedWordCount = activeGroup ? getRound1ConfirmedCount(activeGroup) : loadedWordCount;

      return {
        libraryId,
        title: OFFICIAL_LIBRARY_TITLES[libraryId],
        mode: referenceGroup
          ? resolveOfficialStudyModeFromGroupName(libraryId, referenceGroup.group_name)
          : 'sequential',
        existingGroupCount: groups.length,
        activeGroupId: activeGroup?.id ?? null,
        activeRound: isLearningRoundType(activeGroup?.session_round) ? activeGroup.session_round : null,
        confirmedWordCount,
        loadedWordCount,
        completedMemoryWordCount: officialCompletedMemoryCounts.get(libraryId) ?? 0,
        totalWordCount: OFFICIAL_LIBRARY_TOTALS[libraryId] ?? loadedWordCount,
      } satisfies HomeOfficialLibraryOptionPayload;
    })
    .sort((left, right) => {
      const leftActivity = Math.max(
        ...(groupsByLibrary.get(left.libraryId) ?? []).map(getLearningGroupActivityTime),
        0,
      );
      const rightActivity = Math.max(
        ...(groupsByLibrary.get(right.libraryId) ?? []).map(getLearningGroupActivityTime),
        0,
      );
      return rightActivity - leftActivity;
    });
}

function buildRoutineCard(input: {
  todayReviewCount: number;
  todaySummary: DailySummary | undefined;
  resumeCandidate: ResumeCandidatePayload | null;
  routineProgress: DailyRoutineProgressRow | null;
  learningGroupsById: Map<string, LearningGroupRow>;
  lastUsedOfficialLibrary: LastUsedOfficialLibraryRef | null;
  officialLibraryOptions: HomeOfficialLibraryOptionPayload[];
}) {
  const {
    todayReviewCount,
    todaySummary,
    resumeCandidate,
    routineProgress,
    learningGroupsById,
    lastUsedOfficialLibrary,
    officialLibraryOptions,
  } = input;

  const provisionalStepOrder = buildRoutineStepOrder(routineProgress?.starting_due_count ?? todayReviewCount);
  let stepOrder = routineProgress
    ? normalizeRoutineSteps(routineProgress.step_order_json).length > 0
      ? normalizeRoutineSteps(routineProgress.step_order_json)
      : provisionalStepOrder
    : provisionalStepOrder;

  if (todayReviewCount > 0 && !stepOrder.includes('review')) {
    stepOrder = ['review', ...stepOrder];
  }
  const routineCompletedSteps = normalizeRoutineSteps(routineProgress?.completed_steps_json).filter(
    (step) => step !== 'review' || todayReviewCount === 0,
  );
  const boundLearningGroupId = routineProgress?.main_learning_group_id ?? resumeCandidate?.groupId ?? null;
  const boundGroup = boundLearningGroupId ? (learningGroupsById.get(boundLearningGroupId) ?? null) : null;
  const inferredLearningSteps = boundGroup
    ? inferCompletedLearningSteps(boundGroup)
    : inferCompletedLearningSteps(resumeCandidate);
  const inferredReviewSteps =
    stepOrder.includes('review') && todayReviewCount === 0 ? (['review'] as RoutineStepKey[]) : [];
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

  const lastUsedOfficialLibraryId = lastUsedOfficialLibrary?.libraryId ?? null;
  const lastUsedOfficialMode = lastUsedOfficialLibrary?.mode ?? null;
  const lastUsedOfficialGroupCount = lastUsedOfficialLibrary?.groupCount ?? 0;
  const selectedOfficialLibraryId = officialLibraryOptions[0]?.libraryId ?? lastUsedOfficialLibraryId;
  const selectedOfficialOption =
    officialLibraryOptions.find((option) => option.libraryId === selectedOfficialLibraryId) ??
    officialLibraryOptions[0] ??
    null;
  const lastUsedOfficialTitle = lastUsedOfficialLibrary
    ? (OFFICIAL_LIBRARY_TITLES[lastUsedOfficialLibrary.libraryId] ?? lastUsedOfficialLibrary.title)
    : null;

  if (state === 'completed') {
    if (lastUsedOfficialLibrary) {
      return {
        state,
        title: '继续学习新词',
        subtitle: `${lastUsedOfficialTitle} · 开始下一组词汇学习`,
        ctaLabel: '继续学习',
        ctaMode: 'continue_learning',
        boundLearningGroupId: null,
        visibleSteps,
        lastUsedOfficialLibraryId,
        lastUsedOfficialMode,
        lastUsedOfficialGroupCount,
        selectedOfficialLibraryId,
        officialLibraryOptions,
      } satisfies RoutineCardPayload;
    }

    return {
      state,
      title: '今日已完成',
      subtitle: buildCompletedSubtitle(todaySummary),
      ctaLabel: '查看词库',
      ctaMode: 'open_library',
      boundLearningGroupId,
      visibleSteps,
      lastUsedOfficialLibraryId,
      lastUsedOfficialMode,
      lastUsedOfficialGroupCount,
      selectedOfficialLibraryId,
      officialLibraryOptions,
    } satisfies RoutineCardPayload;
  }

  if (currentStep === 'review') {
    return {
      state,
      title: '复习到期单词',
      subtitle: todayReviewCount > 0 ? `待复习：${todayReviewCount} 个单词` : '先完成今天的复习轮',
      ctaLabel: state === 'not_started' ? '开始复习' : '继续复习',
      ctaMode: state === 'not_started' ? 'start_review' : 'continue_review',
      boundLearningGroupId,
      visibleSteps,
      lastUsedOfficialLibraryId,
      lastUsedOfficialMode,
      lastUsedOfficialGroupCount,
      selectedOfficialLibraryId,
      officialLibraryOptions,
    } satisfies RoutineCardPayload;
  }

  if (boundGroupTitle) {
    return {
      state,
      title: '继续上次学习',
      subtitle: `${boundGroupTitle} · ${ROUTINE_STEP_LABELS[currentStep ?? 'round1']}`,
      ctaLabel: '继续学习',
      ctaMode: 'continue_learning',
      boundLearningGroupId,
      visibleSteps,
      lastUsedOfficialLibraryId,
      lastUsedOfficialMode,
      lastUsedOfficialGroupCount,
      selectedOfficialLibraryId,
      officialLibraryOptions,
    } satisfies RoutineCardPayload;
  }

  const reviewAlreadyDone = completedSteps.includes('review');

  if (lastUsedOfficialLibrary) {
    return {
      state,
      title: '继续学习新词',
      subtitle: `${lastUsedOfficialTitle} · 开始下一组词汇学习`,
      ctaLabel: '继续学习',
      ctaMode: 'continue_learning',
      boundLearningGroupId: null,
      visibleSteps,
      lastUsedOfficialLibraryId,
      lastUsedOfficialMode,
      lastUsedOfficialGroupCount,
      selectedOfficialLibraryId,
      officialLibraryOptions,
    } satisfies RoutineCardPayload;
  }

  return {
    state,
    title: '开始学习新词',
    subtitle: reviewAlreadyDone ? '复习已完成，继续今天的新组学习' : '从词汇记忆开始今日学习',
    ctaLabel: selectedOfficialOption ? '开始学习' : '先选择学习词库',
    ctaMode: 'start_learning',
    boundLearningGroupId,
    visibleSteps,
    lastUsedOfficialLibraryId,
    lastUsedOfficialMode,
    lastUsedOfficialGroupCount,
    selectedOfficialLibraryId: selectedOfficialOption?.libraryId ?? selectedOfficialLibraryId,
    officialLibraryOptions,
  } satisfies RoutineCardPayload;
}

async function fetchActiveGroupsReviewEvents(activeGroupIds: string[]) {
  if (activeGroupIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('review_events')
    .select('id, vocabulary_item_id, learning_group_id, source, was_correct, next_state, next_review_at, created_at')
    .in('learning_group_id', activeGroupIds)
    .order('created_at', { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []) as ReviewEventRow[];
}

async function fetchLearningGroups(userId: string) {
  const rows: LearningGroupRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('learning_groups')
      .select(
        `
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
        session_round1_confirmed_word_ids,
        session_last_active_at,
        word_count
      `,
      )
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

function buildLearningGroupWordCounts(learningGroups: LearningGroupRow[]) {
  const counts = new Map<string, number>();
  for (const group of learningGroups) {
    const queueLength = normalizeSessionQueueWordIds(group.session_queue_word_ids).length;
    counts.set(
      group.id,
      typeof group.word_count === 'number' && group.word_count > 0 ? group.word_count : (queueLength || 30),
    );
  }
  return counts;
}

async function fetchDailyUserStatistics(userId: string, startDateKey: string, endDateKey: string) {
  const { data, error } = await supabaseAdmin
    .from('daily_user_statistics')
    .select('date_key, review_word_count, learned_word_count, attempt_count, correct_count, is_routine_finished')
    .eq('user_id', userId)
    .gte('date_key', startDateKey)
    .lte('date_key', endDateKey);

  const statsMap = new Map<string, DailyUserStatisticRow>();
  if (error || !data) {
    return statsMap;
  }

  for (const row of data as DailyUserStatisticRow[]) {
    statsMap.set(row.date_key, row);
  }
  return statsMap;
}

async function calculateUserStreak(
  userId: string,
  todayKey: string,
  protectedDates: Set<string>,
  todayIsActive: boolean,
): Promise<number> {
  const past90Days = addDays(todayKey, -90);
  const { data, error } = await supabaseAdmin
    .from('daily_user_statistics')
    .select('date_key, review_word_count, learned_word_count, is_routine_finished')
    .eq('user_id', userId)
    .gte('date_key', past90Days)
    .order('date_key', { ascending: false });

  const statsMap = new Map<string, { isActive: boolean }>();
  if (!error && data) {
    for (const row of data as Array<{
      date_key: string;
      review_word_count: number;
      learned_word_count: number;
      is_routine_finished: boolean;
    }>) {
      const isActive =
        row.is_routine_finished || row.review_word_count > 0 || row.learned_word_count > 0;
      statsMap.set(row.date_key, { isActive });
    }
  }

  let streak = 0;
  const todayStat = statsMap.get(todayKey);
  const todayActive = todayIsActive || todayStat?.isActive || protectedDates.has(todayKey);

  let checkDate: string;
  if (todayActive) {
    streak += 1;
    checkDate = addDays(todayKey, -1);
  } else {
    checkDate = addDays(todayKey, -1);
  }

  while (true) {
    const stat = statsMap.get(checkDate);
    const isDayActive = stat?.isActive || protectedDates.has(checkDate);
    if (isDayActive) {
      streak += 1;
      checkDate = addDays(checkDate, -1);
    } else {
      break;
    }
  }

  return streak;
}

async function fetchPerfectCheckinDays(userId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('daily_user_statistics')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_routine_finished', true);

  if (error || typeof count !== 'number') {
    return 0;
  }
  return count;
}

async function fetchOfficialCompletedMemoryCounts(userId: string, learningGroups: LearningGroupRow[]) {
  const officialGroups = learningGroups
    .map((group) => ({
      group,
      libraryId: resolveOfficialGroupLibraryId(group),
    }))
    .filter((entry): entry is { group: LearningGroupRow; libraryId: OfficialLibraryId } => Boolean(entry.libraryId));
  const groupIds = officialGroups.map((entry) => entry.group.id);
  if (groupIds.length === 0) return new Map<OfficialLibraryId, number>();

  const libraryByGroupId = new Map(officialGroups.map((entry) => [entry.group.id, entry.libraryId]));
  const vocabularyIdsByLibrary = new Map<OfficialLibraryId, Set<string>>();
  const allVocabularyIds = new Set<string>();

  for (let offset = 0; offset < groupIds.length; offset += GROUP_ID_CHUNK_SIZE) {
    const chunk = groupIds.slice(offset, offset + GROUP_ID_CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from('learning_group_words')
      .select('learning_group_id, vocabulary_item_id')
      .in('learning_group_id', chunk);

    if (error) {
      throw new Error(`official learning_group_words lookup failed: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ learning_group_id: string; vocabulary_item_id: string | null }>) {
      const libraryId = libraryByGroupId.get(row.learning_group_id);
      const vocabularyItemId = row.vocabulary_item_id;
      if (!libraryId || !vocabularyItemId) continue;
      const ids = vocabularyIdsByLibrary.get(libraryId) ?? new Set<string>();
      ids.add(vocabularyItemId);
      vocabularyIdsByLibrary.set(libraryId, ids);
      allVocabularyIds.add(vocabularyItemId);
    }
  }

  if (allVocabularyIds.size === 0) return new Map<OfficialLibraryId, number>();

  const completedIds = new Set<string>();
  const allVocabularyIdList = [...allVocabularyIds];
  for (let offset = 0; offset < allVocabularyIdList.length; offset += GROUP_ID_CHUNK_SIZE) {
    const chunk = allVocabularyIdList.slice(offset, offset + GROUP_ID_CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from('review_states')
      .select('vocabulary_item_id')
      .eq('user_id', userId)
      .in('vocabulary_item_id', chunk)
      .in('memory_state', ['stable_recall', 'mastered']);

    if (error) {
      throw new Error(`official review_states completion lookup failed: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ vocabulary_item_id: string | null }>) {
      if (row.vocabulary_item_id) completedIds.add(row.vocabulary_item_id);
    }
  }

  const result = new Map<OfficialLibraryId, number>();
  for (const [libraryId, vocabularyIds] of vocabularyIdsByLibrary.entries()) {
    let count = 0;
    for (const vocabularyItemId of vocabularyIds) {
      if (completedIds.has(vocabularyItemId)) count += 1;
    }
    result.set(libraryId, count);
  }

  return result;
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
    .select(
      `
      id,
      local_date,
      timezone,
      day_kind,
      starting_due_count,
      main_learning_group_id,
      step_order_json,
      completed_steps_json,
      status
    `,
    )
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
  const now = new Date();
  await redistributeDueReviewBacklog(userId, { now, timeZone });

  const nowIso = now.toISOString();
  const todayKey = toRoutineDateKey(now, timeZone);

  const [learningGroups, protectionEvents, routineProgress, masteredWordCountResult, dueCountResult] =
    await Promise.all([
      fetchLearningGroups(userId),
      fetchStreakProtectionEvents(userId),
      fetchDailyRoutineProgress(userId, todayKey),
      supabaseAdmin
        .from('review_states')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('memory_state', ['stable_recall', 'mastered']),
      supabaseAdmin
        .from('review_states')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('memory_state', 'mastered')
        .not('next_review_at', 'is', null)
        .lte('next_review_at', nowIso),
    ]);

  if (masteredWordCountResult.error) {
    throw new Error(`review_states mastered word count failed: ${masteredWordCountResult.error.message}`);
  }
  if (dueCountResult.error) {
    throw new Error(`review_states due count failed: ${dueCountResult.error.message}`);
  }

  const activeGroupIds = learningGroups
    .filter((group) => group.status !== 'completed' && !group.completed_at)
    .map((group) => group.id);
  const activeEvents = await fetchActiveGroupsReviewEvents(activeGroupIds);
  const round2ProgressByGroupId = buildRound2ProgressByGroupId(activeEvents);
  const reconciledLearningGroups = learningGroups.map((group) =>
    reconcileLearningGroupWithRound2History(group, round2ProgressByGroupId.get(group.id)),
  );
  const learningGroupWordCounts = buildLearningGroupWordCounts(reconciledLearningGroups);
  const officialCompletedMemoryCounts = await fetchOfficialCompletedMemoryCounts(userId, reconciledLearningGroups);
  const learningGroupsById = new Map(reconciledLearningGroups.map((group) => [group.id, group]));

  const pastSevenDaysStart = addDays(todayKey, -6);
  const orbitDateKeys = buildDateRange(pastSevenDaysStart, todayKey);
  const protectedDates = new Set(
    protectionEvents
      .map((event) => event.protected_date)
      .filter((dateKey): dateKey is string => typeof dateKey === 'string' && dateKey.length > 0),
  );

  const [recentStatsMap, recentRoutineStatusMap] = await Promise.all([
    fetchDailyUserStatistics(userId, pastSevenDaysStart, todayKey),
    fetchRecentDailyRoutineProgress(userId, orbitDateKeys),
  ]);

  const dailySummaries = new Map<string, DailySummary>();
  for (const dateKey of orbitDateKeys) {
    const stat = recentStatsMap.get(dateKey);
    const routineStatus = recentRoutineStatusMap.get(dateKey) ?? null;
    const reviewWordCount = stat?.review_word_count ?? 0;
    const learnedWordCount = stat?.learned_word_count ?? 0;
    const attemptCount = stat?.attempt_count ?? 0;
    const correctAttemptCount = stat?.correct_count ?? 0;

    let status: OrbitDayStatus = 'gap';
    if (stat?.is_routine_finished || routineStatus === 'completed') {
      status = 'perfect';
    } else if (reviewWordCount > 0 || learnedWordCount > 0) {
      status = 'ordinary';
    } else if (protectedDates.has(dateKey)) {
      status = 'shielded';
    }

    dailySummaries.set(dateKey, {
      reviewWordCount,
      learnedWordCount,
      attemptCount,
      correctAttemptCount,
      status,
    });
  }

  const resumeCandidate =
    [...reconciledLearningGroups]
      .filter((group) => isLearningRoundType(group.session_round))
      .sort((left, right) => {
        const leftActive = getLearningGroupActivityTime(left);
        const rightActive = getLearningGroupActivityTime(right);
        if (rightActive !== leftActive) {
          return rightActive - leftActive;
        }
        return Date.parse(right.created_at) - Date.parse(left.created_at);
      })
      .map(buildResumeCandidate)
      .find((candidate): candidate is ResumeCandidatePayload =>
        Boolean(candidate && isCoreLearningRound(candidate.round) && !candidate.groupCompleted),
      ) ?? null;

  const lastUsedOfficialLibrary = resolveLastUsedOfficialLibrary(reconciledLearningGroups);
  const officialLibraryOptions = buildHomeOfficialLibraryOptions(
    reconciledLearningGroups,
    learningGroupWordCounts,
    officialCompletedMemoryCounts,
  );

  const routineCard = buildRoutineCard({
    todayReviewCount: dueCountResult.count ?? 0,
    todaySummary: dailySummaries.get(todayKey),
    resumeCandidate,
    routineProgress,
    learningGroupsById,
    lastUsedOfficialLibrary,
    officialLibraryOptions,
  });

  const todaySummary = dailySummaries.get(todayKey);
  if (todaySummary && routineCard.state === 'completed' && todaySummary.status !== 'perfect') {
    todaySummary.status = 'perfect';
  }

  const todayIsActive =
    Boolean(todaySummary && todaySummary.status !== 'gap') ||
    (todaySummary?.reviewWordCount ?? 0) > 0 ||
    (todaySummary?.learnedWordCount ?? 0) > 0;

  const [streak, perfectCheckinDays] = await Promise.all([
    calculateUserStreak(userId, todayKey, protectedDates, todayIsActive),
    fetchPerfectCheckinDays(userId),
  ]);

  const orbitDays: OrbitDayPayload[] = orbitDateKeys.map((dateKey) => {
    const summary = dailySummaries.get(dateKey) ?? {
      reviewWordCount: 0,
      learnedWordCount: 0,
      attemptCount: 0,
      correctAttemptCount: 0,
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

  // Decoupled: activityDays in HomeOverview only contains the 7 orbit days, lightweight and fast!
  const activityDays: ActivityDayPayload[] = orbitDays.map((orbit) => {
    const summary = dailySummaries.get(orbit.date);
    const attemptCount = summary?.attemptCount ?? 0;
    const correctAttemptCount = summary?.correctAttemptCount ?? 0;
    return {
      ...orbit,
      attemptCount,
      correctAttemptCount,
      accuracy: attemptCount > 0 ? Math.round((correctAttemptCount / attemptCount) * 100) : null,
    };
  });

  const selectedOrbitDay = orbitDays[orbitDays.length - 1] ?? {
    date: todayKey,
    reviewWordCount: 0,
    learnedWordCount: 0,
  };

  return {
    todayReviewCount: dueCountResult.count ?? 0,
    streak,
    perfectCheckinDays,
    stableRecallCount: masteredWordCountResult.count ?? 0,
    orbitDays,
    activityDays,
    selectedDate: selectedOrbitDay.date,
    selectedDayReviewWordCount: selectedOrbitDay.reviewWordCount,
    selectedDayLearnedWordCount: selectedOrbitDay.learnedWordCount,
    resumeCandidate,
    routineCard,
  } satisfies HomeOverviewPayload;
}

export async function getUserActivityHeatmap(
  userId: string,
  requestedTimeZone: string | null | undefined,
): Promise<ActivityDayPayload[]> {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const now = new Date();
  const todayKey = toRoutineDateKey(now, timeZone);
  const activityStartDateKey = addDays(todayKey, -364);

  const [statsMap, protectionEvents, routineProgressMap] = await Promise.all([
    fetchDailyUserStatistics(userId, activityStartDateKey, todayKey),
    fetchStreakProtectionEvents(userId),
    fetchRecentDailyRoutineProgress(userId, buildDateRange(addDays(todayKey, -14), todayKey)),
  ]);

  const protectedDates = new Set(
    protectionEvents
      .map((event) => event.protected_date)
      .filter((dateKey): dateKey is string => typeof dateKey === 'string' && dateKey.length > 0),
  );

  const dateKeys = buildDateRange(activityStartDateKey, todayKey);

  return dateKeys.map((dateKey) => {
    const stat = statsMap.get(dateKey);
    const routineStatus = routineProgressMap.get(dateKey) ?? null;
    const reviewWordCount = stat?.review_word_count ?? 0;
    const learnedWordCount = stat?.learned_word_count ?? 0;
    const attemptCount = stat?.attempt_count ?? 0;
    const correctAttemptCount = stat?.correct_count ?? 0;

    let status: OrbitDayStatus = 'gap';
    if (stat?.is_routine_finished || routineStatus === 'completed') {
      status = 'perfect';
    } else if (reviewWordCount > 0 || learnedWordCount > 0) {
      status = 'ordinary';
    } else if (protectedDates.has(dateKey)) {
      status = 'shielded';
    }

    const accuracy =
      attemptCount > 0 ? Math.round((correctAttemptCount / attemptCount) * 100) : null;

    return {
      date: dateKey,
      weekdayLabel: formatWeekdayLabel(dateKey, timeZone),
      shortDateLabel: formatShortDateLabel(dateKey, timeZone),
      status,
      reviewWordCount,
      learnedWordCount,
      attemptCount,
      correctAttemptCount,
      accuracy,
    };
  });
}
