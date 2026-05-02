import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Volume2, XCircle } from 'lucide-react';
import { 
  LearningRoundType, 
  PersistedLearningSession, 
  PronunciationLocale, 
  ReviewAttemptSource, 
  RoundType, 
  Word 
} from '../../types';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { useWordPopover } from '../../contexts/WordPopoverContext';
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
import { ClickableText, type WordClickHandler } from '../shared/ClickableText';
import { buildClozePrompt } from '../../lib/cloze';
import { Round2ClozePrompt } from './Round2ClozePrompt';
import { attemptBuffer } from '../../lib/attemptBuffer';

// --- Sub-components for Round 1 ---

type Round1LookupProps = {
  targetWords?: ReadonlySet<string>;
  onWordClick?: WordClickHandler;
};

const Round1LookupText = ({
  text,
  targetWords,
  onWordClick,
}: {
  text: string;
} & Round1LookupProps) => (
  onWordClick ? (
    <ClickableText
      text={text}
      targetWords={targetWords}
      onWordClick={onWordClick}
      stopPropagation
    />
  ) : (
    <>{text}</>
  )
);

const Round1MorphologyCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">构词拆解 / 派生词</p>
    {word.morphology.summaryZh ? (
      <p className="mt-3 text-[15px] sm:text-base leading-7 text-text-primary">
        <Round1LookupText text={word.morphology.summaryZh} targetWords={targetWords} onWordClick={onWordClick} />
      </p>
    ) : (
      <p className="mt-3 text-sm leading-6 text-text-secondary">无展示的构词拆解。</p>
    )}

    <div className="mt-4">
      <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">派生词</p>
      <div className="mt-2 sm:mt-3 space-y-2">
        {word.derivedWords.length > 0 ? word.derivedWords.map((item) => (
          <div
            key={`${word.id}-derived-${item.word}`}
            className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
          >
            <p className="text-base sm:text-[18px] font-black text-text-primary">
              <Round1LookupText text={item.word} targetWords={targetWords} onWordClick={onWordClick} />
            </p>
            {(item.meaningZh || item.noteZh) && (
              <p className="mt-1.5 text-sm sm:text-[16px] leading-relaxed text-text-secondary">
                <Round1LookupText
                  text={[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                  targetWords={targetWords}
                  onWordClick={onWordClick}
                />
              </p>
            )}
          </div>
        )) : (
          <div className="rounded-[16px] border border-dashed border-black/8 bg-white/45 px-3 py-3 text-sm sm:text-[18px] text-text-secondary">
            无派生词线索。
          </div>
        )}
      </div>
    </div>
  </section>
);

const Round1RelationsCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">近义词</p>
        <div className="mt-2 sm:mt-3 space-y-2">
          {word.synonyms.length > 0 ? word.synonyms.slice(0, 2).map((item) => (
            <div
              key={`${word.id}-synonym-${item.word}`}
              className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
            >
              <p className="text-base sm:text-[18px] font-black text-text-primary">
                <Round1LookupText text={item.word} targetWords={targetWords} onWordClick={onWordClick} />
              </p>
              {(item.meaningZh || item.noteZh) && (
                <p className="mt-1.5 text-sm sm:text-[16px] leading-relaxed text-text-secondary">
                  <Round1LookupText
                    text={[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                    targetWords={targetWords}
                    onWordClick={onWordClick}
                  />
                </p>
              )}
            </div>
          )) : (
            <div className="rounded-[16px] border border-dashed border-black/8 bg-white/45 px-3 py-3 text-sm sm:text-[18px] text-text-secondary">
              无近义词。
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">反义词</p>
        <div className="mt-2 sm:mt-3 space-y-2">
          {word.antonyms.length > 0 ? word.antonyms.slice(0, 2).map((item) => (
            <div
              key={`${word.id}-antonym-${item.word}`}
              className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
            >
              <p className="text-base sm:text-[18px] font-black text-text-primary">
                <Round1LookupText text={item.word} targetWords={targetWords} onWordClick={onWordClick} />
              </p>
              {(item.meaningZh || item.noteZh) && (
                <p className="mt-1.5 text-sm sm:text-[16px] leading-relaxed text-text-secondary">
                  <Round1LookupText
                    text={[item.meaningZh, item.noteZh].filter(Boolean).join(' · ')}
                    targetWords={targetWords}
                    onWordClick={onWordClick}
                  />
                </p>
              )}
            </div>
          )) : (
            <div className="rounded-[16px] border border-dashed border-black/8 bg-white/45 px-3 py-3 text-sm sm:text-[18px] text-text-secondary">
              无反义词。
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
  targetWords,
  onWordClick,
}: {
  word: Word;
  activeExampleKey: string | null;
  canPlayExampleAudio: boolean;
  exampleLocale: PronunciationLocale;
  onPlayExample: (sentence: string, key: string) => void;
} & Round1LookupProps) => (
  <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
    <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">易混词义对比</p>
    <div className="mt-3 sm:mt-4 space-y-4 sm:space-y-5">
      {word.confusingPairs.length > 0 ? (
        <div className="space-y-2">
          {word.confusingPairs.map((pair, index) => (
            <div
              key={`${word.id}-confusion-${pair.word}-${index}`}
              className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
            >
              <p className="text-lg sm:text-[24px] font-black tracking-tight text-text-primary">
                <Round1LookupText text={pair.word} targetWords={targetWords} onWordClick={onWordClick} />
              </p>
              {pair.difference && (
                <p className="mt-1.5 text-sm sm:text-[18px] leading-relaxed text-text-secondary">
                  <Round1LookupText text={pair.difference} targetWords={targetWords} onWordClick={onWordClick} />
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm sm:text-[18px] text-text-secondary">
          没有需要提醒的易混点。
        </p>
      )}

      <div className="border-t border-black/6 pt-4 sm:pt-5">
        <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">例句</p>
        <div className="mt-2">
          <ExampleSentenceList
            items={word.senses
              .filter((sense) => (sense.example_sentence ?? '').trim())
              .slice(0, 2)
              .map((sense, index) => ({
                key: `${word.id}-example-${index}`,
                sentence: sense.example_sentence,
                translation: sense.example_translation_zh || undefined,
              }))}
            locale={exampleLocale}
            activeExampleKey={activeExampleKey}
            canPlayAudio={canPlayExampleAudio}
            onPlayExample={({ sentence, key }) => { onPlayExample(sentence, key); }}
            emptyMessage="无例句。"
            targetWords={targetWords}
            onWordClick={onWordClick}
          />
        </div>
      </div>
    </div>
  </section>
);

const Round1MemoryTipCard = ({ memoryTip, targetWords, onWordClick }: { memoryTip: string } & Round1LookupProps) => (
  <aside className="flex h-full min-h-[112px] rounded-[18px] border border-apple-blue/15 bg-apple-blue/5 px-4 py-3 sm:px-5 sm:py-4 lg:min-h-0 lg:max-h-[152px] lg:w-full lg:max-w-[430px] lg:self-stretch lg:overflow-y-auto">
    <div className="my-auto min-w-0">
      <p className="text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.22em] text-apple-blue">
        记忆锦囊
      </p>
      <p className="mt-1.5 text-[13px] sm:text-sm leading-6 text-text-primary">
        <Round1LookupText text={memoryTip} targetWords={targetWords} onWordClick={onWordClick} />
      </p>
    </div>
  </aside>
);

const InputSessionShell = ({
  type,
  currentIndex,
  queueLength,
  sessionActions,
  main,
}: {
  type: RoundType;
  currentIndex: number;
  queueLength: number;
  sessionActions?: React.ReactNode;
  main: React.ReactNode;
}) => (
  <div className="input-session-shell mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-3 sm:gap-4">
    <header className="flex shrink-0 items-center justify-between gap-2">
      <RoundIndicator type={type} className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center justify-end gap-2">
        {sessionActions}
        <SessionProgress currentIndex={currentIndex} queueLength={queueLength} />
      </div>
    </header>

    <div className="input-session-shell__body min-w-0 flex-1 min-h-0">
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

const stripDiacritics = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable
  );
}

export const LearningEngine = ({
  type,
  words,
  initialSession,
  onComplete,
  onAttempt,
  onSessionChange,
  sessionActions,
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
    passedQueueIndices: number[];
  }) => void;
  sessionActions?: React.ReactNode;
}) => {
  const { preferences } = useLearningPreferences();
  const { openPopover } = useWordPopover();
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
    const initialPassedQueueIndices = hasMatchingSession
      ? Array.from(new Set(initialSession.passedQueueIndices ?? []))
          .filter((index) => Number.isInteger(index) && index >= 0 && index < currentIndex && index < queue.length)
          .sort((left, right) => left - right)
      : [];

    // Words before currentIndex that are NOT re-queued later are truly completed.
    // Wrong answers get re-inserted after currentIndex, so prefix ∩ suffix = still pending.
    const pendingIds = new Set(queue.slice(currentIndex).map((word) => word.id));
    const initialCompletedIds = new Set<string>();
    for (const word of queue.slice(0, currentIndex)) {
      if (!pendingIds.has(word.id)) initialCompletedIds.add(word.id);
    }

    return { queue, currentIndex, initialCompletedIds, initialPassedQueueIndices };
  }, [initialSession, type, words]);

  const [queue, setQueue] = useState<Word[]>(initialEngineState.queue);
  const [currentIndex, setCurrentIndex] = useState(initialEngineState.currentIndex);
  const [viewIndex, setViewIndex] = useState(initialEngineState.currentIndex);
  const [inputValue, setInputValue] = useState('');
  const [isWrong, setIsWrong] = useState(false);
  const [lastWrongInput, setLastWrongInput] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isSubmittingAttempt, setIsSubmittingAttempt] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [completedWordIds, setCompletedWordIds] = useState<Set<string>>(
    () => new Set(initialEngineState.initialCompletedIds),
  );
  const [passedQueueIndices, setPassedQueueIndices] = useState<Set<number>>(
    () => new Set(initialEngineState.initialPassedQueueIndices),
  );

  // 计算进度：分母固定为初始单词数，分子为已正确完成的单词数 + 1（代表当前正在进行的第几个）
  const initialUniqueCount = words.length;
  const completedCount = completedWordIds.size;
  const displayNumerator = Math.min(completedCount + 1, initialUniqueCount);
  const displayProgressIndex = type === 'round3'
    ? Math.min(currentIndex, Math.max(initialUniqueCount - 1, 0))
    : displayNumerator - 1;
  const passedQueueIndicesArray = useMemo(
    () => [...passedQueueIndices].sort((left, right) => left - right),
    [passedQueueIndices],
  );

  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const promptStartedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctReadbackTokenRef = useRef<symbol | null>(null);
  const audioGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRunIdRef = useRef(0);
  const preferencesRef = useRef(preferences);
  const canPlayExampleAudio = useMemo(() => typeof Audio !== 'undefined' || isBrowserSpeechSupported(), []);

  const queueRef = useRef<Word[]>(initialEngineState.queue);
  const currentIndexRef = useRef(initialEngineState.currentIndex);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);

  const currentWord = queue[currentIndex];
  const viewedWord = queue[viewIndex] ?? currentWord;
  const isViewingHistory = viewIndex !== currentIndex;
  const lookupTargetWords = useMemo(
    () => new Set(words.map((word) => word.word.trim().toLowerCase()).filter(Boolean)),
    [words],
  );
  const clozePrompt = useMemo(() => {
    if ((type !== 'round2' && type !== 'review') || !currentWord) return null;
    return buildClozePrompt({ word: currentWord.word, senses: currentWord.senses });
  }, [currentWord, type]);
  const viewedClozePrompt = useMemo(() => {
    if ((type !== 'round2' && type !== 'review') || !viewedWord) return null;
    return buildClozePrompt({ word: viewedWord.word, senses: viewedWord.senses });
  }, [viewedWord, type]);
  const expectedInput = clozePrompt
    ? clozePrompt.expectedForm
    : currentWord?.word.toLowerCase() ?? '';
  const viewedExpectedInput = viewedClozePrompt
    ? viewedClozePrompt.expectedForm
    : viewedWord?.word.toLowerCase() ?? '';
  const displayedInputValue = isViewingHistory ? viewedExpectedInput : inputValue;
  const roundSource = type === 'review' ? 'review' : type === 'round2' ? 'round2' : null;
  const activePronunciationLocale = playbackTarget?.kind === 'pronunciation'
    ? playbackTarget.locale
    : null;
  const activeExampleKey = playbackTarget?.kind === 'example'
    ? playbackTarget.key
    : null;

  const clearAnswerRevealTimeout = useCallback(() => {
    correctReadbackTokenRef.current = null;
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
    setViewIndex(initialEngineState.currentIndex);
    setInputValue('');
    setIsWrong(false);
    setShowAnswer(false);
    setIsSubmittingAttempt(false);
    setSubmitError('');
    setCompletedWordIds(new Set(initialEngineState.initialCompletedIds));
    setPassedQueueIndices(new Set(initialEngineState.initialPassedQueueIndices));
    queueRef.current = initialEngineState.queue;
    currentIndexRef.current = initialEngineState.currentIndex;
  }, [clearAnswerRevealTimeout, initialEngineState, stopPlayback, type, words]);

  useEffect(() => () => {
    clearAnswerRevealTimeout();
    stopPlayback();
  }, [clearAnswerRevealTimeout, stopPlayback]);

  useEffect(() => {
    if (viewIndex === currentIndex) {
      inputRef.current?.focus();
    }
  }, [currentIndex, viewIndex]);

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

  const resolveExampleAudioUrl = useCallback(async (sentence: string, locale: PronunciationLocale) => (
    apiFetch('/api/example-audio', {
      method: 'POST',
      requiresAuth: false,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence, locale }),
    })
      .then((response) => (
        response.ok
          ? response.json().then((payload: { data?: unknown }) => (
            typeof payload.data === 'string' ? payload.data : null
          ))
          : null
      ))
      .catch(() => null)
  ), []);

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
    const exampleTarget: PlaybackTarget = { kind: 'example', key };
    setPlaybackTarget(exampleTarget);

    const resolvedUrl = await resolveExampleAudioUrl(sentence, audioLocale);
    if (runId !== playbackRunIdRef.current) return;

    if (!resolvedUrl || typeof Audio === 'undefined') {
      await speakViaBrowser(sentence, audioLocale, runId, exampleTarget);
      return;
    }

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
        void speakViaBrowser(sentence, audioLocale, runId, exampleTarget).then(() => resolve());
      };

      audioRef.current = audio;
      audio.onended = finish;
      audio.onerror = fallbackToSpeech;
      audio.play().catch(fallbackToSpeech);
    });
  }, [
    audioLocale,
    canPlayExampleAudio,
    playbackTarget,
    resolveExampleAudioUrl,
    speakViaBrowser,
    stopPlayback,
  ]);

  useEffect(() => {
    if (!currentWord) return;

    const currentPreferences = preferencesRef.current;
    const locale = currentPreferences.defaultPronunciationLocale;
    setAudioLocale(locale);
    stopPlayback();

    if (!currentPreferences.autoPlayEnabled) {
      return;
    }

    void playAudioSequence(
      currentWord,
      locale,
      currentPreferences.autoPlayRepeatCount,
      currentPreferences.autoPlayRepeatGapMs,
    );
  }, [
    currentWord,
    playAudioSequence,
    stopPlayback,
  ]);

  useEffect(() => {
    if (!roundSource) return;
    promptStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setSubmitError('');
  }, [currentIndex, roundSource]);

  useEffect(() => {
    if (type === 'round3') return;
    const canViewIndex = viewIndex === currentIndex || passedQueueIndices.has(viewIndex);
    if (!canViewIndex || viewIndex >= queue.length) {
      setViewIndex(currentIndex);
    }
  }, [currentIndex, passedQueueIndices, queue.length, type, viewIndex]);

  useEffect(() => {
    if (!onSessionChange || type === 'review') return;
    onSessionChange({
      round: type,
      currentIndex,
      queueWordIds: queue.map((word) => word.id),
      passedQueueIndices: passedQueueIndicesArray,
    });
  }, [currentIndex, onSessionChange, passedQueueIndicesArray, queue, type]);

  const markCurrentQueueIndexPassed = useCallback(() => {
    const passedIndex = currentIndexRef.current;
    setPassedQueueIndices((prev) => {
      if (prev.has(passedIndex)) return prev;
      const next = new Set(prev);
      next.add(passedIndex);
      return next;
    });
  }, []);

  const nextWord = useCallback(() => {
    clearAnswerRevealTimeout();
    stopPlayback();
    if (currentIndexRef.current < queueRef.current.length - 1) {
      const nextIndex = currentIndexRef.current + 1;
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      setViewIndex(nextIndex);
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

  const navigableQueueIndices = useMemo(() => {
    if (type === 'round3' || !currentWord) return [];

    const indices = new Set<number>();
    for (const index of passedQueueIndicesArray) {
      if (index >= 0 && index < currentIndex && queue[index]) {
        indices.add(index);
      }
    }
    indices.add(currentIndex);

    return [...indices].sort((left, right) => left - right);
  }, [currentIndex, currentWord, passedQueueIndicesArray, queue, type]);
  const currentNavigationSlot = navigableQueueIndices.indexOf(viewIndex);
  const isCardNavigationLocked = showAnswer || isSubmittingAttempt || type === 'round3';
  const canNavigateLeft = !isCardNavigationLocked && currentNavigationSlot > 0;
  const canNavigateRight = !isCardNavigationLocked
    && currentNavigationSlot >= 0
    && currentNavigationSlot < navigableQueueIndices.length - 1;

  const navigateCard = useCallback((direction: 'previous' | 'next') => {
    if (isCardNavigationLocked) return;

    const slot = navigableQueueIndices.indexOf(viewIndex);
    const nextSlot = direction === 'previous' ? slot - 1 : slot + 1;
    const nextViewIndex = navigableQueueIndices[nextSlot];
    if (typeof nextViewIndex !== 'number') return;

    stopPlayback();
    setSubmitError('');
    setViewIndex(nextViewIndex);
  }, [isCardNavigationLocked, navigableQueueIndices, stopPlayback, viewIndex]);

  // 页面隐藏 / 关闭时走 keepalive 通道确保送达；
  // 组件正常卸载（SPA 内路由切换）时走普通 async flush。
  useEffect(() => {
    const handleHidden = () => {
      if (document.visibilityState === 'hidden') {
        attemptBuffer.flushKeepalive();
      }
    };
    const handlePageHide = () => {
      attemptBuffer.flushKeepalive();
    };

    document.addEventListener('visibilitychange', handleHidden);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleHidden);
      window.removeEventListener('pagehide', handlePageHide);
      void attemptBuffer.flush();
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
    // 防止重复提交
    if (showAnswer || isSubmittingAttempt || isViewingHistory) return;

    const trimmedInput = inputValue.trim().toLowerCase();
    const wasCorrect = stripDiacritics(trimmedInput) === stripDiacritics(expectedInput);
    
    // 后台静默保存，不再阻塞 UI 切换
    void persistAttempt(wasCorrect);

    if (wasCorrect) {
      setCompletedWordIds(prev => {
        const next = new Set(prev);
        next.add(currentWord.id);
        return next;
      });

      if (type === 'round2' || type === 'review' || type === 'round1') {
        setShowAnswer(true);
        setIsWrong(false);
        clearAnswerRevealTimeout();

        const advance = () => {
          answerRevealTimeoutRef.current = null;
          setShowAnswer(false);
          markCurrentQueueIndexPassed();
          nextWord();
        };

        if ((type === 'round2' || type === 'review') && clozePrompt) {
          const fullSentence = (currentWord.senses[clozePrompt.senseIndex]?.example_sentence ?? '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .trim();
          if (fullSentence) {
            const token = Symbol('correct-readback');
            correctReadbackTokenRef.current = token;
            const playKey = `${currentWord.id}-correct-readback`;
            void playExampleSentence(fullSentence, playKey).then(() => {
              if (correctReadbackTokenRef.current !== token) return;
              correctReadbackTokenRef.current = null;
              advance();
            });
            return;
          }
        }

        const correctAnswerRevealMs = type === 'round1' ? 800 : preferences.correctAnswerRevealMs;
        answerRevealTimeoutRef.current = setTimeout(advance, correctAnswerRevealMs);
        return;
      }

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
  }, [showAnswer, isSubmittingAttempt, isViewingHistory, inputValue, expectedInput, persistAttempt, currentWord, type, nextWord, clearAnswerRevealTimeout, queue, currentIndex, preferences.correctAnswerRevealMs, preferences.wrongAnswerRevealMs, clozePrompt, playExampleSentence, markCurrentQueueIndexPassed]);

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

  useEffect(() => {
    if (type === 'round3' || type === 'article') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      if (type === 'round1' && isTextEditingTarget(event.target)) return;

      if (event.key === 'ArrowLeft' && canNavigateLeft) {
        event.preventDefault();
        navigateCard('previous');
        return;
      }

      if (event.key === 'ArrowRight' && canNavigateRight) {
        event.preventDefault();
        navigateCard('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canNavigateLeft, canNavigateRight, navigateCard, type]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (type === 'round2' || type === 'review') {
      const filtered = val.toLowerCase().replace(/[^\p{L}' -]/gu, '').slice(0, expectedInput.length);
      setInputValue(filtered);
    } else {
      setInputValue(val);
    }
    setIsWrong(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === 'round3') {
      handleRound3PrimaryAction();
      return;
    }
    if (isViewingHistory) return;
    void validateCurrentInput();
  };

  if (!currentWord) {
    return (
      <div className="glass rounded-apple-lg p-16 text-center">
        <p className="text-xl font-black">这一轮现在没有可学的词。</p>
      </div>
    );
  }

  const isCorrect = stripDiacritics(inputValue.trim().toLowerCase()) === stripDiacritics(expectedInput);
  const primaryPos = viewedWord.pos_tags[0] ?? '未标注';
  const actionDisabled = isViewingHistory || isSubmittingAttempt || ((type === 'round2' || type === 'review') && showAnswer);
  const actionLabel = (type === 'round2' || type === 'review') && showAnswer
    ? (isWrong ? '答案展示中…' : '判断正确！')
    : type === 'round1'
      ? '确认这一词'
      : '提交这次判断';
  const allowLiveCorrectTint = type === 'round1';
  const contentAreaClassName = 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7';
  const inputDockClassName = 'shrink-0 border-t border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(247,249,253,0.92))] px-4 py-4 shadow-[0_-18px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:px-7 sm:py-5 lg:px-8';
  const round1InputDockClassName = 'shrink-0 border-t border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(247,249,253,0.94))] px-4 pt-2 pb-3 shadow-[0_-18px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:px-7 sm:pt-3 sm:pb-4 lg:px-8';

  const inputField = (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={cx(
          'rounded-[22px] border border-white/80 bg-white/60 px-4 shadow-[0_12px_32px_rgba(14,26,56,0.06)] backdrop-blur-xl sm:px-5',
          type === 'round1' ? 'py-2 sm:py-3' : 'py-3.5 sm:py-5',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInput}
          disabled={isSubmittingAttempt || isViewingHistory}
          className={cx(
            'w-full bg-transparent text-center font-black outline-none transition-colors caret-gray-800 placeholder:text-text-secondary/35',
            type === 'round1' ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl',
            isWrong ? 'text-apple-red' : allowLiveCorrectTint && isCorrect ? 'text-[#10B981]' : 'text-text-primary',
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
            'mx-auto w-fit max-w-full rounded-[22px] px-5 py-4 text-left font-bold text-white shadow-xl',
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

  const replayControls = (type === 'round2' || type === 'review') ? (
    <div className="mx-auto mb-8 flex flex-wrap items-center justify-center gap-2.5">
      {(['uk', 'us'] as const).map((loc) => (
        <button
          key={`${type}-replay-${loc}`}
          type="button"
          onClick={() => {
            setAudioLocale(loc);
            void playAudioSequence(viewedWord, loc, 1, 0);
          }}
          className={cx(
            'flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black tracking-[0.14em] transition-all',
            audioLocale === loc
              ? 'bg-apple-blue text-white shadow-[0_12px_24px_rgba(0,122,255,0.18)]'
              : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15',
          )}
        >
          {activePronunciationLocale === loc
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Volume2 className="h-3.5 w-3.5" />}
          再听 {loc.toUpperCase()}
        </button>
      ))}
    </div>
  ) : null;

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

  const navigationButtonClassName = 'flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/80 bg-white/78 text-text-primary shadow-[0_14px_34px_rgba(14,26,56,0.08)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:bg-white/78';
  const leftNavigationButton = (
    <button
      type="button"
      aria-label="切到上一张词卡"
      title="上一张词卡"
      onClick={() => navigateCard('previous')}
      disabled={!canNavigateLeft}
      className={navigationButtonClassName}
    >
      <ChevronLeft className="h-5 w-5" strokeWidth={2.8} />
    </button>
  );
  const rightNavigationButton = (
    <button
      type="button"
      aria-label="切到下一张词卡"
      title="下一张词卡"
      onClick={() => navigateCard('next')}
      disabled={!canNavigateRight}
      className={navigationButtonClassName}
    >
      <ChevronRight className="h-5 w-5" strokeWidth={2.8} />
    </button>
  );

  if (type === 'round3') {
    return (
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center">
        <div className="flex w-full max-w-3xl items-center gap-2">
          <RoundIndicator type={type} className="min-w-0 flex-1" />
          {sessionActions}
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

        {renderProgressBar(displayProgressIndex, initialUniqueCount)}

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
      currentIndex={displayProgressIndex}
      queueLength={initialUniqueCount}
      sessionActions={sessionActions}
      main={(
        <div className="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] items-stretch gap-2 sm:gap-3">
          <div className="flex items-center">
            {leftNavigationButton}
          </div>
        <motion.div
          key={`${viewedWord.id}:${viewIndex}`}
          initial={{ opacity: 0, scale: 0.97, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] sm:rounded-[30px] shadow-[0_24px_64px_rgba(14,26,56,0.08)]"
        >
          {type === 'round1' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className={cx(contentAreaClassName, 'pb-4 sm:pb-5')}>
                <div className="space-y-5 sm:space-y-7">
                  <div className="space-y-4 sm:space-y-5">
                    <PronunciationControls
                      phonetic={viewedWord.phonetic}
                      audioLocale={audioLocale}
                      activePronunciationLocale={activePronunciationLocale}
                      size="small"
                      onPlay={(locale) => {
                        setAudioLocale(locale);
                        void playAudioSequence(viewedWord, locale, 1, 0);
                      }}
                    />

                    <div className={cx(
                      'grid gap-4 lg:items-stretch lg:gap-8',
                      viewedWord.memory_tip
                        ? 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,30vw)]'
                        : 'lg:grid-cols-1',
                    )}>
                      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:gap-8">
                        <div className="lg:flex-shrink-0">
                          <p className="text-[clamp(1.44rem,8vw,3.36rem)] font-black leading-tight tracking-tight text-text-primary">
                            <Round1LookupText
                              text={viewedWord.word}
                              targetWords={lookupTargetWords}
                              onWordClick={openPopover}
                            />
                          </p>
                          {viewedWord.ner_entities.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {viewedWord.ner_entities.map((entity, index) => (
                                <span
                                  key={`${viewedWord.id}-ner-${index}`}
                                  className="rounded-full bg-apple-indigo/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-apple-indigo"
                                >
                                  专有名词 · {entity.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 lg:max-w-[680px] lg:flex-1 lg:pt-1">
                          <WordSenseList word={viewedWord} size="small" />
                        </div>
                      </div>

                      {viewedWord.memory_tip && (
                        <div className="flex justify-end">
                          <Round1MemoryTipCard
                            memoryTip={viewedWord.memory_tip}
                            targetWords={lookupTargetWords}
                            onWordClick={openPopover}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
                    <Round1MorphologyCard
                      word={viewedWord}
                      targetWords={lookupTargetWords}
                      onWordClick={openPopover}
                    />
                    <Round1RelationsCard
                      word={viewedWord}
                      targetWords={lookupTargetWords}
                      onWordClick={openPopover}
                    />
                    <Round1ConfusingCard
                      word={viewedWord}
                      activeExampleKey={activeExampleKey}
                      canPlayExampleAudio={canPlayExampleAudio}
                      exampleLocale={audioLocale}
                      onPlayExample={(sentence, key) => { void playExampleSentence(sentence, key); }}
                      targetWords={lookupTargetWords}
                      onWordClick={openPopover}
                    />
                  </div>
                </div>
              </div>

              <div className={round1InputDockClassName}>
                <div className="mx-auto w-full max-w-[1200px]">
                  {isViewingHistory ? (
                    <div className="flex min-h-[50px] items-center justify-between gap-3 rounded-[22px] border border-[#10B981]/15 bg-[#10B981]/10 px-5 text-[#10B981] shadow-[0_12px_32px_rgba(16,185,129,0.08)]">
                      <div className="flex min-w-0 items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 shrink-0" />
                        <span className="truncate text-sm font-black sm:text-base">已通过</span>
                      </div>
                      <span className="truncate text-xl font-black sm:text-2xl">{viewedWord.word}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-row items-stretch gap-3">
                        <div className="flex-[3.2] min-w-0">
                          {inputField}
                        </div>
                        <div className="flex-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => { void validateCurrentInput(); }}
                            disabled={actionDisabled}
                            className="flex h-full min-h-[50px] w-full items-center justify-center rounded-[22px] bg-apple-blue text-white shadow-[0_14px_32px_rgba(0,122,255,0.25)] transition-all active:scale-[0.96] disabled:opacity-50"
                          >
                            <ChevronRight className="h-6 w-6" strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                      {submitErrorBanner && <div className="mt-2">{submitErrorBanner}</div>}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              className="relative flex h-full min-h-0 flex-col"
              onClick={() => {
                if (!isViewingHistory) {
                  inputRef.current?.focus();
                }
              }}
            >
              <div className={cx(contentAreaClassName, 'py-8')}>
                <div className="flex min-h-full flex-col justify-center text-center">
                  {replayControls}
                  {viewedClozePrompt ? (
                    <Round2ClozePrompt
                      prompt={viewedClozePrompt}
                      inputValue={displayedInputValue}
                      targetWords={lookupTargetWords}
                      onWordClick={openPopover}
                    />
                  ) : (
                    <div className="mx-auto max-w-3xl">
                      <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-text-secondary">
                        {type === 'review' ? '先写出这个到期词' : '先把这个词从记忆里提出来'}
                      </p>
                      <p className="mt-5 text-4xl font-black leading-tight text-text-primary md:text-5xl">
                        {viewedWord.chinese_definition}
                      </p>
                      <div className="mt-4 flex items-center justify-center gap-3">
                        <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
                          {primaryPos}
                        </span>
                      </div>
                      <div className="mt-7 inline-flex items-baseline gap-1.5 rounded-md bg-apple-blue/10 px-4 py-2 text-2xl text-apple-blue/80 md:text-3xl">
                        {Array.from({ length: viewedExpectedInput.length }, (_, i) => (
                          <span key={i} className="inline-block min-w-[0.9ch] text-center font-mono">
                            {displayedInputValue[i] ?? '_'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 space-y-3">
                    {isViewingHistory ? (
                      <div className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-[22px] bg-[#10B981] px-5 py-4 text-left font-bold text-white shadow-xl shadow-[#10B981]/20">
                        <CheckCircle2 className="h-5 w-5 shrink-0" />
                        <span>已通过</span>
                      </div>
                    ) : (
                      <>
                        {feedbackReveal}
                        {submitErrorBanner}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {!isViewingHistory && (
                <form onSubmit={handleSubmit}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInput}
                    disabled={isSubmittingAttempt || showAnswer}
                    maxLength={expectedInput.length}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="absolute left-1/2 top-1/2 h-px w-px -translate-x-1/2 -translate-y-1/2 opacity-0"
                    aria-label="拼写输入"
                  />
                </form>
              )}
            </div>
          )}
        </motion.div>
          <div className="flex items-center">
            {rightNavigationButton}
          </div>
        </div>
      )}
    />
  );
};
