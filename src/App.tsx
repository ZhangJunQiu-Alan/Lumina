/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, Loader2, RefreshCw, Settings } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ActivityDay,
  ArticleSentence,
  HomeOfficialLibraryOption,
  LearningPreferences,
  LearningRoundType,
  OfficialLibraryId,
  OfficialStudyMode,
  PersistedLearningSession,
  ReviewSummaryItem,
  RoundType,
  UserStats,
  Word,
} from './types';
import { Sidebar } from './components/layout/Sidebar';
import { WhatsNewModal } from './components/shared/WhatsNewModal';
import { SessionSettingsDrawer } from './components/settings/SessionSettingsDrawer';
import { fetchDueReviewWords } from './lib/reviewApi';
import { attemptBuffer } from './lib/attemptBuffer';
import { readLocal, writeLocal } from './lib/durableStorage';
import { cacheLearningRecovery, type ReviewRecovery } from './lib/learningRecovery';
import { useAuth } from './contexts/AuthContext';
import { useLearningPreferences } from './contexts/LearningPreferencesContext';
import { SavedWordsProvider } from './contexts/SavedWordsContext';
import { WordPopoverProvider } from './contexts/WordPopoverContext';
import { apiFetch } from './lib/api';
import { invalidateLibraryCache } from './lib/libraryCache';
import {
  createInitialLearningSession,
  filterWordsToRound1Confirmed,
  getNewRound1ConfirmedWordIds,
  isCoreLearningRound,
  normalizePersistedLearningSession,
  normalizeSessionRound1ConfirmedWordIds,
} from './lib/learningSession';
import {
  clearLearningGroupSession,
  fetchGeneratedArticle,
  fetchLearningGroupSession,
  fetchOfficialResumeTargets,
  markLearningGroupWordsRound1Confirmed,
  markLearningGroupWordsRoundCompleted,
  persistLearningGroupSession,
  trimLearningGroupToWordIds,
  upsertGeneratedArticle,
} from './lib/learningSessionApi';
import { getCachedArticle, setCachedArticle } from './lib/articleCache';
import {
  bindRoutineMainLearningGroup,
  markRoutineReviewStarted,
  markRoutineStepCompleted,
} from './lib/dailyRoutineApi';
import { cx } from './components/shared/LearningUI';
import { IslandButton } from './components/shared/AnimalPrimitives';
import { LibrarySkeleton } from './components/shared/Skeleton';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { fetchHomeOverview, resolveBrowserTimeZone } from './lib/homeApi';
import {
  invalidateCachedHomeOverview,
  isCachedHomeOverviewCompatibleWithActiveLearningGroup,
  readCachedHomeOverview,
  writeCachedHomeOverview,
} from './lib/homeOverviewCache';
import { shouldForceHomeRefreshForNavigation } from './lib/homeNavigation';
import {
  clearOfficialAppendPreparationCache,
  preloadNextOfficialBatchForAppend,
  reorderActiveOfficialGroup,
  startNextOfficialBatch,
} from './lib/officialLibraryStart';
import { deleteOfficialLearningLibrary } from './lib/libraryApi';
import {
  getOfficialLibraryDefinition,
  isOfficialLibraryId,
  OFFICIAL_APPEND_PRELOAD_REMAINING_THRESHOLD,
} from './lib/officialLibrary';
import { toRoutineDateKey } from './lib/routineDate';
import {
  ARTICLE_REINFORCEMENT_ENABLED,
  IELTS_LISTENING_ENABLED,
  PERSONAL_VOCAB_IMPORT_ENABLED,
} from './lib/aiFeatures';
import type { LearningSessionSnapshot } from './components/learning/LearningEngine';

// --- Lazy loaded views ---
const HomeView = lazy(() => import('./components/home/HomeView').then((m) => ({ default: m.HomeView })));
const ImportView = lazy(() => import('./components/import/ImportView').then((m) => ({ default: m.ImportView })));
const IeltsHomeView = lazy(() =>
  import('./components/ielts/IeltsHomeView').then((m) => ({ default: m.IeltsHomeView })),
);
const IeltsReadingHomeView = lazy(() =>
  import('./components/ielts/IeltsReadingView').then((m) => ({ default: m.IeltsReadingHomeView })),
);
const IeltsReadingTestView = lazy(() =>
  import('./components/ielts/IeltsReadingView').then((m) => ({ default: m.IeltsReadingTestView })),
);
const IeltsListeningHomeView = lazy(() =>
  import('./components/ielts/IeltsListeningView').then((m) => ({ default: m.IeltsListeningHomeView })),
);
const IeltsListeningTestView = lazy(() =>
  import('./components/ielts/IeltsListeningView').then((m) => ({ default: m.IeltsListeningTestView })),
);
const LibraryView = lazy(() => import('./components/library/LibraryView').then((m) => ({ default: m.LibraryView })));
const NotebookView = lazy(() =>
  import('./components/notebook/NotebookView').then((m) => ({ default: m.NotebookView })),
);
const ProfileView = lazy(() => import('./components/profile/ProfileView').then((m) => ({ default: m.ProfileView })));
const OfficialLibraryDetailView = lazy(() =>
  import('./components/library/LibraryView').then((m) => ({ default: m.OfficialLibraryDetailView })),
);
const LibraryGroupDetailView = lazy(() =>
  import('./components/library/LibraryView').then((m) => ({ default: m.LibraryGroupDetailView })),
);
const ReviewResultsView = lazy(() =>
  import('./components/review/ReviewResultsView').then((m) => ({ default: m.ReviewResultsView })),
);
const SettingsView = lazy(() =>
  import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);

// --- Core Learning Components (Extracted) ---
const LearningEngine = lazy(() =>
  import('./components/learning/LearningEngine').then((m) => ({ default: m.LearningEngine })),
);
const ArticleView = lazy(() => import('./components/learning/ArticleView').then((m) => ({ default: m.ArticleView })));

const ARTICLE_RETRY_DELAY_MS = 3000;
const ARTICLE_MAX_RETRY_ATTEMPTS = 3;
const ARTICLE_REQUEST_TIMEOUT_MS = 60000;
const ARTICLE_RETRY_EXHAUSTED_MESSAGE = '文章生成失败，已自动重试 3 次。';

interface ArticleGenerationJob {
  key: string;
  groupId: string;
  runId: number;
  attempt: number;
  inFlight: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  exhausted: boolean;
}

interface OpenLearningGroupOptions {
  libraryId?: OfficialLibraryId | null;
  officialMode?: OfficialStudyMode | null;
}

interface HomeStartSelection {
  libraryId?: OfficialLibraryId | null;
  mode?: OfficialStudyMode | null;
}

interface FetchStatsOptions {
  forceRefresh?: boolean;
  preferCache?: boolean;
}

type OfficialLearningStartTarget = Pick<HomeOfficialLibraryOption, 'existingGroupCount' | 'libraryId' | 'mode'>;

function areArraysEqual<T>(left: readonly T[] = [], right: readonly T[] = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSameLearningProgressSnapshot(
  current: PersistedLearningSession | null,
  next: LearningSessionSnapshot,
  groupId: string,
) {
  if (!current || current.groupId !== groupId) return false;

  return (
    current.round === next.round &&
    current.currentIndex === next.currentIndex &&
    areArraysEqual(current.queueWordIds, next.queueWordIds) &&
    areArraysEqual(current.passedQueueIndices, next.passedQueueIndices) &&
    areArraysEqual(current.round1ConfirmedWordIds, next.round1ConfirmedWordIds)
  );
}

function buildLearningProgressSignature(
  groupId: string,
  progress: Pick<
    LearningSessionSnapshot | PersistedLearningSession,
    'round' | 'currentIndex' | 'queueWordIds' | 'passedQueueIndices' | 'round1ConfirmedWordIds'
  >,
) {
  return JSON.stringify([
    groupId,
    progress.round,
    progress.currentIndex,
    progress.queueWordIds,
    progress.passedQueueIndices,
    progress.round1ConfirmedWordIds,
  ]);
}

const LEARNING_SESSION_ROUND_RANK: Record<LearningRoundType, number> = {
  round1: 1,
  round2: 2,
  round3: 3,
  article: 4,
};

function isStaleLearningProgressSnapshot(
  current: PersistedLearningSession | null,
  next: LearningSessionSnapshot,
  groupId: string,
) {
  if (!current || current.groupId !== groupId) return false;
  return LEARNING_SESSION_ROUND_RANK[current.round] > LEARNING_SESSION_ROUND_RANK[next.round];
}

function AmbientBackground() {
  return <div className="lumina-ambient" aria-hidden="true" />;
}

const LoadingShell = ({ isSkeleton = false }: { isSkeleton?: boolean }) => {
  const shouldShow = useDeferredLoading(true, 300);
  if (!shouldShow) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
      {isSkeleton ? (
        <LibrarySkeleton />
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="w-10 h-10 text-apple-blue animate-spin opacity-20" />
        </div>
      )}
    </motion.div>
  );
};

function buildFallbackActivityDays(timeZone: string, length = 365): ActivityDay[] {
  const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'UTC',
    weekday: 'short',
  });

  return Array.from({ length }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (length - 1 - index));

    const dateKey = toRoutineDateKey(date, timeZone);
    const labelDate = new Date(`${dateKey}T12:00:00.000Z`);
    const [year = '0000', month = '01', day = '01'] = dateKey.split('-');

    return {
      date: `${year}-${month}-${day}`,
      weekdayLabel: weekdayFormatter.format(labelDate),
      shortDateLabel: `${month}.${day}`,
      status: 'gap' as const,
      reviewWordCount: 0,
      learnedWordCount: 0,
      attemptCount: 0,
      correctAttemptCount: 0,
      accuracy: null,
    };
  });
}

