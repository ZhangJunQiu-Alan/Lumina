/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { duration, ease } from './lib/motion';
import { AlertCircle, ArrowLeft, Loader2, Settings } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  HomeOfficialLibraryOption,
  LearningRoundType,
  OfficialLibraryId,
  OfficialStudyMode,
  PersistedLearningSession,
  ReviewSummaryItem,
  RoundType,
  Word,
} from './types';
import { Sidebar } from './components/layout/Sidebar';
import { WhatsNewModal } from './components/shared/WhatsNewModal';
import { SessionSettingsDrawer } from './components/settings/SessionSettingsDrawer';
import { fetchDueReviewWords } from './lib/reviewApi';
import { attemptBuffer } from './lib/attemptBuffer';
import { readLocal, writeLocal } from './lib/durableStorage';
import { cacheLearningRecovery, readLearningRecovery, type ReviewRecovery } from './lib/learningRecovery';
import { useAuth } from './contexts/AuthContext';
import { useLearningPreferences } from './contexts/LearningPreferencesContext';
import { SavedWordsProvider } from './contexts/SavedWordsContext';
import { WordPopoverProvider } from './contexts/WordPopoverContext';
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
  completeLearningGroupAtomic,
  fetchLearningGroupSession,
  fetchOfficialResumeTargets,
  markLearningGroupWordsRound1Confirmed,
  markLearningGroupWordsRoundCompleted,
  persistLearningGroupSession,
  trimLearningGroupToWordIds,
} from './lib/learningSessionApi';
import { getCachedArticle, setCachedArticle } from './lib/articleCache';
import {
  bindRoutineMainLearningGroup,
  markRoutineReviewStarted,
  markRoutineStepCompleted,
} from './lib/dailyRoutineApi';
import { cx } from './components/shared/LearningUI';
import { LibrarySkeleton } from './components/shared/Skeleton';
import { useDeferredLoading } from './hooks/useDeferredLoading';
import { useArticleGeneration, parsePersistedArticleContent } from './hooks/useArticleGeneration';
import { useHomeStats } from './hooks/useHomeStats';
import { resolveBrowserTimeZone } from './lib/homeApi';

import { shouldForceHomeRefreshForNavigation } from './lib/homeNavigation';
import { reorderActiveOfficialGroup, startNextOfficialBatch } from './lib/officialLibraryStart';
import { deleteOfficialLearningLibrary } from './lib/libraryApi';
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
const SessionRouteView = lazy(() =>
  import('./components/learning/SessionRouteView').then((m) => ({ default: m.SessionRouteView })),
);

interface OpenLearningGroupOptions {
  libraryId?: OfficialLibraryId | null;
  officialMode?: OfficialStudyMode | null;
}

interface HomeStartSelection {
  libraryId?: OfficialLibraryId | null;
  mode?: OfficialStudyMode | null;
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

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { preferences: learningPreferences } = useLearningPreferences();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const activeLearningGroupIdRef = useRef<string | null>(null);
  const sessionAutoRestoreRef = useRef<string | null>(null);
  const activeWordsRef = useRef<Word[]>([]);
  const activeSessionSeedRef = useRef<PersistedLearningSession | null>(null);
  const lastSessionChangeSignatureRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
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
  const {
    articleSentences,
    setArticleSentences,
    articleGenerationError,
    setArticleGenerationError,
    ensureArticleForGroup,
    cancelArticleGeneration,
  } = useArticleGeneration(user?.id, activeLearningGroupId);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [sessionStartError, setSessionStartError] = useState('');
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const isSessionRoute = location.pathname.startsWith('/app/session');
  const routeSection = location.pathname.split('/')[2] ?? '';
  const isHomeRoute = location.pathname.startsWith('/app/home');
  const isIeltsTestRoute =
    location.pathname.startsWith('/app/ielts-reading/test/') ||
    (IELTS_LISTENING_ENABLED && location.pathname.startsWith('/app/ielts-listening/test/'));
  const recallRoundEnabled = learningPreferences.reinforcementRound3Enabled;
  const dictationRoundEnabled = learningPreferences.round2Enabled;
  const articleReinforcementEnabled = ARTICLE_REINFORCEMENT_ENABLED && learningPreferences.reinforcementArticleEnabled;

  const {
    stats,
    homeStats,
    hasTrustedHomeStats,
    isHomeStatsRefreshing,
    requestedOfficialLibraryId,
    fetchStats,
    markHomeOverviewDirty,
    trackLearningHomeSync,
    navigateWithFreshHomeStats,
    handleSelectOrbitDate,
    getHasPendingHomeSync,
    getIsHomeOverviewDirty,
  } = useHomeStats({
    user,
    activeLearningGroupId,
    activeSessionSeed,
    learningPreferences,
    isHomeRoute,
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    onCloseSessionSettings: () => setIsSessionSettingsOpen(false),
  });

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
    userIdRef.current = user?.id ?? null;
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

