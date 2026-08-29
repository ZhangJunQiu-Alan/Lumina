import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookMarked,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Loader2,
  MoreHorizontal,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import {
  getWordPhonetic,
  LearningRoundType,
  PersistedLearningSession,
  PronunciationLocale,
  ReviewAttemptSource,
  RoundType,
  Word,
} from '../../types';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { useSavedWords } from '../../contexts/SavedWordsContext';
import { useWordPopover } from '../../contexts/WordPopoverContext';
import { cancelBrowserSpeech, isBrowserSpeechSupported, speakTextViaBrowser } from '../../lib/browserSpeech';
import { fetchExampleAudioUrl } from '../../lib/exampleAudio';
import { preloadRound1CardResources } from '../../lib/round1Preload';
import { preloadRound2CardResources } from '../../lib/round2Preload';
import { fetchWordAudioUrl, primeWordAudioUrl } from '../../lib/wordAudio';
import { ExampleSentenceList } from '../shared/ExampleSentenceList';
import { cx, PronunciationControls, RoundIndicator, WordSenseList } from '../shared/LearningUI';
import { buildClozePrompt } from '../../lib/cloze';
import { Round2ClozePrompt } from './Round2ClozePrompt';
import { attemptBuffer } from '../../lib/attemptBuffer';
import { readLocal, writeLocal } from '../../lib/durableStorage';
import type { ReviewRecovery } from '../../lib/learningRecovery';
import { markReviewWordMastered, markReviewWordUnknown } from '../../lib/reviewApi';
import { reportVocabularyIssue, type VocabularyIssueType } from '../../lib/vocabReportApi';
import {
  ActionFeedback,
  getWrongAnswerRequeueIndex,
  hasRound1ContextContent,
  hasRound1MorphologyContent,
  hasRound1RelationsContent,
  isTextEditingTarget,
  PlaybackTarget,
  SessionActionKind,
  stripDiacritics,
  trimDisplayText,
  VOCABULARY_ISSUE_OPTIONS,
} from './learningEngineUtils';
import {
  AnswerFeedbackCard,
  InputSessionShell,
  renderProgressBar,
  Round1ConfusingCard,
  Round1LookupText,
  Round1MemoryTipCard,
  Round1MorphologyCard,
  Round1RelationsCard,
} from './Round1Cards';
import { limitRound1ReinforcementWordIds, ROUND1_REINFORCEMENT_WORD_LIMIT } from '../../../shared/learningProgress';

function areSetsEqual<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function areWordQueuesEqual(left: Word[], right: Word[]) {
  return left.length === right.length && left.every((word, index) => word.id === right[index]?.id);
}

function areNumberArraysEqual(left: readonly number[] = [], right: readonly number[] = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatClozeWordInfo(pos: string | undefined | null, meaning: string | undefined | null) {
  const trimmedPos = pos?.trim();
  const trimmedMeaning = meaning?.trim();

  if (trimmedPos && trimmedMeaning) {
    const displayPos = trimmedPos.endsWith('.') ? trimmedPos : `${trimmedPos}.`;
    return `${displayPos} ${trimmedMeaning}`;
  }

  return trimmedMeaning || trimmedPos || '';
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableShuffle<T>(items: T[], seed: string) {
  return items
    .map((item, index) => ({
      item,
      index,
      score: hashString(`${seed}:${index}`),
    }))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }) => item);
}

function getRound2ChoiceDistractors(word: Word | null | undefined) {
  return Array.isArray(word?.round2ChoiceDistractors) ? word.round2ChoiceDistractors : [];
}

function isWordQueuePrefix(prefix: Word[], full: Word[]) {
  return prefix.length <= full.length && prefix.every((word, index) => word.id === full[index]?.id);
}

function resolveRound1ConfirmedWordIdsForQueue(queue: Word[], confirmedWordIds: Iterable<string>) {
  const confirmedSet = new Set(confirmedWordIds);
  return limitRound1ReinforcementWordIds(queue.map((word) => word.id).filter((wordId) => confirmedSet.has(wordId)));
}

const CORRECT_READBACK_WORD_MS = 550;
const CORRECT_READBACK_TIMEOUT_BUFFER_MS = 3000;
const CORRECT_READBACK_TIMEOUT_MIN_MS = 5000;
const CORRECT_READBACK_TIMEOUT_MAX_MS = 30000;

function getCorrectReadbackTimeoutMs(sentence: string, playbackRate: number) {
  const words = sentence.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];
  const normalizedRate = playbackRate > 0 ? playbackRate : 1;
  const estimatedMs = Math.ceil((Math.max(words.length, 1) * CORRECT_READBACK_WORD_MS) / normalizedRate);

  return Math.min(
    CORRECT_READBACK_TIMEOUT_MAX_MS,
    Math.max(CORRECT_READBACK_TIMEOUT_MIN_MS, estimatedMs + CORRECT_READBACK_TIMEOUT_BUFFER_MS),
  );
}

export interface LearningSessionSnapshot {
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
  passedQueueIndices: number[];
  round1ConfirmedWordIds: string[];
}

interface OptimisticallyRemovedWord {
  word: Word;
  wasCompleted: boolean;
  wasRound1Confirmed: boolean;
}

interface Round2ChoiceOption {
  id: string;
  word: string;
  pos: string;
  meaningZh: string;
  isCorrect: boolean;
}

interface Round2ChoiceSelection {
  wordId: string;
  optionId: string;
  wasCorrect: boolean;
}

