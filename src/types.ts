// Word shape used by the learning engine (stable — do not change)
export interface Word {
  id: string;
  word: string;
  phonetic: string;
  pos_tags: string[];
  ner_entities: { label: string; text: string }[];
  chinese_definition: string;
  example_sentences: string[];
  confusing_pair?: {
    word: string;
    difference: string;
  };
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
  confused_word: string | null;
  confused_diff_zh: string | null;
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
}

// Convert EnrichedWord → Word for the learning engine
export function toWord(e: EnrichedWord): Word {
  return {
    id: e.id ?? e.word,
    word: e.word,
    phonetic: e.ipa_uk,
    pos_tags: e.senses.map(s => s.pos),
    ner_entities: e.ner_label ? [{ label: e.ner_label, text: e.word }] : [],
    chinese_definition: e.primary_meaning_zh,
    example_sentences: e.senses.map(s => s.example_sentence),
    confusing_pair: e.confused_word
      ? { word: e.confused_word, difference: e.confused_diff_zh ?? '' }
      : undefined,
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

export interface LibraryGroupSummary {
  id: string;
  title: string;
  createdAt: string;
  wordCount: number;
  sourceType: 'custom' | 'system';
  status: 'active' | 'completed';
}

export interface LibraryGroupWord {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  memoryTip: string;
  posTags: string[];
  examples: { sentence: string; translation: string }[];
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
  article?: string | null;
}

export interface ResumeCandidate extends PersistedLearningSession {
  groupTitle: string;
  createdAt: string;
  queueLength: number;
}

export interface LearningSession {
  type: RoundType;
  words: Word[];
  currentIndex: number;
  queue: Word[]; // Used for Round 2 re-insertion logic
}

export interface UserStats {
  todayReviewCount: number;
  todayNewGroups: number;
  streak: number;
  totalLearned: number;
  resumeCandidate: ResumeCandidate | null;
}
