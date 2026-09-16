import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryView } from './LibraryView';
import { invalidateLibraryCache } from '../../lib/libraryCache';

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), range: vi.fn(), migration: vi.fn(), legacy: false }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: db.from } }));
vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'library-test-user' } }) }));
vi.mock('../../contexts/LearningPreferencesContext', () => ({ useLearningPreferences: () => ({ preferences: {} }) }));
vi.mock('./SavedWordsPanel', () => ({ SavedWordsPanel: () => <div>收藏列表</div> }));
vi.mock('../../lib/learningSessionApi', () => ({
  fetchOfficialResumeCandidates: async () => ({}),
  fetchOfficialResumeTargets: vi.fn(),
}));
vi.mock('../../lib/libraryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/libraryApi')>()),
  fetchOfficialCompletionCounts: async () => ({}),
  migrateCustomGroupWordsIntoSavedWords: db.migration,
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.legacy = false;
  invalidateLibraryCache('library-test-user');
  db.from.mockImplementation((table: string) => {
    if (table !== 'learning_groups') throw new Error(`Unexpected table access: ${table}`);
    let selection = '';
    const query = {
      select: db.select.mockImplementation((value: string) => {
        selection = value;
        return query;
      }),
      eq: () => query,
      order: () => query,
      range: db.range.mockImplementation(async () => {
        if (db.legacy && selection.includes('session_round1_confirmed_word_ids')) {
          return { data: null, error: { message: 'column session_round1_confirmed_word_ids does not exist' } };
        }
        return {
          data: [
            {
              id: 'group1',
              group_name: '我的阅读生词',
              source_type: 'custom',
              library_id: null,
              status: 'active',
              created_at: '2026-09-15T00:00:00Z',
              completed_at: null,
              session_round: 'round2',
              session_queue_word_ids: ['a', 'b', 'a'],
              session_passed_queue_indices: [1],
              learning_group_words: [{ count: 2 }],
            },
            {
              id: 'group2',
              group_name: '第二组',
              source_type: 'custom',
              library_id: null,
              status: 'active',
              created_at: '2026-09-16T00:00:00Z',
              completed_at: null,
              session_round: null,
              learning_group_words: [{ count: 1201 }],
            },
          ],
          error: null,
        };
      }),
    };
    return query;
  });
});
afterEach(cleanup);

describe('personal library page', () => {
  it.each([false, true])(
    'opens multiple pending groups without migrating or deleting data (legacy=%s)',
    async (legacy) => {
      db.legacy = legacy;
      const start = vi.fn();
      for (let visit = 0; visit < 2; visit += 1) {
        const view = render(
          <MemoryRouter>
            <LibraryView onStartLearningGroup={start} />
          </MemoryRouter>,
        );
        await screen.findByText('我的阅读生词');
        expect(screen.getByText('本轮已完成 1/2 词')).toBeInTheDocument();
        expect(screen.getByText('第一轮 · 记忆 · 共 1201 词')).toBeInTheDocument();
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '继续学习：我的阅读生词' }));
        });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: '继续学习：第二组' }));
        });
        view.unmount();
      }
      expect(start.mock.calls).toEqual([['group1'], ['group2'], ['group1'], ['group2']]);
      expect(db.migration).not.toHaveBeenCalled();
      expect(db.select.mock.calls[0][0]).toContain('learning_group_words ( count )');
      expect(db.range).toHaveBeenCalledTimes(legacy ? 2 : 1);
    },
  );
});