function buildFallbackOrbitDays(timeZone: string) {
  return buildFallbackActivityDays(timeZone, 7).map((day) => ({
    date: day.date,
    weekdayLabel: day.weekdayLabel,
    shortDateLabel: day.shortDateLabel,
    status: day.status,
    reviewWordCount: day.reviewWordCount,
    learnedWordCount: day.learnedWordCount,
  }));
}

function isArticleSentence(value: unknown): value is ArticleSentence {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ArticleSentence).en === 'string' &&
    typeof (value as ArticleSentence).zh === 'string' &&
    (value as ArticleSentence).en.trim().length > 0 &&
    (value as ArticleSentence).zh.trim().length > 0
  );
}

function normalizeArticleResponse(data: unknown): ArticleSentence[] {
  const sentences = (data as { sentences?: unknown })?.sentences;
  if (!Array.isArray(sentences)) {
    throw new Error('Article response missing sentences');
  }

  const normalized = sentences.filter(isArticleSentence).map((sentence) => ({
    en: sentence.en.trim(),
    zh: sentence.zh.trim(),
  }));

  if (normalized.length === 0) {
    throw new Error('Article response has no valid sentences');
  }

  return normalized;
}

function buildArticleGenerationKey(groupId: string, words: Word[]) {
  return `${groupId}:${words.map((word) => word.id).join('|')}`;
}

function serializeArticleSentences(sentences: ArticleSentence[]) {
  return JSON.stringify({ sentences });
}

