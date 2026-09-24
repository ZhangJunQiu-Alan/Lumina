import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { getHomeOverview, getUserActivityHeatmap } from '../../server/home.ts';
import { logger } from '../../server/logger.ts';

export const homeRouter = new Hono<AppEnv>();

homeRouter.use('*', requireAuth);

homeRouter.get('/overview', async (c) => {
  const userId = c.get('userId');
  const timeZone = c.req.query('timezone') || c.req.query('timeZone') || null;

  try {
    const overview = await getHomeOverview(userId, timeZone);
    return c.json({ data: overview });
  } catch (e) {
    logger.error('API Error: /api/home/overview', e, {
      endpoint: '/api/home/overview',
      user_id: userId,
      timezone: timeZone,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
});

export const handleActivityHeatmap = async (c: any) => {
  const userId = c.get('userId');
  const timeZone = c.req.query('timezone') || c.req.query('timeZone') || null;

  try {
    const activityDays = await getUserActivityHeatmap(userId, timeZone);
    return c.json({ data: activityDays });
  } catch (e) {
    logger.error('API Error: /api/home/activity-heatmap', e, {
      endpoint: '/api/home/activity-heatmap',
      user_id: userId,
      timezone: timeZone,
    });
    return c.json({ error: 'Internal server error', request_id: c.get('requestId') }, 500);
  }
};

homeRouter.get('/activity-heatmap', handleActivityHeatmap);
