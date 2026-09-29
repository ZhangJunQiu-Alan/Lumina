import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireAiContentFeatures, requireExpensiveQuota } from '../middleware/rateLimit.ts';
import { validateJson } from '../middleware/validator.ts';
import {
  VocabArticleSchema,
  VocabEnrichSchema,
  VocabFullEnrichSchema,
  VocabLemmatizeBatchSchema,
  VocabLemmatizeSchema,
  VocabLiteEnrichSchema,
  VocabLookupSchema,
  VocabPersistSchema,
  VocabReportSchema,
} from '../schemas/vocab.ts';
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
  type VocabularySourceType,
} from '../../server/vocab.ts';
import { countStringArray } from '../../expensiveRateLimit.ts';
import { logger } from '../../server/logger.ts';

export const vocabRouter = new Hono<AppEnv>();

vocabRouter.use('*', requireAuth);

const aiVocabQuota = requireExpensiveQuota('ai_vocab', async (c) => {
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => ({}));
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
vocabRouter.post(
  '/enrich',
  requireAiContentFeatures,
  aiVocabQuota,
  validateJson(VocabEnrichSchema, 'Missing words array'),
  async (c) => {
    const { words, source: rawSource } = c.req.valid('json');
    const source = resolveGeminiSource(rawSource, 'manual_api');

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
  },
);

// POST /api/vocab/lite-enrich
vocabRouter.post(
  '/lite-enrich',
  requireAiContentFeatures,
  aiVocabSingleQuota,
  validateJson(VocabLiteEnrichSchema, 'Missing word'),
  async (c) => {
    const { word, source: rawSource } = c.req.valid('json');
    const source = resolveGeminiSource(rawSource, 'manual_api');

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
  },
);

// POST /api/vocab/lemmatize
vocabRouter.post(
  '/lemmatize',
  requireAiContentFeatures,
  aiVocabSingleQuota,
  validateJson(VocabLemmatizeSchema, 'Missing word'),
  async (c) => {
    const { word, source: rawSource } = c.req.valid('json');
    const source = resolveGeminiSource(rawSource, 'import_lemmatize');

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
  },
);

// POST /api/vocab/lemmatize-batch
vocabRouter.post(
  '/lemmatize-batch',
  requireAiContentFeatures,
  aiVocabQuota,
  validateJson(VocabLemmatizeBatchSchema, 'Missing words array'),
  async (c) => {
    const { words, source: rawSource } = c.req.valid('json');
    const source = resolveGeminiSource(rawSource, 'import_lemmatize');

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
  },
);

// POST /api/vocab/lookup
vocabRouter.post('/lookup', validateJson(VocabLookupSchema, 'Missing word'), async (c) => {
  const { word } = c.req.valid('json');
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
vocabRouter.post('/report', validateJson(VocabReportSchema, 'Missing vocabulary item ID'), async (c) => {
  const userId = c.get('userId');
  const { vocabularyItemId, wordSnapshot, learningGroupId, sessionRound, issueType, note, routePath, userAgent } =
    c.req.valid('json');

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
vocabRouter.post(
  '/full-enrich',
  requireAiContentFeatures,
  aiVocabSingleQuota,
  validateJson(VocabFullEnrichSchema, 'Missing word'),
  async (c) => {
    const { word } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const result = await queueFullEnrichmentForWord(word, 'manual_api');
      if (result.reason === 'not_found') {
        return c.json({ error: 'Vocabulary item not found' }, 404);
      }
      return c.json(result, (result.queued ? 202 : 200) as any);
    } catch (e) {
      logger.error('API Error: /api/vocab/full-enrich', e, {
        endpoint: '/api/vocab/full-enrich',
        user_id: userId,
        word,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

vocabRouter.post('/persist', validateJson(VocabPersistSchema, 'Missing entries array'), async (c) => {
  const { entries, sourceType: rawSourceType } = c.req.valid('json');
  const sourceType = resolveVocabularySourceType(rawSourceType);
  const userId = c.get('userId');

  try {
    const data = await persistFullVocabularyEntries(entries as any, sourceType);
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
vocabRouter.post(
  '/article',
  requireAiContentFeatures,
  aiArticleQuota,
  validateJson(VocabArticleSchema, 'Missing words array'),
  async (c) => {
    const { words } = c.req.valid('json');
    const cleaned = words.map((w: string) => w.trim()).filter(Boolean);

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
  },
);
