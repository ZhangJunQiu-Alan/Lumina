import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import { LearningPreferencesPatchSchema } from '../schemas/settings.ts';
import {
  getUserLearningPreferences,
  resolveLearningPreferencesPatch,
  saveUserLearningPreferences,
} from '../../server/settings.ts';
import { logger } from '../../server/logger.ts';

export const settingsRouter = new Hono<AppEnv>();

settingsRouter.use('*', requireAuth);

settingsRouter.get('/learning-preferences', async (c) => {
  const userId = c.get('userId');

  try {
    const preferences = await getUserLearningPreferences(userId);
    return c.json({ data: preferences });
  } catch (e) {
    logger.error('API Error: /api/settings/learning-preferences', e, {
      endpoint: '/api/settings/learning-preferences',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

settingsRouter.post('/learning-preferences', validateJson(LearningPreferencesPatchSchema), async (c) => {
  const userId = c.get('userId');
  const validJson = c.req.valid('json');
  const patch = resolveLearningPreferencesPatch(validJson);

  try {
    const preferences = await saveUserLearningPreferences(userId, patch);
    return c.json({ data: preferences });
  } catch (e) {
    logger.error('API Error: /api/settings/learning-preferences', e, {
      endpoint: '/api/settings/learning-preferences',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});
