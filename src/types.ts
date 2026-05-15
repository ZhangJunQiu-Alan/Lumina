export type MorphologyPartKind = 'prefix' | 'root' | 'suffix';

export interface EnrichedMorphologyPart {
  text: string;
  kind: MorphologyPartKind;
  meaning_zh: string;
  note_zh: string;
}

export interface EnrichedMorphology {
  summary_zh: string;
  parts: EnrichedMorphologyPart[];
}

export interface EnrichedWordRelation {
  word: string;
  meaning_zh: string;
  note_zh: string;
}

export interface EnrichedWordConfusion {
  word: string;
  difference_zh: string;
}

export interface WordMorphologyPart {
  text: string;
  kind: MorphologyPartKind;
  meaningZh: string;
  noteZh: string;
}

export interface WordMorphology {
  summaryZh: string;
  parts: WordMorphologyPart[];
}

export interface WordRelation {
  word: string;
  meaningZh: string;
  noteZh: string;
}

export interface ConfusingPair {
  word: string;
  difference: string;
}

export function toWordMorphology(morphology: EnrichedMorphology | null | undefined): WordMorphology {
  return {
    summaryZh: morphology?.summary_zh ?? '',
    parts: (morphology?.parts ?? []).map((part) => ({
      text: part.text,
      kind: part.kind,
      meaningZh: part.meaning_zh,
      noteZh: part.note_zh,
    })),
  };
}

export function toWordRelations(items: EnrichedWordRelation[] | null | undefined): WordRelation[] {
  return (items ?? []).map((item) => ({
    word: item.word,
    meaningZh: item.meaning_zh,
    noteZh: item.note_zh,
  }));
}

export function toConfusingPairs(items: EnrichedWordConfusion[] | null | undefined): ConfusingPair[] {
  return (items ?? []).map((item) => ({
    word: item.word,
    difference: item.difference_zh,
  }));
}

// Word shape used by the learning engine
export interface Word {
  id: string;
  word: string;
  phonetic: string;
  ipa_uk?: string | null;
  ipa_us?: string | null;
  pos_tags: string[];
  ner_entities: { label: string; text: string }[];
  chinese_definition: string;
  senses: WordSense[];
  example_sentences: string[];
  morphology: WordMorphology;
  derivedWords: WordRelation[];
  synonyms: WordRelation[];
  antonyms: WordRelation[];
  confusingPairs: ConfusingPair[];
  confusing_pair?: ConfusingPair;
  memory_tip?: string;
  audio_uk_url?: string | null;
  audio_us_url?: string | null;
}

// Richer shape returned by Gemini / stored in Supabase
export interface WordSense {
  pos: string;
  meaning_zh: string;
  example_sentence: string;
  example_translation_zh: string;
}

export interface EnrichedWord {
  id?: string;             // UUID assigned after DB insert
  word: string;
  ipa_uk: string;
  ipa_us: string;
  primary_meaning_zh: string;
  ner_label: string | null;
  senses: WordSense[];
  morphology: EnrichedMorphology;
  derived_words: EnrichedWordRelation[];
  synonyms: EnrichedWordRelation[];
  antonyms: EnrichedWordRelation[];
  confusions: EnrichedWordConfusion[];
  // Deprecated compatibility aliases for older scripts.
  confused_word?: string | null;
  confused_diff_zh?: string | null;
  memory_tip: string;
  forms?: string[];
  audio_uk_url?: string | null;
  audio_us_url?: string | null;
}

export type PronunciationLocale = 'uk' | 'us';
export type SpeechPlaybackRate = 0.6 | 0.8 | 1;

export function getWordPhonetic(
  word: Pick<Word, 'phonetic' | 'ipa_uk' | 'ipa_us'>,
  locale: PronunciationLocale,
): string {
  const preferred = locale === 'us' ? word.ipa_us : word.ipa_uk;
  return preferred?.trim()
    || word.phonetic.trim()
    || word.ipa_uk?.trim()
    || word.ipa_us?.trim()
    || '';
}

