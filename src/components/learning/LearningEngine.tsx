import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookMarked, CheckCircle2, ChevronLeft, ChevronRight, Flag, Loader2, MoreHorizontal, Volume2, X, XCircle } from 'lucide-react';
import { 
  getWordPhonetic,
  LearningRoundType, 
  PersistedLearningSession, 
  PronunciationLocale, 
  ReviewAttemptSource, 
  RoundType, 
  Word 
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
import {
  cx,
  PronunciationControls,
  RoundIndicator,
  SessionProgress,
  WordSenseList
} from '../shared/LearningUI';
import { ClickableText, type WordClickHandler } from '../shared/ClickableText';
import { buildClozePrompt, type ClozePrompt } from '../../lib/cloze';
import { Round2ClozePrompt } from './Round2ClozePrompt';
import { attemptBuffer } from '../../lib/attemptBuffer';
import { markReviewWordMastered, markReviewWordUnknown } from '../../lib/reviewApi';
import { reportVocabularyIssue, type VocabularyIssueType } from '../../lib/vocabReportApi';

// --- Sub-components for Round 1 ---

export interface LearningSessionSnapshot {
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
  passedQueueIndices: number[];
  round1ConfirmedWordIds: string[];
}

type Round1LookupProps = {
  targetWords?: ReadonlySet<string>;
  onWordClick?: WordClickHandler;
};

const trimDisplayText = (value: string | null | undefined) => value?.trim() ?? '';

const hasDisplayText = (value: string | null | undefined) => trimDisplayText(value).length > 0;

const hasRound1WordItems = (items: readonly { word: string }[]) => (
  items.some((item) => hasDisplayText(item.word))
);

const getRound1WordItems = <T extends { word: string }>(items: readonly T[], limit?: number) => {
  const visibleItems = items.filter((item) => hasDisplayText(item.word));
  return typeof limit === 'number' ? visibleItems.slice(0, limit) : visibleItems;
};

const getRelationDetailText = (item: { meaningZh?: string; noteZh?: string }) => (
  [trimDisplayText(item.meaningZh), trimDisplayText(item.noteZh)].filter(Boolean).join(' · ')
);

const round1RelationWordClassName = 'text-base sm:text-[18px] font-black text-text-primary [overflow-wrap:anywhere]';
const round1RelationDetailClassName = 'mt-1.5 text-[13px] sm:text-[15px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]';

const getRound1ExampleItems = (word: Word) => (
  word.senses
    .filter((sense) => hasDisplayText(sense.example_sentence))
    .slice(0, 2)
    .map((sense, index) => ({
      key: `${word.id}-example-${index}`,
      sentence: trimDisplayText(sense.example_sentence),
      translation: hasDisplayText(sense.example_translation_zh)
        ? trimDisplayText(sense.example_translation_zh)
        : undefined,
    }))
);

const AnswerFeedbackCard = ({
  word,
  clozePrompt,
  isWrong = false,
  wrongInput = null,
}: {
  word: Word;
  clozePrompt: ClozePrompt | null;
  isWrong?: boolean;
  wrongInput?: string | null;
}) => (
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
              {clozePrompt ? clozePrompt.expectedForm : word.word}
            </p>
            {clozePrompt && clozePrompt.expectedForm !== clozePrompt.baseForm && (
              <p className="text-xs font-medium opacity-70">原型 · {clozePrompt.baseForm}</p>
            )}
            {isWrong && wrongInput && (
              <p className="text-sm font-medium line-through opacity-60">
                你刚才写的是：{wrongInput}
              </p>
            )}
          </div>
        </div>
        <div className="[&_p]:text-white [&_span]:bg-white/16 [&_span]:text-white/90">
          <WordSenseList word={word} compact />
        </div>
      </div>
    </div>
  </motion.div>
);

const hasRound1Examples = (word: Word) => (
  word.senses.some((sense) => hasDisplayText(sense.example_sentence))
);

const hasRound1MorphologyContent = (word: Word) => (
  hasDisplayText(word.morphology.summaryZh) || hasRound1WordItems(word.derivedWords)
);

const hasRound1RelationsContent = (word: Word) => (
  hasRound1WordItems(word.synonyms) || hasRound1WordItems(word.antonyms)
);

const hasRound1ContextContent = (word: Word) => (
  hasRound1WordItems(word.confusingPairs) || hasRound1Examples(word)
);

const Round1LookupText = ({
  text,
  targetWords,
  onWordClick,
  targetClassName,
}: {
  text: string;
  targetClassName?: string;
} & Round1LookupProps) => (
  onWordClick ? (
    <ClickableText
      text={text}
      targetWords={targetWords}
      onWordClick={onWordClick}
      stopPropagation
      targetClassName={targetClassName}
    />
  ) : (
    <>{text}</>
  )
);

const Round1MorphologyCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => {
  const morphologySummary = trimDisplayText(word.morphology.summaryZh);
  const derivedWords = getRound1WordItems(word.derivedWords);
  const title = '单词拆解';

  if (!morphologySummary && derivedWords.length === 0) return null;

  return (
    <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">{title}</p>
      {morphologySummary && (
        <div className="mt-2 rounded-[16px] border border-white/85 bg-white/75 px-3 py-2 sm:mt-3 sm:rounded-[18px] sm:px-4 sm:py-3">
          <p className="text-sm sm:text-[15px] leading-7 text-text-primary">
            <Round1LookupText text={morphologySummary} targetWords={targetWords} onWordClick={onWordClick} />
          </p>
        </div>
      )}

      {derivedWords.length > 0 && (
        <div className={morphologySummary ? 'mt-4' : 'mt-3'}>
          <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">派生词</p>
          <div className="mt-2 sm:mt-3 space-y-2">
            {derivedWords.map((item) => {
              const itemWord = trimDisplayText(item.word);
              const detailText = getRelationDetailText(item);

              return (
                <div
                  key={`${word.id}-derived-${itemWord}`}
                  className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                >
                  <p className="text-base sm:text-[18px] font-black text-text-primary">
                    <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                  </p>
                  {detailText && (
                    <p className="mt-1.5 text-[13px] sm:text-[15px] leading-relaxed text-text-secondary">
                      <Round1LookupText
                        text={detailText}
                        targetWords={targetWords}
                        onWordClick={onWordClick}
                      />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

const Round1RelationsCard = ({ word, targetWords, onWordClick }: { word: Word } & Round1LookupProps) => {
  const synonyms = getRound1WordItems(word.synonyms, 2);
  const antonyms = getRound1WordItems(word.antonyms, 2);

  if (synonyms.length === 0 && antonyms.length === 0) return null;

  return (
    <section className="h-full min-w-0 rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <div className={cx('grid min-w-0 gap-4', synonyms.length > 0 && antonyms.length > 0 ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'sm:grid-cols-1')}>
        {synonyms.length > 0 && (
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">近义词</p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {synonyms.map((item) => {
                const itemWord = trimDisplayText(item.word);
                const detailText = getRelationDetailText(item);

                return (
                  <div
                    key={`${word.id}-synonym-${itemWord}`}
                    className="min-w-0 rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    <p className={round1RelationWordClassName}>
                      <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                    </p>
                    {detailText && (
                      <p className={round1RelationDetailClassName}>
                        <Round1LookupText
                          text={detailText}
                          targetWords={targetWords}
                          onWordClick={onWordClick}
                        />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {antonyms.length > 0 && (
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">反义词</p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {antonyms.map((item) => {
                const itemWord = trimDisplayText(item.word);
                const detailText = getRelationDetailText(item);

                return (
                  <div
                    key={`${word.id}-antonym-${itemWord}`}
                    className="min-w-0 rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    <p className={round1RelationWordClassName}>
                      <Round1LookupText text={itemWord} targetWords={targetWords} onWordClick={onWordClick} />
                    </p>
                    {detailText && (
                      <p className={round1RelationDetailClassName}>
                        <Round1LookupText
                          text={detailText}
                          targetWords={targetWords}
                          onWordClick={onWordClick}
                        />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

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
} & Round1LookupProps) => {
  const confusingPairs = getRound1WordItems(word.confusingPairs);
  const confusingPairsWithDifference = confusingPairs.filter((pair) => hasDisplayText(pair.difference));
  const exampleItems = getRound1ExampleItems(word);
  const currentWordKey = word.word.trim().toLowerCase();

  if (confusingPairsWithDifference.length === 0 && exampleItems.length === 0) return null;

  return (
    <section className="h-full rounded-[24px] border border-white/80 bg-white/60 p-4 sm:p-5 shadow-[0_14px_32px_rgba(14,26,56,0.05)] backdrop-blur-xl">
      <div className="space-y-4 sm:space-y-5">
        {confusingPairsWithDifference.length > 0 && (
          <div>
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.24em] text-text-secondary">易混词义对比</p>
            <div className="mt-2 sm:mt-3 space-y-2">
              {confusingPairsWithDifference.map((pair, index) => {
                const pairWord = trimDisplayText(pair.word);
                const difference = trimDisplayText(pair.difference);
                const comparisonWords = new Set([currentWordKey, pairWord.toLowerCase()].filter(Boolean));

                return (
                  <div
                    key={`${word.id}-confusion-${pairWord}-${index}`}
                    className="rounded-[16px] sm:rounded-[18px] border border-white/85 bg-white/75 px-3 py-2 sm:px-4 sm:py-3"
                  >
                    {difference && (
                      <p className="text-[13px] sm:text-[16px] leading-relaxed text-text-secondary">
                        <Round1LookupText
                          text={difference}
                          targetWords={comparisonWords}
                          onWordClick={onWordClick}
                          targetClassName="bg-transparent text-lg font-black text-text-primary hover:bg-[#eaf2ff] sm:text-xl"
                        />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {exampleItems.length > 0 && (
          <div className={cx(confusingPairsWithDifference.length > 0 && 'border-t border-black/6 pt-4 sm:pt-5')}>
            <p className="text-[12px] sm:text-[14px] font-bold uppercase tracking-[0.22em] text-text-secondary">例句</p>
            <div className="mt-2">
              <ExampleSentenceList
                items={exampleItems}
                locale={exampleLocale}
                activeExampleKey={activeExampleKey}
                canPlayAudio={canPlayExampleAudio}
                onPlayExample={({ sentence, key }) => { onPlayExample(sentence, key); }}
                emptyMessage=""
                targetWords={targetWords}
                onWordClick={onWordClick}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const Round1MemoryTipCard = ({ memoryTip, targetWords, onWordClick }: { memoryTip: string } & Round1LookupProps) => (
  <aside className="flex min-h-[92px] rounded-[18px] border border-[#4f46e5]/15 bg-[#eef2ff] px-4 py-3 sm:px-5 sm:py-4 lg:min-h-[88px] lg:max-h-[132px] lg:w-full lg:max-w-[430px] lg:self-start lg:overflow-y-auto">
    <div className="my-auto min-w-0">
      <p className="text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.22em] text-[#4f46e5]">
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
  sessionLeadingAction,
  sessionActions,
  main,
}: {
  type: RoundType;
  currentIndex: number;
  queueLength: number;
  sessionLeadingAction?: React.ReactNode;
  sessionActions?: React.ReactNode;
  main: React.ReactNode;
}) => (
  <div className="input-session-shell mx-auto flex h-full min-h-0 w-full max-w-[1400px] flex-col gap-3 sm:gap-4">
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)] items-center sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
      <div className="hidden sm:block" />
      <div className="flex min-w-0 items-center gap-3">
        {sessionLeadingAction && (
          <div className="shrink-0 lg:hidden">
            {sessionLeadingAction}
          </div>
        )}
        <RoundIndicator type={type} className="min-w-0 shrink-0" showConnector={false} />
        <SessionProgress
          currentIndex={currentIndex}
          queueLength={queueLength}
          type={type}
          className="min-w-0 flex-1"
        />
        {sessionActions && (
          <div className="flex h-6 shrink-0 items-center justify-end">
            {sessionActions}
          </div>
        )}
      </div>
      <div className="hidden sm:block" />
    </header>

    <div className="input-session-shell__body min-w-0 flex-1 min-h-0">
      {main}
    </div>
  </div>
);

// --- Helpers ---

function renderProgressBar(currentIndex: number, queueLength: number) {
  const safeLength = Math.max(queueLength, 1);
  const completedRatio = Math.min(Math.max(currentIndex / safeLength, 0), 1);
  const currentRatio = Math.min(Math.max((currentIndex + 1) / safeLength, 0), 1);

  return (
    <div className="mt-auto flex w-full max-w-3xl items-center gap-3 px-4 pb-6 sm:gap-4 sm:pb-8">
      <div className="shrink-0 whitespace-nowrap text-xs font-bold uppercase tracking-widest text-text-secondary">
        第 {currentIndex + 1} / {queueLength} 个词
      </div>
      <div className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#0ea5e9]/30 transition-all"
          style={{ width: `${completedRatio * 100}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#0ea5e9] transition-all"
          style={{ width: `${currentRatio * 100}%` }}
        />
      </div>
    </div>
  );
}

type PlaybackTarget =
  | { kind: 'pronunciation'; locale: PronunciationLocale }
  | { kind: 'example'; key: string };

type SessionActionKind = 'mastered' | 'save' | 'report';

type ActionFeedback = {
  tone: 'success' | 'error';
  text: string;
};

const VOCABULARY_ISSUE_OPTIONS: Array<{ type: VocabularyIssueType; label: string }> = [
  { type: 'definition', label: '释义问题' },
  { type: 'example', label: '例句/拆解问题' },
  { type: 'pronunciation', label: '发音/音标问题' },
  { type: 'other', label: '其他' },
];

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
  onSessionChange,
  onWordMastered,
  sessionLeadingAction,
  sessionActions,
}: {
  type: RoundType;
  words: Word[];
  initialSession?: PersistedLearningSession | null;
  onComplete: (session?: LearningSessionSnapshot) => void | Promise<void>;
  onSessionChange?: (session: LearningSessionSnapshot) => void;
  onWordMastered?: (wordId: string) => void;
  sessionLeadingAction?: React.ReactNode;
  sessionActions?: React.ReactNode;
}) => {
  const { preferences } = useLearningPreferences();
  const { saveWord } = useSavedWords();
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
    const normalizedPassedQueueIndices = hasMatchingSession
      ? Array.from(new Set(initialSession.passedQueueIndices ?? []))
          .filter((index) => Number.isInteger(index) && index >= 0 && index < currentIndex && index < queue.length)
          .sort((left, right) => left - right)
      : [];
    const initialPassedQueueIndices = hasMatchingSession
      && type === 'round3'
      && normalizedPassedQueueIndices.length === 0
      && currentIndex > 0
      ? Array.from({ length: currentIndex }, (_, index) => index)
      : normalizedPassedQueueIndices;

    // Words before currentIndex that are NOT re-queued later are truly completed.
    // Wrong answers get re-inserted after currentIndex, so prefix ∩ suffix = still pending.
    const pendingIds = new Set(queue.slice(currentIndex).map((word) => word.id));
    const initialCompletedIds = new Set<string>();
    for (const word of queue.slice(0, currentIndex)) {
      if (!pendingIds.has(word.id)) initialCompletedIds.add(word.id);
    }
    const initialRound1ConfirmedIds = type === 'round1'
      ? new Set(
          (initialSession?.round1ConfirmedWordIds?.length
            ? initialSession.round1ConfirmedWordIds
            : [...initialCompletedIds]
          ).filter((wordId) => wordMap.has(wordId)),
        )
      : new Set<string>();

    return {
      queue,
      currentIndex,
      initialCompletedIds,
      initialPassedQueueIndices,
      initialRound1ConfirmedIds,
    };
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
  const [round1ConfirmedWordIds, setRound1ConfirmedWordIds] = useState<Set<string>>(
    () => new Set(initialEngineState.initialRound1ConfirmedIds),
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
  const round1ConfirmedWordIdsArray = useMemo(
    () => words
      .map((word) => word.id)
      .filter((wordId) => round1ConfirmedWordIds.has(wordId)),
    [round1ConfirmedWordIds, words],
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
  const viewedClozeFullSentence = useMemo(() => {
    if (!viewedClozePrompt || !viewedWord) return '';
    return (viewedWord.senses[viewedClozePrompt.senseIndex]?.example_sentence ?? '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }, [viewedClozePrompt, viewedWord]);
  const viewedClozeSentenceAudioKey = viewedClozePrompt && viewedWord
    ? `${viewedWord.id}:${viewIndex}:cloze-sentence`
    : '';
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
    setIsActionMenuOpen(false);
    setIsReportSheetOpen(false);
    setActionFeedback(null);
    setActiveActionKind(null);
    setReportTargetWord(null);
    setReportIssueType('definition');
    setReportNote('');
    setCompletedWordIds(new Set(initialEngineState.initialCompletedIds));
    setPassedQueueIndices(new Set(initialEngineState.initialPassedQueueIndices));
    setRound1ConfirmedWordIds(new Set(initialEngineState.initialRound1ConfirmedIds));
    queueRef.current = initialEngineState.queue;
    currentIndexRef.current = initialEngineState.currentIndex;
  }, [clearAnswerRevealTimeout, initialEngineState, stopPlayback, type, words]);

  useEffect(() => () => {
    clearAnswerRevealTimeout();
    stopPlayback();
  }, [clearAnswerRevealTimeout, stopPlayback]);

  useEffect(() => () => {
    if (actionFeedbackTimeoutRef.current !== null) {
      clearTimeout(actionFeedbackTimeoutRef.current);
    }
  }, []);

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

    return speakTextViaBrowser(text, locale, preferencesRef.current.speechPlaybackRate).finally(() => {
      if (runId === playbackRunIdRef.current) {
        setPlaybackTarget(null);
      }
    });
  }, [canPlayExampleAudio]);

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

  const waitForGap = useCallback((gapMs: number, runId: number) => (
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
    if (type !== 'round2') {
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
    if (type === 'article') return;
    const canViewIndex = viewIndex === currentIndex || passedQueueIndices.has(viewIndex);
    if (!canViewIndex || viewIndex >= queue.length) {
      setViewIndex(currentIndex);
    }
  }, [currentIndex, passedQueueIndices, queue.length, type, viewIndex]);

  const buildSessionSnapshot = useCallback((
    overrides: Partial<LearningSessionSnapshot> = {},
  ): LearningSessionSnapshot => ({
    round: type as LearningRoundType,
    currentIndex,
    queueWordIds: queue.map((word) => word.id),
    passedQueueIndices: passedQueueIndicesArray,
    round1ConfirmedWordIds: round1ConfirmedWordIdsArray,
    ...overrides,
  }), [currentIndex, passedQueueIndicesArray, queue, round1ConfirmedWordIdsArray, type]);

  useEffect(() => {
    if (!onSessionChange || type === 'review') return;
    onSessionChange(buildSessionSnapshot());
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
      setSubmitError('');
    } else {
      if (type === 'round1') {
        setSubmitError('已到达当前预载末尾。可以点击“结束新词”进入 Round 2，或稍等下一批新词预载。');
        return;
      }

      // 学习一轮结束，强制触发一次同步
      void attemptBuffer.flush();
      void onComplete(type === 'review' ? undefined : buildSessionSnapshot({
        currentIndex: currentIndexRef.current,
        queueWordIds: queueRef.current.map((word) => word.id),
      }));
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
  const isCardNavigationLocked = showAnswer || isSubmittingAttempt;
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

  const removeWordFromCurrentSession = useCallback((wordId: string) => {
    clearAnswerRevealTimeout();
    stopPlayback();
    onWordMastered?.(wordId);

    const previousQueue = queueRef.current;
    const filteredQueue = previousQueue.filter((word) => word.id !== wordId);
    if (filteredQueue.length === previousQueue.length) return;

    setCompletedWordIds((prev) => {
      const next = new Set(prev);
      next.add(wordId);
      return next;
    });
    setRound1ConfirmedWordIds((prev) => {
      if (!prev.has(wordId)) return prev;
      const next = new Set(prev);
      next.delete(wordId);
      return next;
    });

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
      setPassedQueueIndices(new Set());
      void attemptBuffer.flush();
      void onComplete(type === 'review' ? undefined : buildSessionSnapshot({
        currentIndex: 0,
        queueWordIds: [],
        passedQueueIndices: [],
        round1ConfirmedWordIds: round1ConfirmedWordIdsArray.filter((id) => id !== wordId),
      }));
      return;
    }

    const currentQueueIndex = currentIndexRef.current;
    const removedBeforeCurrent = previousQueue
      .slice(0, currentQueueIndex)
      .filter((word) => word.id === wordId)
      .length;
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
    setPassedQueueIndices((prev) => {
      const next = new Set<number>();
      for (const index of prev) {
        const mappedIndex = indexMap.get(index);
        if (typeof mappedIndex === 'number' && mappedIndex < nextCurrentIndex) {
          next.add(mappedIndex);
        }
      }
      return next;
    });
  }, [
    buildSessionSnapshot,
    clearAnswerRevealTimeout,
    onComplete,
    onWordMastered,
    round1ConfirmedWordIdsArray,
    stopPlayback,
    type,
    viewIndex,
  ]);

  const handleMarkViewedWordMastered = useCallback(async () => {
    if (activeActionKind || !viewedWord) return;

    setIsActionMenuOpen(false);
    setActiveActionKind('mastered');
    setSubmitError('');

    try {
      await markReviewWordMastered({
        vocabularyItemId: viewedWord.id,
        learningGroupId: initialSession?.groupId ?? null,
      });
      removeWordFromCurrentSession(viewedWord.id);
      showSessionActionFeedback({ tone: 'success', text: `已掌握 ${viewedWord.word}` });
    } catch (error) {
      showSessionActionFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '标记已掌握失败，请稍后再试。',
      });
    } finally {
      setActiveActionKind(null);
    }
  }, [
    activeActionKind,
    initialSession?.groupId,
    removeWordFromCurrentSession,
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
        routePath: typeof window === 'undefined'
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
    if (type !== 'round1') return;
    const touch = event.touches[0];
    if (!touch) return;
    const target = event.target as HTMLElement | null;
    const isInteractive = Boolean(target?.closest('input, textarea, button, a, [role="button"], [contenteditable="true"]'));
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, valid: !isInteractive };
  }, [type]);
  const handleCardTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
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
  }, [canNavigateLeft, canNavigateRight, navigateCard]);

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
    if (isViewingHistory) return;

    if (!showAnswer) {
      setSubmitError('');
      setShowAnswer(true);
      return;
    }

    markCurrentQueueIndexPassed();
    nextWord();
  }, [isViewingHistory, markCurrentQueueIndexPassed, showAnswer, nextWord]);

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
      markCurrentQueueIndexPassed();
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
    markCurrentQueueIndexPassed,
    nextWord,
    showAnswer,
  ]);

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
      if (type === 'round1') {
        setRound1ConfirmedWordIds((prev) => {
          if (prev.has(currentWord.id)) return prev;
          const next = new Set(prev);
          next.add(currentWord.id);
          return next;
        });
      }

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

        if ((type === 'round2' || type === 'review') && clozePrompt && preferences.clozeSentenceAutoPlayEnabled) {
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
  }, [showAnswer, isSubmittingAttempt, isViewingHistory, inputValue, expectedInput, persistAttempt, currentWord, type, nextWord, clearAnswerRevealTimeout, queue, currentIndex, preferences.clozeSentenceAutoPlayEnabled, preferences.correctAnswerRevealMs, preferences.wrongAnswerRevealMs, clozePrompt, playExampleSentence, markCurrentQueueIndexPassed]);

  const finishRound1WithConfirmedWords = useCallback(() => {
    if (type !== 'round1' || isSubmittingAttempt || showAnswer || isViewingHistory) return;
    if (round1ConfirmedWordIdsArray.length === 0) {
      setSubmitError('至少确认 1 个词后，才能进入 Round 2。');
      return;
    }

    clearAnswerRevealTimeout();
    stopPlayback();
    setSubmitError('');
    void attemptBuffer.flush();
    void onComplete(buildSessionSnapshot({
      round: 'round1',
      currentIndex,
      queueWordIds: queue.map((word) => word.id),
      passedQueueIndices: passedQueueIndicesArray,
      round1ConfirmedWordIds: round1ConfirmedWordIdsArray,
    }));
  }, [
    buildSessionSnapshot,
    clearAnswerRevealTimeout,
    currentIndex,
    isSubmittingAttempt,
    isViewingHistory,
    onComplete,
    passedQueueIndicesArray,
    queue,
    round1ConfirmedWordIdsArray,
    showAnswer,
    stopPlayback,
    type,
  ]);

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

  const isCorrect = inputValue.trim().length > 0
    && stripDiacritics(inputValue.trim().toLowerCase()) === stripDiacritics(expectedInput);
  const primaryPos = viewedWord.pos_tags[0] ?? '未标注';
  const actionDisabled = isViewingHistory || isSubmittingAttempt || ((type === 'round2' || type === 'review') && showAnswer);
  const actionLabel = (type === 'round2' || type === 'review') && showAnswer
    ? (isWrong ? '答案展示中…' : '判断正确！')
    : type === 'round1'
      ? '确认这一词'
      : '提交这次判断';
  const allowLiveCorrectTint = type === 'round1' || type === 'round2';
  const inputIsCorrect = !isWrong && allowLiveCorrectTint && isCorrect;
  const contentAreaClassName = 'learning-card-scrollarea flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-7';
  const inputDockClassName = 'shrink-0 border-t border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(247,249,253,0.92))] px-4 py-4 shadow-[0_-18px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:px-7 sm:py-5 lg:px-8';
  const round1InputDockClassName = 'shrink-0 border-t border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(247,249,253,0.94))] px-4 pt-2 pb-3 shadow-[0_-18px_40px_rgba(14,26,56,0.08)] backdrop-blur-xl sm:px-7 sm:pt-3 sm:pb-4 lg:px-8';
  const round1MemoryTip = preferences.memoryTipEnabled ? trimDisplayText(viewedWord.memory_tip) : '';
  const showRound1MorphologyCard = hasRound1MorphologyContent(viewedWord);
  const showRound1RelationsCard = hasRound1RelationsContent(viewedWord);
  const showRound1ContextCard = hasRound1ContextContent(viewedWord);
  const hasRound1InfoCards = showRound1MorphologyCard || showRound1RelationsCard || showRound1ContextCard;
  const displayedPhonetic = getWordPhonetic(viewedWord, audioLocale);

  const inputField = (
    <form onSubmit={handleSubmit} className="w-full">
      <div
        className={cx(
          'rounded-[22px] border border-white/80 bg-white/60 px-4 shadow-[0_12px_32px_rgba(14,26,56,0.06)] backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 sm:px-5',
          type === 'round1' ? 'py-2 sm:py-3' : 'py-3.5 sm:py-5',
          inputIsCorrect && 'border-[#22C55E]/35 bg-[#ECFDF5]/80 shadow-[0_12px_32px_rgba(34,197,94,0.12)]',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInput}
          disabled={isSubmittingAttempt || isViewingHistory}
          className={cx(
            'w-full bg-transparent text-center font-black leading-none outline-none transition-colors duration-200 caret-gray-800 placeholder:text-text-secondary/35 focus-visible:!outline-none',
            type === 'round1' ? 'text-4xl sm:text-6xl' : 'text-5xl sm:text-7xl',
            isWrong ? 'text-apple-red' : inputIsCorrect ? 'text-[#16A34A] caret-[#16A34A]' : 'text-text-primary',
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
        <AnswerFeedbackCard
          word={currentWord}
          clozePrompt={clozePrompt}
          isWrong={isWrong}
          wrongInput={lastWrongInput}
        />
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
              ? type === 'round2'
                ? 'bg-[#2563eb] text-white shadow-[0_12px_24px_rgba(37,99,235,0.18)]'
                : 'bg-apple-blue text-white shadow-[0_12px_24px_rgba(25,200,185,0.18)]'
              : type === 'round2'
                ? 'bg-[#eaf2ff] text-[#2563eb] hover:bg-[#dbeafe]'
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
      className={cx(
        'flex w-full items-center justify-center gap-2 rounded-[20px] px-5 py-3.5 text-base font-black text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:w-auto sm:min-w-[220px]',
        type === 'round2'
          ? 'bg-[#2563eb] shadow-[0_18px_40px_rgba(37,99,235,0.22)] hover:bg-[#1d4ed8]'
          : 'bg-apple-blue shadow-[0_18px_40px_rgba(25,200,185,0.22)]',
      )}
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
            className="absolute right-0 top-[3.25rem] w-52 overflow-hidden rounded-[22px] border border-white/85 bg-white/92 p-1.5 text-left shadow-[0_22px_56px_rgba(61,52,40,0.18)] backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => { void handleMarkViewedWordMastered(); }}
              disabled={Boolean(activeActionKind)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-apple-red transition-colors hover:bg-apple-red/8 disabled:cursor-wait disabled:opacity-60"
            >
              {activeActionKind === 'mastered' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              标记已掌握
            </button>
            <button
              type="button"
              onClick={() => { void handleSaveViewedWord(); }}
              disabled={Boolean(activeActionKind)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[17px] px-3.5 text-sm font-black text-text-primary transition-colors hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
            >
              {activeActionKind === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookMarked className="h-4 w-4" />}
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
  const mobileWordActionMenu = renderWordActionMenu('!absolute right-3 top-3 z-30 sm:hidden', mobileActionMenuRef);
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
          {actionFeedback.tone === 'error' ? <XCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-[#7ddc8a]" />}
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
              onClick={() => { void handleSubmitReport(); }}
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

  if (type === 'round3') {
    return (
      <div className="relative w-full max-w-4xl mx-auto flex h-full min-h-0 flex-col items-center">
        {renderWordActionMenu('!absolute right-3 top-12 z-30', round3ActionMenuRef)}
        {actionFeedbackToast}
        {reportIssueSheet}
        <div className="flex w-full max-w-3xl items-center gap-2">
          {sessionLeadingAction && (
            <div className="shrink-0 lg:hidden">
              {sessionLeadingAction}
            </div>
          )}
          <RoundIndicator type={type} className="min-w-0 flex-1" />
          {sessionActions}
        </div>
        <div className="grid w-full flex-1 min-h-0 grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3">
          <div className="hidden items-center sm:flex">
            {leftNavigationButton}
          </div>

          <motion.div
            key={`${viewedWord.id}:${viewIndex}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
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
              {(['uk', 'us'] as const).map(loc => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => { setAudioLocale(loc); void playAudioSequence(viewedWord, loc, 1, 0); }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all ${
                    audioLocale === loc
                      ? 'bg-[#0ea5e9] text-white shadow-[0_8px_18px_rgba(14,165,233,0.16)]'
                      : 'bg-[#e0f2fe] text-[#0284c7] hover:bg-[#bae6fd]'
                  }`}
                >
                  {activePronunciationLocale === loc
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Volume2 className="w-3 h-3" />}
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
                        items={[{
                          key: round3ExampleKey,
                          sentence: round3ExampleSentence,
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

            {!shouldShowRound3Answer && (
              <p className="text-text-secondary/40 text-sm mt-8">先自己判断，再决定要不要展开答案。</p>
            )}
          </motion.div>

          <div className="hidden items-center sm:flex">
            {rightNavigationButton}
          </div>
        </div>

        {renderProgressBar(displayProgressIndex, initialUniqueCount)}

        <div className="w-full max-w-3xl space-y-3 px-4 pb-4 sm:pb-8">
          {submitErrorBanner}
          <div className={cx(
            'grid gap-3',
            showAnswer && !isViewingHistory ? 'sm:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]' : 'grid-cols-1',
          )}>
            {showAnswer && !isViewingHistory && (
              <button
                type="button"
                onClick={() => { void handleRound3Unknown(); }}
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
              {isViewingHistory ? '回看中' : isSubmittingAttempt ? '正在写回…' : showAnswer ? '继续下一个词' : '展开释义'}
              {isSubmittingAttempt ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
            </button>
          </div>
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
        queueLength={initialUniqueCount}
        sessionLeadingAction={sessionLeadingAction}
        sessionActions={sessionActions}
        main={(
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] sm:gap-3">
          <div className="hidden items-center sm:flex">
            {leftNavigationButton}
          </div>
        <motion.div
          key={`${viewedWord.id}:${viewIndex}`}
          initial={{ opacity: 0, scale: 0.97, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          onTouchStart={handleCardTouchStart}
          onTouchEnd={handleCardTouchEnd}
          onTouchCancel={() => { swipeStartRef.current = null; }}
          style={type === 'round1' ? { touchAction: 'pan-y' } : undefined}
          className="glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] shadow-[0_24px_64px_rgba(14,26,56,0.08)] sm:rounded-[30px]"
        >
          {mobileWordActionMenu}
          {type === 'round1' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className={cx(contentAreaClassName, 'pb-4 sm:pb-5')}>
                <div className="space-y-3 sm:space-y-4">
                  <div className={cx(
                    'grid gap-3 lg:items-start lg:gap-8',
                    round1MemoryTip
                      ? 'lg:grid-cols-[minmax(0,1fr)_minmax(300px,30vw)]'
                      : 'lg:grid-cols-1',
                  )}>
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

                      <div className={cx(
                        'flex min-w-0 flex-col gap-2',
                        round1MemoryTip
                          ? '2xl:flex-row 2xl:items-start 2xl:gap-6'
                          : 'lg:flex-row lg:items-start lg:gap-6',
                      )}>
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
                        <div className={cx(
                          'min-w-0',
                          round1MemoryTip
                            ? '2xl:min-w-[18rem] 2xl:max-w-[680px] 2xl:flex-1 2xl:pt-1'
                            : 'lg:min-w-[18rem] lg:max-w-[680px] lg:flex-1 lg:pt-1',
                        )}>
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
                          onPlayExample={(sentence, key) => { void playExampleSentence(sentence, key); }}
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
                      <div className="flex flex-row items-stretch gap-3">
                        <div className="flex-[3.2] min-w-0">
                          {inputField}
                        </div>
                        <div className="flex-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => { void validateCurrentInput(); }}
                            disabled={actionDisabled}
                            className="flex h-full min-h-[50px] w-full items-center justify-center rounded-[22px] bg-[#4f46e5] text-white shadow-[0_14px_32px_rgba(79,70,229,0.22)] transition-all hover:bg-[#4338ca] active:scale-[0.96] disabled:opacity-50 disabled:hover:bg-[#4f46e5]"
                          >
                            <ChevronRight className="h-6 w-6" strokeWidth={3} />
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={finishRound1WithConfirmedWords}
                        disabled={
                          actionDisabled
                          || showAnswer
                          || isViewingHistory
                          || round1ConfirmedWordIdsArray.length === 0
                        }
                        className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[18px] border border-[#cf8922]/20 bg-[#fff6e2]/85 px-4 text-sm font-black text-[#b76f12] shadow-[0_10px_24px_rgba(207,137,34,0.10)] transition-all hover:bg-[#ffefc2] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[#fff6e2]/85"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        结束新词 · {round1ConfirmedWordIdsArray.length} 词进入 Round 2
                      </button>
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
                      canPlaySentenceAudio={canPlayExampleAudio && Boolean(viewedClozeFullSentence)}
                      isSentencePlaying={activeExampleKey === viewedClozeSentenceAudioKey}
                      sentenceAudioLocale={audioLocale}
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
                          type === 'round2'
                            ? 'bg-[#eaf2ff] text-[#2563eb]'
                            : 'bg-apple-blue/10 text-apple-blue/80',
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
                      <AnswerFeedbackCard
                        word={viewedWord}
                        clozePrompt={viewedClozePrompt}
                      />
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
          <div className="relative hidden items-center justify-center sm:flex">
            <div className="absolute left-1/2 top-3 -translate-x-1/2">
              {desktopWordActionMenu}
            </div>
            {rightNavigationButton}
          </div>
        </div>
        )}
      />
    </>
  );
};
