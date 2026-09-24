import type { ArticleSentence, Word } from '../types';
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';

const ARTICLE_CACHE_KEY = 'lumina.article-cache.v1';

interface ArticleCacheEntry {
  groupId: string;
  wordIds: string[];
  sentences: ArticleSentence[];
  createdAt: string;
}

function normalizeWordIds(words: Word[]) {
  return words.map((word) => word.id);
}

function isArticleSentence(value: unknown): value is ArticleSentence {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ArticleSentence).en === 'string' &&
    typeof (value as ArticleSentence).zh === 'string' &&
    (value as ArticleSentence).en.trim().length > 0 &&
    (value as ArticleSentence).zh.trim().length > 0
  );
}

function resolveStorage() {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    return null;
  }
  return storage;
}

function readArticleCache(): ArticleCacheEntry | null {
  const storage = resolveStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ARTICLE_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ArticleCacheEntry>;
    if (
      typeof parsed.groupId !== 'string' ||
      !Array.isArray(parsed.wordIds) ||
      !Array.isArray(parsed.sentences) ||
      typeof parsed.createdAt !== 'string' ||
      !parsed.sentences.every(isArticleSentence)
    ) {
      return null;
    }

    return {
      groupId: parsed.groupId,
      wordIds: parsed.wordIds.filter((wordId): wordId is string => typeof wordId === 'string'),
      sentences: parsed.sentences.map((sentence) => ({
        en: sentence.en.trim(),
        zh: sentence.zh.trim(),
      })),
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function matchesWordIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((wordId, index) => wordId === right[index]);
}

export function getCachedArticle(groupId: string, words: Word[]) {
  const wordIds = normalizeWordIds(words);
  try {
    const memory = queryClient.getQueryData<ArticleSentence[]>(queryKeys.article.group(groupId, wordIds));
    if (memory) return memory;
  } catch {
    // Ignore in non-browser/test environments
  }

  const cache = readArticleCache();
  if (!cache) return null;

  if (cache.groupId !== groupId || !matchesWordIds(cache.wordIds, wordIds)) {
    clearArticleCache();
    return null;
  }

  try {
    queryClient.setQueryData(queryKeys.article.group(groupId, wordIds), cache.sentences);
  } catch {
    // Ignore
  }

  return cache.sentences;
}

export function setCachedArticle(groupId: string, words: Word[], sentences: ArticleSentence[]) {
  const wordIds = normalizeWordIds(words);
  try {
    queryClient.setQueryData(queryKeys.article.group(groupId, wordIds), sentences);
  } catch {
    // Ignore
  }

  const storage = resolveStorage();
  if (!storage) return;

  clearArticleCache();

  const entry: ArticleCacheEntry = {
    groupId,
    wordIds,
    sentences,
    createdAt: new Date().toISOString(),
  };

  try {
    storage.setItem(ARTICLE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore
  }
}

export function clearArticleCache() {
  try {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] === 'article',
    });
  } catch {
    // Ignore
  }

  const storage = resolveStorage();
  if (!storage) return;
  try {
    storage.removeItem(ARTICLE_CACHE_KEY);
  } catch {
    // Ignore
  }
}
