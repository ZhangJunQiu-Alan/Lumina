import { GRE_ZHENKAO_V7_TITLE, GRE_ZHENKAO_V7_WORDS } from '../data/gre-zhenkao-v7';
import { IELTS_CHAPTERS, IELTS_WORDS_FLAT } from '../data/ielts-vocab';
import type {
  LibraryGroupSummary,
  OfficialLibraryId,
  OfficialLibrarySummary,
  ResumeCandidate,
} from '../types';

export interface OfficialLibraryDefinition {
  id: OfficialLibraryId;
  title: string;
  groupPrefix: string;
  batchSize: number;
  words: string[];
  description: string;
  groupPattern: RegExp;
  legacyGroupPatterns?: RegExp[];
}

export interface OfficialBatchPlan {
  words: string[];
  groupName: string;
  nextProgress: number;
}

const DEFAULT_BATCH_SIZE = 30;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOfficialGroupPattern(prefix: string) {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d{4})-(\\d{4})$`);
}

export const OFFICIAL_LIBRARY_DEFINITIONS: OfficialLibraryDefinition[] = [
  {
    id: 'ielts-vocab',
    title: '雅思词汇真经',
    groupPrefix: '雅思词汇真经 · ',
    batchSize: DEFAULT_BATCH_SIZE,
    words: IELTS_WORDS_FLAT,
    description: `${IELTS_CHAPTERS.length} 章 · ${IELTS_WORDS_FLAT.length} 词 · 按顺序推进。每次直接取接下来的 ${DEFAULT_BATCH_SIZE} 词，优先复用已经整理好的词条，缺的再补齐后直接开始。`,
    groupPattern: buildOfficialGroupPattern('雅思词汇真经 · '),
    legacyGroupPatterns: [/^雅思词汇真经 · (\d{4})-(\d{4})$/],
  },
  {
    id: 'gre-zhenkao-v7',
    title: GRE_ZHENKAO_V7_TITLE,
    groupPrefix: `${GRE_ZHENKAO_V7_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: GRE_ZHENKAO_V7_WORDS,
    description: `机经词表 · ${GRE_ZHENKAO_V7_WORDS.length} 词 · 按顺序推进。每次直接取接下来的 ${DEFAULT_BATCH_SIZE} 词，优先复用已经整理好的词条，缺的再补齐后直接开始。`,
    groupPattern: buildOfficialGroupPattern(`${GRE_ZHENKAO_V7_TITLE} · `),
  },
];

const officialLibraryDefinitionById = new Map(
  OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const officialWordOrder = new Map(
  OFFICIAL_LIBRARY_DEFINITIONS.map((definition) => [
    definition.id,
    new Map(definition.words.map((word, index) => [word.trim().toLowerCase(), index])),
  ]),
);

function clampProgress(libraryId: OfficialLibraryId, value: number): number {
  const totalWords = getOfficialLibraryDefinition(libraryId).words.length;
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), totalWords);
}

function matchOfficialGroupRange(definition: OfficialLibraryDefinition, groupName: string | null | undefined) {
  const patterns = [definition.groupPattern, ...(definition.legacyGroupPatterns ?? [])];

  for (const pattern of patterns) {
    const match = pattern.exec(groupName ?? '');
    if (match) {
      return match;
    }
  }

  return null;
}

export function isOfficialLibraryId(value: string | null | undefined): value is OfficialLibraryId {
  return officialLibraryDefinitionById.has((value ?? '') as OfficialLibraryId);
}

export function getOfficialLibraryDefinition(libraryId: OfficialLibraryId): OfficialLibraryDefinition {
  const definition = officialLibraryDefinitionById.get(libraryId);
  if (!definition) {
    throw new Error(`Unknown official library: ${libraryId}`);
  }

  return definition;
}

export function resolveOfficialLibraryId(
  libraryId: string | null | undefined,
  groupName: string | null | undefined,
  sourceType: 'custom' | 'system' | null | undefined,
): OfficialLibraryId | null {
  if (isOfficialLibraryId(libraryId)) {
    return libraryId;
  }

  for (const definition of OFFICIAL_LIBRARY_DEFINITIONS) {
    if (matchOfficialGroupRange(definition, groupName)) {
      return definition.id;
    }
  }

  if (sourceType !== 'system') {
    return null;
  }

  return null;
}

