import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import { IeltsListeningAttemptSchema, IeltsReadingAttemptSchema } from '../schemas/ielts.ts';
import { submitIeltsListeningAttempt, submitIeltsReadingAttempt } from '../../server/ieltsAttempts.ts';
import { getIeltsDashboard, getIeltsListeningTest, getIeltsReadingTest } from '../../server/ieltsDashboard.ts';
import { isIeltsListeningEnabled } from '../../runtime.ts';
import { logger } from '../../server/logger.ts';

export const ieltsRouter = new Hono<AppEnv>();

ieltsRouter.use('*', requireAuth);

// POST /api/ielts/reading/attempts
ieltsRouter.post('/reading/attempts', validateJson(IeltsReadingAttemptSchema, 'Missing test ID'), async (c) => {
  const userId = c.get('userId');
  const validBody = c.req.valid('json');
  const responseCount = Array.isArray(validBody?.responses) ? validBody.responses.length : 0;

  try {
    const data = await submitIeltsReadingAttempt(userId, validBody);
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: /api/ielts/reading/attempts', e, {
      endpoint: '/api/ielts/reading/attempts',
      user_id: userId,
      test_id: validBody?.testId,
      response_count: responseCount,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/ielts/listening/attempts
ieltsRouter.post('/listening/attempts', validateJson(IeltsListeningAttemptSchema, 'Missing test ID'), async (c) => {
  if (!isIeltsListeningEnabled()) {
    return c.json({ error: 'IELTS listening is disabled.' }, 404);
  }

  const userId = c.get('userId');
  const validBody = c.req.valid('json');
  const responseCount = Array.isArray(validBody?.responses) ? validBody.responses.length : 0;

  try {
    const data = await submitIeltsListeningAttempt(userId, validBody);
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: /api/ielts/listening/attempts', e, {
      endpoint: '/api/ielts/listening/attempts',
      user_id: userId,
      test_id: validBody?.testId,
      response_count: responseCount,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// GET /api/ielts/dashboard
ieltsRouter.get('/dashboard', async (c) => {
  const userId = c.get('userId');
  const listeningEnabled = isIeltsListeningEnabled();

  try {
    const data = await getIeltsDashboard(userId);
    return c.json({
      data: listeningEnabled ? data : { ...data, listeningBooks: [], listeningAttempts: [] },
    });
  } catch (e) {
    logger.error('API Error: /api/ielts/dashboard', e, {
      endpoint: '/api/ielts/dashboard',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// GET /api/ielts/reading/tests/:testId
ieltsRouter.get('/reading/tests/:testId', async (c) => {
  const testId = c.req.param('testId')?.trim();
  if (!testId) return c.json({ error: 'Missing test ID' }, 400);

  const userId = c.get('userId');
  try {
    const data = await getIeltsReadingTest(testId);
    if (!data) return c.json({ error: 'IELTS reading test not found' }, 404);
    return c.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/ielts/reading/tests/${testId}`, e, {
      endpoint: `/api/ielts/reading/tests/${testId}`,
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// GET /api/ielts/listening/tests/:testId
ieltsRouter.get('/listening/tests/:testId', async (c) => {
  if (!isIeltsListeningEnabled()) {
    return c.json({ error: 'IELTS listening is disabled.' }, 404);
  }

  const testId = c.req.param('testId')?.trim();
  if (!testId) return c.json({ error: 'Missing test ID' }, 400);

  const userId = c.get('userId');
  try {
    const data = await getIeltsListeningTest(testId);
    if (!data) return c.json({ error: 'IELTS listening test not found' }, 404);
    return c.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/ielts/listening/tests/${testId}`, e, {
      endpoint: `/api/ielts/listening/tests/${testId}`,
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});
