import { Hono } from 'hono';
import type { AppEnv } from './types.ts';
import { loggerMiddleware } from './middleware/logger.ts';
import { corsMiddleware } from './middleware/cors.ts';
import { requireAuth } from './middleware/auth.ts';
import { homeRouter, handleActivityHeatmap } from './routes/home.ts';
import { settingsRouter } from './routes/settings.ts';
import { reviewRouter } from './routes/review.ts';
import { learningRouter } from './routes/learning.ts';
import { libraryRouter } from './routes/library.ts';
import { vocabRouter } from './routes/vocab.ts';
import { audioRouter, handleExampleAudio } from './routes/audio.ts';
import { ieltsRouter } from './routes/ielts.ts';
import { authRouter } from './routes/auth.ts';
import { logger } from '../server/logger.ts';
import { captureServerException } from '../server/telemetry.ts';

export const app = new Hono<AppEnv>();

// Register global middleware
app.use('*', loggerMiddleware);
app.use('*', corsMiddleware);

// URL Normalization helper for Supabase Edge Functions & API gateways
export function normalizeApiRequest(request: Request): Request {
  const url = new URL(request.url);
  const marker = '/functions/v1/api';
  let pathname = url.pathname;

  if (pathname === marker) {
    pathname = '/';
  } else if (pathname.startsWith(`${marker}/`)) {
    pathname = pathname.slice(marker.length);
  }

  if (pathname.startsWith('/api/api/')) {
    pathname = pathname.slice('/api'.length);
  }

  if (pathname !== url.pathname) {
    url.pathname = pathname;
    return new Request(url.toString(), request);
  }
  return request;
}

// Health check endpoints
const healthHandler = (c: any) => c.json({ status: 'ok', timestamp: new Date().toISOString() });
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Top-level /api router
const api = new Hono<AppEnv>();

api.get('/health', healthHandler);
api.route('/home', homeRouter);
api.get('/user/activity-heatmap', requireAuth, handleActivityHeatmap);
api.route('/settings', settingsRouter);
api.route('/review', reviewRouter);
api.route('/learning', learningRouter);
api.route('/library', libraryRouter);
api.route('/vocab', vocabRouter);
api.route('/audio', audioRouter);
api.post('/example-audio', requireAuth, handleExampleAudio);
api.route('/ielts', ieltsRouter);
api.route('/auth', authRouter);

// Mount under /api
app.route('/api', api);

// Global Error Handler
app.onError((err, c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  logger.error('Unhandled API Error', err, {
    endpoint: c.req.path,
    method: c.req.method,
    request_id: requestId,
    user_id: userId,
  });

  void captureServerException(err, {
    endpoint: c.req.path,
    method: c.req.method,
    requestId,
    userId,
  });

  const status = (err as any)?.status || (err as any)?.statusCode;
  const httpStatus = typeof status === 'number' && status >= 400 && status < 600 ? status : 500;

  if (httpStatus >= 500) {
    return c.json({ error: 'Internal server error', request_id: requestId }, 500);
  }

  return c.json(
    {
      error: httpStatus === 400 ? 'Bad request' : (err.message || 'Request failed'),
      request_id: requestId,
    },
    httpStatus as any,
  );
});

// Primary fetch dispatch handler with URL normalization
export const fetchHandler = async (request: Request, env?: any, executionCtx?: any): Promise<Response> => {
  return app.fetch(normalizeApiRequest(request), env, executionCtx);
};
