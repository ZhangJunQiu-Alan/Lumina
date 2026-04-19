/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LearningRoundType,
  PersistedLearningSession,
  ReviewAttemptSource,
  ReviewSummaryItem,
  RoundType,
  UserStats,
  Word,
} from './types';
import { Sidebar } from './components/layout/Sidebar';
import { supabase } from './lib/supabase';
import { fetchDueReviewWords, submitReviewAttempt } from './lib/reviewApi';
import { useAuth } from './contexts/AuthContext';
import { apiFetch } from './lib/api';
import { invalidateLibraryCache } from './lib/libraryCache';
import { createInitialLearningSession } from './lib/learningSession';
import {
  clearLearningGroupSession,
  fetchGeneratedArticle,
  fetchLearningGroupSession,
  fetchResumeCandidate,
  persistLearningGroupSession,
  upsertGeneratedArticle,
} from './lib/learningSessionApi';
import { cx } from './components/shared/LearningUI';
import { LibrarySkeleton } from './components/shared/Skeleton';
import { useDeferredLoading } from './hooks/useDeferredLoading';

// --- Lazy loaded views ---
const HomeView = lazy(() => import('./components/home/HomeView').then(m => ({ default: m.HomeView })));
const ImportView = lazy(() => import('./components/import/ImportView').then(m => ({ default: m.ImportView })));
const LibraryView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryView })));
const OfficialLibraryDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.OfficialLibraryDetailView })));
const LibraryGroupDetailView = lazy(() => import('./components/library/LibraryView').then(m => ({ default: m.LibraryGroupDetailView })));
const ReviewResultsView = lazy(() => import('./components/review/ReviewResultsView').then(m => ({ default: m.ReviewResultsView })));
const SettingsView = lazy(() => import('./components/settings/SettingsView').then(m => ({ default: m.SettingsView })));

// --- Core Learning Components (Extracted) ---
const LearningEngine = lazy(() => import('./components/learning/LearningEngine').then(m => ({ default: m.LearningEngine })));
const ArticleView = lazy(() => import('./components/learning/ArticleView').then(m => ({ default: m.ArticleView })));

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

// --- Main App ---

