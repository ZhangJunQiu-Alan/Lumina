import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  getWordPhonetic,
  LearningRoundType,
  PersistedLearningSession,
  ReviewAttemptSource,
  RoundType,
  Word,
} from '../../types';
import { useLearningPreferences } from '../../contexts/LearningPreferencesContext';
import { useSavedWords } from '../../contexts/SavedWordsContext';
import { useWordPopover } from '../../contexts/WordPopoverContext';
import { isBrowserSpeechSupported } from '../../lib/browserSpeech';
import { preloadRound1CardResources } from '../../lib/round1Preload';
import { preloadRound2CardResources } from '../../lib/round2Preload';
import { cx } from '../shared/LearningUI';
import { buildClozePrompt } from '../../lib/cloze';
import { useLearningAudio } from './hooks/useLearningAudio';
import { Round1View } from './views/Round1View';
import {
  type Round2ChoiceOption,
  type Round2ChoiceSelection,
} from './views/Round2ChoiceView';
import { DictationRecallView } from './views/DictationRecallView';
import { Round2View } from './views/Round2View';
import { ActionFeedbackToast, ReportIssueSheet, WordActionMenu } from './views/LearningOverlays';

import { attemptBuffer } from '../../lib/attemptBuffer';
import { readLocal, writeLocal } from '../../lib/durableStorage';
import type { ReviewRecovery } from '../../lib/learningRecovery';
import { markReviewWordMastered, markReviewWordUnknown } from '../../lib/reviewApi';
import { reportVocabularyIssue, type VocabularyIssueType } from '../../lib/vocabReportApi';
import {
  ActionFeedback,
  formatClozeWordInfo,
  getWrongAnswerRequeueIndex,
  hasRound1ContextContent,
  hasRound1MorphologyContent,
  hasRound1RelationsContent,
  isTextEditingTarget,
  SessionActionKind,
  stripDiacritics,
  trimDisplayText,
} from './learningEngineUtils';
import {
  InputSessionShell,
} from './Round1Cards';
import { ROUND1_REINFORCEMENT_WORD_LIMIT } from '../../../shared/learningProgress';

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
  return [...new Set(queue.map((word) => word.id).filter((wordId) => confirmedSet.has(wordId)))];
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
      (initialSession?.round1ConfirmedWordIds?.length
        ? initialSession.round1ConfirmedWordIds
        : type === 'round1'
          ? [...initialCompletedIds]
          : []
      ).filter((wordId) => wordMap.has(wordId)),
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

  const initialUniqueCount = useMemo(() => {
    const queueWordIds = new Set(initialEngineState.queue.map((word) => word.id));
    return Math.max(queueWordIds.size, 1);
  }, [initialEngineState.queue]);
  const round1ProgressTarget =
    type === 'round1'
      ? round1CanWaitForMoreWords
        ? ROUND1_REINFORCEMENT_WORD_LIMIT
        : initialUniqueCount
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

  const canPlayExampleAudio = useMemo(() => typeof Audio !== 'undefined' || isBrowserSpeechSupported(), []);
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
  const answerRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctReadbackTokenRef = useRef<symbol | null>(null);
  const lastRound1PreloadKeyRef = useRef<string | null>(null);
  const lastRound2PreloadKeyRef = useRef<string | null>(null);
  const lastSessionSnapshotSignatureRef = useRef<string | null>(null);
  const round1CompletionInFlightRef = useRef(false);
  const round3AutoSubmitKeyRef = useRef<string | null>(null);
  const round1SubmittedInputKeyRef = useRef<string | null>(null);
  const preferencesRef = useRef(preferences);

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
  const {
    audioLocale,
    setAudioLocale,
    activePronunciationLocale,
    activeExampleKey,
    stopPlayback,
    playAudioSequence,
    playExampleSentence,
  } = useLearningAudio({
    currentWord,
    canPlayExampleAudio,
  });
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
  const clearAnswerRevealTimeout = useCallback(() => {
    correctReadbackTokenRef.current = null;
    if (answerRevealTimeoutRef.current === null) return;
    clearTimeout(answerRevealTimeoutRef.current);
    answerRevealTimeoutRef.current = null;
  }, []);


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
          text: '加入个人词库失败，请稍后重试。',
        });
        return;
      }

      showSessionActionFeedback({
        tone: 'success',
        text: result.inserted === false ? '已在个人词库中' : `已加入个人词库 ${viewedWord.word}`,
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

          if (round1CanWaitForMoreWords && nextConfirmedWordIds.length >= ROUND1_REINFORCEMENT_WORD_LIMIT) {
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

    const canAutoSubmit = type === 'round3';
    if (!canAutoSubmit) return;

    const isExactMatch = stripDiacritics(nextValue.trim().toLowerCase()) === stripDiacritics(expectedInput);
    if (!isExactMatch) return;

    const autoSubmitKey = `${type}:${currentWord.id}:${expectedInput}`;
    const autoSubmitKeyRef = round3AutoSubmitKeyRef;
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
  if (type === 'round2') {
    return (
      <Round2View
        viewedWord={viewedWord}
        viewIndex={viewIndex}
        audioLocale={audioLocale}
        activePronunciationLocale={activePronunciationLocale}
        displayedPhonetic={displayedPhonetic}
        onPlayAudio={(loc) => {
          setAudioLocale(loc);
          void playAudioSequence(viewedWord, loc, 1, 0);
        }}
        canPlayExampleAudio={canPlayExampleAudio}
        activeExampleKey={activeExampleKey}
        onPlayExampleSentence={(sentence, key) => {
          void playExampleSentence(sentence, key);
        }}
        hasRound2ChoiceOptions={hasRound2ChoiceOptions}
        round2ChoiceOptions={round2ChoiceOptions}
        activeRound2ChoiceSelection={activeRound2ChoiceSelection}
        isRound2ChoiceRevealed={isRound2ChoiceRevealed}
        isViewingHistory={isViewingHistory}
        onSelectRound2Choice={handleRound2ChoiceSelect}
        shouldShowRound3Answer={shouldShowRound3Answer}
        round3ExampleSentence={round3ExampleSentence}
        round3ExampleKey={round3ExampleKey}
        showAnswer={showAnswer}
        isSubmittingAttempt={isSubmittingAttempt}
        submitErrorBanner={submitErrorBanner}
        onRound3PrimaryAction={handleRound3PrimaryAction}
        onRound3Unknown={() => {
          void handleRound3Unknown();
        }}
        onCardTouchStart={handleCardTouchStart}
        onCardTouchEnd={handleCardTouchEnd}
        onCardTouchCancel={() => {
          swipeStartRef.current = null;
        }}
        sessionLeadingAction={sessionLeadingAction}
        sessionActions={sessionActions}
        displayProgressIndex={displayProgressIndex}
        progressQueueLength={progressQueueLength}
        leftNavigationButton={leftNavigationButton}
        rightNavigationButton={rightNavigationButton}
        wordActionMenu={
          <WordActionMenu
            isOpen={isActionMenuOpen}
            onToggle={() => setIsActionMenuOpen((prev) => !prev)}
            onMarkMastered={() => {
              void handleMarkViewedWordMastered();
            }}
            onSaveWord={() => {
              void handleSaveViewedWord();
            }}
            onOpenReportSheet={handleOpenReportSheet}
            activeActionKind={activeActionKind}
            className="!absolute right-3 top-12 z-30"
            menuRef={round3ActionMenuRef}
          />
        }
        actionFeedbackToast={<ActionFeedbackToast feedback={actionFeedback} />}
        reportIssueSheet={
          <ReportIssueSheet
            isOpen={isReportSheetOpen}
            onClose={() => setIsReportSheetOpen(false)}
            targetWordName={reportTargetWord?.word ?? viewedWord.word}
            issueType={reportIssueType}
            onSelectIssueType={setReportIssueType}
            note={reportNote}
            onChangeNote={setReportNote}
            activeActionKind={activeActionKind}
            onSubmit={() => {
              void handleSubmitReport();
            }}
          />
        }
      />
    );
  }

  return (
    <>
      <ActionFeedbackToast feedback={actionFeedback} />
      <ReportIssueSheet
        isOpen={isReportSheetOpen}
        onClose={() => setIsReportSheetOpen(false)}
        targetWordName={reportTargetWord?.word ?? viewedWord.word}
        issueType={reportIssueType}
        onSelectIssueType={setReportIssueType}
        note={reportNote}
        onChangeNote={setReportNote}
        activeActionKind={activeActionKind}
        onSubmit={() => {
          void handleSubmitReport();
        }}
      />
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
              <WordActionMenu
                isOpen={isActionMenuOpen}
                onToggle={() => setIsActionMenuOpen((prev) => !prev)}
                onMarkMastered={() => {
                  void handleMarkViewedWordMastered();
                }}
                onSaveWord={() => {
                  void handleSaveViewedWord();
                }}
                onOpenReportSheet={handleOpenReportSheet}
                activeActionKind={activeActionKind}
                className="!absolute right-3 top-3 !z-30 sm:hidden"
                menuRef={mobileActionMenuRef}
              />
              {type === 'round1' ? (
                <Round1View
                  viewedWord={viewedWord}
                  displayedPhonetic={displayedPhonetic}
                  audioLocale={audioLocale}
                  activePronunciationLocale={activePronunciationLocale}
                  onPlayAudio={(locale) => {
                    setAudioLocale(locale);
                    void playAudioSequence(viewedWord, locale, 1, 0);
                  }}
                  lookupTargetWords={lookupTargetWords}
                  openPopover={openPopover}
                  round1MemoryTip={round1MemoryTip}
                  hasRound1InfoCards={hasRound1InfoCards}
                  showRound1MorphologyCard={showRound1MorphologyCard}
                  showRound1RelationsCard={showRound1RelationsCard}
                  showRound1ContextCard={showRound1ContextCard}
                  activeExampleKey={activeExampleKey}
                  canPlayExampleAudio={canPlayExampleAudio}
                  onPlayExampleSentence={(sentence, key) => {
                    void playExampleSentence(sentence, key);
                  }}
                  isViewingHistory={isViewingHistory}
                  contentAreaClassName={contentAreaClassName}
                  round1InputDockClassName={round1InputDockClassName}
                  inputField={inputField}
                  submitErrorBanner={submitErrorBanner}
                />
              ) : (
                <DictationRecallView
                  type={type}
                  viewedWord={viewedWord}
                  currentWord={currentWord}
                  viewedClozePrompt={viewedClozePrompt}
                  clozePrompt={clozePrompt}
                  viewedClozeFullSentence={viewedClozeFullSentence}
                  viewedClozeSentenceAudioKey={viewedClozeSentenceAudioKey}
                  viewedClozeWordInfoText={viewedClozeWordInfoText}
                  displayedInputValue={displayedInputValue}
                  displayedClozePhonetic={displayedClozePhonetic}
                  viewedExpectedInput={viewedExpectedInput}
                  lookupTargetWords={lookupTargetWords}
                  openPopover={openPopover}
                  canPlayExampleAudio={canPlayExampleAudio}
                  activeExampleKey={activeExampleKey}
                  audioLocale={audioLocale}
                  activePronunciationLocale={activePronunciationLocale}
                  onPlayAudioLocale={(loc) => {
                    setAudioLocale(loc);
                    void playAudioSequence(viewedWord, loc, 1, 0);
                  }}
                  onPlayExampleSentence={(sentence, key) => {
                    void playExampleSentence(sentence, key);
                  }}
                  primaryPos={primaryPos}
                  isViewingHistory={isViewingHistory}
                  showAnswer={showAnswer}
                  isWrong={isWrong}
                  lastWrongInput={lastWrongInput ?? ''}
                  canToggleDictationPhonetic={canToggleDictationPhonetic}
                  dictationPhoneticVisible={dictationPhoneticVisible}
                  onToggleDictationPhonetic={() => setDictationPhoneticVisible((visible) => !visible)}
                  contentAreaClassName={contentAreaClassName}
                  inputRef={inputRef}
                  inputValue={inputValue}
                  onInput={handleInput}
                  onSubmit={handleSubmit}
                  isSubmittingAttempt={isSubmittingAttempt}
                  expectedInputLength={expectedInput.length}
                  submitErrorBanner={submitErrorBanner}
                />
              )}
            </motion.div>
            <div className="relative z-[70] hidden items-center justify-center sm:flex">
              <div className="absolute left-1/2 top-3 z-[80] -translate-x-1/2">
                <WordActionMenu
                  isOpen={isActionMenuOpen}
                  onToggle={() => setIsActionMenuOpen((prev) => !prev)}
                  onMarkMastered={() => {
                    void handleMarkViewedWordMastered();
                  }}
                  onSaveWord={() => {
                    void handleSaveViewedWord();
                  }}
                  onOpenReportSheet={handleOpenReportSheet}
                  activeActionKind={activeActionKind}
                  className="relative z-30"
                  menuRef={desktopActionMenuRef}
                />
              </div>
              {rightNavigationButton}
            </div>
          </div>
        }
      />
    </>
  );
};
