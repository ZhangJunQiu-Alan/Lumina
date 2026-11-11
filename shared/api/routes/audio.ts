import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { requireExpensiveQuota } from '../middleware/rateLimit.ts';
import { validateJson } from '../middleware/validator.ts';
import { AudioBatchSchema, ExampleAudioSchema } from '../schemas/audio.ts';
import { getOrCreateAudio, batchGenerateAudio } from '../../server/audio.ts';
import { ExampleAudioValidationError, getOrCreateExampleAudio } from '../../server/exampleAudio.ts';
import { countStringArray } from '../../expensiveRateLimit.ts';
import { logger } from '../../server/logger.ts';

export const audioRouter = new Hono<AppEnv>();

audioRouter.use('*', requireAuth);

export const ttsSingleQuota = requireExpensiveQuota('tts');
const ttsBatchQuota = requireExpensiveQuota('tts', async (c) => {
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => ({}));
  return Math.min(countStringArray(body?.words), 30) * 2;
});

// GET /api/audio/:word
audioRouter.get('/:word', ttsSingleQuota, async (c) => {
  const word = c.req.param('word')?.trim();
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
audioRouter.post('/batch', ttsBatchQuota, validateJson(AudioBatchSchema, 'Missing words array'), async (c) => {
  const { words } = c.req.valid('json');
  const cleaned = words
    .map((w: string) => w.trim())
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
  const { text, locale } = c.req.valid('json');

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

audioRouter.post('/example-audio', ttsSingleQuota, validateJson(ExampleAudioSchema), handleExampleAudio);
