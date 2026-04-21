import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronRight, Loader2, Volume2, XCircle } from 'lucide-react';
import { 
  LearningRoundType, 
  PersistedLearningSession, 
  PronunciationLocale, 
  ReviewAttemptSource, 
  RoundType, 
  Word 
} from '../../types';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { apiFetch } from '../../lib/api';
import { cancelBrowserSpeech, isBrowserSpeechSupported, speakTextViaBrowser } from '../../lib/browserSpeech';
import { ExampleSentenceList } from '../shared/ExampleSentenceList';
import {
  cx,
  PronunciationControls,
  RoundIndicator,
  SessionProgress,
  WordSenseList
} from '../shared/LearningUI';
import { buildClozePrompt } from '../../lib/cloze';
import { Round2ClozePrompt } from './Round2ClozePrompt';
import { attemptBuffer } from '../../lib/attemptBuffer';

// --- Sub-components for Round 1 ---

const Round1MorphologyCard = ({ word }: { word: Word }) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <p className="text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">构词拆解 / 派生词</p>
    <div className="mt-4 space-y-3">
      {word.morphology.parts.length > 0 ? word.morphology.parts.map((part, index) => (
        <div
          key={`${word.id}-morphology-${index}`}
          className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[18px] font-black text-text-primary">{part.text}</p>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[13px] font-bold uppercase tracking-[0.18em] text-text-secondary">
              {part.kind}
            </span>
          </div>
          {(part.meaningZh || part.noteZh) && (
            <p className="mt-2 text-[16px] leading-[1.65] text-text-secondary">
              {[part.meaningZh, part.noteZh].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )) : (
        <div className="rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-[18px] leading-[1.75] text-text-secondary">
          这个词目前还没有可展示的构词拆解。
        </div>
      )}
    </div>

    <div className="mt-4">
      <p className="text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">派生词</p>
      <div className="mt-3 space-y-3">
        {word.derivedWords.length > 0 ? word.derivedWords.map((item) => (
          <div
            key={`${word.id}-derived-${item.word}`}
            className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
          >
            <p className="text-[18px] font-black text-text-primary">{item.word}</p>
            {(item.meaningZh || item.noteZh) && (
              <p className="mt-2 text-[16px] leading-[1.65] text-text-secondary">
                {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )) : (
          <div className="rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-[18px] leading-[1.75] text-text-secondary">
            这个词目前还没有派生词线索。
          </div>
        )}
      </div>
    </div>
  </section>
);

const Round1RelationsCard = ({ word }: { word: Word }) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">近义词</p>
        <div className="mt-3 space-y-3">
          {word.synonyms.length > 0 ? word.synonyms.map((item) => (
            <div
              key={`${word.id}-synonym-${item.word}`}
              className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
            >
              <p className="text-[18px] font-black text-text-primary">{item.word}</p>
              {(item.meaningZh || item.noteZh) && (
                <p className="mt-2 text-[16px] leading-[1.65] text-text-secondary">
                  {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )) : (
            <div className="rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-[18px] leading-[1.75] text-text-secondary">
              这个词目前还没有近义词线索。
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">反义词</p>
        <div className="mt-3 space-y-3">
          {word.antonyms.length > 0 ? word.antonyms.map((item) => (
            <div
              key={`${word.id}-antonym-${item.word}`}
              className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
            >
              <p className="text-[18px] font-black text-text-primary">{item.word}</p>
              {(item.meaningZh || item.noteZh) && (
                <p className="mt-2 text-[16px] leading-[1.65] text-text-secondary">
                  {[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )) : (
            <div className="rounded-[18px] border border-dashed border-black/8 bg-white/45 px-4 py-4 text-[18px] leading-[1.75] text-text-secondary">
              这个词目前还没有反义词线索。
            </div>
          )}
        </div>
      </div>
    </div>
  </section>
);

const Round1ConfusingCard = ({
  word,
  activeExampleKey,
  canPlayExampleAudio,
  exampleLocale,
  onPlayExample,
}: {
  word: Word;
  activeExampleKey: string | null;
  canPlayExampleAudio: boolean;
  exampleLocale: PronunciationLocale;
  onPlayExample: (sentence: string, key: string) => void;
}) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <p className="text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">易混词义对比</p>
    <div className="mt-4 space-y-5">
      {word.confusingPairs.length > 0 ? (
        <div className="space-y-3">
          {word.confusingPairs.map((pair, index) => (
            <div
              key={`${word.id}-confusion-${pair.word}-${index}`}
              className="rounded-[18px] border border-white/85 bg-white/75 px-4 py-3"
            >
              <p className="text-[24px] font-black tracking-tight text-text-primary">{pair.word}</p>
              {pair.difference && (
                <p className="mt-2 text-[18px] leading-[1.75] text-text-secondary">
                  {pair.difference}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[18px] leading-[1.75] text-text-secondary">
          这个词目前没有需要特别提醒的易混点。
        </p>
      )}

      <div className="border-t border-black/6 pt-5">
        <p className="text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">例句</p>
        <div className="mt-3">
          <ExampleSentenceList
            items={word.example_sentences.map((sentence, index) => ({
              key: `${word.id}-example-${index}`,
              sentence,
            }))}
            locale={exampleLocale}
            activeExampleKey={activeExampleKey}
            canPlayAudio={canPlayExampleAudio}
            onPlayExample={({ sentence, key }) => { onPlayExample(sentence, key); }}
            emptyMessage="这个词目前还没有例句。"
          />
        </div>
      </div>
    </div>
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
  <div className="input-session-shell mx-auto flex w-full max-w-[1400px] flex-col gap-4">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <RoundIndicator type={type} className="min-w-0 flex-1" />
      <SessionProgress currentIndex={currentIndex} queueLength={queueLength} />
    </header>

    <div className="input-session-shell__body min-w-0">
      {main}
    </div>
  </div>
);

// --- Helpers ---

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

type PlaybackTarget =
  | { kind: 'pronunciation'; locale: PronunciationLocale }
  | { kind: 'example'; key: string };

// --- Main LearningEngine ---

export const LearningEngine = ({
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
  const [lastWrongInput, setLastWrongInput] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptStartedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRunIdRef = useRef(0);
  const canPlayExampleAudio = useMemo(() => isBrowserSpeechSupported(), []);

  const queueRef = useRef<Word[]>(initialEngineState.queue);
  const currentIndexRef = useRef(initialEngineState.currentIndex);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const currentWord = queue[currentIndex];
  const clozePrompt = useMemo(() => {
    if ((type !== 'round2' && type !== 'review') || !currentWord) return null;
    return buildClozePrompt({ word: currentWord.word, senses: currentWord.senses });
  }, [currentWord, type]);
  const expectedInput = clozePrompt
    ? clozePrompt.expectedForm
    : currentWord?.word.toLowerCase() ?? '';
  const roundSource = type === 'review' ? 'review' : type === 'round2' ? 'round2' : null;
  const activePronunciationLocale = playbackTarget?.kind === 'pronunciation'
    ? playbackTarget.locale
    : null;
  const activeExampleKey = playbackTarget?.kind === 'example'
    ? playbackTarget.key
    : null;

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

    cancelBrowserSpeech();
    setPlaybackTarget(null);
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

  const speakViaBrowser = useCallback((
    text: string,
    locale: PronunciationLocale,
    runId: number,
    target: PlaybackTarget,
  ) => {
    if (!canPlayExampleAudio || runId !== playbackRunIdRef.current) {
      return Promise.resolve(false);
    }

    setPlaybackTarget(target);

    return speakTextViaBrowser(text, locale).finally(() => {
      if (runId === playbackRunIdRef.current) {
        setPlaybackTarget(null);
      }
    });
  }, [canPlayExampleAudio]);

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
    const pronunciationTarget: PlaybackTarget = { kind: 'pronunciation', locale };
    if (runId !== playbackRunIdRef.current) return;

    if (!resolvedUrl) {
      await speakViaBrowser(word.word, locale, runId, pronunciationTarget);
      return;
    }

    setPlaybackTarget(pronunciationTarget);

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
          setPlaybackTarget(null);
        }
        resolve();
      };

      const fallbackToSpeech = () => {
        if (settled) return;
        settled = true;
        if (audioRef.current === audio) {
          audioRef.current = null;
        }
        void speakViaBrowser(word.word, locale, runId, pronunciationTarget).then(() => resolve());
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

  const playExampleSentence = useCallback(async (sentence: string, key: string) => {
    if (!canPlayExampleAudio) return;

    if (playbackTarget?.kind === 'example' && playbackTarget.key === key) {
      stopPlayback();
      return;
    }

    stopPlayback();
    const runId = playbackRunIdRef.current;
    await speakViaBrowser(sentence, audioLocale, runId, { kind: 'example', key });
  }, [audioLocale, canPlayExampleAudio, playbackTarget, speakViaBrowser, stopPlayback]);

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
      setLastWrongInput(null);
      setShowAnswer(false);
    } else {
      // 学习一轮结束，强制触发一次同步
      void attemptBuffer.flush();
      void onComplete();
    }
  }, [clearAnswerRevealTimeout, onComplete, stopPlayback]);

  // 组件卸载或页面关闭时，尝试清空缓冲区
  useEffect(() => {
    const handleUnmount = () => {
      void attemptBuffer.flush();
    };

    window.addEventListener('beforeunload', handleUnmount);
    return () => {
      window.removeEventListener('beforeunload', handleUnmount);
      handleUnmount();
    };
  }, []);

  const persistAttempt = useCallback(async (wasCorrect: boolean) => {
    if (!roundSource) return true;

    try {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = Math.max(0, Math.round(now - promptStartedAtRef.current));
      
      // 使用缓冲模块，不再直接调用后端 API
      void attemptBuffer.pushAttempt({
        vocabularyItemId: currentWord.id,
        learningGroupId: initialSession?.groupId,
        source: roundSource as ReviewAttemptSource,
        wasCorrect,
        elapsedMs,
      });
      
      return true;
    } catch (error) {
      console.error('Failed to buffer attempt:', error);
      return false;
    }
  }, [currentWord.id, initialSession?.groupId, roundSource]);

  const handleRound3PrimaryAction = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
      return;
    }

    nextWord();
  }, [showAnswer, nextWord]);

  const validateCurrentInput = useCallback(async () => {
    const trimmedInput = inputValue.trim().toLowerCase();
    const wasCorrect = trimmedInput === expectedInput;
    
    // 后台静默保存，不再阻塞 UI 切换
    void persistAttempt(wasCorrect);

    if (wasCorrect) {
      nextWord();
      return;
    }

    setIsWrong(true);
    setLastWrongInput(inputValue);

    if (type === 'round2' || type === 'review') {
      const newQueue = [...queue];
      const insertAt = Math.min(currentIndex + Math.floor(Math.random() * 3) + 2, newQueue.length);
      newQueue.splice(insertAt, 0, currentWord);
      setQueue(newQueue);
      
      setInputValue('');
      setShowAnswer(true);
      clearAnswerRevealTimeout();
      answerRevealTimeoutRef.current = setTimeout(() => {
        answerRevealTimeoutRef.current = null;
        setShowAnswer(false);
        setIsWrong(false);
        setLastWrongInput(null);
        nextWord();
      }, preferences.wrongAnswerRevealMs);
    }
  }, [clearAnswerRevealTimeout, currentIndex, currentWord, expectedInput, inputValue, nextWord, persistAttempt, preferences.wrongAnswerRevealMs, queue, type]);

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
        <p className="text-xl font-black">这一轮现在没有可学的词。</p>
      </div>
    );
  }

  const isCorrect = inputValue.trim().toLowerCase() === expectedInput;
  const primaryPos = currentWord.pos_tags[0] ?? '未标注';
  const actionDisabled = isSubmittingAttempt || ((type === 'round2' || type === 'review') && showAnswer);
  const actionLabel = (type === 'round2' || type === 'review') && showAnswer
    ? '答案展示中…'
    : type === 'round1'
      ? '确认这一词'
      : '提交这次判断';

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
          placeholder={type === 'round1' ? '把这个词拼出来' : clozePrompt ? '填入正确词形' : '写出英文词形'}
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
          className={cx(
            'mx-auto mt-6 w-fit max-w-full rounded-[22px] px-5 py-4 text-left font-bold text-white shadow-xl',
            isWrong ? 'bg-apple-red shadow-apple-red/20' : 'bg-[#10B981] shadow-[#10B981]/20',
          )}
        >
          <div className="flex items-start gap-4">
            <div className="mt-1 flex-shrink-0">
              {isWrong ? <XCircle className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest opacity-70">
                  {isWrong ? '这次没对上 · 正确答案如下' : '这次对上了'}
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <p className="text-lg font-black leading-none md:text-xl">
                    {clozePrompt ? clozePrompt.expectedForm : currentWord.word}
                  </p>
                  {clozePrompt && clozePrompt.expectedForm !== clozePrompt.baseForm && (
                    <p className="text-xs font-medium opacity-70">原型 · {clozePrompt.baseForm}</p>
                  )}
                  {isWrong && lastWrongInput && (
                    <p className="text-sm font-medium line-through opacity-60">
                      你刚才写的是：{lastWrongInput}
                    </p>
                  )}
                </div>
              </div>
              <div className="[&_p]:text-white [&_span]:bg-white/16 [&_span]:text-white/90">
                <WordSenseList word={currentWord} compact />
              </div>
            </div>
          </div>
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
          正在写回这次判断…
        </>
      ) : (
        <>
          {actionLabel}
          <ChevronRight className="h-5 w-5" />
        </>
      )}
    </button>
  );

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
                {activePronunciationLocale === loc
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
                <div className="[&_span]:bg-black/5">
                  <WordSenseList word={currentWord} centered />
                </div>
                {currentWord.example_sentences[0] && (
                  <div className="mx-auto mt-4 w-full max-w-xl">
                    <ExampleSentenceList
                      items={[{
                        key: `${currentWord.id}-round3-example-0`,
                        sentence: currentWord.example_sentences[0],
                      }]}
                      locale={audioLocale}
                      activeExampleKey={activeExampleKey}
                      canPlayAudio={canPlayExampleAudio}
                      onPlayExample={({ sentence, key }) => { void playExampleSentence(sentence, key); }}
                      emptyMessage="这个词目前还没有例句。"
                      variant="inline"
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!showAnswer && (
            <p className="text-text-secondary/40 text-sm mt-8">先自己判断，再决定要不要展开答案。</p>
          )}
        </motion.div>

        {renderProgressBar(currentIndex, queue.length)}

        <div className="w-full max-w-3xl px-4 pb-8">
          <button
            type="button"
            onClick={handleRound3PrimaryAction}
            className="w-full py-4 bg-apple-blue text-white font-bold rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] transition-all"
          >
            {showAnswer ? '继续下一个词' : '展开释义'}
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

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
                  activePronunciationLocale={activePronunciationLocale}
                  onPlay={(locale) => {
                    setAudioLocale(locale);
                    void playAudioSequence(currentWord, locale, 1, 0);
                  }}
                />

                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
                  <p className="text-[clamp(2.4rem,4.1vw,4.2rem)] font-black leading-[0.94] tracking-[-0.055em] text-text-primary lg:flex-shrink-0">
                    {currentWord.word}
                  </p>
                  <div className="min-w-0 lg:max-w-[960px] lg:flex-1 lg:pt-1">
                    <WordSenseList word={currentWord} />
                  </div>
                </div>
              </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Round1MorphologyCard word={currentWord} />
                  <Round1RelationsCard word={currentWord} />
                  <Round1ConfusingCard
                    word={currentWord}
                    activeExampleKey={activeExampleKey}
                    canPlayExampleAudio={canPlayExampleAudio}
                    exampleLocale={audioLocale}
                    onPlayExample={(sentence, key) => { void playExampleSentence(sentence, key); }}
                  />
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
              {clozePrompt ? (
                <Round2ClozePrompt prompt={clozePrompt} />
              ) : (
                <div className="mx-auto max-w-3xl">
                  <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                    {type === 'review' ? '先写出这个到期词' : '先把这个词从记忆里提出来'}
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
              )}

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
