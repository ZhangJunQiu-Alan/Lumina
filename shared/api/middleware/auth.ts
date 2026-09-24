import type { MiddlewareHandler } from 'hono';
import { supabaseAdmin } from '../../server/supabase.ts';
import { isLocalAuthEnabled, readBearerToken, verifyLocalAccessToken } from '../../server/localAuth.ts';
import type { AppEnv } from '../types.ts';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const accessToken = readBearerToken(c.req.header('Authorization'));

  if (!accessToken) {
    return c.json({ error: 'Missing bearer token' }, 401);
  }

  if (isLocalAuthEnabled()) {
    try {
      const { user } = await verifyLocalAccessToken(accessToken);
      c.set('userId', user.id);
      c.set('authUser', user);
      await next();
      return;
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('userId', data.user.id);
  await next();
};

export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const accessToken = readBearerToken(c.req.header('Authorization'));
  if (accessToken) {
    if (isLocalAuthEnabled()) {
      try {
        const { user } = await verifyLocalAccessToken(accessToken);
        c.set('userId', user.id);
        c.set('authUser', user);
      } catch {
        // ignore optional auth failure
      }
    } else {
      const { data } = await supabaseAdmin.auth.getUser(accessToken);
      if (data?.user) {
        c.set('userId', data.user.id);
      }
    }
  }
  await next();
};
