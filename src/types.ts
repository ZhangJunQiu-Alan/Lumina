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
  audio_uk_url?: string | null;
  audio_us_url?: string | null;
}

export type PronunciationLocale = 'uk' | 'us';

export interface LearningPreferences {
  defaultPronunciationLocale: PronunciationLocale;
  autoPlayEnabled: boolean;
  autoPlayRepeatCount: 1 | 2 | 3;
  autoPlayRepeatGapMs: number;
  wrongAnswerRevealMs: 3000 | 5000 | 8000;
  reinforcementRound3Enabled: boolean;
  reinforcementArticleEnabled: boolean;
}

// Convert EnrichedWord → Word for the learning engine
export function toWord(e: EnrichedWord): Word {
  const confusingPairs = toConfusingPairs(e.confusions);

  return {
    id: e.id ?? e.word,
    word: e.word,
    phonetic: e.ipa_uk,
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
    audio_uk_url: e.audio_uk_url,
    audio_us_url: e.audio_us_url,
  };
}

export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'review';
export type ReviewResultType = 'wrong' | 'slow_correct' | 'fast_correct';
export type LearningRoundType = 'round1' | 'round2' | 'round3' | 'article';
export type RoundType = 'review' | LearningRoundType;

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

export type OfficialLibraryId = 'ielts-vocab' | 'gre-zhenkao-v7';

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
}

export type ViewState = 'home' | 'library' | 'import' | 'learning' | 'auth' | 'profile' | 'settings' | 'reviewResults';

export interface PersistedLearningSession {
  groupId: string;
  round: LearningRoundType;
  currentIndex: number;
  queueWordIds: string[];
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

export interface RoutineVisibleStep {
  key: RoutineStepKey;
  label: string;
  status: RoutineVisibleStepStatus;
}

export interface RoutineCard {
  state: RoutineCardState;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaMode: RoutineCardCtaMode;
  boundLearningGroupId: string | null;
  visibleSteps: RoutineVisibleStep[];
}

export interface UserStats {
  todayReviewCount: number;
  streak: number;
  perfectCheckinDays: number;
  totalLearned: number;
  orbitDays: OrbitDay[];
  selectedDate: string;
  selectedDayReviewWordCount: number;
  selectedDayLearnedWordCount: number;
  resumeCandidate: ResumeCandidate | null;
  routineCard: RoutineCard;
}
