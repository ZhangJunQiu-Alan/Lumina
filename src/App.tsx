/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Volume2,
} from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LearningRoundType,
  PersistedLearningSession,
  PronunciationLocale,
  ReviewAttemptSource,
  ReviewSummaryItem,
  RoundType,
  UserStats,
  Word,
} from './types';
import { Sidebar } from './components/layout/Sidebar';
import { HomeView } from './components/home/HomeView';
import { ImportView } from './components/import/ImportView';
import { supabase } from './lib/supabase';
import { fetchDueReviewWords, submitReviewAttempt } from './lib/reviewApi';
import { LibraryGroupDetailView, LibraryView } from './components/library/LibraryView';
import { ReviewResultsView } from './components/review/ReviewResultsView';
import { SettingsView } from './components/settings/SettingsView';
import { useAuth } from './contexts/AuthContext';
import { useLearningPreferences } from './contexts/LearningPreferencesContext';
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

// --- Learning sub-components (to be extracted in later sessions) ---

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

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

const RoundIndicator = ({ type, className }: { type: RoundType; className?: string }) => {
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
    <div className={cx('flex items-center gap-3', className)}>
      <div className={`px-4 py-1.5 ${colors[type]} text-white text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg`}>
        {labels[type]}
      </div>
      <div className="h-px flex-1 bg-black/5" />
    </div>
  );
};

const SessionProgress = ({
  currentIndex,
  queueLength,
}: {
  currentIndex: number;
  queueLength: number;
}) => (
  <div className="flex items-baseline gap-3 rounded-full border border-white/70 bg-white/70 px-4 py-2 shadow-[0_14px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl">
    <div className="text-sm font-black tracking-[0.16em] text-text-primary">
      {String(currentIndex + 1).padStart(2, '0')} / {String(queueLength).padStart(2, '0')}
    </div>
    <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">
      当前进度
    </span>
  </div>
);

const PronunciationControls = ({
  phonetic,
  audioLocale,
  isPlayingAudio,
  onPlay,
}: {
  phonetic: string;
  audioLocale: 'uk' | 'us';
  isPlayingAudio: boolean;
  onPlay: (locale: 'uk' | 'us') => void;
}) => (
  <div className="flex flex-wrap items-center gap-3">
    <span className="rounded-2xl bg-apple-blue px-4 py-2 text-lg font-black tracking-tight text-white shadow-[0_12px_30px_rgba(0,122,255,0.18)]">
      {phonetic || '暂无音标'}
    </span>
    {(['uk', 'us'] as const).map((loc) => (
      <button
        key={loc}
        type="button"
        onClick={() => onPlay(loc)}
        className={cx(
          'flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-black tracking-wide transition-all',
          audioLocale === loc
            ? 'bg-apple-blue text-white shadow-[0_10px_24px_rgba(0,122,255,0.16)]'
            : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15',
        )}
      >
        {isPlayingAudio && audioLocale === loc
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Volume2 className="h-3.5 w-3.5" />}
        {loc.toUpperCase()}
      </button>
    ))}
  </div>
);

const Round1ExampleCard = ({ word }: { word: Word }) => (
  <section className="rounded-[24px] border border-white/80 bg-white/60 p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">例句</p>
      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary/70">
        {word.example_sentences.length || 0} 条
      </span>
    </div>
    <div className="mt-4 space-y-3">
      {word.example_sentences.length > 0 ? word.example_sentences.map((sentence, index) => (
        <div
          key={`${word.id}-example-${index}`}
          className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
        >
          <p className="text-sm leading-6 text-text-primary">{renderBold(sentence)}</p>
        </div>
      )) : (
        <div className="rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-sm leading-6 text-text-secondary">
          这个词暂时还没有例句。
        </div>
      )}
    </div>
  </section>
);

const Round1ConfusingCard = ({ word }: { word: Word }) => (
  <section className="rounded-[24px] border border-white/80 bg-white/60 p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-text-secondary">易混词</p>
    {word.confusing_pair ? (
      <>
        <p className="mt-4 text-2xl font-black tracking-tight text-text-primary">
          {word.confusing_pair.word}
        </p>
        {word.confusing_pair.difference && (
          <p className="mt-4 text-sm leading-6 text-text-secondary">
            {word.confusing_pair.difference}
          </p>
        )}
      </>
    ) : (
      <p className="mt-4 text-sm leading-6 text-text-secondary">
        这个词当前没有需要特别提醒的易混词。
      </p>
    )}
  </section>
);

