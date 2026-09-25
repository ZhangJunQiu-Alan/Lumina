import { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { requireAuth } from '../middleware/auth.ts';
import { validateJson } from '../middleware/validator.ts';
import {
  ResetPasswordSchema,
  SignInSchema,
  SignUpSchema,
  UpdatePasswordSchema,
} from '../schemas/auth.ts';
import {
  authenticateLocalUser,
  createLocalUser,
  isLocalAuthEnabled,
  readBearerToken,
  updateLocalPassword,
  verifyLocalAccessToken,
} from '../../server/localAuth.ts';
import { supabaseAdmin } from '../../server/supabase.ts';
import { getEnv } from '../../runtime.ts';
import { logger } from '../../server/logger.ts';

export const authRouter = new Hono<AppEnv>();

const supabaseUrl = (getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL'))?.replace(/\/+$/, '') ?? '';
const supabasePublicKey = (getEnv('SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_ANON_KEY')) ?? '';

async function supabaseAuthRequest(path: string, init: RequestInit) {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error('Supabase Auth is not configured.');
  }

  return fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: supabasePublicKey,
      Authorization: `Bearer ${supabasePublicKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function readSupabaseAuthResponse(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const message =
    (typeof payload.error_description === 'string' && payload.error_description) ||
    (typeof payload.msg === 'string' && payload.msg) ||
    (typeof payload.message === 'string' && payload.message) ||
    'Authentication failed.';
  return { payload, message };
}

function sessionFromAccessToken(accessToken: string, user: Record<string, unknown>) {
  try {
    const payloadSegment = accessToken.split('.')[1] ?? '';
    const normalizedPayload = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: number };
    const expiresAt = payload.exp ?? Math.floor(Date.now() / 1000) + 3600;

    return {
      access_token: accessToken,
      refresh_token: '',
      expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      expires_at: expiresAt,
      token_type: 'bearer',
      user,
    };
  } catch {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    return {
      access_token: accessToken,
      refresh_token: '',
      expires_in: 3600,
      expires_at: expiresAt,
      token_type: 'bearer',
      user,
    };
  }
}

// GET /api/auth/session
authRouter.get('/session', async (c) => {
  const accessToken = readBearerToken(c.req.header('Authorization'));
  if (!accessToken) {
    return c.json({ error: 'Missing bearer token' }, 401);
  }

  if (isLocalAuthEnabled()) {
    try {
      const { session } = await verifyLocalAccessToken(accessToken);
      return c.json({ session });
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  return c.json({
    session: sessionFromAccessToken(accessToken, data.user as unknown as Record<string, unknown>),
  });
});

// POST /api/auth/sign-in
authRouter.post(
  '/sign-in',
  validateJson(SignInSchema, '请输入邮箱和密码。'),
  async (c) => {
    const { email, password } = c.req.valid('json');

    if (isLocalAuthEnabled()) {
      try {
        const session = await authenticateLocalUser(email, password);
        return c.json({ session });
      } catch {
        return c.json({ error: '邮箱或密码不正确。' }, 401);
      }
    }

    try {
      const authResponse = await supabaseAuthRequest('/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const { payload } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok || typeof payload.access_token !== 'string' || typeof payload.user !== 'object') {
        return c.json({ error: '邮箱或密码不正确。' }, 401);
      }

      return c.json({ session: payload });
    } catch (e) {
      logger.error('API Error: /api/auth/sign-in', e);
      return c.json({ error: 'Authentication failed.' }, 500);
    }
  },
);

// POST /api/auth/sign-up
authRouter.post(
  '/sign-up',
  validateJson(SignUpSchema, '请填写有效邮箱和至少 8 位密码。'),
  async (c) => {
    const { email, password, fullName = '' } = c.req.valid('json');

    if (isLocalAuthEnabled()) {
      try {
        const session = await createLocalUser({ email, password, fullName });
        return c.json({ session }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sign up failed.';
        return c.json({ error: message }, 400);
      }
    }

    try {
      const authResponse = await supabaseAuthRequest('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, data: { full_name: fullName } }),
      });
      const { payload, message } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok) {
        return c.json({ error: message }, 400);
      }

      return c.json({
        session: typeof payload.access_token === 'string' ? payload : null,
        user: payload.user ?? null,
      });
    } catch (e) {
      logger.error('API Error: /api/auth/sign-up', e);
      return c.json({ error: 'Sign up failed.' }, 500);
    }
  },
);

// POST /api/auth/update-password
authRouter.post(
  '/update-password',
  requireAuth,
  validateJson(UpdatePasswordSchema, '密码至少需要 8 位。'),
  async (c) => {
    const { password } = c.req.valid('json');
    const userId = c.get('userId');

    if (isLocalAuthEnabled()) {
      try {
        await updateLocalPassword(userId, password);
        return c.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Password update failed.';
        return c.json({ error: message }, 400);
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ ok: true });
  },
);

// POST /api/auth/reset-password
authRouter.post(
  '/reset-password',
  validateJson(ResetPasswordSchema, '请输入邮箱。'),
  async (c) => {
    if (isLocalAuthEnabled()) {
      return c.json({
        ok: true,
        message: 'Password reset email is not configured yet. Please sign up again or contact support.',
      });
    }

    const { email } = c.req.valid('json');

    try {
      const authResponse = await supabaseAuthRequest('/recover', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      const { message } = await readSupabaseAuthResponse(authResponse);
      if (!authResponse.ok) {
        return c.json({ error: message }, 400);
      }
      return c.json({ ok: true });
    } catch (e) {
      logger.error('API Error: /api/auth/reset-password', e);
      return c.json({ error: 'Password reset request failed.' }, 500);
    }
  },
);

// POST /api/auth/resend-confirmation
authRouter.post('/resend-confirmation', async (c) => {
  if (isLocalAuthEnabled()) {
    return c.json({ ok: true });
  }

  const body = await c.req.json().catch(() => ({}));
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email) {
    return c.json({ error: '请输入邮箱。' }, 400);
  }

  try {
    const authResponse = await supabaseAuthRequest('/resend', {
      method: 'POST',
      body: JSON.stringify({ type: 'signup', email }),
    });
    const { message } = await readSupabaseAuthResponse(authResponse);
    if (!authResponse.ok) {
      return c.json({ error: message }, 400);
    }
    return c.json({ ok: true });
  } catch (e) {
    logger.error('API Error: /api/auth/resend-confirmation', e);
    return c.json({ error: 'Resend confirmation failed.' }, 500);
  }
});

// POST /api/auth/sign-out
authRouter.post('/sign-out', async (c) => {
  return c.json({ ok: true });
});
