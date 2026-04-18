import { IELTS_WORDS_FLAT } from '../data/ielts-vocab';
import type { LibraryGroupSummary } from '../types';

export const OFFICIAL_LIBRARY_TITLE = '雅思词汇真经';
export const OFFICIAL_GROUP_PREFIX = `${OFFICIAL_LIBRARY_TITLE} · `;
export const OFFICIAL_PROGRESS_KEY = 'ielts_vocab_progress';
export const OFFICIAL_BATCH_SIZE = 30;
export const OFFICIAL_TOTAL_WORDS = IELTS_WORDS_FLAT.length;

const OFFICIAL_GROUP_PATTERN = /^雅思词汇真经 · (\d{4})-(\d{4})$/;

export interface OfficialBatchPlan {
  words: string[];
  groupName: string;
  nextProgress: number;
}

function clampProgress(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), OFFICIAL_TOTAL_WORDS);
}

export function isOfficialGroupName(groupName: string | null | undefined): boolean {
  return OFFICIAL_GROUP_PATTERN.test(groupName ?? '');
}

export function parseOfficialGroupRange(groupName: string | null | undefined) {
  const match = OFFICIAL_GROUP_PATTERN.exec(groupName ?? '');
  if (!match) return null;

  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);

  if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end < start) {
    return null;
  }

  return { start, end };
}

export function resolveLibraryGroupSourceType(
  sourceType: 'custom' | 'system' | null | undefined,
  groupName: string | null | undefined,
): 'custom' | 'system' {
  if (sourceType === 'system' || isOfficialGroupName(groupName)) {
    return 'system';
  }

  return 'custom';
}

export function formatOfficialGroupName(progress: number, batchLength: number): string {
  const start = String(progress + 1).padStart(4, '0');
  const end = String(progress + batchLength).padStart(4, '0');
  return `${OFFICIAL_LIBRARY_TITLE} · ${start}-${end}`;
}

export function readOfficialProgress() {
  if (typeof window === 'undefined') return 0;

  const stored = window.localStorage.getItem(OFFICIAL_PROGRESS_KEY);
  return clampProgress(Number.parseInt(stored ?? '0', 10));
}

export function writeOfficialProgress(nextIndex: number) {
  const clamped = clampProgress(nextIndex);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(OFFICIAL_PROGRESS_KEY, String(clamped));
  }

  return clamped;
}

export function deriveOfficialProgress(groups: Pick<LibraryGroupSummary, 'sourceType' | 'title'>[]) {
  const savedProgress = groups.reduce((maxProgress, group) => {
    if (group.sourceType !== 'system') return maxProgress;

    const range = parseOfficialGroupRange(group.title);
    if (!range) return maxProgress;

    return Math.max(maxProgress, range.end);
  }, 0);

  if (savedProgress > 0) {
    return clampProgress(savedProgress);
  }

  return readOfficialProgress();
}

export function getOfficialBatchWords(progress: number) {
  return IELTS_WORDS_FLAT.slice(progress, progress + OFFICIAL_BATCH_SIZE);
}

export function getOfficialBatchPlan(progress: number): OfficialBatchPlan | null {
  const words = getOfficialBatchWords(progress);
  if (words.length === 0) return null;

  return {
    words,
    groupName: formatOfficialGroupName(progress, words.length),
    nextProgress: progress + words.length,
  };
}