export interface LearningPreferences {
  defaultPronunciationLocale: PronunciationLocale;
  speechPlaybackRate: SpeechPlaybackRate;
  autoPlayEnabled: boolean;
  autoPlayRepeatCount: 1 | 2 | 3;
  autoPlayRepeatGapMs: number;
  correctAnswerRevealMs: 800 | 1000 | 1500 | 2000;
  wrongAnswerRevealMs: 3000 | 5000 | 8000;
  reinforcementRound3Enabled: boolean;
  reinforcementArticleEnabled: boolean;
  popoverAutoPlayEnabled: boolean;
}

// Convert EnrichedWord → Word for the learning engine
export function toWord(e: EnrichedWord): Word {
  const confusingPairs = toConfusingPairs(e.confusions);

  return {
    id: e.id ?? e.word,
    word: e.word,
    phonetic: e.ipa_uk,
    ipa_uk: e.ipa_uk,
    ipa_us: e.ipa_us,
    pos_tags: e.senses.map(s => s.pos),
    ner_entities: e.ner_label ? [{ label: e.ner_label, text: e.word }] : [],
    chinese_definition: e.primary_meaning_zh,
    senses: e.senses,
    example_sentences: e.senses.map(s => s.example_sentence),
    morphology: toWordMorphology(e.morphology),
    derivedWords: toWordRelations(e.derived_words),
    synonyms: toWordRelations(e.synonyms),
    antonyms: toWordRelations(e.antonyms),
    confusingPairs,
    confusing_pair: confusingPairs[0],
    memory_tip: e.memory_tip,
    audio_uk_url: e.audio_uk_url,
    audio_us_url: e.audio_us_url,
  };
}

export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'review';
export type ReviewResultType = 'wrong' | 'slow_correct' | 'fast_correct';
export type LearningRoundType = 'round1' | 'round2' | 'round3' | 'article';
export type RoundType = 'review' | LearningRoundType;

export interface ArticleSentence {
  en: string;
  zh: string;
}

export type IeltsReadingQuestionType =
  | 'true_false_not_given'
  | 'yes_no_not_given'
  | 'multiple_choice_single'
  | 'multiple_choice_multi'
  | 'matching_headings'
  | 'matching_information'
  | 'matching_features'
  | 'matching_sentence_endings'
  | 'summary_completion'
  | 'note_completion'
  | 'table_completion'
  | 'flow_chart_completion'
  | 'sentence_completion'
  | 'short_answer'
  | 'diagram_label'
  | 'other';

export interface IeltsReadingOption {
  key: string;
  text: string;
}

export interface IeltsReadingQuestion {
  id: string;
  testId: string;
  groupId: string;
  number: number;
  prompt: string;
  options: IeltsReadingOption[];
  answer: string[];
  answerNote: string;
  type: IeltsReadingQuestionType;
  passageNumber: number;
}

export interface IeltsReadingQuestionGroup {
  id: string;
  type: IeltsReadingQuestionType;
  prompt: string;
  instructions: string;
  options: IeltsReadingOption[];
  rangeStart: number | null;
  rangeEnd: number | null;
  questions: IeltsReadingQuestion[];
}

export interface IeltsReadingPassage {
  id: string;
  number: number;
  title: string;
  body: string;
  wordCount: number;
  groups: IeltsReadingQuestionGroup[];
}

export interface IeltsReadingBookSummary {
  id: string;
  bookNumber: number;
  title: string;
  sourceLabel: string;
  tests: IeltsReadingTestSummary[];
}

export interface IeltsReadingTestSummary {
  id: string;
  bookId: string;
  bookNumber: number;
  bookTitle: string;
  testNumber: number;
  title: string;
  passageCount: number;
  questionCount: number;
}

export interface IeltsReadingTestDetail extends IeltsReadingTestSummary {
  passages: IeltsReadingPassage[];
}

