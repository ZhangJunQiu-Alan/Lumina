import type { OfficialLibraryId, OfficialStudyMode } from './types.ts';

interface OfficialLibraryDefinition {
  id: OfficialLibraryId;
  groupPrefix: string;
  groupPattern: RegExp;
  counterPattern: RegExp;
  legacyGroupPatterns?: RegExp[];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOfficialGroupPattern(prefix: string) {
  return new RegExp(`^${escapeRegExp(prefix)}(\\d{4})-(\\d{4})$`);
}

function buildOfficialCounterPattern(prefix: string) {
  return new RegExp(`^${escapeRegExp(prefix)}(顺序|乱序) · 第(\\d+)组 · (\\d+)词$`);
}

const DEFINITIONS: OfficialLibraryDefinition[] = [
  { id: 'ielts-vocab', groupPrefix: '雅思词汇真经 · ', groupPattern: buildOfficialGroupPattern('雅思词汇真经 · '), counterPattern: buildOfficialCounterPattern('雅思词汇真经 · '), legacyGroupPatterns: [/^雅思词汇真经 · (\d{4})-(\d{4})$/] },
  { id: 'gre-zhenkao-v7', groupPrefix: 'GRE镇考机经词 7.0 · ', groupPattern: buildOfficialGroupPattern('GRE镇考机经词 7.0 · '), counterPattern: buildOfficialCounterPattern('GRE镇考机经词 7.0 · ') },
  { id: 'cet4-vocab', groupPrefix: '四级大纲核心词汇 · ', groupPattern: buildOfficialGroupPattern('四级大纲核心词汇 · '), counterPattern: buildOfficialCounterPattern('四级大纲核心词汇 · ') },
  { id: 'cet6-vocab', groupPrefix: '六级大纲核心词汇 · ', groupPattern: buildOfficialGroupPattern('六级大纲核心词汇 · '), counterPattern: buildOfficialCounterPattern('六级大纲核心词汇 · ') },
  { id: 'npee-vocab', groupPrefix: '考研英语大纲词汇 · ', groupPattern: buildOfficialGroupPattern('考研英语大纲词汇 · '), counterPattern: buildOfficialCounterPattern('考研英语大纲词汇 · ') },
  { id: 'gaokao-vocab', groupPrefix: '高考英语核心词汇 · ', groupPattern: buildOfficialGroupPattern('高考英语核心词汇 · '), counterPattern: buildOfficialCounterPattern('高考英语核心词汇 · ') },
  { id: 'tem4-vocab', groupPrefix: '英语专业四级(TEM4) · ', groupPattern: buildOfficialGroupPattern('英语专业四级(TEM4) · '), counterPattern: buildOfficialCounterPattern('英语专业四级(TEM4) · ') },
  { id: 'tem8-vocab', groupPrefix: '英语专业八级(TEM8) · ', groupPattern: buildOfficialGroupPattern('英语专业八级(TEM8) · '), counterPattern: buildOfficialCounterPattern('英语专业八级(TEM8) · ') },
];

const byId = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));

function matchOfficialGroupRange(definition: OfficialLibraryDefinition, groupName: string | null | undefined) {
  const patterns = [definition.groupPattern, ...(definition.legacyGroupPatterns ?? [])];
  return patterns.find((pattern) => pattern.test(groupName ?? '')) ?? null;
}

function isGroupOwnedByLibrary(definition: OfficialLibraryDefinition, groupName: string | null | undefined) {
  return Boolean(matchOfficialGroupRange(definition, groupName)) || definition.counterPattern.test(groupName ?? '');
}

export function isOfficialLibraryId(value: string | null | undefined): value is OfficialLibraryId {
  return byId.has((value ?? '') as OfficialLibraryId);
}

export function resolveOfficialLibraryId(
  libraryId: string | null | undefined,
  groupName: string | null | undefined,
  sourceType: 'custom' | 'system' | null | undefined,
): OfficialLibraryId | null {
  if (isOfficialLibraryId(libraryId)) return libraryId;
  for (const definition of DEFINITIONS) {
    if (isGroupOwnedByLibrary(definition, groupName)) return definition.id;
  }
  return sourceType === 'system' ? null : null;
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

export function resolveOfficialStudyModeFromGroupName(
  libraryId: OfficialLibraryId,
  groupName: string | null | undefined,
): OfficialStudyMode {
  const definition = byId.get(libraryId);
  const counterMatch = definition?.counterPattern.exec(groupName ?? '');
  return counterMatch?.[1] === '乱序' ? 'shuffle' : 'sequential';
}

export type { OfficialStudyMode };
