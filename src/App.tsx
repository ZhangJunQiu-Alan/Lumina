/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ActivityDay,
  ArticleSentence,
  LearningRoundType,
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
import { useAuth } from './contexts/AuthContext';
import { useLearningPreferences } from './contexts/LearningPreferencesContext';
import { SavedWordsProvider } from './contexts/SavedWordsContext';
import { WordPopoverProvider } from './contexts/WordPopoverContext';
import { apiFetch } from './lib/api';
import { invalidateLibraryCache } from './lib/libraryCache';
import { createInitialLearningSession, isCoreLearningRound } from './lib/learningSession';
import {
  clearLearningGroupSession,
  fetchGeneratedArticle,
  fetchLearningGroupSession,
  persistLearningGroupSession,
  upsertGeneratedArticle,
} from './lib/learningSessionApi';
import { getCachedArticle, setCachedArticle } from './lib/articleCache';
import {
  bindRoutineMainLearningGroup,
  markRoutineReviewStarted,
  markRoutineStepCompleted,
} from './lib/dailyRoutineApi';
import { cx } from './components/shared/LearningUI';
import { IslandButton, IslandIconButton } from './components/shared/AnimalPrimitives';
import { LibrarySkeleton } from './components/shared/Skeleton';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { fetchHomeOverview, resolveBrowserTimeZone } from './lib/homeApi';
import { startNextOfficialBatch } from './lib/officialLibraryStart';
import { toRoutineDateKey } from './lib/routineDate';
import { AI_CONTENT_FEATURES_ENABLED, PERSONAL_VOCAB_IMPORT_ENABLED } from './lib/aiFeatures';

// --- Lazy loaded views ---
const HomeView = lazy(() => import('./components/home/HomeView').then(m => ({ default: m.HomeView })));
const ImportView = lazy(() => import('./components/import/ImportView').then(m => ({ default: m.ImportView })));
const IeltsHomeView = lazy(() => import('./components/ielts/IeltsHomeView').then(m => ({ default: m.IeltsHomeView })));
const IeltsReadingHomeView = lazy(() => import('./components/ielts/IeltsReadingView').then(m => ({ default: m.IeltsReadingHomeView })));
const IeltsReadingTestView = lazy(() => import('./components/ielts/IeltsReadingView').then(m => ({ default: m.IeltsReadingTestView })));
const IeltsListeningHomeView = lazy(() => import('./components/ielts/IeltsListeningView').then(m => ({ default: m.IeltsListeningHomeView })));
const IeltsListeningTestView = lazy(() => import('./components/ielts/IeltsListeningView').then(m => ({ default: m.IeltsListeningTestView })));
const LibraryView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryView })));
const NotebookView = lazy(() => import('./components/notebook/NotebookView').then(m => ({ default: m.NotebookView })));
const ProfileView = lazy(() => import('./components/profile/ProfileView').then(m => ({ default: m.ProfileView })));
const OfficialLibraryDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.OfficialLibraryDetailView })));
const LibraryGroupDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryGroupDetailView })));
const ReviewResultsView = lazy(() => import('./components/review/ReviewResultsView').then(m => ({ default: m.ReviewResultsView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })));

// --- Core Learning Components (Extracted) ---
const LearningEngine = lazy(() => import('./components/learning/LearningEngine').then(m => ({ default: m.LearningEngine })));
const ArticleView = lazy(() => import('./components/learning/ArticleView').then(m => ({ default: m.ArticleView })));

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

function AmbientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute inset-x-0 top-0 h-64 bg-[linear-gradient(180deg,rgba(125,195,149,0.20),rgba(248,248,240,0))]" />
      <div className="absolute left-[-2rem] top-24 h-48 w-32 rotate-[-10deg] rounded-[70%_35%_70%_35%] border-2 border-apple-green/20 bg-apple-green/8 animate-fluid" />
      <div className="absolute right-[-1rem] top-36 h-40 w-28 rotate-[18deg] rounded-[35%_70%_35%_70%] border-2 border-apple-teal/20 bg-apple-teal/10 animate-fluid" style={{ animationDelay: '-8s' }} />
      <div className="absolute bottom-0 left-0 right-0 h-28 bg-[linear-gradient(180deg,rgba(248,248,240,0),rgba(111,186,44,0.11))]" />
      <div className="absolute inset-0 opacity-[0.16] [background-image:radial-gradient(circle_at_1px_1px,#725d42_1px,transparent_0)] [background-size:32px_32px]" />
    </div>
  );
}

