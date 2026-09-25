import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import {
  CreateGroupFromSavedWordsSchema,
  DiscardActiveOfficialGroupSchema,
  ReorderActiveOfficialGroupSchema,
  SaveWordSchema,
} from '../schemas/library.ts';
import {
  createLearningGroupFromSavedWords,
  deleteLearningGroup,
  deleteOfficialLearningLibrary,
  discardActiveOfficialLearningGroup,
  getLibraryGroupDetail,
  getLibraryOverview,
  getSavedWords,
  removeWordFromLibrary,
  reorderActiveOfficialLearningGroup,
  saveWordToLibrary,
} from '../../server/library.ts';
import { cleanupSavedLibrary } from '../../server/savedLibraryCleanup.ts';
import { isOfficialLibraryId } from '../../officialLibraryLite.ts';
import { logger } from '../../server/logger.ts';

export const libraryRouter = new Hono<AppEnv>();

libraryRouter.use('*', requireAuth);

// GET /api/library/overview
libraryRouter.get('/overview', async (c) => {
  const userId = c.get('userId');
  try {
    const overview = await getLibraryOverview(userId);
    return c.json({ data: overview });
  } catch (e) {
    logger.error('API Error: /api/library/overview', e, {
      endpoint: '/api/library/overview',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// GET /api/library/groups/:groupId
libraryRouter.get('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId')?.trim();
  if (!groupId) return c.json({ error: 'Missing group ID' }, 400);

  const userId = c.get('userId');
  try {
    const detail = await getLibraryGroupDetail(userId, groupId);
    return c.json({ data: detail });
  } catch (e) {
    logger.error(`API Error: /api/library/groups/${groupId}`, e, {
      endpoint: `/api/library/groups/${groupId}`,
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// DELETE /api/library/groups/:groupId
libraryRouter.delete('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId')?.trim();
  if (!groupId) return c.json({ error: 'Missing group ID' }, 400);

  const userId = c.get('userId');
  try {
    await deleteLearningGroup(userId, groupId);
    return c.json({ data: { success: true } });
  } catch (e) {
    logger.error(`API Error: /api/library/groups/${groupId}`, e, {
      endpoint: `/api/library/groups/${groupId}`,
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// DELETE /api/library/official/:libraryId
libraryRouter.delete('/official/:libraryId', async (c) => {
  const libraryId = c.req.param('libraryId');
  const timeZone = c.req.query('timezone') || (await c.req.json().catch(() => ({})))?.timeZone || null;

  if (!isOfficialLibraryId(libraryId)) {
    return c.json({ error: 'Unknown official library' }, 400);
  }

  const userId = c.get('userId');
  try {
    const result = await deleteOfficialLearningLibrary(userId, { libraryId, timeZone });
    return c.json({ data: result });
  } catch (e) {
    logger.error(`API Error: /api/library/official/${libraryId}`, e, {
      endpoint: `/api/library/official/${libraryId}`,
      user_id: userId,
      timezone: timeZone,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/library/official/:libraryId/discard-active
libraryRouter.post(
  '/official/:libraryId/discard-active',
  validateJson(DiscardActiveOfficialGroupSchema, 'Missing group ID'),
  async (c) => {
    const libraryId = c.req.param('libraryId');
    if (!isOfficialLibraryId(libraryId)) {
      return c.json({ error: 'Unknown official library' }, 400);
    }

    const { groupId, timeZone } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const result = await discardActiveOfficialLearningGroup(userId, {
        libraryId,
        groupId,
        timeZone: typeof timeZone === 'string' ? timeZone : null,
      });
      return c.json({ data: result });
    } catch (e) {
      logger.error(`API Error: /api/library/official/${libraryId}/discard-active`, e, {
        endpoint: `/api/library/official/${libraryId}/discard-active`,
        user_id: userId,
        group_id: groupId,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// POST /api/library/official/:libraryId/reorder-active
libraryRouter.post(
  '/official/:libraryId/reorder-active',
  validateJson(ReorderActiveOfficialGroupSchema, 'Unknown study mode'),
  async (c) => {
    const libraryId = c.req.param('libraryId');
    if (!isOfficialLibraryId(libraryId)) {
      return c.json({ error: 'Unknown official library' }, 400);
    }

    const { groupId, mode } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const result = await reorderActiveOfficialLearningGroup(userId, {
        libraryId,
        groupId,
        mode,
      });
      return c.json({ data: result });
    } catch (e) {
      logger.error(`API Error: /api/library/official/${libraryId}/reorder-active`, e, {
        endpoint: `/api/library/official/${libraryId}/reorder-active`,
        user_id: userId,
        group_id: groupId,
        mode,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// GET /api/library/saved-words
libraryRouter.get('/saved-words', async (c) => {
  const userId = c.get('userId');
  try {
    const data = await getSavedWords(userId);
    return c.json({ data });
  } catch (e) {
    logger.error('API Error: GET /api/library/saved-words', e, {
      endpoint: '/api/library/saved-words',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// POST /api/library/saved-words
libraryRouter.post(
  '/saved-words',
  validateJson(SaveWordSchema, 'Missing vocabulary item ID'),
  async (c) => {
    const { vocabularyItemId, source } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const data = await saveWordToLibrary(userId, vocabularyItemId.trim(), source);
      return c.json({ data });
    } catch (e) {
      logger.error('API Error: /api/library/saved-words', e, {
        endpoint: '/api/library/saved-words',
        user_id: userId,
        vocabulary_item_id: vocabularyItemId,
        source,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// POST /api/library/saved-words/learning-group
libraryRouter.post(
  '/saved-words/learning-group',
  validateJson(CreateGroupFromSavedWordsSchema, 'Invalid vocabulary item IDs'),
  async (c) => {
    const { vocabularyItemIds } = c.req.valid('json');
    const userId = c.get('userId');

    try {
      const data = await createLearningGroupFromSavedWords(userId, vocabularyItemIds);
      return c.json({ data });
    } catch (e) {
      logger.error('API Error: /api/library/saved-words/learning-group', e, {
        endpoint: '/api/library/saved-words/learning-group',
        user_id: userId,
      });
      return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
    }
  },
);

// POST /api/library/saved-words/cleanup
libraryRouter.post('/saved-words/cleanup', async (c) => {
  const userId = c.get('userId');
  try {
    const result = await cleanupSavedLibrary({ apply: true, userId, sampleLimit: 0 });
    return c.json({
      data: {
        removedSavedWords: result.removedSavedWords,
        createdReviewStates: result.createdReviewStates,
        deletedCustomGroups: result.deletedCustomGroups,
      },
    });
  } catch (e) {
    logger.error('API Error: /api/library/saved-words/cleanup', e, {
      endpoint: '/api/library/saved-words/cleanup',
      user_id: userId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

// DELETE /api/library/saved-words/:vocabularyItemId
libraryRouter.delete('/saved-words/:vocabularyItemId', async (c) => {
  const vocabularyItemId = c.req.param('vocabularyItemId')?.trim();
  if (!vocabularyItemId) {
    return c.json({ error: 'Missing vocabulary item ID' }, 400);
  }

  const userId = c.get('userId');
  try {
    const data = await removeWordFromLibrary(userId, vocabularyItemId);
    return c.json({ data });
  } catch (e) {
    logger.error(`API Error: /api/library/saved-words/${vocabularyItemId}`, e, {
      endpoint: `/api/library/saved-words/${vocabularyItemId}`,
      user_id: userId,
      vocabulary_item_id: vocabularyItemId,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});