export interface IeltsReadingAttemptSummary {
  id: string;
  testId: string;
  bookTitle: string;
  bookNumber: number;
  testNumber: number;
  score: number;
  totalQuestions: number;
  elapsedSeconds: number;
  submittedAt: string;
}

export interface IeltsReadingAttemptResult extends IeltsReadingAttemptSummary {
  responses: IeltsReadingResponseResult[];
}

export interface IeltsReadingResponseResult {
  questionId: string;
  questionNumber: number;
  response: string[];
  correctAnswer: string[];
  isCorrect: boolean;
}

export type IeltsListeningQuestionType =
  | 'form_completion'
  | 'note_completion'
  | 'table_completion'
  | 'sentence_completion'
  | 'multiple_choice_single'
  | 'matching'
  | 'diagram_label'
  | 'other';

export interface IeltsListeningOption {
  key: string;
  text: string;
}

export interface IeltsListeningQuestion {
  id: string;
  testId: string;
  sectionId: string;
  groupId: string;
  number: number;
  prompt: string;
  options: IeltsListeningOption[];
  answer: string[];
  answerNote: string;
  type: IeltsListeningQuestionType;
  sectionNumber: number;
}

export interface IeltsListeningQuestionGroup {
  id: string;
  type: IeltsListeningQuestionType;
  prompt: string;
  instructions: string;
  options: IeltsListeningOption[];
  rangeStart: number | null;
  rangeEnd: number | null;
  questions: IeltsListeningQuestion[];
}

export interface IeltsListeningSection {
  id: string;
  number: number;
  title: string;
  instructions: string;
  audioUrl: string;
  audioStoragePath: string;
  sourceAudioFilename: string;
  groups: IeltsListeningQuestionGroup[];
}

export interface IeltsListeningBookSummary {
  id: string;
  bookNumber: number;
  title: string;
  sourceLabel: string;
  tests: IeltsListeningTestSummary[];
}

export interface IeltsListeningTestSummary {
  id: string;
  bookId: string;
  bookNumber: number;
  bookTitle: string;
  testNumber: number;
  title: string;
  sectionCount: number;
  questionCount: number;
}

export interface IeltsListeningTestDetail extends IeltsListeningTestSummary {
  sections: IeltsListeningSection[];
}

export interface IeltsListeningAttemptSummary {
  id: string;
  testId: string;
  bookTitle: string;
  bookNumber: number;
  testNumber: number;
  score: number;
  totalQuestions: number;
  elapsedSeconds: number;
  submittedAt: string;
}

export interface IeltsListeningAttemptResult extends IeltsListeningAttemptSummary {
  responses: IeltsListeningResponseResult[];
}

export interface IeltsListeningResponseResult {
  questionId: string;
  questionNumber: number;
  response: string[];
  correctAnswer: string[];
  isCorrect: boolean;
}

export interface ReviewTransition {
  from: MemoryState | null;
  to: MemoryState;
  source: ReviewAttemptSource;
  result: ReviewResultType;
  graduated: boolean;
  nextReviewAt: string | null;
}

export interface ReviewAttemptResponse {
  memoryState: MemoryState;
  nextReviewAt: string | null;
  graduated: boolean;
  transition: ReviewTransition;
}

export interface ReviewWord extends Word {
  memoryState: MemoryState;
  nextReviewAt: string | null;
  lastResult: ReviewResultType | null;
}

export interface ReviewSummaryItem {
  wordId: string;
  word: string;
  chineseDefinition: string;
  transition: ReviewTransition;
}

export type OfficialLibraryId = 'ielts-vocab' | 'gre-zhenkao-v7' | 'cet4-vocab' | 'cet6-vocab' | 'tem4-vocab' | 'tem8-vocab' | 'npee-vocab' | 'gaokao-vocab';
export type OfficialLibraryCompletionCounts = Record<OfficialLibraryId, number>;

