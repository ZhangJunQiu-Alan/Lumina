/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Volume2,
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Word, RoundType, UserStats, ReviewAttemptSource, ReviewSummaryItem } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { HomeView } from './components/home/HomeView';
import { ImportView } from './components/import/ImportView';
import { supabase } from './lib/supabase';
import { fetchDueReviewWords, submitReviewAttempt } from './lib/reviewApi';
import { LibraryView } from './components/library/LibraryView';
import { ReviewResultsView } from './components/review/ReviewResultsView';
import { useAuth } from './contexts/AuthContext';
import { apiFetch } from './lib/api';

// --- Learning sub-components (to be extracted in later sessions) ---

// Plain helper — NOT a React component — avoids remount on every LearningEngine render
function renderProgressBar(currentIndex: number, queueLength: number) {
  return (
    <div className="mt-auto w-full max-w-3xl flex justify-between items-center px-4 pb-12">
      <div className="text-xs font-bold text-text-secondary uppercase tracking-widest">
        第 {currentIndex + 1} / {queueLength} 个词
      </div>
      <div className="flex gap-1">
        {Array.from({ length: queueLength }, (_, i) => (
          <div
            key={i}
            className={`h-1 rounded-full transition-all ${
              i === currentIndex ? 'w-8 bg-apple-blue'
              : i < currentIndex ? 'w-2 bg-apple-blue/30'
              : 'w-2 bg-black/5'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// Render **bold** markdown syntax as <strong> spans
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

const RoundIndicator = ({ type }: { type: RoundType }) => {
  const labels: Record<RoundType, string> = {
    review: '今日复习',
    round1: '第一轮：明示拼写',
    round2: '第二轮：主动回忆',
    round3: '第三轮：快速识别',
    article: '文章巩固',
  };
  const colors: Record<RoundType, string> = {
    review: 'bg-apple-red',
    round1: 'bg-apple-indigo',
    round2: 'bg-apple-blue',
    round3: 'bg-apple-teal',
    article: 'bg-apple-green',
  };
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className={`px-4 py-1.5 ${colors[type]} text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg`}>
        {labels[type]}
      </div>
      <div className="h-px flex-1 bg-black/5" />
    </div>
  );
};

const LearningEngine = ({
  type,
  words,
  onComplete,
  onAttempt,
}: {
  type: RoundType;
  words: Word[];
  onComplete: () => void | Promise<void>;
  onAttempt?: (params: {
    word: Word;
    source: ReviewAttemptSource;
    wasCorrect: boolean;
    elapsedMs: number;
  }) => Promise<void>;
}) => {
  const [queue, setQueue] = useState<Word[]>([...words]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [isWrong, setIsWrong] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [audioLocale, setAudioLocale] = useState<'uk' | 'us'>('uk');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptStartedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refs keep nextWord free of stale closures when called from setTimeout
  const queueRef = useRef<Word[]>([...words]);
  const currentIndexRef = useRef(0);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const currentWord = queue[currentIndex];
  const roundSource = type === 'review' ? 'review' : type === 'round2' ? 'round2' : null;

  useEffect(() => {
    const nextQueue = [...words];
    setQueue(nextQueue);
    setCurrentIndex(0);
    setInputValue('');
    setIsWrong(false);
    setShowAnswer(false);
    setIsSubmittingAttempt(false);
    setSubmitError('');
    queueRef.current = nextQueue;
    currentIndexRef.current = 0;
  }, [type, words]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentIndex]);

  // Auto-play UK pronunciation when word changes
  const playAudio = useCallback(async (word: Word, locale: 'uk' | 'us') => {
    if (isPlayingAudio) return;
    const url = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;

    const resolvedUrl: string | null = url ?? await fetch(
      `/api/audio/${encodeURIComponent(word.word)}?locale=${locale}`
    ).then(r => r.ok ? r.json().then((d: { data: string }) => d.data) : null).catch(() => null);

    if (!resolvedUrl) return;

    setIsPlayingAudio(true);
    audioRef.current?.pause();
    const audio = new Audio(resolvedUrl);
    audioRef.current = audio;
    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);
    audio.play().catch(() => setIsPlayingAudio(false));
  }, [isPlayingAudio]);

  useEffect(() => {
    if (!currentWord) return;
    void playAudio(currentWord, 'uk');
    setAudioLocale('uk');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord?.id]);

  useEffect(() => {
    if (!roundSource) return;
    promptStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setSubmitError('');
  }, [currentIndex, roundSource]);

  const nextWord = useCallback(() => {
    if (currentIndexRef.current < queueRef.current.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setInputValue('');
      setIsWrong(false);
      setShowAnswer(false);
    } else {
      void onComplete();
    }
  }, [onComplete]);

  const persistAttempt = useCallback(async (wasCorrect: boolean) => {
    if (!onAttempt || !roundSource) return true;

    setIsSubmittingAttempt(true);
    setSubmitError('');

    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = Math.max(0, Math.round(now - promptStartedAtRef.current));
      await onAttempt({
        word: currentWord,
        source: roundSource,
        wasCorrect,
        elapsedMs,
      });
      return true;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsSubmittingAttempt(false);
    }
  }, [currentWord, onAttempt, roundSource]);

  const handleRound3PrimaryAction = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      return;
    }

    nextWord();
  }, [showAnswer, nextWord]);

  const validateCurrentInput = useCallback(async () => {
    const wasCorrect = inputValue.trim().toLowerCase() === currentWord.word.toLowerCase();
    const persisted = await persistAttempt(wasCorrect);
    if (!persisted) return;

    if (wasCorrect) {
      nextWord();
      return;
    }

    setIsWrong(true);
    if (type === 'round2' || type === 'review') {
      const newQueue = [...queue];
      const insertAt = Math.min(currentIndex + Math.floor(Math.random() * 3) + 2, newQueue.length);
      newQueue.splice(insertAt, 0, currentWord);
      setQueue(newQueue);
      // Clear input immediately so the wrong text doesn't linger during the reveal
      setInputValue('');
      setIsWrong(false);
      setShowAnswer(true);
      setTimeout(() => {
        setShowAnswer(false);
        nextWord();
      }, 1500);
    }
  }, [currentIndex, currentWord, inputValue, nextWord, persistAttempt, queue, type]);

  useEffect(() => {
    if (type !== 'round3') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return;
      event.preventDefault();
      handleRound3PrimaryAction();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRound3PrimaryAction, type]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setIsWrong(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === 'round3') {
      handleRound3PrimaryAction();
      return;
    }
    void validateCurrentInput();
  };

  if (!currentWord) {
    return (
      <div className="glass rounded-apple-lg p-16 text-center">
        <p className="text-xl font-black">当前会话里没有可用单词。</p>
      </div>
    );
  }

  const isCorrect = inputValue.trim().toLowerCase() === currentWord.word.toLowerCase();

  // Round 3: flip-card recognition — no input, just reveal and advance
  if (type === 'round3') {
    return (
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
        <div className="w-full max-w-3xl">
          <RoundIndicator type={type} />
        </div>
        <motion.div
          key={currentWord.id + currentIndex}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full flex flex-col items-center justify-center min-h-[500px]"
        >
          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex items-center gap-2 mb-8"
          >
            <span className="bg-apple-teal text-white px-4 py-1 rounded-lg text-sm font-bold shadow-sm">
              {currentWord.phonetic}
            </span>
            {(['uk', 'us'] as const).map(loc => (
              <button
                key={loc}
                type="button"
                onClick={() => { setAudioLocale(loc); void playAudio(currentWord, loc); }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                  audioLocale === loc
                    ? 'bg-apple-teal text-white shadow-sm'
                    : 'bg-apple-teal/10 text-apple-teal hover:bg-apple-teal/20'
                }`}
              >
                {isPlayingAudio && audioLocale === loc
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Volume2 className="w-3 h-3" />}
                {loc.toUpperCase()}
              </button>
            ))}
          </motion.div>

          <div className="text-7xl font-black text-text-primary mb-4">{currentWord.word}</div>
          <div className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-8">
            {currentWord.pos_tags[0]}
          </div>

          <AnimatePresence>
            {showAnswer && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 text-center"
              >
                <p className="text-3xl font-bold text-text-primary">{currentWord.chinese_definition}</p>
                {currentWord.example_sentences[0] && (
                  <p className="mt-4 text-base text-text-secondary max-w-xl">{renderBold(currentWord.example_sentences[0])}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!showAnswer && (
            <p className="text-text-secondary/40 text-sm mt-8">先自己回想，再决定要不要翻开答案。</p>
          )}
        </motion.div>

        {renderProgressBar(currentIndex, queue.length)}

        <div className="w-full max-w-3xl px-4 pb-8">
          <button
            type="button"
            onClick={handleRound3PrimaryAction}
            className="w-full py-4 bg-apple-blue text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] transition-all"
          >
            {showAnswer ? '下一个词' : '显示释义'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  // Round 1 & 2 / Review: input-based
  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
      <div className="w-full max-w-3xl">
        <RoundIndicator type={type} />
      </div>
      <motion.div
        key={currentWord.id + currentIndex}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full flex flex-col items-center justify-center min-h-[500px] relative"
      >
        <motion.div
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-2 mb-12"
        >
          <span className="bg-apple-blue text-white px-4 py-1 rounded-lg text-sm font-bold shadow-sm">
            {currentWord.phonetic}
          </span>
          {(['uk', 'us'] as const).map(loc => (
            <button
              key={loc}
              type="button"
              onClick={() => { setAudioLocale(loc); void playAudio(currentWord, loc); }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                audioLocale === loc
                  ? 'bg-apple-blue text-white shadow-sm'
                  : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/20'
              }`}
            >
              {isPlayingAudio && audioLocale === loc
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Volume2 className="w-3 h-3" />}
              {loc.toUpperCase()}
            </button>
          ))}
        </motion.div>

        {type === 'round1' && (
          <div className="w-full max-w-3xl mb-12 space-y-5">
            <div className="text-center">
              <div className="text-7xl font-black text-text-primary">{currentWord.word}</div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {currentWord.pos_tags.map((tag) => (
                  <span
                    key={`${currentWord.id}-${tag}`}
                    className="rounded-full bg-apple-gray px-3 py-1 text-xs font-bold uppercase tracking-widest text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
                {currentWord.ner_entities.map((entity) => (
                  <span
                    key={`${currentWord.id}-${entity.label}-${entity.text}`}
                    className="rounded-full bg-apple-blue/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-apple-blue"
                  >
                    {entity.label}: {entity.text}
                  </span>
                ))}
              </div>
              <p className="mt-6 text-3xl font-bold text-text-primary">{currentWord.chinese_definition}</p>
            </div>

            {currentWord.example_sentences.length > 0 && (
              <div className="glass rounded-2xl p-6 text-left">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">例句</p>
                <div className="mt-3 space-y-3">
                  {currentWord.example_sentences.map((sentence, index) => (
                    <p key={`${currentWord.id}-example-${index}`} className="text-base leading-7 text-text-primary">
                      {renderBold(sentence)}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {currentWord.confusing_pair && (
              <div className="glass rounded-2xl p-6 text-left">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">易混词</p>
                <p className="mt-3 text-lg font-bold text-text-primary">{currentWord.confusing_pair.word}</p>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{currentWord.confusing_pair.difference}</p>
              </div>
            )}
          </div>
        )}

        <div className="w-full max-w-2xl flex flex-col items-center">
          <form onSubmit={handleSubmit} className="w-full text-center relative">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInput}
              disabled={isSubmittingAttempt}
              className={`w-full bg-transparent text-center font-bold outline-none transition-colors caret-gray-800 ${
                type === 'round1' ? 'text-6xl' : 'text-8xl'
              } ${
                isWrong ? 'text-apple-red' : isCorrect ? 'text-[#10B981]' : 'text-text-primary'
              }`}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <div className="w-full h-[1px] bg-gray-400 mt-6" />
          </form>

          {submitError && (
            <div className="mt-5 w-full rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red">
              {submitError}
            </div>
          )}

          {type === 'round1' && (
            <p className="mt-5 text-sm font-medium text-text-secondary">
              先自己拼出来，再按 Enter 或点击按钮验证。
            </p>
          )}

          <AnimatePresence>
            {showAnswer && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10 bg-[#10B981] text-white px-8 py-4 rounded-xl flex items-center gap-3 font-bold shadow-xl shadow-green-500/20"
              >
                <CheckCircle2 className="w-6 h-6" />
                <span className="text-xl">
                  {currentWord.word} · {currentWord.pos_tags[0]}: {currentWord.chinese_definition}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {(type === 'round2' || type === 'review') && !isCorrect && !showAnswer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-16 text-center">
            <p className="text-3xl font-bold text-text-secondary/60">{currentWord.chinese_definition}</p>
          </motion.div>
        )}
      </motion.div>

      {renderProgressBar(currentIndex, queue.length)}

      {(type === 'round1' || type === 'round2') && (
        <div className="w-full max-w-3xl px-4 pb-8">
          <button
            type="button"
            onClick={() => { void validateCurrentInput(); }}
            disabled={isSubmittingAttempt || (type === 'round2' && showAnswer)}
            className="w-full py-4 bg-apple-blue text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {isSubmittingAttempt ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                正在写入结果…
              </>
            ) : (
              <>
                下一个词
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

const ArticleView = ({ essay, words, onFinish }: { essay: string; words: Word[]; onFinish: () => void }) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-4xl mx-auto py-12">
      <div className="glass rounded-apple-lg p-16 jelly-shadow relative">
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-apple-green rounded-2xl flex items-center justify-center">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">文章巩固</h2>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">最后一步</p>
            </div>
          </div>
          <button
            onClick={onFinish}
            className="px-8 py-3 bg-apple-blue text-white font-bold rounded-2xl shadow-lg shadow-apple-blue/20"
          >
            结束这一轮
          </button>
        </div>
        <div className="prose prose-xl max-w-none text-gray-800 leading-[1.8] font-medium">
          {essay.split(' ').map((word, i) => {
            const cleanWord = word.replace(/[.,!?;]/g, '').toLowerCase();
            const isTarget = words.some((w) => w.word.toLowerCase() === cleanWord);
            return (
              <span key={i} className={isTarget ? 'bg-apple-blue/10 text-apple-blue font-bold px-1 rounded' : ''}>
                {word}{' '}
              </span>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
};

// --- Main App ---

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [round, setRound] = useState<RoundType>('round1');
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [activeLearningGroupId, setActiveLearningGroupId] = useState<string | null>(null);
  const [essay, setEssay] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryItem[]>([]);
  const [stats, setStats] = useState<UserStats>({
    todayReviewCount: 0,
    todayNewGroups: 0,
    streak: 0,
    totalLearned: 0,
  });

  // Fetch real stats from Supabase on mount
  const fetchStats = useCallback(async () => {
    if (!user) {
      setStats({
        todayReviewCount: 0,
        todayNewGroups: 0,
        streak: 0,
        totalLearned: 0,
      });
      return;
    }

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [masteredRes, dueWords, groupTodayRes, allGroupsRes] = await Promise.all([
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

      setStats({ todayReviewCount, todayNewGroups, streak, totalLearned });
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [user]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (!user) {
      setActiveWords([]);
      setActiveLearningGroupId(null);
      setReviewSummary([]);
      setEssay(null);
      setRound('round1');
    }
  }, [user]);

  const completeLearningGroup = useCallback(async () => {
    if (!activeLearningGroupId || !user) return;

    const { error } = await supabase
      .from('learning_groups')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', activeLearningGroupId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Failed to complete learning group:', error.message);
    }
  }, [activeLearningGroupId, user]);

  // Generate IELTS reading article via server
  const fetchArticle = useCallback(async (words: string[]) => {
    try {
      const res = await apiFetch('/api/vocab/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      setEssay(data as string);
    } catch (err) {
      console.error('Article generation failed:', err);
      setEssay('');
    }
  }, []);

  const handleStart = async () => {
    if (stats.todayReviewCount === 0) {
      navigate('/app/import');
      return;
    }

    setIsStartingSession(true);
    try {
      const dueWords = await fetchDueReviewWords();
      if (dueWords.length === 0) {
        await fetchStats();
        return;
      }

      setReviewSummary([]);
      setActiveLearningGroupId(null);
      setActiveWords(dueWords);
      setEssay(null);
      setRound('review');
      navigate('/app/session');
    } catch (error) {
      console.error('Failed to start review session:', error);
    } finally {
      setIsStartingSession(false);
    }
  };

  // Called by ImportView after enrichment + DB save
  const handleImportStart = (words: Word[], groupId: string) => {
    setReviewSummary([]);
    setActiveWords(words);
    setActiveLearningGroupId(groupId);
    setEssay(null);
    setRound('round1');
    navigate('/app/session');
  };

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

  const handleRoundComplete = async () => {
    if (round === 'review') {
      navigate('/app/review-results');
    } else if (round === 'round1') {
      setRound('round2');
    } else if (round === 'round2') {
      setRound('round3');
    } else if (round === 'round3') {
      setRound('article');
      setEssay(null);
      void fetchArticle(activeWords.map(w => w.word));
    } else {
      await completeLearningGroup();
      setActiveLearningGroupId(null);
      setActiveWords([]);
      setEssay(null);
      navigate('/app/home');
      void fetchStats();
    }
  };

  const handleReviewResultsBackHome = () => {
    navigate('/app/home');
    setReviewSummary([]);
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setEssay(null);
    void fetchStats();
  };

  const handleSignOut = async () => {
    setActiveWords([]);
    setActiveLearningGroupId(null);
    setReviewSummary([]);
    setEssay(null);
    setRound('round1');
    await signOut();
    window.location.assign('/');
  };

  const activeNavPath = (() => {
    if (location.pathname.startsWith('/app/library')) return '/app/library';
    if (location.pathname.startsWith('/app/import')) return '/app/import';
    if (location.pathname.startsWith('/app/profile')) return '/app/profile';
    return '/app/home';
  })();

  const sessionEmptyState = (
    <div className="glass mx-auto max-w-3xl rounded-apple-lg p-16 text-center jelly-shadow">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-text-secondary">当前没有学习会话</p>
      <h2 className="mt-4 text-3xl font-black text-text-primary">先从首页开始，系统才知道接下来该带你去哪。</h2>
      <p className="mt-4 text-sm leading-7 text-text-secondary">
        如果今天有到期复习，会先进入复习；如果没有，系统会带你去导入新的学习组。
      </p>
      <button
        type="button"
        onClick={() => navigate('/app/home')}
        className="mt-8 rounded-2xl bg-apple-blue px-6 py-4 text-base font-black text-white"
      >
        回到首页
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
        <main className="h-full pt-24 pb-32 overflow-y-auto px-6">
          <div className="container mx-auto h-full flex flex-col items-center justify-center">
            <Routes>
              <Route
                path="home"
                element={<HomeView stats={stats} onStart={() => { void handleStart(); }} isLoading={isStartingSession} />}
              />
              <Route path="library" element={<LibraryView />} />
              <Route path="import" element={<ImportView onStartLearning={handleImportStart} />} />
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
                        <p className="font-black text-xl">正在生成本轮收尾文章</p>
                      </motion.div>
                    ) : (
                      <ArticleView essay={essay} words={activeWords} onFinish={handleRoundComplete} />
                    )
                  ) : (
                    <LearningEngine
                      type={round}
                      words={activeWords}
                      onComplete={handleRoundComplete}
                      onAttempt={handleAttempt}
                    />
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
                  <div className="w-full max-w-2xl mx-auto glass p-12 rounded-apple-lg text-center">
                    <div className="w-24 h-24 bg-apple-blue rounded-full mx-auto mb-6 flex items-center justify-center text-white text-4xl font-black">
                      {(user?.email?.[0] ?? 'L').toUpperCase()}
                    </div>
                    <h2 className="text-2xl font-black mb-2">
                      {(user?.user_metadata.full_name as string | undefined) ?? '当前账户'}
                    </h2>
                    <p className="text-text-secondary mb-8">{user?.email ?? '未读取到邮箱'}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-apple-gray p-4 rounded-2xl">
                        <div className="text-2xl font-black">{stats.totalLearned}</div>
                        <div className="text-[10px] font-bold uppercase text-text-secondary">已掌握</div>
                      </div>
                      <div className="bg-apple-gray p-4 rounded-2xl">
                        <div className="text-2xl font-black">{stats.todayReviewCount}</div>
                        <div className="text-[10px] font-bold uppercase text-text-secondary">待复习</div>
                      </div>
                    </div>
                  </div>
                )}
              />
              <Route path="*" element={<Navigate to="/app/home" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
