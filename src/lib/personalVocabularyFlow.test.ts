import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPersistedVocabularyEntriesByIds } from './importFlow';
import { fetchLearningGroupSession } from './learningSessionApi';

const database = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: database }));
vi.mock('./api', () => ({ apiFetch: vi.fn() }));
vi.mock('./learningRecovery', () => ({
  readLearningRecovery: () => null,
  cacheLearningRecovery: vi.fn(),
  cacheLearningProgress: vi.fn(),
}));
vi.mock('./syncQueue', () => ({
  pendingJobs: () => [],
  registerSyncHandler: vi.fn(),
  enqueueSync: vi.fn(),
  flushSyncQueue: vi.fn(),
}));

const ids = Array.from({ length: 1201 }, (_, index) => `id-${index}`);
const entries = ids.map((id, index) => ({
  id,
  word: `word${index}`,
  ipa_uk: '',
  ipa_us: '',
  primary_meaning_zh: '',
  ner_label: null,
  morphology_summary_zh: '',
  memory_tip: '',
  source_type: 'custom',
  audio_uk_url: null,
  audio_us_url: null,
  vocabulary_senses: [],
  vocabulary_morphology_parts: [],
  vocabulary_relations: [],
  confused_words: [],
}));

beforeEach(() => {
  vi.clearAllMocks();
  database.from.mockImplementation((table: string) => {
    let start = 0;
    let end = 999;
    let selectedIds = ids;
    const resolveData = () => {
      if (table === 'vocabulary_items') return entries.filter((entry) => selectedIds.includes(entry.id)).reverse();
      if (table === 'learning_groups')
        return {
          id: 'group1',
          group_name: '个人词库 · 1201 词',
          source_type: 'custom',
          library_id: null,
          created_at: '2026-09-16T00:00:00Z',
          status: 'active',
          completed_at: null,
          session_round: 'round2',
          session_current_index: 1200,
          session_queue_word_ids: ids,
          session_passed_queue_indices: [],
          session_round1_confirmed_word_ids: ids,
          session_last_active_at: '2026-09-16T01:00:00Z',
        };
      if (table === 'learning_group_words')
        return entries.slice(start, end + 1).map((entry, index) => ({
          sequence_no: start + index,
          vocabulary_item_id: entry.id,
          vocabulary_items: entry,
          round1_confirmed_at: '2026-09-16T01:00:00Z',
          round2_required: true,
          round3_required: true,
        }));
      if (table === 'generated_articles') return null;
      if (table === 'review_states') return selectedIds.map((id) => ({ vocabulary_item_id: id, memory_state: 'new' }));
      return [];
    };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      range: vi.fn((from: number, to: number) => {
        start = from;
        end = to;
        return query;
      }),
      in: vi.fn((_column: string, values: string[]) => {
        selectedIds = values;
        return query;
      }),
      then: (resolve: (value: unknown) => void) => resolve({ data: resolveData(), error: null }),
    };
    return query;
  });
});

describe('large personal vocabulary groups', () => {
  it('loads all selected entries in selection order across query batches', async () => {
    const result = await fetchPersistedVocabularyEntriesByIds(ids);
    expect(result.map((entry) => entry.id)).toEqual(ids);
    expect(database.from).toHaveBeenCalledTimes(7);
  });

  it('restores every word and the current position beyond the default database page size', async () => {
    const result = await fetchLearningGroupSession('user1', 'group1');
    expect(result?.words.map((word) => word.id)).toEqual(ids);
    expect(result?.session?.round1ConfirmedWordIds).toEqual(ids);
    expect(result?.session?.queueWordIds).toEqual(ids);
    expect(result?.session?.currentIndex).toBe(1200);
  });
});
