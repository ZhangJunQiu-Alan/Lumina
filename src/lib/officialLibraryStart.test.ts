import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedVocabularyEntry } from './importFlow';
import { startNextOfficialBatch, type StartNextOfficialBatchInput } from './officialLibraryStart';

const testState = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  fetchVocabularyEntriesByWords: vi.fn(),
  persistEnrichedVocabularyEntries: vi.fn(),
  apiFetch: vi.fn(),
  invalidateLibraryCache: vi.fn(),
  createLearningGroupFromVocabularyEntries: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: testState.rpc,
    from: testState.from,
  },
}));

vi.mock('./importFlow', () => ({
  createLearningGroupFromVocabularyEntries: testState.createLearningGroupFromVocabularyEntries,
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

function buildStartInput(overrides: Partial<StartNextOfficialBatchInput> = {}): StartNextOfficialBatchInput {
  return {
    userId: 'user-1',
    libraryId: 'ielts-vocab',
    mode: 'sequential',
    existingGroupCount: 0,
    ...overrides,
  };
}

describe('official library batch creation (immutable 30-word batches)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates an immutable group of official batch words when words are available', async () => {
    const entry = makeEntry('v1', 'abandon');
    testState.rpc.mockResolvedValue({
      data: [{ word: 'abandon', word_position: 0 }],
      error: null,
    });
    testState.fetchVocabularyEntriesByWords.mockResolvedValue({
      existing: [entry],
      missing: [],
    });
    testState.createLearningGroupFromVocabularyEntries.mockResolvedValue({
      groupId: 'group-101',
      words: [
        {
          id: 'v1',
          word: 'abandon',
          phonetic: '/abandon/',
          meaningZh: 'abandon 的释义',
          pos: 'n',
          exampleEn: 'This is abandon.',
          exampleZh: '',
          memoryTip: '',
        },
      ],
    });

    const result = await startNextOfficialBatch(buildStartInput());

    expect(testState.rpc).toHaveBeenCalledWith('official_next_batch', {
      p_user_id: 'user-1',
      p_library_id: 'ielts-vocab',
      p_mode: 'sequential',
      p_limit: 30,
    });
    expect(testState.createLearningGroupFromVocabularyEntries).toHaveBeenCalledTimes(1);
    expect(testState.invalidateLibraryCache).toHaveBeenCalledWith('user-1');
    expect(result).not.toBeNull();
    expect(result?.groupId).toBe('group-101');
    expect(result?.words).toHaveLength(1);
    expect(result?.libraryId).toBe('ielts-vocab');
    expect(result?.mode).toBe('sequential');
  });

  it('returns null when official library has no remaining words', async () => {
    testState.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await startNextOfficialBatch(buildStartInput());

    expect(result).toBeNull();
    expect(testState.createLearningGroupFromVocabularyEntries).not.toHaveBeenCalled();
    expect(testState.invalidateLibraryCache).not.toHaveBeenCalled();
  });
});
