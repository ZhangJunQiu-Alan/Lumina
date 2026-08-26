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

export interface Round2ChoiceDistractor {
  word: string;
  pos: string;
  meaning_zh: string;
  relation?: string;
}

export interface ArticleSentence {
  en: string;
  zh: string;
}

export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'round3' | 'review';
export type ReviewEventSource = ReviewAttemptSource | 'manual_mastered';
export type LearningRoundType = 'round1' | 'round2' | 'round3' | 'article';
export type OfficialLibraryId =
  | 'ielts-vocab'
  | 'gre-zhenkao-v7'
  | 'cet4-vocab'
  | 'cet6-vocab'
  | 'npee-vocab'
  | 'gaokao-vocab'
  | 'tem4-vocab'
  | 'tem8-vocab';
export type OfficialStudyMode = 'sequential' | 'shuffle';
export type PronunciationLocale = 'uk' | 'us';
export type SpeechPlaybackRate = 0.6 | 0.8 | 1;
export type IeltsTargetScore = 5 | 5.5 | 6 | 6.5 | 7 | 7.5 | 8 | 8.5 | 9;

export interface LearningPreferences {
  defaultPronunciationLocale: PronunciationLocale;
  ieltsTargetScore: IeltsTargetScore;
  speechPlaybackRate: SpeechPlaybackRate;
  autoPlayEnabled: boolean;
  autoPlayRepeatCount: 1 | 2 | 3;
  autoPlayRepeatGapMs: number;
  correctAnswerRevealMs: 800 | 1000 | 1500 | 2000;
  wrongAnswerRevealMs: 3000 | 5000 | 8000;
  round2Enabled: boolean;
  reinforcementRound3Enabled: boolean;
  reinforcementArticleEnabled: boolean;
  popoverAutoPlayEnabled: boolean;
  clozeSentenceAutoPlayEnabled: boolean;
  memoryTipEnabled: boolean;
}

export interface HomeOfficialLibraryOption {
  libraryId: OfficialLibraryId;
  title: string;
  mode: OfficialStudyMode;
  existingGroupCount: number;
  activeGroupId: string | null;
  activeRound: LearningRoundType | null;
  confirmedWordCount: number;
  loadedWordCount: number;
  completedMemoryWordCount: number;
  totalWordCount: number;
}