const InputSessionShell = ({
  type,
  currentIndex,
  queueLength,
  main,
}: {
  type: RoundType;
  currentIndex: number;
  queueLength: number;
  main: React.ReactNode;
}) => (
  <div className="input-session-shell mx-auto flex w-full max-w-[1260px] flex-col gap-4">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <RoundIndicator type={type} className="min-w-0 flex-1" />
      <SessionProgress currentIndex={currentIndex} queueLength={queueLength} />
    </header>

    <div className="input-session-shell__body min-w-0">
      {main}
    </div>
  </div>
);

const LearningEngine = ({
  type,
  words,
  initialSession,
  onComplete,
  onAttempt,
  onSessionChange,
}: {
  type: RoundType;
  words: Word[];
  initialSession?: PersistedLearningSession | null;
  onComplete: () => void | Promise<void>;
  onAttempt?: (params: {
    word: Word;
    source: ReviewAttemptSource;
    wasCorrect: boolean;
    elapsedMs: number;
  }) => Promise<void>;
  onSessionChange?: (session: {
    round: LearningRoundType;
    currentIndex: number;
    queueWordIds: string[];
  }) => void;
}) => {
  const { preferences } = useLearningPreferences();
  const initialEngineState = useMemo(() => {
    const hasMatchingSession = initialSession && initialSession.round === type;
    const wordMap = new Map(words.map((word) => [word.id, word]));
    const hydratedQueue = hasMatchingSession
      ? initialSession.queueWordIds
          .map((wordId) => wordMap.get(wordId))
          .filter((word): word is Word => Boolean(word))
      : [];
    const queue = hydratedQueue.length > 0 ? hydratedQueue : [...words];
    const currentIndex = hasMatchingSession
      ? Math.min(Math.max(initialSession.currentIndex, 0), Math.max(queue.length - 1, 0))
      : 0;

    return { queue, currentIndex };
  }, [initialSession, type, words]);

  const [queue, setQueue] = useState<Word[]>(initialEngineState.queue);
  const [currentIndex, setCurrentIndex] = useState(initialEngineState.currentIndex);
  const [inputValue, setInputValue] = useState('');
  const [isWrong, setIsWrong] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptStartedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRunIdRef = useRef(0);

  // Refs keep nextWord free of stale closures when called from setTimeout
  const queueRef = useRef<Word[]>(initialEngineState.queue);
  const currentIndexRef = useRef(initialEngineState.currentIndex);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const currentWord = queue[currentIndex];
  const roundSource = type === 'review' ? 'review' : type === 'round2' ? 'round2' : null;

  const clearAnswerRevealTimeout = useCallback(() => {
    if (answerRevealTimeoutRef.current === null) return;
    clearTimeout(answerRevealTimeoutRef.current);
    answerRevealTimeoutRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    playbackRunIdRef.current += 1;

    if (audioGapTimeoutRef.current !== null) {
      clearTimeout(audioGapTimeoutRef.current);
      audioGapTimeoutRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setIsPlayingAudio(false);
  }, []);

  useEffect(() => {
    clearAnswerRevealTimeout();
    stopPlayback();
    setQueue(initialEngineState.queue);
    setCurrentIndex(initialEngineState.currentIndex);
    setInputValue('');
    setIsWrong(false);
    setShowAnswer(false);
    setIsSubmittingAttempt(false);
    setSubmitError('');
    queueRef.current = initialEngineState.queue;
    currentIndexRef.current = initialEngineState.currentIndex;
  }, [clearAnswerRevealTimeout, initialEngineState, stopPlayback, type, words]);

  useEffect(() => () => {
    clearAnswerRevealTimeout();
    stopPlayback();
  }, [clearAnswerRevealTimeout, stopPlayback]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [currentIndex]);

  const speakViaBrowser = useCallback((wordText: string, locale: PronunciationLocale, runId: number) => {
    if (!('speechSynthesis' in window) || runId !== playbackRunIdRef.current) {
      return Promise.resolve();
    }

    window.speechSynthesis.cancel();
    setIsPlayingAudio(true);

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(wordText);
      utterance.lang = locale === 'uk' ? 'en-GB' : 'en-US';
      utterance.rate = 0.85;
      utterance.onend = () => {
        if (runId === playbackRunIdRef.current) {
          setIsPlayingAudio(false);
        }
        resolve();
      };
      utterance.onerror = () => {
        if (runId === playbackRunIdRef.current) {
          setIsPlayingAudio(false);
        }
        resolve();
      };
      window.speechSynthesis.speak(utterance);
    });
  }, []);

  const resolveAudioUrl = useCallback(async (word: Word, locale: PronunciationLocale) => {
    const cachedUrl = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
    if (cachedUrl) return cachedUrl;

    return apiFetch(`/api/audio/${encodeURIComponent(word.word)}?locale=${locale}`, {
      requiresAuth: false,
    })
      .then((response) => response.ok ? response.json().then((payload: { data: string }) => payload.data) : null)
      .catch(() => null);
  }, []);

  const waitForGap = useCallback((gapMs: number, runId: number) => (
    new Promise<void>((resolve) => {
      if (gapMs <= 0 || runId !== playbackRunIdRef.current) {
        resolve();
        return;
      }

      audioGapTimeoutRef.current = setTimeout(() => {
        audioGapTimeoutRef.current = null;
        resolve();
      }, gapMs);
    })
  ), []);

  const playAudioOnce = useCallback(async (word: Word, locale: PronunciationLocale, runId: number) => {
    if (runId !== playbackRunIdRef.current) return;

    const resolvedUrl = await resolveAudioUrl(word, locale);
    if (runId !== playbackRunIdRef.current) return;

    if (!resolvedUrl) {
      await speakViaBrowser(word.word, locale, runId);
      return;
    }

    setIsPlayingAudio(true);

    await new Promise<void>((resolve) => {
      const audio = new Audio(resolvedUrl);
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        if (runId === playbackRunIdRef.current) {
          setIsPlayingAudio(false);
        }
        resolve();
      };

      const fallbackToSpeech = () => {
        if (settled) return;
        settled = true;
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        if (runId === playbackRunIdRef.current) {
          setIsPlayingAudio(false);
        }
        void speakViaBrowser(word.word, locale, runId).then(resolve);
      };

      audioRef.current = audio;
      audio.onended = finish;
      audio.onerror = fallbackToSpeech;
      audio.play().catch(fallbackToSpeech);
    });
  }, [resolveAudioUrl, speakViaBrowser]);

  const playAudioSequence = useCallback(async (
    word: Word,
    locale: PronunciationLocale,
    repeatCount: number,
    gapMs: number,
  ) => {
    stopPlayback();
    const runId = playbackRunIdRef.current;

    for (let attempt = 0; attempt < repeatCount; attempt += 1) {
      await playAudioOnce(word, locale, runId);

      if (runId !== playbackRunIdRef.current) {
        return;
      }

      if (attempt < repeatCount - 1) {
        await waitForGap(gapMs, runId);
      }
    }
  }, [playAudioOnce, stopPlayback, waitForGap]);

  useEffect(() => {
    if (!currentWord) return;

    const locale = preferences.defaultPronunciationLocale;
    setAudioLocale(locale);
    stopPlayback();

    if (!preferences.autoPlayEnabled) {
      return;
    }

    void playAudioSequence(
      currentWord,
      locale,
      preferences.autoPlayRepeatCount,
      preferences.autoPlayRepeatGapMs,
    );
  }, [
    currentWord,
    playAudioSequence,
    preferences.autoPlayEnabled,
    preferences.autoPlayRepeatCount,
    preferences.autoPlayRepeatGapMs,
    preferences.defaultPronunciationLocale,
    stopPlayback,
  ]);

  useEffect(() => {
    if (!roundSource) return;
    promptStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setSubmitError('');
  }, [currentIndex, roundSource]);

  useEffect(() => {
    if (!onSessionChange || type === 'review') return;
    onSessionChange({
      round: type,
      currentIndex,
      queueWordIds: queue.map((word) => word.id),
    });
  }, [currentIndex, onSessionChange, queue, type]);

  const nextWord = useCallback(() => {
    clearAnswerRevealTimeout();
    stopPlayback();
    if (currentIndexRef.current < queueRef.current.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setInputValue('');
      setIsWrong(false);
      setShowAnswer(false);
    } else {
      void onComplete();
    }
  }, [clearAnswerRevealTimeout, onComplete, stopPlayback]);

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
      clearAnswerRevealTimeout();
      answerRevealTimeoutRef.current = setTimeout(() => {
        answerRevealTimeoutRef.current = null;
        setShowAnswer(false);
        nextWord();
      }, preferences.wrongAnswerRevealMs);
    }
  }, [clearAnswerRevealTimeout, currentIndex, currentWord, inputValue, nextWord, persistAttempt, preferences.wrongAnswerRevealMs, queue, type]);

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
  const primaryPos = currentWord.pos_tags[0] ?? '未标注';
  const actionDisabled = isSubmittingAttempt || ((type === 'round2' || type === 'review') && showAnswer);
  const actionLabel = (type === 'round2' || type === 'review') && showAnswer
    ? '答案展示中…'
    : type === 'round1'
      ? '验证拼写'
      : '提交答案';

  const inputField = (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="rounded-[24px] border border-white/80 bg-white/60 px-4 py-4 shadow-[0_14px_40px_rgba(14,26,56,0.06)] backdrop-blur-xl md:px-5 md:py-5">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInput}
          disabled={isSubmittingAttempt}
          className={cx(
            'w-full bg-transparent text-center font-black outline-none transition-colors caret-gray-800 placeholder:text-text-secondary/35',
            type === 'round1' ? 'text-3xl md:text-4xl' : 'text-4xl md:text-5xl',
            isWrong ? 'text-apple-red' : isCorrect ? 'text-[#10B981]' : 'text-text-primary',
          )}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          placeholder={type === 'round1' ? '拼写这个单词' : '输入英文拼写'}
        />
      </div>
    </form>
  );

  const feedbackReveal = (
    <AnimatePresence>
      {showAnswer && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="mx-auto mt-6 flex w-fit max-w-full items-center gap-3 rounded-[22px] bg-[#10B981] px-5 py-4 text-left font-bold text-white shadow-[0_16px_36px_rgba(16,185,129,0.24)]"
        >
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm leading-6 md:text-base">
            {currentWord.word} · {primaryPos}: {currentWord.chinese_definition}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const submitErrorBanner = submitError ? (
    <div className="rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red">
      {submitError}
    </div>
  ) : null;

  const actionButton = (
    <button
      type="button"
      onClick={() => { void validateCurrentInput(); }}
      disabled={actionDisabled}
      className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-apple-blue px-5 py-3.5 text-base font-black text-white shadow-[0_18px_40px_rgba(0,122,255,0.22)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:w-auto sm:min-w-[220px]"
    >
      {isSubmittingAttempt ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          正在写入结果…
        </>
      ) : (
        <>
          {actionLabel}
          <ChevronRight className="h-5 w-5" />
        </>
      )}
    </button>
  );

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
                onClick={() => { setAudioLocale(loc); void playAudioSequence(currentWord, loc, 1, 0); }}
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
    <InputSessionShell
      type={type}
      currentIndex={currentIndex}
      queueLength={queue.length}
      main={(
        <motion.div
          key={currentWord.id + currentIndex}
          initial={{ opacity: 0, scale: 0.97, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="glass rounded-[30px] px-5 py-6 shadow-[0_24px_64px_rgba(14,26,56,0.08)] md:px-7 md:py-7 lg:px-8 lg:py-7"
        >
          {type === 'round1' ? (
            <div className="flex flex-col gap-7">
              <div className="space-y-5">
                <PronunciationControls
                  phonetic={currentWord.phonetic}
                  audioLocale={audioLocale}
                  isPlayingAudio={isPlayingAudio}
                  onPlay={(locale) => {
                    setAudioLocale(locale);
                    void playAudioSequence(currentWord, locale, 1, 0);
                  }}
                />

                <div>
                  <p className="text-[clamp(2.4rem,4.1vw,4.2rem)] font-black leading-[0.94] tracking-[-0.055em] text-text-primary">
                    {currentWord.word}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
                      {primaryPos}
                    </span>
                    {currentWord.pos_tags.length > 1 && (
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-text-secondary">
                        另有 {currentWord.pos_tags.length - 1} 个词性
                      </span>
                    )}
                  </div>
                  <p className="mt-5 max-w-[680px] text-[1.9rem] font-black leading-tight text-text-primary md:text-[2rem]">
                    {currentWord.chinese_definition}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Round1ExampleCard word={currentWord} />
                <Round1ConfusingCard word={currentWord} />
              </div>

              <div className="space-y-4 rounded-[24px] border border-white/80 bg-white/45 p-4 shadow-[0_12px_30px_rgba(14,26,56,0.04)] md:p-5">
                {inputField}
                {submitErrorBanner}
                <div className="flex justify-end">
                  {actionButton}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center text-center">
              <div className="mx-auto max-w-3xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                  {type === 'review' ? '今日到期复习' : '主动回忆拼写'}
                </p>
                <p className="mt-5 text-4xl font-black leading-tight text-text-primary md:text-5xl">
                  {currentWord.chinese_definition}
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
                    {primaryPos}
                  </span>
                </div>
              </div>

              <div className="mx-auto mt-8 w-full max-w-3xl space-y-5">
                {inputField}
                {feedbackReveal}
                {submitErrorBanner}
                <div className="flex justify-center sm:justify-end">
                  {actionButton}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    />
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
              <p className="text-xs font-bold text-text-secondary uppercase tracking-widest">收个尾</p>
            </div>
          </div>
          <button
            onClick={onFinish}
            className="px-8 py-3 bg-apple-blue text-white font-bold rounded-2xl shadow-lg shadow-apple-blue/20"
          >
            读完了，回首页
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
          </div>
        </main>
      </div>
    </div>
  );
}
