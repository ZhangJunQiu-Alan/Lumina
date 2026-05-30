import type { IeltsReadingAnswerMap } from './ieltsReadingScoring';

export interface IeltsReadingDraftAnnotation {
  id: string;
  passageNumber: number;
  paragraphIndex: number;
  start: number;
  end: number;
  note?: string;
}

export interface IeltsReadingDraft {
  startedAt: string;
  answers: IeltsReadingAnswerMap;
  selectedPassage: number;
  flags?: number[];
  annotations?: IeltsReadingDraftAnnotation[];
  fontSize?: number;
  practiceMode: boolean;
}

const DEFAULT_READING_FONT_SIZE = 17;
const MIN_READING_FONT_SIZE = 15;
const MAX_READING_FONT_SIZE = 21;

function defaultClampReadingFontSize(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : DEFAULT_READING_FONT_SIZE;
  return Math.min(MAX_READING_FONT_SIZE, Math.max(MIN_READING_FONT_SIZE, Math.round(numericValue)));
}

function isReadingDraftAnnotation(value: unknown): value is IeltsReadingDraftAnnotation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<IeltsReadingDraftAnnotation>;
  return (
    typeof item.id === 'string' &&
    typeof item.passageNumber === 'number' &&
    typeof item.paragraphIndex === 'number' &&
    typeof item.start === 'number' &&
    typeof item.end === 'number' &&
    item.end > item.start
  );
}

export function coerceIeltsReadingDraft(
  raw: string | null,
  clampFontSize: (value: unknown) => number = defaultClampReadingFontSize,
): IeltsReadingDraft | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<IeltsReadingDraft>;
    if (typeof parsed.startedAt !== 'string' || !parsed.answers || typeof parsed.answers !== 'object') return null;
    return {
      startedAt: parsed.startedAt,
      answers: parsed.answers as IeltsReadingAnswerMap,
      selectedPassage: parsed.selectedPassage ?? 1,
      flags: Array.isArray(parsed.flags) ? parsed.flags.filter((item): item is number => typeof item === 'number') : [],
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations.filter(isReadingDraftAnnotation) : [],
      fontSize: clampFontSize(parsed.fontSize),
      practiceMode: parsed.practiceMode === true,
    };
  } catch {
    return null;
  }
}
