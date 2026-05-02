/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Loader2,
  LogOut,
  Settings,
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArticleSentence,
  LearningRoundType,
  PersistedLearningSession,
  ReviewAttemptSource,
  ReviewSummaryItem,
  RoundType,
  UserStats,
  Word,
} from './types';
import { Sidebar } from './components/layout/Sidebar';
import { WhatsNewModal } from './components/shared/WhatsNewModal';
import { SessionSettingsDrawer } from './components/settings/SessionSettingsDrawer';
import { fetchDueReviewWords, submitReviewAttempt } from './lib/reviewApi';
import { useAuth } from './contexts/AuthContext';
import { useLearningPreferences } from './contexts/LearningPreferencesContext';
import { SavedWordsProvider } from './contexts/SavedWordsContext';
import { WordPopoverProvider } from './contexts/WordPopoverContext';
import { apiFetch } from './lib/api';
import { invalidateLibraryCache } from './lib/libraryCache';
import { createInitialLearningSession, isCoreLearningRound } from './lib/learningSession';
import {
  clearLearningGroupSession,
  fetchLearningGroupSession,
  persistLearningGroupSession,
} from './lib/learningSessionApi';
import { clearArticleCache, getCachedArticle, setCachedArticle } from './lib/articleCache';
import {
  bindRoutineMainLearningGroup,
  markRoutineReviewStarted,
  markRoutineStepCompleted,
} from './lib/dailyRoutineApi';
import { cx } from './components/shared/LearningUI';
import { LibrarySkeleton } from './components/shared/Skeleton';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { fetchHomeOverview, resolveBrowserTimeZone } from './lib/homeApi';

// --- Lazy loaded views ---
const HomeView = lazy(() => import('./components/home/HomeView').then(m => ({ default: m.HomeView })));
const ImportView = lazy(() => import('./components/import/ImportView').then(m => ({ default: m.ImportView })));
const LibraryView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryView })));
const NotebookView = lazy(() => import('./components/notebook/NotebookView').then(m => ({ default: m.NotebookView })));
const OfficialLibraryDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.OfficialLibraryDetailView })));
const LibraryGroupDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryGroupDetailView })));
const ReviewResultsView = lazy(() => import('./components/review/ReviewResultsView').then(m => ({ default: m.ReviewResultsView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })));

// --- Core Learning Components (Extracted) ---
const LearningEngine = lazy(() => import('./components/learning/LearningEngine').then(m => ({ default: m.LearningEngine })));
const ArticleView = lazy(() => import('./components/learning/ArticleView').then(m => ({ default: m.ArticleView })));

function AmbientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-apple-blue/8 blur-[120px] animate-fluid" />
      <div className="absolute top-[20%] right-[-5%] w-[35%] h-[35%] rounded-full bg-apple-orange/6 blur-[100px] animate-fluid" style={{ animationDelay: '-5s' }} />
      <div className="absolute bottom-[-10%] left-[15%] w-[45%] h-[45%] rounded-full bg-apple-teal/6 blur-[130px] animate-fluid" style={{ animationDelay: '-10s' }} />
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

function buildFallbackOrbitDays(timeZone: string) {
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    weekday: 'short',
  });
  const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
  });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));

    const dayParts = dayFormatter.formatToParts(date);
    const year = dayParts.find((part) => part.type === 'year')?.value ?? '0000';
    const month = dayParts.find((part) => part.type === 'month')?.value ?? '01';
    const day = dayParts.find((part) => part.type === 'day')?.value ?? '01';

    const shortDateParts = shortDateFormatter.formatToParts(date);
    const shortMonth = shortDateParts.find((part) => part.type === 'month')?.value ?? '01';
    const shortDay = shortDateParts.find((part) => part.type === 'day')?.value ?? '01';

    return {
      date: `${year}-${month}-${day}`,
      weekdayLabel: weekdayFormatter.format(date),
      shortDateLabel: `${shortMonth}.${shortDay}`,
      status: 'gap' as const,
      reviewWordCount: 0,
      learnedWordCount: 0,
    };
  });
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

