import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireExpensiveQuota } from '../middleware/rateLimit.ts';
import { getOrCreateAudio, batchGenerateAudio } from '../../server/audio.ts';
import { ExampleAudioValidationError, getOrCreateExampleAudio } from '../../server/exampleAudio.ts';
import { countStringArray } from '../../expensiveRateLimit.ts';
import { logger } from '../../server/logger.ts';

export const audioRouter = new Hono<AppEnv>();

audioRouter.use('*', requireAuth);

const ttsSingleQuota = requireExpensiveQuota('tts');
const ttsBatchQuota = requireExpensiveQuota('tts', async (c) => {
  const body = await c.req.raw.clone().json().catch(() => ({}));
  return Math.min(countStringArray(body?.words), 30) * 2;
});

// GET /api/audio/:word
audioRouter.get('/:word', ttsSingleQuota, async (c) => {
  const word = c.req.param('word');
  const locale = (c.req.query('locale') as 'uk' | 'us') || 'uk';

  if (!word) return c.json({ error: 'Missing word' }, 400);

  try {
    const url = await getOrCreateAudio(word, locale);
    return c.json({ data: url });
  } catch (e) {
    logger.error(`API Error: /api/audio/${word}`, e, { endpoint: `/api/audio/${word}`, locale });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/audio/batch
audioRouter.post('/batch', ttsBatchQuota, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { words } = body;

  if (!Array.isArray(words)) return c.json({ error: 'Missing words array' }, 400);

  const cleaned = words
    .map((w: unknown) => (typeof w === 'string' ? w.trim() : ''))
    .filter(Boolean)
    .slice(0, 30);

  try {
    const urls = await batchGenerateAudio(cleaned);
    return c.json({ data: urls });
  } catch (e) {
    logger.error('API Error: /api/audio/batch', e, { endpoint: '/api/audio/batch' });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/example-audio
export const handleExampleAudio = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  const { text, locale } = body;

  if (typeof text !== 'string') {
    return c.json({ error: 'Missing example text' }, 400);
  }

  if (locale !== 'uk' && locale !== 'us') {
    return c.json({ error: 'Invalid locale' }, 400);
  }

  try {
    const url = await getOrCreateExampleAudio(text, locale);
    return c.json({ data: url });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ExampleAudioValidationError) {
      return c.json({ error: message }, e.statusCode as any);
    }

    logger.error('API Error: /api/example-audio', e, { endpoint: '/api/example-audio', locale });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
};

audioRouter.post('/example-audio', ttsSingleQuota, handleExampleAudio);
