import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { apiFetch } from '../lib/api';
import { invalidateLibraryCache } from '../lib/libraryCache';
import { supabase } from '../lib/supabase';
import { invalidateWord, updateCachedLookup } from '../lib/wordLookup';

type SavedWordSource = 'reading_popup' | 'manual';

interface SaveWordResponse {
  saved?: boolean;
  inserted?: boolean;
  skippedReason?: 'non_new_state';
}

interface SavedWordsContextValue {
  saveWord: (vocabularyItemId: string, source?: SavedWordSource) => Promise<SaveWordResponse>;
  removeWord: (vocabularyItemId: string) => Promise<void>;
}

const SavedWordsContext = createContext<SavedWordsContextValue | null>(null);

async function readApiError(response: Response) {
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  return body.error ?? `HTTP ${response.status}`;
}

export function SavedWordsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return undefined;

    const channelName = `vocab-updates-${userId}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vocabulary_items' }, (payload) => {
        const word = typeof payload.new?.word === 'string' ? payload.new.word : '';
        if (word) {
          invalidateWord(word);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const saveWord = useCallback(
    async (vocabularyItemId: string, source: SavedWordSource = 'reading_popup') => {
      const response = await apiFetch('/api/library/saved-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyItemId, source }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = await response.json().catch(() => ({ data: {} as SaveWordResponse }));
      const result = (payload as { data?: SaveWordResponse }).data;

      if (result?.saved === false || result?.skippedReason === 'non_new_state') {
        updateCachedLookup(vocabularyItemId, (current) => ({
          ...current,
          in_user_library: false,
        }));
        invalidateLibraryCache(userId);
        return result ?? { saved: false, skippedReason: 'non_new_state' };
      }

      updateCachedLookup(vocabularyItemId, (current) => ({
        ...current,
        in_user_library: true,
      }));
      invalidateLibraryCache(userId);
      return result ?? { saved: true };
    },
    [userId],
  );

  const removeWord = useCallback(
    async (vocabularyItemId: string) => {
      const response = await apiFetch(`/api/library/saved-words/${encodeURIComponent(vocabularyItemId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      updateCachedLookup(vocabularyItemId, (current) => ({
        ...current,
        in_user_library: false,
      }));
      invalidateLibraryCache(userId);
    },
    [userId],
  );

  const value = useMemo(
    () => ({
      saveWord,
      removeWord,
    }),
    [removeWord, saveWord],
  );

  return <SavedWordsContext.Provider value={value}>{children}</SavedWordsContext.Provider>;
}

export function useSavedWords() {
  const context = useContext(SavedWordsContext);
  if (!context) {
    throw new Error('useSavedWords must be used within SavedWordsProvider');
  }

  return context;
}