  useEffect(() => {
    if (!user) {
      cancelArticleGeneration();
      activeLearningGroupIdRef.current = null;
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
    sessionAutoRestoreRef.current = activeLearningGroupIdRef.current;
    activeLearningGroupIdRef.current = null;
    lastSessionChangeSignatureRef.current = null;
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setActiveSessionSeed(null);
    setArticleSentences(null);
    setArticleGenerationError('');
    setRound('round1');
  }, [cancelArticleGeneration, setActiveSessionSeed]);

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

          if (groupSession.completed) {
            resetActiveLearningState();
            navigateWithFreshHomeStats('/app/home');
            return;
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
          await completeLearningGroupAtomic(
            user.id,
            groupId,
            scopedWords.map((word) => word.id),
            { timeZone: resolveBrowserTimeZone() },
          ).catch((error) => {
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
        setSessionStartError(error instanceof Error ? error.message : '学习组加载失败，请重试。');
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
        setSessionStartError(error instanceof Error ? error.message : '官方词库进度同步失败，请重试。');
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
        setSessionStartError(error instanceof Error ? error.message : '复习加载失败，请重试。');
      } finally {
        setIsStartingSession(false);
      }
      return;
    }

    if (!hasTrustedHomeStats) {
      setSessionStartError('学习数据正在同步，请稍后继续。');
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
          setSessionStartError(error instanceof Error ? error.message : '下一组单词加载失败，请重试。');
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
          setSessionStartError(error instanceof Error ? error.message : '下一组单词加载失败，请重试。');
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
          setSessionStartError(error instanceof Error ? error.message : '官方词库加载失败，请重试。');
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

      if (readLearningRecovery(user.id, activeLearningGroupId)?.completed) return;

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
    },
    [
      activeLearningGroupId,
      dictationRoundEnabled,
      recallRoundEnabled,
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
        await completeLearningGroupAtomic(user.id, activeLearningGroupId, [], {
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
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
          await completeLearningGroupAtomic(
            user.id,
            activeLearningGroupId,
            nextWords.map((word) => word.id),
            { timeZone: resolveBrowserTimeZone() },
          ).catch((error) => {
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
        const completedWordIds = scopedActiveWords.map((word) => word.id);
        await completeLearningGroupAtomic(user.id, activeLearningGroupId, completedWordIds, {
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to close learning session atomically:', error);
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

        const completedWordIds = scopedActiveWords.map((word) => word.id);
        await completeLearningGroupAtomic(user.id, activeLearningGroupId, completedWordIds, {
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to complete dictation-skipped learning group atomically:', error);
          throw error;
        });

        if (articleReinforcementEnabled) {
          advanceToArticle(completedAt, true);
          return;
        }

        invalidateLibraryCache(user.id);
        resetActiveLearningState();
        navigateWithFreshHomeStats('/app/home');
        return;
      }

      if (round === 'round3') {
        const completedAt = new Date().toISOString();
        await attemptBuffer.flush();
        const completedWordIds = scopedActiveWords.map((word) => word.id);
        await completeLearningGroupAtomic(user.id, activeLearningGroupId, completedWordIds, {
          timeZone: resolveBrowserTimeZone(),
        }).catch((error) => {
          console.error('Failed to complete round3 learning group atomically:', error);
          throw error;
        });

        if (articleReinforcementEnabled) {
          advanceToArticle(completedAt, true);
          return;
        }

        invalidateLibraryCache(user.id);
        resetActiveLearningState();
        navigateWithFreshHomeStats('/app/home');
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
      const hasPendingHomeSync = getHasPendingHomeSync();
      if (
        shouldForceHomeRefreshForNavigation(
          location.pathname,
          targetPath,
          getIsHomeOverviewDirty() || hasPendingHomeSync,
        )
      ) {
        navigateWithFreshHomeStats(targetPath);
        return;
      }

      navigate(targetPath);
    },
    [getHasPendingHomeSync, getIsHomeOverviewDirty, location.pathname, navigate, navigateWithFreshHomeStats],
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
      aria-label="返回主页"
      title="返回主页"
      onClick={() => {
        navigateWithFreshHomeStats('/app/home');
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

  return (
    <SavedWordsProvider>
      <WordPopoverProvider>
        <div className="lumina-app-shell min-h-screen flex selection:bg-apple-blue/20">
          <AmbientBackground />
          {!isIeltsTestRoute && !isSessionRoute && (
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
                  ? 'session-main px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-6 md:pt-7 md:pb-7 lg:px-8 xl:px-10'
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
                    ? 'session-route-shell mx-auto flex h-full min-h-0 w-full flex-col'
                    : 'flex w-full flex-col',
                )}
              >
                {sessionStartError && (
                  <div className="mx-auto mb-4 flex w-full max-w-6xl items-start gap-3 rounded-[28px] border border-apple-red/15 bg-apple-red/8 px-5 py-4 text-apple-red shadow-xl">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black">无法开始学习</p>
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
                <motion.div
                  key={routeSection}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: duration.base, ease: ease.out }}
                  className={cx(isSessionRoute && 'flex-1 min-h-0')}
                >
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
                          <SessionRouteView
                            userId={user?.id}
                            round={round}
                            words={activeWords}
                            activeLearningGroupId={activeLearningGroupId}
                            activeSessionSeed={activeSessionSeed}
                            activeReviewRecovery={activeReviewRecovery}
                            articleSentences={articleSentences}
                            articleGenerationError={articleGenerationError}
                            articleReinforcementEnabled={ARTICLE_REINFORCEMENT_ENABLED}
                            round1CanWaitForMoreWords={round1CanWaitForMoreWords}
                            sessionLeadingAction={sessionBackButton}
                            sessionActions={sessionSettingsButton}
                            onNavigateHome={() => navigateWithFreshHomeStats('/app/home')}
                            onRetryArticleGeneration={handleRetryArticleGeneration}
                            onRoundComplete={handleRoundComplete}
                            onLearningSessionChange={handleLearningSessionChange}
                            onReviewChange={handleReviewChange}
                            onWordMastered={handleSessionWordMastered}
                            onWordMasteredRollback={handleSessionWordMasteredRollback}
                          />
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
                </motion.div>
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