function parsePersistedArticleContent(content: string | null | undefined) {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  try {
    return normalizeArticleResponse(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

function buildEmptyStats(): UserStats {
  const timeZone = resolveBrowserTimeZone();
  const todayKey = toRoutineDateKey(new Date(), timeZone);

  return {
    todayReviewCount: 0,
    streak: 0,
    perfectCheckinDays: 0,
    stableRecallCount: 0,
    orbitDays: buildFallbackOrbitDays(timeZone),
    activityDays: buildFallbackActivityDays(timeZone),
    selectedDate: todayKey,
    selectedDayReviewWordCount: 0,
    selectedDayLearnedWordCount: 0,
    resumeCandidate: null,
    routineCard: {
      state: 'not_started',
      title: '开始今天的学习',
      subtitle: '先完成第一轮，再进入回忆与听写',
      ctaLabel: '先选择学习词库',
      ctaMode: 'start_learning',
      boundLearningGroupId: null,
      lastUsedOfficialLibraryId: null,
      lastUsedOfficialMode: null,
      lastUsedOfficialGroupCount: 0,
      selectedOfficialLibraryId: null,
      officialLibraryOptions: [],
      visibleSteps: [
        { key: 'round1', label: 'Round 1 · 明示关联', status: 'current' },
        { key: 'round2', label: 'Round 2 · 主动回忆', status: 'upcoming' },
        { key: 'round3', label: 'Round 3 · 听写复现', status: 'upcoming' },
      ],
    },
  };
}

function applyLearningPreferencesToStats(stats: UserStats, preferences: LearningPreferences): UserStats {
  if (preferences.reinforcementRound3Enabled && preferences.round2Enabled) return stats;

  return {
    ...stats,
    routineCard: {
      ...stats.routineCard,
      visibleSteps: stats.routineCard.visibleSteps.filter((step) => {
        if (step.key === 'round2') return preferences.reinforcementRound3Enabled;
        if (step.key === 'round3') return preferences.round2Enabled;
        return true;
      }),
    },
  };
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { preferences: learningPreferences } = useLearningPreferences();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const activeLearningGroupIdRef = useRef<string | null>(null);
  const sessionAutoRestoreRef = useRef<string | null>(null);
  const lastNonSessionAppPathRef = useRef('/app/home');
  const officialAppendPreloadKeyRef = useRef<string | null>(null);
  const articleGenerationRef = useRef<ArticleGenerationJob | null>(null);
  const articleGenerationRunIdRef = useRef(0);
  const activeWordsRef = useRef<Word[]>([]);
  const activeSessionSeedRef = useRef<PersistedLearningSession | null>(null);
  const lastSessionChangeSignatureRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const homeStatsInFlightRef = useRef<Promise<void> | null>(null);
  const homeStatsRequestIdRef = useRef(0);
  const hasTrustedHomeStatsRef = useRef(false);
  const homeOverviewDirtyRef = useRef(false);
  const forceNextHomeRefreshRef = useRef(false);
  const pendingLearningHomeSyncsRef = useRef<Set<Promise<void>>>(new Set());
  const homeRefreshAfterSyncRef = useRef<Promise<void> | null>(null);
  const [round, setRound] = useState<RoundType>('round1');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [activeReviewRecovery, setActiveReviewRecovery] = useState<ReviewRecovery | null>(null);
  const handleReviewChange = useCallback(
    (recovery: ReviewRecovery) => {
      if (!user) return;
      writeLocal(`lumina.review-recovery.v1.${user.id}`, recovery);
      writeLocal(`lumina.last-session-mode.v1.${user.id}`, 'review');
    },
    [user],
  );
  const [activeLearningGroupId, setActiveLearningGroupId] = useState<string | null>(null);
  const [activeSessionSeed, setActiveSessionSeedState] = useState<PersistedLearningSession | null>(null);
  const [articleSentences, setArticleSentences] = useState<ArticleSentence[] | null>(null);
  const [articleGenerationError, setArticleGenerationError] = useState('');
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [sessionStartError, setSessionStartError] = useState('');
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [stats, setStats] = useState<UserStats>(buildEmptyStats);
  const [hasTrustedHomeStats, setHasTrustedHomeStats] = useState(false);
  const [isHomeStatsRefreshing, setIsHomeStatsRefreshing] = useState(false);
  const isSessionRoute = location.pathname.startsWith('/app/session');
  const isHomeRoute = location.pathname.startsWith('/app/home');
  const isIeltsTestRoute =
    location.pathname.startsWith('/app/ielts-reading/test/') ||
    (IELTS_LISTENING_ENABLED && location.pathname.startsWith('/app/ielts-listening/test/'));
  const recallRoundEnabled = learningPreferences.reinforcementRound3Enabled;
  const dictationRoundEnabled = learningPreferences.round2Enabled;
  const articleReinforcementEnabled = ARTICLE_REINFORCEMENT_ENABLED && learningPreferences.reinforcementArticleEnabled;
  const requestedOfficialLibraryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get('officialLibraryId');
    return isOfficialLibraryId(value) ? value : null;
  }, [location.search]);
  const homeStats = useMemo(() => {
    const preferenceAwareStats = applyLearningPreferencesToStats(stats, learningPreferences);
    if (!isHomeRoute || !requestedOfficialLibraryId) return preferenceAwareStats;

    const existingOption = preferenceAwareStats.routineCard.officialLibraryOptions.find(
      (option) => option.libraryId === requestedOfficialLibraryId,
    );
    const definition = getOfficialLibraryDefinition(requestedOfficialLibraryId);
    const injectedOption: HomeOfficialLibraryOption = existingOption ?? {
      libraryId: requestedOfficialLibraryId,
      title: definition.title,
      mode:
        preferenceAwareStats.routineCard.lastUsedOfficialLibraryId === requestedOfficialLibraryId
          ? (preferenceAwareStats.routineCard.lastUsedOfficialMode ?? 'sequential')
          : 'sequential',
      existingGroupCount:
        preferenceAwareStats.routineCard.lastUsedOfficialLibraryId === requestedOfficialLibraryId
          ? preferenceAwareStats.routineCard.lastUsedOfficialGroupCount
          : 0,
      activeGroupId: null,
      activeRound: null,
      confirmedWordCount: 0,
      loadedWordCount: 0,
      completedMemoryWordCount: 0,
      totalWordCount: definition.words.length,
    };

    return {
      ...preferenceAwareStats,
      routineCard: {
        ...preferenceAwareStats.routineCard,
        ctaLabel:
          preferenceAwareStats.routineCard.ctaMode === 'open_library'
            ? '开始学习'
            : preferenceAwareStats.routineCard.ctaLabel,
        ctaMode:
          preferenceAwareStats.routineCard.ctaMode === 'open_library'
            ? 'start_learning'
            : preferenceAwareStats.routineCard.ctaMode,
        selectedOfficialLibraryId: requestedOfficialLibraryId,
        officialLibraryOptions: [
          injectedOption,
          ...preferenceAwareStats.routineCard.officialLibraryOptions.filter(
            (option) => option.libraryId !== requestedOfficialLibraryId,
          ),
        ],
      },
    };
  }, [isHomeRoute, learningPreferences, requestedOfficialLibraryId, stats]);

  const setActiveSessionSeed = useCallback((next: React.SetStateAction<PersistedLearningSession | null>) => {
    setActiveSessionSeedState((current) => {
      const resolved =
        typeof next === 'function'
          ? (next as (value: PersistedLearningSession | null) => PersistedLearningSession | null)(current)
          : next;
      activeSessionSeedRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    activeLearningGroupIdRef.current = activeLearningGroupId;
  }, [activeLearningGroupId]);
  useEffect(() => {
    activeWordsRef.current = activeWords;
  }, [activeWords]);
  useEffect(() => {
    activeSessionSeedRef.current = activeSessionSeed;
  }, [activeSessionSeed]);

  useEffect(() => {
    if (!isSessionRoute && location.pathname.startsWith('/app')) {
      lastNonSessionAppPathRef.current = `${location.pathname}${location.search}${location.hash}`;
    }
  }, [isSessionRoute, location.hash, location.pathname, location.search]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    homeStatsRequestIdRef.current += 1;
    homeStatsInFlightRef.current = null;
    homeOverviewDirtyRef.current = false;
    forceNextHomeRefreshRef.current = false;
    pendingLearningHomeSyncsRef.current.clear();
    homeRefreshAfterSyncRef.current = null;
    hasTrustedHomeStatsRef.current = false;
    setHasTrustedHomeStats(false);
    setIsHomeStatsRefreshing(false);
  }, [user?.id]);

  useEffect(
    () =>
      attemptBuffer.subscribe(({ attempt, result }) => {
        const userId = userIdRef.current;
        if (userId) {
          invalidateLibraryCache(userId);
        }

        if (attempt.source !== 'review') return;

        const word = activeWordsRef.current.find((item) => item.id === attempt.vocabularyItemId);
        if (!word) return;

        setReviewSummary((prev) => {
          const nextItem: ReviewSummaryItem = {
            wordId: word.id,
            word: word.word,
            chineseDefinition: word.chinese_definition,
            transition: result.transition,
          };

          return [...prev.filter((item) => item.wordId !== word.id), nextItem];
        });
      }),
    [],
  );

  const cancelArticleGeneration = useCallback((groupId?: string) => {
    const current = articleGenerationRef.current;
    if (!current) return;
    if (groupId && current.groupId !== groupId) return;

    if (current.timerId) {
      clearTimeout(current.timerId);
    }
    current.controller?.abort();

    articleGenerationRef.current = null;
  }, []);

  const fetchStats = useCallback(
    async (options: FetchStatsOptions = {}) => {
      if (!user) {
        homeStatsInFlightRef.current = null;
        hasTrustedHomeStatsRef.current = false;
        setHasTrustedHomeStats(false);
        setStats(buildEmptyStats());
        return;
      }

      const timeZone = resolveBrowserTimeZone();
      const mustRefreshHomeOverview = options.forceRefresh || homeOverviewDirtyRef.current;
      if (mustRefreshHomeOverview) {
        invalidateCachedHomeOverview(user.id, timeZone);
      } else {
        const cached = readCachedHomeOverview(user.id, timeZone);
        const activeGroupId = activeLearningGroupIdRef.current ?? activeSessionSeedRef.current?.groupId ?? null;
        if (cached && isCachedHomeOverviewCompatibleWithActiveLearningGroup(cached.stats, activeGroupId)) {
          if (options.preferCache || !hasTrustedHomeStatsRef.current) {
            hasTrustedHomeStatsRef.current = true;
            setHasTrustedHomeStats(true);
            setStats(cached.stats);
          }
          if (options.preferCache && cached.isFresh) {
            return;
          }
        }
      }

      if (homeStatsInFlightRef.current && !mustRefreshHomeOverview) {
        return homeStatsInFlightRef.current;
      }

      const requestId = homeStatsRequestIdRef.current + 1;
      homeStatsRequestIdRef.current = requestId;
      const request = (async () => {
        setIsHomeStatsRefreshing(true);
        try {
          const overview = await fetchHomeOverview(timeZone);
          if (userIdRef.current !== user.id || homeStatsRequestIdRef.current !== requestId) {
            return;
          }
          const fallback = buildEmptyStats();
          const nextStats = {
            ...fallback,
            ...overview,
            orbitDays: overview.orbitDays?.length ? overview.orbitDays : fallback.orbitDays,
            activityDays: overview.activityDays?.length ? overview.activityDays : fallback.activityDays,
            routineCard: overview.routineCard ?? fallback.routineCard,
          };
          writeCachedHomeOverview(user.id, timeZone, nextStats);
          homeOverviewDirtyRef.current = false;
          hasTrustedHomeStatsRef.current = true;
          setHasTrustedHomeStats(true);
          setStats(nextStats);
        } catch (err) {
          console.error('Failed to fetch stats:', err);
          if (userIdRef.current !== user.id || homeStatsRequestIdRef.current !== requestId) {
            return;
          }
          if (!hasTrustedHomeStatsRef.current) {
            setStats(buildEmptyStats());
          }
        } finally {
          if (homeStatsInFlightRef.current === request) {
            setIsHomeStatsRefreshing(false);
            homeStatsInFlightRef.current = null;
          }
        }
      })();

      homeStatsInFlightRef.current = request;
      return request;
    },
    [user],
  );

  const markHomeOverviewDirty = useCallback(() => {
    homeOverviewDirtyRef.current = true;
    const userId = userIdRef.current;
    if (userId) {
      invalidateCachedHomeOverview(userId, resolveBrowserTimeZone());
    }
  }, []);

  const trackLearningHomeSync = useCallback(
    (promise: Promise<void>) => {
      markHomeOverviewDirty();
      const trackedPromise = promise.finally(() => {
        pendingLearningHomeSyncsRef.current.delete(trackedPromise);
      });
      pendingLearningHomeSyncsRef.current.add(trackedPromise);
      void trackedPromise.catch(() => {
        // Individual sync tasks log their own failures; refresh should still continue.
      });
      return trackedPromise;
    },
    [markHomeOverviewDirty],
  );

  const waitForPendingLearningHomeSync = useCallback(async () => {
    while (pendingLearningHomeSyncsRef.current.size > 0) {
      await Promise.allSettled([...pendingLearningHomeSyncsRef.current]);
    }
  }, []);

  const refreshHomeStatsAfterLearningSync = useCallback(() => {
    if (homeRefreshAfterSyncRef.current) {
      return homeRefreshAfterSyncRef.current;
    }

    const refreshPromise = (async () => {
      await waitForPendingLearningHomeSync();
      await fetchStats({ forceRefresh: true });
    })();
    const trackedRefresh = refreshPromise.finally(() => {
      if (homeRefreshAfterSyncRef.current === trackedRefresh) {
        homeRefreshAfterSyncRef.current = null;
      }
    });
    homeRefreshAfterSyncRef.current = trackedRefresh;
    return trackedRefresh;
  }, [fetchStats, waitForPendingLearningHomeSync]);

  const navigateWithFreshHomeStats = useCallback(
    (targetPath = '/app/home') => {
      setIsSessionSettingsOpen(false);
      if (targetPath.startsWith('/app/home')) {
        forceNextHomeRefreshRef.current = true;
      }
      navigate(targetPath);
      if (targetPath.startsWith('/app/home')) {
        void refreshHomeStatsAfterLearningSync();
      }
    },
    [navigate, refreshHomeStatsAfterLearningSync],
  );

  const handleSelectOrbitDate = useCallback((date: string) => {
    setStats((current) => {
      const selectedDay = current.orbitDays.find((day) => day.date === date);
      if (!selectedDay) {
        return current;
      }

      return {
        ...current,
        selectedDate: selectedDay.date,
        selectedDayReviewWordCount: selectedDay.reviewWordCount,
        selectedDayLearnedWordCount: selectedDay.learnedWordCount,
      };
    });
  }, []);

  useEffect(() => {
    void fetchStats({ preferCache: true });
  }, [fetchStats]);
  useEffect(() => {
    if (location.pathname.startsWith('/app/home')) {
      const shouldForceRefresh =
        forceNextHomeRefreshRef.current || homeOverviewDirtyRef.current || pendingLearningHomeSyncsRef.current.size > 0;
      forceNextHomeRefreshRef.current = false;
      if (shouldForceRefresh) {
        void refreshHomeStatsAfterLearningSync();
        return;
      }
      void fetchStats({ preferCache: true });
    }
  }, [fetchStats, location.pathname, refreshHomeStatsAfterLearningSync]);
  useEffect(() => {
    if (!user) {
      cancelArticleGeneration();
      activeLearningGroupIdRef.current = null;
      officialAppendPreloadKeyRef.current = null;
      clearOfficialAppendPreparationCache();
      lastSessionChangeSignatureRef.current = null;
      setActiveWords([]);
      setActiveLearningGroupId(null);
      setActiveSessionSeed(null);
      setReviewSummary([]);
      setArticleSentences(null);
      setArticleGenerationError('');
      setRound('round1');
    }
  }, [cancelArticleGeneration, setActiveSessionSeed, user]);

  const resetActiveLearningState = useCallback(() => {
    cancelArticleGeneration();
    activeLearningGroupIdRef.current = null;
    officialAppendPreloadKeyRef.current = null;
    clearOfficialAppendPreparationCache();
    lastSessionChangeSignatureRef.current = null;
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setActiveSessionSeed(null);
    setArticleSentences(null);
    setArticleGenerationError('');
    setRound('round1');
  }, [cancelArticleGeneration, setActiveSessionSeed]);

  const ensureArticleForGroup = useCallback(
    async (groupId: string, words: Word[]) => {
      if (!user) return null;

      const generationKey = buildArticleGenerationKey(groupId, words);
      const existingJob = articleGenerationRef.current;
      if (existingJob && existingJob.key !== generationKey) {
        cancelArticleGeneration();
      }

      const cachedArticle = getCachedArticle(groupId, words);
      if (cachedArticle) {
        cancelArticleGeneration(groupId);
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleSentences(cachedArticle);
          setArticleGenerationError('');
        }
        return cachedArticle;
      }

      const currentJob = articleGenerationRef.current;
      if (currentJob?.key === generationKey && currentJob.exhausted) {
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleGenerationError(ARTICLE_RETRY_EXHAUSTED_MESSAGE);
        }
        return null;
      }

      if (currentJob?.key === generationKey && (currentJob.inFlight || currentJob.timerId)) {
        return null;
      }

      const runId = currentJob?.key === generationKey ? currentJob.runId : articleGenerationRunIdRef.current + 1;
      articleGenerationRunIdRef.current = Math.max(articleGenerationRunIdRef.current, runId);

      const startingAttempt = currentJob?.key === generationKey ? currentJob.attempt : 0;
      articleGenerationRef.current = {
        key: generationKey,
        groupId,
        runId,
        attempt: startingAttempt,
        inFlight: true,
        timerId: null,
        controller: null,
        exhausted: false,
      };
      setArticleGenerationError('');

      const isCurrentJob = () =>
        articleGenerationRef.current?.key === generationKey && articleGenerationRef.current.runId === runId;

      const completeWithSentences = (sentences: ArticleSentence[]) => {
        if (!isCurrentJob()) return;
        setCachedArticle(groupId, words, sentences);
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleSentences(sentences);
          setArticleGenerationError('');
        }
        articleGenerationRef.current = null;
      };

      const scheduleRetry = () => {
        const current = articleGenerationRef.current;
        if (!current || current.key !== generationKey || current.runId !== runId) return;

        if (current.attempt >= ARTICLE_MAX_RETRY_ATTEMPTS) {
          current.inFlight = false;
          current.timerId = null;
          current.controller = null;
          current.exhausted = true;
          if (activeLearningGroupIdRef.current === groupId) {
            setArticleGenerationError(ARTICLE_RETRY_EXHAUSTED_MESSAGE);
          }
          return;
        }

        current.inFlight = false;
        current.attempt += 1;
        current.timerId = setTimeout(() => {
          const scheduled = articleGenerationRef.current;
          if (!scheduled || scheduled.key !== generationKey || scheduled.runId !== runId) return;
          scheduled.timerId = null;
          void ensureArticleForGroup(groupId, words);
        }, ARTICLE_RETRY_DELAY_MS);
      };

      try {
        const persistedArticle = await fetchGeneratedArticle(user.id, groupId);
        const persistedSentences = parsePersistedArticleContent(persistedArticle);
        if (persistedSentences) {
          completeWithSentences(persistedSentences);
          return persistedSentences;
        }

        const controller = new AbortController();
        const currentJobForRequest = articleGenerationRef.current;
        if (currentJobForRequest && isCurrentJob()) {
          currentJobForRequest.controller = controller;
        }
        const timeoutId = setTimeout(() => controller.abort(), ARTICLE_REQUEST_TIMEOUT_MS);
        let sentences: ArticleSentence[];
        try {
          const res = await apiFetch('/api/vocab/article', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: words.map((word) => word.word) }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { data } = await res.json();
          sentences = normalizeArticleResponse(data);
        } finally {
          clearTimeout(timeoutId);
          const currentJobAfterRequest = articleGenerationRef.current;
          if (currentJobAfterRequest && isCurrentJob()) {
            currentJobAfterRequest.controller = null;
          }
        }

        if (!isCurrentJob()) {
          return sentences;
        }

        await upsertGeneratedArticle(
          user.id,
          groupId,
          serializeArticleSentences(sentences),
          words.map((word) => word.word.trim()).filter(Boolean),
        );
        completeWithSentences(sentences);

        return sentences;
      } catch (error) {
        console.error('Article generation failed:', error);
        scheduleRetry();
        return null;
      }
    },
    [cancelArticleGeneration, user],
  );

  const openLearningGroup = useCallback(
    async (groupId: string, preloadedWords?: Word[], options: OpenLearningGroupOptions = {}) => {
      if (!user) return;

      setIsStartingSession(true);
      setSessionStartError('');
      try {
        let words = preloadedWords ?? [];
        let restoredSession: PersistedLearningSession | null = null;

        if (!preloadedWords) {
          const groupSession = await fetchLearningGroupSession(user.id, groupId);
          if (!groupSession) {
            throw new Error('这组词不存在，或它不属于你。');
          }

          words = groupSession.words;
          restoredSession = groupSession.session;
        } else if (!options.libraryId || !options.officialMode) {
          const groupSession = await fetchLearningGroupSession(user.id, groupId).catch((error) => {
            console.error('Failed to hydrate preloaded learning group metadata:', error);
            return null;
          });
          restoredSession = groupSession?.session ?? null;
        }

        if (words.length === 0) {
          throw new Error('这组词还没有可学习的内容。');
        }

        let restoredOrInitialSession: PersistedLearningSession = {
          ...(restoredSession ?? {
            ...createInitialLearningSession(groupId, words),
            libraryId: options.libraryId ?? null,
            officialMode: options.officialMode ?? null,
          }),
          libraryId: restoredSession?.libraryId ?? options.libraryId ?? null,
          officialMode: restoredSession?.officialMode ?? options.officialMode ?? null,
          lastActiveAt: new Date().toISOString(),
        };

        if (restoredOrInitialSession.round === 'round2' && !recallRoundEnabled) {
          const scopedWords = filterWordsToRound1Confirmed(words, restoredOrInitialSession.round1ConfirmedWordIds);
          await markLearningGroupWordsRoundCompleted(
            groupId,
            scopedWords.map((word) => word.id),
            'round2',
          ).catch((error) => {
            console.error('Failed to mark restored recall word progress as skipped:', error);
            throw error;
          });
          await markRoutineStepCompleted(user.id, {
            step: 'round1',
            groupId,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark round1 before skipping restored recall:', error);
          });
          await markRoutineStepCompleted(user.id, {
            step: 'round2',
            groupId,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark restored recall as skipped:', error);
          });

          if (!dictationRoundEnabled) {
            await markLearningGroupWordsRoundCompleted(
              groupId,
              scopedWords.map((word) => word.id),
              'round3',
            ).catch((error) => {
              console.error('Failed to mark restored dictation word progress as skipped:', error);
              throw error;
            });
            await markRoutineStepCompleted(user.id, {
              step: 'round3',
              groupId,
              timeZone: resolveBrowserTimeZone(),
            }).catch((error) => {
              console.error('Failed to mark restored dictation as skipped:', error);
            });
            await clearLearningGroupSession(user.id, groupId, { markCompleted: true }).catch((error) => {
              console.error('Failed to close restored recall/dictation-skipped learning session:', error);
            });
            invalidateLibraryCache(user.id);
            resetActiveLearningState();
            navigateWithFreshHomeStats('/app/home');
            return;
          }

          restoredOrInitialSession = {
            ...createInitialLearningSession(groupId, scopedWords, 'round3'),
            round1ConfirmedWordIds:
              restoredOrInitialSession.round1ConfirmedWordIds.length > 0
                ? restoredOrInitialSession.round1ConfirmedWordIds
                : scopedWords.map((word) => word.id),
            libraryId: restoredOrInitialSession.libraryId ?? null,
            officialMode: restoredOrInitialSession.officialMode ?? null,
          };
        }

        if (restoredOrInitialSession.round === 'round3' && !dictationRoundEnabled) {
          const scopedWords = filterWordsToRound1Confirmed(words, restoredOrInitialSession.round1ConfirmedWordIds);
          await markLearningGroupWordsRoundCompleted(
            groupId,
            scopedWords.map((word) => word.id),
            'round3',
          ).catch((error) => {
            console.error('Failed to mark restored dictation word progress as skipped:', error);
            throw error;
          });
          await markRoutineStepCompleted(user.id, {
            step: 'round3',
            groupId,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark restored dictation as skipped:', error);
          });
          await clearLearningGroupSession(user.id, groupId, { markCompleted: true }).catch((error) => {
            console.error('Failed to close restored dictation-skipped learning session:', error);
          });
          invalidateLibraryCache(user.id);
          resetActiveLearningState();
          navigateWithFreshHomeStats('/app/home');
          return;
        }

        if (!ARTICLE_REINFORCEMENT_ENABLED && restoredOrInitialSession.round === 'article') {
          await clearLearningGroupSession(user.id, groupId, { markCompleted: true }).catch((error) => {
            console.error('Failed to close article-only learning session:', error);
          });
          invalidateLibraryCache(user.id);
          resetActiveLearningState();
          navigateWithFreshHomeStats('/app/home');
          return;
        }

        let nextSession = restoredOrInitialSession;
        let sessionWords = words;
        if (nextSession.round !== 'round1') {
          sessionWords = filterWordsToRound1Confirmed(words, nextSession.round1ConfirmedWordIds);
          if (sessionWords.length !== words.length) {
            nextSession = normalizePersistedLearningSession(nextSession, sessionWords);
          }
        }

        setReviewSummary([]);
        setArticleGenerationError('');
        officialAppendPreloadKeyRef.current = null;
        setActiveWords(sessionWords);
        activeLearningGroupIdRef.current = groupId;
        setActiveLearningGroupId(groupId);
        lastSessionChangeSignatureRef.current = buildLearningProgressSignature(groupId, nextSession);
        setActiveSessionSeed(nextSession);
        const persistedArticle = parsePersistedArticleContent(nextSession.article);
        const cachedArticle = getCachedArticle(groupId, sessionWords);
        const restoredArticle = cachedArticle ?? persistedArticle;
        if (restoredArticle) {
          setCachedArticle(groupId, sessionWords, restoredArticle);
        }
        setArticleSentences(nextSession.round === 'article' ? restoredArticle : null);
        setRound(nextSession.round);
        navigate('/app/session');

        await persistLearningGroupSession(user.id, nextSession);
        invalidateLibraryCache(user.id);
        if (isCoreLearningRound(nextSession.round)) {
          trackLearningHomeSync(
            bindRoutineMainLearningGroup(user.id, {
              groupId,
              round: nextSession.round,
              timeZone: resolveBrowserTimeZone(),
            })
              .catch((error) => {
                console.error('Failed to bind daily routine main learning group:', error);
              })
              .then(() => undefined),
          );
        } else {
          markHomeOverviewDirty();
        }

        if (
          articleReinforcementEnabled &&
          (nextSession.round === 'round3' || nextSession.round === 'article') &&
          !restoredArticle
        ) {
          void ensureArticleForGroup(groupId, sessionWords);
        }
      } catch (error) {
        console.error('Failed to open learning group:', error);
        setSessionStartError(error instanceof Error ? error.message : '打开这组词时出了点问题，请再试一次。');
      } finally {
        setIsStartingSession(false);
      }
    },
    [
      articleReinforcementEnabled,
      dictationRoundEnabled,
      ensureArticleForGroup,
      markHomeOverviewDirty,
      navigate,
      navigateWithFreshHomeStats,
      recallRoundEnabled,
      resetActiveLearningState,
      setActiveSessionSeed,
      trackLearningHomeSync,
      user,
    ],
  );

  const tryOpenFreshOfficialActiveGroup = useCallback(
    async (target: OfficialLearningStartTarget, requestedMode: OfficialStudyMode) => {
      if (!user) return true;

      setIsStartingSession(true);
      setSessionStartError('');
      try {
        const resumeTargets = await fetchOfficialResumeTargets(user.id, target.libraryId);
        const activeTarget = resumeTargets.active;
        if (!activeTarget) return false;

        const activeMode = activeTarget.officialMode ?? target.mode;
        if (requestedMode !== activeMode) {
          await reorderActiveOfficialGroup({
            libraryId: target.libraryId,
            groupId: activeTarget.groupId,
            mode: requestedMode,
          });
          invalidateLibraryCache(user.id);
          void fetchStats({ forceRefresh: true });
        }

        await openLearningGroup(activeTarget.groupId);
        return true;
      } catch (error) {
        console.error('Failed to confirm active official learning group:', error);
        setSessionStartError(error instanceof Error ? error.message : '同步当前官方词库进度时出了点问题，请再试一次。');
        return true;
      } finally {
        setIsStartingSession(false);
      }
    },
    [fetchStats, openLearningGroup, user],
  );

  const handleStart = async (selection: HomeStartSelection = {}) => {
    if (!user) return;

    setSessionStartError('');
    const routineCard = homeStats.routineCard;
    const selectedOfficialOption = selection.libraryId
      ? (routineCard.officialLibraryOptions.find((option) => option.libraryId === selection.libraryId) ?? null)
      : null;

    if (routineCard.ctaMode === 'open_library') {
      navigate('/app/library');
      return;
    }

    if (routineCard.ctaMode === 'start_review' || routineCard.ctaMode === 'continue_review') {
      setIsStartingSession(true);
      try {
        const recovery = readLocal<ReviewRecovery>(`lumina.review-recovery.v1.${user.id}`);
        const dueWords = recovery?.words?.length ? recovery.words : await fetchDueReviewWords();
        if (dueWords.length === 0) {
          await fetchStats({ forceRefresh: true });
          return;
        }

        await markRoutineReviewStarted(user.id, {
          timeZone: resolveBrowserTimeZone(),
          startingDueCount: dueWords.length,
        }).catch((error) => {
          console.error('Failed to mark review step as started:', error);
        });

        setReviewSummary([]);
        cancelArticleGeneration();
        activeLearningGroupIdRef.current = null;
        setActiveLearningGroupId(null);
        setActiveSessionSeed(null);
        setActiveWords(dueWords);
        setActiveReviewRecovery(recovery?.words?.length ? recovery : null);
        setArticleSentences(null);
        setRound('review');
        navigate('/app/session');
      } catch (error) {
        console.error('Failed to start review session:', error);
        setSessionStartError(error instanceof Error ? error.message : '开始复习时出了点问题，请再试一次。');
      } finally {
        setIsStartingSession(false);
      }
      return;
    }

    if (!hasTrustedHomeStatsRef.current) {
      setSessionStartError('首页学习数据还在同步，请稍等一下再继续。');
      void fetchStats({ forceRefresh: true });
      return;
    }

    if (routineCard.ctaMode === 'continue_learning') {
      const targetGroupId = routineCard.boundLearningGroupId;
      if (targetGroupId) {
        await openLearningGroup(targetGroupId);
        return;
      }

      if (selectedOfficialOption) {
        const targetMode = selection.mode ?? selectedOfficialOption.mode;
        if (await tryOpenFreshOfficialActiveGroup(selectedOfficialOption, targetMode)) {
          return;
        }

        setIsStartingSession(true);
        try {
          const result = await startNextOfficialBatch({
            userId: user.id,
            libraryId: selectedOfficialOption.libraryId,
            mode: targetMode,
            existingGroupCount: selectedOfficialOption.existingGroupCount,
          });

          if (!result) {
            navigate('/app/library?tab=system');
            return;
          }

          await openLearningGroup(result.groupId, result.words, {
            libraryId: result.libraryId,
            officialMode: result.mode,
          });
        } catch (error) {
          console.error('Failed to auto-start selected official batch:', error);
          setSessionStartError(error instanceof Error ? error.message : '开始下一组官方词时出了点问题，请再试一次。');
        } finally {
          setIsStartingSession(false);
        }
        return;
      }

      const libraryId = routineCard.lastUsedOfficialLibraryId;
      if (libraryId) {
        const targetMode = routineCard.lastUsedOfficialMode ?? 'sequential';
        if (
          await tryOpenFreshOfficialActiveGroup(
            {
              libraryId,
              mode: targetMode,
              existingGroupCount: routineCard.lastUsedOfficialGroupCount,
            },
            targetMode,
          )
        ) {
          return;
        }

        setIsStartingSession(true);
        try {
          const result = await startNextOfficialBatch({
            userId: user.id,
            libraryId,
            mode: targetMode,
            existingGroupCount: routineCard.lastUsedOfficialGroupCount,
          });

          if (!result) {
            navigate('/app/library');
            return;
          }

          await openLearningGroup(result.groupId, result.words, {
            libraryId: result.libraryId,
            officialMode: result.mode,
          });
        } catch (error) {
          console.error('Failed to auto-start next official batch:', error);
          setSessionStartError(error instanceof Error ? error.message : '开始下一组官方词时出了点问题，请再试一次。');
        } finally {
          setIsStartingSession(false);
        }
        return;
      }
    }

    if (routineCard.ctaMode === 'start_learning') {
      if (selectedOfficialOption) {
        const targetMode = selection.mode ?? selectedOfficialOption.mode;
        if (await tryOpenFreshOfficialActiveGroup(selectedOfficialOption, targetMode)) {
          return;
        }

        setIsStartingSession(true);
        try {
          const result = await startNextOfficialBatch({
            userId: user.id,
            libraryId: selectedOfficialOption.libraryId,
            mode: targetMode,
            existingGroupCount: selectedOfficialOption.existingGroupCount,
          });

          if (result) {
            await openLearningGroup(result.groupId, result.words, {
              libraryId: result.libraryId,
              officialMode: result.mode,
            });
            return;
          }
        } catch (error) {
          console.error('Failed to start selected official batch:', error);
          setSessionStartError(error instanceof Error ? error.message : '开始官方词库时出了点问题，请再试一次。');
        } finally {
          setIsStartingSession(false);
        }
      }
      navigate('/app/library?tab=system');
      return;
    }

    navigate('/app/library?tab=system');
  };

  const handleDeleteOfficialLibrary = useCallback(
    async (libraryId: OfficialLibraryId) => {
      if (!user) return;

      setSessionStartError('');
      const deletedActiveSession = activeSessionSeedRef.current?.libraryId === libraryId;
      const result = await deleteOfficialLearningLibrary(libraryId, resolveBrowserTimeZone());
      const activeGroupPreserved = Boolean(
        activeLearningGroupIdRef.current && result.preservedRoutineGroupIds?.includes(activeLearningGroupIdRef.current),
      );

      invalidateLibraryCache(user.id);
      if (deletedActiveSession && !activeGroupPreserved) {
        resetActiveLearningState();
      }

      await fetchStats({ forceRefresh: true });
      return result;
    },
    [fetchStats, resetActiveLearningState, user],
  );

  const handleStartLearningGroup = useCallback(
    async (groupId: string, words?: Word[]) => {
      await openLearningGroup(groupId, words);
    },
    [openLearningGroup],
  );

  const handleLearningSessionChange = useCallback(
    (session: LearningSessionSnapshot) => {
      if (!activeLearningGroupId || !user) return;

      const currentSeed = activeSessionSeedRef.current;
      if (isStaleLearningProgressSnapshot(currentSeed, session, activeLearningGroupId)) {
        return;
      }

      const lastActiveAt = new Date().toISOString();
      const currentWords = activeWordsRef.current;
      const scopedWords =
        session.round === 'round1'
          ? currentWords
          : filterWordsToRound1Confirmed(currentWords, session.round1ConfirmedWordIds);
      const sessionSeed = normalizePersistedLearningSession(
        {
          groupId: activeLearningGroupId,
          round: session.round,
          currentIndex: session.currentIndex,
          queueWordIds: session.queueWordIds,
          passedQueueIndices: session.passedQueueIndices,
          round1ConfirmedWordIds: session.round1ConfirmedWordIds,
          lastActiveAt,
          groupCompleted: currentSeed?.groupCompleted ?? false,
          completedAt: currentSeed?.completedAt ?? null,
          libraryId: currentSeed?.libraryId ?? null,
          officialMode: currentSeed?.officialMode ?? null,
          article: currentSeed?.article ?? null,
        },
        scopedWords,
      );
      const normalizedSnapshot: LearningSessionSnapshot = {
        round: sessionSeed.round,
        currentIndex: sessionSeed.currentIndex,
        queueWordIds: sessionSeed.queueWordIds,
        passedQueueIndices: sessionSeed.passedQueueIndices,
        round1ConfirmedWordIds: sessionSeed.round1ConfirmedWordIds,
      };
      const nextSignature = buildLearningProgressSignature(activeLearningGroupId, normalizedSnapshot);
      if (lastSessionChangeSignatureRef.current === nextSignature) {
        return;
      }

      if (isSameLearningProgressSnapshot(currentSeed, normalizedSnapshot, activeLearningGroupId)) {
        lastSessionChangeSignatureRef.current = nextSignature;
        return;
      }

      if (scopedWords.length !== currentWords.length) {
        activeWordsRef.current = scopedWords;
        setActiveWords(scopedWords);
      }

      lastSessionChangeSignatureRef.current = nextSignature;
      setActiveSessionSeed(sessionSeed);

      cacheLearningRecovery(user.id, activeLearningGroupId, {
        groupTitle: '',
        words: scopedWords,
        session: sessionSeed,
      });

      const persistSessionPromise = persistLearningGroupSession(user.id, sessionSeed).catch((error) => {
        console.error('Failed to persist learning session snapshot:', error);
      });
      const newlyConfirmedWordIds = getNewRound1ConfirmedWordIds(
        currentSeed?.groupId === activeLearningGroupId ? currentSeed.round1ConfirmedWordIds : [],
        sessionSeed.round1ConfirmedWordIds,
      );
      const markRound1ProgressPromise =
        newlyConfirmedWordIds.length > 0
          ? markLearningGroupWordsRound1Confirmed(activeLearningGroupId, newlyConfirmedWordIds, {
              round2Required: recallRoundEnabled,
              round3Required: dictationRoundEnabled,
            })
              .then(() => {
                invalidateLibraryCache(user.id);
              })
              .catch((error) => {
                console.error('Failed to sync round1 confirmed word progress:', error);
              })
          : Promise.resolve();
      const bindRoutinePromise = isCoreLearningRound(sessionSeed.round)
        ? bindRoutineMainLearningGroup(user.id, {
            groupId: activeLearningGroupId,
            round: sessionSeed.round,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to refresh daily routine main learning group:', error);
          })
        : Promise.resolve();
      trackLearningHomeSync(
        Promise.all([persistSessionPromise, markRound1ProgressPromise, bindRoutinePromise]).then(() => undefined),
      );

      const libraryId = sessionSeed.libraryId;
      const mode = sessionSeed.officialMode;
      const confirmedCount = session.round1ConfirmedWordIds.length;
      const remainingLoadedCount = session.queueWordIds.length - confirmedCount;
      const officialAppendInput =
        libraryId && mode
          ? {
              userId: user.id,
              groupId: activeLearningGroupId,
              libraryId,
              mode,
              existingGroupCount:
                stats.routineCard.officialLibraryOptions.find((item) => item.libraryId === libraryId)
                  ?.existingGroupCount ?? stats.routineCard.lastUsedOfficialGroupCount,
            }
          : null;
      const appendPreloadKey = `${activeLearningGroupId}:${session.queueWordIds.length}:preload`;
      if (
        session.round === 'round1' &&
        officialAppendInput &&
        remainingLoadedCount <= OFFICIAL_APPEND_PRELOAD_REMAINING_THRESHOLD &&
        officialAppendPreloadKeyRef.current !== appendPreloadKey
      ) {
        officialAppendPreloadKeyRef.current = appendPreloadKey;
        void preloadNextOfficialBatchForAppend(officialAppendInput).catch((error) => {
          officialAppendPreloadKeyRef.current = null;
          console.error('Failed to preload next official batch:', error);
        });
      }
    },
    [
      activeLearningGroupId,
      dictationRoundEnabled,
      recallRoundEnabled,
      stats.routineCard,
      setActiveSessionSeed,
      trackLearningHomeSync,
      user,
    ],
  );

  const handleSessionWordMastered = useCallback(
    (_wordId: string) => {
      // LearningEngine 已经在本地队列里即时删掉该词；这里不要改 activeWords。
      // 改 props 会触发引擎按旧 session 重新初始化，导致 Round1 进度条回退。

      if (user) {
        invalidateLibraryCache(user.id);
        void fetchStats({ forceRefresh: true });
      }
    },
    [fetchStats, user],
  );

  const handleSessionWordMasteredRollback = useCallback(
    (_word: Word) => {
      if (user) {
        invalidateLibraryCache(user.id);
        void fetchStats({ forceRefresh: true });
      }
    },
    [fetchStats, user],
  );

  const handleRoundComplete = useCallback(
    async (completedSession?: LearningSessionSnapshot) => {
      if (round === 'review') {
        if (user) writeLocal(`lumina.review-recovery.v1.${user.id}`, null);
        await attemptBuffer.flush();

        if (user) {
          await markRoutineStepCompleted(user.id, {
            step: 'review',
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark review step as completed:', error);
          });
        }
        navigate('/app/review-results');
        return;
      }

      if (!activeLearningGroupId || !user) {
        return;
      }

      const currentActiveWords = activeWordsRef.current;
      const scopedActiveWords = filterWordsToRound1Confirmed(
        currentActiveWords,
        activeSessionSeed?.round1ConfirmedWordIds ?? [],
      );
      const ensureScopedActiveWords = () => {
        if (scopedActiveWords.length === currentActiveWords.length) return;
        activeWordsRef.current = scopedActiveWords;
        setActiveWords(scopedActiveWords);
      };

      if (currentActiveWords.length === 0) {
        await clearLearningGroupSession(user.id, activeLearningGroupId, { markCompleted: true }).catch((error) => {
          console.error('Failed to close all-mastered learning session:', error);
        });
        invalidateLibraryCache(user.id);
        resetActiveLearningState();
        navigateWithFreshHomeStats('/app/home');
        return;
      }

      if (round === 'round1') {
        const confirmedWordIds = normalizeSessionRound1ConfirmedWordIds(
          completedSession?.round1ConfirmedWordIds ?? activeSessionSeed?.round1ConfirmedWordIds ?? [],
        );
        const confirmedWordIdSet = new Set(confirmedWordIds);
        const nextWords = currentActiveWords.filter((word) => confirmedWordIdSet.has(word.id));

        if (nextWords.length === 0) {
          setSessionStartError(
            recallRoundEnabled
              ? '至少确认 1 个词后，才能进入 Round 2 回忆。'
              : dictationRoundEnabled
                ? '至少确认 1 个词后，才能进入 Round 3 听写。'
                : '至少确认 1 个词后，才能完成本组。',
          );
          return;
        }

        if (activeSessionSeed?.libraryId) {
          await trimLearningGroupToWordIds(
            user.id,
            activeLearningGroupId,
            nextWords.map((word) => word.id),
          ).catch((error) => {
            console.error('Failed to trim unconfirmed official words:', error);
            throw error;
          });
        }

        await markLearningGroupWordsRound1Confirmed(
          activeLearningGroupId,
          nextWords.map((word) => word.id),
          {
            round2Required: recallRoundEnabled,
            round3Required: dictationRoundEnabled,
          },
        ).catch((error) => {
          console.error('Failed to mark round1 word progress:', error);
          throw error;
        });

        activeWordsRef.current = nextWords;
        setActiveWords(nextWords);

        await markRoutineStepCompleted(user.id, {
          step: 'round1',
          groupId: activeLearningGroupId,
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to mark round1 as completed:', error);
        });

        if (!recallRoundEnabled) {
          await markRoutineStepCompleted(user.id, {
            step: 'round2',
            groupId: activeLearningGroupId,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark skipped recall as completed:', error);
          });
        }

        if (!dictationRoundEnabled && !recallRoundEnabled) {
          await markRoutineStepCompleted(user.id, {
            step: 'round3',
            groupId: activeLearningGroupId,
            timeZone: resolveBrowserTimeZone(),
          }).catch((error) => {
            console.error('Failed to mark skipped dictation as completed:', error);
          });
          await clearLearningGroupSession(user.id, activeLearningGroupId, { markCompleted: true }).catch((error) => {
            console.error('Failed to close recall/dictation-skipped learning session:', error);
          });
          invalidateLibraryCache(user.id);
          resetActiveLearningState();
          navigateWithFreshHomeStats('/app/home');
          return;
        }

        const nextRound: LearningRoundType = recallRoundEnabled ? 'round2' : 'round3';
        const nextSession: PersistedLearningSession = {
          ...createInitialLearningSession(activeLearningGroupId, nextWords, nextRound),
          round1ConfirmedWordIds: nextWords.map((word) => word.id),
          libraryId: activeSessionSeed?.libraryId ?? null,
          officialMode: activeSessionSeed?.officialMode ?? null,
        };

        setActiveSessionSeed(nextSession);
        lastSessionChangeSignatureRef.current = buildLearningProgressSignature(activeLearningGroupId, nextSession);
        setRound(nextRound);
        trackLearningHomeSync(
          persistLearningGroupSession(user.id, nextSession).catch((error) => {
            console.error('Failed to persist round transition:', error);
          }),
        );
        return;
      }

      const finishLearningSession = async () => {
        await clearLearningGroupSession(user.id, activeLearningGroupId, { markCompleted: true }).catch((error) => {
          console.error('Failed to close learning session:', error);
        });
        invalidateLibraryCache(user.id);
        resetActiveLearningState();
        navigateWithFreshHomeStats('/app/home');
      };

      const advanceToArticle = (completedAt: string, groupCompleted: boolean) => {
        ensureScopedActiveWords();
        const nextSession: PersistedLearningSession = {
          ...createInitialLearningSession(activeLearningGroupId, scopedActiveWords, 'article', {
            groupCompleted,
            completedAt,
          }),
          round1ConfirmedWordIds: activeSessionSeed?.round1ConfirmedWordIds ?? scopedActiveWords.map((word) => word.id),
          libraryId: activeSessionSeed?.libraryId ?? null,
          officialMode: activeSessionSeed?.officialMode ?? null,
        };
        const cachedArticle = getCachedArticle(activeLearningGroupId, scopedActiveWords);
        setActiveSessionSeed(nextSession);
        lastSessionChangeSignatureRef.current = buildLearningProgressSignature(activeLearningGroupId, nextSession);
        setRound('article');
        setArticleSentences(cachedArticle);
        invalidateLibraryCache(user.id);
        void persistLearningGroupSession(user.id, nextSession).catch((error) => {
          console.error('Failed to persist article transition:', error);
        });
        if (!cachedArticle) {
          void ensureArticleForGroup(activeLearningGroupId, scopedActiveWords);
        }
      };

      if (round === 'round2') {
        const completedAt = new Date().toISOString();
        await markLearningGroupWordsRoundCompleted(
          activeLearningGroupId,
          scopedActiveWords.map((word) => word.id),
          'round2',
        ).catch((error) => {
          console.error('Failed to mark round2 word progress:', error);
          throw error;
        });

        await markRoutineStepCompleted(user.id, {
          step: 'round2',
          groupId: activeLearningGroupId,
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to mark round2 as completed:', error);
        });

        if (dictationRoundEnabled) {
          ensureScopedActiveWords();
          const nextSession: PersistedLearningSession = {
            ...createInitialLearningSession(activeLearningGroupId, scopedActiveWords, 'round3'),
            round1ConfirmedWordIds:
              activeSessionSeed?.round1ConfirmedWordIds ?? scopedActiveWords.map((word) => word.id),
            libraryId: activeSessionSeed?.libraryId ?? null,
            officialMode: activeSessionSeed?.officialMode ?? null,
          };

          setActiveSessionSeed(nextSession);
          lastSessionChangeSignatureRef.current = buildLearningProgressSignature(activeLearningGroupId, nextSession);
          setRound('round3');
          invalidateLibraryCache(user.id);
          void persistLearningGroupSession(user.id, nextSession).catch((error) => {
            console.error('Failed to persist dictation transition:', error);
          });
          if (articleReinforcementEnabled) {
            void ensureArticleForGroup(activeLearningGroupId, scopedActiveWords);
          }
          return;
        }

        await markRoutineStepCompleted(user.id, {
          step: 'round3',
          groupId: activeLearningGroupId,
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to mark skipped dictation as completed:', error);
        });
        await markLearningGroupWordsRoundCompleted(
          activeLearningGroupId,
          scopedActiveWords.map((word) => word.id),
          'round3',
        ).catch((error) => {
          console.error('Failed to mark skipped dictation word progress:', error);
          throw error;
        });

        if (articleReinforcementEnabled) {
          advanceToArticle(completedAt, true);
          return;
        }

        await finishLearningSession();
        return;
      }

      if (round === 'round3') {
        const completedAt = new Date().toISOString();
        await attemptBuffer.flush();
        await markLearningGroupWordsRoundCompleted(
          activeLearningGroupId,
          scopedActiveWords.map((word) => word.id),
          'round3',
        ).catch((error) => {
          console.error('Failed to mark round3 word progress:', error);
          throw error;
        });

        await markRoutineStepCompleted(user.id, {
          step: 'round3',
          groupId: activeLearningGroupId,
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to mark round3 as completed:', error);
        });

        if (articleReinforcementEnabled) {
          advanceToArticle(completedAt, true);
          return;
        }

        await finishLearningSession();
        return;
      }

      await finishLearningSession();
    },
    [
      activeLearningGroupId,
      activeSessionSeed?.libraryId,
      activeSessionSeed?.officialMode,
      activeSessionSeed?.round1ConfirmedWordIds,
      articleReinforcementEnabled,
      ensureArticleForGroup,
      dictationRoundEnabled,
      navigate,
      navigateWithFreshHomeStats,
      recallRoundEnabled,
      resetActiveLearningState,
      round,
      setActiveSessionSeed,
      trackLearningHomeSync,
      user,
    ],
  );

  const handleReviewResultsBackHome = () => {
    setReviewSummary([]);
    setSessionStartError('');
    resetActiveLearningState();
    navigateWithFreshHomeStats('/app/home');
  };

  const handleRetryArticleGeneration = useCallback(() => {
    if (!activeLearningGroupId || activeWords.length === 0) return;

    cancelArticleGeneration(activeLearningGroupId);
    setArticleGenerationError('');
    setArticleSentences(null);
    void ensureArticleForGroup(activeLearningGroupId, activeWords);
  }, [activeLearningGroupId, activeWords, cancelArticleGeneration, ensureArticleForGroup]);

  const round1CanWaitForMoreWords = false;

  const handleSignOut = async () => {
    resetActiveLearningState();
    setReviewSummary([]);
    setSessionStartError('');
    await signOut();
    window.location.assign('/');
  };

  const activeNavPath = (() => {
    if (location.pathname.startsWith('/app/library')) return '/app/library';
    if (location.pathname.startsWith('/app/ielts')) return '/app/ielts';
    if (location.pathname.startsWith('/app/import')) return '/app/library';
    if (location.pathname.startsWith('/app/notebook')) return '/app/notebook';
    if (location.pathname.startsWith('/app/settings')) return '/app/settings';
    if (location.pathname.startsWith('/app/profile')) return '/app/profile';
    return '/app/home';
  })();

  const handleSidebarNavigate = useCallback(
    (targetPath: string) => {
      const hasPendingHomeSync = pendingLearningHomeSyncsRef.current.size > 0;
      if (
        shouldForceHomeRefreshForNavigation(
          location.pathname,
          targetPath,
          homeOverviewDirtyRef.current || hasPendingHomeSync,
        )
      ) {
        navigateWithFreshHomeStats(targetPath);
        return;
      }

      navigate(targetPath);
    },
    [location.pathname, navigate, navigateWithFreshHomeStats],
  );

  useEffect(() => {
    if (!isSessionRoute) {
      setIsSessionSettingsOpen(false);
      cancelArticleGeneration();
    }
  }, [cancelArticleGeneration, isSessionRoute]);

  useEffect(() => {
    if (
      !user ||
      !articleReinforcementEnabled ||
      !activeLearningGroupId ||
      activeWords.length === 0 ||
      articleGenerationError ||
      (round !== 'round3' && round !== 'article') ||
      (round === 'article' && articleSentences !== null)
    ) {
      return;
    }

    void ensureArticleForGroup(activeLearningGroupId, activeWords);
  }, [
    activeLearningGroupId,
    activeWords,
    articleGenerationError,
    articleSentences,
    articleReinforcementEnabled,
    ensureArticleForGroup,
    round,
    user,
  ]);

  useEffect(() => {
    if (!isSessionSettingsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSessionSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSessionSettingsOpen]);

  const sessionSettingsButton = isSessionRoute ? (
    <button
      type="button"
      data-session-settings-toggle
      aria-label={isSessionSettingsOpen ? '关闭学习节奏设置' : '打开学习节奏设置'}
      aria-pressed={isSessionSettingsOpen}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setIsSessionSettingsOpen((prev) => !prev);
      }}
      className={cx(
        'flex h-6 w-6 shrink-0 items-center justify-center text-[#8f826d] transition-colors hover:text-[#4f46e5] active:text-[#4f46e5]',
        isSessionSettingsOpen && 'text-[#4f46e5]',
      )}
    >
      <Settings className="h-6 w-6" strokeWidth={2.25} />
    </button>
  ) : null;

  const sessionBackButton = isSessionRoute ? (
    <button
      type="button"
      data-session-back-button
      aria-label="返回"
      title="返回"
      onClick={() => {
        navigateWithFreshHomeStats(lastNonSessionAppPathRef.current || '/app/home');
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-white/80 bg-white/80 text-[#4f46e5] shadow-[0_6px_14px_rgba(79,70,229,0.14)] backdrop-blur-xl transition-all active:scale-95"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2.8} />
    </button>
  ) : null;

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!isSessionRoute) {
      sessionAutoRestoreRef.current = null;
      return;
    }

    if (user && activeWords.length === 0 && readLocal(`lumina.last-session-mode.v1.${user.id}`) === 'review') {
      const recovery = readLocal<ReviewRecovery>(`lumina.review-recovery.v1.${user.id}`);
      if (recovery?.words?.length) {
        setActiveWords(recovery.words);
        setActiveReviewRecovery(recovery);
        setActiveLearningGroupId(null);
        setActiveSessionSeed(null);
        setRound('review');
        return;
      }
    }

    const resumeGroupId =
      (user ? readLocal<string>(`lumina.last-learning.v1.${user.id}`) : null) ??
      (stats.routineCard.ctaMode === 'continue_learning' ? stats.routineCard.boundLearningGroupId : null);

    if (!user || activeWords.length > 0 || isStartingSession || !resumeGroupId) {
      return;
    }

    if (sessionAutoRestoreRef.current === resumeGroupId) {
      return;
    }

    sessionAutoRestoreRef.current = resumeGroupId;
    void openLearningGroup(resumeGroupId);
  }, [
    activeWords.length,
    isSessionRoute,
    isStartingSession,
    openLearningGroup,
    setActiveSessionSeed,
    stats.routineCard.boundLearningGroupId,
    stats.routineCard.ctaMode,
    user,
  ]);

  const sessionEmptyState = (
    <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center shadow-xl">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">这里还没有内容</p>
      <h2 className="mt-4 text-3xl font-black text-text-primary">回到首页，查看今天的学习安排。</h2>
      <IslandButton
        onClick={() => {
          navigateWithFreshHomeStats('/app/home');
        }}
        className="mt-8"
        tone="mint"
        size="large"
      >
        回到首页
      </IslandButton>
    </div>
  );

  return (
    <SavedWordsProvider>
      <WordPopoverProvider>
        <div className="lumina-app-shell min-h-screen flex selection:bg-apple-blue/20">
          <AmbientBackground />
          {!isIeltsTestRoute && (
            <Sidebar activePath={activeNavPath} onNavigate={handleSidebarNavigate} hideOnMobile={isSessionRoute} />
          )}
          <WhatsNewModal />

          <div className="flex-1 relative h-screen overflow-hidden">
            <main
              ref={mainScrollRef}
              onPointerDownCapture={(event) => {
                if (!isSessionRoute || !isSessionSettingsOpen) return;
                const target = event.target as HTMLElement;
                if (target.closest('[data-session-settings-toggle], [data-session-back-button]')) return;
                setIsSessionSettingsOpen(false);
                event.preventDefault();
                event.stopPropagation();
              }}
              className={cx(
                'lumina-app-main h-full overflow-y-auto relative z-10',
                isSessionRoute
                  ? 'session-main px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-6 md:pt-7 md:pb-7 lg:pl-[10.25rem] lg:pr-8 xl:pl-[10.75rem] xl:pr-10'
                  : isIeltsTestRoute
                    ? 'px-0 py-0'
                    : isHomeRoute
                      ? 'px-4 pt-4 pb-28 sm:px-6 lg:px-6 lg:py-8 lg:pl-[10.25rem] lg:pr-8 xl:pl-[10.75rem] xl:pr-10'
                      : 'px-4 pt-4 pb-28 sm:px-6 lg:px-6 lg:py-8 lg:pl-[10.25rem] lg:pr-8 xl:pl-[10.75rem] xl:pr-10',
              )}
            >
              <div
                className={cx(
                  'min-h-full',
                  isSessionRoute
                    ? 'session-route-shell mx-auto flex h-full min-h-0 w-full max-w-[1460px] flex-col'
                    : 'flex w-full flex-col',
                )}
              >
                {sessionStartError && (
                  <div className="mx-auto mb-4 flex w-full max-w-6xl items-start gap-3 rounded-[28px] border border-apple-red/15 bg-apple-red/8 px-5 py-4 text-apple-red shadow-xl">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black">这组学习没有开始</p>
                      <p className="mt-1 text-sm leading-6">{sessionStartError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSessionStartError('')}
                      className="text-sm font-bold text-apple-red/80 transition-colors hover:text-apple-red"
                    >
                      关闭
                    </button>
                  </div>
                )}
                <div className={cx(isSessionRoute && 'flex-1 min-h-0')}>
                  <Suspense fallback={<LoadingShell isSkeleton={location.pathname.includes('/library')} />}>
                    <Routes>
                      <Route
                        path="home"
                        element={
                          <HomeView
                            stats={homeStats}
                            onSelectOrbitDate={handleSelectOrbitDate}
                            onStart={(selection) => {
                              void handleStart(selection);
                            }}
                            onOpenOfficialLibrary={() => navigate('/app/library?tab=system')}
                            onDeleteOfficialLibrary={handleDeleteOfficialLibrary}
                            requestedOfficialLibraryId={requestedOfficialLibraryId}
                            isDataPending={!hasTrustedHomeStats && (isHomeStatsRefreshing || isHomeRoute)}
                            isLoading={isStartingSession}
                          />
                        }
                      />
                      <Route
                        path="library"
                        element={
                          <LibraryView
                            onLibraryMutated={() => {
                              void fetchStats({ forceRefresh: true });
                            }}
                            onStartLearningGroup={handleStartLearningGroup}
                          />
                        }
                      />
                      <Route
                        path="library/official/:libraryId?"
                        element={<OfficialLibraryDetailView onStartLearningGroup={handleStartLearningGroup} />}
                      />
                      <Route
                        path="library/group/:groupId"
                        element={
                          <LibraryGroupDetailView
                            isStartingLearningGroup={isStartingSession}
                            onLibraryMutated={() => {
                              void fetchStats({ forceRefresh: true });
                            }}
                            onStartLearningGroup={handleStartLearningGroup}
                          />
                        }
                      />
                      <Route
                        path="library/custom/:groupId"
                        element={
                          <LibraryGroupDetailView
                            isStartingLearningGroup={isStartingSession}
                            onLibraryMutated={() => {
                              void fetchStats({ forceRefresh: true });
                            }}
                            onStartLearningGroup={handleStartLearningGroup}
                          />
                        }
                      />
                      <Route
                        path="import"
                        element={
                          PERSONAL_VOCAB_IMPORT_ENABLED ? <ImportView /> : <Navigate to="/app/library" replace />
                        }
                      />
                      <Route path="ielts" element={<IeltsHomeView />} />
                      <Route path="ielts-reading" element={<IeltsReadingHomeView />} />
                      <Route path="ielts-reading/test/:testId" element={<IeltsReadingTestView />} />
                      <Route
                        path="ielts-listening"
                        element={
                          IELTS_LISTENING_ENABLED ? <IeltsListeningHomeView /> : <Navigate to="/app/ielts" replace />
                        }
                      />
                      <Route
                        path="ielts-listening/test/:testId"
                        element={
                          IELTS_LISTENING_ENABLED ? <IeltsListeningTestView /> : <Navigate to="/app/ielts" replace />
                        }
                      />
                      <Route path="notebook" element={<NotebookView />} />
                      <Route
                        path="session"
                        element={
                          activeWords.length === 0 ? (
                            sessionEmptyState
                          ) : round === 'article' && ARTICLE_REINFORCEMENT_ENABLED ? (
                            articleSentences === null ? (
                              articleGenerationError ? (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="glass p-16 rounded-apple-lg shadow-2xl flex flex-col items-center gap-6 text-center"
                                >
                                  <AlertCircle className="h-10 w-10 text-apple-red" />
                                  <div>
                                    <p className="font-black text-xl text-text-primary">文章暂时没有生成</p>
                                    <p className="mt-2 text-sm font-bold text-text-secondary">
                                      {articleGenerationError}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleRetryArticleGeneration}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-apple-blue px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-apple-blue/20 transition-transform active:scale-95"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                    再试一次
                                  </button>
                                </motion.div>
                              ) : (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  className="glass p-16 rounded-apple-lg shadow-2xl flex flex-col items-center gap-6"
                                >
                                  <Loader2 className="w-10 h-10 text-apple-green animate-spin" />
                                  <p className="font-black text-xl">正在准备收尾文章，失败后会自动重试 3 次</p>
                                </motion.div>
                              )
                            ) : (
                              <ArticleView
                                sentences={articleSentences}
                                words={activeWords}
                                onFinish={handleRoundComplete}
                              />
                            )
                          ) : (
                            <React.Fragment key={`${activeLearningGroupId ?? 'review'}:${round}`}>
                              <LearningEngine
                                userId={user?.id}
                                type={round}
                                words={activeWords}
                                initialSession={activeSessionSeed}
                                onComplete={handleRoundComplete}
                                onSessionChange={handleLearningSessionChange}
                                initialReviewRecovery={activeReviewRecovery}
                                onReviewChange={handleReviewChange}
                                onWordMastered={handleSessionWordMastered}
                                onWordMasteredRollback={handleSessionWordMasteredRollback}
                                sessionLeadingAction={sessionBackButton}
                                sessionActions={sessionSettingsButton}
                                round1CanWaitForMoreWords={round1CanWaitForMoreWords}
                              />
                            </React.Fragment>
                          )
                        }
                      />
                      <Route
                        path="review-results"
                        element={
                          <ReviewResultsView
                            items={[...reviewSummary].sort((left, right) => left.word.localeCompare(right.word))}
                            onBackHome={handleReviewResultsBackHome}
                          />
                        }
                      />
                      <Route
                        path="profile"
                        element={
                          <ProfileView
                            user={user}
                            stats={stats}
                            onSignOut={() => {
                              void handleSignOut();
                            }}
                          />
                        }
                      />
                      <Route path="settings" element={<SettingsView />} />
                      <Route path="*" element={<Navigate to="/app/home" replace />} />
                    </Routes>
                  </Suspense>
                </div>
              </div>
            </main>
            <SessionSettingsDrawer
              isOpen={isSessionRoute && isSessionSettingsOpen}
              onClose={() => setIsSessionSettingsOpen(false)}
            />
          </div>
        </div>
      </WordPopoverProvider>
    </SavedWordsProvider>
  );
}