export const LearningEngine = ({
  userId,
  type,
  words,
  initialSession,
  onComplete,
  onSessionChange,
  initialReviewRecovery,
  onReviewChange,
  onWordMastered,
  onWordMasteredRollback,
  sessionLeadingAction,
  sessionActions,
  round1CanWaitForMoreWords = false,
}: {
  type: RoundType;
  words: Word[];
  initialSession?: PersistedLearningSession | null;
  userId?: string;
  onComplete: (session?: LearningSessionSnapshot) => void | Promise<void>;
  onSessionChange?: (session: LearningSessionSnapshot) => void;
  initialReviewRecovery?: ReviewRecovery | null;
  onReviewChange?: (session: ReviewRecovery) => void;
  onWordMastered?: (wordId: string) => void;
  onWordMasteredRollback?: (word: Word) => void;
  sessionLeadingAction?: React.ReactNode;
  sessionActions?: React.ReactNode;
  round1CanWaitForMoreWords?: boolean;
}) => {
  const { preferences } = useLearningPreferences();
  const { saveWord } = useSavedWords();
  const { openPopover } = useWordPopover();
  const initialEngineState = useMemo(() => {
    if (type === 'review' && initialReviewRecovery?.words.length) {
      const recovery = initialReviewRecovery;
      const currentIndex = Math.min(Math.max(0, recovery.currentIndex), recovery.words.length - 1);
      return {
        queue: recovery.words,
        currentIndex,
        initialCompletedIds: new Set(
          recovery.words
            .slice(0, currentIndex)
            .filter((word) => !recovery.words.slice(currentIndex).some((pending) => pending.id === word.id))
            .map((word) => word.id),
        ),
        initialPassedQueueIndices: recovery.passedQueueIndices,
        initialRound1ConfirmedIds: new Set<string>(),
      };
    }
    const hasMatchingSession = initialSession && initialSession.round === type;
    const wordMap = new Map(words.map((word) => [word.id, word]));
    const hydratedQueue = hasMatchingSession
      ? initialSession.queueWordIds.map((wordId) => wordMap.get(wordId)).filter((word): word is Word => Boolean(word))
      : [];
    const queue = hydratedQueue.length > 0 ? hydratedQueue : [...words];
    const currentIndex = hasMatchingSession
      ? Math.min(Math.max(initialSession.currentIndex, 0), Math.max(queue.length - 1, 0))
      : 0;
    const normalizedPassedQueueIndices = hasMatchingSession
      ? Array.from(new Set(initialSession.passedQueueIndices ?? []))
          .filter((index) => Number.isInteger(index) && index >= 0 && index < currentIndex && index < queue.length)
          .sort((left, right) => left - right)
      : [];
    const initialPassedQueueIndices =
      hasMatchingSession && type === 'round2' && normalizedPassedQueueIndices.length === 0 && currentIndex > 0
        ? Array.from({ length: currentIndex }, (_, index) => index)
        : normalizedPassedQueueIndices;

    // Words before currentIndex that are NOT re-queued later are truly completed.
    // Wrong answers get re-inserted after currentIndex, so prefix ∩ suffix = still pending.
    const pendingIds = new Set(queue.slice(currentIndex).map((word) => word.id));
    const initialCompletedIds = new Set<string>();
    for (const word of queue.slice(0, currentIndex)) {
      if (!pendingIds.has(word.id)) initialCompletedIds.add(word.id);
    }
    const initialRound1ConfirmedIds = new Set(
      limitRound1ReinforcementWordIds(
        (initialSession?.round1ConfirmedWordIds?.length
          ? initialSession.round1ConfirmedWordIds
          : type === 'round1'
            ? [...initialCompletedIds]
            : []
        ).filter((wordId) => wordMap.has(wordId)),
      ),
    );

    return {
      queue,
      currentIndex,
      initialCompletedIds,
      initialPassedQueueIndices,
      initialRound1ConfirmedIds,
    };
  }, [initialReviewRecovery, initialSession, type, words]);

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
  const [round1ConfirmedWordIds, setRound1ConfirmedWordIds] = useState<Set<string>>(
    () => new Set(initialEngineState.initialRound1ConfirmedIds),
  );
  const [round1WaitingForMoreWords, setRound1WaitingForMoreWords] = useState(false);

  const initialUniqueCount = words.length;
  const round1ProgressTarget =
    type === 'round1'
      ? round1CanWaitForMoreWords
        ? ROUND1_REINFORCEMENT_WORD_LIMIT
        : Math.min(Math.max(words.length, 1), ROUND1_REINFORCEMENT_WORD_LIMIT)
      : initialUniqueCount;
  const progressQueueLength = type === 'round1' ? round1ProgressTarget : initialUniqueCount;
  const completedCount = completedWordIds.size;
  const displayNumerator = Math.min(completedCount + 1, progressQueueLength);
  const displayProgressIndex =
    type === 'round1'
      ? Math.min(Math.max(round1ConfirmedWordIds.size - 1, 0), Math.max(progressQueueLength - 1, 0))
      : type === 'round2'
        ? Math.min(currentIndex, Math.max(progressQueueLength - 1, 0))
        : displayNumerator - 1;
  const passedQueueIndicesArray = useMemo(
    () => [...passedQueueIndices].sort((left, right) => left - right),
    [passedQueueIndices],
  );
  const reviewRunId = useRef(initialReviewRecovery?.runId ?? crypto.randomUUID());
  const reviewCompletedRef = useRef(false);
  useEffect(() => {
    if (type === 'review' && onReviewChange && !reviewCompletedRef.current)
      onReviewChange({
        runId: reviewRunId.current,
        words: queue,
        currentIndex,
        passedQueueIndices: passedQueueIndicesArray,
      });
  }, [currentIndex, onReviewChange, passedQueueIndicesArray, queue, type]);
  const round1ConfirmedWordIdsArray = useMemo(
    () => resolveRound1ConfirmedWordIdsForQueue(queue, round1ConfirmedWordIds),
    [queue, round1ConfirmedWordIds],
  );

  const [audioLocale, setAudioLocale] = useState<PronunciationLocale>(preferences.defaultPronunciationLocale);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [activeActionKind, setActiveActionKind] = useState<SessionActionKind | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [isReportSheetOpen, setIsReportSheetOpen] = useState(false);
  const [reportTargetWord, setReportTargetWord] = useState<Word | null>(null);
  const [reportIssueType, setReportIssueType] = useState<VocabularyIssueType>('definition');
  const [reportNote, setReportNote] = useState('');
  const [dictationPhoneticVisible, setDictationPhoneticVisible] = useState(true);
  const [round2ChoiceSelection, setRound2ChoiceSelection] = useState<Round2ChoiceSelection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileActionMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopActionMenuRef = useRef<HTMLDivElement | null>(null);
  const round3ActionMenuRef = useRef<HTMLDivElement | null>(null);
  const actionFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptStartedAtRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctReadbackTokenRef = useRef<symbol | null>(null);
  const audioGapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRunIdRef = useRef(0);
  const activePlaybackFinishRef = useRef<(() => void) | null>(null);
  const lastRound1PreloadKeyRef = useRef<string | null>(null);
  const lastRound2PreloadKeyRef = useRef<string | null>(null);
  const lastSessionSnapshotSignatureRef = useRef<string | null>(null);
  const round1CompletionInFlightRef = useRef(false);
  const round1AutoSubmitKeyRef = useRef<string | null>(null);
  const round3AutoSubmitKeyRef = useRef<string | null>(null);
  const round1SubmittedInputKeyRef = useRef<string | null>(null);
  const preferencesRef = useRef(preferences);
  const canPlayExampleAudio = useMemo(() => typeof Audio !== 'undefined' || isBrowserSpeechSupported(), []);

  const queueRef = useRef<Word[]>(initialEngineState.queue);
  const currentIndexRef = useRef(initialEngineState.currentIndex);
  const completedWordIdsRef = useRef<Set<string>>(new Set(initialEngineState.initialCompletedIds));
  const passedQueueIndicesRef = useRef<Set<number>>(new Set(initialEngineState.initialPassedQueueIndices));
  const round1ConfirmedWordIdsRef = useRef<Set<string>>(new Set(initialEngineState.initialRound1ConfirmedIds));
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    completedWordIdsRef.current = completedWordIds;
  }, [completedWordIds]);
  useEffect(() => {
    passedQueueIndicesRef.current = passedQueueIndices;
  }, [passedQueueIndices]);
  useEffect(() => {
    round1ConfirmedWordIdsRef.current = round1ConfirmedWordIds;
  }, [round1ConfirmedWordIds]);
  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const currentWord = queue[currentIndex];
  const inputDraftKey =
    userId && currentWord
      ? `lumina.input.v1.${userId}.${initialSession?.groupId ?? reviewRunId.current}.${type}.${currentIndex}.${currentWord.id}`
      : null;
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  useEffect(() => {
    if (!inputDraftKey || inputDraftKey !== hydratedDraftKey) return;
    try {
      writeLocal(inputDraftKey, { input: inputValue, showAnswer, choice: round2ChoiceSelection });
    } catch (error) {
      setSubmitError((error as Error).message);
    }
  }, [hydratedDraftKey, inputDraftKey, inputValue, round2ChoiceSelection, showAnswer]);
  const viewedWord = queue[viewIndex] ?? currentWord;
  const isViewingHistory = viewIndex !== currentIndex;
  const isDictationRound = type === 'round3' || type === 'review';
  const isRecallRound = type === 'round2';
  const lookupTargetWords = useMemo(
    () => new Set(words.map((word) => word.word.trim().toLowerCase()).filter(Boolean)),
    [words],
  );
  const clozePrompt = useMemo(() => {
    if (!isDictationRound || !currentWord) return null;
    return buildClozePrompt({ word: currentWord.word, senses: currentWord.senses });
  }, [currentWord, isDictationRound]);
  const viewedClozePrompt = useMemo(() => {
    if (!isDictationRound || !viewedWord) return null;
    return buildClozePrompt({ word: viewedWord.word, senses: viewedWord.senses });
  }, [isDictationRound, viewedWord]);
  const viewedClozeFullSentence = useMemo(() => {
    if (!viewedClozePrompt || !viewedWord) return '';
    return (viewedWord.senses[viewedClozePrompt.senseIndex]?.example_sentence ?? '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }, [viewedClozePrompt, viewedWord]);
  const viewedClozeSense = viewedClozePrompt && viewedWord ? viewedWord.senses[viewedClozePrompt.senseIndex] : null;
  const viewedClozeWordInfoText = formatClozeWordInfo(
    viewedClozeSense?.pos || viewedWord?.pos_tags[0],
    viewedClozeSense?.meaning_zh || viewedWord?.chinese_definition,
  );
  const viewedClozeSentenceAudioKey =
    viewedClozePrompt && viewedWord ? `${viewedWord.id}:${viewIndex}:cloze-sentence` : '';
  const round2ChoiceOptions = useMemo<Round2ChoiceOption[]>(() => {
    const distractors = getRound2ChoiceDistractors(viewedWord);
    if (type !== 'round2' || !viewedWord || distractors.length !== 3) return [];

    const primarySense = viewedWord.senses[0];
    const correctOption: Round2ChoiceOption = {
      id: 'correct',
      word: viewedWord.word,
      pos: primarySense?.pos || viewedWord.pos_tags[0] || '',
      meaningZh: primarySense?.meaning_zh || viewedWord.chinese_definition,
      isCorrect: true,
    };
    const distractorOptions: Round2ChoiceOption[] = distractors.map((item, index) => ({
      id: `distractor-${index}`,
      word: item.word,
      pos: item.pos,
      meaningZh: item.meaning_zh,
      isCorrect: false,
    }));

    return stableShuffle([correctOption, ...distractorOptions], `${viewedWord.id}:${viewedWord.word}:round2-choice`);
  }, [type, viewedWord]);
  const hasRound2ChoiceOptions = round2ChoiceOptions.length === 4;
  const activeRound2ChoiceSelection =
    round2ChoiceSelection && round2ChoiceSelection.wordId === viewedWord.id ? round2ChoiceSelection : null;
  const isRound2ChoiceRevealed = hasRound2ChoiceOptions && (isViewingHistory || Boolean(activeRound2ChoiceSelection));
  const expectedInput = (clozePrompt ? clozePrompt.expectedForm : (currentWord?.word ?? '')).trim().toLowerCase();
  const viewedExpectedInput = viewedClozePrompt
    ? viewedClozePrompt.expectedForm.trim().toLowerCase()
    : (viewedWord?.word ?? '').trim().toLowerCase();
  const displayedInputValue = isViewingHistory ? viewedExpectedInput : inputValue;
  const roundSource = type === 'review' ? 'review' : type === 'round3' ? 'round3' : type === 'round2' ? 'round2' : null;
  const activePronunciationLocale = playbackTarget?.kind === 'pronunciation' ? playbackTarget.locale : null;
  const activeExampleKey = playbackTarget?.kind === 'example' ? playbackTarget.key : null;

  const clearAnswerRevealTimeout = useCallback(() => {
    correctReadbackTokenRef.current = null;
    if (answerRevealTimeoutRef.current === null) return;
    clearTimeout(answerRevealTimeoutRef.current);
    answerRevealTimeoutRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    playbackRunIdRef.current += 1;
    const finishActivePlayback = activePlaybackFinishRef.current;

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

    finishActivePlayback?.();
    cancelBrowserSpeech();
    setPlaybackTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener('lumina:pause', stopPlayback);
    return () => window.removeEventListener('lumina:pause', stopPlayback);
  }, [stopPlayback]);

  useEffect(() => {
    const currentPassedQueueIndices = [...passedQueueIndicesRef.current].sort((left, right) => left - right);
    const hasSamePersistedProgress =
      currentIndexRef.current === initialEngineState.currentIndex &&
      areNumberArraysEqual(currentPassedQueueIndices, initialEngineState.initialPassedQueueIndices) &&
      areSetsEqual(round1ConfirmedWordIdsRef.current, initialEngineState.initialRound1ConfirmedIds);

    if (hasSamePersistedProgress && areWordQueuesEqual(queueRef.current, initialEngineState.queue)) {
      return;
    }

    if (hasSamePersistedProgress && isWordQueuePrefix(queueRef.current, initialEngineState.queue)) {
      queueRef.current = initialEngineState.queue;
      setQueue(initialEngineState.queue);
      return;
    }

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
    setRound1WaitingForMoreWords(false);
    setIsActionMenuOpen(false);
    setIsReportSheetOpen(false);
    setActionFeedback(null);
    setActiveActionKind(null);
    setReportTargetWord(null);
    setReportIssueType('definition');
    setReportNote('');
    setRound2ChoiceSelection(null);
    round1CompletionInFlightRef.current = false;
    round1AutoSubmitKeyRef.current = null;
    round3AutoSubmitKeyRef.current = null;
    round1SubmittedInputKeyRef.current = null;
    setCompletedWordIds(new Set(initialEngineState.initialCompletedIds));
    setPassedQueueIndices(new Set(initialEngineState.initialPassedQueueIndices));
    setRound1ConfirmedWordIds(new Set(initialEngineState.initialRound1ConfirmedIds));
    queueRef.current = initialEngineState.queue;
    currentIndexRef.current = initialEngineState.currentIndex;
    completedWordIdsRef.current = new Set(initialEngineState.initialCompletedIds);
    passedQueueIndicesRef.current = new Set(initialEngineState.initialPassedQueueIndices);
    round1ConfirmedWordIdsRef.current = new Set(initialEngineState.initialRound1ConfirmedIds);
  }, [clearAnswerRevealTimeout, initialEngineState, stopPlayback]);

  useEffect(
    () => () => {
      clearAnswerRevealTimeout();
      stopPlayback();
    },
    [clearAnswerRevealTimeout, stopPlayback],
  );

  useEffect(
    () => () => {
      if (actionFeedbackTimeoutRef.current !== null) {
        clearTimeout(actionFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setRound2ChoiceSelection(null);
  }, [currentWord?.id, type]);

  useEffect(() => {
    if (!inputDraftKey) return;
    const draft = readLocal<{ input: string; showAnswer: boolean; choice: Round2ChoiceSelection | null }>(
      inputDraftKey,
    );
    setInputValue(typeof draft?.input === 'string' ? draft.input : '');
    setShowAnswer(draft?.showAnswer === true);
    setRound2ChoiceSelection(draft?.choice ?? null);
    setHydratedDraftKey(inputDraftKey);
  }, [inputDraftKey]);

  useEffect(() => {
    if (viewIndex === currentIndex) {
      inputRef.current?.focus();
    }
  }, [currentIndex, viewIndex]);

  const speakViaBrowser = useCallback(
    (text: string, locale: PronunciationLocale, runId: number, target: PlaybackTarget) => {
      if (!canPlayExampleAudio || runId !== playbackRunIdRef.current) {
        return Promise.resolve(false);
      }

      setPlaybackTarget(target);

      return speakTextViaBrowser(text, locale, preferencesRef.current.speechPlaybackRate).finally(() => {
        if (runId === playbackRunIdRef.current) {
          setPlaybackTarget(null);
        }
      });
    },
    [canPlayExampleAudio],
  );

  const resolveAudioUrl = useCallback(async (word: Word, locale: PronunciationLocale) => {
    const cachedUrl = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
    if (cachedUrl) {
      primeWordAudioUrl(word.word, locale, cachedUrl);
      return cachedUrl;
    }

    return fetchWordAudioUrl(word.word, locale);
  }, []);

  const resolveExampleAudioUrl = useCallback(
    (sentence: string, locale: PronunciationLocale) => fetchExampleAudioUrl(sentence, locale),
    [],
  );

  const waitForGap = useCallback(
    (gapMs: number, runId: number) =>
      new Promise<void>((resolve) => {
        if (gapMs <= 0 || runId !== playbackRunIdRef.current) {
          resolve();
          return;
        }

        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          audioGapTimeoutRef.current = null;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          resolve();
        };

        activePlaybackFinishRef.current = finish;
        audioGapTimeoutRef.current = setTimeout(finish, gapMs);
      }),
    [],
  );

  const playAudioOnce = useCallback(
    async (word: Word, locale: PronunciationLocale, runId: number) => {
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
        const playbackRate = preferencesRef.current.speechPlaybackRate;
        audio.defaultPlaybackRate = playbackRate;
        audio.playbackRate = playbackRate;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
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
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          void speakViaBrowser(word.word, locale, runId, pronunciationTarget).then(() => resolve());
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = fallbackToSpeech;
        audio.play().catch(fallbackToSpeech);
      });
    },
    [resolveAudioUrl, speakViaBrowser],
  );

  const playAudioSequence = useCallback(
    async (word: Word, locale: PronunciationLocale, repeatCount: number, gapMs: number) => {
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
    },
    [playAudioOnce, stopPlayback, waitForGap],
  );

  const playExampleSentence = useCallback(
    async (sentence: string, key: string) => {
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
        const playbackRate = preferencesRef.current.speechPlaybackRate;
        audio.defaultPlaybackRate = playbackRate;
        audio.playbackRate = playbackRate;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
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
          if (activePlaybackFinishRef.current === finish) {
            activePlaybackFinishRef.current = null;
          }
          if (audioRef.current === audio) {
            audioRef.current = null;
          }
          void speakViaBrowser(sentence, audioLocale, runId, exampleTarget).then(() => resolve());
        };

        audioRef.current = audio;
        activePlaybackFinishRef.current = finish;
        audio.onended = finish;
        audio.onerror = fallbackToSpeech;
        audio.play().catch(fallbackToSpeech);
      });
    },
    [audioLocale, canPlayExampleAudio, playbackTarget, resolveExampleAudioUrl, speakViaBrowser, stopPlayback],
  );

  useEffect(() => {
    if (!currentWord) return;

    const locale = preferences.defaultPronunciationLocale;
    setAudioLocale(locale);
    stopPlayback();

    if (!preferences.autoPlayEnabled) {
      return;
    }

    void playAudioSequence(currentWord, locale, preferences.autoPlayRepeatCount, preferences.autoPlayRepeatGapMs);
  }, [
    currentWord,
    playAudioSequence,
    preferences.autoPlayEnabled,
    preferences.autoPlayRepeatCount,
    preferences.autoPlayRepeatGapMs,
    preferences.defaultPronunciationLocale,
    preferences.speechPlaybackRate,
    stopPlayback,
  ]);

  useEffect(() => {
    if (type !== 'round1') {
      lastRound1PreloadKeyRef.current = null;
      return;
    }

    const nextRound1Word = queue[currentIndex + 1];
    if (!nextRound1Word) return;

    const locale = preferences.defaultPronunciationLocale;
    const preloadKey = `${currentIndex + 1}:${nextRound1Word.id}:${locale}`;
    if (lastRound1PreloadKeyRef.current === preloadKey) return;

    lastRound1PreloadKeyRef.current = preloadKey;
    void preloadRound1CardResources(nextRound1Word, locale);
  }, [currentIndex, preferences.defaultPronunciationLocale, queue, type]);

  useEffect(() => {
    if (type !== 'round3') {
      lastRound2PreloadKeyRef.current = null;
      return;
    }

    const nextRound2Word = queue[currentIndex + 1];
    if (!nextRound2Word) return;

    const locale = preferences.defaultPronunciationLocale;
    const preloadKey = `${currentIndex + 1}:${nextRound2Word.id}:${locale}`;
    if (lastRound2PreloadKeyRef.current === preloadKey) return;

    lastRound2PreloadKeyRef.current = preloadKey;
    void preloadRound2CardResources(nextRound2Word, locale);
  }, [currentIndex, preferences.defaultPronunciationLocale, queue, type]);

  useEffect(() => {
    if (!roundSource) return;
    promptStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setSubmitError('');
  }, [currentIndex, roundSource]);

  useEffect(() => {
    if (!isDictationRound || isViewingHistory || showAnswer || isSubmittingAttempt) {
      return undefined;
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [currentIndex, isDictationRound, isSubmittingAttempt, isViewingHistory, showAnswer]);

  useEffect(() => {
    if (type === 'article') return;
    const canViewIndex = viewIndex === currentIndex || passedQueueIndices.has(viewIndex);
    if (!canViewIndex || viewIndex >= queue.length) {
      setViewIndex(currentIndex);
    }
  }, [currentIndex, passedQueueIndices, queue.length, type, viewIndex]);

  const buildSessionSnapshot = useCallback(
    (overrides: Partial<LearningSessionSnapshot> = {}): LearningSessionSnapshot => ({
      round: type as LearningRoundType,
      currentIndex,
      queueWordIds: queue.map((word) => word.id),
      passedQueueIndices: passedQueueIndicesArray,
      round1ConfirmedWordIds: round1ConfirmedWordIdsArray,
      ...overrides,
    }),
    [currentIndex, passedQueueIndicesArray, queue, round1ConfirmedWordIdsArray, type],
  );

  const getRound1NoConfirmedMessage = useCallback(() => {
    if (preferencesRef.current.reinforcementRound3Enabled) {
      return '至少确认 1 个词后，才能进入回忆。';
    }
    if (preferencesRef.current.round2Enabled) {
      return '至少确认 1 个词后，才能进入听写。';
    }
    return '至少确认 1 个词后，才能完成本组。';
  }, []);

  const completeRound1WithConfirmedWords = useCallback(
    (overrides: Partial<LearningSessionSnapshot> = {}) => {
      if (type !== 'round1') return false;
      if (round1CompletionInFlightRef.current) return true;

      const confirmedWordIds =
        overrides.round1ConfirmedWordIds ??
        resolveRound1ConfirmedWordIdsForQueue(queueRef.current, round1ConfirmedWordIdsRef.current);

      if (confirmedWordIds.length === 0) {
        setSubmitError(getRound1NoConfirmedMessage());
        return false;
      }

      clearAnswerRevealTimeout();
      stopPlayback();
      round1CompletionInFlightRef.current = true;
      setRound1WaitingForMoreWords(false);
      setSubmitError('');
      void attemptBuffer.flush();
      void onComplete(
        buildSessionSnapshot({
          round: 'round1',
          currentIndex: overrides.currentIndex ?? currentIndexRef.current,
          queueWordIds: overrides.queueWordIds ?? queueRef.current.map((word) => word.id),
          passedQueueIndices: overrides.passedQueueIndices ?? passedQueueIndicesArray,
          round1ConfirmedWordIds: confirmedWordIds,
        }),
      );
      return true;
    },
    [
      buildSessionSnapshot,
      clearAnswerRevealTimeout,
      getRound1NoConfirmedMessage,
      onComplete,
      passedQueueIndicesArray,
      stopPlayback,
      type,
    ],
  );

  useEffect(() => {
    const currentWordAlreadyConfirmed = Boolean(currentWord?.id && round1ConfirmedWordIds.has(currentWord.id));
    if (
      type !== 'round1' ||
      (!round1WaitingForMoreWords && !currentWordAlreadyConfirmed) ||
      currentIndex >= queue.length - 1
    ) {
      return;
    }

    const nextIndex = currentIndex + 1;
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    setViewIndex(nextIndex);
    setInputValue('');
    setIsWrong(false);
    setLastWrongInput(null);
    setShowAnswer(false);
    setSubmitError('');
    setRound1WaitingForMoreWords(false);
    setRound2ChoiceSelection(null);
  }, [currentIndex, currentWord?.id, queue.length, round1ConfirmedWordIds, round1WaitingForMoreWords, type]);

  useEffect(() => {
    if (type !== 'round1' || !round1WaitingForMoreWords || round1CanWaitForMoreWords) return;
    if (round1ConfirmedWordIdsArray.length === 0) return;
    void completeRound1WithConfirmedWords();
  }, [
    completeRound1WithConfirmedWords,
    round1CanWaitForMoreWords,
    round1ConfirmedWordIdsArray.length,
    round1WaitingForMoreWords,
    type,
  ]);

  useEffect(() => {
    if (!onSessionChange || type === 'review') return;
    if (type === 'round1' && round1CompletionInFlightRef.current) return;

    const snapshot = buildSessionSnapshot();
    const signature = JSON.stringify([
      snapshot.round,
      snapshot.currentIndex,
      snapshot.queueWordIds,
      snapshot.passedQueueIndices,
      snapshot.round1ConfirmedWordIds,
    ]);
    if (lastSessionSnapshotSignatureRef.current === signature) return;
    lastSessionSnapshotSignatureRef.current = signature;
    onSessionChange(snapshot);
  }, [buildSessionSnapshot, onSessionChange, type]);

  const markCurrentQueueIndexPassed = useCallback(() => {
    const passedIndex = currentIndexRef.current;
    setPassedQueueIndices((prev) => {
      if (prev.has(passedIndex)) return prev;
      const next = new Set(prev);
      next.add(passedIndex);
      return next;
    });
  }, []);

  const requeueCurrentWord = useCallback(() => {
    if (!currentWord) return;
    const currentQueue = queueRef.current;
    const insertAt = getWrongAnswerRequeueIndex(currentIndexRef.current, currentQueue.length);
    const nextQueue = [...currentQueue];
    nextQueue.splice(insertAt, 0, currentWord);
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, [currentWord]);

  const nextWord = useCallback(() => {
    clearAnswerRevealTimeout();
    stopPlayback();
    round3AutoSubmitKeyRef.current = null;
    setRound2ChoiceSelection(null);
    if (currentIndexRef.current < queueRef.current.length - 1) {
      const nextIndex = currentIndexRef.current + 1;
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      setViewIndex(nextIndex);
      setInputValue('');
      setIsWrong(false);
      setLastWrongInput(null);
      setShowAnswer(false);
      setSubmitError('');
    } else {
      if (type === 'round1') {
        setRound1WaitingForMoreWords(true);
        setSubmitError(
          `已通过 ${round1ConfirmedWordIdsRef.current.size}/${ROUND1_REINFORCEMENT_WORD_LIMIT} 个词，正在等待下一批新词预载。`,
        );
        return;
      }

      // 学习一轮结束，强制触发一次同步
      void attemptBuffer.flush();
      if (type === 'review') reviewCompletedRef.current = true;
      void onComplete(
        type === 'review'
          ? undefined
          : buildSessionSnapshot({
              currentIndex: currentIndexRef.current,
              queueWordIds: queueRef.current.map((word) => word.id),
            }),
      );
    }
  }, [buildSessionSnapshot, clearAnswerRevealTimeout, onComplete, stopPlayback, type]);

  const navigableQueueIndices = useMemo(() => {
    if (type === 'article' || !currentWord) return [];

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
  const isCardNavigationLocked = showAnswer || isSubmittingAttempt || Boolean(activeRound2ChoiceSelection);
  const canNavigateLeft = !isCardNavigationLocked && currentNavigationSlot > 0;
  const canNavigateRight =
    !isCardNavigationLocked && currentNavigationSlot >= 0 && currentNavigationSlot < navigableQueueIndices.length - 1;

  const navigateCard = useCallback(
    (direction: 'previous' | 'next') => {
      if (isCardNavigationLocked) return;

      const slot = navigableQueueIndices.indexOf(viewIndex);
      const nextSlot = direction === 'previous' ? slot - 1 : slot + 1;
      const nextViewIndex = navigableQueueIndices[nextSlot];
      if (typeof nextViewIndex !== 'number') return;

      stopPlayback();
      setSubmitError('');
      setViewIndex(nextViewIndex);
    },
    [isCardNavigationLocked, navigableQueueIndices, stopPlayback, viewIndex],
  );

  const showSessionActionFeedback = useCallback((feedback: ActionFeedback) => {
    if (actionFeedbackTimeoutRef.current !== null) {
      clearTimeout(actionFeedbackTimeoutRef.current);
    }

    setActionFeedback(feedback);
    actionFeedbackTimeoutRef.current = setTimeout(() => {
      setActionFeedback(null);
      actionFeedbackTimeoutRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    if (!isActionMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const isInsideActionMenu = [
        mobileActionMenuRef.current,
        desktopActionMenuRef.current,
        round3ActionMenuRef.current,
      ].some((node) => node?.contains(target));
      if (!target || isInsideActionMenu) return;
      setIsActionMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsActionMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActionMenuOpen]);

  const removeWordFromCurrentSession = useCallback(
    (wordId: string): OptimisticallyRemovedWord | null => {
      clearAnswerRevealTimeout();
      stopPlayback();

      const previousQueue = queueRef.current;
      const filteredQueue = previousQueue.filter((word) => word.id !== wordId);
      const removedWord = previousQueue.find((word) => word.id === wordId);
      if (!removedWord || filteredQueue.length === previousQueue.length) return null;

      const rollbackWord: OptimisticallyRemovedWord = {
        word: removedWord,
        wasCompleted: completedWordIdsRef.current.has(wordId),
        wasRound1Confirmed: round1ConfirmedWordIdsRef.current.has(wordId),
      };

      const nextCompletedWordIds = new Set(completedWordIdsRef.current);
      nextCompletedWordIds.add(wordId);
      completedWordIdsRef.current = nextCompletedWordIds;
      setCompletedWordIds(nextCompletedWordIds);

      const nextRound1ConfirmedWordIds = new Set(round1ConfirmedWordIdsRef.current);
      nextRound1ConfirmedWordIds.delete(wordId);
      round1ConfirmedWordIdsRef.current = nextRound1ConfirmedWordIds;
      setRound1ConfirmedWordIds(nextRound1ConfirmedWordIds);

      const indexMap = new Map<number, number>();
      previousQueue.forEach((word, index) => {
        if (word.id !== wordId) {
          indexMap.set(index, indexMap.size);
        }
      });

      queueRef.current = filteredQueue;
      setQueue(filteredQueue);

      if (filteredQueue.length === 0) {
        currentIndexRef.current = 0;
        setCurrentIndex(0);
        setViewIndex(0);
        setInputValue('');
        setIsWrong(false);
        setLastWrongInput(null);
        setShowAnswer(false);
        setSubmitError('');
        setRound2ChoiceSelection(null);
        const nextPassedQueueIndices = new Set<number>();
        passedQueueIndicesRef.current = nextPassedQueueIndices;
        setPassedQueueIndices(nextPassedQueueIndices);
        void attemptBuffer.flush();
        if (type === 'review') reviewCompletedRef.current = true;
        void onComplete(
          type === 'review'
            ? undefined
            : buildSessionSnapshot({
                currentIndex: 0,
                queueWordIds: [],
                passedQueueIndices: [],
                round1ConfirmedWordIds: round1ConfirmedWordIdsArray.filter((id) => id !== wordId),
              }),
        );
        return rollbackWord;
      }

      const currentQueueIndex = currentIndexRef.current;
      const removedBeforeCurrent = previousQueue
        .slice(0, currentQueueIndex)
        .filter((word) => word.id === wordId).length;
      const nextCurrentIndex = Math.min(
        Math.max(currentQueueIndex - removedBeforeCurrent, 0),
        filteredQueue.length - 1,
      );
      const nextViewIndex = indexMap.get(viewIndex) ?? nextCurrentIndex;

      currentIndexRef.current = nextCurrentIndex;
      setCurrentIndex(nextCurrentIndex);
      setViewIndex(nextViewIndex);
      setInputValue('');
      setIsWrong(false);
      setLastWrongInput(null);
      setShowAnswer(false);
      setSubmitError('');
      setRound2ChoiceSelection(null);
      const nextPassedQueueIndices = new Set<number>();
      for (const index of passedQueueIndicesRef.current) {
        const mappedIndex = indexMap.get(index);
        if (typeof mappedIndex === 'number' && mappedIndex < nextCurrentIndex) {
          nextPassedQueueIndices.add(mappedIndex);
        }
      }
      passedQueueIndicesRef.current = nextPassedQueueIndices;
      setPassedQueueIndices(nextPassedQueueIndices);

      return rollbackWord;
    },
    [
      buildSessionSnapshot,
      clearAnswerRevealTimeout,
      onComplete,
      round1ConfirmedWordIdsArray,
      stopPlayback,
      type,
      viewIndex,
    ],
  );

  const requeueOptimisticallyRemovedWord = useCallback(
    ({ word, wasCompleted, wasRound1Confirmed }: OptimisticallyRemovedWord) => {
      clearAnswerRevealTimeout();
      stopPlayback();

      if (!queueRef.current.some((queuedWord) => queuedWord.id === word.id)) {
        const nextQueue = [...queueRef.current, word];
        queueRef.current = nextQueue;
        setQueue(nextQueue);

        if (nextQueue.length === 1) {
          currentIndexRef.current = 0;
          setCurrentIndex(0);
          setViewIndex(0);
          setInputValue('');
          setIsWrong(false);
          setLastWrongInput(null);
          setShowAnswer(false);
          setSubmitError('');
        }
      }

      const nextCompletedWordIds = new Set(completedWordIdsRef.current);
      if (wasCompleted) {
        nextCompletedWordIds.add(word.id);
      } else {
        nextCompletedWordIds.delete(word.id);
      }
      completedWordIdsRef.current = nextCompletedWordIds;
      setCompletedWordIds(nextCompletedWordIds);

      const nextRound1ConfirmedWordIds = new Set(round1ConfirmedWordIdsRef.current);
      if (wasRound1Confirmed) {
        nextRound1ConfirmedWordIds.add(word.id);
      } else {
        nextRound1ConfirmedWordIds.delete(word.id);
      }
      round1ConfirmedWordIdsRef.current = nextRound1ConfirmedWordIds;
      setRound1ConfirmedWordIds(nextRound1ConfirmedWordIds);

      setRound1WaitingForMoreWords(false);
    },
    [clearAnswerRevealTimeout, stopPlayback],
  );

  const handleMarkViewedWordMastered = useCallback(async () => {
    if (activeActionKind || !viewedWord) return;

    const wordToMaster = viewedWord;
    setIsActionMenuOpen(false);
    setActiveActionKind('mastered');
    setSubmitError('');
    const rollbackWord = removeWordFromCurrentSession(wordToMaster.id);
    if (rollbackWord) {
      onWordMastered?.(wordToMaster.id);
    }
    setActiveActionKind(null);

    try {
      await markReviewWordMastered({
        vocabularyItemId: wordToMaster.id,
        learningGroupId: initialSession?.groupId ?? null,
      });
      showSessionActionFeedback({ tone: 'success', text: `已掌握 ${wordToMaster.word}` });
    } catch (error) {
      if (rollbackWord) {
        requeueOptimisticallyRemovedWord(rollbackWord);
        onWordMasteredRollback?.(rollbackWord.word);
      }
      showSessionActionFeedback({
        tone: 'error',
        text: error instanceof Error ? `标记已掌握失败，已放回本轮：${error.message}` : '标记已掌握失败，已放回本轮。',
      });
    }
  }, [
    activeActionKind,
    initialSession?.groupId,
    onWordMastered,
    onWordMasteredRollback,
    removeWordFromCurrentSession,
    requeueOptimisticallyRemovedWord,
    showSessionActionFeedback,
    viewedWord,
  ]);

  const handleSaveViewedWord = useCallback(async () => {
    if (activeActionKind || !viewedWord) return;

    setIsActionMenuOpen(false);
    setActiveActionKind('save');
    setSubmitError('');

    try {
      const result = await saveWord(viewedWord.id, 'manual');
      if (result.saved === false || result.skippedReason === 'non_new_state') {
        showSessionActionFeedback({
          tone: 'error',
          text: '这个词已有学习进度，不重复加入个人词库。',
        });
        return;
      }

      showSessionActionFeedback({
        tone: 'success',
        text: result.inserted === false ? '已经在个人词库里' : `已加入个人词库 ${viewedWord.word}`,
      });
    } catch (error) {
      showSessionActionFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '加入个人词库失败，请稍后再试。',
      });
    } finally {
      setActiveActionKind(null);
    }
  }, [activeActionKind, saveWord, showSessionActionFeedback, viewedWord]);

  const handleOpenReportSheet = useCallback(() => {
    if (!viewedWord) return;
    setIsActionMenuOpen(false);
    setReportTargetWord(viewedWord);
    setReportIssueType('definition');
    setReportNote('');
    setIsReportSheetOpen(true);
  }, [viewedWord]);

  const handleSubmitReport = useCallback(async () => {
    const targetWord = reportTargetWord ?? viewedWord;
    if (activeActionKind || !targetWord) return;

    setActiveActionKind('report');
    try {
      await reportVocabularyIssue({
        vocabularyItemId: targetWord.id,
        wordSnapshot: targetWord.word,
        learningGroupId: initialSession?.groupId ?? null,
        sessionRound: type,
        issueType: reportIssueType,
        note: reportNote,
        routePath:
          typeof window === 'undefined'
            ? null
            : `${window.location.pathname}${window.location.search}${window.location.hash}`,
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      });
      setIsReportSheetOpen(false);
      setReportTargetWord(null);
      setReportNote('');
      showSessionActionFeedback({ tone: 'success', text: '已收到反馈' });
    } catch (error) {
      showSessionActionFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '报告问题失败，请稍后再试。',
      });
    } finally {
      setActiveActionKind(null);
    }
  }, [
    activeActionKind,
    initialSession?.groupId,
    reportIssueType,
    reportNote,
    reportTargetWord,
    showSessionActionFeedback,
    type,
    viewedWord,
  ]);

  const swipeStartRef = useRef<{ x: number; y: number; valid: boolean } | null>(null);
  const handleCardTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target as HTMLElement | null;
    const isInteractive = Boolean(
      target?.closest('input, textarea, button, a, [role="button"], [contenteditable="true"]'),
    );
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, valid: !isInteractive };
  }, []);
  const handleCardTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start || !start.valid) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
      if (deltaX < 0 && canNavigateRight) {
        navigateCard('next');
      } else if (deltaX > 0 && canNavigateLeft) {
        navigateCard('previous');
      }
    },
    [canNavigateLeft, canNavigateRight, navigateCard],
  );

  // 离开时尝试同步；未收到确认的数据保留在本机。
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

  const persistAttempt = useCallback(
    async (wasCorrect: boolean) => {
      if (!roundSource) return true;

      try {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsedMs = Math.max(0, Math.round(now - promptStartedAtRef.current));

        // 使用缓冲模块，不再直接调用后端 API
        await attemptBuffer.pushAttempt({
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
    },
    [currentWord.id, initialSession?.groupId, roundSource],
  );

  const handleRound3PrimaryAction = useCallback(() => {
    if (isViewingHistory) return;

    if (type === 'round2' && getRound2ChoiceDistractors(currentWord).length === 3) {
      if (!activeRound2ChoiceSelection) return;
      if (activeRound2ChoiceSelection.wasCorrect) {
        markCurrentQueueIndexPassed();
      } else {
        requeueCurrentWord();
      }
      nextWord();
      return;
    }

    if (!showAnswer) {
      setSubmitError('');
      setShowAnswer(true);
      return;
    }

    markCurrentQueueIndexPassed();
    nextWord();
  }, [
    activeRound2ChoiceSelection,
    currentWord,
    isViewingHistory,
    markCurrentQueueIndexPassed,
    nextWord,
    requeueCurrentWord,
    showAnswer,
    type,
  ]);

  const handleRound3Unknown = useCallback(async () => {
    if (isViewingHistory || !showAnswer || isSubmittingAttempt) return;

    setIsSubmittingAttempt(true);
    setSubmitError('');

    try {
      await markReviewWordUnknown({
        vocabularyItemId: currentWord.id,
        learningGroupId: initialSession?.groupId,
        timestamp: Date.now(),
      });
      requeueCurrentWord();
      nextWord();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmittingAttempt(false);
    }
  }, [
    currentWord.id,
    initialSession?.groupId,
    isSubmittingAttempt,
    isViewingHistory,
    nextWord,
    requeueCurrentWord,
    showAnswer,
  ]);

  const handleRound2ChoiceSelect = useCallback(
    (option: Round2ChoiceOption) => {
      if (isViewingHistory || isSubmittingAttempt || !currentWord || activeRound2ChoiceSelection) return;

      setSubmitError('');
      setRound2ChoiceSelection({
        wordId: currentWord.id,
        optionId: option.id,
        wasCorrect: option.isCorrect,
      });
      void persistAttempt(option.isCorrect).then((saved) => {
        if (!saved) {
          setSubmitError('答案未能保存，请检查存储空间后重试。');
          setRound2ChoiceSelection(null);
        }
      });
    },
    [activeRound2ChoiceSelection, currentWord, isSubmittingAttempt, isViewingHistory, persistAttempt],
  );

  const validateCurrentInput = useCallback(
    async (rawInput = inputValue) => {
      // 防止重复提交
      if (showAnswer || isSubmittingAttempt || isViewingHistory) return;

      const trimmedInput = rawInput.trim().toLowerCase();
      const wasCorrect = stripDiacritics(trimmedInput) === stripDiacritics(expectedInput);
      const round1SubmissionKey = type === 'round1' && currentWord ? `${currentWord.id}:${expectedInput}` : null;

      if (wasCorrect && round1SubmissionKey) {
        if (round1SubmittedInputKeyRef.current === round1SubmissionKey) return;
        round1SubmittedInputKeyRef.current = round1SubmissionKey;
      }

      if (roundSource && !(await persistAttempt(wasCorrect))) {
        round1SubmittedInputKeyRef.current = null;
        setSubmitError('答案未能保存，请检查存储空间后重试。');
        return;
      }

      if (wasCorrect) {
        setCompletedWordIds((prev) => {
          const next = new Set(prev);
          next.add(currentWord.id);
          return next;
        });
        if (type === 'round1') {
          const nextRound1ConfirmedWordIdSet = new Set(round1ConfirmedWordIdsRef.current);
          nextRound1ConfirmedWordIdSet.add(currentWord.id);
          const nextConfirmedWordIds = resolveRound1ConfirmedWordIdsForQueue(
            queueRef.current,
            nextRound1ConfirmedWordIdSet,
          );
          const nextPassedQueueIndices = [...passedQueueIndicesRef.current, currentIndexRef.current]
            .filter((index, arrayIndex, allIndices) => allIndices.indexOf(index) === arrayIndex)
            .sort((left, right) => left - right);
          const currentQueueWordIds = queueRef.current.map((word) => word.id);
          const isAtQueueEnd = currentIndexRef.current >= queueRef.current.length - 1;

          const nextConfirmedWordIdSet = new Set(nextConfirmedWordIds);
          round1ConfirmedWordIdsRef.current = nextConfirmedWordIdSet;
          setRound1ConfirmedWordIds(nextConfirmedWordIdSet);
          setIsWrong(false);
          setSubmitError('');
          setInputValue('');
          clearAnswerRevealTimeout();
          setPassedQueueIndices(new Set(nextPassedQueueIndices));

          if (nextConfirmedWordIds.length >= ROUND1_REINFORCEMENT_WORD_LIMIT) {
            completeRound1WithConfirmedWords({
              currentIndex: currentIndexRef.current,
              queueWordIds: currentQueueWordIds,
              passedQueueIndices: nextPassedQueueIndices,
              round1ConfirmedWordIds: nextConfirmedWordIds,
            });
            return;
          }

          if (isAtQueueEnd) {
            if (round1CanWaitForMoreWords) {
              stopPlayback();
              setRound1WaitingForMoreWords(true);
              setSubmitError(
                `已通过 ${nextConfirmedWordIds.length}/${ROUND1_REINFORCEMENT_WORD_LIMIT} 个词，正在等待下一批新词预载。`,
              );
              return;
            }

            completeRound1WithConfirmedWords({
              currentIndex: currentIndexRef.current,
              queueWordIds: currentQueueWordIds,
              passedQueueIndices: nextPassedQueueIndices,
              round1ConfirmedWordIds: nextConfirmedWordIds,
            });
            return;
          }

          setRound1WaitingForMoreWords(false);
          nextWord();
          return;
        }

        if (isDictationRound) {
          setShowAnswer(true);
          setIsWrong(false);
          clearAnswerRevealTimeout();

          const advance = () => {
            answerRevealTimeoutRef.current = null;
            setShowAnswer(false);
            markCurrentQueueIndexPassed();
            nextWord();
          };

          if (isDictationRound && clozePrompt && preferences.clozeSentenceAutoPlayEnabled) {
            const fullSentence = (currentWord.senses[clozePrompt.senseIndex]?.example_sentence ?? '')
              .replace(/\*\*(.+?)\*\*/g, '$1')
              .trim();
            if (fullSentence) {
              const token = Symbol('correct-readback');
              correctReadbackTokenRef.current = token;
              const playKey = `${currentWord.id}-correct-readback`;
              const finishCorrectReadback = () => {
                if (correctReadbackTokenRef.current !== token) return;
                correctReadbackTokenRef.current = null;
                if (answerRevealTimeoutRef.current !== null) {
                  clearTimeout(answerRevealTimeoutRef.current);
                  answerRevealTimeoutRef.current = null;
                }
                advance();
              };
              answerRevealTimeoutRef.current = setTimeout(
                finishCorrectReadback,
                getCorrectReadbackTimeoutMs(fullSentence, preferences.speechPlaybackRate),
              );
              void playExampleSentence(fullSentence, playKey).then(finishCorrectReadback, finishCorrectReadback);
              return;
            }
          }

          answerRevealTimeoutRef.current = setTimeout(advance, preferences.correctAnswerRevealMs);
          return;
        }

        nextWord();
        return;
      }

      setIsWrong(true);
      setLastWrongInput(rawInput);

      if (isDictationRound) {
        requeueCurrentWord();

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
    },
    [
      showAnswer,
      roundSource,
      isSubmittingAttempt,
      isDictationRound,
      isViewingHistory,
      inputValue,
      expectedInput,
      persistAttempt,
      currentWord,
      type,
      nextWord,
      clearAnswerRevealTimeout,
      completeRound1WithConfirmedWords,
      stopPlayback,
      preferences.clozeSentenceAutoPlayEnabled,
      preferences.correctAnswerRevealMs,
      preferences.speechPlaybackRate,
      preferences.wrongAnswerRevealMs,
      round1CanWaitForMoreWords,
      clozePrompt,
      playExampleSentence,
      markCurrentQueueIndexPassed,
      requeueCurrentWord,
    ],
  );

  useEffect(() => {
    if (!isRecallRound) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return;
      event.preventDefault();
      handleRound3PrimaryAction();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRound3PrimaryAction, isRecallRound]);

  useEffect(() => {
    if (type === 'article') return;

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
    const isComposing = (e.nativeEvent as InputEvent).isComposing === true;
    let nextValue = val;

    if (isDictationRound) {
      nextValue = val
        .toLowerCase()
        .replace(/[^\p{L}' -]/gu, '')
        .slice(0, expectedInput.length);
    }

    setInputValue(nextValue);
    setIsWrong(false);

    if (isComposing || showAnswer || isSubmittingAttempt || isViewingHistory || !currentWord || !nextValue.trim()) {
      return;
    }

    const canAutoSubmit = type === 'round1' || type === 'round3';
    if (!canAutoSubmit) return;

    const isExactMatch = stripDiacritics(nextValue.trim().toLowerCase()) === stripDiacritics(expectedInput);
    if (!isExactMatch) return;

    const autoSubmitKey = `${type}:${currentWord.id}:${expectedInput}`;
    const autoSubmitKeyRef = type === 'round3' ? round3AutoSubmitKeyRef : round1AutoSubmitKeyRef;
    if (autoSubmitKeyRef.current === autoSubmitKey) return;

    autoSubmitKeyRef.current = autoSubmitKey;
    window.setTimeout(() => {
      void validateCurrentInput(nextValue);
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRecallRound) {
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

  const isCorrect =
    inputValue.trim().length > 0 && stripDiacritics(inputValue.trim().toLowerCase()) === stripDiacritics(expectedInput);
  const primaryPos = viewedWord.pos_tags[0] ?? '未标注';
  const allowLiveCorrectTint = type === 'round1' || type === 'round3';
  const inputIsCorrect = !isWrong && allowLiveCorrectTint && isCorrect;
  const contentAreaClassName =
    'learning-card-scrollarea flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7';
  const round1InputDockClassName =
    'shrink-0 border-t border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(247,249,253,0.94))] px-4 pt-2 pb-3 shadow-[0_-18px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:px-7 sm:pt-3 sm:pb-4 lg:px-8';
  const round1MemoryTip = preferences.memoryTipEnabled ? trimDisplayText(viewedWord.memory_tip) : '';
  const showRound1MorphologyCard = hasRound1MorphologyContent(viewedWord);
  const showRound1RelationsCard = hasRound1RelationsContent(viewedWord);
  const showRound1ContextCard = hasRound1ContextContent(viewedWord);
  const hasRound1InfoCards = showRound1MorphologyCard || showRound1RelationsCard || showRound1ContextCard;
  const displayedPhonetic = getWordPhonetic(viewedWord, audioLocale);
  const canToggleDictationPhonetic = isDictationRound && Boolean(viewedClozePrompt) && Boolean(displayedPhonetic);
  const displayedClozePhonetic = isDictationRound && !dictationPhoneticVisible ? undefined : displayedPhonetic;
  const inputContainerStyle: React.CSSProperties | undefined = inputIsCorrect
    ? {
        borderColor: 'rgba(34, 197, 94, 0.72)',
        backgroundColor: 'rgba(236, 253, 245, 0.94)',
        boxShadow: '0 12px 32px rgba(34, 197, 94, 0.16)',
      }
    : undefined;
  const round1InputStyle: React.CSSProperties | undefined =
    type === 'round1'
      ? {
          fontSize: inputValue.length > 16 ? '1.25rem' : '1.5rem',
          lineHeight: 1.15,
          color: isWrong ? '#E05A5A' : inputIsCorrect ? '#16A34A' : undefined,
          caretColor: isWrong ? '#E05A5A' : inputIsCorrect ? '#16A34A' : undefined,
        }
      : undefined;

  const inputField = (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={cx(
          'rounded-[22px] border border-white/80 bg-white/60 px-4 shadow-[0_12px_32px_rgba(14,26,56,0.06)] backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 sm:px-5',
          type === 'round1' ? 'py-[3px]' : 'py-3.5 sm:py-5',
          inputIsCorrect && 'border-[#22C55E]/35 bg-[#ECFDF5]/80 shadow-[0_12px_32px_rgba(34,197,94,0.12)]',
        )}
        style={inputContainerStyle}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInput}
          disabled={isSubmittingAttempt || isViewingHistory}
          className={cx(
            'w-full bg-transparent text-center font-black leading-none outline-none transition-colors duration-200 caret-gray-800 placeholder:text-text-secondary/35 focus-visible:!outline-none',
            type === 'round1' ? 'text-[1.5rem]' : 'text-5xl sm:text-7xl',
            isWrong ? 'text-apple-red' : inputIsCorrect ? 'text-[#16A34A] caret-[#16A34A]' : 'text-text-primary',
          )}
          style={round1InputStyle}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          placeholder={type === 'round1' ? '拼写' : clozePrompt ? '填入正确词形' : '写出英文词形'}
        />
      </div>
    </form>
  );

  const feedbackReveal = (
    <AnimatePresence>
      {showAnswer && (
        <AnswerFeedbackCard
          word={currentWord}
          clozePrompt={clozePrompt}
          isWrong={isWrong}
          wrongInput={lastWrongInput}
        />
      )}
    </AnimatePresence>
  );

  const replayControls = isDictationRound ? (
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
              ? type === 'round3'
                ? 'bg-[#2563eb] text-white shadow-[0_12px_24px_rgba(37,99,235,0.18)]'
                : 'bg-apple-blue text-white shadow-[0_12px_24px_rgba(25,200,185,0.18)]'
              : type === 'round3'
                ? 'bg-[#eaf2ff] text-[#2563eb] hover:bg-[#dbeafe]'
                : 'bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15',
          )}
        >
          {activePronunciationLocale === loc ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          再听 {loc.toUpperCase()}
        </button>
      ))}
    </div>
  ) : null;

  const phoneticToggleHideLabel = type === 'review' ? '隐藏复习轮音标' : '隐藏 Round 3 音标';
  const phoneticToggleShowLabel = type === 'review' ? '显示复习轮音标' : '显示 Round 3 音标';
  const phoneticToggleActiveClass =
    type === 'round3'
      ? 'border-[#2563eb]/18 bg-[#eaf2ff]/95 text-[#2563eb] hover:bg-[#dbeafe]'
      : 'border-apple-blue/18 bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15';
  const phoneticToggleSwitchClass = type === 'round3' ? 'bg-[#2563eb]' : 'bg-apple-blue';

  const dictationPhoneticToggle = canToggleDictationPhonetic ? (
    <button
      type="button"
      aria-pressed={dictationPhoneticVisible}
      aria-label={dictationPhoneticVisible ? phoneticToggleHideLabel : phoneticToggleShowLabel}
      title={dictationPhoneticVisible ? '隐藏音标' : '显示音标'}
      onClick={(event) => {
        event.stopPropagation();
        setDictationPhoneticVisible((visible) => !visible);
      }}
      className={cx(
        'absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black tracking-[0.12em] shadow-[0_12px_28px_rgba(14,26,56,0.08)] backdrop-blur-xl transition-all active:scale-[0.98] sm:left-5 sm:top-5',
        dictationPhoneticVisible
          ? phoneticToggleActiveClass
          : 'border-black/6 bg-white/76 text-text-secondary/70 hover:bg-white hover:text-text-secondary',
      )}
    >
      音标
      <span
        aria-hidden="true"
        className={cx(
          'inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
          dictationPhoneticVisible ? phoneticToggleSwitchClass : 'bg-black/15',
        )}
      >
        <span
          className={cx(
            'h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            dictationPhoneticVisible ? 'translate-x-3' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  ) : null;

  const submitErrorBanner = submitError ? (
    <div className="rounded-2xl bg-apple-red/10 px-4 py-3 text-sm font-medium text-apple-red">{submitError}</div>
  ) : null;

  const navigationButtonClassName =
    'flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/80 bg-white/78 text-text-primary shadow-[0_14px_34px_rgba(14,26,56,0.08)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 disabled:hover:bg-white/78';
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
  const shouldShowRound3Answer = isViewingHistory || showAnswer;
  const round3ExampleSentence = viewedWord.example_sentences[0] ?? '';
  const round3ExampleKey = `${viewedWord.id}:${viewIndex}:round3-example-0`;
  const renderWordActionMenu = (
    className = '!absolute right-3 top-3 z-30',
    ref: React.RefObject<HTMLDivElement | null> = mobileActionMenuRef,
  ) => (
    <div
      ref={ref}
      className={className}
      style={{ zIndex: 80 }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="更多操作"
        aria-expanded={isActionMenuOpen}
        onClick={() => setIsActionMenuOpen((prev) => !prev)}
        className={cx(
          'flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/85 bg-white/82 text-[#8f826d] shadow-[0_12px_26px_rgba(61,52,40,0.10)] backdrop-blur-xl transition-all active:scale-95 sm:h-12 sm:w-12',
          isActionMenuOpen && 'text-[#4f46e5] shadow-[0_14px_30px_rgba(79,70,229,0.14)]',
        )}
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={2.7} />
      </button>

      <AnimatePresence>
        {isActionMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute right-0 top-[3.25rem] z-[90] w-52 overflow-hidden rounded-[22px] border border-white/85 bg-white/92 p-1.5 text-left shadow-[0_22px_56px_rgba(61,52,40,0.18)] backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => {
                void handleMarkViewedWordMastered();
              }}
              disabled={Boolean(activeActionKind)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-apple-red transition-colors hover:bg-apple-red/8 disabled:cursor-wait disabled:opacity-60"
            >
              {activeActionKind === 'mastered' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              标记已掌握
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSaveViewedWord();
              }}
              disabled={Boolean(activeActionKind)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
            >
              {activeActionKind === 'save' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookMarked className="h-4 w-4" />
              )}
              加入个人词库
            </button>
            <button
              type="button"
              onClick={handleOpenReportSheet}
              disabled={Boolean(activeActionKind)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
            >
              <Flag className="h-4 w-4" />
              报告问题
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
  const mobileWordActionMenu = renderWordActionMenu('!absolute right-3 top-3 !z-30 sm:hidden', mobileActionMenuRef);
  const desktopWordActionMenu = renderWordActionMenu('relative z-30', desktopActionMenuRef);
  const actionFeedbackToast = (
    <AnimatePresence>
      {actionFeedback && (
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className={cx(
            'fixed bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 z-[110] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-[18px] px-4 py-3 text-sm font-black text-white shadow-[0_20px_52px_rgba(0,0,0,0.22)]',
            actionFeedback.tone === 'error' ? 'bg-apple-red' : 'bg-[#222222]',
          )}
        >
          {actionFeedback.tone === 'error' ? (
            <XCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7ddc8a]" />
          )}
          <span className="min-w-0 truncate">{actionFeedback.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
  const reportIssueSheet = (
    <AnimatePresence>
      {isReportSheetOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/18 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (activeActionKind !== 'report') {
              setIsReportSheetOpen(false);
            }
          }}
        >
          <motion.div
            initial={{ y: 24, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-full max-w-md rounded-[28px] border border-white/85 bg-white/95 p-4 shadow-[0_28px_70px_rgba(61,52,40,0.22)] backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-text-primary">报告问题</p>
                <p className="mt-0.5 truncate text-xs font-bold text-text-secondary">
                  {reportTargetWord?.word ?? viewedWord.word}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsReportSheetOpen(false)}
                disabled={activeActionKind === 'report'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-text-secondary transition-colors hover:bg-black/8 disabled:opacity-50"
                aria-label="关闭报告问题"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {VOCABULARY_ISSUE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => setReportIssueType(option.type)}
                  disabled={activeActionKind === 'report'}
                  className={cx(
                    'min-h-10 rounded-[15px] px-3 text-sm font-black transition-all disabled:opacity-60',
                    reportIssueType === option.type
                      ? 'bg-[#4f46e5] text-white shadow-[0_12px_26px_rgba(79,70,229,0.18)]'
                      : 'bg-black/5 text-text-primary hover:bg-black/8',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <textarea
              value={reportNote}
              onChange={(event) => setReportNote(event.target.value.slice(0, 1000))}
              disabled={activeActionKind === 'report'}
              rows={4}
              className="mt-3 w-full resize-none rounded-[18px] border border-black/8 bg-white/75 px-3 py-3 text-sm font-bold leading-6 text-text-primary outline-none transition-colors placeholder:text-text-secondary/50 focus:border-[#4f46e5]/35 disabled:opacity-60"
              placeholder="哪里不对？可选"
            />

            <button
              type="button"
              onClick={() => {
                void handleSubmitReport();
              }}
              disabled={activeActionKind === 'report'}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-[#4f46e5] px-4 text-sm font-black text-white shadow-[0_16px_34px_rgba(79,70,229,0.20)] transition-all active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              {activeActionKind === 'report' && <Loader2 className="h-4 w-4 animate-spin" />}
              提交
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (type === 'round2') {
    return (
      <div className="relative w-full max-w-4xl mx-auto flex h-full min-h-0 flex-col items-center">
        {renderWordActionMenu('!absolute right-3 top-12 z-30', round3ActionMenuRef)}
        {actionFeedbackToast}
        {reportIssueSheet}
        <div className="flex w-full max-w-3xl items-center gap-2">
          {sessionLeadingAction && <div className="shrink-0 lg:hidden">{sessionLeadingAction}</div>}
          <RoundIndicator type={type} className="min-w-0 flex-1" />
          {sessionActions}
        </div>
        <div className="grid w-full flex-1 min-h-0 grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3">
          <div className="hidden items-center sm:flex">{leftNavigationButton}</div>

          <motion.div
            key={`${viewedWord.id}:${viewIndex}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onTouchStart={handleCardTouchStart}
            onTouchEnd={handleCardTouchEnd}
            onTouchCancel={() => {
              swipeStartRef.current = null;
            }}
            style={{ touchAction: 'pan-y' }}
            className="w-full flex min-h-0 flex-col items-center justify-center py-6 sm:min-h-[500px]"
          >
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="flex items-center gap-2 mb-8"
            >
              <span className="bg-[#0ea5e9] text-white px-4 py-1 rounded-lg text-sm font-bold shadow-[0_8px_18px_rgba(14,165,233,0.18)]">
                {displayedPhonetic}
              </span>
              {(['uk', 'us'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => {
                    setAudioLocale(loc);
                    void playAudioSequence(viewedWord, loc, 1, 0);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                    audioLocale === loc
                      ? 'bg-[#0ea5e9] text-white shadow-[0_8px_18px_rgba(14,165,233,0.16)]'
                      : 'bg-[#e0f2fe] text-[#0284c7] hover:bg-[#bae6fd]'
                  }`}
                >
                  {activePronunciationLocale === loc ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Volume2 className="w-3 h-3" />
                  )}
                  {loc.toUpperCase()}
                </button>
              ))}
            </motion.div>

            <div className="mb-4 max-w-full text-center text-6xl font-black leading-tight text-text-primary sm:text-7xl [overflow-wrap:anywhere]">
              {viewedWord.word}
            </div>
            <div className="text-sm font-bold text-text-secondary uppercase tracking-widest mb-8">
              {viewedWord.pos_tags[0]}
            </div>

            {hasRound2ChoiceOptions ? (
              <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                {round2ChoiceOptions.map((option) => {
                  const isSelected = activeRound2ChoiceSelection?.optionId === option.id;
                  const isWrongSelection = isRound2ChoiceRevealed && isSelected && !option.isCorrect;
                  const label = formatClozeWordInfo(option.pos, option.meaningZh) || option.meaningZh || option.word;
                  const displayLabel = isRound2ChoiceRevealed ? `${label}：${option.word}` : label;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleRound2ChoiceSelect(option)}
                      disabled={isViewingHistory || Boolean(activeRound2ChoiceSelection)}
                      aria-label={`Round2 选项 ${displayLabel}`}
                      className={cx(
                        'flex min-h-[5rem] w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-base font-black leading-7 shadow-[0_14px_34px_rgba(14,26,56,0.06)] transition-all active:scale-[0.99] disabled:cursor-default sm:px-5',
                        !isRound2ChoiceRevealed &&
                          'border-white/80 bg-white/78 text-text-primary hover:-translate-y-0.5 hover:bg-white',
                        isRound2ChoiceRevealed &&
                          option.isCorrect &&
                          'border-[#16A34A]/25 bg-[#ECFDF5] text-[#15803D] shadow-[0_14px_34px_rgba(22,163,74,0.12)]',
                        isWrongSelection &&
                          'border-apple-red/30 bg-apple-red/10 text-apple-red shadow-[0_14px_34px_rgba(224,90,90,0.12)]',
                        isRound2ChoiceRevealed &&
                          !option.isCorrect &&
                          !isWrongSelection &&
                          'border-white/70 bg-white/58 text-text-secondary/70',
                      )}
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">{displayLabel}</span>
                      {isRound2ChoiceRevealed && option.isCorrect && <CheckCircle2 className="h-5 w-5 shrink-0" />}
                      {isWrongSelection && <XCircle className="h-5 w-5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <AnimatePresence>
                  {shouldShowRound3Answer && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-4 text-center"
                    >
                      <div className="[&_span]:bg-black/5">
                        <WordSenseList word={viewedWord} centered />
                      </div>
                      {round3ExampleSentence && (
                        <div className="mx-auto mt-4 w-full max-w-xl">
                          <ExampleSentenceList
                            items={[
                              {
                                key: round3ExampleKey,
                                sentence: round3ExampleSentence,
                              },
                            ]}
                            locale={audioLocale}
                            activeExampleKey={activeExampleKey}
                            canPlayAudio={canPlayExampleAudio}
                            onPlayExample={({ sentence, key }) => {
                              void playExampleSentence(sentence, key);
                            }}
                            emptyMessage="这个词目前还没有例句。"
                            variant="inline"
                          />
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {!shouldShowRound3Answer && (
                  <p className="text-text-secondary/40 text-sm mt-8">先自己判断，再决定要不要展开答案。</p>
                )}
              </>
            )}

            {hasRound2ChoiceOptions && !isRound2ChoiceRevealed && (
              <p className="text-text-secondary/40 text-sm mt-8">选择最贴近的中文释义。</p>
            )}
          </motion.div>

          <div className="hidden items-center sm:flex">{rightNavigationButton}</div>
        </div>

        {renderProgressBar(displayProgressIndex, progressQueueLength)}

        <div className="w-full max-w-3xl space-y-3 px-4 pb-4 sm:pb-8">
          {submitErrorBanner}
          {hasRound2ChoiceOptions ? (
            <>
              {activeRound2ChoiceSelection && !isViewingHistory && (
                <button
                  type="button"
                  onClick={handleRound3PrimaryAction}
                  disabled={isSubmittingAttempt}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0ea5e9] px-5 py-4 font-bold text-white shadow-[0_16px_34px_rgba(14,165,233,0.22)] transition-all hover:scale-[1.01] hover:bg-[#0284c7] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-[#0ea5e9]"
                >
                  继续下一个词
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
              {isViewingHistory && (
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-[#0ea5e9] px-5 py-4 font-bold text-white opacity-50"
                >
                  回看中
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            </>
          ) : (
            <div
              className={cx(
                'grid gap-3',
                showAnswer && !isViewingHistory ? 'sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]' : 'grid-cols-1',
              )}
            >
              {showAnswer && !isViewingHistory && (
                <button
                  type="button"
                  onClick={() => {
                    void handleRound3Unknown();
                  }}
                  disabled={isSubmittingAttempt}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-apple-red/20 bg-apple-red/10 px-5 py-4 font-bold text-apple-red transition-all hover:scale-[1.01] hover:bg-apple-red/15 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                >
                  {isSubmittingAttempt ? <Loader2 className="h-5 w-5 animate-spin" /> : <XCircle className="h-5 w-5" />}
                  不认识
                </button>
              )}
              <button
                type="button"
                onClick={handleRound3PrimaryAction}
                disabled={isViewingHistory || isSubmittingAttempt}
                className="w-full py-4 bg-[#0ea5e9] text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-[0_16px_34px_rgba(14,165,233,0.22)] hover:scale-[1.01] hover:bg-[#0284c7] active:scale-[0.99] transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-[#0ea5e9]"
              >
                {isViewingHistory
                  ? '回看中'
                  : isSubmittingAttempt
                    ? '正在写回…'
                    : showAnswer
                      ? '继续下一个词'
                      : '展开释义'}
                {isSubmittingAttempt ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {actionFeedbackToast}
      {reportIssueSheet}
      <InputSessionShell
        type={type}
        currentIndex={displayProgressIndex}
        queueLength={progressQueueLength}
        sessionLeadingAction={sessionLeadingAction}
        sessionActions={sessionActions}
        main={
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
            <div className="hidden items-center sm:flex">{leftNavigationButton}</div>
            <motion.div
              key={`${viewedWord.id}:${viewIndex}`}
              initial={{ opacity: 0, scale: 0.97, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              onTouchStart={handleCardTouchStart}
              onTouchEnd={handleCardTouchEnd}
              onTouchCancel={() => {
                swipeStartRef.current = null;
              }}
              style={{ touchAction: 'pan-y' }}
              className="glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] shadow-[0_24px_64px_rgba(14,26,56,0.08)] sm:rounded-[30px]"
            >
              {mobileWordActionMenu}
              {type === 'round1' ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className={cx(contentAreaClassName, 'pb-4 sm:pb-5')}>
                    <div className="space-y-3 sm:space-y-4">
                      <div
                        className={cx(
                          'grid gap-3 lg:items-start lg:gap-8',
                          round1MemoryTip ? 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,30vw)]' : 'lg:grid-cols-1',
                        )}
                      >
                        <div className="min-w-0 space-y-3 sm:space-y-4">
                          <PronunciationControls
                            phonetic={displayedPhonetic}
                            audioLocale={audioLocale}
                            activePronunciationLocale={activePronunciationLocale}
                            size="small"
                            onPlay={(locale) => {
                              setAudioLocale(locale);
                              void playAudioSequence(viewedWord, locale, 1, 0);
                            }}
                          />

                          <div
                            className={cx(
                              'flex min-w-0 flex-col gap-2',
                              round1MemoryTip
                                ? '2xl:flex-row 2xl:items-start 2xl:gap-6'
                                : 'lg:flex-row lg:items-start lg:gap-6',
                            )}
                          >
                            <div className={cx('min-w-0', round1MemoryTip ? '2xl:flex-shrink-0' : 'lg:flex-shrink-0')}>
                              <p className="max-w-full text-[clamp(1.296rem,7.2vw,3.024rem)] font-black leading-tight tracking-tight text-text-primary [overflow-wrap:anywhere]">
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
                                      className="rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4f46e5]"
                                    >
                                      专有名词 · {entity.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div
                              className={cx(
                                'min-w-0',
                                round1MemoryTip
                                  ? '2xl:min-w-[18rem] 2xl:max-w-[680px] 2xl:flex-1 2xl:pt-1'
                                  : 'lg:min-w-[18rem] lg:max-w-[680px] lg:flex-1 lg:pt-1',
                              )}
                            >
                              <WordSenseList word={viewedWord} size="small" />
                            </div>
                          </div>
                        </div>

                        {round1MemoryTip && (
                          <div className="flex justify-end">
                            <Round1MemoryTipCard
                              memoryTip={round1MemoryTip}
                              targetWords={lookupTargetWords}
                              onWordClick={openPopover}
                            />
                          </div>
                        )}
                      </div>

                      {hasRound1InfoCards && (
                        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]">
                          {showRound1MorphologyCard && (
                            <Round1MorphologyCard
                              word={viewedWord}
                              targetWords={lookupTargetWords}
                              onWordClick={openPopover}
                            />
                          )}
                          {showRound1RelationsCard && (
                            <Round1RelationsCard
                              word={viewedWord}
                              targetWords={lookupTargetWords}
                              onWordClick={openPopover}
                            />
                          )}
                          {showRound1ContextCard && (
                            <Round1ConfusingCard
                              word={viewedWord}
                              activeExampleKey={activeExampleKey}
                              canPlayExampleAudio={canPlayExampleAudio}
                              exampleLocale={audioLocale}
                              onPlayExample={(sentence, key) => {
                                void playExampleSentence(sentence, key);
                              }}
                              targetWords={lookupTargetWords}
                              onWordClick={openPopover}
                            />
                          )}
                        </div>
                      )}
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
                          <div className="min-w-0">{inputField}</div>
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
                  {dictationPhoneticToggle}
                  <div className={cx(contentAreaClassName, 'py-8')}>
                    <div className="flex min-h-full flex-col justify-center text-center">
                      {replayControls}
                      {viewedClozePrompt ? (
                        <Round2ClozePrompt
                          prompt={viewedClozePrompt}
                          inputValue={displayedInputValue}
                          phonetic={displayedClozePhonetic}
                          targetWords={lookupTargetWords}
                          onWordClick={openPopover}
                          canPlaySentenceAudio={canPlayExampleAudio && Boolean(viewedClozeFullSentence)}
                          isSentencePlaying={activeExampleKey === viewedClozeSentenceAudioKey}
                          sentenceAudioLocale={audioLocale}
                          wordInfoText={viewedClozeWordInfoText}
                          onPlaySentence={() => {
                            if (!viewedClozeFullSentence || !viewedClozeSentenceAudioKey) return;
                            void playExampleSentence(viewedClozeFullSentence, viewedClozeSentenceAudioKey);
                          }}
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
                          <div
                            className={cx(
                              'mt-7 inline-flex items-baseline gap-1.5 rounded-md px-4 py-2 text-2xl md:text-3xl',
                              type === 'round3' ? 'bg-[#eaf2ff] text-[#2563eb]' : 'bg-apple-blue/10 text-apple-blue/80',
                            )}
                          >
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
                          <AnswerFeedbackCard word={viewedWord} clozePrompt={viewedClozePrompt} />
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
            <div className="relative z-[70] hidden items-center justify-center sm:flex">
              <div className="absolute left-1/2 top-3 z-[80] -translate-x-1/2">{desktopWordActionMenu}</div>
              {rightNavigationButton}
            </div>
          </div>
        }
      />
    </>
  );
};