function buildEmptyStats(): UserStats {
  const timeZone = resolveBrowserTimeZone();
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = todayParts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = todayParts.find((part) => part.type === 'month')?.value ?? '01';
  const day = todayParts.find((part) => part.type === 'day')?.value ?? '01';
  const todayKey = `${year}-${month}-${day}`;

  return {
    todayReviewCount: 0,
    streak: 0,
    perfectCheckinDays: 0,
    stableRecallCount: 0,
    orbitDays: buildFallbackOrbitDays(timeZone),
    selectedDate: todayKey,
    selectedDayReviewWordCount: 0,
    selectedDayLearnedWordCount: 0,
    resumeCandidate: null,
    routineCard: {
      state: 'not_started',
      title: '开始新的学习旅程',
      subtitle: '从 Round 1 开始今天的主线任务',
      ctaLabel: '开始学习',
      ctaMode: 'start_learning',
      boundLearningGroupId: null,
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
  const [round, setRound] = useState<RoundType>('round1');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [activeLearningGroupId, setActiveLearningGroupId] = useState<string | null>(null);
  const [activeSessionSeed, setActiveSessionSeed] = useState<PersistedLearningSession | null>(null);
  const [articleSentences, setArticleSentences] = useState<ArticleSentence[] | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [sessionStartError, setSessionStartError] = useState('');
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [stats, setStats] = useState<UserStats>(buildEmptyStats);

  useEffect(() => {
    activeLearningGroupIdRef.current = activeLearningGroupId;
  }, [activeLearningGroupId]);

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
      setActiveWords([]);
      setActiveLearningGroupId(null);
      setActiveSessionSeed(null);
      setReviewSummary([]);
      setArticleSentences(null);
      setRound('round1');
    }
  }, [user]);

  const resetActiveLearningState = useCallback(() => {
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setActiveSessionSeed(null);
    setArticleSentences(null);
    setRound('round1');
  }, []);

  const ensureArticleForGroup = useCallback(async (groupId: string, words: Word[]) => {
    if (!user) return null;

    const cachedArticle = getCachedArticle(groupId, words);
    if (cachedArticle) {
      if (activeLearningGroupIdRef.current === groupId) {
        setArticleSentences(cachedArticle);
      }
      return cachedArticle;
    }

    try {
      clearArticleCache();
      const res = await apiFetch('/api/vocab/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: words.map((word) => word.word) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const sentences = normalizeArticleResponse(data);

      setCachedArticle(groupId, words, sentences);

      if (activeLearningGroupIdRef.current === groupId) {
        setArticleSentences(sentences);
      }

      return sentences;
    } catch (error) {
      console.error('Article generation failed:', error);
      if (activeLearningGroupIdRef.current === groupId) {
        setArticleSentences([]);
      }
      return [];
    }
  }, [user]);

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

      const nextSession = {
        ...(restoredSession ?? createInitialLearningSession(groupId, words)),
        lastActiveAt: new Date().toISOString(),
      };

      setReviewSummary([]);
      setActiveWords(words);
      setActiveLearningGroupId(groupId);
      setActiveSessionSeed(nextSession);
      const cachedArticle = nextSession.round === 'article' ? getCachedArticle(groupId, words) : null;
      setArticleSentences(nextSession.round === 'article' ? cachedArticle : null);
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

      if (nextSession.round === 'article' && !cachedArticle) {
        void ensureArticleForGroup(groupId, words);
      }
    } catch (error) {
      console.error('Failed to open learning group:', error);
      setSessionStartError(error instanceof Error ? error.message : '打开这组词时出了点问题，请再试一次。');
    } finally {
      setIsStartingSession(false);
    }
  }, [ensureArticleForGroup, navigate, user]);

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
      const targetGroupId = stats.routineCard.boundLearningGroupId ?? stats.resumeCandidate?.groupId;
      if (targetGroupId) {
        await openLearningGroup(targetGroupId);
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

  const handleAttempt = useCallback(async ({
    word,
    source,
    wasCorrect,
    elapsedMs,
  }: {
    word: Word;
    source: ReviewAttemptSource;
    wasCorrect: boolean;
    elapsedMs: number;
  }) => {
    if (source === 'round2' && !activeLearningGroupId) return;

    const result = await submitReviewAttempt({
      vocabularyItemId: word.id,
      learningGroupId: source === 'round2' ? activeLearningGroupId : null,
      source,
      wasCorrect,
      elapsedMs,
    });

    if (user) {
      invalidateLibraryCache(user.id);
    }

    if (source === 'review') {
      setReviewSummary((prev) => {
        const nextItem: ReviewSummaryItem = {
          wordId: word.id,
          word: word.word,
          chineseDefinition: word.chinese_definition,
          transition: result.transition,
        };

        return [...prev.filter((item) => item.wordId !== word.id), nextItem];
      });
    }
  }, [activeLearningGroupId, user]);

  const handleLearningSessionChange = useCallback((session: {
    round: LearningRoundType;
    currentIndex: number;
    queueWordIds: string[];
    passedQueueIndices: number[];
  }) => {
    if (!activeLearningGroupId || !user) return;

    void persistLearningGroupSession(user.id, {
      groupId: activeLearningGroupId,
      round: session.round,
      currentIndex: session.currentIndex,
      queueWordIds: session.queueWordIds,
      passedQueueIndices: session.passedQueueIndices,
      lastActiveAt: new Date().toISOString(),
      groupCompleted: activeSessionSeed?.groupCompleted ?? false,
      completedAt: activeSessionSeed?.completedAt ?? null,
    }).catch((error) => {
      console.error('Failed to persist learning session snapshot:', error);
    });
  }, [activeLearningGroupId, activeSessionSeed?.completedAt, activeSessionSeed?.groupCompleted, user]);

  const handleRoundComplete = useCallback(async () => {
    if (round === 'review') {
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
      setActiveSessionSeed(nextSession);
      setRound('article');
      setArticleSentences(null);
      invalidateLibraryCache(user.id);
      void persistLearningGroupSession(user.id, nextSession).catch((error) => {
        console.error('Failed to persist article transition:', error);
      });
      void ensureArticleForGroup(activeLearningGroupId, activeWords);
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
        return;
      }

      if (learningPreferences.reinforcementArticleEnabled) {
        advanceToArticle(completedAt, true);
        return;
      }

      await finishReinforcementSession();
      return;
    }

    if (round === 'round3') {
      if (learningPreferences.reinforcementArticleEnabled) {
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
    ensureArticleForGroup,
    fetchStats,
    learningPreferences.reinforcementArticleEnabled,
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

  const handleSignOut = async () => {
    resetActiveLearningState();
    setReviewSummary([]);
    setSessionStartError('');
    await signOut();
    window.location.assign('/');
  };

  const activeNavPath = (() => {
    if (location.pathname.startsWith('/app/library')) return '/app/library';
    if (location.pathname.startsWith('/app/import')) return '/app/import';
    if (location.pathname.startsWith('/app/notebook')) return '/app/notebook';
    if (location.pathname.startsWith('/app/settings')) return '/app/settings';
    if (location.pathname.startsWith('/app/profile')) return '/app/profile';
    return '/app/home';
  })();
  const isSessionRoute = location.pathname.startsWith('/app/session');
  const isHomeRoute = location.pathname.startsWith('/app/home');

  useEffect(() => {
    if (!isSessionRoute) {
      setIsSessionSettingsOpen(false);
    }
  }, [isSessionRoute]);

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
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-white/80 bg-white/84 text-apple-blue shadow-[0_14px_34px_rgba(0,122,255,0.16)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95',
        isSessionSettingsOpen && 'bg-apple-blue text-white shadow-[0_16px_34px_rgba(0,122,255,0.26)]',
      )}
    >
      <Settings className="h-5 w-5" strokeWidth={2.6} />
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

    const resumeGroupId = stats.routineCard.ctaMode === 'continue_learning'
      ? stats.routineCard.boundLearningGroupId ?? stats.resumeCandidate?.groupId ?? null
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
    stats.resumeCandidate,
    user,
  ]);

  const sessionEmptyState = (
    <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center shadow-xl">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">这里还没有内容</p>
      <h2 className="mt-4 text-3xl font-black text-text-primary">先回首页，从今天该做的开始。</h2>
      <button
        type="button"
        onClick={() => navigate('/app/home')}
        className="mt-8 rounded-2xl bg-apple-blue px-6 py-4 text-base font-black text-white"
      >
        回首页看看
      </button>
    </div>
  );

  return (
    <SavedWordsProvider>
      <WordPopoverProvider>
        <div className="min-h-screen flex selection:bg-apple-blue/20">
          <AmbientBackground />
          <Sidebar
            activePath={activeNavPath}
            onNavigate={(to) => navigate(to)}
          />
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
                  : isHomeRoute
                    ? 'px-6 pt-4 pb-32 lg:px-6 lg:py-6 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10'
                  : 'px-6 pt-4 pb-32 lg:pt-24 lg:px-6 lg:py-7 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10',
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
                  <p className="text-sm font-black">没能开始这组学习</p>
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
                  <Route path="import" element={<ImportView />} />
                  <Route path="notebook" element={<NotebookView />} />
                  <Route
                    path="session"
                    element={activeWords.length === 0 ? sessionEmptyState : (
                      round === 'article' ? (
                        articleSentences === null ? (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="glass p-16 rounded-apple-lg shadow-2xl flex flex-col items-center gap-6"
                          >
                            <Loader2 className="w-10 h-10 text-apple-green animate-spin" />
                            <p className="font-black text-xl">正在生成收尾文章</p>
                          </motion.div>
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
                            onAttempt={handleAttempt}
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
                      <div className="w-full max-w-5xl mx-auto space-y-6">
                        <div className="glass relative overflow-hidden rounded-[36px] p-8 md:p-10">
                          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                              <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-apple-blue text-4xl font-black text-white shadow-lg">
                                {(user?.email?.[0] ?? 'L').toUpperCase()}
                              </div>
                              <h2 className="mt-6 text-4xl font-black text-text-primary prose-serif">
                                {(user?.user_metadata.full_name as string | undefined) ?? '当前账号'}
                              </h2>
                              <p className="mt-3 text-base text-text-secondary">{user?.email ?? '还没拿到邮箱'}</p>
                            </div>

                            <button
                              type="button"
                              onClick={() => { void handleSignOut(); }}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-apple-red/8 px-6 py-4 text-base font-black text-apple-red transition-all hover:bg-apple-red/12 active:scale-95"
                            >
                              退出当前账号
                              <LogOut className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>
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