export function isOfficialGroupName(groupName: string | null | undefined): boolean {
  return OFFICIAL_LIBRARY_DEFINITIONS.some((definition) => Boolean(matchOfficialGroupRange(definition, groupName)));
}

export function parseOfficialGroupRange(
  libraryId: OfficialLibraryId,
  groupName: string | null | undefined,
) {
  const match = matchOfficialGroupRange(getOfficialLibraryDefinition(libraryId), groupName);
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
  libraryId: string | null | undefined,
  groupName: string | null | undefined,
): 'custom' | 'system' {
  if (sourceType === 'system' || resolveOfficialLibraryId(libraryId, groupName, sourceType)) {
    return 'system';
  }

  return 'custom';
}

export function formatOfficialGroupName(
  libraryId: OfficialLibraryId,
  progress: number,
  batchLength: number,
): string {
  const definition = getOfficialLibraryDefinition(libraryId);
  const start = String(progress + 1).padStart(4, '0');
  const end = String(progress + batchLength).padStart(4, '0');
  return `${definition.groupPrefix}${start}-${end}`;
}

export function deriveOfficialProgress(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'title' | 'libraryId'>[],
) {
  return groups.reduce((maxProgress, group) => {
    if (group.sourceType !== 'system' || group.libraryId !== libraryId) {
      return maxProgress;
    }

    const range = parseOfficialGroupRange(libraryId, group.title);
    if (!range) return maxProgress;

    return Math.max(maxProgress, range.end);
  }, 0);
}

export function countUnlockedOfficialWords(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'wordCount' | 'libraryId'>[],
) {
  return clampProgress(
    libraryId,
    groups.reduce((count, group) => (
      group.sourceType === 'system' && group.libraryId === libraryId ? count + group.wordCount : count
    ), 0),
  );
}

export function getOfficialBatchWords(libraryId: OfficialLibraryId, progress: number) {
  const definition = getOfficialLibraryDefinition(libraryId);
  return definition.words.slice(progress, progress + definition.batchSize);
}

export function getOfficialBatchPlan(libraryId: OfficialLibraryId, progress: number): OfficialBatchPlan | null {
  const definition = getOfficialLibraryDefinition(libraryId);
  const words = getOfficialBatchWords(libraryId, progress);
  if (words.length === 0) return null;

  return {
    words,
    groupName: formatOfficialGroupName(libraryId, progress, words.length),
    nextProgress: progress + words.length,
  };
}

export function buildOfficialLibrarySummary(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'title' | 'wordCount' | 'libraryId'>[],
  resumeCandidate: ResumeCandidate | null,
): OfficialLibrarySummary {
  const progress = clampProgress(libraryId, deriveOfficialProgress(libraryId, groups));
  const nextBatchPlan = getOfficialBatchPlan(libraryId, progress);

  return {
    progress,
    nextBatchSize: nextBatchPlan?.words.length ?? 0,
    unlockedWordCount: countUnlockedOfficialWords(libraryId, groups),
    resumeCandidate,
    completed: !nextBatchPlan,
  };
}

export function resolveOfficialLibraryStartMode(
  summary: Pick<OfficialLibrarySummary, 'resumeCandidate' | 'completed'>,
) {
  if (summary.resumeCandidate) {
    return 'resume' as const;
  }

  return summary.completed ? 'completed' as const : 'new' as const;
}

export function getOfficialWordPosition(libraryId: OfficialLibraryId, word: string) {
  return officialWordOrder.get(libraryId)?.get(word.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
}

export function sortWordsByOfficialOrder<T extends { word: string }>(
  libraryId: OfficialLibraryId,
  words: T[],
) {
  return [...words].sort((left, right) => {
    const leftOrder = getOfficialWordPosition(libraryId, left.word);
    const rightOrder = getOfficialWordPosition(libraryId, right.word);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.word.localeCompare(right.word);
  });
}