export interface LibraryGroupSummary {
  id: string;
  title: string;
  createdAt: string;
  wordCount: number;
  sourceType: 'custom' | 'system';
  libraryId: OfficialLibraryId | null;
  status: 'active' | 'completed';
  sessionRound: LearningRoundType | null;
  completedAt: string | null;
}

export interface LibraryGroupWord {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  memoryTip: string;
  posTags: string[];
  examples: { sentence: string; translation: string }[];
  morphology: WordMorphology;
  derivedWords: WordRelation[];
  synonyms: WordRelation[];
  antonyms: WordRelation[];
  confusingPairs: ConfusingPair[];
  confusingWord: string | null;
  confusingDiff: string | null;
  memoryState: MemoryState;
  nextReviewAt: string | null;
  lastResult: ReviewResultType | null;
  sequenceNo: number;
  audioUkUrl?: string | null;
  audioUsUrl?: string | null;
}

export type ViewState = 'home' | 'library' | 'import' | 'learning' | 'auth' | 'profile' | 'settings' | 'reviewResults';

export interface PersistedLearningSession {
  groupId: string;
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
  passedQueueIndices: number[];
  lastActiveAt: string;
  groupCompleted: boolean;
  completedAt: string | null;
  libraryId?: OfficialLibraryId | null;
  article?: string | null;
}

export interface ResumeCandidate extends PersistedLearningSession {
  groupTitle: string;
  createdAt: string;
  queueLength: number;
}

export interface OfficialResumeTargets {
  active: ResumeCandidate | null;
  reinforcement: ResumeCandidate | null;
}

export interface OfficialLibrarySummary {
  progress: number;
  nextBatchSize: number;
  unlockedWordCount: number;
  completedMemoryWordCount: number;
  totalWordCount: number;
  activeResumeCandidate: ResumeCandidate | null;
  reinforcementCandidate: ResumeCandidate | null;
  completed: boolean;
}

export interface LearningSession {
  type: RoundType;
  words: Word[];
  currentIndex: number;
  queue: Word[]; // Used for Round 2 re-insertion logic
}

export type OrbitDayStatus = 'gap' | 'ordinary' | 'perfect' | 'shielded';
export type RoutineStepKey = 'review' | 'round1' | 'round2';
export type RoutineCardState = 'not_started' | 'in_progress' | 'completed';
export type RoutineVisibleStepStatus = 'completed' | 'current' | 'upcoming';
export type RoutineCardCtaMode =
  | 'start_review'
  | 'continue_review'
  | 'start_learning'
  | 'continue_learning'
  | 'open_library';

export interface OrbitDay {
  date: string;
  weekdayLabel: string;
  shortDateLabel: string;
  status: OrbitDayStatus;
  reviewWordCount: number;
  learnedWordCount: number;
}

export interface ActivityDay extends OrbitDay {
  attemptCount: number;
  correctAttemptCount: number;
  accuracy: number | null;
}

export interface RoutineVisibleStep {
  key: RoutineStepKey;
  label: string;
  status: RoutineVisibleStepStatus;
}

export type OfficialStudyMode = 'sequential' | 'shuffle';

export interface RoutineCard {
  state: RoutineCardState;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaMode: RoutineCardCtaMode;
  boundLearningGroupId: string | null;
  visibleSteps: RoutineVisibleStep[];
  lastUsedOfficialLibraryId: OfficialLibraryId | null;
  lastUsedOfficialMode: OfficialStudyMode | null;
  lastUsedOfficialGroupCount: number;
}

export interface UserStats {
  todayReviewCount: number;
  streak: number;
  perfectCheckinDays: number;
  stableRecallCount: number;
  orbitDays: OrbitDay[];
  activityDays: ActivityDay[];
  selectedDate: string;
  selectedDayReviewWordCount: number;
  selectedDayLearnedWordCount: number;
  resumeCandidate: ResumeCandidate | null;
  routineCard: RoutineCard;
}
