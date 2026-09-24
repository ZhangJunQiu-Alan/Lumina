import type { MiddlewareHandler } from 'hono';
import { logger } from '../../server/logger.ts';
import type { AppEnv } from '../types.ts';

const REQUEST_ID_HEADER = 'X-Request-Id';

export const loggerMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const incomingRequestId = c.req.header(REQUEST_ID_HEADER)?.trim();
  const requestId = incomingRequestId || crypto.randomUUID();

  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  logger.info(`${c.req.method} ${c.req.path} ${status} - ${duration}ms`, {
    request_id: requestId,
    method: c.req.method,
    url: c.req.path,
    status,
    duration,
  });
};