const LoadingShell = ({ children, isSkeleton = false }: { children: React.ReactNode, isSkeleton?: boolean }) => {
  const shouldShow = useDeferredLoading(true, 300);
  if (!shouldShow) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full"
    >
      {isSkeleton ? <LibrarySkeleton /> : (
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
    date.setDate(date.getDate() - ((length - 1) - index));

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
    typeof value === 'object'
    && value !== null
    && typeof (value as ArticleSentence).en === 'string'
    && typeof (value as ArticleSentence).zh === 'string'
    && (value as ArticleSentence).en.trim().length > 0
    && (value as ArticleSentence).zh.trim().length > 0
  );
}

function normalizeArticleResponse(data: unknown): ArticleSentence[] {
  const sentences = (data as { sentences?: unknown })?.sentences;
  if (!Array.isArray(sentences)) {
    throw new Error('Article response missing sentences');
  }

  const normalized = sentences
    .filter(isArticleSentence)
    .map((sentence) => ({
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
      subtitle: '先完成第一轮，再进入复习',
      ctaLabel: '开始学习',
      ctaMode: 'start_learning',
      boundLearningGroupId: null,
      lastUsedOfficialLibraryId: null,
      lastUsedOfficialMode: null,
      lastUsedOfficialGroupCount: 0,
      visibleSteps: [
        { key: 'round1', label: 'Round 1 · 明示关联', status: 'current' },
        { key: 'round2', label: 'Round 2 · 语境复现', status: 'upcoming' },
      ],
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
  const articleGenerationRef = useRef<ArticleGenerationJob | null>(null);
  const articleGenerationRunIdRef = useRef(0);
  const activeWordsRef = useRef<Word[]>([]);
  const userIdRef = useRef<string | null>(null);
  const [round, setRound] = useState<RoundType>('round1');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [activeLearningGroupId, setActiveLearningGroupId] = useState<string | null>(null);
  const [activeSessionSeed, setActiveSessionSeed] = useState<PersistedLearningSession | null>(null);
  const [articleSentences, setArticleSentences] = useState<ArticleSentence[] | null>(null);
  const [articleGenerationError, setArticleGenerationError] = useState('');
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [sessionStartError, setSessionStartError] = useState('');
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [stats, setStats] = useState<UserStats>(buildEmptyStats);
  const isSessionRoute = location.pathname.startsWith('/app/session');
  const isHomeRoute = location.pathname.startsWith('/app/home');
  const isIeltsTestRoute = location.pathname.startsWith('/app/ielts-reading/test/')
    || location.pathname.startsWith('/app/ielts-listening/test/');
  const articleReinforcementEnabled = AI_CONTENT_FEATURES_ENABLED
    && learningPreferences.reinforcementArticleEnabled;

  useEffect(() => {
    activeLearningGroupIdRef.current = activeLearningGroupId;
  }, [activeLearningGroupId]);
  useEffect(() => {
    activeWordsRef.current = activeWords;
  }, [activeWords]);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => attemptBuffer.subscribe(({ attempt, result }) => {
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
  }), []);

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

  const fetchStats = useCallback(async () => {
    if (!user) {
      setStats(buildEmptyStats());
      return;
    }

    try {
      const overview = await fetchHomeOverview(resolveBrowserTimeZone());
      const fallback = buildEmptyStats();
      setStats({
        ...fallback,
        ...overview,
        orbitDays: overview.orbitDays?.length ? overview.orbitDays : fallback.orbitDays,
        activityDays: overview.activityDays?.length ? overview.activityDays : fallback.activityDays,
        routineCard: overview.routineCard ?? fallback.routineCard,
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setStats(buildEmptyStats());
    }
  }, [user]);

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

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (location.pathname.startsWith('/app/home')) {
      void fetchStats();
    }
  }, [fetchStats, location.pathname]);
  useEffect(() => {
    if (!user) {
      cancelArticleGeneration();
      activeLearningGroupIdRef.current = null;
      setActiveWords([]);
      setActiveLearningGroupId(null);
      setActiveSessionSeed(null);
      setReviewSummary([]);
      setArticleSentences(null);
      setArticleGenerationError('');
      setRound('round1');
    }
  }, [cancelArticleGeneration, user]);

  const resetActiveLearningState = useCallback(() => {
    cancelArticleGeneration();
    activeLearningGroupIdRef.current = null;
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setActiveSessionSeed(null);
    setArticleSentences(null);
    setArticleGenerationError('');
    setRound('round1');
  }, [cancelArticleGeneration]);

  const ensureArticleForGroup = useCallback(async (groupId: string, words: Word[]) => {
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

    const runId = currentJob?.key === generationKey
      ? currentJob.runId
      : articleGenerationRunIdRef.current + 1;
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

    const isCurrentJob = () => (
      articleGenerationRef.current?.key === generationKey
      && articleGenerationRef.current.runId === runId
    );

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
  }, [cancelArticleGeneration, user]);

  const openLearningGroup = useCallback(async (groupId: string, preloadedWords?: Word[]) => {
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
      }

      if (words.length === 0) {
        throw new Error('这组词还没有可学习的内容。');
      }

      const restoredOrInitialSession = {
        ...(restoredSession ?? createInitialLearningSession(groupId, words)),
        lastActiveAt: new Date().toISOString(),
      };
      const nextSession = !AI_CONTENT_FEATURES_ENABLED && restoredOrInitialSession.round === 'article'
        ? createInitialLearningSession(groupId, words, 'round3', {
          groupCompleted: restoredOrInitialSession.groupCompleted ?? true,
          completedAt: restoredOrInitialSession.completedAt ?? new Date().toISOString(),
        })
        : restoredOrInitialSession;

      setReviewSummary([]);
      setArticleGenerationError('');
      setActiveWords(words);
      activeLearningGroupIdRef.current = groupId;
      setActiveLearningGroupId(groupId);
      setActiveSessionSeed(nextSession);
      const persistedArticle = parsePersistedArticleContent(nextSession.article);
      const cachedArticle = getCachedArticle(groupId, words);
      const restoredArticle = cachedArticle ?? persistedArticle;
      if (restoredArticle) {
        setCachedArticle(groupId, words, restoredArticle);
      }
      setArticleSentences(nextSession.round === 'article' ? restoredArticle : null);
      setRound(nextSession.round);
      navigate('/app/session');

      await persistLearningGroupSession(user.id, nextSession);
      invalidateLibraryCache(user.id);
      if (isCoreLearningRound(nextSession.round)) {
        void bindRoutineMainLearningGroup(user.id, {
          groupId,
          round: nextSession.round,
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to bind daily routine main learning group:', error);
        });
      }

      if (
        articleReinforcementEnabled
        && (nextSession.round === 'round3' || nextSession.round === 'article')
        && !restoredArticle
      ) {
        void ensureArticleForGroup(groupId, words);
      }
    } catch (error) {
      console.error('Failed to open learning group:', error);
      setSessionStartError(error instanceof Error ? error.message : '打开这组词时出了点问题，请再试一次。');
    } finally {
      setIsStartingSession(false);
    }
  }, [articleReinforcementEnabled, ensureArticleForGroup, navigate, user]);

  const handleStart = async () => {
    if (!user) return;

    setSessionStartError('');
    if (stats.routineCard.ctaMode === 'open_library') {
      navigate('/app/library');
      return;
    }

    if (stats.routineCard.ctaMode === 'start_review' || stats.routineCard.ctaMode === 'continue_review') {
      setIsStartingSession(true);
      try {
        const dueWords = await fetchDueReviewWords();
        if (dueWords.length === 0) {
          await fetchStats();
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

    if (stats.routineCard.ctaMode === 'continue_learning') {
      const targetGroupId = stats.routineCard.boundLearningGroupId;
      if (targetGroupId) {
        await openLearningGroup(targetGroupId);
        return;
      }

      const libraryId = stats.routineCard.lastUsedOfficialLibraryId;
      if (libraryId) {
        setIsStartingSession(true);
        try {
          const result = await startNextOfficialBatch({
            userId: user.id,
            libraryId,
            mode: stats.routineCard.lastUsedOfficialMode ?? 'sequential',
            existingGroupCount: stats.routineCard.lastUsedOfficialGroupCount,
          });

          if (!result) {
            navigate('/app/library');
            return;
          }

          await openLearningGroup(result.groupId, result.words);
        } catch (error) {
          console.error('Failed to auto-start next official batch:', error);
          setSessionStartError(error instanceof Error ? error.message : '开始下一组官方词时出了点问题，请再试一次。');
        } finally {
          setIsStartingSession(false);
        }
        return;
      }
    }

    if (stats.routineCard.ctaMode === 'start_learning') {
      navigate('/app/library');
      return;
    }

    navigate('/app/library');
  };

  const handleStartLearningGroup = useCallback(async (groupId: string, words?: Word[]) => {
    await openLearningGroup(groupId, words);
  }, [openLearningGroup]);

  const handleLearningSessionChange = useCallback((session: {
    round: LearningRoundType;
    currentIndex: number;
    queueWordIds: string[];
    passedQueueIndices: number[];
  }) => {
    if (!activeLearningGroupId || !user) return;

    const lastActiveAt = new Date().toISOString();

    void persistLearningGroupSession(user.id, {
      groupId: activeLearningGroupId,
      round: session.round,
      currentIndex: session.currentIndex,
      queueWordIds: session.queueWordIds,
      passedQueueIndices: session.passedQueueIndices,
      lastActiveAt,
      groupCompleted: activeSessionSeed?.groupCompleted ?? false,
      completedAt: activeSessionSeed?.completedAt ?? null,
    }).catch((error) => {
      console.error('Failed to persist learning session snapshot:', error);
    });

    if (isCoreLearningRound(session.round)) {
      void bindRoutineMainLearningGroup(user.id, {
        groupId: activeLearningGroupId,
        round: session.round,
        timeZone: resolveBrowserTimeZone(),
      }).catch((error) => {
        console.error('Failed to refresh daily routine main learning group:', error);
      });
    }
  }, [activeLearningGroupId, activeSessionSeed?.completedAt, activeSessionSeed?.groupCompleted, user]);

  const handleRoundComplete = useCallback(async () => {
    if (round === 'review') {
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

    if (round === 'round1') {
      const nextSession = createInitialLearningSession(activeLearningGroupId, activeWords, 'round2');

      void markRoutineStepCompleted(user.id, {
        step: 'round1',
        groupId: activeLearningGroupId,
        timeZone: resolveBrowserTimeZone(),
      }).catch((error) => {
        console.error('Failed to mark round1 as completed:', error);
      });

      setActiveSessionSeed(nextSession);
      setRound('round2');
      void persistLearningGroupSession(user.id, nextSession).catch((error) => {
        console.error('Failed to persist round transition:', error);
      });
      return;
    }

    const finishReinforcementSession = async () => {
      await clearLearningGroupSession(user.id, activeLearningGroupId).catch((error) => {
        console.error('Failed to close reinforcement session:', error);
      });
      invalidateLibraryCache(user.id);
      resetActiveLearningState();
      navigate('/app/home');
      void fetchStats();
    };

    const advanceToArticle = (completedAt: string, groupCompleted: boolean) => {
      const nextSession = createInitialLearningSession(activeLearningGroupId, activeWords, 'article', {
        groupCompleted,
        completedAt,
      });
      const cachedArticle = getCachedArticle(activeLearningGroupId, activeWords);
      setActiveSessionSeed(nextSession);
      setRound('article');
      setArticleSentences(cachedArticle);
      invalidateLibraryCache(user.id);
      void persistLearningGroupSession(user.id, nextSession).catch((error) => {
        console.error('Failed to persist article transition:', error);
      });
      if (!cachedArticle) {
        void ensureArticleForGroup(activeLearningGroupId, activeWords);
      }
    };

    if (round === 'round2') {
      const completedAt = activeSessionSeed?.completedAt ?? new Date().toISOString();

      void markRoutineStepCompleted(user.id, {
        step: 'round2',
        groupId: activeLearningGroupId,
        timeZone: resolveBrowserTimeZone(),
      }).catch((error) => {
        console.error('Failed to mark round2 as completed:', error);
      });

      if (learningPreferences.reinforcementRound3Enabled) {
        const nextSession = createInitialLearningSession(activeLearningGroupId, activeWords, 'round3', {
          groupCompleted: true,
          completedAt,
        });

        setActiveSessionSeed(nextSession);
        setRound('round3');
        invalidateLibraryCache(user.id);
        void persistLearningGroupSession(user.id, nextSession).catch((error) => {
          console.error('Failed to persist reinforcement transition:', error);
        });
        if (articleReinforcementEnabled) {
          void ensureArticleForGroup(activeLearningGroupId, activeWords);
        }
        return;
      }

      if (articleReinforcementEnabled) {
        advanceToArticle(completedAt, true);
        return;
      }

      await finishReinforcementSession();
      return;
    }

    if (round === 'round3') {
      if (articleReinforcementEnabled) {
        advanceToArticle(
          activeSessionSeed?.completedAt ?? new Date().toISOString(),
          activeSessionSeed?.groupCompleted ?? true,
        );
        return;
      }

      await finishReinforcementSession();
      return;
    }

    await finishReinforcementSession();
  }, [
    activeLearningGroupId,
    activeSessionSeed?.completedAt,
    activeSessionSeed?.groupCompleted,
    activeWords,
    articleReinforcementEnabled,
    ensureArticleForGroup,
    fetchStats,
    learningPreferences.reinforcementRound3Enabled,
    navigate,
    resetActiveLearningState,
    round,
    user,
  ]);

  const handleReviewResultsBackHome = () => {
    navigate('/app/home');
    setReviewSummary([]);
    setSessionStartError('');
    resetActiveLearningState();
    void fetchStats();
  };

  const handleRetryArticleGeneration = useCallback(() => {
    if (!activeLearningGroupId || activeWords.length === 0) return;

    cancelArticleGeneration(activeLearningGroupId);
    setArticleGenerationError('');
    setArticleSentences(null);
    void ensureArticleForGroup(activeLearningGroupId, activeWords);
  }, [activeLearningGroupId, activeWords, cancelArticleGeneration, ensureArticleForGroup]);

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

  useEffect(() => {
    if (!isSessionRoute) {
      setIsSessionSettingsOpen(false);
      cancelArticleGeneration();
    }
  }, [cancelArticleGeneration, isSessionRoute]);

  useEffect(() => {
    if (
      !user
      || !articleReinforcementEnabled
      || !activeLearningGroupId
      || activeWords.length === 0
      || articleGenerationError
      || (round !== 'round3' && round !== 'article')
      || (round === 'article' && articleSentences !== null)
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
    <IslandIconButton
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
        'h-11 w-11 shrink-0 text-apple-blue',
        isSessionSettingsOpen && 'bg-apple-blue text-white',
      )}
    >
      <Settings className="h-5 w-5" strokeWidth={2.6} />
    </IslandIconButton>
  ) : null;

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!isSessionRoute) {
      sessionAutoRestoreRef.current = null;
      return;
    }

    const resumeGroupId = stats.routineCard.ctaMode === 'continue_learning'
      ? stats.routineCard.boundLearningGroupId
      : null;

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
    stats.routineCard.boundLearningGroupId,
    stats.routineCard.ctaMode,
    user,
  ]);

  const sessionEmptyState = (
    <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center shadow-xl">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">这里还没有内容</p>
      <h2 className="mt-4 text-3xl font-black text-text-primary">回到首页，查看今天的学习安排。</h2>
      <IslandButton
        onClick={() => navigate('/app/home')}
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
        <div className="min-h-screen flex selection:bg-apple-blue/20">
          <AmbientBackground />
          {!isIeltsTestRoute && (
            <Sidebar
              activePath={activeNavPath}
              onNavigate={(to) => navigate(to)}
            />
          )}
          <WhatsNewModal />

          <div className="flex-1 relative h-screen overflow-hidden">
            <main
              ref={mainScrollRef}
              onPointerDownCapture={(event) => {
                if (!isSessionRoute || !isSessionSettingsOpen) return;
                const target = event.target as HTMLElement;
                if (target.closest('[data-session-settings-toggle]')) return;
                setIsSessionSettingsOpen(false);
                event.preventDefault();
                event.stopPropagation();
              }}
              className={cx(
                'h-full overflow-y-auto relative z-10',
                isSessionRoute
                  ? 'session-main px-4 py-6 pb-22 md:px-6 md:py-7 lg:pb-7 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10'
                  : isIeltsTestRoute
                    ? 'px-0 py-0'
                  : isHomeRoute
                    ? 'px-6 pt-4 pb-32 lg:px-6 lg:py-6 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10'
                  : 'px-6 pt-4 pb-32 lg:px-6 lg:py-6 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10',
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
              <Suspense fallback={<LoadingShell isSkeleton={location.pathname.includes('/library')}>{null}</LoadingShell>}>
                <Routes>
                  <Route
                    path="home"
                    element={(
                      <HomeView
                        stats={stats}
                        onSelectOrbitDate={handleSelectOrbitDate}
                        onStart={() => { void handleStart(); }}
                        isLoading={isStartingSession}
                      />
                    )}
                  />
                  <Route
                    path="library"
                    element={(
                      <LibraryView
                        onLibraryMutated={() => { void fetchStats(); }}
                        onStartLearningGroup={handleStartLearningGroup}
                      />
                    )}
                  />
                  <Route
                    path="library/official/:libraryId?"
                    element={(
                      <OfficialLibraryDetailView
                        onLibraryMutated={() => { void fetchStats(); }}
                        onStartLearningGroup={handleStartLearningGroup}
                      />
                    )}
                  />
                  <Route
                    path="library/group/:groupId"
                    element={(
                      <LibraryGroupDetailView
                        isStartingLearningGroup={isStartingSession}
                        onLibraryMutated={() => { void fetchStats(); }}
                        onStartLearningGroup={handleStartLearningGroup}
                      />
                    )}
                  />
                  <Route
                    path="library/custom/:groupId"
                    element={(
                      <LibraryGroupDetailView
                        isStartingLearningGroup={isStartingSession}
                        onLibraryMutated={() => { void fetchStats(); }}
                        onStartLearningGroup={handleStartLearningGroup}
                      />
                    )}
                  />
                  <Route path="import" element={PERSONAL_VOCAB_IMPORT_ENABLED ? <ImportView /> : <Navigate to="/app/library" replace />} />
                  <Route path="ielts" element={<IeltsHomeView />} />
                  <Route path="ielts-reading" element={<IeltsReadingHomeView />} />
                  <Route path="ielts-reading/test/:testId" element={<IeltsReadingTestView />} />
                  <Route path="ielts-listening" element={<IeltsListeningHomeView />} />
                  <Route path="ielts-listening/test/:testId" element={<IeltsListeningTestView />} />
                  <Route path="notebook" element={<NotebookView />} />
                  <Route
                    path="session"
                    element={activeWords.length === 0 ? sessionEmptyState : (
                      round === 'article' && AI_CONTENT_FEATURES_ENABLED ? (
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
                                <p className="mt-2 text-sm font-bold text-text-secondary">{articleGenerationError}</p>
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
                          <ArticleView sentences={articleSentences} words={activeWords} onFinish={handleRoundComplete} />
                        )
                      ) : (
                        <React.Fragment
                          key={`${activeLearningGroupId ?? 'review'}:${round}:${activeSessionSeed?.lastActiveAt ?? activeWords.map((word) => word.id).join('|')}`}
                        >
                          <LearningEngine
                            type={round}
                            words={activeWords}
                            initialSession={activeSessionSeed}
                            onComplete={handleRoundComplete}
                            onSessionChange={handleLearningSessionChange}
                            sessionActions={sessionSettingsButton}
                          />
                        </React.Fragment>
                      )
                    )}
                  />
                  <Route
                    path="review-results"
                    element={(
                      <ReviewResultsView
                        items={[...reviewSummary].sort((left, right) => left.word.localeCompare(right.word))}
                        onBackHome={handleReviewResultsBackHome}
                      />
                    )}
                  />
                  <Route
                    path="profile"
                    element={(
                      <ProfileView
                        user={user}
                        stats={stats}
                        onSignOut={() => { void handleSignOut(); }}
                      />
                    )}
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
