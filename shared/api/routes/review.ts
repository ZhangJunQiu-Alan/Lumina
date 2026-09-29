import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import {
  BatchReviewAttemptSchema,
  MarkMasteredSchema,
  MarkUnknownSchema,
  ReviewAttemptSchema,
  ReviewSessionCompleteSchema,
  ReviewSessionStartSchema,
} from '../schemas/review.ts';
import {
  completeReviewSession,
  fetchDueReviewWords,
  markVocabularyMastered,
  markVocabularyUnknown,
  recordBatchReviewAttempts,
  recordReviewAttempt,
  startReviewSession,
} from '../../server/review.ts';
import { logger } from '../../server/logger.ts';

export const reviewRouter = new Hono<AppEnv>();

reviewRouter.use('*', requireAuth);

// GET /due
reviewRouter.get('/due', async (c) => {
  const userId = c.get('userId');
  const timeZone = c.req.query('timezone') || c.req.query('timeZone') || null;

  try {
    const words = await fetchDueReviewWords(userId, { timeZone });
    return c.json({ data: words });
  } catch (e) {
    logger.error('API Error: /api/review/due', e, { endpoint: '/api/review/due', user_id: userId, timezone: timeZone });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /attempt
reviewRouter.post('/attempt', validateJson(ReviewAttemptSchema, 'Missing required attempt fields'), async (c) => {
  const userId = c.get('userId');
  const { vocabularyItemId, learningGroupId, source, wasCorrect, elapsedMs, timestamp } = c.req.valid('json');

  try {
    const result = await recordReviewAttempt({
      userId,
      vocabularyItemId,
      learningGroupId,
      source,
      wasCorrect,
      elapsedMs: Number(elapsedMs) || 0,
      timestamp: timestamp ? Number(timestamp) : undefined,
    });
    return c.json({ data: result });
  } catch (e) {
    logger.error('API Error: /api/review/attempt', e, { endpoint: '/api/review/attempt', user_id: userId });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /batch-attempt & /batch-attempts
const handleBatchAttempt = async (c: any) => {
  const userId = c.get('userId');
  const { attempts } = c.req.valid('json');

  try {
    const results = await recordBatchReviewAttempts(userId, attempts);
    return c.json({ data: results });
  } catch (e) {
    logger.error('API Error: /api/review/batch-attempt', e, { endpoint: '/api/review/batch-attempt', user_id: userId });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
};

const batchAttemptMiddleware = validateJson(BatchReviewAttemptSchema, 'Missing attempts array');
reviewRouter.post('/batch-attempt', batchAttemptMiddleware, handleBatchAttempt);
reviewRouter.post('/batch-attempts', batchAttemptMiddleware, handleBatchAttempt);

// POST /unknown
reviewRouter.post('/unknown', validateJson(MarkUnknownSchema, 'Missing vocabularyItemId'), async (c) => {
  const userId = c.get('userId');
  const { vocabularyItemId, learningGroupId, timestamp } = c.req.valid('json');

  try {
    const result = await markVocabularyUnknown({
      userId,
      vocabularyItemId,
      learningGroupId,
      timestamp: timestamp ? Number(timestamp) : undefined,
    });
    return c.json({ data: result });
  } catch (e) {
    logger.error('API Error: /api/review/unknown', e, { endpoint: '/api/review/unknown', user_id: userId });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /mastered
reviewRouter.post('/mastered', validateJson(MarkMasteredSchema, 'Missing vocabularyItemId'), async (c) => {
  const userId = c.get('userId');
  const { vocabularyItemId, learningGroupId } = c.req.valid('json');

  try {
    const result = await markVocabularyMastered({
      userId,
      vocabularyItemId,
      learningGroupId,
    });
    return c.json({ data: result });
  } catch (e) {
    logger.error('API Error: /api/review/mastered', e, { endpoint: '/api/review/mastered', user_id: userId });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /session/start
reviewRouter.post('/session/start', validateJson(ReviewSessionStartSchema), async (c) => {
  const userId = c.get('userId');
  const { timeZone } = c.req.valid('json');

  try {
    const words = await startReviewSession(userId, {
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    return c.json({ data: { words } });
  } catch (e) {
    logger.error('API Error: /api/review/session/start', e, { endpoint: '/api/review/session/start', user_id: userId });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /session/complete
reviewRouter.post('/session/complete', validateJson(ReviewSessionCompleteSchema), async (c) => {
  const userId = c.get('userId');
  const { timeZone } = c.req.valid('json');

  try {
    const data = await completeReviewSession(userId, {
      timeZone: typeof timeZone === 'string' ? timeZone : null,
    });
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: /api/review/session/complete', e, {
      endpoint: '/api/review/session/complete',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});
