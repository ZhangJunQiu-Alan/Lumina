import { GRE_ZHENKAO_V7_TITLE, GRE_ZHENKAO_V7_WORDS } from '../data/gre-zhenkao-v7';
import { IELTS_CHAPTERS, IELTS_WORDS_FLAT } from '../data/ielts-vocab';
import { CET4_TITLE, CET4_WORDS } from '../data/cet4-vocab';
import { CET6_TITLE, CET6_WORDS } from '../data/cet6-vocab';
import { TEM4_TITLE, TEM4_WORDS } from '../data/tem4-vocab';
import { TEM8_TITLE, TEM8_WORDS } from '../data/tem8-vocab';
import { NPEE_TITLE, NPEE_WORDS } from '../data/npee-vocab';
import type {
  LibraryGroupSummary,
  OfficialLibraryId,
  OfficialResumeTargets,
  OfficialLibrarySummary,
} from '../types';
import { isCoreLearningComplete } from './learningSession';

export type OfficialStudyMode = 'sequential' | 'shuffle';

export interface OfficialLibraryDefinition {
  id: OfficialLibraryId;
  title: string;
  groupPrefix: string;
  batchSize: number;
  words: string[];
  description: string;
  groupPattern: RegExp;
  counterPattern: RegExp;
  legacyGroupPatterns?: RegExp[];
  icon?: string;
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

function buildOfficialCounterPattern(prefix: string) {
  return new RegExp(`^${escapeRegExp(prefix)}(顺序|乱序) · 第(\\d+)组 · (\\d+)词$`);
}

export const OFFICIAL_LIBRARY_DEFINITIONS: OfficialLibraryDefinition[] = [
  {
    id: 'ielts-vocab',
    title: '雅思词汇真经',
    groupPrefix: '雅思词汇真经 · ',
    batchSize: DEFAULT_BATCH_SIZE,
    words: IELTS_WORDS_FLAT,
    description: `${IELTS_CHAPTERS.length} 章 · ${IELTS_WORDS_FLAT.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern('雅思词汇真经 · '),
    counterPattern: buildOfficialCounterPattern('雅思词汇真经 · '),
    legacyGroupPatterns: [/^雅思词汇真经 · (\d{4})-(\d{4})$/],
    icon: 'BookOpen',
  },
  {
    id: 'gre-zhenkao-v7',
    title: GRE_ZHENKAO_V7_TITLE,
    groupPrefix: `${GRE_ZHENKAO_V7_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: GRE_ZHENKAO_V7_WORDS,
    description: `机经词表 · ${GRE_ZHENKAO_V7_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${GRE_ZHENKAO_V7_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${GRE_ZHENKAO_V7_TITLE} · `),
    icon: 'Sparkles',
  },
  {
    id: 'cet4-vocab',
    title: CET4_TITLE,
    groupPrefix: `${CET4_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: CET4_WORDS,
    description: `核心词汇 · ${CET4_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${CET4_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${CET4_TITLE} · `),
    icon: 'GraduationCap',
  },
  {
    id: 'cet6-vocab',
    title: CET6_TITLE,
    groupPrefix: `${CET6_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: CET6_WORDS,
    description: `核心词汇 · ${CET6_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${CET6_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${CET6_TITLE} · `),
    icon: 'Award',
  },
  {
    id: 'npee-vocab',
    title: NPEE_TITLE,
    groupPrefix: `${NPEE_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: NPEE_WORDS,
    description: `大纲词汇 · ${NPEE_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${NPEE_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${NPEE_TITLE} · `),
    icon: 'Library',
  },
  {
    id: 'tem4-vocab',
    title: TEM4_TITLE,
    groupPrefix: `${TEM4_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: TEM4_WORDS,
    description: `专业四级 · ${TEM4_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${TEM4_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${TEM4_TITLE} · `),
    icon: 'BookMarked',
  },
  {
    id: 'tem8-vocab',
    title: TEM8_TITLE,
    groupPrefix: `${TEM8_TITLE} · `,
    batchSize: DEFAULT_BATCH_SIZE,
    words: TEM8_WORDS,
    description: `专业八级 · ${TEM8_WORDS.length} 词 · 顺序或乱序都行，每次直接取 ${DEFAULT_BATCH_SIZE} 词，已学过的自动跳过。`,
    groupPattern: buildOfficialGroupPattern(`${TEM8_TITLE} · `),
    counterPattern: buildOfficialCounterPattern(`${TEM8_TITLE} · `),
    icon: 'Medal',
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

function isGroupOwnedByLibrary(definition: OfficialLibraryDefinition, groupName: string | null | undefined) {
  return (
    matchOfficialGroupRange(definition, groupName) !== null
    || definition.counterPattern.test(groupName ?? '')
  );
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
    if (isGroupOwnedByLibrary(definition, groupName)) {
      return definition.id;
    }
  }

  if (sourceType !== 'system') {
    return null;
  }

  return null;
}

export function isOfficialGroupName(groupName: string | null | undefined): boolean {
  return OFFICIAL_LIBRARY_DEFINITIONS.some((definition) => isGroupOwnedByLibrary(definition, groupName));
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

export function formatOfficialCounterGroupName(
  libraryId: OfficialLibraryId,
  mode: OfficialStudyMode,
  groupIndex: number,
  batchLength: number,
): string {
  const definition = getOfficialLibraryDefinition(libraryId);
  const modeLabel = mode === 'shuffle' ? '乱序' : '顺序';
  return `${definition.groupPrefix}${modeLabel} · 第${groupIndex}组 · ${batchLength}词`;
}

export function resolveOfficialStudyModeFromGroupName(
  libraryId: OfficialLibraryId,
  groupName: string | null | undefined,
): OfficialStudyMode {
  const definition = getOfficialLibraryDefinition(libraryId);
  const counterMatch = definition.counterPattern.exec(groupName ?? '');
  if (counterMatch) {
    return counterMatch[1] === '乱序' ? 'shuffle' : 'sequential';
  }

  return 'sequential';
}

export function deriveOfficialProgress(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'title' | 'libraryId' | 'status' | 'completedAt' | 'sessionRound'>[],
) {
  return groups.reduce((maxProgress, group) => {
    if (
      group.sourceType !== 'system'
      || group.libraryId !== libraryId
      || !isCoreLearningComplete({
        status: group.status,
        completedAt: group.completedAt,
        sessionRound: group.sessionRound,
      })
    ) {
      return maxProgress;
    }

    const range = parseOfficialGroupRange(libraryId, group.title);
    if (!range) return maxProgress;

    return Math.max(maxProgress, range.end);
  }, 0);
}

export function countUnlockedOfficialWords(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'wordCount' | 'libraryId' | 'status' | 'completedAt' | 'sessionRound'>[],
) {
  return clampProgress(
    libraryId,
    groups.reduce((count, group) => {
      if (
        group.sourceType !== 'system'
        || group.libraryId !== libraryId
        || !isCoreLearningComplete({
          status: group.status,
          completedAt: group.completedAt,
          sessionRound: group.sessionRound,
        })
      ) {
        return count;
      }

      return count + group.wordCount;
    }, 0),
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

export function getOfficialNextBatch(
  libraryId: OfficialLibraryId,
  learnedLowercase: ReadonlySet<string>,
  mode: OfficialStudyMode,
  existingGroupCount: number,
  progress: number,
): { words: string[]; groupName: string } | null {
  const definition = getOfficialLibraryDefinition(libraryId);
  const remaining = definition.words.filter(
    (word) => !learnedLowercase.has(word.trim().toLowerCase()),
  );

  if (remaining.length === 0) return null;

  const picked = mode === 'sequential'
    ? remaining.slice(0, definition.batchSize)
    : (() => {
        const pool = [...remaining];
        for (let i = pool.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, definition.batchSize);
      })();

  if (mode === 'sequential') {
    const positions = picked.map((word) => getOfficialWordPosition(libraryId, word));
    const isContiguous = positions.every((position, index) => (
      position !== Number.MAX_SAFE_INTEGER
      && position === positions[0] + index
    ));

    if (isContiguous) {
      return {
        words: picked,
        groupName: formatOfficialGroupName(libraryId, positions[0], picked.length),
      };
    }
  }

  const groupIndex = existingGroupCount + 1;
  void progress;
  return {
    words: picked,
    groupName: formatOfficialCounterGroupName(libraryId, mode, groupIndex, picked.length),
  };
}

export function countExistingOfficialGroups(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'libraryId'>[],
) {
  return groups.reduce((count, group) => (
    group.sourceType === 'system' && group.libraryId === libraryId ? count + 1 : count
  ), 0);
}

export function buildOfficialLibrarySummary(
  libraryId: OfficialLibraryId,
  groups: Pick<LibraryGroupSummary, 'sourceType' | 'title' | 'wordCount' | 'libraryId' | 'status' | 'completedAt' | 'sessionRound'>[],
  resumeTargets: OfficialResumeTargets | null,
): OfficialLibrarySummary {
  const definition = getOfficialLibraryDefinition(libraryId);
  const unlockedWordCount = countUnlockedOfficialWords(libraryId, groups);
  const remaining = Math.max(0, definition.words.length - unlockedWordCount);
  const nextBatchSize = Math.min(definition.batchSize, remaining);

  return {
    progress: unlockedWordCount,
    nextBatchSize,
    unlockedWordCount,
    activeResumeCandidate: resumeTargets?.active ?? null,
    reinforcementCandidate: resumeTargets?.reinforcement ?? null,
    completed: remaining === 0,
  };
}

export function resolveOfficialLibraryStartMode(
  summary: Pick<OfficialLibrarySummary, 'activeResumeCandidate' | 'completed'>,
) {
  if (summary.activeResumeCandidate) {
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
