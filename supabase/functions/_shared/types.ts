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

export interface ArticleSentence {
  en: string;
  zh: string;
}

export type MemoryState = 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered';
export type ReviewAttemptSource = 'round2' | 'review';
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
