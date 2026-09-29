import type { MiddlewareHandler } from 'hono';
import { isAiContentFeaturesEnabled } from '../../runtime.ts';
import { consumeExpensiveRateLimit, isRateLimitExceeded, type ExpensiveApiGroup } from '../../expensiveRateLimit.ts';
import { logger } from '../../server/logger.ts';
import type { AppEnv } from '../types.ts';

export function resolveClientIp(c: any): string {
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;

  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return realIp;

  const remoteAddress = c.env?.incoming?.socket?.remoteAddress;
  if (typeof remoteAddress === 'string') return remoteAddress;

  return 'unknown';
}

export const requireAiContentFeatures: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAiContentFeaturesEnabled()) {
    return c.json({ error: 'AI 内容功能暂时关闭。' }, 503);
  }
  await next();
};

export function requireExpensiveQuota(
  group: ExpensiveApiGroup,
  resolveWeight: (c: any) => Promise<number> | number = () => 1,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ error: 'Unauthorized', request_id: c.get('requestId') }, 401);
    }

    let weight: number;
    try {
      weight = await resolveWeight(c);
    } catch {
      weight = 1;
    }

    const ip = resolveClientIp(c);
    const result = consumeExpensiveRateLimit({
      group,
      userId,
      ip,
      weight,
    });

    if (isRateLimitExceeded(result)) {
      logger.warn('Expensive API rate limit exceeded', {
        request_id: c.get('requestId'),
        endpoint: c.req.path,
        user_id: userId,
        group,
        scope: result.scope,
        window: result.window,
        limit: result.limit,
        weight: result.weight,
      });

      c.header('Retry-After', String(result.retryAfterSeconds));
      return c.json(
        {
          error: 'Rate limit exceeded',
          request_id: c.get('requestId'),
          retry_after_seconds: result.retryAfterSeconds,
        },
        429,
      );
    }

    await next();
  };
}