function buildEmptyStats(): UserStats {
  return {
    todayReviewCount: 0,
    todayNewGroups: 0,
    streak: 0,
    totalLearned: 0,
    resumeCandidate: null,
  };
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const activeLearningGroupIdRef = useRef<string | null>(null);
  const sessionAutoRestoreRef = useRef<string | null>(null);
  const [round, setRound] = useState<RoundType>('round1');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [activeLearningGroupId, setActiveLearningGroupId] = useState<string | null>(null);
  const [activeSessionSeed, setActiveSessionSeed] = useState<PersistedLearningSession | null>(null);
  const [essay, setEssay] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [sessionStartError, setSessionStartError] = useState('');
  const [stats, setStats] = useState<UserStats>(buildEmptyStats);

  useEffect(() => {
    activeLearningGroupIdRef.current = activeLearningGroupId;
  }, [activeLearningGroupId]);

  // Fetch real stats from Supabase on mount
  const fetchStats = useCallback(async () => {
    if (!user) {
      setStats(buildEmptyStats());
      return;
    }

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [masteredRes, dueWords, groupTodayRes, allGroupsRes, resumeCandidate] = await Promise.all([
        supabase.from('review_states').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('memory_state', 'mastered'),
        fetchDueReviewWords(),
        supabase.from('learning_groups').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', todayStart.toISOString()),
        supabase.from('learning_groups')
          .select('created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        fetchResumeCandidate(user.id),
      ]);

      const totalLearned = masteredRes.count ?? 0;
      const todayReviewCount = dueWords.length;
      const todayNewGroups = groupTodayRes.count ?? 0;

      // Compute streak: consecutive days with at least one learning group created
      const dates = new Set(
        (allGroupsRes.data ?? []).map(r => r.created_at.split('T')[0])
      );
      let streak = 0;
      const check = new Date();
      check.setHours(0, 0, 0, 0);
      // If no activity today, start checking from yesterday
      const todayStr = check.toISOString().split('T')[0];
      if (!dates.has(todayStr)) {
        check.setDate(check.getDate() - 1);
      }
      while (true) {
        const dateStr = check.toISOString().split('T')[0];
        if (dates.has(dateStr)) {
          streak++;
          check.setDate(check.getDate() - 1);
        } else {
          break;
        }
      }

      setStats({
        todayReviewCount,
        todayNewGroups,
        streak,
        totalLearned,
        resumeCandidate,
      });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [user]);

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
      setEssay(null);
      setRound('round1');
    }
  }, [user]);

  const resetActiveLearningState = useCallback(() => {
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setActiveSessionSeed(null);
    setEssay(null);
    setRound('round1');
  }, []);

  const completeLearningGroup = useCallback(async () => {
    if (!activeLearningGroupId || !user) return;

    try {
      await clearLearningGroupSession(user.id, activeLearningGroupId, { markCompleted: true });
      invalidateLibraryCache(user.id);
    } catch (error) {
      console.error('Failed to complete learning group:', error);
    }
  }, [activeLearningGroupId, user]);

  const ensureArticleForGroup = useCallback(async (groupId: string, words: Word[]) => {
    if (!user) return null;

    try {
      const existingArticle = await fetchGeneratedArticle(user.id, groupId);
      if (existingArticle !== null) {
        if (activeLearningGroupIdRef.current === groupId) {
          setEssay(existingArticle);
        }
        return existingArticle;
      }
    } catch (error) {
      console.error('Article lookup failed:', error);
    }

    try {
      const res = await apiFetch('/api/vocab/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: words.map((word) => word.word) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const article = data as string;

      await upsertGeneratedArticle(user.id, groupId, article, words.map((word) => word.word));

      if (activeLearningGroupIdRef.current === groupId) {
        setEssay(article);
      }

      return article;
    } catch (error) {
      console.error('Article generation failed:', error);
      if (activeLearningGroupIdRef.current === groupId) {
        setEssay('');
      }
      return '';
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
      setEssay(nextSession.round === 'article' ? nextSession.article ?? null : null);
      setRound(nextSession.round);
      navigate('/app/session');

      await persistLearningGroupSession(user.id, nextSession);
      invalidateLibraryCache(user.id);

      if (nextSession.round === 'article' && !nextSession.article) {
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
    setSessionStartError('');
    if (stats.todayReviewCount > 0) {
      setIsStartingSession(true);
      try {
        const dueWords = await fetchDueReviewWords();
        if (dueWords.length === 0) {
          await fetchStats();
          return;
        }

        setReviewSummary([]);
        setActiveLearningGroupId(null);
        setActiveSessionSeed(null);
        setActiveWords(dueWords);
        setEssay(null);
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

    if (stats.resumeCandidate) {
      await openLearningGroup(stats.resumeCandidate.groupId);
      return;
    }

    navigate('/app/import');
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
  }, [activeLearningGroupId]);

  const handleLearningSessionChange = useCallback((session: {
    round: LearningRoundType;
    currentIndex: number;
    queueWordIds: string[];
  }) => {
    if (!activeLearningGroupId || !user) return;

    void persistLearningGroupSession(user.id, {
      groupId: activeLearningGroupId,
      round: session.round,
      currentIndex: session.currentIndex,
      queueWordIds: session.queueWordIds,
      lastActiveAt: new Date().toISOString(),
    }).catch((error) => {
      console.error('Failed to persist learning session snapshot:', error);
    });
  }, [activeLearningGroupId, user]);

  const handleRoundComplete = async () => {
    if (round === 'review') {
      navigate('/app/review-results');
      return;
    }

    if (!activeLearningGroupId || !user) {
      return;
    }

    if (round === 'round1' || round === 'round2') {
      const nextRound: LearningRoundType = round === 'round1' ? 'round2' : 'round3';
      const nextSession = createInitialLearningSession(activeLearningGroupId, activeWords, nextRound);

      setActiveSessionSeed(nextSession);
      setRound(nextRound);
      void persistLearningGroupSession(user.id, nextSession).catch((error) => {
        console.error('Failed to persist round transition:', error);
      });
      return;
    }

    if (round === 'round3') {
      const nextSession = createInitialLearningSession(activeLearningGroupId, activeWords, 'article');

      setActiveSessionSeed(nextSession);
      setRound('article');
      setEssay(null);
      void persistLearningGroupSession(user.id, nextSession).catch((error) => {
        console.error('Failed to persist article transition:', error);
      });
      void ensureArticleForGroup(activeLearningGroupId, activeWords);
      return;
    }

    await completeLearningGroup();
    resetActiveLearningState();
    navigate('/app/home');
    void fetchStats();
  };

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
    if (location.pathname.startsWith('/app/settings')) return '/app/settings';
    if (location.pathname.startsWith('/app/profile')) return '/app/profile';
    return '/app/home';
  })();
  const isSessionRoute = location.pathname.startsWith('/app/session');

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    if (!isSessionRoute) {
      sessionAutoRestoreRef.current = null;
      return;
    }

    if (!user || activeWords.length > 0 || isStartingSession || !stats.resumeCandidate) {
      return;
    }

    if (sessionAutoRestoreRef.current === stats.resumeCandidate.groupId) {
      return;
    }

    sessionAutoRestoreRef.current = stats.resumeCandidate.groupId;
    void openLearningGroup(stats.resumeCandidate.groupId);
  }, [
    activeWords.length,
    isSessionRoute,
    isStartingSession,
    openLearningGroup,
    stats.resumeCandidate,
    user,
  ]);

  const sessionEmptyState = (
      <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center jelly-shadow">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">这里还没有内容</p>
      <h2 className="mt-4 text-3xl font-black text-text-primary">先回首页，从今天该做的开始。</h2>
      <p className="mt-4 text-sm leading-7 text-text-secondary">
        如果今天有复习，会先带你去复习；没有的话，就去导入新的一组。
      </p>
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
    <div className="min-h-screen flex">
      <Sidebar
        activePath={activeNavPath}
        onNavigate={(to) => navigate(to)}
        onSignOut={() => { void handleSignOut(); }}
        userEmail={user?.email ?? null}
        userName={(user?.user_metadata.full_name as string | undefined) ?? null}
      />

      <div className="flex-1 relative h-screen overflow-hidden">
        <main
          ref={mainScrollRef}
          className={cx(
            'h-full overflow-y-auto',
            isSessionRoute
              ? 'session-main px-4 py-6 md:px-6 md:py-7 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10'
              : 'px-6 pt-24 pb-32 lg:px-6 lg:py-7 lg:pl-[8.5rem] lg:pr-8 xl:pl-[9rem] xl:pr-10',
          )}
        >
          <div
            className={cx(
              'min-h-full',
              isSessionRoute
                ? 'session-route-shell mx-auto flex w-full max-w-[1460px] flex-col'
                : 'flex w-full flex-col',
            )}
          >
            {sessionStartError && (
              <div className="mx-auto mb-4 flex w-full max-w-6xl items-start gap-3 rounded-[28px] border border-apple-red/15 bg-apple-red/8 px-5 py-4 text-apple-red shadow-[0_18px_40px_rgba(255,59,48,0.08)]">
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
            <Suspense fallback={<LoadingShell isSkeleton={location.pathname.includes('/library')}>{null}</LoadingShell>}>
              <Routes>
                <Route
                  path="home"
                  element={<HomeView stats={stats} onStart={() => { void handleStart(); }} isLoading={isStartingSession} />}
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
                <Route path="import" element={<ImportView onStartLearning={handleStartLearningGroup} />} />
                <Route
                  path="session"
                  element={activeWords.length === 0 ? sessionEmptyState : (
                    round === 'article' ? (
                      essay === null ? (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="glass p-16 rounded-apple-lg jelly-shadow flex flex-col items-center gap-6"
                        >
                          <Loader2 className="w-10 h-10 text-apple-green animate-spin" />
                          <p className="font-black text-xl">正在生成收尾文章</p>
                        </motion.div>
                      ) : (
                        <ArticleView essay={essay} words={activeWords} onFinish={handleRoundComplete} />
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
                      <div className="glass relative overflow-hidden rounded-[36px] p-8 shadow-[0_30px_80px_rgba(14,26,56,0.08)] md:p-10">
                        <div className="pointer-events-none absolute -left-8 top-0 h-40 w-40 rounded-full bg-apple-blue/12 blur-3xl" />
                        <div className="pointer-events-none absolute right-0 bottom-0 h-44 w-44 rounded-full bg-apple-green/10 blur-3xl" />

                        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-apple-blue text-4xl font-black text-white shadow-[0_22px_44px_rgba(0,122,255,0.22)]">
                              {(user?.email?.[0] ?? 'L').toUpperCase()}
                            </div>
                            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">Account</p>
                            <h2 className="mt-3 text-4xl font-black text-text-primary">
                              {(user?.user_metadata.full_name as string | undefined) ?? '当前账号'}
                            </h2>
                            <p className="mt-3 text-base text-text-secondary">{user?.email ?? '还没拿到邮箱'}</p>
                          </div>

                          <button
                            type="button"
                            onClick={() => navigate('/app/settings')}
                            className="inline-flex items-center gap-2 rounded-full bg-[#12192b] px-5 py-3 text-sm font-black text-white shadow-[0_18px_34px_rgba(18,25,43,0.22)] transition-transform hover:scale-[1.01] active:scale-[0.99]"
                          >
                            打开学习设置
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-5 md:grid-cols-3">
                        <div className="glass rounded-[30px] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">已掌握</p>
                          <p className="mt-3 text-4xl font-black text-text-primary">{stats.totalLearned}</p>
                          <p className="mt-3 text-sm leading-6 text-text-secondary">已经稳定掌握、进入长期记忆的词。</p>
                        </div>
                        <div className="glass rounded-[30px] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">待复习</p>
                          <p className="mt-3 text-4xl font-black text-text-primary">{stats.todayReviewCount}</p>
                          <p className="mt-3 text-sm leading-6 text-text-secondary">今天还在等待你回看的词。</p>
                        </div>
                        <div className="glass rounded-[30px] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
                          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">连续天数</p>
                          <p className="mt-3 text-4xl font-black text-text-primary">{stats.streak}</p>
                          <p className="mt-3 text-sm leading-6 text-text-secondary">最近连续学习没有断开的天数。</p>
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
        </main>
      </div>
    </div>
  );
}
