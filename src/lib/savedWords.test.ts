import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveToUserSavedWords } from './importFlow';
import { deleteLibraryGroup } from './libraryApi';

const database = vi.hoisted(() => ({ from: vi.fn(), savedUpsert: vi.fn(), deleteGroup: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: database }));
vi.mock('./api', () => ({ apiFetch: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  database.from.mockImplementation((table: string) => {
    if (table === 'user_saved_words')
      return {
        upsert: database.savedUpsert.mockReturnValue({
          select: async () => ({ data: [{ id: 'saved1' }], error: null }),
        }),
      };
    if (!['learning_groups', 'learning_group_words'].includes(table)) throw new Error(`Unexpected table ${table}`);
    return {
      select() {
        return this;
      },
      delete: database.deleteGroup.mockReturnThis(),
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: { id: 'group1', source_type: 'custom' }, error: null };
      },
      then(resolve: (value: unknown) => void) {
        return Promise.resolve(resolve({ data: null, count: 1201, error: null }));
      },
    };
  });
});

describe('independent bookmarks and learning groups', () => {
  it('imports bookmarks without creating, deleting or resetting review states', async () => {
    const entries = [{ id: 'learned-word', word: {} }] as unknown as Parameters<typeof saveToUserSavedWords>[0];
    expect(await saveToUserSavedWords(entries, 'user1', 'import')).toEqual({ saved: 1, skipped: 0, total: 1 });
    expect(database.from.mock.calls).toEqual([['user_saved_words']]);
    expect(database.savedUpsert).toHaveBeenCalledWith(
      [{ user_id: 'user1', vocabulary_item_id: 'learned-word', source: 'import' }],
      { onConflict: 'user_id,vocabulary_item_id', ignoreDuplicates: true },
    );
  });

  it('deleting a custom group preserves bookmarks, review history and review state', async () => {
    expect(await deleteLibraryGroup('user1', 'group1')).toEqual({
      deletedGroupId: 'group1',
      deletedWordCount: 1201,
      removedReviewStateCount: 0,
    });
    expect(database.from.mock.calls).toEqual([['learning_groups'], ['learning_group_words'], ['learning_groups']]);
    expect(database.deleteGroup).toHaveBeenCalledOnce();
  });
});
