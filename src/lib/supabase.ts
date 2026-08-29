import { PostgrestClient } from '@supabase/postgrest-js';
import type { Session, User } from '@supabase/supabase-js';

type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'PASSWORD_RECOVERY'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED';
type AuthListener = (event: AuthEvent, session: Session | null) => void;
type RealtimeCallback = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => void;

const SESSION_STORAGE_KEY = 'lumina.localAuth.session';
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
const configuredSupabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

function resolveApiUrl(path: string) {
  if (!configuredApiBaseUrl || !path.startsWith('/')) {
    return path;
  }

  const base = configuredApiBaseUrl.endsWith('/') ? configuredApiBaseUrl : `${configuredApiBaseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), base).toString();
}

function resolveRestUrl() {
  if (configuredSupabaseUrl) return `${configuredSupabaseUrl}/rest/v1`;
  return resolveApiUrl('/rest/v1').replace(/\/+$/, '');
}

function readStoredSession() {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as Session;
    if (!session?.access_token || !session?.expires_at || !session?.user?.id) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function writeStoredSession(session: Session | null) {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

let currentSession: Session | null = readStoredSession();
let sessionCheck: Promise<{ data: { session: Session | null }; error: Error | null }> | null = null;
let checkedAt = 0;
const listeners = new Set<AuthListener>();

function notify(event: AuthEvent, session: Session | null) {
  for (const listener of listeners) {
    listener(event, session);
  }
}

function setSession(session: Session | null, event: AuthEvent) {
  currentSession = session;
  checkedAt = Date.now();
  writeStoredSession(session);
  notify(event, session);
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    token_type: session.token_type ?? 'bearer',
    refresh_token: session.refresh_token ?? '',
  };
}

async function authFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(resolveApiUrl(path), {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string; session?: Session };
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || 'Authentication failed.'), { status: response.status });
  }
  return payload;
}

function createRestClient() {
  const token = currentSession?.access_token ?? '';
  return new PostgrestClient(resolveRestUrl(), {
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) }),
    headers: {
      ...(configuredSupabasePublishableKey ? { apikey: configuredSupabasePublishableKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function resolveStorageUrl(path: string) {
  const normalizedPath = path.replace(/^\/+/, '');
  if (configuredSupabaseUrl) return `${configuredSupabaseUrl}/storage/v1/${normalizedPath}`;
  return resolveApiUrl(`/storage/v1/${normalizedPath}`);
}

function createStorageBucket(bucket: string) {
  return {
    async createSignedUrl(path: string, _expiresIn?: number) {
      return {
        data: {
          signedUrl: resolveStorageUrl(`object/public/${bucket}/${path}`),
        },
        error: null,
      };
    },
    getPublicUrl(path: string) {
      return {
        data: {
          publicUrl: resolveStorageUrl(`object/public/${bucket}/${path}`),
        },
      };
    },
  };
}

export const supabase = {
  auth: {
    onAuthStateChange(listener: AuthListener) {
      listeners.add(listener);
      queueMicrotask(() => listener('INITIAL_SESSION', currentSession));
      return {
        data: {
          subscription: {
            unsubscribe() {
              listeners.delete(listener);
            },
          },
        },
      };
    },
    async getSession() {
      const stored = readStoredSession();
      if (!stored) {
        currentSession = null;
        return { data: { session: null }, error: null };
      }

      if (
        currentSession?.access_token === stored.access_token &&
        stored.expires_at! > Date.now() / 1000 + 60 &&
        Date.now() - checkedAt < 60000
      ) {
        return { data: { session: currentSession }, error: null };
      }
      if (sessionCheck) return sessionCheck;
      const token = stored.access_token;
      sessionCheck = (async () => {
        try {
          if (stored.expires_at! <= Date.now() / 1000 + 60 && stored.refresh_token && configuredSupabaseUrl) {
            const response = await fetch(`${configuredSupabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: configuredSupabasePublishableKey },
              body: JSON.stringify({ refresh_token: stored.refresh_token }),
              signal: AbortSignal.timeout(15000),
            });
            if (!response.ok)
              throw Object.assign(new Error('登录续期失败，请重新登录。'), {
                status: response.status === 400 ? 401 : response.status,
              });
            const session = normalizeSession(await response.json());
            if (currentSession?.access_token === token) setSession(session, 'TOKEN_REFRESHED');
            return { data: { session: currentSession }, error: null };
          }
          const payload = await authFetch('/api/auth/session', {
            headers: {
              Authorization: `Bearer ${stored.access_token}`,
            },
          });
          if (currentSession?.access_token !== token) return { data: { session: currentSession }, error: null };
          const session = normalizeSession({
            ...stored,
            ...payload.session,
            refresh_token: payload.session?.refresh_token || stored.refresh_token,
          });
          setSession(session, 'TOKEN_REFRESHED');
          return { data: { session }, error: null };
        } catch (error) {
          if (currentSession?.access_token !== token) return { data: { session: currentSession }, error: null };
          if ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 403) {
            setSession(null, 'SIGNED_OUT');
            return { data: { session: null }, error: error as Error };
          }
          return { data: { session: stored }, error: null };
        }
      })().finally(() => {
        sessionCheck = null;
      });
      return sessionCheck;
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      try {
        const payload = await authFetch('/api/auth/sign-in', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        const session = payload.session ? normalizeSession(payload.session) : null;
        setSession(session, 'SIGNED_IN');
        return { data: { session, user: session?.user as User }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error };
      }
    },
    async signUp({
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: { data?: { full_name?: string }; emailRedirectTo?: string };
    }) {
      try {
        const payload = await authFetch('/api/auth/sign-up', {
          method: 'POST',
          body: JSON.stringify({ email, password, fullName: options?.data?.full_name ?? '' }),
        });
        const session = payload.session ? normalizeSession(payload.session) : null;
        if (session) setSession(session, 'SIGNED_IN');
        return { data: { session, user: session?.user as User }, error: null };
      } catch (error) {
        return { data: { session: null, user: null }, error };
      }
    },
    async resetPasswordForEmail(email: string, _options?: { redirectTo?: string }) {
      try {
        await authFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        return { data: {}, error: null };
      } catch (error) {
        return { data: {}, error };
      }
    },
    async updateUser({ password }: { password?: string }) {
      if (!password || !currentSession?.access_token) {
        return { data: { user: currentSession?.user ?? null }, error: new Error('Missing password or session.') };
      }

      try {
        await authFetch('/api/auth/update-password', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${currentSession.access_token}`,
          },
          body: JSON.stringify({ password }),
        });
        notify('USER_UPDATED', currentSession);
        return { data: { user: currentSession.user as User }, error: null };
      } catch (error) {
        return { data: { user: currentSession.user as User }, error };
      }
    },
    async resend({ email }: { type?: string; email: string; options?: { emailRedirectTo?: string } }) {
      try {
        await authFetch('/api/auth/resend-confirmation', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        return { data: {}, error: null };
      } catch (error) {
        return { data: {}, error };
      }
    },
    async signOut() {
      await authFetch('/api/auth/sign-out', { method: 'POST' }).catch(() => null);
      setSession(null, 'SIGNED_OUT');
      return { error: null };
    },
    async signInWithOAuth(_options?: {
      provider?: string;
      options?: {
        redirectTo?: string;
        scopes?: string;
      };
    }) {
      return {
        data: null,
        error: new Error('Google 登录暂未迁移，请先使用邮箱登录。'),
      };
    },
  },
  from(relation: string) {
    return createRestClient().from(relation);
  },
  rpc(fn: string, args?: Record<string, unknown>, options?: Record<string, unknown>) {
    return createRestClient().rpc(fn, args, options);
  },
  storage: {
    from(bucket: string) {
      return createStorageBucket(bucket);
    },
  },
  channel(_name: string) {
    return {
      on(_event: string, _filter: Record<string, unknown>, _callback: RealtimeCallback) {
        return this;
      },
      subscribe() {
        return this;
      },
      unsubscribe() {
        return Promise.resolve('ok' as const);
      },
    };
  },
  removeChannel(channel: { unsubscribe?: () => Promise<unknown> | unknown }) {
    return Promise.resolve(channel.unsubscribe?.()).then(() => 'ok' as const);
  },
};
