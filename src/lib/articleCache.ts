import type { ArticleSentence, Word } from '../types';

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

function readArticleCache(): ArticleCacheEntry | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(ARTICLE_CACHE_KEY);
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
  const cache = readArticleCache();
  if (!cache) return null;

  const wordIds = normalizeWordIds(words);
  if (cache.groupId !== groupId || !matchesWordIds(cache.wordIds, wordIds)) {
    clearArticleCache();
    return null;
  }

  return cache.sentences;
}

export function setCachedArticle(groupId: string, words: Word[], sentences: ArticleSentence[]) {
  if (typeof window === 'undefined') return;

  clearArticleCache();

  const entry: ArticleCacheEntry = {
    groupId,
    wordIds: normalizeWordIds(words),
    sentences,
    createdAt: new Date().toISOString(),
  };

  window.localStorage.setItem(ARTICLE_CACHE_KEY, JSON.stringify(entry));
}

export function clearArticleCache() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ARTICLE_CACHE_KEY);
}
