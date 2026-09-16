import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningGroupFromSavedWords, saveWordToLibrary } from './library';
import { queueFullEnrichmentForVocabularyItemId } from './vocab';

const database = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  ids: [] as string[][],
  missingId: '',
}));

vi.mock('./supabase.ts', () => ({ supabaseAdmin: database }));
vi.mock('./vocab.ts', () => ({ queueFullEnrichmentForVocabularyItemId: vi.fn() }));
vi.mock('./home.ts', () => ({ OFFICIAL_LIBRARY_TITLES: {}, OFFICIAL_LIBRARY_TOTALS: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  database.ids = [];
  database.missingId = '';
  database.rpc.mockResolvedValue({ data: 'group1', error: null });
  database.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn(async (_column: string, ids: string[]) => {
        database.ids.push(ids);
        return {
          data: ids.filter((id) => id !== database.missingId).map((id) => ({ vocabulary_item_id: id })),
          error: null,
        };
      }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], count: 2, error: null }),
    };
    if (table === 'learning_groups') return query;
    return query;
  });
});

describe('saved vocabulary learning groups', () => {
  it('bookmarks a word without inspecting or changing its learning state', async () => {
    vi.mocked(queueFullEnrichmentForVocabularyItemId).mockResolvedValue({
      queued: false,
      reason: 'already_full',
    } as Awaited<ReturnType<typeof queueFullEnrichmentForVocabularyItemId>>);
    const upsert = vi.fn().mockReturnValue({ select: async () => ({ data: [{ id: 'saved1' }], error: null }) });
    database.from.mockImplementation((table: string) => {
      if (table !== 'user_saved_words') throw new Error(`Unexpected table ${table}`);
      return { upsert };
    });
    expect(await saveWordToLibrary('user1', 'learned-word')).toMatchObject({ saved: true, inserted: true });
    expect(database.from).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ vocabulary_item_id: 'learned-word', user_id: 'user1' }),
      expect.objectContaining({ ignoreDuplicates: true }),
    );
  });
  it.each([1, 7, 30, 45, 1001])('accepts %i selected words and preserves order', async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `word-${index}`);
    await expect(createLearningGroupFromSavedWords('user1', ids)).resolves.toEqual({
      groupId: 'group1',
      wordCount: count,
    });
    expect(database.ids.flat()).toEqual(ids);
    expect(database.ids.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(database.rpc).toHaveBeenCalledWith(
      'create_learning_group_exclusive',
      expect.objectContaining({
        p_user_id: 'user1',
        p_vocabulary_item_ids: ids,
        p_group_name: `个人词库 · 第 3 组 · ${count} 词`,
      }),
    );
  });

  it('rejects an empty selection before writing', async () => {
    await expect(createLearningGroupFromSavedWords('user1', ['', ' '])).rejects.toThrow('请选择至少 1 个单词');
    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it('deduplicates selected ids and rejects words missing from the user library', async () => {
    await createLearningGroupFromSavedWords('user1', [' word1 ', 'word1']);
    expect(database.rpc.mock.calls[0][1].p_vocabulary_item_ids).toEqual(['word1']);
    database.rpc.mockClear();
    database.missingId = 'word2';
    await expect(createLearningGroupFromSavedWords('user1', ['word1', 'word2'])).rejects.toThrow(
      '部分单词已不在个人词库',
    );
    expect(database.rpc).not.toHaveBeenCalled();
  });
});
