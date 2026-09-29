import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  queryClient,
  invalidateHomeQueries,
  invalidateLibraryQueries,
  invalidateSavedWordsQueries,
} from './queryClient';
import { queryKeys } from './queryKeys';
import {
  getCachedLibraryGroups,
  refreshLibraryGroups,
  removeLibraryGroupFromCache,
  invalidateLibraryCache,
} from './libraryCache';
import { getCachedArticle, setCachedArticle, clearArticleCache } from './articleCache';

describe('TanStack Query integration & queryClient', () => {
  beforeEach(() => {
    queryClient.clear();
    clearArticleCache();
  });

  describe('queryKeys factory', () => {
    it('produces hierarchical query keys for all domains', () => {
      expect(queryKeys.home.all('user-1')).toEqual(['home', 'user-1']);
      expect(queryKeys.home.overview('user-1', 'UTC')).toEqual(['home', 'user-1', 'overview', 'UTC']);
      expect(queryKeys.library.all('user-1')).toEqual(['library', 'user-1']);
      expect(queryKeys.library.groups('user-1')).toEqual(['library', 'user-1', 'groups']);
      expect(queryKeys.library.savedWords('user-1')).toEqual(['library', 'user-1', 'savedWords']);
      expect(queryKeys.review.all('user-1')).toEqual(['review', 'user-1']);
      expect(queryKeys.ielts.dashboard('user-1')).toEqual(['ielts', 'user-1', 'dashboard']);
      expect(queryKeys.article.group('g1', ['w1', 'w2'])).toEqual(['article', 'g1', 'w1,w2']);
    });
  });

  describe('queryClient retry policy', () => {
    it('does not retry 401, 403, or 404 errors', () => {
      const defaultOptions = queryClient.getDefaultOptions();
      const retryFn = defaultOptions.queries?.retry;
      expect(typeof retryFn).toBe('function');
      if (typeof retryFn === 'function') {
        expect(retryFn(0, { status: 401 } as any)).toBe(false);
        expect(retryFn(0, { statusCode: 403 } as any)).toBe(false);
        expect(retryFn(0, { status: 404 } as any)).toBe(false);
        expect(retryFn(1, { status: 500 } as any)).toBe(true);
        expect(retryFn(2, { status: 500 } as any)).toBe(false);
      }
    });

    it('invalidates queries using helper functions', async () => {
      queryClient.setQueryData(queryKeys.home.overview('user-1', 'UTC'), { streak: 5 });
      queryClient.setQueryData(queryKeys.library.groups('user-1'), [{ id: 'g1' }]);
      queryClient.setQueryData(queryKeys.library.savedWords('user-1'), [{ id: 'w1' }]);

      await invalidateHomeQueries('user-1');
      await invalidateLibraryQueries('user-1');
      await invalidateSavedWordsQueries('user-1');

      expect(queryClient.getQueryState(queryKeys.home.overview('user-1', 'UTC'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.library.groups('user-1'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.library.savedWords('user-1'))?.isInvalidated).toBe(true);
    });
  });

  describe('libraryCache backed by queryClient', () => {
    it('caches and retrieves library groups seamlessly', async () => {
      const loader = vi.fn().mockResolvedValue([{ id: 'group-1', name: 'Group 1', totalWords: 10 }]);

      const groups = await refreshLibraryGroups('user-1', loader);
      expect(groups).toHaveLength(1);
      expect(loader).toHaveBeenCalledTimes(1);

      // getCachedLibraryGroups reads queryClient data
      const cached = getCachedLibraryGroups('user-1');
      expect(cached?.data).toEqual([{ id: 'group-1', name: 'Group 1', totalWords: 10 }]);

      // removeLibraryGroupFromCache updates queryClient data
      removeLibraryGroupFromCache('user-1', 'group-1');
      expect(getCachedLibraryGroups('user-1')?.data).toEqual([]);
    });

    it('purges user library cache when invalidateLibraryCache is called', async () => {
      const loader = vi.fn().mockResolvedValue([{ id: 'group-2' }]);
      await refreshLibraryGroups('user-2', loader);

      invalidateLibraryCache('user-2');
      expect(getCachedLibraryGroups('user-2')).toBeNull();
    });
  });

  describe('articleCache backed by queryClient', () => {
    it('syncs articles in queryClient and localStorage', () => {
      const words = [{ id: 'w1', word: 'test' } as any];
      const sentences = [{ en: 'This is a test.', zh: '这是一个测试。' }];

      setCachedArticle('group-art', words, sentences);
      const cached = getCachedArticle('group-art', words);
      expect(cached).toEqual(sentences);

      clearArticleCache();
      expect(getCachedArticle('group-art', words)).toBeNull();
    });
  });
});
