import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedVocabularyEntry } from './importFlow';
import {
  appendNextOfficialBatchToLearningGroup,
  clearOfficialAppendPreparationCache,
  preloadNextOfficialBatchForAppend,
  type AppendNextOfficialBatchInput,
} from './officialLibraryStart';

const testState = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  fetchVocabularyEntriesByWords: vi.fn(),
  persistEnrichedVocabularyEntries: vi.fn(),
  apiFetch: vi.fn(),
  invalidateLibraryCache: vi.fn(),
  learningGroupWordsInsert: vi.fn(),
  learningGroupWordsSelectEq: vi.fn(),
  reviewStatesUpsert: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: testState.rpc,
    from: testState.from,
  },
}));

vi.mock('./importFlow', () => ({
  createLearningGroupFromVocabularyEntries: vi.fn(),
  fetchVocabularyEntriesByWords: testState.fetchVocabularyEntriesByWords,
  persistEnrichedVocabularyEntries: testState.persistEnrichedVocabularyEntries,
}));

vi.mock('./api', () => ({
  apiFetch: testState.apiFetch,
}));

vi.mock('./libraryCache', () => ({
  invalidateLibraryCache: testState.invalidateLibraryCache,
}));

function makeEntry(id: string, word: string): PersistedVocabularyEntry {
  return {
    id,
    word,
    ipa_uk: `/${word}/`,
    ipa_us: `/${word}/`,
    primary_meaning_zh: `${word} 的释义`,
    ner_label: null,
    senses: [
      {
        pos: 'n',
        meaning_zh: `${word} 的释义`,
        example_sentence: `This is ${word}.`,
        example_translation_zh: '',
      },
    ],
    morphology: { summary_zh: '', parts: [] },
    derived_words: [],
    synonyms: [],
    antonyms: [],
    confusions: [],
    memory_tip: '',
    source_type: 'system',
    audio_uk_url: null,
    audio_us_url: null,
  };
}

function installSupabaseTableMocks(
  existingRows: Array<{ vocabulary_item_id: string; sequence_no: number | null }> = [],
) {
  testState.learningGroupWordsSelectEq.mockResolvedValue({ data: existingRows, error: null });
  testState.learningGroupWordsInsert.mockResolvedValue({ error: null });
  testState.reviewStatesUpsert.mockResolvedValue({ error: null });
  testState.from.mockImplementation((table: string) => {
    if (table === 'learning_group_words') {
      return {
        select: vi.fn(() => ({
          eq: testState.learningGroupWordsSelectEq,
        })),
        insert: testState.learningGroupWordsInsert,
      };
    }

    if (table === 'review_states') {
      return {
        upsert: testState.reviewStatesUpsert,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

function buildInput(overrides: Partial<AppendNextOfficialBatchInput> = {}): AppendNextOfficialBatchInput {
  return {
    userId: 'user-1',
    groupId: 'group-1',
    libraryId: 'ielts-vocab',
    mode: 'sequential',
    existingGroupCount: 1,
    ...overrides,
  };
}

describe('official library append preparation cache', () => {
  afterEach(() => {
    clearOfficialAppendPreparationCache();
    vi.clearAllMocks();
  });

  it('reuses an in-flight preloaded next batch when appending', async () => {
    installSupabaseTableMocks();
    const entry = makeEntry('v1', 'abandon');
    let resolveRpc: (value: { data: Array<{ word: string; word_position: number }>; error: null }) => void = () => {};
    testState.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    testState.fetchVocabularyEntriesByWords.mockResolvedValue({ existing: [entry], missing: [] });

    const input = buildInput();
    const preloadPromise = preloadNextOfficialBatchForAppend(input);
    const appendPromise = appendNextOfficialBatchToLearningGroup(input);

    expect(testState.rpc).toHaveBeenCalledTimes(1);

    resolveRpc({ data: [{ word: 'abandon', word_position: 0 }], error: null });

    await preloadPromise;
    const result = await appendPromise;

    expect(testState.fetchVocabularyEntriesByWords).toHaveBeenCalledTimes(1);
    expect(testState.learningGroupWordsInsert).toHaveBeenCalledTimes(1);
    expect(testState.reviewStatesUpsert).toHaveBeenCalledTimes(1);
    expect(result?.appendedWords.map((word) => word.word)).toEqual(['abandon']);
  });

  it('drops the append preparation cache after a successful append', async () => {
    installSupabaseTableMocks();
    const firstEntry = makeEntry('v1', 'abandon');
    const secondEntry = makeEntry('v2', 'ability');
    testState.rpc
      .mockResolvedValueOnce({ data: [{ word: 'abandon', word_position: 0 }], error: null })
      .mockResolvedValueOnce({ data: [{ word: 'ability', word_position: 1 }], error: null });
    testState.fetchVocabularyEntriesByWords
      .mockResolvedValueOnce({ existing: [firstEntry], missing: [] })
      .mockResolvedValueOnce({ existing: [secondEntry], missing: [] });

    const input = buildInput();
    await preloadNextOfficialBatchForAppend(input);
    await appendNextOfficialBatchToLearningGroup(input);
    await appendNextOfficialBatchToLearningGroup(input);

    expect(testState.rpc).toHaveBeenCalledTimes(2);
    expect(testState.fetchVocabularyEntriesByWords).toHaveBeenCalledTimes(2);
  });
});
