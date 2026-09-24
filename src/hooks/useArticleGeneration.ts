import { useState, useRef, useCallback } from 'react';
import type { ArticleSentence, Word } from '../types';
import { apiFetch } from '../lib/api';
import { getCachedArticle, setCachedArticle } from '../lib/articleCache';
import { fetchGeneratedArticle, upsertGeneratedArticle } from '../lib/learningSessionApi';

export const ARTICLE_RETRY_DELAY_MS = 3000;
export const ARTICLE_MAX_RETRY_ATTEMPTS = 3;
export const ARTICLE_REQUEST_TIMEOUT_MS = 60000;
export const ARTICLE_RETRY_EXHAUSTED_MESSAGE = '文章生成失败，已自动重试 3 次。';

export interface ArticleGenerationJob {
  key: string;
  groupId: string;
  runId: number;
  attempt: number;
  inFlight: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  exhausted: boolean;
}

export function isArticleSentence(value: unknown): value is ArticleSentence {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ArticleSentence).en === 'string' &&
    typeof (value as ArticleSentence).zh === 'string' &&
    (value as ArticleSentence).en.trim().length > 0 &&
    (value as ArticleSentence).zh.trim().length > 0
  );
}

export function normalizeArticleResponse(data: unknown): ArticleSentence[] {
  const sentences = (data as { sentences?: unknown })?.sentences;
  if (!Array.isArray(sentences)) {
    throw new Error('Article response missing sentences');
  }

  const normalized = sentences.filter(isArticleSentence).map((sentence) => ({
    en: sentence.en.trim(),
    zh: sentence.zh.trim(),
  }));

  if (normalized.length === 0) {
    throw new Error('Article response has no valid sentences');
  }

  return normalized;
}

export function buildArticleGenerationKey(groupId: string, words: Word[]) {
  return `${groupId}:${words.map((word) => word.id).join('|')}`;
}

export function serializeArticleSentences(sentences: ArticleSentence[]) {
  return JSON.stringify({ sentences });
}

export function parsePersistedArticleContent(content: string | null | undefined): ArticleSentence[] | null {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  try {
    return normalizeArticleResponse(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

export function useArticleGeneration(userId: string | null | undefined, activeLearningGroupId: string | null) {
  const [articleSentences, setArticleSentences] = useState<ArticleSentence[] | null>(null);
  const [articleGenerationError, setArticleGenerationError] = useState('');
  const articleGenerationRef = useRef<ArticleGenerationJob | null>(null);
  const articleGenerationRunIdRef = useRef(0);
  const activeLearningGroupIdRef = useRef<string | null>(activeLearningGroupId);
  activeLearningGroupIdRef.current = activeLearningGroupId;

  const cancelArticleGeneration = useCallback((groupId?: string) => {
    const current = articleGenerationRef.current;
    if (!current) return;
    if (groupId && current.groupId !== groupId) return;

    if (current.timerId) {
      clearTimeout(current.timerId);
    }
    current.controller?.abort();

    articleGenerationRef.current = null;
  }, []);

  const ensureArticleForGroup = useCallback(
    async (groupId: string, words: Word[]) => {
      if (!userId) return null;

      const generationKey = buildArticleGenerationKey(groupId, words);
      const existingJob = articleGenerationRef.current;
      if (existingJob && existingJob.key !== generationKey) {
        cancelArticleGeneration();
      }

      const cachedArticle = getCachedArticle(groupId, words);
      if (cachedArticle) {
        cancelArticleGeneration(groupId);
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleSentences(cachedArticle);
          setArticleGenerationError('');
        }
        return cachedArticle;
      }

      const currentJob = articleGenerationRef.current;
      if (currentJob?.key === generationKey && currentJob.exhausted) {
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleGenerationError(ARTICLE_RETRY_EXHAUSTED_MESSAGE);
        }
        return null;
      }

      if (currentJob?.key === generationKey && (currentJob.inFlight || currentJob.timerId)) {
        return null;
      }

      const runId = currentJob?.key === generationKey ? currentJob.runId : articleGenerationRunIdRef.current + 1;
      articleGenerationRunIdRef.current = Math.max(articleGenerationRunIdRef.current, runId);

      const startingAttempt = currentJob?.key === generationKey ? currentJob.attempt : 0;
      articleGenerationRef.current = {
        key: generationKey,
        groupId,
        runId,
        attempt: startingAttempt,
        inFlight: true,
        timerId: null,
        controller: null,
        exhausted: false,
      };
      setArticleGenerationError('');

      const isCurrentJob = () =>
        articleGenerationRef.current?.key === generationKey && articleGenerationRef.current.runId === runId;

      const completeWithSentences = (sentences: ArticleSentence[]) => {
        if (!isCurrentJob()) return;
        setCachedArticle(groupId, words, sentences);
        if (activeLearningGroupIdRef.current === groupId) {
          setArticleSentences(sentences);
          setArticleGenerationError('');
        }
        articleGenerationRef.current = null;
      };

      const scheduleRetry = () => {
        const current = articleGenerationRef.current;
        if (!current || current.key !== generationKey || current.runId !== runId) return;

        if (current.attempt >= ARTICLE_MAX_RETRY_ATTEMPTS) {
          current.inFlight = false;
          current.timerId = null;
          current.controller = null;
          current.exhausted = true;
          if (activeLearningGroupIdRef.current === groupId) {
            setArticleGenerationError(ARTICLE_RETRY_EXHAUSTED_MESSAGE);
          }
          return;
        }

        current.inFlight = false;
        current.attempt += 1;
        current.timerId = setTimeout(() => {
          const scheduled = articleGenerationRef.current;
          if (!scheduled || scheduled.key !== generationKey || scheduled.runId !== runId) return;
          scheduled.timerId = null;
          void ensureArticleForGroup(groupId, words);
        }, ARTICLE_RETRY_DELAY_MS);
      };

      try {
        const persistedArticle = await fetchGeneratedArticle(userId, groupId);
        const persistedSentences = parsePersistedArticleContent(persistedArticle);
        if (persistedSentences) {
          completeWithSentences(persistedSentences);
          return persistedSentences;
        }

        const controller = new AbortController();
        const currentJobForRequest = articleGenerationRef.current;
        if (currentJobForRequest && isCurrentJob()) {
          currentJobForRequest.controller = controller;
        }
        const timeoutId = setTimeout(() => controller.abort(), ARTICLE_REQUEST_TIMEOUT_MS);
        let sentences: ArticleSentence[];
        try {
          const res = await apiFetch('/api/vocab/article', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: words.map((word) => word.word) }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { data } = await res.json();
          sentences = normalizeArticleResponse(data);
        } finally {
          clearTimeout(timeoutId);
          const currentJobAfterRequest = articleGenerationRef.current;
          if (currentJobAfterRequest && isCurrentJob()) {
            currentJobAfterRequest.controller = null;
          }
        }

        if (!isCurrentJob()) {
          return sentences;
        }

        await upsertGeneratedArticle(
          userId,
          groupId,
          serializeArticleSentences(sentences),
          words.map((word) => word.word.trim()).filter(Boolean),
        );
        completeWithSentences(sentences);

        return sentences;
      } catch (error) {
        console.error('Article generation failed:', error);
        scheduleRetry();
        return null;
      }
    },
    [cancelArticleGeneration, userId],
  );

  return {
    articleSentences,
    setArticleSentences,
    articleGenerationError,
    setArticleGenerationError,
    ensureArticleForGroup,
    cancelArticleGeneration,
  };
}
