import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import {
  CompleteLearningRoundSchema,
  OfficialStartSchema,
  SaveLearningSessionSchema,
} from '../schemas/learning.ts';
import {
  completeLearningRound,
  getLearningSession,
  saveLearningSession,
  startOfficialLearningSession,
  validateOfficialLibraryId,
} from '../../server/learning.ts';
import { logger } from '../../server/logger.ts';

export const learningRouter = new Hono<AppEnv>();

learningRouter.use('*', requireAuth);

// GET /api/learning/groups/:groupId
learningRouter.get('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId')?.trim();
  if (!groupId) return c.json({ error: 'Missing group ID' }, 400);

  const userId = c.get('userId');
  try {
    const data = await getLearningSession(userId, groupId);
    if (!data) return c.json({ error: 'Learning group not found' }, 404);
    return c.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/learning/groups/${groupId}`, e, {
      endpoint: `/api/learning/groups/${groupId}`,
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/learning/official/:libraryId/start
learningRouter.post(
  '/official/:libraryId/start',
  validateJson(OfficialStartSchema, 'Unknown study mode'),
  async (c) => {
    const libraryId = c.req.param('libraryId');
    if (!validateOfficialLibraryId(libraryId)) {
      return c.json({ error: 'Unknown official library' }, 400);
    }

    const { mode, timeZone } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const data = await startOfficialLearningSession(userId, {
        libraryId,
        mode,
        timeZone: typeof timeZone === 'string' ? timeZone : null,
      });
      return c.json({ data });
    } catch (e) {
      logger.error(`API Error: /api/learning/official/${libraryId}/start`, e, {
        endpoint: `/api/learning/official/${libraryId}/start`,
        user_id: userId,
        mode,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// POST /api/learning/groups/:groupId/session
learningRouter.post(
  '/groups/:groupId/session',
  validateJson(SaveLearningSessionSchema, 'Invalid learning session'),
  async (c) => {
    const groupId = c.req.param('groupId')?.trim();
    if (!groupId) return c.json({ error: 'Missing group ID' }, 400);

    const { round, currentIndex, queueWordIds, passedQueueIndices, round1ConfirmedWordIds, timeZone } =
      c.req.valid('json');
    const userId = c.get('userId');

    try {
      const data = await saveLearningSession(userId, groupId, {
        round,
        currentIndex: Number(currentIndex) || 0,
        queueWordIds,
        passedQueueIndices: Array.isArray(passedQueueIndices) ? passedQueueIndices : [],
        round1ConfirmedWordIds: Array.isArray(round1ConfirmedWordIds) ? round1ConfirmedWordIds : [],
        timeZone: typeof timeZone === 'string' ? timeZone : null,
      });
      return c.json({ data });
    } catch (e) {
      logger.error(`API Error: /api/learning/groups/${groupId}/session`, e, {
        endpoint: `/api/learning/groups/${groupId}/session`,
        user_id: userId,
        round,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// POST /api/learning/groups/:groupId/complete-round
learningRouter.post(
  '/groups/:groupId/complete-round',
  validateJson(CompleteLearningRoundSchema, 'Invalid learning round'),
  async (c) => {
    const groupId = c.req.param('groupId')?.trim();
    if (!groupId) return c.json({ error: 'Missing group ID' }, 400);

    const { round, confirmedWordIds, timeZone } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const data = await completeLearningRound(userId, groupId, {
        round,
        confirmedWordIds: Array.isArray(confirmedWordIds) ? confirmedWordIds : [],
        timeZone: typeof timeZone === 'string' ? timeZone : null,
      });
      return c.json({ data });
    } catch (e) {
      logger.error(`API Error: /api/learning/groups/${groupId}/complete-round`, e, {
        endpoint: `/api/learning/groups/${groupId}/complete-round`,
        user_id: userId,
        round,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);
