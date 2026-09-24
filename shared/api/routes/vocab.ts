import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireAiContentFeatures, requireExpensiveQuota } from '../middleware/rateLimit.ts';
import {
  enrichWords,
  EnrichmentResponseValidationError,
  EnrichmentServiceUnavailableError,
  generateArticle,
} from '../../server/gemini.ts';
import {
  ensureLiteVocabularyEntry,
  lemmatizeVocabularyWord,
  lemmatizeVocabularyWords,
  lookupWordForPopover,
  persistFullVocabularyEntries,
  queueFullEnrichmentForWord,
  reportVocabularyIssue,
  sanitizeLookupWord,
  type VocabularySourceType,
} from '../../server/vocab.ts';
import { countStringArray } from '../../expensiveRateLimit.ts';
import { logger } from '../../server/logger.ts';

export const vocabRouter = new Hono<AppEnv>();

vocabRouter.use('*', requireAuth);

const aiVocabQuota = requireExpensiveQuota('ai_vocab', async (c) => {
  const body = await c.req.raw.clone().json().catch(() => ({}));
  return countStringArray(body?.words);
});
const aiVocabSingleQuota = requireExpensiveQuota('ai_vocab');
const aiArticleQuota = requireExpensiveQuota('ai_article');

function resolveGeminiSource(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function resolveVocabularySourceType(value: unknown): VocabularySourceType {
  return value === 'system' ? 'system' : 'custom';
}

// POST /api/vocab/enrich
vocabRouter.post('/enrich', requireAiContentFeatures, aiVocabQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { words } = body;
  const source = resolveGeminiSource(body?.source, 'manual_api');

  if (!Array.isArray(words) || words.length === 0) {
    return c.json({ error: 'Missing words array' }, 400);
  }

  try {
    const data = await enrichWords(words, {
      source,
      enrichmentType: 'batch',
    });
    return c.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/enrich', e, { endpoint: '/api/vocab/enrich', source });

    if (e instanceof EnrichmentResponseValidationError || e instanceof EnrichmentServiceUnavailableError) {
      return c.json({ error: message }, e.statusCode as any);
    }
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/lite-enrich
vocabRouter.post('/lite-enrich', requireAiContentFeatures, aiVocabSingleQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const word = sanitizeLookupWord(body?.word);
  const source = resolveGeminiSource(body?.source, 'manual_api');

  if (!word) {
    return c.json({ error: 'Missing word' }, 400);
  }

  try {
    const data = await ensureLiteVocabularyEntry(word, source);
    return c.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lite-enrich', e, { endpoint: '/api/vocab/lite-enrich', word, source });

    if (e instanceof EnrichmentResponseValidationError || e instanceof EnrichmentServiceUnavailableError) {
      return c.json({ error: message }, e.statusCode as any);
    }
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/lemmatize
vocabRouter.post('/lemmatize', requireAiContentFeatures, aiVocabSingleQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const word = sanitizeLookupWord(body?.word);
  const source = resolveGeminiSource(body?.source, 'import_lemmatize');

  if (!word) {
    return c.json({ error: 'Missing word' }, 400);
  }

  try {
    const data = await lemmatizeVocabularyWord(word, source);
    return c.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lemmatize', e, { endpoint: '/api/vocab/lemmatize', word, source });

    if (e instanceof EnrichmentResponseValidationError || e instanceof EnrichmentServiceUnavailableError) {
      return c.json({ error: message }, e.statusCode as any);
    }
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/lemmatize-batch
vocabRouter.post('/lemmatize-batch', requireAiContentFeatures, aiVocabQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const words = Array.isArray(body?.words) ? body.words.map(sanitizeLookupWord).filter(Boolean) : [];
  const source = resolveGeminiSource(body?.source, 'import_lemmatize');

  if (words.length === 0) {
    return c.json({ error: 'Missing words array' }, 400);
  }

  try {
    const data = await lemmatizeVocabularyWords(words, source);
    return c.json({ data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lemmatize-batch', e, {
      endpoint: '/api/vocab/lemmatize-batch',
      word_count: words.length,
      source,
    });

    if (e instanceof EnrichmentResponseValidationError || e instanceof EnrichmentServiceUnavailableError) {
      return c.json({ error: message }, e.statusCode as any);
    }
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/lookup
vocabRouter.post('/lookup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const word = sanitizeLookupWord(body?.word);

  if (!word) {
    return c.json({ error: 'Missing word' }, 400);
  }

  const userId = c.get('userId');
  try {
    const data = await lookupWordForPopover(userId, word);
    return c.json(data ? { data } : { data: null, missing: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error('API Error: /api/vocab/lookup', e, { endpoint: '/api/vocab/lookup', user_id: userId, word });

    if (e instanceof EnrichmentResponseValidationError || e instanceof EnrichmentServiceUnavailableError) {
      return c.json({ error: message }, e.statusCode as any);
    }
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/report
vocabRouter.post('/report', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const userId = c.get('userId');
  const { vocabularyItemId, wordSnapshot, learningGroupId, sessionRound, issueType, note, routePath, userAgent } =
    body;

  if (typeof vocabularyItemId !== 'string' || vocabularyItemId.trim().length === 0) {
    return c.json({ error: 'Missing vocabulary item ID' }, 400);
  }

  try {
    const data = await reportVocabularyIssue(userId, {
      vocabularyItemId,
      wordSnapshot: typeof wordSnapshot === 'string' ? wordSnapshot : null,
      learningGroupId: typeof learningGroupId === 'string' ? learningGroupId : null,
      sessionRound: typeof sessionRound === 'string' ? sessionRound : null,
      issueType,
      note: typeof note === 'string' ? note : null,
      routePath: typeof routePath === 'string' ? routePath : null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: /api/vocab/report', e, {
      endpoint: '/api/vocab/report',
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
      issue_type: issueType,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/full-enrich
vocabRouter.post('/full-enrich', requireAiContentFeatures, aiVocabSingleQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const word = sanitizeLookupWord(body?.word);

  if (!word) {
    return c.json({ error: 'Missing word' }, 400);
  }

  const userId = c.get('userId');
  try {
    const result = await queueFullEnrichmentForWord(word, 'manual_api');
    if (result.reason === 'not_found') {
      return c.json({ error: 'Vocabulary item not found' }, 404);
    }
    return c.json(result, (result.queued ? 202 : 200) as any);
  } catch (e) {
    logger.error('API Error: /api/vocab/full-enrich', e, { endpoint: '/api/vocab/full-enrich', user_id: userId, word });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/persist
vocabRouter.post('/persist', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { entries } = body;
  const sourceType = resolveVocabularySourceType(body?.sourceType);

  if (!Array.isArray(entries)) {
    return c.json({ error: 'Missing entries array' }, 400);
  }

  const userId = c.get('userId');
  try {
    const data = await persistFullVocabularyEntries(entries, sourceType);
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: /api/vocab/persist', e, {
      endpoint: '/api/vocab/persist',
      user_id: userId,
      source_type: sourceType,
      entry_count: entries.length,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/vocab/article
vocabRouter.post('/article', requireAiContentFeatures, aiArticleQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { words } = body;

  if (!Array.isArray(words) || words.length === 0) {
    return c.json({ error: 'Missing words array' }, 400);
  }

  const cleaned = words.map((w: unknown) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean);

  try {
    const article = await generateArticle(cleaned);
    return c.json({ data: article });
  } catch (e) {
    logger.error('API Error: /api/vocab/article', e, {
      endpoint: '/api/vocab/article',
      word_count: cleaned.length,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});
